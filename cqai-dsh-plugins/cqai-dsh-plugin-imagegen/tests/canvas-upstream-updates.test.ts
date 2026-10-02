import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CanvasStore, mimeFromFileName } from '../src/canvas-store.ts'

const roots: string[] = []

async function createStore(): Promise<{ store: CanvasStore; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'cqai-canvas-upstream-'))
  roots.push(root)
  return { store: new CanvasStore(root), root }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('canvas image MIME and favorites', () => {
  it('serves stored PNG bytes as image/png after reopening the store', async () => {
    const { store, root } = await createStore()
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
    const asset = await store.putImage({ data: bytes, mime: 'image/png', width: 1, height: 1, origin: 'upload' })
    expect(asset.assetId).toMatch(/\.png$/)
    const restored = await new CanvasStore(root).readAsset(asset.assetId)
    expect(restored?.mime).toBe('image/png')
    expect(restored?.data).toEqual(bytes)
  })

  it.each([
    ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'],
    ['gif', 'image/gif'], ['bmp', 'image/bmp'], ['tif', 'image/tiff'], ['tiff', 'image/tiff'],
  ])('infers the %s image MIME when uploads lack a browser MIME', async (extension, mime) => {
    const { store } = await createStore()
    const name = `image.${extension.toUpperCase()}`
    expect(mimeFromFileName(name)).toBe(mime)
    const asset = await store.putFile({ data: Buffer.from('image bytes'), name, mime: '', origin: 'upload' })
    expect(asset.mime).toBe(mime)
    expect((await store.readAsset(asset.assetId))?.mime).toBe(mime)
  })

  it('persists favorite across save and reopen, then removes it without touching document content', async () => {
    const { store, root } = await createStore()
    const original = await store.create('Favorite canvas')
    const other = await store.create('Other canvas')
    const before = await store.read(original.id)
    const summaries = await store.setFavorite(original.id, true)
    expect(summaries.find(item => item.id === original.id)?.favorite).toBe(true)
    expect(await store.read(original.id)).toEqual(before)
    expect(original.background).toBe('liquid')
    const saved = await store.save({ ...original, title: 'Renamed favorite', background: 'galaxy' }, original.revision)
    const reopened = new CanvasStore(root)
    expect((await reopened.list()).find(item => item.id === original.id)).toMatchObject({ favorite: true, title: 'Renamed favorite', revision: saved.revision })
    expect((await reopened.list()).find(item => item.id === other.id)?.favorite).toBeUndefined()
    const unstarred = await reopened.setFavorite(original.id, false)
    expect(unstarred.find(item => item.id === original.id)?.favorite).toBeUndefined()
    const next = await reopened.save(saved, saved.revision)
    expect((await new CanvasStore(root).list()).find(item => item.id === original.id)?.favorite).toBeUndefined()
    expect((await reopened.read(original.id))?.background).toBe('galaxy')
    expect(next.revision).toBe(saved.revision + 1)
  })

  it('rejects invalid favorite requests and missing projects without writing the index', async () => {
    const { store, root } = await createStore()
    const document = await store.create('Existing')
    const before = await readFile(path.join(root, 'index.json'), 'utf8')
    await expect(store.setFavorite('', true)).rejects.toThrow('invalid canvas favorite input')
    await expect(store.setFavorite(null as unknown as string, true)).rejects.toThrow('invalid canvas favorite input')
    await expect(store.setFavorite(document.id, 'true' as unknown as boolean)).rejects.toThrow('invalid canvas favorite input')
    await expect(store.setFavorite('nonexistent', true)).rejects.toThrow('画布不存在')
    await expect(store.setFavorite('../index', true)).rejects.toThrow('画布不存在')
    expect(await readFile(path.join(root, 'index.json'), 'utf8')).toBe(before)
  })

  it('keeps favorites when a save and favorite update are queued together', async () => {
    const { store } = await createStore()
    const document = await store.create('Concurrent')
    await Promise.all([store.setFavorite(document.id, true), store.save({ ...document, title: 'Edited' }, document.revision)])
    expect((await store.list())[0]).toMatchObject({ favorite: true, title: 'Edited' })
  })

  it('ignores malformed persisted favorite flags while retaining valid legacy summaries', async () => {
    const { store, root } = await createStore()
    await store.create('Legacy canvas')
    const [summary] = await store.list()
    await writeFile(path.join(root, 'index.json'), JSON.stringify({ projects: [{ ...summary, favorite: 'true' }, null] }))
    expect(await store.list()).toEqual([summary])
  })
})
