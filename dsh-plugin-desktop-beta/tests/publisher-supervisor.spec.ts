import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
