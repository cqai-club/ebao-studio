import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@cqaiclub/dsn-account'
import { isChatModel, isImageGenerationModel, isVideoCatalogEntry, isVideoModel } from '@cqaiclub/dsn-account'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { API, audioPreviewReuseIssue, defaultParams, defaultSettings, needsText, stageRequirements, type Artifact, type ContentAction, type ContentResult, type Draft, type Job, type Settings, type Stage, type UploadKind } from './protocol.ts'
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
const SOURCES = new Set(['pexels', 'pixabay', 'coverr', 'openai_image', 'local'])
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
  return { textModel, imageModel, stopAt: stopAt as Stage, params }
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
  const contentType: Record<string,string> = {'.mp4':'video/mp4','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.srt':'text/plain; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'}
  res.writeHead(status, {'content-type': contentType[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': String(end-start+1), 'accept-ranges':'bytes', 'x-content-type-options':'nosniff', ...(status === 206 ? {'content-range':`bytes ${start}-${end}/${size}`} : {}), ...(download ? {'content-disposition':`attachment; filename="${basename(file)}"`} : {})})
  const stream = createReadStream(file, {start,end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
}
function physicalRuntime(): string {
  const location = fileURLToPath(new URL('../runtime/', import.meta.url))
  const unpacked = location.replace(/\.asar([\\/])/, '.asar.unpacked$1')
  return existsSync(join(unpacked, 'bridge.py')) ? unpacked : location
}
function pythonPath(dataRoot: string): string {
  const venv = join(dataRoot, 'engine', '.venv')
  const bundled = process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
  return existsSync(bundled) ? bundled : (process.env.MPT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'))
}
function terminate(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore'})
  else child.kill('SIGTERM')
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
    if(includeSubtitle){
      const subtitle=preview.artifacts.find(a=>a.kind==='subtitle')
      if(!subtitle||extname(subtitle.file).toLowerCase()!=='.srt')throw new Error('字幕文件类型无效')
      await copyArtifact(subtitle.file,'subtitle.srt')
    }
    return storedAudio
  }catch(error){await rm(targetDir,{recursive:true,force:true});throw error}
}

export function apply(ctx: Context): void {
  const root = join(resolveDshHome(), 'short-video')
  const jobsRoot = join(root, 'jobs')
  const runtime = physicalRuntime()
  const jobs = new Map<string, Job>()
  const children = new Map<string, ChildProcessWithoutNullStreams>()
  const contentChildren = new Set<ChildProcessWithoutNullStreams>()
  let contentReserved = false
  const writes = new Map<string, Promise<void>>()
  let setup: { status: 'idle' | 'running' | 'completed' | 'failed'; logs: string[] } = {status:'idle', logs:[]}
  let healthCache: Promise<Record<string,unknown>> | undefined
  let healthAt=0
  const health=()=>{
    if(!healthCache||Date.now()-healthAt>30_000){healthAt=Date.now();healthCache=checkHealth(root,runtime)}
    return healthCache
  }
  void mkdir(jobsRoot, {recursive:true})
  if (existsSync(jobsRoot)) {
    for (const dir of requireDirs(jobsRoot)) {
      if (!/^[a-f0-9-]{36}$/.test(dir)) continue
      try {
        const job = JSON.parse(readFileSync(join(jobsRoot, dir, 'job.json'), 'utf8')) as Job
        if (job.id !== dir) continue
        if (job.status === 'running') {job.status='interrupted'; job.error='应用关闭导致任务中断'; job.updatedAt=now()}
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
    const status=await ctx.dsnAccount.getStatus()
    if (status.state !== 'signed-in') return {signedIn:false,text:[],image:[],video:[],warning:'请先登录 CQAI Club'}
    const models=await ctx.dsnAccount.listModels()
    const defaults=await ctx.dsnAccount.getCategoryDefaultModels()
    return {
      signedIn:true, text:models.models.filter(isChatModel).map(m=>({id:m.id,name:m.name || m.id})),
      image:models.models.filter(isImageGenerationModel).map(m=>({id:m.id,name:m.name || m.id})),
      video:models.models.filter(isVideoCatalogEntry).map(m=>({id:m.id,name:m.name || m.id,callable:isVideoModel(m)})),
      warning:models.warning, defaultText:defaults.global.provider === 'cqaiclub' ? defaults.global.model : undefined,
      defaultImage:defaults.categories.image?.provider === 'cqaiclub' ? defaults.categories.image.model : undefined,
    }
  }
  const verifyModels = async (draft: Draft) => {
    const textNeeded = needsText(draft)
    const imageNeeded = stageRequirements(draft).imageModel
    if (!textNeeded && !imageNeeded) return
    const available=await catalog()
    if (textNeeded && !draft.textModel) throw new Error('请选择 CQAI Club 文本模型')
    if (textNeeded && !available.text.some(m=>m.id===draft.textModel)) throw new Error('所选文本模型不在当前 CQAI Club 账号中')
    if (imageNeeded && !draft.imageModel) throw new Error('请选择 CQAI Club 图片模型')
    if (imageNeeded && !available.image.some(m=>m.id===draft.imageModel)) throw new Error('所选图片模型不在当前 CQAI Club 账号中')
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
    const response=await ctx.dsnAccount.fetchAi('/v1/images/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    const result=await response.json() as Record<string,unknown>
    if(!response.ok)throw new Error(`CQAI Club 图片生成失败 (HTTP ${response.status}): ${JSON.stringify(result).slice(0,500)}`)
    return result
  }
  const run = async (job: Job) => {
    await verifyModels(job)
    const requirements = stageRequirements(job)
    if (requirements.materialUpload && !job.uploads.material.length) throw new Error('请上传本地视频或图片素材')
    if (requirements.backgroundMusicUpload && !job.uploads.bgm) throw new Error('请上传自定义背景音乐')
    const settings = await readSettings(root)
    if (job.audioPreviewJobId && job.params.subtitle_enabled && job.subtitleProvider !== settings.subtitle_provider) throw new Error('字幕引擎已改变，请重新生成配音和字幕')
    job.subtitleProvider = settings.subtitle_provider
    const requestFile=join(jobDir(job.id),'request.json')
    await writeFile(requestFile,JSON.stringify({id:job.id,params:job.params,stopAt:job.stopAt,textModel:job.textModel,imageModel:job.imageModel,uploads:job.uploads,settings,reuseSubtitle:!!job.audioPreviewJobId}), 'utf8')
    if(job.status==='cancelled')return
    job.status='running';job.progress=0;job.error=undefined;job.logs=[];await save(job)
    const child=spawn(pythonPath(root),[join(runtime,'bridge.py'),'run',requestFile],{windowsHide:true,cwd:runtime,env:{...process.env,MPT_DSH_DATA_ROOT:root,PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']})
    children.set(job.id,child)
    let stdout='', stderr='', gotResult=false, fatal=''
    child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();const lines=stderr.split(/\r?\n/);stderr=lines.pop()||'';for(const line of lines){if(line.trim()){job.logs.push(line.slice(0,1000));job.logs=job.logs.slice(-150)}}})
    child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();const lines=stdout.split(/\r?\n/);stdout=lines.pop()||'';for(const line of lines){if(!line.startsWith('MPT_EVENT '))continue;let event:Record<string,unknown>;try{event=JSON.parse(line.slice(10))}catch{continue}
      if(event.type==='llm_request' || event.type==='image_request'){
        const respond=(value:unknown,error?:string)=>{if(child.stdin.writable)child.stdin.write(JSON.stringify(error?{ok:false,error}:{ok:true,value})+'\n')}
        void (async()=>{try{if(event.type==='llm_request')respond(await llmCall(job.textModel,String(event.prompt)));else respond(await imageCall(job.imageModel,event.payload as Record<string,unknown>))}catch(e){respond(undefined,e instanceof Error?e.message:String(e))}})()
      }else if(event.type==='progress' && isRecord(event.state)){
        job.state=event.state;job.progress=Number(event.state.progress)||0;void save(job)
      }else if(event.type==='result' && isRecord(event.state)){
        const output=isRecord(event.result)?event.result:{}
        const script=typeof output.script==='string'?output.script:undefined
        const terms=Array.isArray(output.terms)&&output.terms.every(term=>typeof term==='string')?output.terms as string[]:undefined
        gotResult=true;job.state={...event.state,...(script?{script}:{}),...(terms?{terms}:{})};job.progress=Number(event.state.progress)||100
        if(event.state.state===1)job.status='completed';else{job.status='failed';job.error=String(event.state.error||'制作失败')}
      }else if(event.type==='fatal') fatal=String(event.error||'Python 执行失败')
    }})
    await new Promise<void>(done=>{child.once('error',error=>{fatal=error.message;done()});child.once('close',code=>{if(!gotResult && !fatal)fatal=`Python 进程退出: ${code}`;done()})})
    children.delete(job.id)
    if ((job.status as Job['status'])==='cancelled') {await save(job);return}
    if (!gotResult || (job.status as Job['status'])!=='completed') {job.status='failed';job.error=job.error||fatal||'制作失败'}
    job.artifacts=await artifactsFor(join(root,'storage','tasks',job.id))
    await save(job)
  }
  const start = async (job: Job) => {
    if (job.status === 'running') throw new Error('任务已在运行')
    if (children.size || [...jobs.values()].some(other=>other.status==='running')) throw new Error('一次只能制作一条短视频')
    await verifyModels(job)
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
        if(req.method==='GET' && action==='health')return json(res,200,{...(await health()),setup})
        if(req.method==='POST' && action==='setup'){if(setup.status==='running')throw new Error('正在安装运行环境');setup={status:'running',logs:[]};void setupEngine(root,runtime,(line)=>{setup.logs.push(line);setup.logs=setup.logs.slice(-30)}).then(()=>{setup.status='completed';healthCache=undefined}).catch(e=>{setup.status='failed';healthCache=undefined;setup.logs.push(e instanceof Error?e.message:String(e))});return json(res,202,setup)}
        if(req.method==='GET' && action==='jobs')return json(res,200,[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))
         if(req.method==='POST' && action==='jobs'){
           const raw=await readJson(req),draft=validateDraft(raw)
           const previewId=isRecord(raw)?raw.audioPreviewJobId:undefined
           if(previewId!==undefined && (typeof previewId!=='string'||!previewId))throw new Error('配音试听任务 ID 无效')
           const preview=previewId?get(previewId):undefined
           if(preview){const issue=audioPreviewReuseIssue(preview,draft,(await readSettings(root)).subtitle_provider);if(issue)throw new Error(issue)}
           if(preview&&['script','terms'].includes(draft.stopAt))throw new Error('当前阶段无需复用配音')
           await verifyModels(draft)
           const id=randomUUID(),job:Job={...draft,id,status:'draft',createdAt:now(),updatedAt:now(),progress:0,logs:[],uploads:{material:[]},artifacts:[]}
           if(preview){
             job.uploads.audio=await copyAudioPreview(join(root,'storage','tasks'),preview,id,Boolean(draft.params.subtitle_enabled))
             job.audioPreviewJobId=preview.id
             job.subtitleProvider=preview.subtitleProvider
           }
           jobs.set(id,job);await save(job);return json(res,201,job)
         }
        if(req.method==='POST' && action==='start')return json(res,200,await start(get(id)))
        if(req.method==='POST' && action==='cancel'){const job=get(id);if(job.status!=='running')throw new Error('任务没有运行');job.status='cancelled';job.error='用户已取消';const child=children.get(id);if(child)terminate(child);await save(job);return json(res,200,job)}
        if(req.method==='POST' && action==='delete'){const job=get(id);if(job.status==='running')throw new Error('运行中的任务不可删除');await removeTaskDirectory(jobsRoot,id);await removeTaskDirectory(join(root,'storage','tasks'),id);for(const file of job.uploads.material){const target=safePath(join(root,'storage','local_videos'),file);await rm(target,{force:true})}if(job.uploads.bgm){const target=safePath(join(root,'storage','bgm'),job.uploads.bgm);await rm(target,{force:true})}jobs.delete(id);return json(res,200,{ok:true})}
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
        if(req.method==='GET' && action==='artifact'){const job=get(id);const file=url.searchParams.get('file')||'';if(!job.artifacts.some(a=>a.file===file))throw new Error('文件不在任务产物中');const dir=join(root,'storage','tasks',id);const full=realpathSync(safePath(dir,file));if(!full.startsWith(realpathSync(dir)+sep))throw new Error('非法文件路径');serveFile(req,res,full,url.searchParams.get('download')==='1');return}
        return json(res,404,{error:'接口不存在'})
      }catch(e){if(!res.headersSent&&!res.destroyed)json(res,400,{error:e instanceof Error?e.message:'操作失败'})}
    }})
    return async()=>{unregister();for(const child of children.values())terminate(child);for(const child of contentChildren)terminate(child)}
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
async function checkHealth(root:string,runtime:string):Promise<Record<string,unknown>>{
  return new Promise(resolveHealth=>{
    const child=spawn(pythonPath(root),[join(runtime,'bridge.py'),'health'],{windowsHide:true,cwd:runtime,env:{...process.env,MPT_DSH_DATA_ROOT:root,PYTHONUTF8:'1'},stdio:['ignore','pipe','pipe']})
    let output='';const timer=setTimeout(()=>terminate(child),45000)
    child.stdout.on('data',chunk=>{output+=chunk.toString()})
    child.on('error',()=>{})
    child.once('close',()=>{clearTimeout(timer);const line=output.split(/\r?\n/).find(x=>x.startsWith('MPT_EVENT '));try{const v=JSON.parse(line!.slice(10));resolveHealth(v)}catch{resolveHealth({python:false,ffmpeg:false,error:'请安装 Python 3.11 与 uv，然后点击安装运行环境'})}})
  })
}
async function setupEngine(root:string,runtime:string,log:(line:string)=>void):Promise<void>{
  const engine=join(root,'engine');await mkdir(engine,{recursive:true})
  const cache=join(engine,'uv-cache'),temp=join(engine,'temp');await mkdir(cache,{recursive:true});await mkdir(temp,{recursive:true})
  await copyFile(join(runtime,'mpt','pyproject.toml'),join(engine,'pyproject.toml'))
  await copyFile(join(runtime,'mpt','uv.lock'),join(engine,'uv.lock'))
  await new Promise<void>((ok,fail)=>{
    const child=spawn('uv',['sync','--locked','--no-dev','--no-install-project','--project',engine],{windowsHide:true,cwd:engine,env:{...process.env,UV_PROJECT_ENVIRONMENT:join(engine,'.venv'),UV_CACHE_DIR:cache,TEMP:temp,TMP:temp},stdio:['ignore','pipe','pipe']})
    let tail='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{tail+=chunk.toString();const lines=tail.split(/\r?\n/);tail=lines.pop()||'';for(const line of lines)log(line.slice(0,300))})
    child.once('error',fail);child.once('close',code=>code===0?ok():fail(new Error(`uv 安装失败 (exit ${code})`)))
  })
}
