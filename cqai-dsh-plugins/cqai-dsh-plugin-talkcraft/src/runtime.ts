import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { nodeEnvironment } from 'cqai-dsh-plugin-media-runtime'

export async function command(bin: string, args: string[], options: {cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number; maxOutput?: number} = {}): Promise<{code: number; output: string}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal})
    let output = ''
    const collect = (data: Buffer) => {output = (output + data.toString()).slice(-(options.maxOutput ?? 15000))}
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const timeout = options.timeout ? setTimeout(() => child.kill(), options.timeout) : undefined
    child.on('error', reject)
    child.on('close', code => {if (timeout) clearTimeout(timeout); resolve({code: code ?? -1, output})})
  })
}

export function pythonExecutable(upstream: string): string {
  return process.platform === 'win32' ? join(upstream, 'runtime', '.venv', 'Scripts', 'python.exe') : join(upstream, 'runtime', '.venv', 'bin', 'python')
}

export function ffmpegExecutable(upstream: string, name: 'ffmpeg' | 'ffprobe'): string {
  const directory = join(upstream, 'runtime', 'node_modules', '@remotion')
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const packages = existsSync(directory) ? readdirSync(directory).filter(item => matchesCompositorPackage(item, process.platform, process.arch)) : []
  const binary = packages.map(item => join(directory, item, `${name}${suffix}`)).find(existsSync)
  if (!binary) throw new Error(`锁定的 Remotion 依赖没有适用于 ${process.platform}/${process.arch} 的 ${name}`)
  return binary
}

export function matchesCompositorPackage(name: string, platform: string, arch: string): boolean {
  const base = `compositor-${platform}-${arch}`
  return name === base || name.startsWith(`${base}-`)
}

export function remotionBrowserExecutable(upstream: string): string | undefined {
  const root = join(upstream, 'runtime', 'node_modules', '.remotion', 'chrome-headless-shell')
  if (!existsSync(root)) return undefined
  const search = (dir: string, depth: number): string | undefined => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name)
      if (entry.isFile() && /^chrome-headless-shell(?:\.exe)?$/.test(basename(path)) && statSync(path).size > 1_000_000) return path
      if (entry.isDirectory() && depth > 0) {const nested = search(path, depth - 1);if (nested) return nested}
    }
    return undefined
  }
  return search(root, 3)
}

export function modelReady(directory: string): boolean {
  try {return statSync(join(directory, 'model.int8.onnx')).size === 775_861_420 && statSync(join(directory, 'tokens.txt')).size === 79_172}catch{return false}
}

export async function health(upstream: string, modelDir = join(upstream, 'runtime', 'models', 'firered')): Promise<Record<string, boolean | string>> {
  const runtime = join(upstream, 'runtime')
  const pythonBin = pythonExecutable(upstream)
  const ffmpegBin = (() => {try{return ffmpegExecutable(upstream,'ffmpeg')}catch{return undefined}})()
  const ffprobeBin = (() => {try{return ffmpegExecutable(upstream,'ffprobe')}catch{return undefined}})()
  const browserBin = remotionBrowserExecutable(upstream)
  const check = (bin: string | undefined, args: string[], env?: NodeJS.ProcessEnv) => bin ? command(bin,args,{env,timeout:15000}).then(value=>value.code===0).catch(()=>false) : Promise.resolve(false)
  const [node, python, edgeTts, ffmpeg, ffprobe, browser] = await Promise.all([
    check(process.execPath,['--version'],nodeEnvironment()),
    check(existsSync(pythonBin)?pythonBin:undefined,['-c','import numpy, soundfile, sherpa_onnx, pypinyin, zhconv, requests']),
    check(existsSync(pythonBin)?pythonBin:undefined,['-c','import edge_tts']),
    check(ffmpegBin,['-version']),
    check(ffprobeBin,['-version']),
    check(browserBin,['--version']),
  ])
  const deps = existsSync(join(runtime, 'node_modules', 'remotion', 'package.json')) && existsSync(join(runtime, 'node_modules', 'vite', 'package.json'))
  return {node, python, edgeTts, ffmpeg, ffprobe, remotion: deps, browser, asrModel: modelReady(modelDir), prepare: '请在设置中点击一键安装所有缺失依赖'}
}

export function linkJobRuntime(jobDir: string, upstream: string): void {
  const dependencies = join(upstream, 'runtime', 'node_modules')
  if (!existsSync(dependencies)) throw new Error('口播视频制作所需的 Remotion 依赖未安装，请在设置中一键安装')
  const remotion = join(jobDir, 'remotion')
  mkdirSync(remotion, {recursive: true})
  const manifest = join(remotion, 'package.json')
  if (!existsSync(manifest)) writeFileSync(manifest, '{"name":"talkcraft-job","private":true,"type":"module"}\n')
  const link = join(remotion, 'node_modules')
  if (!existsSync(link)) symlinkSync(dependencies, link, process.platform === 'win32' ? 'junction' : 'dir')
}
