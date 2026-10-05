import { afterEach, describe, expect, it, vi } from 'vitest'
import { listImagegenImages, readImagegenFile, type ImagegenImage, type ImagegenSource } from '../src/client/imagegen-library.ts'

const BASE = '/api/dsh-imagegen'
const runId = '11111111-1111-4111-8111-111111111111'
const hash = 'a'.repeat(64)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
})
const imageUrl = `${BASE}/history/image/generated-0.png`
const image = (overrides: Partial<ImagegenImage> = {}): ImagegenImage => ({
  id: 'normal:generated:0', url: imageUrl, name: '城市风景-1', prompt: '城市风景',
  createdAt: 10, source: 'normal', label: '普通生成', ...overrides,
})
const entry = (id: string, createdAt: number, urls: string[], prompt = '生成提示词') => ({
  id, createdAt, prompt, images: urls.map(url => ({ url, mime: 'image/png' })),
})

afterEach(() => vi.unstubAllGlobals())

describe('existing e图宝 image lists', () => {
  it.each(['normal', 'canvas'] as const)('reads %s history scope without generating and keeps multi-image order', async source => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url === `${BASE}/canvas/list`
      ? json({ ok: true, projects: [] }) : json({ ok: true, entries: [
      entry('older', 1, [`${BASE}/history/image/older-0.png`]),
      entry('newer', 2, [`${BASE}/history/image/newer-0.png`, `${BASE}/history/image/newer-1.webp`]),
    ] }))
    vi.stubGlobal('fetch', fetcher)
    const result = await listImagegenImages(source)
    expect(fetcher).toHaveBeenCalledTimes(source === 'canvas' ? 2 : 1)
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe(`${BASE}/history/list`)
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'same-origin' })
    expect(JSON.parse(options.body)).toEqual({ scope: source, includeImageHashes: true })
    expect(result.map(row => row.url)).toEqual([
      `${BASE}/history/image/newer-0.png`, `${BASE}/history/image/newer-1.webp`, `${BASE}/history/image/older-0.png`,
    ])
    expect(result[0]).toMatchObject({ source, prompt: '生成提示词', createdAt: 2,
      label: source === 'canvas' ? '画布生成' : '普通生成', name: '生成提示词-1' })
  })

  it('reads gallery entries with the gallery source and removes duplicate URLs', async () => {
    const url = `${BASE}/gallery/image/favorite-0.jpg`
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true, entries: [
      entry('a', 12, [url]), entry('b', 10, [url]),
    ] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await listImagegenImages('gallery')).toEqual([
      expect.objectContaining({ url, source: 'gallery', label: '图库收藏' }),
    ])
    expect(fetcher.mock.calls[0]).toEqual([`${BASE}/gallery/list`, expect.objectContaining({ method: 'POST', body: '{"includeImageHashes":true}' })])
  })

  it('reads ecommerce outputs only, including successful images in a partial run', async () => {
    const first = `${BASE}/ecommerce/asset/${runId}/${hash}.png`
    const second = `${BASE}/ecommerce/asset/${runId}/${'b'.repeat(64)}.webp`
    const fetcher = vi.fn().mockImplementation(async (url: string) => url === `${BASE}/ecommerce/list`
      ? json({ ok: true, runs: [{ id: runId, name: '商品A' }] })
      : json({ ok: true, run: {
        id: runId, createdAt: 17, status: 'partial-failed',
        config: { assets: [{ url: 'https://example.test/reference.png' }] },
        slots: [
          { key: 'main-1', label: '主图', status: 'completed', request: { prompt: '主图提示词', image: 'https://example.test/reference.png' }, images: [{ url: first }, { url: second }] },
          { key: 'scene-1', label: '场景', status: 'failed', request: { prompt: '场景提示词' }, images: [] },
        ],
      } }))
    vi.stubGlobal('fetch', fetcher)
    const images = await listImagegenImages('ecommerce')
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      `${BASE}/ecommerce/list`, `${BASE}/ecommerce/get?id=${runId}`,
    ])
    expect(fetcher.mock.calls.every(call => call[1].method === 'GET')).toBe(true)
    expect(images.map(row => row.url)).toEqual([first, second])
    expect(images[0]).toMatchObject({ name: '商品A-主图-1', prompt: '主图提示词', createdAt: 17,
      source: 'ecommerce', label: '商品套图' })
  })

  it('bounds ecommerce detail reads to three and preserves list order despite out-of-order responses', async () => {
    const ids = Array.from({ length: 5 }, (_, index) => `${index + 1}`.repeat(8) + '-1111-4111-8111-111111111111')
    const waiting = new Map<string, () => void>()
    let active = 0
    let maximum = 0
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url === `${BASE}/ecommerce/list`) return json({ ok: true, runs: ids.map(id => ({ id, name: id })) })
      const id = new URL(url, 'http://localhost').searchParams.get('id')!
      active++
      maximum = Math.max(maximum, active)
      await new Promise<void>(resolve => waiting.set(id, resolve))
      active--
      return json({ ok: true, run: { id, createdAt: 20,
        slots: [{ key: 'main', label: '主图', request: { prompt: '测试' }, images: [{ url: `${BASE}/ecommerce/asset/${id}/${String(ids.indexOf(id) + 1).repeat(64)}.png` }] }],
      } })
    })
    vi.stubGlobal('fetch', fetcher)
    const result = listImagegenImages('ecommerce')
    await vi.waitFor(() => expect(waiting.size).toBe(3))
    waiting.get(ids[2]!)!()
    await vi.waitFor(() => expect(waiting.has(ids[3]!)).toBe(true))
    waiting.get(ids[1]!)!()
    await vi.waitFor(() => expect(waiting.has(ids[4]!)).toBe(true))
    for (const id of [ids[4]!, ids[3]!, ids[0]!]) waiting.get(id)!()
    expect((await result).map(row => row.id.split(':')[1])).toEqual(ids)
    expect(maximum).toBe(3)
  })

  it.each([
    ['HTTP error', json({ ok: true, entries: [] }, 500), '读取 e图宝生成记录失败'],
    ['business failure', json({ ok: false, message: '历史读取失败' }), '历史读取失败'],
    ['missing module', json({ ok: false }, 404), '暂未就绪'],
    ['starting module', json({ ok: false }, 503), '暂未就绪'],
    ['HTML fallback', new Response('<html>loading</html>'), '暂未就绪'],
    ['malformed body', json({ ok: true, entries: null }), '格式无效'],
    ['missing envelope', json({ entries: [] }), '读取 e图宝生成记录失败'],
  ])('reports %s as an error, not an empty image list', async (_name, response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(listImagegenImages('normal')).rejects.toThrow(message as string)
  })

  it('propagates a failed ecommerce detail instead of returning partial success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ok: true, runs: [{ id: runId }] }))
      .mockResolvedValueOnce(json({ ok: false, message: '商品历史损坏' })))
    await expect(listImagegenImages('ecommerce')).rejects.toThrow('商品历史损坏')
  })

  it('rejects source-mismatched and unsafe record URLs before any image read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true,
      entries: [entry('source', 1, [`${BASE}/gallery/image/source-0.png`])],
    })))
    await expect(listImagegenImages('normal')).rejects.toThrow('图片地址无效')
  })

  it('rejects redirects in JSON reads', async () => {
    const redirected = json({ ok: true, entries: [] })
    Object.defineProperty(redirected, 'redirected', { value: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirected))
    await expect(listImagegenImages('normal')).rejects.toThrow('接口发生跳转')
  })

  it('forwards AbortSignal and leaves abort errors intact', async () => {
    const controller = new AbortController()
    const abort = new DOMException('cancelled', 'AbortError')
    const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(abort), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const pending = listImagegenImages('normal', controller.signal)
    controller.abort(abort)
    await expect(pending).rejects.toBe(abort)
    expect(fetcher.mock.calls[0]![1].signal).toBe(controller.signal)
    await expect(listImagegenImages('normal', controller.signal)).rejects.toBe(abort)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('all existing e图宝 results', () => {
  const assetUrl = `${BASE}/canvas/asset/${hash}.png`
  const canvasNode = (id: string, asset: Record<string, unknown>, metadata: Record<string, unknown> = {}, type = 'image') => ({
    id, type, title: `结果${id}`, metadata: { ...metadata, asset },
  })
  const generated = (url = assetUrl, overrides: Record<string, unknown> = {}) => ({
    origin: 'generated', mime: 'image/png', url, ...overrides,
  })
  const document = (id: string, nodes: unknown[], overrides: Record<string, unknown> = {}) => ({
    id, title: '验收画布', createdAt: 1, updatedAt: 7, nodes, ...overrides,
  })
  const emptyList = (url: string) => json({ ok: true,
    ...(url.endsWith('/ecommerce/list') ? { runs: [] }
      : url.endsWith('/canvas/list') ? { projects: [] } : { entries: [] }),
  })

  it('combines unscoped legacy history, ecommerce, gallery and canvas outputs in date order with true source labels', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string, options) => {
      if (url === `${BASE}/history/list`) return json({ ok: true, entries: [
        entry('ordinary', 10, [`${BASE}/history/image/ordinary-0.png`]),
        { ...entry('canvas', 9, [`${BASE}/history/image/canvas-0.png`]), canvas: { canvasId: 'canvas-a' } },
        { ...entry('legacy', 8, [`${BASE}/history/image/legacy-0.png`]), workflow: 'ecommerce' },
        { ...entry('ambiguous', 6, [`${BASE}/history/image/ambiguous-0.png`]), workflow: 'ecommerce', canvas: { canvasId: 'canvas-a' } },
        { ...entry('malformed', 5, [`${BASE}/history/image/malformed-0.png`]), canvas: null },
      ] })
      if (url === `${BASE}/gallery/list`) return json({ ok: true, entries: [entry('favorite', 11, [`${BASE}/gallery/image/favorite-0.png`])] })
      if (url === `${BASE}/ecommerce/list`) return json({ ok: true, runs: [{ id: runId, name: '商品' }] })
      if (url === `${BASE}/ecommerce/get?id=${runId}`) return json({ ok: true, run: { id: runId, createdAt: 12,
        slots: [{ key: 'main', label: '主图', request: { prompt: '主图' }, images: [{ url: `${BASE}/ecommerce/asset/${runId}/${'b'.repeat(64)}.png` }] }],
      } })
      if (url === `${BASE}/canvas/list`) return json({ ok: true, projects: [{ id: 'canvas-a' }] })
      if (url === `${BASE}/canvas/read`) {
        expect(JSON.parse(options.body)).toEqual({ id: 'canvas-a' })
        return json({ ok: true, document: document('canvas-a', [canvasNode('generated', generated(), { prompt: '画布提示词' })]) })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const images = await listImagegenImages('all')
    expect(images.map(row => [row.createdAt, row.source])).toEqual([
      [12, 'ecommerce'], [11, 'gallery'], [10, 'normal'], [9, 'canvas'],
      [8, 'ecommerce'], [7, 'canvas'], [6, 'unknown'], [5, 'unknown'],
    ])
    expect(images.at(-1)).toMatchObject({ label: '生成历史' })
    const historyCall = fetcher.mock.calls.find(call => call[0] === `${BASE}/history/list`)!
    expect(JSON.parse(historyCall[1].body)).toEqual({ includeImageHashes: true })
    expect(fetcher.mock.calls.every(call => call[1].redirect === 'error' && call[1].credentials === 'same-origin')).toBe(true)
    expect(fetcher.mock.calls.every(call => !call[0].endsWith('/generate') && !call[0].includes('/asset/'))).toBe(true)
  })

  it('starts independent source lists concurrently and still shows results when ordinary history is empty', async () => {
    const releases = new Map<string, () => void>()
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      await new Promise<void>(resolve => releases.set(url, resolve))
      return url === `${BASE}/gallery/list`
        ? json({ ok: true, entries: [entry('only', 1, [`${BASE}/gallery/image/only-0.png`])] }) : emptyList(url)
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = listImagegenImages('all')
    await vi.waitFor(() => expect(releases.size).toBe(4))
    for (const release of releases.values()) release()
    expect(await pending).toEqual([expect.objectContaining({ source: 'gallery' })])
  })

  it('deduplicates repeated URLs and verified canvas/ecommerce byte hashes, without guessing history/gallery identity', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string, options) => {
      if (url === `${BASE}/history/list`) return json({ ok: true, entries: [
        entry('old', 1, [`${BASE}/history/image/shared-0.png`], '同一提示词'),
        entry('new', 8, [`${BASE}/history/image/shared-0.png`], '更新提示词'),
      ] })
      if (url === `${BASE}/gallery/list`) return json({ ok: true, entries: [
        entry('gallery', 7, [`${BASE}/gallery/image/shared-0.png`], '同一提示词'),
      ] })
      if (url === `${BASE}/canvas/list`) return json({ ok: true, projects: [{ id: 'canvas-a' }, { id: 'canvas-b' }] })
      if (url === `${BASE}/canvas/read`) return json({ ok: true, document: document(
        JSON.parse(options.body).id, [canvasNode('shared', generated())], { updatedAt: 6 },
      ) })
      if (url === `${BASE}/ecommerce/list`) return json({ ok: true, runs: [{ id: runId }] })
      return json({ ok: true, run: { id: runId, createdAt: 5,
        slots: [{ key: 'main', request: { prompt: '相同字节' }, images: [{ url: `${BASE}/ecommerce/asset/${runId}/${hash}.png` }] }],
      } })
    })
    vi.stubGlobal('fetch', fetcher)
    const images = await listImagegenImages('all')
    expect(images).toHaveLength(3)
    expect(images.map(row => row.source)).toEqual(['normal', 'gallery', 'ecommerce'])
    expect(images[0]!.prompt).toBe('更新提示词')
  })

  it('merges verified bytes across all stores and retains readable metadata and every search alias', async () => {
    const withHash = (record: ReturnType<typeof entry>) => ({ ...record, images: record.images.map(image => ({ ...image, sha256: hash })) })
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url === `${BASE}/history/list`) return json({ ok: true, entries: [withHash(entry('history', 20, [imageUrl], '原始生成描述'))] })
      if (url === `${BASE}/gallery/list`) return json({ ok: true, entries: [withHash(entry('favorite', 21, [`${BASE}/gallery/image/favorite-0.png`], '图库别名'))] })
      if (url === `${BASE}/canvas/list`) return json({ ok: true, projects: [{ id: 'canvas-a' }] })
      if (url === `${BASE}/canvas/read`) return json({ ok: true, document: document('canvas-a', [canvasNode('node', generated())], { updatedAt: 22 }) })
      if (url === `${BASE}/ecommerce/list`) return json({ ok: true, runs: [{ id: runId, name: '商品A' }] })
      return json({ ok: true, run: { id: runId, createdAt: 19,
        slots: [{ key: 'main', label: '主图', request: { prompt: '商品构图' }, images: [{ url: `${BASE}/ecommerce/asset/${runId}/${hash}.png` }] }],
      } })
    })
    vi.stubGlobal('fetch', fetcher)
    const [result] = await listImagegenImages('all')
    expect(result).toMatchObject({ source: 'ecommerce', name: '商品A-主图-1', createdAt: 22 })
    expect(result!.searchText).toContain('原始生成描述')
    expect(result!.searchText).toContain('图库别名')
    expect(result!.searchText).toContain('结果node')
    expect(result!.searchText).toContain('商品构图')
    expect(await listImagegenImages('all')).toHaveLength(1)
    expect(fetcher.mock.calls.every(call => !call[0].includes('/asset/') && !call[0].includes('/image/'))).toBe(true)
  })

  it('merges canvas-history copies with canvas nodes while keeping the generation prompt as the representative', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === `${BASE}/history/list`) return json({ ok: true, entries: [{ ...entry('canvas', 3, [imageUrl], '完整生成提示词'),
        images: [{ url: imageUrl, mime: 'image/png', sha256: hash }],
      }] })
      if (url === `${BASE}/canvas/list`) return json({ ok: true, projects: [{ id: 'canvas-a' }] })
      return json({ ok: true, document: document('canvas-a', [canvasNode('node', generated())]) })
    }))
    expect(await listImagegenImages('canvas')).toEqual([expect.objectContaining({ name: '完整生成提示词-1',
      prompt: '完整生成提示词', source: 'canvas', createdAt: 7,
    })])
  })

  it('keeps different byte hashes even when their prompt and display name are identical', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, entries: [
      { ...entry('first', 2, [`${BASE}/history/image/first-0.png`], '同一提示词'), images: [{ url: `${BASE}/history/image/first-0.png`, sha256: hash }] },
      { ...entry('second', 1, [`${BASE}/history/image/second-0.png`], '同一提示词'), images: [{ url: `${BASE}/history/image/second-0.png`, sha256: 'b'.repeat(64) }] },
    ] })))
    const images = await listImagegenImages('normal')
    expect(images).toHaveLength(2)
    expect(images.map(image => image.name)).toEqual(['同一提示词-1', '同一提示词-1'])
  })

  it('falls back to URL identity when hashes are missing or malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, entries: [
      { ...entry('first', 3, [`${BASE}/history/image/first-0.png`]), images: [{ url: `${BASE}/history/image/first-0.png`, sha256: 'invalid' }] },
      { ...entry('second', 2, [`${BASE}/history/image/second-0.png`]), images: [{ url: `${BASE}/history/image/second-0.png`, sha256: 'invalid' }] },
      entry('missing', 1, [`${BASE}/history/image/missing-0.png`]),
    ] })))
    expect(await listImagegenImages('normal')).toHaveLength(3)
  })

  it('merges a repeated URL even if one record lacks a hash and then merges its verified copy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, entries: [
      entry('missing', 3, [imageUrl], '无哈希名称'),
      { ...entry('verified', 2, [imageUrl], '有哈希名称'), images: [{ url: imageUrl, sha256: hash }] },
      { ...entry('copy', 1, [`${BASE}/history/image/copy-0.png`], '副本名称'), images: [{ url: `${BASE}/history/image/copy-0.png`, sha256: hash }] },
    ] })))
    const images = await listImagegenImages('normal')
    expect(images).toHaveLength(1)
    expect(images[0]!.searchText).toContain('有哈希名称')
    expect(images[0]!.searchText).toContain('副本名称')
  })

  it('includes skill-produced file images and finished canvas results absent from history, excluding all input and non-image assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === `${BASE}/canvas/list`) return json({ ok: true, projects: [{ id: 'canvas-a' }] })
      if (url === `${BASE}/canvas/read`) return json({ ok: true, document: document('canvas-a', [
        canvasNode('file-result', generated(assetUrl, { name: '技能结果.png', kind: 'file' }), { skill: { createdAt: 20 } }, 'file'),
        canvasNode('final', generated(`${BASE}/canvas/asset/${'c'.repeat(64)}.webp`, { mime: 'image/webp' }), { prompt: '最终合成' }),
        ...['upload', 'history', 'gallery'].map(origin => canvasNode(origin, generated(assetUrl, { origin }))),
        canvasNode('pdf', generated(`${BASE}/canvas/asset/${'d'.repeat(64)}.pdf`, { mime: 'application/pdf' }), {}, 'file'),
        { id: 'pending', type: 'image', metadata: { status: 'generating' } },
      ]) })
      return emptyList(url)
    }))
    const images = await listImagegenImages('canvas')
    expect(images.map(row => [row.name, row.createdAt])).toEqual([['技能结果.png', 20], ['结果final', 7]])
    expect(images[1]!.prompt).toBe('最终合成')
  })

  it('retains previous ecommerce attempt outputs and removes their copies of current output without reading request references', async () => {
    const current = `${BASE}/ecommerce/asset/${runId}/${hash}.png`
    const older = `${BASE}/ecommerce/asset/${runId}/${'b'.repeat(64)}.webp`
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url === `${BASE}/ecommerce/list`
      ? json({ ok: true, runs: [{ id: runId, name: '商品' }] })
      : json({ ok: true, run: { id: runId, createdAt: 1,
        slots: [{ key: 'main', label: '主图', request: { prompt: '本次提示词', image: 'https://example.test/input.png' }, images: [{ url: current }],
          attempts: [
            { number: 1, finishedAt: 3, request: { prompt: '旧次提示词', images: ['https://example.test/input.png'] }, images: [{ url: older }] },
            { number: 2, finishedAt: 5, request: { prompt: '本次提示词' }, images: [{ url: current }] },
          ],
        }],
      } })))
    const images = await listImagegenImages('ecommerce')
    expect(images.map(row => row.url)).toEqual([current, older])
    expect(images.map(row => row.prompt)).toEqual(['本次提示词', '旧次提示词'])
    expect(images[1]!.name).toContain('第1次')
  })

  it.each([
    [`${BASE}/history/list`, '生成历史'], [`${BASE}/canvas/list`, '画布生成'],
    [`${BASE}/ecommerce/list`, '商品套图'], [`${BASE}/gallery/list`, '图库收藏'],
  ])('reports a failed aggregate source %s instead of silently omitting its pictures', async (failedUrl, label) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url === failedUrl
      ? json({ ok: false, message: '读取被拒绝' }) : emptyList(url)))
    await expect(listImagegenImages('all')).rejects.toThrow(`${label}读取失败：读取被拒绝`)
  })

  it('forwards cancellation to every aggregate source and makes no request after cancellation', async () => {
    const controller = new AbortController()
    const abort = new DOMException('cancelled', 'AbortError')
    const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(abort), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const pending = listImagegenImages('all', controller.signal)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher.mock.calls.every(call => call[1].signal === controller.signal)).toBe(true)
    controller.abort(abort)
    await expect(pending).rejects.toBe(abort)
    await expect(listImagegenImages('all', controller.signal)).rejects.toBe(abort)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('bounds canvas document reads to three while preserving simultaneous source access', async () => {
    const ids = ['canvas-a', 'canvas-b', 'canvas-c', 'canvas-d']
    const waiting = new Map<string, () => void>()
    let active = 0
    let maximum = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, options) => {
      if (url === `${BASE}/canvas/list`) return json({ ok: true, projects: ids.map(id => ({ id })) })
      if (url !== `${BASE}/canvas/read`) return emptyList(url)
      const { id } = JSON.parse(options.body)
      active++
      maximum = Math.max(maximum, active)
      await new Promise<void>(resolve => waiting.set(id, resolve))
      active--
      return json({ ok: true, document: document(id, []) })
    }))
    const pending = listImagegenImages('all')
    await vi.waitFor(() => expect(waiting.size).toBe(3))
    waiting.get('canvas-b')!()
    await vi.waitFor(() => expect(waiting.has('canvas-d')).toBe(true))
    for (const id of ['canvas-d', 'canvas-c', 'canvas-a']) waiting.get(id)!()
    expect(await pending).toEqual([])
    expect(maximum).toBe(3)
  })

  it('rejects unsafe canvas output paths before any asset download', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url === `${BASE}/canvas/list`
      ? json({ ok: true, projects: [{ id: 'canvas-a' }] }) : url === `${BASE}/canvas/read`
        ? json({ ok: true, document: document('canvas-a', [canvasNode('unsafe', generated(`${assetUrl}?inline=1`))]) })
        : emptyList(url))
    vi.stubGlobal('fetch', fetcher)
    await expect(listImagegenImages('all')).rejects.toThrow('画布生成读取失败：e图宝图片地址无效')
    expect(fetcher.mock.calls.every(call => !call[0].includes('/asset/'))).toBe(true)
  })
})

describe('reading existing e图宝 image bytes', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('returns an uploadable %s File from the same origin', async mime => {
    const controller = new AbortController()
    const bytes = new Uint8Array([1, 2, 3])
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': mime } }))
    vi.stubGlobal('fetch', fetcher)
    const file = await readImagegenFile(image(), controller.signal)
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe(mime)
    expect(file.size).toBe(3)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(file.name).toBe(`城市风景-1.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`)
    expect(fetcher).toHaveBeenCalledWith(imageUrl, expect.objectContaining({
      redirect: 'error', signal: controller.signal, credentials: 'same-origin',
    }))
  })

  it.each([
    'https://example.test/image.png', `//example.test${imageUrl}`, `${imageUrl}?token=1`, `${imageUrl}#preview`,
    `${BASE}/history/image/../secret-0.png`, `${BASE}/history/image/%2e%2e-0.png`,
    `${BASE}/history/image/secret\\-0.png`, `${imageUrl}\n`, `${BASE}/canvas/asset/${hash}.png`,
  ])('refuses an unsafe URL %s without making a request', async url => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(readImagegenFile(image({ url }))).rejects.toThrow('图片地址无效')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['gallery', `${BASE}/gallery/image/favorite-0.jpg`],
    ['canvas', `${BASE}/history/image/canvas-0.webp`],
    ['canvas', `${BASE}/canvas/asset/${hash}.png`],
    ['ecommerce', `${BASE}/ecommerce/asset/legacy-${'b'.repeat(32)}/${hash}.png`],
    ['ecommerce', `${BASE}/history/image/legacy-0.png`],
    ['unknown', `${BASE}/history/image/ambiguous-0.png`],
  ] as Array<[ImagegenSource, string]>)('allows the controlled %s path', async (source, url) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } })))
    expect((await readImagegenFile(image({ source, url }))).size).toBe(5)
  })

  it('refuses redirected bytes and a changed response origin', async () => {
    const response = new Response('image', { headers: { 'content-type': 'image/png' } })
    Object.defineProperty(response, 'redirected', { value: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(readImagegenFile(image())).rejects.toThrow('接口发生跳转')
    const changed = new Response('image', { headers: { 'content-type': 'image/png' } })
    Object.defineProperty(changed, 'url', { value: `https://other.test${imageUrl}` })
    vi.stubGlobal('location', { href: 'http://127.0.0.1:20240/' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(changed))
    await expect(readImagegenFile(image())).rejects.toThrow('地址不一致')
  })

  it.each([
    [new Response('image', { headers: { 'content-type': 'image/gif' } }), '仅支持'],
    [new Response('html', { headers: { 'content-type': 'text/html' } }), '仅支持'],
    [new Response('', { headers: { 'content-type': 'image/png' } }), '图片为空'],
    [new Response('oversize', { headers: { 'content-type': 'image/png', 'content-length': `${20 * 1024 * 1024 + 1}` } }), '20MB'],
    [new Response(null, { status: 404 }), '已删除'],
    [new Response(null, { status: 500 }), '读取 e图宝图片失败'],
  ])('rejects unavailable, unsupported, empty, or declared oversized images', async (response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(readImagegenFile(image())).rejects.toThrow(message as string)
  })

  it('checks actual byte size even when content-length is absent or incorrect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(20 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'image/png', 'content-length': '1' },
    })))
    await expect(readImagegenFile(image())).rejects.toThrow('20MB')
  })

  it('allows the 20MiB limit and normalizes a safe filename', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(20 * 1024 * 1024), {
      headers: { 'content-type': 'image/png' },
    })))
    const file = await readImagegenFile(image({ name: '../图:片.webp' }))
    expect(file.size).toBe(20 * 1024 * 1024)
    expect(file.name).toBe('.._图_片.png')
  })

  it('does not mask abort or fetch redirected-request rejection as successful image bytes', async () => {
    const abort = new DOMException('cancelled', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
    await expect(readImagegenFile(image())).rejects.toBe(abort)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(readImagegenFile(image())).rejects.toThrow('读取 e图宝图片失败')
  })
})
