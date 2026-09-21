import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingMessage } from 'node:http'
import { once } from 'node:events'
import { JobStore, validateOptions } from '../src/jobs.ts'
import { permitted, serveArtifact } from '../src/index.ts'
const roots: string[] = []
const options = {title: '测试', text: '这是一条测试口播。', duration: 5, mode: 'plan' as const, optimize: false, covers: false, studio: false}
afterEach(() => {for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})
function temp() {const root = mkdtempSync(join(tmpdir(), 'ejianbao-test-')); roots.push(root); return root}
describe('local task boundary', () => {
  it('rejects malformed jobs and cross-origin mutations', () => {
    expect(() => validateOptions({...options, duration: NaN})).toThrow()
    expect(() => validateOptions({...options, mode: '../render'})).toThrow()
    expect(() => validateOptions({...options, mode: 'digitalhuman', text: '字'.repeat(5001)})).toThrow()
    expect(validateOptions({...options, text: '字'.repeat(5001)}).text).toHaveLength(5001)
    const req = (headers: object, method = 'POST') => ({method, headers: {host: '127.0.0.1:43120', ...headers}, socket: {remoteAddress: '127.0.0.1'}} as IncomingMessage)
    expect(permitted(req({'x-ejianbao': '1', origin: 'https://evil.example'}))).toBe(false)
    expect(permitted(req({}))).toBe(false)
    expect(permitted(req({'x-ejianbao': '1', origin: 'http://127.0.0.1:43120'}))).toBe(true)
  })
  it('isolates jobs, detects interrupted runs, and refuses path traversal', () => {
    const root = temp(); const store = new JobStore(root, root); const a = store.create(options); const b = store.create({...options, title: '另一个任务'})
    expect(store.dir(a.id)).not.toBe(store.dir(b.id))
    expect(() => store.dir('../secrets')).toThrow()
    a.status = 'running'; store.save(a)
    expect(new JobStore(root, root).get(a.id).status).toBe('interrupted')
  })
  it('marks child-process failures and releases its running slot', async () => {
    const root = temp(); const runtime = join(root, 'runtime'); mkdirSync(runtime)
    writeFileSync(join(runtime, 'runner.py'), 'import sys\nprint(\'EJIANBAO_EVENT {"stage":"render","status":"running"}\', flush=True)\nsys.exit(7)\n')
    const store = new JobStore(join(root, 'jobs'), runtime); const job = store.create(options)
    store.start(job.id)
    expect(() => store.start(job.id)).toThrow('已有')
    await expect.poll(() => job.status, {timeout: 15000}).toBe('failed')
    expect(job.stages.render).toBe('failed')
    expect(store.create(options).status).toBe('draft')
    await store.dispose()
  })
  it('serves seekable videos and rejects invalid byte ranges', async () => {
    const root = temp(); const path = join(root, 'video.mp4'); writeFileSync(path, '0123456789')
    const server = createServer((req, res) => serveArtifact(req, res, path, false)); server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const port = (server.address() as {port: number}).port
    try {
      const part = await fetch(`http://127.0.0.1:${port}/`, {headers: {range: 'bytes=3-6'}})
      expect(part.status).toBe(206); expect(await part.text()).toBe('3456')
      const suffix = await fetch(`http://127.0.0.1:${port}/`, {headers: {range: 'bytes=-2'}})
      expect(await suffix.text()).toBe('89')
      expect((await fetch(`http://127.0.0.1:${port}/`, {headers: {range: 'bytes=99-'}})).status).toBe(416)
    } finally {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))}
  })
  it('cancels the owned worker and allows another job to start', async () => {
    const root = temp(); const runtime = join(root, 'runtime'); mkdirSync(runtime)
    writeFileSync(join(runtime, 'runner.py'), 'import time\nprint("worker running", flush=True)\ntime.sleep(60)\n')
    const store = new JobStore(join(root, 'jobs'), runtime); const job = store.create(options)
    store.start(job.id)
    await expect.poll(() => job.logs.some(line => line === 'worker running'), {timeout: 15000}).toBe(true)
    await store.cancel(job.id)
    expect(job.status).toBe('cancelled')
    writeFileSync(join(runtime, 'runner.py'), 'print("done")\n')
    const second = store.create(options); store.start(second.id)
    await expect.poll(() => second.status, {timeout: 15000}).toBe('completed')
    await store.dispose()
  }, 20000)
})
