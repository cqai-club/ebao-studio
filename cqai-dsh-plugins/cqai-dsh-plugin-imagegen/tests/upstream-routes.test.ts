import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { makeRoutes, type ImageGenRoutesDeps } from '../src/routes.ts'
import { GenerationTaskQueue } from '../src/task-queue.ts'
import { CANVAS_API, PROMPT_ENHANCE_API, TASK_API, TEMPLATE_FAVORITES_API, TEMPLATES_API, type GenerateRequest } from '../src/protocol.ts'

function deps(extra: Partial<ImageGenRoutesDeps> = {}): ImageGenRoutesDeps {
  return { settings: { describe: () => [], mutate: async () => {} }, resolve: () => ({ apiUrl: '', apiKey: '' }), ...extra }
}

async function call(dependencies: ImageGenRoutesDeps, pathname: string, body: unknown, crossSite = false, method = 'POST'): Promise<{ status: number; body: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method, url: pathname,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'localhost:8888', ...(crossSite ? { 'sec-fetch-site': 'cross-site' } : {}) },
  }) as unknown as IncomingMessage
  let status = 0
  let response = ''
  const res = { writeHead: (code: number) => { status = code }, end: (data: string | Buffer) => { response = data.toString() } } as unknown as ServerResponse
  const route = makeRoutes(dependencies).find(item => item.kind === 'prefix' ? pathname.startsWith(item.path) : item.path === pathname)!
  await route.handler(req, res)
  return { status, body: response.startsWith('{') ? JSON.parse(response) : response }
}

describe('selective upstream route integration', () => {
  it('serves queue summaries and retrieves detail through a guarded endpoint', async () => {
    const queue = new GenerationTaskQueue(async () => ({ images: [{ b64: 'result-bytes', mime: 'image/png' }] }))
    const request: GenerateRequest = { mode: 'edit', model: 'image', prompt: 'product', size: '1:1', quality: 'auto', n: 1, detail: '', image: 'reference-bytes' }
    const submitted = queue.submit(request)
    await vi.waitFor(() => expect(queue.get(submitted.id)?.status).toBe('completed'))
    const dependencies = deps({ runtime: { queue } as ImageGenRoutesDeps['runtime'] })
    const listed = await call(dependencies, TASK_API.list, {})
    expect(listed.body.tasks[0]).toMatchObject({ status: 'completed', resultAvailable: true })
    expect(JSON.stringify(listed.body)).not.toMatch(/reference-bytes|result-bytes/)
    expect((await call(dependencies, TASK_API.get, { id: submitted.id })).body.task.result.images[0].b64).toBe('result-bytes')
    expect((await call(dependencies, TASK_API.get, { id: 'missing' })).body.code).toBe('not-found')
    expect((await call(dependencies, TASK_API.get, { id: submitted.id }, true)).status).toBe(403)
  })

  it('polishes through the shared CQAI completion service and rejects invalid input', async () => {
    const complete = vi.fn(async () => 'polished product prompt')
    const dependencies = deps({ cqai: { complete, describe: vi.fn(), resolveRequest: vi.fn(), listChatModels: vi.fn() } })
    expect((await call(dependencies, PROMPT_ENHANCE_API.polish, { prompt: 'Product constraints' })).body.prompt).toBe('polished product prompt')
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ content: 'Product constraints', temperature: 0.35, system: expect.stringContaining('商品事实') }))
    expect((await call(dependencies, PROMPT_ENHANCE_API.polish, { prompt: ' ' })).body.code).toBe('bad-request')
    expect((await call(dependencies, PROMPT_ENHANCE_API.polish, { prompt: 'x'.repeat(50_001) })).body.code).toBe('bad-request')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('accepts community string IDs and preserves legacy numeric favorite IDs', async () => {
    const add = vi.fn(async () => [])
    const dependencies = deps({ favorites: { list: async () => [], add, remove: async () => [] } })
    for (const [sourceId, id] of [['handraw', 'visual-card-001'], ['vibeui', 42]] as const) {
      expect((await call(dependencies, TEMPLATE_FAVORITES_API.add, { source: sourceId, case: { id, title: 'Product', prompt: 'A visual prompt' } })).body.ok).toBe(true)
      expect(add).toHaveBeenLastCalledWith(sourceId, expect.objectContaining({ id }))
    }
    expect((await call(dependencies, TEMPLATE_FAVORITES_API.add, { source: 'handraw', case: { id: {}, title: 'Product', prompt: 'A visual prompt' } })).body.ok).toBe(false)
  })

  it('decodes a full reference URL inside the source-scoped image route', async () => {
    const imageUrl = 'https://raw.githubusercontent.com/yang0/handraw-style/pinned/image.png'
    const readImage = vi.fn(async () => ({ data: Buffer.from('image-bytes'), mime: 'image/png' }))
    const dependencies = deps({ templates: { list: vi.fn(), refresh: vi.fn(), sample: vi.fn(), readImage } })
    const response = await call(dependencies, `${TEMPLATES_API.image}/handraw/${encodeURIComponent(imageUrl)}`, {}, false, 'GET')
    expect(response.status).toBe(200)
    expect(readImage).toHaveBeenCalledExactlyOnceWith('handraw', imageUrl)
    expect(response.body).toBe('image-bytes')
  })

  it('requires a boolean favorite value and retains the existing backend receiver', async () => {
    const canvas = { marker: 'store', async setFavorite(this: { marker: string }, id: string, favorite: boolean) { expect(this.marker).toBe('store'); return [{ id, favorite }] } }
    const favorite = vi.spyOn(canvas, 'setFavorite')
    const dependencies = deps({ canvas: canvas as unknown as ImageGenRoutesDeps['canvas'] })
    expect((await call(dependencies, CANVAS_API.favorite, { id: 'canvas-1', favorite: true })).body.projects).toEqual([{ id: 'canvas-1', favorite: true }])
    expect((await call(dependencies, CANVAS_API.favorite, { id: 'canvas-1', favorite: 'true' })).body.code).toBe('bad-request')
    expect(favorite).toHaveBeenCalledTimes(1)
  })
})
