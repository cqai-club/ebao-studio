import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { reportedExitCode } from './records.ts'
import type { AccountRow, HistoryRow, RuntimeStatus } from './protocol.ts'

/**
 * Desktop mounts the vendored MatrixMedia runtime beside `app.asar`, so
 * `process.resourcesPath/matrixmedia/matrixmedia.exe` is the packaged answer.
 * The portable/USB build exports an explicit override; development falls back
 * to the checkout's own `vendor/` tree. Nothing here hardcodes a drive letter.
 */

/** Name of the environment variable the desktop host uses for the runtime root. */
export const RUNTIME_ENV = 'EJIANBAO_MATRIXMEDIA'
const EXE = 'matrixmedia.exe'

/**
 * Cheapest argument vector that upstream dispatches as a CLI run. Upstream keys
 * CLI mode off a bare `cli` token, so anything else — including `--version` —
 * boots the whole GUI and never exits. The banner this prints still carries the
 * version, which is all the runtime card wants.
 */
export const VERSION_PROBE = ['cli', '--help'] as const

/** One resolved runtime location plus why it was chosen. */
export interface RuntimeLocation {
  /** Absolute path of `matrixmedia.exe`, or empty when nothing was found. */
  exe: string
  /** Directory to run the child process in. */
  dir: string
  /** Short explanation surfaced in the panel's runtime card. */
  source: string
}
/** Return the vendored development tree shipped in the repository, if present. */
function vendoredRuntime(): RuntimeLocation | undefined {
  const root = fileURLToPath(new URL('../../../vendor/matrixmedia/', import.meta.url))
  if (!existsSync(root)) return undefined
  const versions = readdirSync(root, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/u.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, {numeric: true}))
  for (const version of versions) {
    const dir = join(root, version, 'matrixmedia-win-x64')
    if (existsSync(join(dir, EXE))) return {exe: join(dir, EXE), dir, source: `vendor/matrixmedia/${version}`}
  }
  return undefined
}

/**
 * Pick the runtime for this process.
 * @param env - environment to read the override from.
 * @param resourcesPath - Electron's packaged resources directory, when packaged.
 * @returns the chosen location; `exe` is empty when the runtime is missing.
 */
export function resolveRuntime(env: NodeJS.ProcessEnv = process.env, resourcesPath?: string): RuntimeLocation {
  const override = env[RUNTIME_ENV]
  if (override) {
    const dir = resolve(override)
    const exe = dir.toLowerCase().endsWith('.exe') ? dir : join(dir, EXE)
    if (existsSync(exe)) return {exe, dir: dirname(exe), source: RUNTIME_ENV}
  }
  const packaged = resourcesPath ?? (process as NodeJS.Process & {resourcesPath?: string}).resourcesPath
  if (packaged) {
    const dir = join(packaged, 'matrixmedia')
    if (existsSync(join(dir, EXE))) return {exe: join(dir, EXE), dir, source: 'resources/matrixmedia'}
  }
  return vendoredRuntime() ?? {exe: '', dir: '', source: '未找到'}
}

/**
 * Resolve MatrixMedia's own data directory. Upstream resolves it through
 * Electron's `app.getPath('documents')`, which on Windows is the shell's
 * "Documents" folder rather than a literal `~/Documents`.
 * @param env - environment, so a redirected profile can be honoured.
 * @returns the absolute `<Documents>/MatrixMedia/data` path.
 */
export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE ?? homedir()
  const candidates = ['Documents', '文档', 'OneDrive/Documents', 'OneDrive/文档']
  let documents = join(home, 'Documents')
  for (const name of candidates) {
    const path = join(home, name)
    if (existsSync(path) && statSync(path).isDirectory()) {documents = path; break}
  }
  return join(documents, 'MatrixMedia', 'data')
}

/** Parse the version out of upstream's own banner (`0.11.3 -------`). */
export function parseVersion(stdout: string): string {
  const match = /^(\d+\.\d+\.\d+)\s/m.exec(stdout)
  return match?.[1] ?? ''
}

/** One finished child run: everything the verifier needs, and nothing more. */
export interface CliResult {
  /** Full captured stdout. */
  stdout: string
  /** Full captured stderr, kept separate because Chromium writes there. */
  stderr: string
  /** Upstream's own reported exit code, when the epilogue was printed. */
  code: number | undefined
  /** Whether the timeout killed the child before it finished. */
  timedOut: boolean
}

/**
 * How a runtime child is started. Injectable so a test can drive a scripted
 * child instead of a 68 MiB Electron binary, and so the spawn flags live in
 * exactly one place.
 */
export type Launcher = (exe: string, args: readonly string[], cwd: string) => ChildProcess

/** Start one hidden `matrixmedia.exe` with both streams piped. */
export const launchChild: Launcher = (exe, args, cwd) =>
  spawn(exe, [...args], {cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})

/** One supervised CLI child: the handle that kills it, and its eventual result. */
export interface CliRun {
  /** Handle a cancel path can kill; killing it ends the run. */
  child: {kill(): boolean}
  /** Settles when the epilogue is printed, the child exits, or the timeout fires. */
  result: Promise<CliResult>
}

/**
 * Long-lived wrapper around one vendored `matrixmedia.exe`.
 *
 * Upstream always prints `[startup] CLI 执行结束，退出码=N` before exiting, but
 * the Chromium it boots can hold the event loop open past that line, so waiting
 * for `close` would hang. Every run therefore resolves on the epilogue and only
 * falls back to `close`/timeout when the child dies without one.
 */
export class MatrixMedia {
  /** Resolved location; `exe` is empty when the runtime is missing. */
  readonly location: RuntimeLocation
  /** MatrixMedia's own data directory, where records are authoritative. */
  readonly dataDir: string
  /** How children are started; the default spawns the real executable. */
  readonly launch: Launcher
  /** Memoized banner; the panel polls `status`, and a probe boots Chromium. */
  #version: string | undefined

  constructor(env: NodeJS.ProcessEnv = process.env, resourcesPath?: string, launch: Launcher = launchChild) {
    this.location = resolveRuntime(env, resourcesPath)
    this.dataDir = dataDirectory(env)
    this.launch = launch
  }
  /**
   * Parsed upstream version, or empty when the runtime never ran. Measured 0.7 s
   * (it boots Chromium just to print a banner), and the panel polls `status`
   * every 2 s, so the answer is memoized and only ever probed once per process.
   * @returns the version triple from upstream's banner, or `''`.
   */
  async version(): Promise<string> {
    if (!this.location.exe) return ''
    this.#version ??= parseVersion((await this.run([...VERSION_PROBE], 20000)).stdout)
    return this.#version
  }

  /** The runtime card the panel renders. */
  async status(): Promise<RuntimeStatus> {
    const {exe, source} = this.location
    if (!exe) {
      return {ready: false, path: '', version: '', source, message: '未找到矩媒运行体，请重装易宝工坊或设置 EJIANBAO_MATRIXMEDIA', busy: false, dataDir: this.dataDir}
    }
    let version = ''
    try {version = await this.version()} catch { /* the banner is a nicety, not a gate */ }
    return {ready: true, path: exe, version, source, message: '', busy: false, dataDir: this.dataDir}
  }

  /**
   * Run one short command to completion.
   * @param args - arguments after the executable, e.g. `['cli','accounts','--json']`.
   * @param timeoutMs - hard ceiling; the child is killed once it elapses.
   */
  run(args: readonly string[], timeoutMs = 60000): Promise<CliResult> {
    return new Promise((settle, fail) => {
      if (!this.location.exe) {fail(new Error('矩媒运行体未就位')); return}
      const child = this.launch(this.location.exe, args, this.location.dir)
      collect(child, timeoutMs).then(settle, fail)
    })
  }

  /** `cli accounts --json`, decoded into rows. */
  async accounts(): Promise<AccountRow[]> {
    const result = await this.run(['cli', 'accounts', '--json'], 60000)
    return parseJsonArray(result.stdout) as AccountRow[]
  }

  /** `cli history --json`, decoded into rows. */
  async history(limit = 50): Promise<HistoryRow[]> {
    const result = await this.run(['cli', 'history', '--json', '-n', String(limit)], 60000)
    return parseJsonArray(result.stdout) as HistoryRow[]
  }
}

/**
 * Read the last top-level JSON array out of a CLI transcript. Upstream prints a
 * startup banner before the payload and the epilogue after it, so the payload is
 * what sits between them.
 * @param stdout - the captured transcript.
 * @returns the decoded array; empty when the payload was absent or malformed.
 */
export function parseJsonArray(stdout: string): unknown[] {
  const cleaned = stdout.replace(/\x1b\[[0-9;]*m/gu, '')
  const start = cleaned.indexOf('\n[')
  const end = cleaned.lastIndexOf(']\n')
  if (start < 0 || end < start) return []
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start + 1, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/** Capture a child's streams, resolving on the epilogue or on exit. */
export function collect(child: ChildProcess, timeoutMs: number, onLine?: (line: string) => void): Promise<CliResult> {
  return new Promise((settle, fail) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      settle({stdout, stderr, code: reportedExitCode(stdout), timedOut})
    }
    const timer = setTimeout(() => {timedOut = true; child.kill(); setTimeout(finish, 3000)}, timeoutMs)
    const take = (chunk: Buffer, sink: 'out' | 'err') => {
      const text = chunk.toString()
      if (sink === 'out') stdout += text
      else stderr += text
      if (onLine) for (const line of text.split(/\r?\n/u)) if (line.trim()) onLine(line)
      if (sink === 'out' && reportedExitCode(stdout) !== undefined) setTimeout(finish, 500)
    }
    child.stdout?.on('data', chunk => take(chunk as Buffer, 'out'))
    child.stderr?.on('data', chunk => take(chunk as Buffer, 'err'))
    child.once('error', error => {clearTimeout(timer); if (!done) {done = true; fail(error)}})
    child.once('close', finish)
  })
}
