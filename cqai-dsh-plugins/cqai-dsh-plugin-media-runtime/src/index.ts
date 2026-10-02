import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, delimiter } from 'node:path'

export { COMMON_FFMPEG_VERSION, commonMediaPackage, commonToolsHome, commonFFmpegDirectory, sharedMediaTool, commonToolEnvironment, installCommonMediaTools, commonToolSteps, commonToolHealth, type CommonToolHealth } from './common-tools.ts'

export type SetupStatus = 'idle' | 'running' | 'completed' | 'failed'
export type StepStatus = 'pending' | 'running' | 'ready' | 'completed' | 'failed' | 'skipped'
export interface SetupItem {id: string; label: string; status: StepStatus; detail?: string}
export interface SetupState {status: SetupStatus; items: SetupItem[]; logs: string[]; updatedAt: number}
export interface SetupStep {id: string; label: string; ready(): Promise<boolean>; run(log: (line: string) => void): Promise<void>}

// Keep one queue even if the package is copied under both plugins in a bundle.
const host = globalThis as typeof globalThis & {__cqaiDshMediaInstallQueue?: Promise<void>}
function serialize(task: () => Promise<void>): Promise<void> {
  const next = (host.__cqaiDshMediaInstallQueue ?? Promise.resolve()).catch(() => {}).then(task)
  host.__cqaiDshMediaInstallQueue = next.catch(() => {})
  return next
}

/** Only fixed Host-defined steps can be run; the browser supplies no command or URL. */
export class SetupManager {
  private state: SetupState = {status: 'idle', items: [], logs: [], updatedAt: Date.now()}
  constructor(private readonly steps: () => SetupStep[]) {}
  snapshot(): SetupState {return {status: this.state.status, items: this.state.items.map(item => ({...item})), logs: [...this.state.logs], updatedAt: this.state.updatedAt}}
  start(): SetupState {
    if (this.state.status === 'running') return this.snapshot()
    this.state = {status: 'running', items: this.steps().map(({id, label}) => ({id, label, status: 'pending'})), logs: [], updatedAt: Date.now()}
    void serialize(() => this.execute()).catch(error => {
      this.addLog(error instanceof Error ? error.message : String(error))
      this.state.status = 'failed'; this.state.updatedAt = Date.now()
    })
    return this.snapshot()
  }
  private addLog(line: string): void {
    const cleaned = line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 350)
    if (cleaned) this.state.logs = [...this.state.logs, cleaned].slice(-50)
    this.state.updatedAt = Date.now()
  }
  private async execute(): Promise<void> {
    let failed = false
    for (const step of this.steps()) {
      const item = this.state.items.find(value => value.id === step.id)!
      try {
        if (await step.ready()) {item.status = 'ready'; this.addLog(`${step.label}：已就绪，跳过`); continue}
        item.status = 'running'; this.addLog(`${step.label}：开始`)
        await step.run(line => this.addLog(`${step.label}：${line}`))
        if (!await step.ready()) throw new Error('安装结束后仍未通过环境检查')
        item.status = 'completed'; this.addLog(`${step.label}：已完成`)
      } catch (error) {
        failed = true; item.status = 'failed'
        item.detail = error instanceof Error ? error.message : String(error)
        this.addLog(`${step.label}：${item.detail}`)
        break
      }
    }
    this.state.status = failed ? 'failed' : 'completed'
    this.state.updatedAt = Date.now()
  }
}

export interface RunOptions {cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; log?: (line: string) => void}
export async function run(bin: string, args: string[], options: RunOptions = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
    let tail = ''
    const output = (chunk: Buffer) => {
      tail += chunk.toString()
      const lines = tail.split(/\r?\n/); tail = lines.pop() ?? ''
      for (const line of lines) options.log?.(line)
      if (tail.length > 2000) {options.log?.(tail.slice(-350)); tail = ''}
    }
    child.stdout.on('data', output); child.stderr.on('data', output)
    const timer = options.timeout ? setTimeout(() => child.kill(), options.timeout) : undefined
    child.once('error', error => {if (timer) clearTimeout(timer); reject(error)})
    child.once('close', code => {
      if (timer) clearTimeout(timer)
      if (tail) options.log?.(tail)
      code === 0 ? resolve() : reject(new Error(`${bin.split(/[\\/]/).pop()} 退出码 ${code ?? 'unknown'}`))
    })
  })
}

const require = createRequire(import.meta.url)
function physical(path: string): string {return path.replace(/([\\/])app\.asar\1/u, '$1app.asar.unpacked$1')}
export function uvExecutable(): string {
  const name = `@dataiku/uv-${process.platform}-${process.arch}`
  const manifest = require.resolve(`${name}/package.json`)
  const binary = physical(join(dirname(manifest), 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'))
  if (!existsSync(binary)) throw new Error(`安装包缺少 ${name} 的 uv 可执行文件`)
  return binary
}
export function npmCli(): string {return join(dirname(require.resolve('npm')), 'bin', 'npm-cli.js')}
export function nodeEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return process.versions.electron ? {...base, ELECTRON_RUN_AS_NODE: '1'} : {...base}
}
export function uvEnvironment(home: string): NodeJS.ProcessEnv {
  return {...process.env, UV_CACHE_DIR: join(home, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(home, 'python'), UV_PYTHON_BIN_DIR: join(home, 'bin'), UV_PYTHON_PREFERENCE: 'only-managed'}
}
export interface Python311 {python: string; managed: boolean}
/** Reuse an already compatible interpreter; the venv itself remains app-private. */
export async function python311(home: string): Promise<Python311> {
  try {await run(uvExecutable(), ['python', 'find', '3.11', '--managed-python', '--no-python-downloads'], {env: uvEnvironment(home), timeout: 15000});return {python:'3.11',managed:true}} catch {/* try an installed interpreter */}
  const candidates = [process.env.MPT_PYTHON, process.platform === 'win32' ? 'python' : 'python3.11', process.platform === 'win32' ? undefined : 'python3'].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import sys; assert sys.version_info[:2] == (3, 11); print(sys._base_executable)'], {encoding:'utf8',timeout:10000,windowsHide:true})
    const executable = result.stdout?.trim()
    if (result.status === 0 && executable && existsSync(executable)) return {python:executable,managed:false}
  }
  throw new Error('未找到兼容的 Python 3.11，可点击安装下载到应用私有目录')
}
export function pythonEnvironment(home: string, selection: Python311): NodeJS.ProcessEnv {
  return {...uvEnvironment(home), UV_PYTHON_PREFERENCE: selection.managed ? 'only-managed' : 'only-system'}
}
export function makeNodeShim(directory: string): string {
  mkdirSync(directory, {recursive: true})
  const exe = process.execPath
  if (/[\r\n"%]/.test(exe)) throw new Error('Node 可执行文件路径无法用于应用私有命令')
  const windows = process.platform === 'win32'
  const target = join(directory, windows ? 'node.cmd' : 'node')
  const body = windows ? `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${exe}" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${exe.replaceAll("'", "'\\''")}' "$@"\n`
  if (!existsSync(target) || readFileSync(target, 'utf8') !== body) writeFileSync(target, body, {mode: 0o700})
  if (!windows) chmodSync(target, 0o700)
  return directory
}
export function withPrivatePath(paths: string[], base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = {...base}
  const inherited = base.PATH ?? base.Path ?? ''
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  env.PATH = [...paths, inherited].join(delimiter)
  return env
}
