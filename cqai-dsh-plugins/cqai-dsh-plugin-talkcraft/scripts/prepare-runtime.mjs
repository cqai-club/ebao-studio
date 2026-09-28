import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { rename } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = path.join(root, 'upstream', 'runtime')
const wb = path.join(root, 'upstream', 'workbench')
const run = (bin, args, cwd) => {
  const result = spawnSync(bin, args, {cwd, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/.test(bin)})
  if (result.status !== 0) throw new Error(`${bin} exited with ${result.status}`)
}
const modelOnly = process.argv.includes('--model-only')
if (!modelOnly) run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], runtime)
const deps = path.join(runtime, 'node_modules')
const wbDeps = path.join(wb, 'node_modules')
if (!existsSync(wbDeps)) symlinkSync(deps, wbDeps, process.platform === 'win32' ? 'junction' : 'dir')
if (!modelOnly) run(process.platform === 'win32' ? path.join(deps, '.bin', 'remotion.cmd') : path.join(deps, '.bin', 'remotion'), ['browser', 'ensure'], runtime)
const venv = path.join(runtime, '.venv')
if (!modelOnly && !existsSync(venv)) run('python', ['-m', 'venv', venv], runtime)
const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python')
if (!modelOnly) run(python, ['-m', 'pip', 'install', '-r', path.join(root, 'python-requirements.txt')], runtime)
mkdirSync(path.join(wb, 'public'), {recursive: true})
const modelDir = path.join(runtime, 'models', 'firered')
if (process.argv.includes('--with-asr-model') || modelOnly) {
  mkdirSync(modelDir, {recursive: true})
  const base = 'https://huggingface.co/csukuangfj2/sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25/resolve/main/'
  for (const [name, minimum] of [['model.int8.onnx', 700_000_000], ['tokens.txt', 1000]]) {
    const target = path.join(modelDir, name)
    if (existsSync(target)) continue
    const response = await fetch(base + name, {signal: AbortSignal.timeout(30 * 60 * 1000)})
    if (!response.ok || !response.body) throw new Error(`ASR ${name} download failed: HTTP ${response.status}`)
    let bytes = 0
    const temp = target + '.download'
    const input = Readable.fromWeb(response.body)
    input.on('data', chunk => {bytes += chunk.length})
    await pipeline(input, createWriteStream(temp))
    if (bytes < minimum) throw new Error(`ASR ${name} looks incomplete (${bytes} bytes)`)
    await rename(temp, target)
  }
}
console.log(`TalkCraft runtime prepared. ASR model: ${existsSync(path.join(modelDir, 'model.int8.onnx')) ? 'ready' : 'missing; rerun with --with-asr-model'}`)
