import { describe, expect, it, vi } from 'vitest'
import type { CanvasDocument, CanvasNode, GenerateRequest, HistoryEntry, HistoryImageRef } from '../src/protocol.ts'
import type { EcommerceRun, EcommerceRunSummary } from '../src/ecommerce-run-protocol.ts'
import type { ImageGenApi } from '../src/client/api.ts'
import { listAdditionalGenerationHistory, mergeGenerationOverview, preserveGenerationHistoryHashes, type GenerationOverviewEntry } from '../src/client/generation-overview.ts'

const RUN = '11111111-1111-4111-8111-111111111111'
const hash = (letter: string): string => letter.repeat(64)
const output = (letter: string, runId = RUN): HistoryImageRef => ({ url: `/api/dsh-imagegen/ecommerce/asset/${runId}/${hash(letter)}.png`, mime: 'image/png' })
const request = (extra: Partial<GenerateRequest> = {}): GenerateRequest => ({ mode: 'edit', model: 'image-model', prompt: 'same prompt', size: '3:2', quality: '2k', detail: 'high', n: 1, refName: 'input.png', channel: 'Channel A', channelId: 'provider-a', ...extra })
const history = (id: string, images: HistoryImageRef[], extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, createdAt: 10, mode: 'text', model: 'image-model', prompt: 'same prompt', size: '1:1', quality: 'auto', detail: '', n: images.length, images, ...extra })
const summary = (id = RUN): EcommerceRunSummary => ({ id, name: 'Water bottle', createdAt: 1, updatedAt: 3, status: 'completed', done: 1, total: 1, model: 'image-model', size: '3:2' })
const run = (id = RUN): EcommerceRun => ({
  id, createdAt: 1, updatedAt: 3, status: 'completed', slots: [{ key: 'main-1', label: 'Main image', status: 'completed', attempt: 1, request: request(), images: [output('a', id)] }],
})
const node = (id: string, origin: 'generated' | 'upload' | 'history' | 'gallery', letter = 'c', extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id, type: 'image', title: `Node ${id}`, x: 0, y: 0, width: 100, height: 100,
  metadata: { asset: { assetId: `${hash(letter)}.png`, url: `/api/dsh-imagegen/canvas/asset/${hash(letter)}.png`, mime: 'image/png', bytes: 10, width: 100, height: 100, origin } }, ...extra,
})
const document = (id = 'canvas-a', nodes: CanvasNode[] = [node('generated', 'generated')]): CanvasDocument => ({
  version: 2, id, title: 'Canvas A', revision: 1, viewport: { x: 0, y: 0, k: 1 }, background: 'dots', nodes, connections: [], createdAt: 2, updatedAt: 4,
})
type ReadApi = Pick<ImageGenApi, 'ecommerceList' | 'ecommerceGet' | 'canvasList' | 'canvasRead' | 'galleryList'>
const mockApi = () => ({
  ecommerceList: vi.fn<ReadApi['ecommerceList']>(async () => []), ecommerceGet: vi.fn<ReadApi['ecommerceGet']>(async id => run(id)),
  canvasList: vi.fn<ReadApi['canvasList']>(async () => []), canvasRead: vi.fn<ReadApi['canvasRead']>(async id => document(id)),
  galleryList: vi.fn<ReadApi['galleryList']>(async () => []),
})
const extra = (id: string, images: HistoryImageRef[], overview: GenerationOverviewEntry['overview'], props: Partial<GenerationOverviewEntry> = {}): GenerationOverviewEntry => ({ ...history(id, images), overview, ...props })

describe('additional generation stores', () => {
  it('reads every ecommerce run, successful attempt and retained slot output without reading input assets', async () => {
    const api = mockApi()
    const first = run()
    first.slots[0].status = 'failed' // Retried slot retains its previous paid result.
    first.slots[0].attempts = [
      { number: 1, status: 'completed', startedAt: 2, finishedAt: 3, request: request({ prompt: 'resolved prompt' }), images: [output('a')] },
      { number: 2, status: 'completed', finishedAt: 5, request: request({ prompt: 'earlier success' }), images: [output('b')] },
      { number: 3, status: 'failed', finishedAt: 6, request: request({ prompt: 'failed attempt' }), images: [output('f')] },
    ]
    const legacyId = `legacy-${'d'.repeat(32)}`
    api.ecommerceList.mockResolvedValue([summary(), summary(legacyId)])
    api.ecommerceGet.mockImplementation(async id => id === RUN ? first : run(legacyId))
    const entries = await listAdditionalGenerationHistory(api)
    expect(api.ecommerceGet.mock.calls.map(([id]) => id)).toEqual([RUN, legacyId])
    expect(api.galleryList).toHaveBeenCalledExactlyOnceWith(true)
    expect(entries).toHaveLength(4)
    expect(entries.map(entry => entry.prompt)).toEqual(['earlier success', 'resolved prompt', 'same prompt', 'same prompt'])
    expect(entries[0]).toMatchObject({ createdAt: 5, mode: 'edit', model: 'image-model', size: '3:2', quality: '2k', detail: 'high', n: 1,
      workflow: 'ecommerce', projectId: RUN, projectName: 'Water bottle', slotKey: 'main-1', slotLabel: 'Main image',
      refName: 'input.png', channelId: 'provider-a', channel: 'Channel A', overview: { kind: 'ecommerce', runId: RUN }, images: [{ sha256: hash('b') }] })
    expect(entries.every(entry => entry.id.startsWith('overview:ecommerce:'))).toBe(true)
    expect(entries.find(entry => entry.overview?.kind === 'ecommerce' && entry.overview.runId === legacyId)?.images[0].sha256).toBe(hash('a'))
    expect(JSON.stringify(entries)).not.toContain('failed attempt')
    expect(api.canvasRead).not.toHaveBeenCalled()
  })

  it('includes generated image and skill image-file nodes, but skips uploads, imports, configs and non-image files', async () => {
    const api = mockApi()
    const generated = node('generated', 'generated')
    generated.metadata = { ...generated.metadata, prompt: 'canvas prompt', model: 'canvas-model', size: '4:3', quality: '4k', taskId: 'task-a' }
    const sibling = node('sibling', 'generated', 'd')
    sibling.metadata = { ...sibling.metadata, taskId: 'task-a' }
    const skill = node('skill-image', 'generated', 'e', { type: 'file' })
    skill.metadata = { ...skill.metadata, skill: { id: 'draw', label: 'Draw skill', sourceNodeIds: [], createdAt: 7 } }
    const pdf = node('skill-pdf', 'generated', 'f', { type: 'file' })
    pdf.metadata!.asset!.mime = 'application/pdf'
    const saved = document('canvas-a', [generated, sibling, skill, pdf, node('upload', 'upload'), node('history', 'history'), node('gallery', 'gallery')])
    api.canvasList.mockResolvedValue([{ id: saved.id, title: saved.title, revision: 1, nodeCount: saved.nodes.length, createdAt: 2, updatedAt: 4 }])
    api.canvasRead.mockResolvedValue(saved)
    const entries = await listAdditionalGenerationHistory(api)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ model: 'Draw skill', createdAt: 7, images: [{ sha256: hash('e') }] })
    expect(entries.find(entry => entry.id.endsWith(':sibling'))).toMatchObject({ prompt: 'canvas prompt', model: 'canvas-model', size: '4:3', quality: '4k' })
    expect(entries.every(entry => entry.overview?.kind === 'canvas' && entry.overview.canvasId === 'canvas-a')).toBe(true)
    expect(api.canvasRead).toHaveBeenCalledExactlyOnceWith('canvas-a')
  })

  it('keeps saved generation gallery copies and excludes every persisted local-upload label', async () => {
    const api = mockApi()
    const image = { url: '/api/dsh-imagegen/gallery/image/saved-0.png', mime: 'image/png', sha256: hash('a') }
    api.galleryList.mockResolvedValue([
      history('saved', [image]), ...['uploaded', '本地上传', 'Local upload', 'Локальный файл'].map((model, index) => history(`input-${index}`, [image], { model })),
    ])
    expect(await listAdditionalGenerationHistory(api)).toEqual([{ ...history('overview:gallery:saved', [image]), overview: { kind: 'gallery' } }])
  })

  it('limits the entire read operation to three concurrent requests and reads each detail exactly once', async () => {
    const api = mockApi()
    let active = 0
    let maximum = 0
    const delay = async <T>(value: T): Promise<T> => {
      maximum = Math.max(maximum, ++active)
      await new Promise<void>(resolve => setImmediate(resolve))
      active--
      return value
    }
    const ids = Array.from({ length: 6 }, (_, index) => `${index}`.repeat(8) + '-1111-4111-8111-111111111111')
    api.ecommerceList.mockImplementation(() => delay(ids.map(id => summary(id))))
    api.canvasList.mockImplementation(() => delay([{ id: 'canvas-a', title: 'A', revision: 1, nodeCount: 1, createdAt: 2, updatedAt: 4 }]))
    api.galleryList.mockImplementation(() => delay([]))
    api.ecommerceGet.mockImplementation(id => delay(run(id)))
    api.canvasRead.mockImplementation(id => delay(document(id)))
    expect(await listAdditionalGenerationHistory(api)).toHaveLength(7)
    expect(maximum).toBe(3)
    expect(active).toBe(0)
    expect(api.ecommerceGet.mock.calls.map(([id]) => id)).toEqual(ids)
    expect(api.canvasRead).toHaveBeenCalledTimes(1)
  })

  it.each(['ecommerceList', 'canvasList', 'galleryList'] as const)('surfaces %s failures instead of silently returning other sources', async method => {
    const api = mockApi()
    api[method].mockRejectedValue(new Error('store unavailable'))
    await expect(listAdditionalGenerationHistory(api)).rejects.toThrow('读取失败：store unavailable')
    expect(api.ecommerceGet).not.toHaveBeenCalled()
    expect(api.canvasRead).not.toHaveBeenCalled()
  })

  it.each(['ecommerce', 'canvas'] as const)('surfaces failed %s detail reads and identity mismatches', async source => {
    const api = mockApi()
    if (source === 'ecommerce') {
      api.ecommerceList.mockResolvedValue([summary()])
      api.ecommerceGet.mockRejectedValueOnce(new Error('detail unavailable')).mockResolvedValueOnce(run('22222222-2222-4222-8222-222222222222'))
    } else {
      api.canvasList.mockResolvedValue([{ id: 'canvas-a', title: 'A', revision: 1, nodeCount: 1, createdAt: 2, updatedAt: 4 }])
      api.canvasRead.mockRejectedValueOnce(new Error('detail unavailable')).mockResolvedValueOnce(document('wrong-canvas'))
    }
    await expect(listAdditionalGenerationHistory(api)).rejects.toThrow('读取失败：detail unavailable')
    await expect(listAdditionalGenerationHistory(api)).rejects.toThrow('生成记录格式无效')
  })

  it('rejects foreign output URLs and malformed store indexes visibly', async () => {
    const api = mockApi()
    const saved = run()
    saved.slots[0].images[0].url = 'https://remote.invalid/image.png'
    api.ecommerceList.mockResolvedValue([summary()])
    api.ecommerceGet.mockResolvedValue(saved)
    await expect(listAdditionalGenerationHistory(api)).rejects.toThrow('生成图片地址无效')
    api.ecommerceList.mockResolvedValue(null as unknown as EcommerceRunSummary[])
    await expect(listAdditionalGenerationHistory(api)).rejects.toThrow('生成记录格式无效')
  })
})

describe('generation history hash retention', () => {
  const savedImage = { url: '/api/dsh-imagegen/history/image/shared-0.png', mime: 'image/png', sha256: hash('a') }

  it('keeps native copies deduplicated after a mutation returns the remaining history without hashes', () => {
    const previous = [history('ordinary', [{ ...savedImage, url: '/api/dsh-imagegen/history/image/ordinary-0.png' }]),
      history('canvas', [savedImage], { canvas: { canvasId: 'canvas-a' } })]
    const next = [history('canvas', [{ url: savedImage.url, mime: savedImage.mime }], { canvas: { canvasId: 'canvas-a' } })]
    const native = [extra('canvas-copy', [{ url: `/api/dsh-imagegen/canvas/asset/${hash('a')}.png`, mime: 'image/png' }], { kind: 'canvas', canvasId: 'canvas-a' })]
    const before = structuredClone(next)
    expect(mergeGenerationOverview(next, native)).toHaveLength(2)
    const retained = preserveGenerationHistoryHashes(next, previous)
    expect(mergeGenerationOverview(retained, native)).toHaveLength(1)
    expect(retained[0].images[0].sha256).toBe(hash('a'))
    expect(retained.map(entry => entry.id)).toEqual(['canvas'])
    expect(preserveGenerationHistoryHashes([], previous)).toEqual([])
    expect(next).toEqual(before)
    expect(previous[1].images[0]).toEqual(savedImage)
  })

  it('does not reuse hashes for different entries, URLs, MIME types or invalid previous hashes', () => {
    const previous = [history('shared', [savedImage]), history('invalid', [{ ...savedImage, sha256: 'invalid' }])]
    const next = [history('different-id', [{ url: savedImage.url, mime: savedImage.mime }]),
      history('shared', [{ url: '/api/dsh-imagegen/history/image/replaced-0.png', mime: savedImage.mime }, { url: savedImage.url, mime: 'image/jpeg' }]),
      history('invalid', [{ url: savedImage.url, mime: savedImage.mime }])]
    expect(preserveGenerationHistoryHashes(next, previous)).toEqual(next)
    expect(preserveGenerationHistoryHashes(next, previous).flatMap(entry => entry.images).every(image => image.sha256 === undefined)).toBe(true)
  })

  it('keeps an explicit new server hash ahead of an older hash for the same reference', () => {
    const previous = [history('shared', [savedImage])]
    const next = [history('shared', [{ ...savedImage, sha256: hash('b') }])]
    expect(preserveGenerationHistoryHashes(next, previous)).toEqual(next)
    expect(preserveGenerationHistoryHashes(next, previous)[0].images[0].sha256).toBe(hash('b'))
  })
})

describe('generation overview merge', () => {
  it('retains the real legacy run owner when copied assets replace an old project-id history URL', async () => {
    const api = mockApi()
    const legacyId = `legacy-${'d'.repeat(32)}`
    const legacy = run(legacyId)
    legacy.legacy = true
    legacy.slots[0].request = request({ workflow: 'ecommerce', projectId: 'old-product', projectName: 'Old product' })
    api.ecommerceList.mockResolvedValue([{ ...summary(legacyId), legacy: true }])
    api.ecommerceGet.mockResolvedValue(legacy)
    const image = { url: '/api/dsh-imagegen/history/image/old-result-0.png', mime: 'image/png', sha256: hash('a') }
    const shared = [history('old-result', [image], { workflow: 'ecommerce', projectId: 'old-product' }),
      history('different-product', [image], { workflow: 'ecommerce', projectId: 'other-product' })]
    const merged = mergeGenerationOverview(shared, await listAdditionalGenerationHistory(api))
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: 'old-result', projectId: 'old-product', overview: { kind: 'ecommerce', runId: legacyId } })
    expect(merged[1].overview).toBeUndefined()
    expect(shared[0]).not.toHaveProperty('overview')
  })

  it('keeps every shared request, including unknown origins and independent requests returning identical bytes', () => {
    const image = { url: '/api/dsh-imagegen/history/image/shared-0.png', mime: 'image/png', sha256: hash('a') }
    const shared = [history('ordinary-a', [image]), history('ordinary-b', [image]), history('canvas', [image], { canvas: { canvasId: 'canvas-a' } }),
      history('ecommerce', [image], { workflow: 'ecommerce', projectId: RUN }),
      history('unknown', [image], { workflow: 'other' as 'ecommerce' }), history('empty-legacy', [])]
    const before = structuredClone(shared)
    const merged = mergeGenerationOverview(shared, [extra('copied', [output('a')], { kind: 'ecommerce', runId: RUN })])
    expect(merged.map(entry => entry.id)).toEqual(shared.map(entry => entry.id))
    expect(merged.find(entry => entry.id === 'ecommerce')?.overview).toEqual({ kind: 'ecommerce', runId: RUN })
    expect(merged.filter(entry => entry.id !== 'ecommerce').every(entry => entry.overview === undefined)).toBe(true)
    expect(shared).toEqual(before)
  })

  it('drops duplicate slot/attempt/canvas/gallery storage outputs while keeping different pictures with the same prompt', () => {
    const entries = [extra('gallery', [{ url: '/api/dsh-imagegen/gallery/image/gallery-0.png', mime: 'image/png', sha256: hash('a') }], { kind: 'gallery' }, { createdAt: 100 }),
      extra('attempt', [output('a')], { kind: 'ecommerce', runId: RUN }, { createdAt: 20 }),
      extra('slot', [output('a')], { kind: 'ecommerce', runId: RUN }),
      extra('canvas-copy', [{ url: `/api/dsh-imagegen/canvas/asset/${hash('a')}.png`, mime: 'image/png' }], { kind: 'canvas', canvasId: 'canvas-a' }),
      extra('different-image', [output('b')], { kind: 'ecommerce', runId: RUN })]
    expect(mergeGenerationOverview([], entries).map(entry => entry.id)).toEqual(['attempt', 'different-image'])
  })

  it('removes only duplicated images from a multi-image result without changing the source arrays', () => {
    const shared = [history('shared', [output('a')])]
    const entries = [extra('more', [output('a'), output('b')], { kind: 'ecommerce', runId: RUN })]
    const merged = mergeGenerationOverview(shared, entries)
    expect(merged.find(entry => entry.id === 'more')).toMatchObject({ images: [output('b')], n: 1 })
    expect(entries[0].images).toHaveLength(2)
    expect(entries[0].n).toBe(2)
  })

  it('uses URL identity when hashes are absent, and recognizes legacy ecommerce asset hashes as copies', () => {
    const sharedImage = { url: '/api/dsh-imagegen/history/image/original-0.png', mime: 'image/png', sha256: hash('a') }
    const sameUrl = { url: '/api/dsh-imagegen/gallery/image/no-hash-0.png', mime: 'image/png' }
    const legacyId = `legacy-${'d'.repeat(32)}`
    const merged = mergeGenerationOverview([history('original', [sharedImage])], [
      extra('legacy-copy', [output('a', legacyId)], { kind: 'ecommerce', runId: legacyId }),
      extra('url-a', [sameUrl], { kind: 'gallery' }), extra('url-b', [sameUrl], { kind: 'gallery' }),
      extra('different-url', [{ ...sameUrl, url: '/api/dsh-imagegen/gallery/image/another-0.png' }], { kind: 'gallery' }),
    ])
    expect(merged.map(entry => entry.id)).toEqual(['original', 'url-a', 'different-url'])
  })

  it('adds native overview navigation only for an exact existing source and project match', () => {
    const image = output('c')
    const shared = [history('canvas-match', [image], { canvas: { canvasId: 'canvas-a' } }),
      history('canvas-other', [image], { canvas: { canvasId: 'canvas-b' } }),
      history('mixed-unknown', [image], { canvas: { canvasId: 'canvas-a' }, workflow: 'ecommerce', projectId: RUN })]
    const merged = mergeGenerationOverview(shared, [extra('canvas-copy', [{ ...image, url: `/api/dsh-imagegen/canvas/asset/${hash('c')}.png` }], { kind: 'canvas', canvasId: 'canvas-a' })])
    expect(merged[0].overview).toEqual({ kind: 'canvas', canvasId: 'canvas-a' })
    expect(merged[1].overview).toBeUndefined()
    expect(merged[2].overview).toBeUndefined()
  })
})
