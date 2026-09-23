/** Electron-main supervisor for the isolated MatrixMedia Publisher Worker. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DesktopLogger } from './desktop-logger.ts'
import { maskSecrets } from './mask-secrets.ts'
import {
  isPublisherWorkerMethod,
  type DesktopPublisherRuntime,
  type PublisherLocalVideo,
  type PublisherRuntimeStatus,
  type PublisherWorkerMethod,
} from './publisher-runtime.ts'

const PROTOCOL_VERSION = 2
const MAX_FRAME_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const HANDSHAKE_TIMEOUT_MS = 15_000
const IMPORT_TIMEOUT_MS = 5 * 60_000
const SUBMISSION_TIMEOUT_MS = 5 * 60_000
const WINDOW_TIMEOUT_MS = 60_000
const MAX_AUTOMATIC_RESTARTS = 3
const LOCAL_VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
// MP4 is the common upload format across the enabled video adapters.
const LOCAL_VIDEO_EXTENSIONS = new Set(['.mp4'])
const MAX_SELECTION_BYTES = 16 * 1024

interface SelectedVideo {
  file: string
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

type WorkerLauncher = (
  executable: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcessWithoutNullStreams

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  removeAbort(): void
}

interface WorkerErrorShape {
  code?: unknown
  message?: unknown
}

/** Injectable process and filesystem inputs used by the supervisor and its tests. */
export interface PublisherSupervisorOptions {
  platform: NodeJS.Platform
  resourcesPath: string
  userDataPath: string
  env?: NodeJS.ProcessEnv
  logger?: DesktopLogger
  launch?: WorkerLauncher
  restartDelayMs?: number
  requestTimeoutMs?: number
  handshakeTimeoutMs?: number
  importTimeoutMs?: number
  submissionTimeoutMs?: number
  developmentAppPath?: string
  pickLocalVideo?: () => Promise<string | undefined>
}

/** Resolve an override that may point at either an executable or a macOS app bundle. */
function executableFromOverride(value: string): string {
  const target = resolve(value)
  if (!target.endsWith('.app')) return target
  const appName = basename(target, '.app')
  return join(target, 'Contents', 'MacOS', appName)
}

/** Locate the helper without starting it. v1 intentionally has no Windows fallback. */
export function resolvePublisherWorker(options: Pick<PublisherSupervisorOptions, 'platform' | 'resourcesPath' | 'env' | 'developmentAppPath'>): string {
  if (options.platform !== 'darwin') return ''
  const override = String(options.env?.EBAO_PUBLISHER_WORKER ?? '').trim()
  if (override !== '') return executableFromOverride(override)
  const packaged = join(
    options.resourcesPath,
    'publisher',
    'MatrixMedia Publisher Worker.app',
    'Contents',
    'MacOS',
    'MatrixMedia Publisher Worker',
  )
  if (existsSync(packaged)) return packaged
  const developmentApp = options.developmentAppPath ?? fileURLToPath(new URL(
    '../../matrixmedia-publisher/build/publisher-worker/mac-universal/MatrixMedia Publisher Worker.app',
    import.meta.url,
  ))
  const development = executableFromOverride(developmentApp)
  return existsSync(development) ? development : packaged
}

/** Error retaining the Worker's stable code without leaking protocol payloads. */
export class PublisherWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PublisherWorkerError'
  }
}

/** One long-lived helper process with bounded NDJSON requests and crash recovery. */
export class PublisherSupervisor implements DesktopPublisherRuntime {
  private readonly platform: NodeJS.Platform
  private readonly executable: string
  private readonly dataRoot: string
  private readonly env: NodeJS.ProcessEnv
  private readonly launch: WorkerLauncher
  private readonly logger: DesktopLogger | undefined
  private readonly restartDelayMs: number
  private readonly requestTimeoutMs: number
  private readonly handshakeTimeoutMs: number
  private readonly importTimeoutMs: number
  private readonly submissionTimeoutMs: number
  private readonly pickLocalVideo: () => Promise<string | undefined>
  private readonly localVideosRoot: string
  private readonly localVideos = new Map<string, SelectedVideo>()
  private child: ChildProcessWithoutNullStreams | undefined
  private startTask: Promise<void> | undefined
  private sequence = 0
  private pendingText = ''
  private pendingLogText = ''
  private readonly pending = new Map<string, PendingRequest>()
  private stopping = false
  private restartCount = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: PublisherSupervisorOptions) {
    this.platform = options.platform
    this.executable = resolvePublisherWorker(options)
    this.dataRoot = join(options.userDataPath, 'publisher')
    this.localVideosRoot = join(this.dataRoot, 'local-videos')
    this.env = options.env ?? process.env
    this.launch = options.launch ?? ((executable, args, spawnOptions) =>
      spawn(executable, [...args], spawnOptions) as ChildProcessWithoutNullStreams)
    this.logger = options.logger
    this.restartDelayMs = options.restartDelayMs ?? 500
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
    this.importTimeoutMs = options.importTimeoutMs ?? IMPORT_TIMEOUT_MS
    this.submissionTimeoutMs = options.submissionTimeoutMs ?? SUBMISSION_TIMEOUT_MS
    this.pickLocalVideo = options.pickLocalVideo ?? (async () => undefined)
  }

  async selectLocalVideo(): Promise<PublisherLocalVideo | null> {
    const state = this.status()
    if (!state.supported) throw new PublisherWorkerError(state.reason ?? 'publisher-not-supported', state.message ?? '发布能力不可用')
    let chosen: string | undefined
    try { chosen = await this.pickLocalVideo() }
    catch { throw new PublisherWorkerError('file-picker-failed', '无法打开本地文件选择器，请重试') }
    if (!chosen) return null
    let file: string
    try { file = realpathSync(chosen) }
    catch { throw new PublisherWorkerError('invalid-video-file', '本地视频文件无法读取，请重新选择') }
    const fileName = basename(file)
    if (!LOCAL_VIDEO_EXTENSIONS.has(extname(fileName).toLowerCase())) {
      throw new PublisherWorkerError('invalid-video-file', '请选择 MP4 视频文件')
    }
    let stat: ReturnType<typeof statSync>
    try { stat = statSync(file) }
    catch { throw new PublisherWorkerError('invalid-video-file', '本地视频文件无法读取，请重新选择') }
    if (!stat.isFile() || stat.size < 1) throw new PublisherWorkerError('invalid-video-file', '本地视频文件无效或为空')
    const id = randomUUID()
    const selected = { file, size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino }
    this.persistLocalVideo(id, selected)
    this.localVideos.set(id, selected)
    return { id, fileName, title: fileName.slice(0, -extname(fileName).length).slice(0, 120), bytes: stat.size }
  }

  private persistLocalVideo(id: string, selected: SelectedVideo): void {
    let temporary: string | undefined
    try {
      mkdirSync(this.localVideosRoot, { recursive: true, mode: 0o700 })
      temporary = join(this.localVideosRoot, `.${randomUUID()}.tmp`)
      writeFileSync(temporary, JSON.stringify(selected), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, join(this.localVideosRoot, `${id}.json`))
    } catch {
      throw new PublisherWorkerError('video-selection-save-failed', '无法保存本地视频选择，请检查 e宝工坊数据目录')
    } finally {
      if (temporary) {
        try { rmSync(temporary, { force: true }) } catch { /* preserve the original error */ }
      }
    }
  }

  private loadLocalVideo(id: string): SelectedVideo | undefined {
    const cached = this.localVideos.get(id)
    if (cached) return cached
    const file = join(this.localVideosRoot, `${id}.json`)
    try {
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SELECTION_BYTES) return undefined
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
      const selected = value as Record<string, unknown>
      if (typeof selected.file !== 'string' || !isAbsolute(selected.file)
        || extname(selected.file).toLowerCase() !== '.mp4'
        || typeof selected.size !== 'number' || !Number.isSafeInteger(selected.size) || selected.size < 1
        || typeof selected.mtimeMs !== 'number' || !Number.isFinite(selected.mtimeMs)
        || typeof selected.dev !== 'number' || !Number.isSafeInteger(selected.dev)
        || typeof selected.ino !== 'number' || !Number.isSafeInteger(selected.ino)) return undefined
      const result = selected as unknown as SelectedVideo
      this.localVideos.set(id, result)
      return result
    } catch { return undefined }
  }

  private resolveLocalVideoSubmission(params: unknown): unknown {
    if (!params || typeof params !== 'object' || Array.isArray(params) || !('localVideoId' in params)) return params
    const input = params as Record<string, unknown>
    const id = input.localVideoId
    if (typeof id !== 'string' || !LOCAL_VIDEO_ID.test(id) || 'file' in input || 'workId' in input) {
      throw new PublisherWorkerError('invalid-video-selection', '本地视频选择无效，请重新选择')
    }
    const selected = this.loadLocalVideo(id)
    if (!selected) throw new PublisherWorkerError('video-selection-expired', '本地视频选择已失效，请重新选择文件')
    let stat: ReturnType<typeof statSync>
    try { stat = statSync(selected.file) }
    catch { throw new PublisherWorkerError('video-file-changed', '本地视频已移动或删除，请重新选择文件') }
    if (!stat.isFile() || stat.size !== selected.size || stat.mtimeMs !== selected.mtimeMs
      || stat.dev !== selected.dev || stat.ino !== selected.ino) {
      throw new PublisherWorkerError('video-file-changed', '本地视频已发生变化，请重新选择文件')
    }
    const { localVideoId: _localVideoId, ...rest } = input
    return { ...rest, workId: id, file: selected.file }
  }

  status(): PublisherRuntimeStatus {
    if (this.platform !== 'darwin') {
      return {
        supported: false,
        running: false,
        reason: 'publisher-not-supported',
        message: '多平台发布一期仅支持 macOS',
      }
    }
    if (this.executable === '' || !existsSync(this.executable)) {
      return {
        supported: false,
        running: false,
        reason: 'publisher-worker-missing',
        message: '未找到内置 Publisher Worker，请重新安装 e宝工坊',
      }
    }
    return { supported: true, running: this.child !== undefined }
  }

  async request<T = unknown>(method: PublisherWorkerMethod, params: unknown = {}, signal?: AbortSignal): Promise<T> {
    if (!isPublisherWorkerMethod(method)) throw new PublisherWorkerError('method-not-allowed', '不允许的发布操作')
    if (signal?.aborted) throw new PublisherWorkerError('request-cancelled', '发布操作已取消')
    await this.ensureStarted()
    const workerParams = method === 'submissions.create' ? this.resolveLocalVideoSubmission(params) : params
    const timeoutMs = method === 'accounts.importApply'
      ? this.importTimeoutMs
      : method === 'submissions.create'
        ? this.submissionTimeoutMs
      : method === 'accounts.openLogin' || method === 'accounts.openDashboard'
        ? Math.max(this.requestTimeoutMs, WINDOW_TIMEOUT_MS)
        : this.requestTimeoutMs
    const result = await this.call<T>(method, workerParams, signal, timeoutMs)
    this.restartCount = 0
    // Import swaps a Chromium profile on disk. Restart before another request
    // can acquire one of those partitions so Electron reloads the copied state.
    if (method === 'accounts.importApply') await this.restart()
    return result
  }

  /** Stop the helper after Host teardown; an active publish is never retried here. */
  async shutdown(): Promise<void> {
    this.stopping = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.child
    if (child === undefined) return
    try {
      await this.call('system.shutdown', {}, undefined, 2_000)
    } catch {
      child.kill()
    }
    await new Promise<void>((resolveExit) => {
      if (this.child !== child) { resolveExit(); return }
      const timer = setTimeout(() => { child.kill(); resolveExit() }, 2_000)
      child.once('exit', () => { clearTimeout(timer); resolveExit() })
    })
  }

  private async ensureStarted(): Promise<void> {
    const state = this.status()
    if (!state.supported) throw new PublisherWorkerError(state.reason ?? 'publisher-not-supported', state.message ?? '发布能力不可用')
    if (this.child !== undefined) return
    if (this.startTask !== undefined) return await this.startTask
    this.stopping = false
    const task = this.start().finally(() => {
      if (this.startTask === task) this.startTask = undefined
    })
    this.startTask = task
    await task
  }

  private async start(): Promise<void> {
    mkdirSync(this.dataRoot, { recursive: true })
    this.pendingText = ''
    this.pendingLogText = ''
    const child = this.launch(this.executable, ['--publisher-worker', '--data-dir', this.dataRoot], {
      cwd: this.dataRoot,
      env: { ...this.env, MATRIXMEDIA_DATA_DIR: join(this.dataRoot, 'matrix-data') },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', value => { this.receive(String(value)) })
    child.stderr.on('data', value => { this.receiveWorkerLog(String(value)) })
    child.once('error', error => { this.handleExit(child, error) })
    child.once('exit', (code, signal) => {
      this.handleExit(child, new PublisherWorkerError(
        'worker-exited',
        `Publisher Worker 已退出（${signal ?? String(code ?? 'unknown')}）`,
      ))
    })
    const handshake = await this.call<{
      protocolVersion?: unknown
      workerVersion?: unknown
      platforms?: unknown
      modes?: unknown
    }>('system.handshake', {}, undefined, this.handshakeTimeoutMs)
    if (handshake.protocolVersion !== PROTOCOL_VERSION
      || !Array.isArray(handshake.platforms)
      || !Array.isArray(handshake.modes)
      || !handshake.modes.includes('publish')
      || !handshake.modes.includes('draft')) {
      child.kill()
      throw new PublisherWorkerError('protocol-mismatch', 'Publisher Worker 协议版本不兼容')
    }
  }

  private call<T = unknown>(method: string, params: unknown, signal?: AbortSignal, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const child = this.child
    if (child === undefined || child.stdin.destroyed) {
      return Promise.reject(new PublisherWorkerError('worker-unavailable', 'Publisher Worker 尚未就绪'))
    }
    const id = String(++this.sequence)
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const cleanup = () => {
        const item = this.pending.get(id)
        if (item !== undefined) {
          clearTimeout(item.timer)
          item.removeAbort()
          this.pending.delete(id)
        }
      }
      const reject = (error: Error) => { cleanup(); rejectRequest(error) }
      const abort = () => reject(new PublisherWorkerError('request-cancelled', '发布操作已取消'))
      const timer = setTimeout(() => reject(method === 'submissions.create'
        ? new PublisherWorkerError('submission-uncertain', '提交响应超时，状态未确认。请先查看发布历史和平台后台，切勿立即重复提交')
        : new PublisherWorkerError('request-cancelled', '发布操作已超时')), timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        timer,
        removeAbort: () => signal?.removeEventListener('abort', abort),
        resolve: value => { cleanup(); resolveRequest(value as T) },
        reject,
      })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error !== null && error !== undefined) reject(error)
      })
    })
  }

  private receive(chunk: string): void {
    this.pendingText += chunk
    for (;;) {
      const newline = this.pendingText.indexOf('\n')
      if (newline < 0) {
        if (Buffer.byteLength(this.pendingText, 'utf8') > MAX_FRAME_BYTES) {
          this.protocolFailure('Publisher Worker 响应超过 1 MB')
        }
        return
      }
      const line = this.pendingText.slice(0, newline).trim()
      this.pendingText = this.pendingText.slice(newline + 1)
      if (line === '') continue
      if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
        this.protocolFailure('Publisher Worker 响应超过 1 MB')
        return
      }
      let frame: Record<string, unknown>
      try {
        const value: unknown = JSON.parse(line)
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
        frame = value as Record<string, unknown>
      } catch {
        this.protocolFailure('Publisher Worker 输出了非协议内容')
        return
      }
      const id = typeof frame.id === 'string' ? frame.id : ''
      const pending = this.pending.get(id)
      if (pending === undefined) continue
      if (frame.error !== null && typeof frame.error === 'object') {
        const detail = frame.error as WorkerErrorShape
        pending.reject(new PublisherWorkerError(
          typeof detail.code === 'string' ? detail.code : 'worker-error',
          typeof detail.message === 'string' ? detail.message : 'Publisher Worker 操作失败',
        ))
      } else {
        pending.resolve(frame.result)
      }
    }
  }

  private protocolFailure(message: string): void {
    const error = new PublisherWorkerError('invalid-worker-protocol', message)
    this.rejectPending(error)
    this.child?.kill()
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return
    this.child = undefined
    this.pendingText = ''
    this.flushWorkerLog()
    this.rejectPending(error)
    if (this.stopping || this.restartTimer !== undefined || this.restartCount >= MAX_AUTOMATIC_RESTARTS) return
    this.restartCount += 1
    this.logger?.error(`publisher-supervisor: ${maskSecrets(error.message)}; restarting (${String(this.restartCount)}/${String(MAX_AUTOMATIC_RESTARTS)})`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.ensureStarted().catch(cause => {
        this.logger?.error(`publisher-supervisor: restart failed: ${maskSecrets(cause instanceof Error ? cause.message : String(cause))}`)
      })
    }, this.restartDelayMs)
  }

  private rejectPending(error: Error): void {
    for (const item of [...this.pending.values()]) item.reject(error)
  }

  private receiveWorkerLog(value: string): void {
    this.pendingLogText += value
    for (;;) {
      const newline = this.pendingLogText.indexOf('\n')
      if (newline < 0) break
      const line = this.pendingLogText.slice(0, newline)
      this.pendingLogText = this.pendingLogText.slice(newline + 1)
      this.emitWorkerLog(line)
    }
    if (Buffer.byteLength(this.pendingLogText, 'utf8') > MAX_FRAME_BYTES) {
      const oversized = this.pendingLogText
      this.pendingLogText = ''
      this.emitWorkerLog(`${oversized.slice(0, MAX_FRAME_BYTES)} …[truncated]`)
    }
  }

  private flushWorkerLog(): void {
    const line = this.pendingLogText
    this.pendingLogText = ''
    this.emitWorkerLog(line)
  }

  private emitWorkerLog(value: string): void {
    const line = value.trim()
    if (line !== '') this.logger?.error(`publisher-worker: ${maskSecrets(line)}`)
  }

  private async restart(): Promise<void> {
    const child = this.child
    if (child !== undefined) {
      this.stopping = true
      try { await this.call('system.shutdown', {}, undefined, 2_000) } catch { child.kill() }
      if (this.child === child) child.kill()
      this.child = undefined
    }
    this.stopping = false
    this.restartCount = 0
    await this.ensureStarted()
  }
}
