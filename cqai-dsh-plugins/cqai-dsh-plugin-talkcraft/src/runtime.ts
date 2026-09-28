import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

export async function health(upstream: string): Promise<Record<string, boolean | string>> {
  const runtime = join(upstream, 'runtime')
  const pythonBin = pythonExecutable(upstream)
  const localPython = pythonBin !== 'python'
  const [node, python, edgeTts, ffmpeg, ffprobe] = await Promise.all([
    command('node', ['--version']).catch(() => ({code: -1, output: ''})),
    localPython ? command(pythonBin, ['-c', 'import numpy, soundfile, sherpa_onnx, pypinyin, zhconv, requests']).catch(() => ({code: -1, output: ''})) : Promise.resolve({code: -1, output: ''}),
    localPython ? command(pythonBin, ['-c', 'import edge_tts']).catch(() => ({code: -1, output: ''})) : Promise.resolve({code: -1, output: ''}),
    command('ffmpeg', ['-version']).catch(() => ({code: -1, output: ''})),
    command('ffprobe', ['-version']).catch(() => ({code: -1, output: ''})),
  ])
  const deps = existsSync(join(runtime, 'node_modules', 'remotion', 'package.json')) && existsSync(join(runtime, 'node_modules', 'vite', 'package.json'))
  const browser = existsSync(join(runtime, 'node_modules', '.remotion', 'chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))
  const modelDir = process.env.FIRERED_ASR_MODEL_DIR ?? join(runtime, 'models', 'firered')
  const model = existsSync(join(modelDir, 'model.int8.onnx')) && existsSync(join(modelDir, 'tokens.txt'))
  return {node: node.code === 0, python: python.code === 0, edgeTts: edgeTts.code === 0, ffmpeg: ffmpeg.code === 0, ffprobe: ffprobe.code === 0, remotion: deps, browser, asrModel: model,
    prepare: 'corepack yarn workspace cqai-dsh-plugin-talkcraft runtime:prepare'}
}

export function pythonExecutable(upstream: string): string {
  const binary = process.platform === 'win32' ? join(upstream, 'runtime', '.venv', 'Scripts', 'python.exe') : join(upstream, 'runtime', '.venv', 'bin', 'python')
  return existsSync(binary) ? binary : 'python'
}

export function linkJobRuntime(jobDir: string, upstream: string): void {
  const dependencies = join(upstream, 'runtime', 'node_modules')
  if (!existsSync(dependencies)) throw new Error('口播视频制作所需的 Remotion 依赖未安装，请先执行 runtime:prepare')
  const remotion = join(jobDir, 'remotion')
  mkdirSync(remotion, {recursive: true})
  const manifest = join(remotion, 'package.json')
  if (!existsSync(manifest)) writeFileSync(manifest, '{"name":"talkcraft-job","private":true,"type":"module"}\n')
  const link = join(remotion, 'node_modules')
  if (!existsSync(link)) symlinkSync(dependencies, link, 'junction')
}
