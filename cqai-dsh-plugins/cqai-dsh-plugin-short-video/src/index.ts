import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type { DsnAccountService } from '@cqaiclub/dsn-account'
import { isChatModel, isImageGenerationModel, isVideoCatalogEntry, isVideoModel } from '@cqaiclub/dsn-account'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SetupManager, python311, pythonEnvironment, run as runCommand, uvEnvironment, uvExecutable } from 'cqai-dsh-plugin-media-runtime'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { API, audioPreviewReuseIssue, defaultParams, defaultSettings, materialKeyIssue, materialPreviewReuseIssue, needsText, stageRequirements, subtitlePreviewReuseIssue, workflowIdForJob, workflowIdForNewJob, type Artifact, type ContentAction, type ContentResult, type Draft, type Job, type Settings, type Stage, type UploadKind } from './protocol.ts'
import { createVideoMaterial, validateVideoMaterialRequest } from './video-provider.ts'
export { needsText } from './protocol.ts'

export const name = 'cqai-short-video'
export const inject = ['webServer', 'dsnAccount', 'llm']
const MAX_BODY = 300_000
const MAX_UPLOAD: Record<UploadKind, number> = { material: 1024 * 1024 * 1024, audio: 250 * 1024 * 1024, bgm: 150 * 1024 * 1024 }
const EXTENSIONS: Record<UploadKind, readonly string[]> = {
  material: ['.mp4', '.mov', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.webp'],
  audio: ['.mp3', '.m4a', '.wav', '.ogg', '.flac'],
  bgm: ['.mp3', '.m4a', '.wav', '.ogg', '.flac'],
}
const SOURCES = new Set(['pexels', 'pixabay', 'coverr', 'openai_image', 'cqai_video', 'local'])
const STAGES = new Set<Stage>(['script', 'terms', 'audio', 'subtitle', 'materials', 'video'])
const PARAM_KEYS = new Set(Object.keys(defaultParams))
const now = () => new Date().toISOString()
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const asText = (v: unknown, max = 500): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('文本字段无效或过长')
  return v.trim()
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
  res.end(JSON.stringify(data))
}
export function permitted(req: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const host = req.headers.host
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return req.method === 'GET' || req.headers['x-short-video'] === '1'
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0; const parts: Buffer[] = []
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('请求过大'); parts.push(Buffer.from(chunk)) }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}
export function validateDraft(raw: unknown): Draft {
  if (!isRecord(raw) || !isRecord(raw.params)) throw new Error('任务参数无效')
  const stopAt = raw.stopAt
  if (!STAGES.has(stopAt as Stage)) throw new Error('制作阶段无效')
  const params = {...defaultParams}
  for (const [key, value] of Object.entries(raw.params)) {
    if (!PARAM_KEYS.has(key)) throw new Error(`不支持的参数: ${key}`)
    params[key] = value
  }
  params.video_subject = asText(params.video_subject, 500)
  params.video_script = asText(params.video_script, 30_000)
  params.video_terms = asText(params.video_terms, 4_000)
  params.video_script_prompt = asText(params.video_script_prompt, 2_000)
  params.custom_system_prompt = asText(params.custom_system_prompt, 8_000)
  if (!params.video_subject && !params.video_script) throw new Error('请填写主题或文案')
  if (!SOURCES.has(String(params.video_source))) throw new Error('素材来源暂不可用')
  if (!['9:16', '16:9', '1:1'].includes(String(params.video_aspect))) throw new Error('视频比例无效')
  if (!['cover', 'contain'].includes(String(params.video_fit_mode))) throw new Error('画面适配无效')
  if (!['random', 'sequential'].includes(String(params.video_concat_mode))) throw new Error('拼接模式无效')
  if (![null, 'Shuffle', 'FadeIn', 'FadeOut', 'SlideIn', 'SlideOut', 'ZoomIn', 'ZoomOut'].includes(params.video_transition_mode as string | null)) throw new Error('转场无效')
  if (!['none', 'random', 'custom'].includes(String(params.bgm_type))) throw new Error('配乐方式无效')
  if (!['tts', 'upload', 'video_original'].includes(String(params.audio_source))) throw new Error('声音来源无效')
  if (params.audio_source === 'video_original' && params.video_source !== 'cqai_video') throw new Error('只有 CQAI 视频素材可使用视频原声')
  if (!Number.isInteger(params.target_duration_seconds) || Number(params.target_duration_seconds) < 1 || Number(params.target_duration_seconds) > 3000) throw new Error('目标时长无效')
  if (params.video_source === 'cqai_video' && Math.ceil(Number(params.target_duration_seconds) / Number(params.video_clip_duration)) * Number(params.video_count) > 100) throw new Error('AI 视频镜头数超过 100，请缩短时长或减少成片数量')
  for (const [key, min, max] of [['video_clip_duration', 1, 30], ['video_clip_speed', .1, 4], ['video_count', 1, 5], ['paragraph_number', 1, 10], ['font_size', 12, 160], ['stroke_width', 0, 10], ['n_threads', 1, 16], ['bgm_volume', 0, 1], ['voice_rate', .5, 2], ['voice_volume', 0, 2], ['custom_position', 0, 100]] as const) {
    const value = params[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} 超出范围`)
  }
  for (const key of ['video_count', 'paragraph_number', 'video_clip_duration', 'font_size', 'n_threads']) if (!Number.isInteger(params[key])) throw new Error(`${key} 必须是整数`)
  for (const key of ['font_name', 'voice_name', 'video_language', 'subtitle_position', 'subtitle_display_mode', 'subtitle_animation', 'text_fore_color', 'stroke_color']) params[key] = asText(params[key], 200)
  for (const key of ['subtitle_enabled', 'match_materials_to_script', 'rounded_subtitle_background']) if (typeof params[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`)
  if (!['sentence', 'word_by_word'].includes(String(params.subtitle_display_mode))) throw new Error('字幕显示方式无效')
  if (!['none', 'pop_spring'].includes(String(params.subtitle_animation))) throw new Error('字幕动画无效')
  if (!['top', 'bottom', 'center', 'custom', 'two_thirds_bottom'].includes(String(params.subtitle_position))) throw new Error('字幕位置无效')
  const textModel = asText(raw.textModel, 200)
  const imageModel = asText(raw.imageModel, 200)
  const videoModel = asText(raw.videoModel ?? '', 200)
  return { textModel, imageModel, videoModel, stopAt: stopAt as Stage, params }
}
export function validateContentRequest(raw: unknown): {action: ContentAction; draft: Draft} {
  if (!isRecord(raw) || !['preview', 'script', 'terms'].includes(String(raw.action))) throw new Error('文案操作无效')
  const action = raw.action as ContentAction
  const draft = validateDraft(raw.draft)
  if (action !== 'terms' && !draft.params.video_subject) throw new Error('请先填写视频主题')
  if (action === 'terms' && !draft.params.video_script) throw new Error('请先填写视频文案')
  return {action, draft}
}
function validateSettings(raw: unknown): Settings {
  if (!isRecord(raw)) throw new Error('设置格式无效')
  const result = {...defaultSettings}
  for (const key of ['pexels_api_keys', 'pixabay_api_keys', 'coverr_api_keys'] as const) result[key] = asText(raw[key] ?? '', 1000)
  if (raw.subtitle_provider !== 'edge' && raw.subtitle_provider !== 'whisper') throw new Error('字幕引擎无效')
  result.subtitle_provider = raw.subtitle_provider
  if (!['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf'].includes(String(raw.video_codec))) throw new Error('编码器无效')
  result.video_codec = raw.video_codec as Settings['video_codec']
  return result
}
function safePath(root: string, relative: string): string {
  const target = resolve(root, relative)
  if (!target.startsWith(resolve(root) + sep)) throw new Error('非法文件路径')
  return target
}
async function removeTaskDirectory(parent: string, id: string): Promise<void> {
  const target=safePath(parent,id)
  if(!existsSync(target))return
  const parentReal=realpathSync(parent),targetReal=realpathSync(target)
  if(!targetReal.startsWith(parentReal+sep))throw new Error('任务目录超出数据根目录')
  await rm(target,{recursive:true,force:true})
}
function serveFile(req: IncomingMessage, res: ServerResponse, file: string, download: boolean) {
  const size = statSync(file).size
  let start = 0, end = size - 1, status = 200
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, {'content-range': `bytes */${size}`}); res.end(); return }
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (start > end || start >= size) { res.writeHead(416, {'content-range': `bytes */${size}`}); res.end(); return }
    status = 206
  }
  const contentType: Record<string,string> = {'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.srt':'text/plain; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}
  res.writeHead(status, {'content-type': contentType[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': String(end-start+1), 'accept-ranges':'bytes', 'x-content-type-options':'nosniff', ...(status === 206 ? {'content-range':`bytes ${start}-${end}/${size}`} : {}), ...(download ? {'content-disposition':`attachment; filename="${basename(file).replace(/[^A-Za-z0-9._-]/g,'_')}"`} : {})})
  const stream = createReadStream(file, {start,end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
}
function physicalRuntime(): string {
  const location = fileURLToPath(new URL('../runtime/', import.meta.url))
  const unpacked = location.replace(/\.asar([\\/])/, '.asar.unpacked$1')
  return existsSync(join(unpacked, 'bridge.py')) ? unpacked : location
}
function pythonPath(dataRoot: string): string {
  const venv = join(dataRoot, 'engine', '.venv')
  return process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
}
function terminate(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore'})
  else child.kill('SIGTERM')
}
function materialArtifactsFor(root:string):Artifact[]{
  const materialDir=join(root,'cqai-materials')
  try{
    if(!existsSync(materialDir)||!lstatSync(materialDir).isDirectory())return []
    const result:Artifact[]=[]
    for(const entry of readdirSync(materialDir,{withFileTypes:true})){
      if(!entry.isFile()||extname(entry.name).toLowerCase()!=='.mp4')continue
      const full=safePath(materialDir,entry.name)
      result.push({file:`cqai-materials/${entry.name}`,name:entry.name,size:statSync(full).size,kind:'material'})
    }
    return result
  }catch{return []}
}
const subtitleProviderFor = (draft: Draft, settings: Settings): Settings['subtitle_provider'] =>
  draft.params.audio_source === 'upload' || draft.params.audio_source === 'video_original' ? 'whisper' : settings.subtitle_provider
const SAVED_MATERIALS='saved-materials/'
export function storedMaterialArtifactsFor(root:string,job:Job):Artifact[]{
  const source=String(job.params.video_source||'')
  let files:string[]=[]
  let directory:string
  let scope:string
  if(source==='local'){
    files=Array.isArray(job.uploads?.material)?job.uploads.material:[]
    directory=join(root,'storage','local_videos');scope='local'
  }else if(['pexels','pixabay','coverr'].includes(source)){
    try{
      const manifest=JSON.parse(readFileSync(join(root,'storage','tasks',job.id,'script.json'),'utf8')) as Record<string,unknown>
      files=Array.isArray(manifest.material_sources)?manifest.material_sources.flatMap(value=>
        value&&typeof value==='object'&&typeof (value as Record<string,unknown>).local_file==='string'?[(value as Record<string,string>).local_file]:[]):[]
    }catch{return []}
    directory=join(root,'storage','cache_videos');scope='cache'
  }else return []
  try{if(!existsSync(directory)||!lstatSync(directory).isDirectory())return []}catch{return []}
  const result:Artifact[]=[]
  for(const name of new Set(files)){
    if(typeof name!=='string'||!name||/[\\/]/.test(name)||name==='.'||name==='..'||!EXTENSIONS.material.includes(extname(name).toLowerCase()))continue
    try{
      const full=safePath(directory,name)
      if(!lstatSync(full).isFile())continue
      result.push({file:`${SAVED_MATERIALS}${scope}/${name}`,name,size:statSync(full).size,kind:'material'})
    }catch{/* missing cache entry */}
  }
  return result
}
export function artifactPath(root:string,job:Job,file:string):string{
  if(!job.artifacts.some(artifact=>artifact.file===file))throw new Error('文件不在任务产物中')
  const saved=/^saved-materials\/(cache|local)\/([^\\/]+)$/.exec(file)
  const directory=saved?join(root,'storage',saved[1]==='cache'?'cache_videos':'local_videos'):join(root,'storage','tasks',job.id)
  const full=realpathSync(safePath(directory,saved?saved[2]:file))
  if(!full.startsWith(realpathSync(directory)+sep))throw new Error('非法文件路径')
  return full
}
export async function artifactsFor(root: string): Promise<Artifact[]> {
  if (!existsSync(root)) return []
  const files = await readdir(root, {withFileTypes:true})
  const result: Artifact[] = []
  for (const entry of files) {
    if (!entry.isFile()) continue
    const ext = extname(entry.name).toLowerCase()
    if (!['.mp4',...EXTENSIONS.audio,'.srt','.json','.png','.jpg'].includes(ext)) continue
    const full = safePath(root, entry.name)
    const size = statSync(full).size
    result.push({file: entry.name, name: entry.name, size, kind: ext === '.mp4' ? 'video' : EXTENSIONS.audio.includes(ext) ? 'audio' : ext === '.srt' ? 'subtitle' : 'data'})
  }
  result.push(...materialArtifactsFor(root))
  return result
}
export async function copyAudioPreview(storage: string, preview: Job, targetId: string, includeSubtitle: boolean): Promise<string> {
  const sourceDir=safePath(storage,preview.id),targetDir=safePath(storage,targetId)
  const audio=preview.artifacts.find(a=>a.kind==='audio')
  if(!audio)throw new Error('试听任务没有音频文件')
  const extension=extname(audio.file).toLowerCase()
  if(!EXTENSIONS.audio.includes(extension))throw new Error('配音文件类型无效')
  const storedAudio=`voice-preview${extension}`
  await mkdir(targetDir)
  try{
    const storageReal=realpathSync(storage),sourceReal=realpathSync(sourceDir)
    if(!sourceReal.startsWith(storageReal+sep)||!realpathSync(targetDir).startsWith(storageReal+sep))throw new Error('配音任务目录无效')
    const copyArtifact=async(file:string,target:string)=>{
      const real=realpathSync(safePath(sourceDir,file))
      if(!real.startsWith(sourceReal+sep))throw new Error('配音产物路径无效')
      await copyFile(real,safePath(targetDir,target))
    }
    await copyArtifact(audio.file,storedAudio)
    if(preview.voiceTimingAvailable){
      await mkdir(safePath(targetDir,'.private'),{recursive:true})
      await copyArtifact(join('.private','voice-timing.json'),join('.private','voice-timing.json'))
    }
    if(includeSubtitle){
      const subtitle=preview.artifacts.find(a=>a.kind==='subtitle')
      if(!subtitle||extname(subtitle.file).toLowerCase()!=='.srt')throw new Error('字幕文件类型无效')
      await copyArtifact(subtitle.file,'subtitle.srt')
    }
    return storedAudio
  }catch(error){await rm(targetDir,{recursive:true,force:true});throw error}
}
export function validateSubtitleSrt(srt: string, duration: number): void {
  if (typeof srt !== 'string' || srt.length > 200_000) throw new Error('字幕内容过长')
  if (!srt.trim()) return
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('缺少成片时长，不能保存非空字幕')
  const parseTime = (value: string): number => {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value)
    if (!match) throw new Error('字幕时间格式无效')
    const [,h,m,s,ms] = match.map(Number)
    if (m > 59 || s > 59) throw new Error('字幕时间格式无效')
    return h * 3600 + m * 60 + s + ms / 1000
  }
  let lastEnd = 0
  for (const [index, block] of srt.trim().replace(/\r\n/g,'\n').split(/\n\s*\n/).entries()) {
    const lines=block.split('\n')
    if (lines.length < 3 || Number(lines[0]) !== index + 1) throw new Error('字幕序号或内容无效')
    const times=/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/.exec(lines[1])
    if (!times || !lines.slice(2).join('').trim()) throw new Error('字幕时间或文本无效')
    const start=parseTime(times[1]),end=parseTime(times[2])
    if (start < lastEnd || end <= start || end > duration + 0.5) throw new Error('字幕时间超出音频范围或发生重叠')
    lastEnd=end
  }
}

export function apply(ctx: Context): void {
  const dsnAccount = (ctx as Context & { dsnAccount: DsnAccountService }).dsnAccount
  const root = join(resolveDshHome(), 'short-video')
  const jobsRoot = join(root, 'jobs')
  const runtime = physicalRuntime()
  const jobs = new Map<string, Job>()
  const children = new Map<string, ChildProcessWithoutNullStreams>()
  const videoAborts = new Map<string, AbortController>()
  const contentChildren = new Set<ChildProcessWithoutNullStreams>()
  let contentReserved = false
  const writes = new Map<string, Promise<void>>()
  let healthCache: Promise<Record<string,unknown>> | undefined
  let healthAt=0
  const health=()=>{
    if(!healthCache||Date.now()-healthAt>30_000){healthAt=Date.now();healthCache=checkHealth(root,runtime)}
    return healthCache
  }
  const uvHome=join(resolveDshHome(),'media-tools')
  const setup=new SetupManager(()=>[
    {id:'uv',label:'内置 uv',ready:async()=>probeUv(),run:async(log)=>{await runCommand(uvExecutable(),['--version'],{log})}},
    {id:'python',label:'Python 3.11',ready:async()=>{try{await python311(uvHome);return true}catch{return false}},run:async(log)=>{await mkdir(uvHome,{recursive:true});await runCommand(uvExecutable(),['python','install','3.11'],{env:uvEnvironment(uvHome),log})}},
    {id:'engine',label:'MoneyPrinterTurbo 锁定环境',ready:async()=>engineReady(root,runtime),run:async(log)=>setupEngine(root,runtime,uvHome,log)},
    {id:'ffmpeg',label:'FFmpeg',ready:async()=>Boolean((await checkHealth(root,runtime)).ffmpeg),run:async(log)=>{log('从锁定的 imageio-ffmpeg 依赖检查内置程序');await setupEngine(root,runtime,uvHome,log)}},
  ])
  let lastSetupFinishedAt=0
  const setupSnapshot=()=>{const state=setup.snapshot();if(state.status!=='running'&&state.status!=='idle'&&state.updatedAt!==lastSetupFinishedAt){healthCache=undefined;lastSetupFinishedAt=state.updatedAt}return state}
  void mkdir(jobsRoot, {recursive:true})
  if (existsSync(jobsRoot)) {
    for (const dir of requireDirs(jobsRoot)) {
      if (!/^[a-f0-9-]{36}$/.test(dir)) continue
      try {
        const job = JSON.parse(readFileSync(join(jobsRoot, dir, 'job.json'), 'utf8')) as Job
        if (job.id !== dir) continue
        if (!isRecord(job.params)) continue
        job.params={...defaultParams,...job.params}
        if (job.status === 'running') {job.status='interrupted'; job.error='应用关闭导致任务中断'; job.updatedAt=now()}
        if (job.stopAt === 'materials' && job.params.video_source === 'cqai_video' && !Array.isArray(job.state?.terms)) {
          try {
            const manifest=JSON.parse(readFileSync(join(root,'storage','tasks',dir,'script.json'),'utf8')) as Record<string,unknown>
            if (Array.isArray(manifest.search_terms) && manifest.search_terms.every(term=>typeof term==='string')) job.state={...job.state,terms:manifest.search_terms}
          } catch { /* historical material task without a manifest */ }
        }
        const original=Array.isArray(job.artifacts)?job.artifacts.filter(artifact=>!artifact.file.startsWith(SAVED_MATERIALS)):[]
        const known=new Set(original.map(artifact=>artifact.file))
        job.artifacts=[...original,...materialArtifactsFor(join(root,'storage','tasks',dir)).filter(artifact=>!known.has(artifact.file)),...storedMaterialArtifactsFor(root,job)]
        jobs.set(dir, job)
      } catch { /* ignore corrupt job records */ }
    }
  }
  const jobDir = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('任务 ID 无效')
    return safePath(jobsRoot, id)
  }
  const get = (id: string) => {const job=jobs.get(id); if (!job) throw new Error('找不到任务'); return job}
  const save = (job: Job): Promise<void> => {
    job.updatedAt=now()
    const dir=jobDir(job.id), serialized=JSON.stringify(job,null,2)
    const next=(writes.get(job.id)??Promise.resolve()).catch(()=>{}).then(async()=>{
      await mkdir(dir,{recursive:true})
      const tmp=join(dir,`job-${randomUUID()}.tmp`)
      try{await writeFile(tmp,serialized,'utf8');await rename(tmp,join(dir,'job.json'))}
      finally{await rm(tmp,{force:true})}
    })
    writes.set(job.id,next)
    void next.finally(()=>{if(writes.get(job.id)===next)writes.delete(job.id)}).catch(()=>{})
    return next
  }
  const catalog = async () => {
    const status=await dsnAccount.getStatus()
    if (status.state !== 'signed-in') return {signedIn:false,text:[],image:[],video:[],warning:'请先登录 CQAI Club'}
    const models=await dsnAccount.listModels()
    const defaults=await dsnAccount.getCategoryDefaultModels()
    return {
      signedIn:true, text:models.models.filter(isChatModel).map(m=>({id:m.id,name:m.name || m.id})),
      image:models.models.filter(isImageGenerationModel).map(m=>({id:m.id,name:m.name || m.id})),
      video:models.models.filter(isVideoCatalogEntry).map(m=>({id:m.id,name:m.name || m.id,callable:isVideoModel(m)})),
      warning:models.warning, defaultText:defaults.global.provider === 'cqaiclub' ? defaults.global.model : undefined,
      defaultImage:defaults.categories.image?.provider === 'cqaiclub' ? defaults.categories.image.model : undefined,
    }
  }
  const verifyModels = async (draft: Draft, preparedMaterials = false) => {
    const textNeeded = !draft.params.video_script || (!preparedMaterials && needsText(draft))
    const imageNeeded = stageRequirements(draft).imageModel
    const videoNeeded = !preparedMaterials && stageRequirements(draft).videoModel
    if (!textNeeded && !imageNeeded && !videoNeeded) return
    const available=await catalog()
    if (textNeeded && !draft.textModel) throw new Error('请选择 CQAI Club 文本模型')
    if (textNeeded && !available.text.some(m=>m.id===draft.textModel)) throw new Error('所选文本模型不在当前 CQAI Club 账号中')
    if (imageNeeded && !draft.imageModel) throw new Error('请选择 CQAI Club 图片模型')
    if (imageNeeded && !available.image.some(m=>m.id===draft.imageModel)) throw new Error('所选图片模型不在当前 CQAI Club 账号中')
    if (videoNeeded && !draft.videoModel) throw new Error('请选择 CQAI Club 视频模型')
    if (videoNeeded && !available.video.some(m=>m.id===draft.videoModel)) throw new Error('所选视频模型不在当前 CQAI Club 账号中')
  }
  const llmCall = async (model: string, prompt: string): Promise<string> => {
    const available=await catalog()
    if (!available.text.some(m=>m.id===model)) throw new Error('CQAI Club 文本模型已不可用')
    let output=''
    for await (const chunk of ctx.llm.stream({provider:'cqaiclub',model,messages:[createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'user'}})]})) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted' ? chunk.reason.failure.message : '模型响应未完成')
    }
    if (!output.trim()) throw new Error('CQAI Club 模型返回空内容')
    return output
  }
  const runContent = async (action: ContentAction, draft: Draft, res: ServerResponse): Promise<ContentResult> => {
    if (action !== 'preview') {
      const available = await catalog()
      if (!draft.textModel || !available.text.some(m => m.id === draft.textModel)) throw new Error('请选择当前 CQAI Club 账号可用的文本模型')
    }
    const requestDir = join(root, 'content-requests')
    await mkdir(requestDir, {recursive:true})
    const requestFile = join(requestDir, `${randomUUID()}.json`)
    let child: ChildProcessWithoutNullStreams | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let result: ContentResult | undefined
    let fatal = ''
    let stdout = '', stderr = ''
    const disconnected = () => {fatal = '页面已关闭，生成已取消'; if (child) terminate(child)}
    try {
      await writeFile(requestFile, JSON.stringify({action, params:draft.params}), 'utf8')
      child = spawn(pythonPath(root), [join(runtime, 'bridge.py'), 'content', requestFile], {
        windowsHide:true, cwd:runtime, env:{...process.env, MPT_DSH_DATA_ROOT:root, PYTHONUTF8:'1'}, stdio:['pipe','pipe','pipe'],
      })
      contentChildren.add(child)
      res.once('close', disconnected)
      timeout = setTimeout(() => {fatal = '文案生成超时'; if (child) terminate(child)}, 10 * 60 * 1000)
      child.stderr.on('data', (chunk: Buffer) => {stderr = (stderr + chunk.toString()).slice(-4000)})
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        const lines = stdout.split(/\r?\n/)
        stdout = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('MPT_EVENT ')) continue
          let event: Record<string, unknown>
          try {event = JSON.parse(line.slice(10))} catch {continue}
          if (event.type === 'llm_request') {
            const active = child
            void llmCall(draft.textModel, String(event.prompt)).then(
              value => {if (active?.stdin.writable) active.stdin.write(JSON.stringify({ok:true,value}) + '\n')},
              error => {if (active?.stdin.writable) active.stdin.write(JSON.stringify({ok:false,error:error instanceof Error ? error.message : String(error)}) + '\n')},
            )
          } else if (event.type === 'content_result') {
            if (action === 'preview' && typeof event.prompt === 'string' && typeof event.defaultSystemPrompt === 'string') result = {prompt:event.prompt, defaultSystemPrompt:event.defaultSystemPrompt}
            if (action !== 'preview' && typeof event.script === 'string' && Array.isArray(event.terms) && event.terms.every(term => typeof term === 'string')) result = {script:event.script, terms:event.terms as string[]}
          } else if (event.type === 'fatal') fatal = String(event.error || '文案生成失败')
        }
      })
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child!.once('error', reject)
        child!.once('close', resolve)
      })
      if (fatal || exitCode !== 0) throw new Error(fatal || stderr.trim() || `Python 进程退出: ${exitCode}`)
      if (!result) throw new Error(fatal || stderr.trim() || '文案生成未返回结果')
      return result
    } finally {
      if (timeout) clearTimeout(timeout)
      res.off('close', disconnected)
      if (child) contentChildren.delete(child)
      await rm(requestFile, {force:true})
    }
  }
  const generateContent = async (action: ContentAction, draft: Draft, res: ServerResponse): Promise<ContentResult> => {
    if (contentReserved) throw new Error('已有文案生成请求正在运行')
    contentReserved = true
    try {return await runContent(action, draft, res)}
    finally {contentReserved = false}
  }
  const imageCall = async (model: string, payload: Record<string, unknown>) => {
    const available=await catalog()
    if (!available.image.some(m=>m.id===model)) throw new Error('CQAI Club 图片模型已不可用')
    const body=model==='dall-e-3'?{...payload,model}:{...payload,model,response_format:'b64_json'}
    const response=await dsnAccount.fetchAi('/v1/images/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    const result=await response.json() as Record<string,unknown>
    if(!response.ok)throw new Error(`CQAI Club 图片生成失败 (HTTP ${response.status}): ${JSON.stringify(result).slice(0,500)}`)
    return result
  }
  const verifyJobInputs = (job: Job) => {
    if (job.params.audio_source === 'upload' && ['audio','subtitle','video'].includes(job.stopAt) && !job.uploads.audio) throw new Error('请先上传旁白')
    const material = job.materialPreviewJobId ? get(job.materialPreviewJobId) : undefined
    if (job.params.video_source === 'cqai_video' && ['subtitle','video'].includes(job.stopAt) && !material) throw new Error('请先生成 AI 视频素材')
    if (material) {const issue=materialPreviewReuseIssue(material,job);if(issue)throw new Error(issue)}
    if (job.subtitlePreviewJobId) {
      const issue=subtitlePreviewReuseIssue(get(job.subtitlePreviewJobId),job,job.materialPreviewJobId,job.audioPreviewJobId)
      if (issue) throw new Error(issue)
    }
    return material
  }
  const run = async (job: Job) => {
    const materialPreview = verifyJobInputs(job)
    await verifyModels(job,Boolean(job.materialPreviewJobId))
    const requirements = stageRequirements(job)
    if (requirements.materialUpload && !job.uploads.material.length) throw new Error('请上传本地视频或图片素材')
    if (requirements.backgroundMusicUpload && !job.uploads.bgm) throw new Error('请上传自定义背景音乐')
    const settings = await readSettings(root)
    const keyIssue = materialKeyIssue(job, settings)
    if (keyIssue) throw new Error(keyIssue)
    const preview = job.audioPreviewJobId ? jobs.get(job.audioPreviewJobId) : undefined
    if (preview) {
      const previewIssue = audioPreviewReuseIssue(preview, job, subtitleProviderFor(job,settings))
      if (previewIssue) throw new Error(previewIssue)
    }
    job.subtitleProvider = subtitleProviderFor(job,settings)
    const subtitlePreview = job.subtitlePreviewJobId ? get(job.subtitlePreviewJobId) : undefined
    const reuseSubtitle = Boolean(subtitlePreview || (preview && preview.stopAt === 'subtitle' && job.params.subtitle_enabled &&
      preview.subtitleProvider === job.subtitleProvider && preview.params.subtitle_display_mode === job.params.subtitle_display_mode &&
      preview.artifacts.some(a=>a.kind==='subtitle')))
    const preparedMaterials = materialPreview?.materialGroups?.map(group => group.map(file => {
      const parent = join(root,'storage','tasks',materialPreview.id)
      const full = safePath(parent,file)
      if (!existsSync(full) || !lstatSync(full).isFile() || extname(full).toLowerCase() !== '.mp4') throw new Error('已生成的视频素材文件丢失，请检查原任务')
      return realpathSync(full)
    }))
    const requestFile=join(jobDir(job.id),'request.json')
    await writeFile(requestFile,JSON.stringify({id:job.id,params:job.params,stopAt:job.stopAt,textModel:job.textModel,imageModel:job.imageModel,uploads:job.uploads,settings,reuseSubtitle,preparedMaterials}), 'utf8')
    if(job.status==='cancelled')return
    job.status='running';job.progress=0;job.error=undefined;job.logs=[];await save(job)
    const videoAbort = new AbortController()
    videoAborts.set(job.id, videoAbort)
    const child=spawn(pythonPath(root),[join(runtime,'bridge.py'),'run',requestFile],{windowsHide:true,cwd:runtime,env:{...process.env,MPT_DSH_DATA_ROOT:root,PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']})
    children.set(job.id,child)
    let stdout='', stderr='', gotResult=false, fatal=''
    child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();const lines=stderr.split(/\r?\n/);stderr=lines.pop()||'';for(const line of lines){if(line.trim()){job.logs.push(line.slice(0,1000));job.logs=job.logs.slice(-150)}}})
    child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();const lines=stdout.split(/\r?\n/);stdout=lines.pop()||'';for(const line of lines){if(!line.startsWith('MPT_EVENT '))continue;let event:Record<string,unknown>;try{event=JSON.parse(line.slice(10))}catch{continue}
      if(event.type==='llm_request' || event.type==='image_request' || event.type==='video_request'){
        const respond=(value:unknown,error?:string)=>{if(child.stdin.writable)child.stdin.write(JSON.stringify(error?{ok:false,error}:{ok:true,value})+'\n')}
        void (async()=>{try{
          if(event.type==='llm_request')respond(await llmCall(job.textModel,String(event.prompt)))
          else if(event.type==='image_request')respond(await imageCall(job.imageModel,event.payload as Record<string,unknown>))
          else if (job.materialPreviewJobId) respond(undefined,'已复用视频素材，禁止再次提交付费镜头')
          else respond(await createVideoMaterial({account:dsnAccount,job,storageRoot:join(root,'storage','tasks'),save,request:validateVideoMaterialRequest(event),signal:videoAbort.signal}))
        }catch(e){respond(undefined,e instanceof Error?e.message:String(e))}})()
      }else if(event.type==='progress' && isRecord(event.state)){
        job.state=event.state;job.progress=Number(event.state.progress)||0;void save(job)
      }else if(event.type==='result' && isRecord(event.state)){
        const output=isRecord(event.result)?event.result:{}
        const script=typeof output.script==='string'?output.script:undefined
        const terms=Array.isArray(output.terms)&&output.terms.every(term=>typeof term==='string')?output.terms as string[]:undefined
        gotResult=true;job.state={...event.state,...(script?{script}:{}),...(terms?{terms}:{})};job.progress=Number(event.state.progress)||100
        if(Array.isArray(output.materialGroups)){
          job.materialGroups=output.materialGroups as string[][]
          let clipIndex=0
          job.materialShots=job.materialGroups.flatMap((group,videoIndex)=>group.map(file=>{
            const index=clipIndex++
            return {videoIndex:videoIndex+1,clipIndex:index+1,remoteTaskId:job.videoTasks?.find(item=>item.key===String(index))?.id,file}
          }))
        }
        if(Array.isArray(output.materialAudio))job.materialAudio=output.materialAudio as boolean[][]
        if(Array.isArray(output.materialDurations))job.materialDurations=output.materialDurations as number[][]
        if(Array.isArray(output.subtitleDurations))job.subtitleDurations=output.subtitleDurations as number[]
        if(Array.isArray(output.warnings))job.state={...job.state,warnings:output.warnings}
        if(event.state.state===1)job.status='completed';else{job.status='failed';job.error=String(event.state.error||'制作失败')}
      }else if(event.type==='fatal') fatal=String(event.error||'Python 执行失败')
    }})
    await new Promise<void>(done=>{child.once('error',error=>{fatal=error.message;done()});child.once('close',code=>{if(!gotResult && !fatal)fatal=`Python 进程退出: ${code}`;done()})})
    children.delete(job.id)
    videoAbort.abort();videoAborts.delete(job.id)
    if ((job.status as Job['status'])==='cancelled') {await save(job);return}
    if (!gotResult || (job.status as Job['status'])!=='completed') {job.status='failed';job.error=job.error||fatal||'制作失败'}
    job.artifacts=[...await artifactsFor(join(root,'storage','tasks',job.id)),...storedMaterialArtifactsFor(root,job)]
    job.voiceTimingAvailable=existsSync(join(root,'storage','tasks',job.id,'.private','voice-timing.json'))
    await save(job)
  }
  const start = async (job: Job) => {
    if (job.status === 'running') throw new Error('任务已在运行')
    if (children.size || [...jobs.values()].some(other=>other.status==='running')) throw new Error('一次只能制作一条短视频')
    const keyIssue = materialKeyIssue(job, await readSettings(root))
    if (keyIssue) throw new Error(keyIssue)
    verifyJobInputs(job)
    if (job.audioPreviewJobId) {
      const preview = jobs.get(job.audioPreviewJobId)
      if (!preview) throw new Error('找不到已确认的配音任务，请重新生成配音')
      const settings=await readSettings(root)
      const previewIssue = audioPreviewReuseIssue(preview, job, subtitleProviderFor(job,settings))
      if (previewIssue) throw new Error(previewIssue)
    }
    await verifyModels(job,Boolean(job.materialPreviewJobId))
    job.status='running';await save(job)
    void run(job).catch(async e=>{job.status='failed';job.error=e instanceof Error?e.message:String(e);job.logs.push(job.error);await save(job)})
    return job
  }
  ctx.effect(() => {
    const unregister=ctx.webServer.register({kind:'prefix',path:API,handler:async(req,res)=>{
      if(!permitted(req))return json(res,403,{error:'仅允许本机应用访问'})
      try {
        const url=new URL(req.url||'', 'http://localhost');const action=url.pathname.slice(API.length+1)
        const id=url.searchParams.get('id')||''
        if(req.method==='GET' && action==='catalog')return json(res,200,await catalog())
        if(req.method==='POST' && action==='content'){
          const request=validateContentRequest(await readJson(req))
          return json(res,200,await generateContent(request.action,request.draft,res))
        }
        if(req.method==='GET' && action==='settings')return json(res,200,await readSettings(root))
        if(req.method==='POST' && action==='settings'){const settings=validateSettings(await readJson(req));await mkdir(root,{recursive:true});await writeFile(join(root,'settings.json'),JSON.stringify(settings,null,2));return json(res,200,settings)}
        if(req.method==='GET' && action==='health'){const state=setupSnapshot();return json(res,200,{...(await health()),setup:state})}
        if(req.method==='GET' && action==='setup')return json(res,200,setupSnapshot())
        if(req.method==='POST' && action==='setup'){const state=setup.start();healthCache=undefined;return json(res,202,state)}
        if(req.method==='GET' && action==='jobs')return json(res,200,[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
         if(req.method==='POST' && action==='jobs'){
             const raw=await readJson(req),draft=validateDraft(raw)
             const previewId=isRecord(raw)?raw.audioPreviewJobId:undefined
            if(previewId!==undefined && (typeof previewId!=='string'||!previewId))throw new Error('配音试听任务 ID 无效')
            const requestedWorkflowId=isRecord(raw)?raw.workflowId:undefined
            if(requestedWorkflowId!==undefined && (typeof requestedWorkflowId!=='string'||!/^[a-f0-9-]{36}$/.test(requestedWorkflowId)))throw new Error('制作流程 ID 无效')
            const preview=previewId?get(previewId):undefined
             if(preview){const settings=await readSettings(root),issue=audioPreviewReuseIssue(preview,draft,subtitleProviderFor(draft,settings));if(issue)throw new Error(issue)}
             if(preview&&['script','terms'].includes(draft.stopAt))throw new Error('当前阶段无需复用配音')
             const materialId=isRecord(raw)?raw.materialPreviewJobId:undefined
             const subtitleId=isRecord(raw)?raw.subtitlePreviewJobId:undefined
             if (materialId!==undefined && (typeof materialId!=='string'||!materialId)) throw new Error('素材任务 ID 无效')
             if (subtitleId!==undefined && (typeof subtitleId!=='string'||!subtitleId)) throw new Error('字幕任务 ID 无效')
             const materialPreview=materialId?get(materialId):undefined
             const subtitlePreview=subtitleId?get(subtitleId):undefined
             if (draft.params.video_source==='cqai_video' && draft.stopAt!=='materials' && !materialPreview) throw new Error('请先生成 AI 视频素材')
             if (materialPreview){const issue=materialPreviewReuseIssue(materialPreview,draft);if(issue)throw new Error(issue)}
             if (subtitlePreview){const issue=subtitlePreviewReuseIssue(subtitlePreview,draft,materialId,previewId);if(issue)throw new Error(issue)}
             const id=randomUUID(),workflowId=workflowIdForNewJob(id,requestedWorkflowId as string|undefined,preview||materialPreview||subtitlePreview,jobs)
             for (const source of [materialPreview,subtitlePreview]) if(source && workflowIdForJob(source,jobs)!==workflowId) throw new Error('预览任务不属于当前制作流程')
             await verifyModels(draft,Boolean(materialPreview))
             const job:Job={...draft,id,workflowId,status:'draft',createdAt:now(),updatedAt:now(),progress:0,logs:[],uploads:{material:[]},artifacts:[]}
            try {
            if(preview){
              job.uploads.audio=await copyAudioPreview(join(root,'storage','tasks'),preview,id,
                preview.stopAt==='subtitle' && Boolean(draft.params.subtitle_enabled) && preview.subtitleProvider===subtitleProviderFor(draft,await readSettings(root)) && preview.params.subtitle_display_mode===draft.params.subtitle_display_mode)
              job.audioPreviewJobId=preview.id
              job.subtitleProvider=preview.subtitleProvider
            }
            if(materialPreview)job.materialPreviewJobId=materialPreview.id
            if(subtitlePreview){
              const sourceDir=safePath(join(root,'storage','tasks'),subtitlePreview.id),targetDir=join(root,'storage','tasks',id)
              await mkdir(targetDir,{recursive:true})
              for(const artifact of subtitlePreview.artifacts.filter(item=>item.kind==='subtitle')){
                if(!/^subtitle(?:-\d+)?\.srt$/.test(artifact.file))continue
                await copyFile(safePath(sourceDir,artifact.file),safePath(targetDir,artifact.file))
              }
              job.subtitlePreviewJobId=subtitlePreview.id
            }
            }catch(error){await rm(join(root,'storage','tasks',id),{recursive:true,force:true});throw error}
            jobs.set(id,job);await save(job);return json(res,201,job)
          }
        if(req.method==='POST' && action==='start')return json(res,200,await start(get(id)))
        if(req.method==='POST' && action==='cancel'){const job=get(id);if(job.status!=='running')throw new Error('任务没有运行');job.status='cancelled';job.error='用户已取消';videoAborts.get(id)?.abort();const child=children.get(id);if(child)terminate(child);await save(job);return json(res,200,job)}
         if(req.method==='POST' && action==='delete'){const job=get(id);if(job.status==='running')throw new Error('运行中的任务不可删除');if([...jobs.values()].some(other=>other.id!==id&&(other.materialPreviewJobId===id||other.subtitlePreviewJobId===id||other.audioPreviewJobId===id)))throw new Error('该任务仍被后续制作引用，请先删除后续任务');await removeTaskDirectory(jobsRoot,id);await removeTaskDirectory(join(root,'storage','tasks'),id);for(const file of job.uploads.material){const target=safePath(join(root,'storage','local_videos'),file);await rm(target,{force:true})}if(job.uploads.bgm){const target=safePath(join(root,'storage','bgm'),job.uploads.bgm);await rm(target,{force:true})}jobs.delete(id);return json(res,200,{ok:true})}
         if(req.method==='POST' && action==='subtitle'){
           const job=get(id),raw=await readJson(req)
           if(job.stopAt!=='subtitle'||job.status!=='completed'||!isRecord(raw))throw new Error('只能修改已完成的字幕预览')
           const index=raw.index,srt=raw.srt
           if(!Number.isInteger(index)||Number(index)<1||Number(index)>Number(job.params.video_count)||typeof srt!=='string')throw new Error('字幕参数无效')
           validateSubtitleSrt(srt,job.subtitleDurations?.[Number(index)-1]||0)
           const file=`subtitle-${index}.srt`,full=safePath(join(root,'storage','tasks',job.id),file)
           await writeFile(full,srt.trim()?srt.replace(/\r\n/g,'\n').trim()+'\n':'','utf8')
           job.artifacts=await artifactsFor(join(root,'storage','tasks',job.id));await save(job)
           return json(res,200,job)
         }
         if(req.method==='POST' && action==='upload'){
           const job=get(id);if(job.status!=='draft')throw new Error('只能给待开始任务上传素材')
           const kind=url.searchParams.get('kind') as UploadKind;const filename=url.searchParams.get('name')||'';const ext=extname(filename).toLowerCase()
           if(kind==='audio'&&job.audioPreviewJobId)throw new Error('已复用试听配音，不能再上传另一段旁白')
          if(!Object.hasOwn(EXTENSIONS,kind)||!EXTENSIONS[kind].includes(ext))throw new Error('文件类型不支持')
          const destRoot=kind==='material'?join(root,'storage','local_videos'):kind==='bgm'?join(root,'storage','bgm'):join(root,'storage','tasks',id)
          await mkdir(destRoot,{recursive:true});const stored=`${randomUUID()}${ext}`;const dest=safePath(destRoot,stored)
          let size=0;const limit=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>MAX_UPLOAD[kind]?new Error('素材文件过大'):null,chunk)}})
          try{await pipeline(req,limit,createWriteStream(dest+'.upload'));if(!size)throw new Error('文件为空');await rename(dest+'.upload',dest)}
          catch(e){await rm(dest+'.upload',{force:true});throw e}
          if(kind==='material')job.uploads.material.push(stored);else job.uploads[kind]=stored
          await save(job);return json(res,200,job)
        }
        if(req.method==='GET' && action==='artifact'){const job=get(id);const file=url.searchParams.get('file')||'';serveFile(req,res,artifactPath(root,job,file),url.searchParams.get('download')==='1');return}
        return json(res,404,{error:'接口不存在'})
      }catch(e){if(!res.headersSent&&!res.destroyed)json(res,400,{error:e instanceof Error?e.message:'操作失败'})}
    }})
    return async()=>{unregister();for(const abort of videoAborts.values())abort.abort();for(const child of children.values())terminate(child);for(const child of contentChildren)terminate(child)}
  },'短视频制作任务与本地服务')
}
function requireDirs(path: string): string[] {
  try{return requireDirsImpl(path)}catch{return []}
}
function requireDirsImpl(path: string): string[] {
  return readdirSync(path,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)
}
import { readdirSync } from 'node:fs'
async function readSettings(root:string):Promise<Settings>{
  try{return validateSettings(JSON.parse(await readFile(join(root,'settings.json'),'utf8')))}catch{return {...defaultSettings}}
}
export async function checkHealth(root:string,runtime:string):Promise<Record<string,unknown>>{
  return new Promise(resolveHealth=>{
    const child=spawn(pythonPath(root),[join(runtime,'bridge.py'),'health'],{windowsHide:true,cwd:runtime,env:{...process.env,MPT_DSH_DATA_ROOT:root,PYTHONUTF8:'1'},stdio:['ignore','pipe','pipe']})
    let output='';const timer=setTimeout(()=>terminate(child),45000)
    child.stdout.on('data',chunk=>{output+=chunk.toString()})
    child.on('error',()=>{})
    child.once('close',()=>{clearTimeout(timer);const line=output.split(/\r?\n/).find(x=>x.startsWith('MPT_EVENT '));let result:Record<string,unknown>;try{result=JSON.parse(line!.slice(10))}catch{result={python:false,ffmpeg:false,error:'运行环境尚未就绪，请点击安装 / 修复依赖'}};let locked=false;try{locked=readFileSync(join(root,'engine','.setup-lock'),'utf8').trim()===engineLockHash(runtime)}catch{};void probeUv().then(uv=>resolveHealth({...result,python:Boolean(result.python)&&locked,uv}))})
  })
}
async function probeUv():Promise<boolean>{
  try {await runCommand(uvExecutable(),['--version'],{timeout:10000});return true}catch{return false}
}
function engineLockHash(runtime:string):string {return createHash('sha256').update(readFileSync(join(runtime,'mpt','uv.lock'))).digest('hex')}
async function engineReady(root:string,runtime:string):Promise<boolean>{
  try {return readFileSync(join(root,'engine','.setup-lock'),'utf8').trim()===engineLockHash(runtime)&&Boolean((await checkHealth(root,runtime)).python)}catch{return false}
}
export async function setupEngine(root:string,runtime:string,uvHome:string,log:(line:string)=>void):Promise<void>{
  const engine=join(root,'engine');await mkdir(engine,{recursive:true})
  const selection=await python311(uvHome)
  await copyFile(join(runtime,'mpt','pyproject.toml'),join(engine,'pyproject.toml'))
  await copyFile(join(runtime,'mpt','uv.lock'),join(engine,'uv.lock'))
  await runCommand(uvExecutable(),['sync','--locked','--no-dev','--no-install-project','--python',selection.python,'--project',engine],
    {cwd:engine,env:{...pythonEnvironment(uvHome,selection),UV_PROJECT_ENVIRONMENT:join(engine,'.venv')},log})
  await writeFile(join(engine,'.setup-lock'),engineLockHash(runtime))
}
