import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeRoutes, type ImageGenRoutesDeps } from '../../cqai-dsh-plugin-imagegen/src/routes.ts'
import { CanvasStore } from '../../cqai-dsh-plugin-imagegen/src/canvas-store.ts'
import { makeEcommerceRoutes, disposeEcommerceRoutes } from '../../cqai-dsh-plugin-imagegen/src/ecommerce-routes.ts'
import type { HistoryEntry } from '../../cqai-dsh-plugin-imagegen/src/protocol.ts'
import { listImagegenImages, readImagegenFile } from '../src/client/imagegen-library.ts'
import { uploadAsset } from '../src/client/shared.tsx'
import { addAsset, createContent, readAsset, readContent, saveContent } from '../src/contents.ts'
import * as publisher from '../src/index.ts'
import { projectContentForPlatform } from '../src/protocol.ts'

// Only the unused UI exports are mocked; uploadAsset and both Host routes are real.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: () => null, Modal: () => null, Tag: () => null }))

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 4, 5, 6])
const roots: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function entry(id: string, images: string[], extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id, createdAt: 100, mode: 'text', model: 'image', prompt: `生成 ${id}`,
    size: '1:1', quality: 'auto', detail: '', n: images.length,
    images: images.map(url => ({ url, mime: url.endsWith('.jpg') ? 'image/jpeg' : 'image/png' })), ...extra }
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

async function fixture(historyEntries: HistoryEntry[], galleryEntries: HistoryEntry[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'publisher-imagegen-import-'))
  roots.push(home)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  const sourceBytes = new Map<string, { data: Buffer; mime: string }>([
    ['normal-0.png', { data: png, mime: 'image/png' }],
    ['normal-1.jpg', { data: jpeg, mime: 'image/jpeg' }],
    ['canvas-0.png', { data: png, mime: 'image/png' }],
    ['favorite-0.png', { data: png, mime: 'image/png' }],
  ])
  const mutations = { append: vi.fn(), remove: vi.fn(), clear: vi.fn() }
  const canvas = new CanvasStore(join(home, 'canvas'))
  const deps: ImageGenRoutesDeps = {
    settings: { describe: () => [], mutate: async () => {} },
    resolve: () => ({ apiUrl: '', apiKey: '' }),
    history: { list: async () => historyEntries, ...mutations, readImage: async file => sourceBytes.get(file) },
    gallery: { list: async () => galleryEntries, ...mutations, readImage: async file => sourceBytes.get(file) },
    canvas,
  }
  const ecommerceRuntime = { queue: {} } as never
  const imageRoutes = [...makeEcommerceRoutes({ runtime: ecommerceRuntime,
    store: { list: async () => [], dispose: async () => {} } as never,
  }), ...makeRoutes(deps)]
  let publisherHandler: Handler | undefined
  const calls: string[] = []
  const dispose = async () => {
    await ctx.fiber.dispose()
    await disposeEcommerceRoutes(ecommerceRuntime)
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  try {
    ctx.provide('webServer', { register: (route: { handler: Handler }) => {
      publisherHandler = route.handler
      return () => { publisherHandler = undefined }
    } } as never)
    ctx.provide('desktopRuntime', { publisher: {} } as never)
    await ctx.plugin(publisher)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const pathname = String(input)
      calls.push(pathname)
      const body = typeof init?.body === 'string' ? Buffer.from(init.body)
        : init?.body instanceof Blob ? Buffer.from(await init.body.arrayBuffer()) : undefined
      const req = Object.assign(Readable.from(body ? [body] : []), {
        method: init?.method ?? 'GET', url: pathname,
        headers: { host: 'localhost:8888', ...Object.fromEntries(new Headers(init?.headers).entries()) },
        socket: { remoteAddress: '127.0.0.1' },
      }) as IncomingMessage
      let status = 0
      let headers: Record<string, string | number> = {}
      let payload = Buffer.alloc(0)
      const res = { headersSent: false, destroyed: false,
        writeHead: (code: number, values: Record<string, string | number>) => { status = code; headers = values },
        end: (data: string | Buffer) => { payload = Buffer.from(data) },
      } as unknown as ServerResponse
      const route = imageRoutes.find(item => item.kind === 'prefix' ? pathname.startsWith(item.path) : pathname === item.path)
      if (route) await route.handler(req, res)
      else if (pathname.startsWith('/api/cqai-publisher/content-asset-upload/') && publisherHandler) await publisherHandler(req, res)
      else throw new Error(`Unexpected API call: ${pathname}`)
      return new Response(new Uint8Array(payload), { status,
        headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)])),
      })
    }))
    return { env: { DSH_HOME: home }, sourceBytes, historyEntries, galleryEntries, canvas, mutations, calls, dispose }
  } catch (error) { await dispose(); throw error }
}

describe('existing e图宝 images imported through real Host routes', () => {
  it('includes legacy and canvas skill outputs in all images and imports them through their original asset routes', async () => {
    const f = await fixture([
      entry('normal', ['/api/dsh-imagegen/history/image/normal-0.png']),
      entry('canvas', ['/api/dsh-imagegen/history/image/canvas-0.png'], { canvas: { canvasId: 'canvas-a' } }),
      entry('legacy', ['/api/dsh-imagegen/history/image/normal-1.jpg'], { workflow: 'ecommerce' }),
    ], [entry('favorite', ['/api/dsh-imagegen/gallery/image/favorite-0.png'])])
    try {
      f.sourceBytes.set('canvas-0.png', { data: Buffer.concat([png, Buffer.from([4])]), mime: 'image/png' })
      f.sourceBytes.set('favorite-0.png', { data: Buffer.concat([png, Buffer.from([5])]), mime: 'image/png' })
      const skillPng = Buffer.concat([png, Buffer.from([6])])
      const document = await f.canvas.create('技能结果画布')
      const asset = await f.canvas.putFile({ data: skillPng, mime: 'image/png', name: '技能结果.png', origin: 'generated', originId: 'task-output' })
      const inputAsset = await f.canvas.putImage({ data: jpeg, mime: 'image/jpeg', width: 1, height: 1, origin: 'upload' })
      await f.canvas.save({ ...document, nodes: [
        { id: 'skill-output', type: 'file', title: '技能结果', x: 0, y: 0, width: 200, height: 200, metadata: { asset } },
        { id: 'input', type: 'image', title: '上传参考图', x: 220, y: 0, width: 200, height: 200, metadata: { asset: inputAsset } },
      ] }, document.revision)
      const images = await listImagegenImages('all')
      expect(images).toHaveLength(5)
      expect(images.find(image => image.url.endsWith('normal-1.jpg'))?.source).toBe('ecommerce')
      expect(images.find(image => image.url === asset.url)).toMatchObject({ source: 'canvas' })
      expect(images.some(image => image.url === inputAsset.url)).toBe(false)
      let draft = createContent('image-note', f.env, '全部生图导入')
      const selected = [images.find(image => image.url === asset.url)!, images.find(image => image.url.endsWith('normal-1.jpg'))!]
      for (const image of selected) draft = await uploadAsset(draft.id, await readImagegenFile(image))
      const persisted = readContent(draft.id, f.env)
      expect(persisted.assets.map(item => item.mime)).toEqual(['image/png', 'image/jpeg'])
      expect(readAsset(draft.id, persisted.assets[0]!.id, f.env).data).toEqual(skillPng)
      expect(readAsset(draft.id, persisted.assets[1]!.id, f.env).data).toEqual(jpeg)
      expect(f.calls).toContain('/api/dsh-imagegen/canvas/read')
      expect(f.calls.some(path => /\/(generate|submit|retry|remove|clear|save)$/.test(path))).toBe(false)
      for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('shows one selectable image for identical history, gallery and canvas bytes and imports it without changing the sources', async () => {
    const f = await fixture([
      entry('normal', ['/api/dsh-imagegen/history/image/normal-0.png']),
      entry('canvas', ['/api/dsh-imagegen/history/image/canvas-0.png'], { canvas: { canvasId: 'canvas-a' } }),
    ], [entry('favorite', ['/api/dsh-imagegen/gallery/image/favorite-0.png'])])
    try {
      const document = await f.canvas.create('重复图片验收')
      const asset = await f.canvas.putImage({ data: png, mime: 'image/png', width: 1, height: 1, origin: 'generated' })
      await f.canvas.save({ ...document, nodes: [
        { id: 'node', type: 'image', title: '图片节点', x: 0, y: 0, width: 200, height: 200, metadata: { asset } },
      ] }, document.revision)
      const images = await listImagegenImages('all')
      expect(images).toHaveLength(1)
      expect(images[0]).toMatchObject({ source: 'normal', name: '生成 normal-1', sha256: createHash('sha256').update(png).digest('hex') })
      expect(images[0]!.searchText).toContain('图片节点')
      expect(images[0]!.searchText).toContain('生成 favorite')
      let draft = createContent('image-note', f.env, '图片去重验收')
      draft = await uploadAsset(draft.id, await readImagegenFile(images[0]!))
      const saved = readContent(draft.id, f.env)
      expect(saved.assets).toHaveLength(1)
      expect(readAsset(draft.id, saved.assets[0]!.id, f.env).data).toEqual(png)
      expect(f.historyEntries).toHaveLength(2)
      expect(f.galleryEntries).toHaveLength(1)
      expect((await f.canvas.read(document.id))!.nodes).toHaveLength(1)
      for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('copies selected generation results in selection order and preserves edits and explicit platform selection', async () => {
    const f = await fixture([
      entry('normal', ['/api/dsh-imagegen/history/image/normal-0.png', '/api/dsh-imagegen/history/image/normal-1.jpg']),
      entry('canvas', ['/api/dsh-imagegen/history/image/canvas-0.png'], { canvas: { canvasId: 'canvas-a' } }),
    ])
    try {
      const normal = await listImagegenImages('normal')
      const canvas = await listImagegenImages('canvas')
      expect(normal.map(image => image.url)).toEqual([
        '/api/dsh-imagegen/history/image/normal-0.png', '/api/dsh-imagegen/history/image/normal-1.jpg',
      ])
      expect(canvas.map(image => image.url)).toEqual(['/api/dsh-imagegen/history/image/canvas-0.png'])
      let draft = createContent('image-note', f.env)
      draft = addAsset(draft.id, '原有封面.png', png, f.env)
      const originalAsset = draft.assets[0]!.id
      draft = saveContent(draft.id, { ...draft, title: '已编辑标题', body: '用户保留的正文', tags: ['原有标签'],
        coverAssetId: originalAsset, platformVariants: { xhs: { title: '小红书标题', assetOrder: [originalAsset] } },
      }, f.env)
      const initialRevision = draft.revision
      // User selection order deliberately differs from the source result order.
      for (const image of [normal[1]!, normal[0]!]) draft = await uploadAsset(draft.id, await readImagegenFile(image))
      const persisted = readContent(draft.id, f.env)
      expect(persisted).toMatchObject({ revision: initialRevision + 2, title: '已编辑标题', body: '用户保留的正文',
        tags: ['原有标签'], coverAssetId: originalAsset,
        platformVariants: { xhs: { title: '小红书标题', assetOrder: [originalAsset] } },
      })
      expect(persisted.assets.map(asset => asset.mime)).toEqual(['image/png', 'image/jpeg', 'image/png'])
      for (const [asset, bytes] of [[persisted.assets[1]!, jpeg], [persisted.assets[2]!, png]] as const) {
        expect(asset).toMatchObject({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        expect(readAsset(draft.id, asset.id, f.env).data).toEqual(bytes)
      }
      expect(projectContentForPlatform(persisted, 'xhs').assets.map(asset => asset.id)).toEqual([originalAsset])
      f.historyEntries.splice(0)
      f.sourceBytes.clear()
      expect(await listImagegenImages('normal')).toEqual([])
      expect(readAsset(draft.id, persisted.assets[1]!.id, f.env).data).toEqual(jpeg)
      expect(readAsset(draft.id, persisted.assets[2]!.id, f.env).data).toEqual(png)
      expect(f.calls.every(path => /\/(history|content-asset-upload)\//.test(path) || path === '/api/dsh-imagegen/canvas/list')).toBe(true)
      for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('imports a gallery copy into a fresh draft and inherits it on platforms following the master', async () => {
    const f = await fixture([], [entry('favorite', ['/api/dsh-imagegen/gallery/image/favorite-0.png'])])
    try {
      const [image] = await listImagegenImages('gallery')
      const created = createContent('image-note', f.env, '新图文')
      const draft = await uploadAsset(created.id, await readImagegenFile(image!))
      expect(draft).toMatchObject({ revision: created.revision + 1, title: '新图文', body: '' })
      const asset = draft.assets[0]!
      expect(asset).toMatchObject({ mime: 'image/png', bytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex') })
      expect(projectContentForPlatform(draft, 'xhs').assets.map(item => item.id)).toEqual([asset.id])
      f.galleryEntries.splice(0)
      f.sourceBytes.clear()
      expect(await listImagegenImages('gallery')).toEqual([])
      expect(readAsset(draft.id, asset.id, f.env).data).toEqual(png)
      for (const mutation of Object.values(f.mutations)) expect(mutation).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })
})
