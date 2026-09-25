import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PublisherSupervisor,
  PublisherWorkerError,
  resolvePublisherWorker,
} from '../src/publisher-supervisor.ts'

interface Frame { id: string; method: string; params: unknown }

class FakeWorker extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  private pending = ''
  killed = false

  constructor(private readonly onFrame: (frame: Frame, worker: FakeWorker) => void) {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', value => {
      this.pending += String(value)
      for (;;) {
        const newline = this.pending.indexOf('\n')
        if (newline < 0) return
        const line = this.pending.slice(0, newline)
        this.pending = this.pending.slice(newline + 1)
        if (line.trim()) this.onFrame(JSON.parse(line) as Frame, this)
      }
    })
  }

  reply(id: string, result: unknown, fragments = false): void {
    const encoded = `${JSON.stringify({ id, result })}\n`
    if (!fragments) { this.stdout.write(encoded); return }
    const middle = Math.floor(encoded.length / 2)
    this.stdout.write(encoded.slice(0, 3))
    this.stdout.write(encoded.slice(3, middle))
    this.stdout.write(encoded.slice(middle))
  }

  fail(id: string, code: string, message: string): void {
    this.stdout.write(`${JSON.stringify({ id, error: { code, message } })}\n`)
  }

  exit(code = 1): void {
    queueMicrotask(() => this.emit('exit', code, null))
  }

  kill(): boolean {
    if (this.killed) return false
    this.killed = true
    this.exit(9)
    return true
  }
}

const roots: string[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(handler: (frame: Frame, worker: FakeWorker) => void, overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'publisher-supervisor-'))
  roots.push(root)
  const executable = join(root, 'worker')
  writeFileSync(executable, '')
  const workers: FakeWorker[] = []
  const supervisor = new PublisherSupervisor({
    platform: 'darwin', resourcesPath: root, userDataPath: root,
    env: { EBAO_PUBLISHER_WORKER: executable },
    launch: () => {
      const worker = new FakeWorker(handler)
      workers.push(worker)
      return worker as never
    },
    restartDelayMs: 1,
    requestTimeoutMs: 30,
    handshakeTimeoutMs: 30,
    ...overrides,
  })
  return { supervisor, workers, executable }
}

function handshake(frame: Frame, worker: FakeWorker, fragments = false): boolean {
  if (frame.method !== 'system.handshake') return false
  worker.reply(frame.id, {
    protocolVersion: 2, workerVersion: 'test',
    platforms: ['dy', 'sph', 'xhs', 'blbl', 'ks', 'tt', 'bjh', 'fqsp'],
    modes: ['publish', 'draft'],
  }, fragments)
  return true
}

describe('PublisherSupervisor', () => {
  it('uses the Electron process environment for a Worker override', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-env-override-'))
    roots.push(root)
    const executable = join(root, 'worker')
    writeFileSync(executable, '')
    vi.stubEnv('EBAO_PUBLISHER_WORKER', executable)
    expect(resolvePublisherWorker({ platform: 'darwin', resourcesPath: root })).toBe(executable)
  })

  it('identifies a missing Worker override instead of suggesting a reinstall', () => {
    const supervisor = new PublisherSupervisor({
      platform: 'darwin',
      resourcesPath: '/nonexistent',
      userDataPath: '/tmp',
      env: { EBAO_PUBLISHER_WORKER: '/nonexistent/worker' },
    })
    expect(supervisor.status()).toMatchObject({
      supported: false,
      reason: 'publisher-worker-missing',
      message: '指定的 Publisher Worker 不存在，请检查 EBAO_PUBLISHER_WORKER 并重启 e宝工坊',
    })
  })

  it('frames split NDJSON responses and redacts Worker stderr', async () => {
    const logs: string[] = []
    const { supervisor, workers } = fixture((frame, worker) => {
      if (handshake(frame, worker, true)) return
      if (frame.method === 'accounts.list') worker.reply(frame.id, [{ id: 'account' }], true)
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    }, { logger: { error: (message: string) => logs.push(message), errorCause: () => {} } })
    expect(await supervisor.request('accounts.list')).toEqual([{ id: 'account' }])
    workers[0]!.stderr.write('Cookie: session=top-')
    workers[0]!.stderr.write('secret http://alice:password@proxy.example.test:8080\n')
    await new Promise(resolve => setImmediate(resolve))
    expect(logs.join('\n')).toContain('Cookie: ****')
    expect(logs.join('\n')).not.toContain('top-secret')
    expect(logs.join('\n')).not.toContain('alice')
    expect(logs.join('\n')).not.toContain('password')
    await supervisor.shutdown()
  })

  it('propagates stable Worker errors without exposing stdout logs', async () => {
    const { supervisor } = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'accounts.openLogin') worker.fail(frame.id, 'account-busy', '当前账号正在提交内容')
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    })
    await expect(supervisor.request('accounts.openLogin', { id: 'x' }))
      .rejects.toMatchObject({ code: 'account-busy', message: '当前账号正在提交内容' })
    await supervisor.shutdown()
  })

  it('times out an unanswered request and restarts after a crash', async () => {
    let launch = 0
    const { supervisor, workers } = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'accounts.list' && launch === 1) worker.exit(7)
      else if (frame.method === 'accounts.list') worker.reply(frame.id, [])
      if (frame.method === 'accounts.checkLogin') return
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    }, {
      launch: () => {
        launch += 1
        const worker = new FakeWorker((frame, child) => {
          if (handshake(frame, child)) return
          if (frame.method === 'accounts.list' && launch === 1) child.exit(7)
          else if (frame.method === 'accounts.list') child.reply(frame.id, [])
          if (frame.method === 'accounts.checkLogin') return
          if (frame.method === 'system.shutdown') { child.reply(frame.id, { ok: true }); child.exit(0) }
        })
        workers.push(worker)
        return worker as never
      },
    })
    await expect(supervisor.request('accounts.list')).rejects.toBeInstanceOf(PublisherWorkerError)
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(launch).toBe(2)
    await expect(supervisor.request('accounts.checkLogin', { id: 'x' })).rejects.toMatchObject({ code: 'request-cancelled' })
    await supervisor.shutdown()
  })

  it('rejects a request and restarts when the Worker stdin pipe reports EPIPE', async () => {
    let disconnected = false
    const { supervisor, workers } = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'accounts.list') {
        if (!disconnected) {
          disconnected = true
          worker.stdin.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
        } else worker.reply(frame.id, [{ id: 'account' }])
      }
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    })
    await expect(supervisor.request('accounts.list')).rejects.toMatchObject({ code: 'worker-disconnected' })
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(workers).toHaveLength(2)
    await expect(supervisor.request('accounts.list')).resolves.toEqual([{ id: 'account' }])
    await supervisor.shutdown()
  })

  it('does not restart when the Worker stdin pipe reports EPIPE during shutdown', async () => {
    const { supervisor, workers } = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'accounts.list') worker.reply(frame.id, [])
      if (frame.method === 'system.shutdown') {
        worker.stdin.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
      }
    })
    await supervisor.request('accounts.list')
    await supervisor.shutdown()
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(workers).toHaveLength(1)
    expect(supervisor.status().running).toBe(false)
  })

  it('gives profile imports a dedicated long timeout and restarts after the copy', async () => {
    let launches = 0
    const { supervisor } = fixture((frame, worker) => {
      if (handshake(frame, worker)) { launches += 1; return }
      if (frame.method === 'accounts.importApply') {
        setTimeout(() => worker.reply(frame.id, { imported: [] }), 20)
      }
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    }, { requestTimeoutMs: 5, importTimeoutMs: 100 })
    await expect(supervisor.request('accounts.importApply')).resolves.toEqual({ imported: [] })
    expect(launches).toBe(2)
    await supervisor.shutdown()
  })

  it('treats an unanswered submission as uncertain rather than safe to retry', async () => {
    const { supervisor } = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    }, { requestTimeoutMs: 5, submissionTimeoutMs: 30 })
    await expect(supervisor.request('submissions.create', { workId: 'test' }))
      .rejects.toMatchObject({ code: 'submission-uncertain', message: expect.stringContaining('切勿立即重复提交') })
    await supervisor.shutdown()
  })

  it('keeps native-picked paths in main and revalidates them before submission', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'publisher-local-video-'))
    roots.push(directory)
    const file = join(directory, '片段.mp4')
    writeFileSync(file, 'sample-video')
    let forwarded: Record<string, unknown> | undefined
    const { supervisor } = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'submissions.create') {
        forwarded = frame.params as Record<string, unknown>
        worker.reply(frame.id, { accepted: true })
      }
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    }, { pickLocalVideo: async () => file })
    const selection = await supervisor.selectLocalVideo()
    expect(selection).toMatchObject({ fileName: '片段.mp4', title: '片段', bytes: 12 })
    expect(selection).not.toHaveProperty('file')
    expect(selection).not.toHaveProperty('path')
    await expect(supervisor.request('submissions.create', {
      contentType: 'video', localVideoId: selection!.id, title: '片段', mode: 'draft', accountIds: ['account'],
    })).resolves.toEqual({ accepted: true })
    expect(forwarded).toMatchObject({ file: realpathSync(file), workId: selection!.id, title: '片段' })
    expect(forwarded).not.toHaveProperty('localVideoId')
    writeFileSync(file, 'changed-video-content')
    await expect(supervisor.request('submissions.create', {
      contentType: 'video', localVideoId: selection!.id, title: '片段', mode: 'draft', accountIds: ['account'],
    })).rejects.toMatchObject({ code: 'video-file-changed' })
    await expect(supervisor.request('submissions.create', {
      contentType: 'video', localVideoId: selection!.id, file: '/tmp/attacker.mp4', title: '片段', mode: 'draft', accountIds: ['account'],
    })).rejects.toMatchObject({ code: 'invalid-video-selection' })
    await supervisor.shutdown()
  })

  it('restores an opaque native file selection after restarting e宝', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'publisher-restart-video-'))
    roots.push(directory)
    const file = join(directory, '片段.mp4')
    writeFileSync(file, 'sample-video')
    const first = fixture(() => { throw new Error('must not start') }, {
      userDataPath: directory, pickLocalVideo: async () => file,
    })
    const selection = await first.supervisor.selectLocalVideo()
    expect(selection).not.toHaveProperty('file')
    const registry = join(directory, 'publisher', 'local-videos', `${selection!.id}.json`)
    expect(statSync(registry).mode & 0o077).toBe(0)
    let forwarded: Record<string, unknown> | undefined
    const second = fixture((frame, worker) => {
      if (handshake(frame, worker)) return
      if (frame.method === 'submissions.create') {
        forwarded = frame.params as Record<string, unknown>
        worker.reply(frame.id, { accepted: true })
      }
      if (frame.method === 'system.shutdown') { worker.reply(frame.id, { ok: true }); worker.exit(0) }
    }, { userDataPath: directory })
    await expect(second.supervisor.request('submissions.create', {
      contentType: 'video', localVideoId: selection!.id, title: '片段', mode: 'draft', accountIds: ['account'],
    })).resolves.toEqual({ accepted: true })
    expect(forwarded).toMatchObject({ file: realpathSync(file), workId: selection!.id })
    writeFileSync(file, 'changed-video-content')
    await expect(second.supervisor.request('submissions.create', {
      contentType: 'video', localVideoId: selection!.id, title: '片段', mode: 'draft', accountIds: ['account'],
    })).rejects.toMatchObject({ code: 'video-file-changed' })
    await second.supervisor.shutdown()
  })

  it('reads bounded preview chunks from the selected file across restarts and rejects changed files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'publisher-preview-video-'))
    roots.push(directory)
    const file = join(directory, '片段.mp4')
    writeFileSync(file, 'sample-video')
    const first = fixture(() => { throw new Error('preview must not start the Worker') }, {
      userDataPath: directory, pickLocalVideo: async () => file,
    })
    const selection = await first.supervisor.selectLocalVideo()
    const id = selection!.id
    expect(await first.supervisor.readLocalVideoChunk(id, 0, 0)).toEqual({ ok: true, bytes: 12, dataBase64: '' })
    const chunk = await first.supervisor.readLocalVideoChunk(id, 4, 5)
    expect(chunk).toEqual({ ok: true, bytes: 12, dataBase64: Buffer.from('le-vi').toString('base64') })
    expect(chunk).not.toHaveProperty('file')
    expect(chunk).not.toHaveProperty('path')
    expect(first.workers).toHaveLength(0)

    const second = fixture(() => { throw new Error('preview must not start the Worker') }, { userDataPath: directory })
    expect(await second.supervisor.readLocalVideoChunk(id, 8, 4)).toEqual({
      ok: true, bytes: 12, dataBase64: Buffer.from('ideo').toString('base64'),
    })
    expect(await second.supervisor.readLocalVideoChunk('not-an-id', 0, 1)).toMatchObject({ ok: false, code: 'invalid-video-selection' })
    expect(await second.supervisor.readLocalVideoChunk(id, -1, 1)).toMatchObject({ ok: false, code: 'invalid-video-selection' })
    expect(await second.supervisor.readLocalVideoChunk(id, 13, 1)).toMatchObject({ ok: false, code: 'invalid-video-selection' })
    expect(await second.supervisor.readLocalVideoChunk(id, 0, 1024 * 1024 + 1)).toMatchObject({ ok: false, code: 'invalid-video-selection' })
    expect(await second.supervisor.readLocalVideoChunk('44444444-4444-4444-8444-444444444444', 0, 0))
      .toMatchObject({ ok: false, code: 'video-selection-expired' })
    const abort = new AbortController()
    abort.abort()
    await expect(second.supervisor.readLocalVideoChunk(id, 0, 1, abort.signal))
      .rejects.toMatchObject({ code: 'request-cancelled' })

    const original = statSync(file)
    const replacement = join(directory, 'replacement.mp4')
    writeFileSync(replacement, 'other1-video')
    utimesSync(replacement, original.atime, original.mtime)
    renameSync(replacement, file)
    expect(await second.supervisor.readLocalVideoChunk(id, 0, 4))
      .toMatchObject({ ok: false, code: 'video-file-changed' })
    expect(second.workers).toHaveLength(0)
  })

  it('treats a cancelled picker as no change and refuses non-MP4 files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'publisher-local-video-'))
    roots.push(directory)
    const file = join(directory, 'article.txt')
    writeFileSync(file, 'not a video')
    const cancelled = fixture(() => { throw new Error('must not start') }, { pickLocalVideo: async () => undefined })
    await expect(cancelled.supervisor.selectLocalVideo()).resolves.toBeNull()
    expect(cancelled.workers).toHaveLength(0)
    const invalid = fixture(() => { throw new Error('must not start') }, { pickLocalVideo: async () => file })
    await expect(invalid.supervisor.selectLocalVideo()).rejects.toMatchObject({ code: 'invalid-video-file' })
    expect(invalid.workers).toHaveLength(0)
    const failed = fixture(() => { throw new Error('must not start') }, { pickLocalVideo: async () => { throw new Error(file) } })
    await expect(failed.supervisor.selectLocalVideo()).rejects.toMatchObject({ code: 'file-picker-failed' })
    expect(failed.workers).toHaveLength(0)
  })

  it('reports unsupported systems without launching a legacy fallback', async () => {
    expect(resolvePublisherWorker({ platform: 'win32', resourcesPath: '/tmp', env: {} })).toBe('')
    const supervisor = new PublisherSupervisor({
      platform: 'win32', resourcesPath: '/tmp', userDataPath: '/tmp',
      launch: () => { throw new Error('must not launch') },
    })
    expect(supervisor.status()).toMatchObject({ supported: false, reason: 'publisher-not-supported' })
    await expect(supervisor.request('accounts.list')).rejects.toMatchObject({ code: 'publisher-not-supported' })
  })
})
