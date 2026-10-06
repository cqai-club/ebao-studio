import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generationOrigin } from '../src/history-origin.ts'
import { appendHistory, clearHistory, listHistory, readHistoryImage, removeHistory } from '../src/history-store.ts'
import { setImageDataRoot } from '../src/image-storage-path.ts'
import { HISTORY_API, HISTORY_MAX, type HistoryEntry, type HistoryEntryInput } from '../src/protocol.ts'
import { makeRoutes, type ImageGenRoutesDeps } from '../src/routes.ts'

let root = ''
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'imagegen-history-scope-')); setImageDataRoot(root) })
afterEach(async () => { setImageDataRoot(undefined); await rm(root, { recursive: true, force: true }) })

function entry(id: string, extra: Partial<HistoryEntryInput> = {}): HistoryEntryInput {
  return { id, createdAt: Date.now(), mode: 'text', model: 'image', prompt: id, size: '1:1', quality: 'auto', detail: '', n: 1, images: [{ b64: Buffer.from(id).toString('base64'), mime: 'image/png' }], ...extra }
}

async function call(dependencies: ImageGenRoutesDeps, pathname: string, body: unknown, crossSite = false): Promise<{ status: number; body: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', url: pathname, socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'localhost:8888', ...(crossSite ? { 'sec-fetch-site': 'cross-site' } : {}) },
  }) as unknown as IncomingMessage
  let status = 0
  let payload = ''
  const res = { writeHead: (code: number) => { status = code }, end: (data: string | Buffer) => { payload = data.toString() } } as unknown as ServerResponse
  await makeRoutes(dependencies).find(route => route.path === pathname)!.handler(req, res)
  return { status, body: JSON.parse(payload) }
}

describe('history sources', () => {
  it('classifies legacy markers and retains conflicting or malformed origins as unknown', () => {
    expect(generationOrigin({})).toBe('normal')
    expect(generationOrigin({ workflow: 'ecommerce' })).toBe('ecommerce')
    expect(generationOrigin({ projectId: 'legacy-product' })).toBe('ecommerce')
    expect(generationOrigin({ slotKey: 'main-1' })).toBe('ecommerce')
    expect(generationOrigin({ canvas: { canvasId: 'canvas-a' } })).toBe('canvas')
    expect(generationOrigin({ canvas: { canvasId: 'canvas-a' }, projectId: 'product-a' })).toBe('unknown')
    expect(generationOrigin({ canvas: {} })).toBe('unknown')
    expect(generationOrigin({ projectId: '' })).toBe('unknown')
    expect(generationOrigin({ workflow: 'other' })).toBe('unknown')
  })

  it('source clears remove only their own files and scope mismatches cannot delete an entry', async () => {
    await appendHistory(entry('normal'))
    await appendHistory(entry('canvas', { canvas: { canvasId: 'canvas-a' } }))
    await appendHistory(entry('commerce', { workflow: 'ecommerce', projectId: 'product-a' }))
    await appendHistory(entry('conflict', { canvas: { canvasId: 'canvas-a' }, projectId: 'product-a' }))
    await appendHistory(entry('future-source', { workflow: 'other' } as unknown as Partial<HistoryEntryInput>))
    expect((await listHistory('normal')).map(item => item.id)).toEqual(['normal'])
    await expect(removeHistory('commerce', 'normal')).rejects.toMatchObject({ code: 'history-scope-mismatch' })
    expect((await clearHistory('normal')).map(item => item.id)).toEqual(['future-source', 'conflict', 'commerce', 'canvas'])
    expect(await readHistoryImage('normal-0.png')).toBeUndefined()
    expect((await readHistoryImage('commerce-0.png'))?.data.toString()).toBe('commerce')
    expect((await clearHistory('canvas')).map(item => item.id)).toEqual(['future-source', 'conflict', 'commerce'])
    expect((await clearHistory('ecommerce')).map(item => item.id)).toEqual(['future-source', 'conflict'])
    expect((await readHistoryImage('conflict-0.png'))?.data.toString()).toBe('conflict')
  })

  it('retains each source separately and does not truncate a legacy product set', async () => {
    await appendHistory(entry('commerce-main', { projectId: 'old-set', slotKey: 'main-1' }))
    await appendHistory(entry('commerce-scene', { projectId: 'old-set', slotKey: 'scene-1' }))
    await appendHistory(entry('canvas', { canvas: { canvasId: 'canvas-a' } }))
    await appendHistory(entry('conflict', { canvas: { canvasId: 'canvas-a' }, projectId: 'product-a' }))
    for (let index = 0; index <= HISTORY_MAX; index++) await appendHistory(entry(`normal-${index}`))
    expect(await listHistory('normal')).toHaveLength(HISTORY_MAX)
    expect((await listHistory('ecommerce')).map(item => item.id)).toEqual(['commerce-scene', 'commerce-main'])
    expect(await listHistory('canvas')).toHaveLength(1)
    expect(await readHistoryImage('normal-0-0.png')).toBeUndefined()
    expect((await readHistoryImage('commerce-main-0.png'))?.data.toString()).toBe('commerce-main')
    const index = JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8'))
    expect(index.entries.some((item: { id: string }) => item.id === 'conflict')).toBe(true)
  })

  it('serializes concurrent append and source clear without losing another source', async () => {
    await appendHistory(entry('normal-old'))
    await Promise.all([clearHistory('normal'), appendHistory(entry('canvas-new', { canvas: { canvasId: 'canvas-a' } }))])
    expect((await listHistory()).map(item => item.id)).toEqual(['canvas-new'])
  })

  it('keeps the history image when its metadata deletion cannot be persisted', async () => {
    await appendHistory(entry('canvas', { canvas: { canvasId: 'canvas-a' } }))
    await mkdir(path.join(root, `index.json.tmp-${process.pid}`))
    await expect(removeHistory('canvas', 'canvas')).rejects.toThrow()
    expect((await listHistory('canvas')).map(item => item.id)).toEqual(['canvas'])
    expect((await readHistoryImage('canvas-0.png'))?.data.toString()).toBe('canvas')
    await expect(clearHistory('canvas')).rejects.toThrow()
    expect((await readHistoryImage('canvas-0.png'))?.data.toString()).toBe('canvas')
  })

  it('enforces scopes around legacy injected backends and keeps no-scope compatibility', async () => {
    let entries = [entry('ordinary'), entry('canvas', { canvas: { canvasId: 'canvas-a' } }), entry('conflict', { projectId: 'product', canvas: { canvasId: 'canvas-a' } })].map(item => ({ ...item, images: [] })) as HistoryEntry[]
    const remove = vi.fn(async (id: string) => { entries = entries.filter(item => item.id !== id); return entries })
    const clear = vi.fn(async () => { entries = []; return entries })
    const dependencies: ImageGenRoutesDeps = {
      settings: { describe: () => [], mutate: async () => {} }, resolve: () => ({ apiUrl: '', apiKey: '' }),
      history: { list: async () => entries, append: async () => entries, remove, clear, readImage: async () => undefined },
    }
    expect((await call(dependencies, HISTORY_API.list, {})).body.entries).toHaveLength(3)
    expect((await call(dependencies, HISTORY_API.list, { scope: 'normal' })).body.entries.map((item: HistoryEntry) => item.id)).toEqual(['ordinary'])
    expect((await call(dependencies, HISTORY_API.remove, { id: 'canvas', scope: 'normal' })).body.code).toBe('history-scope-mismatch')
    expect(remove).not.toHaveBeenCalled()
    expect((await call(dependencies, HISTORY_API.clear, { scope: 'unknown' })).body.code).toBe('bad-request')
    expect((await call(dependencies, HISTORY_API.clear, [])).body.code).toBe('bad-request')
    expect((await call(dependencies, HISTORY_API.clear, 'malformed')).body.code).toBe('bad-request')
    expect(clear).not.toHaveBeenCalled()
    expect((await call(dependencies, HISTORY_API.clear, { scope: 'normal' }, true)).status).toBe(403)
    const scoped = await call(dependencies, HISTORY_API.clear, { scope: 'normal' })
    expect(scoped.body.entries.map((item: HistoryEntry) => item.id)).toEqual(['canvas', 'conflict'])
    expect(clear).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledExactlyOnceWith('ordinary', 'normal')
    expect((await call(dependencies, HISTORY_API.clear, {})).body.entries).toEqual([])
    expect(clear).toHaveBeenCalledOnce()
  })
})
