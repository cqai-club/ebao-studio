import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EcommerceRunStore, type EcommerceLegacyHistory } from '../src/ecommerce-run-store.ts'
import { GenerationTaskQueue } from '../src/task-queue.ts'
import type { EcommerceRunSubmit } from '../src/ecommerce-run-protocol.ts'
import type { GenerateRequest, GenerateResult, HistoryEntry } from '../src/protocol.ts'

const bytes = (text: string): string => Buffer.from(text).toString('base64')
const reference = `data:image/png;base64,${bytes('original-product')}`
const image = (text: string) => ({ b64: bytes(text), mime: 'image/png' })
const emptyHistory = { list: async () => [], readImage: async () => undefined }

function plan(id = 'click-1', keys = ['main-1', 'scene-1']): EcommerceRunSubmit {
  return {
    requestId: id, providerId: 'provider', model: 'model', quality: '2k', detail: '',
    draft: { projectId: 'browser-draft', projectName: '商品 A', category: '数码', platform: '淘宝', language: '中文', size: '1:1', productName: '水杯', promptInfo: '300ml', slots: keys.map(key => ({ key: key.replace(/-\d+$/, ''), label: key, description: '', count: 1, enabled: true })) },
    assets: [{ id: 'product', name: 'water.png', role: 'product', dataUrl: reference }],
    requests: keys.map(key => ({ mode: 'edit', model: 'model', prompt: `generate ${key}`, size: '1:1', quality: '2k', detail: '', n: 1, image: reference, refName: 'water.png', slotKey: key, slotLabel: key, channelId: 'provider' })),
  }
}

describe('durable ecommerce runs', () => {
  let directory: string
  const stores: EcommerceRunStore[] = []
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ecommerce-runs-')) })
  afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.dispose())); await fs.rm(directory, { recursive: true, force: true }) })
  function store(queue: GenerationTaskQueue, history: EcommerceLegacyHistory = emptyHistory): EcommerceRunStore {
    const value = new EcommerceRunStore({ runtime: { queue }, root: () => directory, history })
    stores.push(value); return value
  }
  async function completed(value: EcommerceRunStore, id: string): Promise<void> {
    await vi.waitFor(async () => expect((await value.get(id))?.status).toBe('completed'))
  }

  it('saves full configuration, exact reference bytes and its own result images across reopening', async () => {
    const queue = new GenerationTaskQueue(async () => ({ images: [image('own-result')], historyError: 'bounded history unavailable' }))
    const value = store(queue)
    const submitted = await value.submit(plan())
    await completed(value, submitted.id)
    const detail = (await value.get(submitted.id))!
    expect(detail.config?.draft).toEqual(plan().draft)
    expect(detail.slots).toHaveLength(2)
    expect(JSON.stringify(detail)).not.toContain('data:image')
    expect(detail.config?.assets[0]).toMatchObject({ role: 'product', name: 'water.png' })
    expect(detail.slots[0].images[0].url).toContain(`/ecommerce/asset/${submitted.id}/`)
    const assetUrl = detail.config!.assets[0].url.split('/')
    expect((await value.readAsset(assetUrl.at(-2)!, assetUrl.at(-1)!))?.data.toString()).toBe('original-product')
    value.dispose()
    const reopenedQueue = new GenerationTaskQueue(async () => { throw new Error('must not resubmit') })
    const reopened = store(reopenedQueue)
    expect(await reopened.get(submitted.id)).toEqual(detail)
    expect(reopenedQueue.list()).toEqual([])
    const resultUrl = detail.slots[0].images[0].url.split('/')
    expect((await reopened.readAsset(resultUrl.at(-2)!, resultUrl.at(-1)!))?.data.toString()).toBe('own-result')
    expect(await reopened.readAsset(submitted.id, '../../index.json')).toBeUndefined()
  })

  it('deduplicates concurrent submissions, assigns a new run for a new click, and keeps get/list as reads', async () => {
    const run = vi.fn(async () => ({ images: [image('result')] }))
    const queue = new GenerationTaskQueue(run)
    const value = store(queue)
    const [first, duplicate] = await Promise.all([value.submit(plan()), value.submit(plan())])
    expect(first.id).toBe(duplicate.id)
    expect(first.id).not.toBe(plan().draft.projectId)
    await completed(value, first.id)
    const unnamed = plan('click-2'); unnamed.draft.productName = ''; unnamed.draft.projectName = ''
    const later = await value.submit(unnamed)
    expect(later.id).not.toBe(first.id)
    await completed(value, later.id)
    expect(run).toHaveBeenCalledTimes(4)
    expect(later.slots[0].request.projectName).toBeUndefined()
    expect((await value.list()).find(run => run.id === later.id)?.name).toBe('未命名商品')
    await Promise.all([value.get(first.id), value.get(first.id), value.list(), value.list()])
    expect(run).toHaveBeenCalledTimes(4)
    expect((await value.list()).map(run => run.id)).toHaveLength(2)
  })

  it('rejects duplicate canonical slot keys before persisting or submitting a plan', async () => {
    const run = vi.fn(async () => ({ images: [image('result')] }))
    const queue = new GenerationTaskQueue(run)
    const submit = vi.spyOn(queue, 'submit')
    const value = store(queue)
    await expect(value.submit(plan('duplicate-keys', ['detail-1', ' detail-1 ']))).rejects.toMatchObject({ code: 'bad-request' })
    expect(submit).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(await fs.readdir(directory)).toEqual([])

    const valid = await value.submit(plan('valid-keys', [' detail-1 ', 'scene-1']))
    await completed(value, valid.id)
    expect(valid.slots.map(slot => slot.key)).toEqual(['detail-1', 'scene-1'])
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('releases dependent slots from the host after main completion while preserving their role reference', async () => {
    let finishMain!: (result: GenerateResult) => void
    const seen: GenerateRequest[] = []
    const queue = new GenerationTaskQueue(async request => {
      seen.push(request)
      if (request.slotKey === 'main-1') return new Promise(resolve => { finishMain = resolve })
      return { images: [image('scene-result')] }
    }, 4)
    const value = store(queue)
    const submitted = await value.submit(plan())
    expect(seen).toHaveLength(1)
    const observing = await Promise.all([value.get(submitted.id), value.list(), value.get(submitted.id)])
    expect(observing[0]).toMatchObject({ status: 'running' })
    expect(seen).toHaveLength(1)
    finishMain({ images: [image('generated-main')] })
    await completed(value, submitted.id)
    expect(seen[1]).toMatchObject({ mode: 'edit', image: `data:image/png;base64,${bytes('generated-main')}`, workflow: 'ecommerce', projectId: submitted.id })
    expect(seen[1].images).toEqual([reference])
    expect(seen[1].prompt).toContain('商品身份')
    const saved = (await value.get(submitted.id))!
    const attempt = saved.slots[1].attempts![0]
    expect(attempt.request.image).toBe(saved.slots[0].images[0].url)
    expect(attempt.request.images).toEqual([saved.config!.assets[0].url])
    expect(attempt).toMatchObject({ number: 1, status: 'completed', images: saved.slots[1].images })
    expect(attempt.request.prompt).toBe(seen[1].prompt)
    expect(JSON.stringify(saved)).not.toContain('data:image')
  })

  it('marks unconfirmed work interrupted on restart and makes retry an explicit new attempt', async () => {
    const queue = new GenerationTaskQueue(async () => new Promise<GenerateResult>(() => {}))
    const value = store(queue)
    const submitted = await value.submit(plan())
    value.dispose()
    const run = vi.fn(async () => ({ images: [image('retry-result')] }))
    const resumedQueue = new GenerationTaskQueue(run)
    const reopened = store(resumedQueue)
    const interrupted = (await reopened.get(submitted.id))!
    expect(interrupted.status).toBe('interrupted')
    expect(interrupted.slots.map(slot => slot.status)).toEqual(['interrupted', 'interrupted'])
    expect(run).not.toHaveBeenCalled()
    expect(resumedQueue.list()).toEqual([])
    await reopened.retry(submitted.id)
    await completed(reopened, submitted.id)
    const retried = (await reopened.get(submitted.id))!
    expect(retried.slots.map(slot => slot.attempt)).toEqual([2, 1])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('fails a dependent plan without issuing calls when all main attempts fail, then retries the full plan', async () => {
    let fail = true
    const run = vi.fn(async () => { if (fail) throw new Error('upstream rejected'); return { images: [image('okay')] } })
    const queue = new GenerationTaskQueue(run)
    const value = store(queue)
    const submitted = await value.submit(plan())
    await vi.waitFor(async () => expect((await value.get(submitted.id))?.status).toBe('failed'))
    expect(run).toHaveBeenCalledTimes(1)
    const failed = (await value.get(submitted.id))!
    expect(failed.slots[1]).toMatchObject({ attempt: 0, status: 'failed' })
    fail = false
    await value.retry(submitted.id, 'main-1')
    await completed(value, submitted.id)
    expect((await value.get(submitted.id))?.slots.map(slot => slot.attempt)).toEqual([2, 1])
    expect((await value.get(submitted.id))?.slots[0].attempts?.map(attempt => attempt.status)).toEqual(['failed', 'completed'])
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('never downgrades edit retry when an original reference file has disappeared', async () => {
    const run = vi.fn(async () => { throw new Error('provider failed') })
    const queue = new GenerationTaskQueue(run)
    const value = store(queue)
    const submitted = await value.submit(plan('click', ['detail-1']))
    await vi.waitFor(async () => expect((await value.get(submitted.id))?.status).toBe('failed'))
    const asset = submitted.config!.assets[0].url.split('/').at(-1)!
    await fs.rm(path.join(directory, 'ecommerce', submitted.id, asset))
    const retried = await value.retry(submitted.id)
    expect(retried.slots[0]).toMatchObject({ status: 'failed', attempt: 2, error: expect.stringContaining('参考图文件丢失') })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('allows independent terminal-slot retries during another active slot and never duplicates its call', async () => {
    const attempts = new Map<string, number>()
    let release!: (result: GenerateResult) => void
    const run = vi.fn(async (request: GenerateRequest) => {
      const key = request.slotKey!
      const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt)
      if (key === 'scene-1') return new Promise<GenerateResult>(resolve => { release = resolve })
      if (attempt === 1) throw new Error('one failed')
      return { images: [image('retried-detail')] }
    })
    const queue = new GenerationTaskQueue(run, 4)
    const value = store(queue)
    const submitted = await value.submit(plan('retry-active', ['detail-1', 'scene-1']))
    await vi.waitFor(async () => expect((await value.get(submitted.id))?.slots[0].status).toBe('failed'))
    await expect(value.retry(submitted.id, 'scene-1')).rejects.toMatchObject({ code: 'slot-active' })
    await value.retry(submitted.id, 'detail-1')
    await vi.waitFor(async () => expect((await value.get(submitted.id))?.slots[0]).toMatchObject({ status: 'completed', attempt: 2 }))
    expect(attempts.get('scene-1')).toBe(1)
    expect(run).toHaveBeenCalledTimes(3)
    release({ images: [image('scene-result')] })
    await completed(value, submitted.id)
  })

  it('strictly orders concurrent group-retry snapshots with a frozen and backwards wall clock', async () => {
    const attempts = new Map<string, number>()
    const releases = new Map<string, (result: GenerateResult) => void>()
    const queue = new GenerationTaskQueue(async request => {
      const key = request.slotKey!
      const attempt = (attempts.get(key) ?? 0) + 1
      attempts.set(key, attempt)
      if (attempt === 1) return { images: [image(`first-${key}`)] }
      return new Promise<GenerateResult>(resolve => { releases.set(key, resolve) })
    }, 4)
    const value = store(queue)
    const submitted = await value.submit(plan('ordered-retries', ['detail-1', 'scene-1']))
    await completed(value, submitted.id)
    const original = (await value.get(submitted.id))!
    const now = vi.spyOn(Date, 'now').mockReturnValue(original.updatedAt - 1000)
    let snapshots
    try {
      snapshots = await Promise.all([
        value.retry(submitted.id, 'detail-1'),
        value.retry(submitted.id, 'scene-1'),
      ])
    } finally { now.mockRestore() }
    expect(snapshots[0].updatedAt).toBeGreaterThan(original.updatedAt)
    expect(snapshots[1].updatedAt).toBeGreaterThan(snapshots[0].updatedAt)
    expect(snapshots[0].slots.map(slot => slot.status)).toEqual(['running', 'completed'])
    expect(snapshots[1].slots.map(slot => slot.status)).toEqual(['running', 'running'])
    expect(snapshots[1].slots.map(slot => slot.attempt)).toEqual([2, 2])
    expect([...attempts.values()]).toEqual([2, 2])
    for (const [key, release] of releases) release({ images: [image(`second-${key}`)] })
    await completed(value, submitted.id)
    expect((await value.get(submitted.id))!.updatedAt).toBeGreaterThan(snapshots[1].updatedAt)
  })

  it('retains every image in a 60-slot product set independently of the 50-row shared history limit', async () => {
    const queue = new GenerationTaskQueue(async request => ({ images: [image(`image-${request.slotKey}`)] }), 4)
    const value = store(queue)
    const submitted = await value.submit(plan('large-set', Array.from({ length: 60 }, (_, index) => `detail-${index + 1}`)))
    await completed(value, submitted.id)
    const result = (await value.get(submitted.id))!
    expect(result.slots).toHaveLength(60)
    expect(result.slots.every(slot => slot.status === 'completed' && slot.images.length === 1)).toBe(true)
    for (const slot of [result.slots[0], result.slots[59]]) {
      const url = slot.images[0].url.split('/')
      expect((await value.readAsset(url.at(-2)!, url.at(-1)!))?.data.toString()).toBe(`image-${slot.key}`)
    }
  })

  it('cancels host work, refuses active removal, and clears only finished ecommerce runs', async () => {
    const queue = new GenerationTaskQueue(async request => request.prompt === 'slow' ? new Promise<GenerateResult>(() => {}) : { images: [image('result')] }, 4)
    const value = store(queue)
    const first = await value.submit(plan('completed', ['detail-1']))
    await completed(value, first.id)
    const slow = plan('pending', ['detail-1']); slow.requests[0].prompt = 'slow'
    const active = await value.submit(slow)
    await expect(value.remove(active.id)).rejects.toMatchObject({ code: 'run-active' })
    expect((await value.clear()).map(run => run.id)).toEqual([active.id])
    expect(await value.get(first.id)).toBeUndefined()
    const cancelled = await value.cancel(active.id)
    expect(cancelled.status).toBe('cancelled')
    expect(queue.get(cancelled.slots[0].taskId!)?.status).toBe('cancelled')
    expect(await value.clear()).toEqual([])
  })

  it('imports old ecommerce results once with independent bytes, missing configuration and backed-up metadata', async () => {
    const old: HistoryEntry = { id: 'old-entry', projectId: 'old-project', projectName: '旧商品', createdAt: 123, workflow: 'ecommerce', slotKey: 'main-1', slotLabel: '主图', mode: 'edit', model: 'old-model', prompt: 'old prompt', size: '1:1', quality: 'auto', detail: '', n: 1, images: [{ url: '/api/dsh-imagegen/history/image/old-entry-0.png', mime: 'image/png' }] }
    const readImage = vi.fn(async () => ({ data: Buffer.from('legacy-image'), mime: 'image/png' }))
    const history = { list: async () => [old, { ...old, id: 'normal', workflow: undefined, projectId: undefined, projectName: undefined, slotKey: undefined, slotLabel: undefined }, { ...old, id: 'canvas', canvas: { canvasId: 'canvas-id' } } as HistoryEntry], readImage }
    const queue = new GenerationTaskQueue(async () => { throw new Error('must not call') })
    const value = store(queue, history)
    const summaries = await value.list()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ legacy: true, name: '旧商品' })
    const legacy = (await value.get(summaries[0].id))!
    expect(legacy.config).toBeUndefined()
    expect(legacy.slots[0].images[0].url).toContain('/ecommerce/asset/')
    expect(JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', legacy.id, 'legacy-source.json'), 'utf8'))).toEqual([old])
    await expect(value.retry(legacy.id)).rejects.toMatchObject({ code: 'legacy-readonly' })
    value.dispose()
    const reopened = store(queue, history)
    await reopened.list()
    expect(readImage).toHaveBeenCalledTimes(1)
    await reopened.remove(legacy.id)
    reopened.dispose()
    expect(await store(queue, history).list()).toEqual([])
    expect(readImage).toHaveBeenCalledTimes(1)
    expect(queue.list()).toEqual([])
  })

  it('preserves the last readable index when legacy source metadata is incomplete', async () => {
    let entries: HistoryEntry[] = []
    const history = { list: async () => entries, readImage: async () => undefined }
    const queue = new GenerationTaskQueue(async () => ({ images: [image('valid')] }))
    const first = store(queue, history)
    const saved = await first.submit(plan('saved', ['detail-1']))
    await completed(first, saved.id)
    await first.dispose()
    const file = path.join(directory, 'ecommerce', 'index.json')
    const original = await fs.readFile(file, 'utf8')
    entries = [{ id: 'damaged-legacy', createdAt: 1, workflow: 'ecommerce', mode: 'text', prompt: 'original', images: [] } as unknown as HistoryEntry]
    await expect(store(queue, history).list()).rejects.toMatchObject({ code: 'storage-corrupt' })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect(entries[0].id).toBe('damaged-legacy')
    expect(queue.list()).toHaveLength(1)
  })

  it('deletes legacy and fresh-run raw history only on explicit deletion, preserving other origins and active runs', async () => {
    const base: HistoryEntry = { id: 'old-entry', projectId: 'old-project', createdAt: 1, workflow: 'ecommerce', slotKey: 'main-1', mode: 'text', model: 'model', prompt: 'old', size: '1:1', quality: 'auto', detail: '', n: 1, images: [{ url: '/api/dsh-imagegen/history/image/old-entry-0.png', mime: 'image/png' }] }
    const normal: HistoryEntry = { ...base, id: 'normal', projectId: undefined, slotKey: undefined, workflow: undefined }
    const canvas: HistoryEntry = { ...normal, id: 'canvas', canvas: { canvasId: 'canvas' } }
    const conflict: HistoryEntry = { ...base, id: 'conflict', canvas: { canvasId: 'canvas' } }
    let entries = [base, normal, canvas, conflict]
    const remove = vi.fn(async (id: string) => { entries = entries.filter(entry => entry.id !== id) })
    const history = { list: async () => entries, remove, readImage: async () => ({ data: Buffer.from('old-image'), mime: 'image/png' }) }
    const queue = new GenerationTaskQueue(async request => request.prompt === 'slow' ? new Promise<GenerateResult>(() => {}) : { images: [image('fresh')] }, 4)
    const value = store(queue, history)
    const legacy = (await value.list())[0]
    expect(remove).not.toHaveBeenCalled()
    const fresh = await value.submit(plan('fresh', ['detail-1']))
    await completed(value, fresh.id)
    entries.push({ ...base, id: 'fresh-history', projectId: fresh.id })
    const slow = plan('active', ['detail-1']); slow.requests[0].prompt = 'slow'
    const active = await value.submit(slow)
    entries.push({ ...base, id: 'active-history', projectId: active.id })
    await value.remove(legacy.id)
    expect(remove).toHaveBeenCalledExactlyOnceWith('old-entry')
    await value.clear()
    expect(entries.map(entry => entry.id)).toEqual(['normal', 'canvas', 'conflict', 'active-history'])
    expect((await value.list()).map(run => run.id)).toEqual([active.id])
    await expect(value.submit(plan('fresh', ['detail-1']))).rejects.toMatchObject({ code: 'request-removed' })
  })

  it('rolls back cancel, retry, remove and clear when the durable index write fails', async () => {
    let finish!: (result: GenerateResult) => void
    const queue = new GenerationTaskQueue(async () => new Promise(resolve => { finish = resolve }))
    let rows: HistoryEntry[] = []
    const remove = vi.fn(async (id: string) => { rows = rows.filter(row => row.id !== id) })
    const value = store(queue, { ...emptyHistory, list: async () => rows, remove })
    const submitted = await value.submit(plan('io-test', ['detail-1']))
    await value.get(submitted.id)
    const rename = vi.spyOn(fs, 'rename')
    const diskError = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    rename.mockRejectedValueOnce(diskError)
    await expect(value.cancel(submitted.id)).rejects.toThrow('disk full')
    expect((await value.get(submitted.id))?.status).toBe('running')
    expect(queue.get(submitted.slots[0].taskId!)?.status).toBe('running')
    finish({ images: [image('saved-after-cancel-failure')] })
    await completed(value, submitted.id)
    rows = [{ id: 'raw-row', createdAt: 1, workflow: 'ecommerce', projectId: submitted.id, mode: 'edit', model: 'model', prompt: 'row', size: '1:1', quality: 'auto', detail: '', n: 1, images: [] }]
    rename.mockRejectedValueOnce(diskError)
    await expect(value.retry(submitted.id, 'detail-1')).rejects.toThrow('disk full')
    expect((await value.get(submitted.id))?.slots[0]).toMatchObject({ status: 'completed', attempt: 1 })
    expect(queue.list()).toHaveLength(1)
    rename.mockRejectedValueOnce(diskError)
    await expect(value.remove(submitted.id)).rejects.toThrow('disk full')
    expect((await value.list()).map(run => run.id)).toEqual([submitted.id])
    expect(remove).not.toHaveBeenCalled()
    rename.mockRejectedValueOnce(diskError)
    await expect(value.clear()).rejects.toThrow('disk full')
    expect((await value.list()).map(run => run.id)).toEqual([submitted.id])
    expect(remove).not.toHaveBeenCalled()
    const disk = JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', 'index.json'), 'utf8'))
    expect(disk.runs[0]).toMatchObject({ id: submitted.id, status: 'completed' })
    const resultUrl = disk.runs[0].slots[0].images[0].url.split('/')
    expect((await value.readAsset(resultUrl.at(-2)!, resultUrl.at(-1)!))?.data.toString()).toBe('saved-after-cancel-failure')
  })

  it('keeps a durable cleanup ledger and retries a failed raw-history deletion without reviving the run', async () => {
    const queue = new GenerationTaskQueue(async () => ({ images: [image('result')] }))
    let rows: HistoryEntry[] = []
    const remove = vi.fn(async (id: string) => { rows = rows.filter(row => row.id !== id) })
    const value = store(queue, { ...emptyHistory, list: async () => rows, remove })
    const submitted = await value.submit(plan('cleanup', ['detail-1']))
    await completed(value, submitted.id)
    rows = [{ id: 'raw-row', createdAt: 1, workflow: 'ecommerce', projectId: submitted.id, mode: 'text', model: 'model', prompt: 'raw', size: '1:1', quality: 'auto', detail: '', n: 1, images: [] }]
    remove.mockRejectedValueOnce(new Error('raw-history unavailable'))
    await expect(value.remove(submitted.id)).rejects.toMatchObject({ code: 'cleanup-failed' })
    const disk = JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', 'index.json'), 'utf8'))
    expect(disk.runs).toEqual([])
    expect(disk.pendingCleanup[0].id).toBe(submitted.id)
    expect(await value.get(submitted.id)).toBeUndefined()
    expect(rows).toEqual([])
    expect(remove).toHaveBeenCalledTimes(2)
    expect(JSON.parse(await fs.readFile(path.join(directory, 'ecommerce', 'index.json'), 'utf8')).pendingCleanup).toEqual([])
  })

  it('retries saving an observed terminal result after a temporary disk failure without regenerating', async () => {
    let finish!: (result: GenerateResult) => void
    const run = vi.fn(async () => new Promise<GenerateResult>(resolve => { finish = resolve }))
    const queue = new GenerationTaskQueue(run)
    const value = store(queue)
    const submitted = await value.submit(plan('save-retry', ['detail-1']))
    await value.get(submitted.id)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('temporarily unavailable'), { code: 'EIO' }))
    finish({ images: [image('already-generated')] })
    await completed(value, submitted.id)
    expect(log).toHaveBeenCalledWith(expect.any(String), 'temporarily unavailable')
    expect(run).toHaveBeenCalledTimes(1)
    expect((await value.get(submitted.id))?.slots[0]).toMatchObject({ attempt: 1, status: 'completed' })
  })
})
