import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as ecommerceRoutes from '../src/ecommerce-routes.ts'
import { ECOMMERCE_API, type EcommerceRunSubmit } from '../src/ecommerce-run-protocol.ts'
import { GenerationTaskQueue } from '../src/task-queue.ts'
import type { GenerateResult } from '../src/protocol.ts'

const emptyHistory = { list: async () => [], readImage: async () => undefined }
const lifecycle = ecommerceRoutes as typeof ecommerceRoutes & { disposeEcommerceRoutes?: (runtime: object) => void | Promise<void> }
const image = (name: string): GenerateResult => ({ images: [{ b64: Buffer.from(name).toString('base64'), mime: 'image/png' }] })

function plan(requestId: string): EcommerceRunSubmit {
  return { requestId, providerId: 'provider', model: 'model', quality: 'auto', detail: '', assets: [],
    draft: { projectId: '', projectName: 'Product', category: '', platform: '', language: '', size: '1:1', productName: 'Product', promptInfo: '', slots: [{ key: 'detail', label: 'Detail', description: '', count: 1, enabled: true }] },
    requests: [{ mode: 'text', model: 'model', prompt: requestId, size: '1:1', quality: 'auto', detail: '', n: 1, slotKey: 'detail-1' }],
  }
}

async function call(routes: WebRoute[], pathname: string, payload?: unknown): Promise<any> {
  const req = Object.assign(Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]), {
    method: payload === undefined ? 'GET' : 'POST', url: pathname,
    socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:8888' },
  }) as unknown as IncomingMessage
  let response = ''
  const res = { writeHead: () => {}, end: (value: string | Buffer) => { response = value.toString() } } as unknown as ServerResponse
  await routes.find(route => pathname.split('?')[0] === route.path)!.handler(req, res)
  return JSON.parse(response)
}

describe('independent ecommerce Host safety review', () => {
  let directory: string
  const runtimes: object[] = []
  const releases: Array<() => void> = []
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ecommerce-host-review-')) })
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const release of releases.splice(0)) release()
    for (const runtime of runtimes.splice(0)) await lifecycle.disposeEcommerceRoutes?.(runtime)
    await fs.rm(directory, { recursive: true, force: true })
  })
  const mount = (queue: GenerationTaskQueue): { runtime: { queue: GenerationTaskQueue }; routes: WebRoute[] } => {
    const runtime = { queue }; runtimes.push(runtime)
    return { runtime, routes: ecommerceRoutes.makeEcommerceRoutes({ runtime, history: emptyHistory, root: () => directory }) }
  }

  it('disposes the old runtime writer so its late result cannot overwrite a newly mounted runtime', async () => {
    let finishOld!: (result: GenerateResult) => void
    const oldQueue = new GenerationTaskQueue(async () => new Promise(resolve => { finishOld = resolve }))
    const old = mount(oldQueue)
    const first = await call(old.routes, ECOMMERCE_API.submit, plan('old-click'))
    expect(first.ok).toBe(true)
    releases.push(() => finishOld(image('late-old')))
    expect(lifecycle.disposeEcommerceRoutes).toBeTypeOf('function')
    await lifecycle.disposeEcommerceRoutes!(old.runtime)

    const next = mount(new GenerationTaskQueue(async () => image('new')))
    const second = await call(next.routes, ECOMMERCE_API.submit, plan('new-click'))
    expect(second.ok).toBe(true)
    await vi.waitFor(async () => expect((await call(next.routes, `${ECOMMERCE_API.get}?id=${second.run.id}`)).run?.status).toBe('completed'))
    finishOld(image('late-old'))
    await vi.waitFor(() => expect(oldQueue.list()[0]?.status).toBe('completed'))

    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', 'index.json'), 'utf8'))
    expect(persisted.runs.map((run: { id: string }) => run.id)).toContain(second.run.id)
    expect(persisted.runs).toHaveLength(2)
    expect(persisted.runs.find((run: { id: string }) => run.id === first.run.id)?.status).toBe('interrupted')
    const staleSubmit = await call(old.routes, ECOMMERCE_API.submit, plan('retired-click'))
    expect(staleSubmit.ok).toBe(false)
    expect(oldQueue.list()).toHaveLength(1)
  })

  it.each([
    { config: {}, slots: [{ key: 'main-1', status: 'completed', attempt: 1 }] },
    { slots: [{ key: 'main-1', label: 'Main', status: 'completed', attempt: 1, images: [], request: {} }] },
    { config: { draft: { productName: 'Product' } }, slots: [] },
    { legacy: true, slots: [{ key: 'main-1', label: 'Main', status: 'completed', attempt: 1, images: [], request: { mode: 'text', model: 'model', prompt: 'legacy', size: '1:1', quality: 'auto', detail: '', n: 1, projectName: 7 } }] },
  ])('rejects malformed but parseable metadata without rewriting the original file', async invalid => {
    await fs.mkdir(path.join(directory, 'ecommerce'))
    const file = path.join(directory, 'ecommerce', 'index.json')
    const original = JSON.stringify({ version: 1, removed: [], runs: [{ id: randomUUID(), createdAt: 1, updatedAt: 1, status: 'completed', ...invalid }] }, null, 2)
    await fs.writeFile(file, original)
    const mounted = mount(new GenerationTaskQueue(async () => image('must not run')))
    const response = await call(mounted.routes, ECOMMERCE_API.list)
    expect(response).toMatchObject({ ok: false, code: 'storage-corrupt' })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect(mounted.runtime.queue.list()).toEqual([])
  })

  it('keeps a failed cancellation running in memory and on disk, without suppressing its later result', async () => {
    let finish!: (result: GenerateResult) => void
    const queue = new GenerationTaskQueue(async () => new Promise(resolve => { finish = resolve }))
    const mounted = mount(queue)
    const submitted = await call(mounted.routes, ECOMMERCE_API.submit, plan('cancel-failure'))
    releases.push(() => finish(image('cancel-failure-result')))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('running'))
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    expect((await call(mounted.routes, ECOMMERCE_API.cancel, { id: submitted.run.id })).ok).toBe(false)
    expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run.status).toBe('running')
    expect(queue.list()[0]?.status).toBe('running')
    finish(image('cancel-failure-result'))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('completed'))
  })

  it('keeps results and metadata accessible when the removal commit fails', async () => {
    const mounted = mount(new GenerationTaskQueue(async () => image('remove-failure-result')))
    const submitted = await call(mounted.routes, ECOMMERCE_API.submit, plan('remove-failure'))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('completed'))
    const before = (await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    expect((await call(mounted.routes, ECOMMERCE_API.remove, { id: submitted.run.id })).ok).toBe(false)
    const after = (await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run
    expect(after).toEqual(before)
    expect(await fs.readFile(path.join(directory, 'ecommerce', submitted.run.id, before.slots[0].images[0].url.split('/').at(-1)), 'utf8')).toBe('remove-failure-result')
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', 'index.json'), 'utf8'))
    expect(persisted.runs.map((run: { id: string }) => run.id)).toContain(submitted.run.id)
  })

  it('persists a completed queue result after a transient observer save failure without submitting again', async () => {
    let finish!: (result: GenerateResult) => void
    const generate = vi.fn(async () => new Promise<GenerateResult>(resolve => { finish = resolve }))
    const mounted = mount(new GenerationTaskQueue(generate))
    const submitted = await call(mounted.routes, ECOMMERCE_API.submit, plan('observer-failure'))
    releases.push(() => finish(image('observer-recovered')))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('running'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    finish(image('observer-recovered'))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('completed'))
    expect(rename).toHaveBeenCalledTimes(2)
    expect(generate).toHaveBeenCalledOnce()
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', 'index.json'), 'utf8'))
    expect(persisted.runs[0].status).toBe('completed')
  })

  it('retries saving generated image bytes after a transient disk error without paying for another generation', async () => {
    let finish!: (result: GenerateResult) => void
    const generate = vi.fn(async () => new Promise<GenerateResult>(resolve => { finish = resolve }))
    const mounted = mount(new GenerationTaskQueue(generate))
    const submitted = await call(mounted.routes, ECOMMERCE_API.submit, plan('image-save-failure'))
    releases.push(() => finish(image('image-save-recovered')))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('running'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk unavailable'))
    finish(image('image-save-recovered'))
    await vi.waitFor(async () => expect((await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run?.status).toBe('completed'))
    expect(generate).toHaveBeenCalledOnce()
    const final = (await call(mounted.routes, `${ECOMMERCE_API.get}?id=${submitted.run.id}`)).run
    const file = final.slots[0].images[0].url.split('/').at(-1)
    expect(await fs.readFile(path.join(directory, 'ecommerce', submitted.run.id, file), 'utf8')).toBe('image-save-recovered')
  })
})
