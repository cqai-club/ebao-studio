import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SetupManager, makeNodeShim, nodeEnvironment, npmCli, python311, pythonEnvironment, run, uvEnvironment, uvExecutable, withPrivatePath } from 'cqai-dsh-plugin-media-runtime'
import { ffmpegExecutable, health, modelReady, pythonExecutable, remotionBrowserExecutable } from './runtime.ts'

const MODEL_SOURCE = 'https://huggingface.co/csukuangfj2/sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25/resolve/main/'
const MODEL_FILES = [
  ['model.int8.onnx', 775_861_420, 'ca3dbabd82170110cc0b343c2890866d449984bc9cd92b9a18371ff80a81bb99'],
  ['tokens.txt', 79_172, '1bc613de2112d257e61a349c3e72d1b1a9cf19c33d3ca954197ad2171e5ea07b'],
] as const
const OMIT = new Set(['node_modules', '.venv', 'models', 'dist', '.git', 'tsconfig.tsbuildinfo'])

export function snapshotPath(sourceRoot: string, home: string): string {
  const hash = createHash('sha256')
  for (const file of ['UPSTREAM.md', 'python-requirements.txt', 'upstream/runtime/remotion-lock.json',
    ...['render_shots.mjs','private_tools.py','frame_signature.py','freeze_probe.py','motion_check.py','preflight.py','qa_extract.py','sfx_check.py','tts_fishaudio.py','voice_trim.py'].map(name=>`upstream/scripts/${name}`)])
    hash.update(readFileSync(join(sourceRoot, file)))
  return join(home, 'runtime', `v1-${hash.digest('hex').slice(0, 12)}`)
}
export function snapshotReady(root: string): boolean {
  return existsSync(join(root, '.snapshot-ready')) && existsSync(join(root, 'upstream', 'SKILL.md')) && existsSync(join(root, 'scripts', 'tts_edge.py')) && existsSync(join(root, 'python-requirements.txt'))
}
export function prepareSnapshot(sourceRoot: string, target: string): void {
  if (snapshotReady(target)) return
  mkdirSync(target, {recursive: true})
  const copy = (part: string) => {
    const source = join(sourceRoot, part)
    const visit = (from: string, to: string): void => {
      if (OMIT.has(basename(from))) return
      const info = lstatSync(from)
      if (info.isSymbolicLink()) return
      if (info.isDirectory()) {
        mkdirSync(to, {recursive: true})
        for (const name of readdirSync(from)) visit(join(from, name), join(to, name))
      } else if (info.isFile()) {
        mkdirSync(dirname(to), {recursive: true})
        copyFileSync(from, to)
      }
    }
    visit(source, join(target, part))
  }
  copy('upstream')
  copy('scripts')
  copy('python-requirements.txt')
  // electron-builder omits package-lock.json inside dependencies; keep the locked
  // manifest under a packable name and restore npm's expected name privately.
  writeFileSync(join(target, 'upstream', 'runtime', 'package-lock.json'), readFileSync(join(sourceRoot, 'upstream', 'runtime', 'remotion-lock.json')))
  mkdirSync(join(target, 'upstream', 'workbench', 'public'), {recursive: true})
  writeFileSync(join(target, '.snapshot-ready'), '1\n')
}

async function probe(bin: string, args: string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
  try {await run(bin, args, {env, timeout: 15000});return true}catch{return false}
}
function browserPath(upstream: string): string | undefined {return remotionBrowserExecutable(upstream)}
export async function downloadModel(directory: string, log: (line: string) => void): Promise<void> {
  await mkdir(directory, {recursive: true})
  for (const [name, expectedSize, expectedHash] of MODEL_FILES) {
    const target = join(directory, name)
    if (existsSync(target) && statSync(target).size === expectedSize) {log(`${name} 已就绪，跳过`);continue}
    const temp = target + '.download'
    await rm(temp, {force: true})
    log(`下载 ${name}（模型至少约 700 MB，首次安装可能较久）`)
    try {
      const response = await fetch(MODEL_SOURCE + name, {signal: AbortSignal.timeout(30 * 60 * 1000)})
      if (!response.ok || !response.body) throw new Error(`${name} 下载失败：HTTP ${response.status}`)
      let bytes = 0, reported = 0
      const digest = createHash('sha256')
      const meter = new Transform({transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        digest.update(chunk)
        if (bytes - reported >= 50_000_000) {reported = bytes;log(`${name} 已下载 ${Math.round(bytes / 1_000_000)} MB`)}
        callback(null, chunk)
      }})
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(temp))
      if (bytes !== expectedSize || digest.digest('hex') !== expectedHash) throw new Error(`${name} 文件大小或校验值不符，下载可能中断`)
      await rename(temp, target)
      log(`${name} 下载完成`)
    } catch (error) {await rm(temp, {force: true});throw error}
  }
}

export function talkcraftSetup(sourceRoot: string, home: string, upstream: string, modelDir: string | (() => string)): SetupManager {
  const target = dirname(upstream)
  const runtime = join(upstream, 'runtime')
  const uvHome = join(dirname(home), 'media-tools')
  const nodeDir = join(home, 'bin')
  const venv = join(runtime, '.venv')
  const python = pythonExecutable(upstream)
  const selectedModel = () => typeof modelDir === 'string' ? modelDir : modelDir()
  return new SetupManager(() => [
    {id:'snapshot',label:'应用私有运行时',ready:async()=>snapshotReady(target),run:async log=>{prepareSnapshot(sourceRoot,target);log('已复制固定版本源码与配置')}},
    {id:'node',label:'内置 Node 与 npm',ready:async()=>{
      const shim=join(nodeDir,process.platform==='win32'?'node.cmd':'node')
      return existsSync(shim) && readFileSync(shim,'utf8').includes(process.execPath)
        && (await probe(process.execPath,['--version'],nodeEnvironment())) && existsSync(npmCli())
    },run:async log=>{makeNodeShim(nodeDir);await run(process.execPath,[npmCli(),'--version'],{env:nodeEnvironment(),log})}},
    {id:'python',label:'Python 3.11',ready:async()=>{try{await python311(uvHome);return true}catch{return false}},run:async log=>{await mkdir(uvHome,{recursive:true});await run(uvExecutable(),['python','install','3.11'],{env:uvEnvironment(uvHome),log})}},
    {id:'edgeTts',label:'Python、Edge TTS 与识别依赖',ready:async()=>{const h=await health(upstream,selectedModel());return h.python===true&&h.edgeTts===true},run:async log=>{
      const selection=await python311(uvHome)
      const environment=pythonEnvironment(uvHome,selection)
      await run(uvExecutable(),['venv','--allow-existing','--python',selection.python,venv],{env:environment,log})
      await run(uvExecutable(),['pip','install','--python',python,'-r',join(target,'python-requirements.txt')],{env:environment,log})
    }},
    {id:'remotion',label:'Remotion 锁定依赖',ready:async()=>{const h=await health(upstream,selectedModel());return h.remotion===true&&h.ffmpeg===true&&h.ffprobe===true},run:async log=>{
      const shim=makeNodeShim(nodeDir)
      await run(process.execPath,[npmCli(),'ci','--include=dev','--ignore-scripts','--no-audit','--no-fund','--no-progress'],
        {cwd:runtime,env:withPrivatePath([shim],nodeEnvironment({...process.env,npm_config_cache:join(home,'npm-cache')})),log})
      const deps=join(runtime,'node_modules')
      const wbDeps=join(upstream,'workbench','node_modules')
      if (!existsSync(wbDeps)) {
        const {symlinkSync}=await import('node:fs')
        symlinkSync(deps,wbDeps,process.platform==='win32'?'junction':'dir')
      }
    }},
    {id:'ffmpeg',label:'FFmpeg',ready:async()=>probe(ffmpegExecutable(upstream,'ffmpeg'),['-version']),run:async log=>{log('检查 Remotion 平台程序');await run(ffmpegExecutable(upstream,'ffmpeg'),['-version'],{log})}},
    {id:'ffprobe',label:'ffprobe',ready:async()=>probe(ffmpegExecutable(upstream,'ffprobe'),['-version']),run:async log=>{log('检查 Remotion 平台程序');await run(ffmpegExecutable(upstream,'ffprobe'),['-version'],{log})}},
    {id:'browser',label:'Remotion 浏览器',ready:async()=>{const bin=browserPath(upstream);return Boolean(bin && await probe(bin,['--version']))},run:async log=>{
      log('下载并准备 Remotion 浏览器，首次安装可能需要数百 MB')
      await run(process.execPath,[join(runtime,'node_modules','@remotion','cli','remotion-cli.js'),'browser','ensure'],
        {cwd:runtime,env:withPrivatePath([makeNodeShim(nodeDir),dirname(ffmpegExecutable(upstream,'ffmpeg'))],nodeEnvironment()),log})
    }},
    {id:'asrModel',label:'本地配音识别模型',ready:async()=>modelReady(selectedModel()),run:async log=>downloadModel(join(home,'models','firered'),log)},
  ])
}
