import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setImageDataRoot } from '../src/image-storage-path.ts'
import { type TemplateCase } from '../src/protocol.ts'
import { addTemplateFavorite, clearTemplateFavoritesMemo, listTemplateFavorites, removeTemplateFavorite, templateFavoriteKey } from '../src/template-favorites.ts'
import { clearTemplateMemo, listTemplates, readTemplateImage, refreshTemplates, sampleTemplates, syncAllTemplates } from '../src/templates-store.ts'
// The release script exposes only a non-executing parser when imported.
// @ts-expect-error The release tooling is intentionally plain JavaScript.
import { parseFeaturedPrompts } from '../scripts/fetch-templates.mjs'

const { downloadImage } = vi.hoisted(() => ({ downloadImage: vi.fn() }))
vi.mock('../src/secure-image-download.ts', () => ({ downloadProviderImage: downloadImage }))

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const roots: string[] = []
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cqai-community-templates-'))
  roots.push(root)
  setImageDataRoot(root)
  clearTemplateMemo()
  clearTemplateFavoritesMemo()
  downloadImage.mockReset()
  downloadImage.mockResolvedValue({ buffer: png, mime: 'image/png' })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  setImageDataRoot(undefined)
  clearTemplateMemo()
  clearTemplateFavoritesMemo()
  await Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function snapshot(sourceId: string, cases: unknown[]): Promise<void> {
  const directory = path.join(root, 'templates', sourceId)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'cases.json'), JSON.stringify({ cases }))
  clearTemplateMemo()
}

function item(id: number | string, image = ''): TemplateCase {
  return { id, title: 'Template', prompt: 'Draw a scene', image, category: 'Art', categoryZh: '艺术', styles: [], scenes: [], sourceLabel: 'Author', sourceUrl: '', githubUrl: '', featured: false }
}

describe('community template snapshots and legacy favorites', () => {
  it('ships all three complete offline libraries, with source revisions and string IDs', async () => {
    for (const [sourceId, count] of [['handraw', 441], ['prompt-signal', 577], ['evolink', 462]] as const) {
      const list = await listTemplates(sourceId)
      expect(list.origin).toBe('bundled')
      expect(list.total).toBe(count)
      expect(new Set(list.cases.map(entry => entry.id)).size).toBe(count)
      expect(list.cases.every(entry => typeof entry.id === 'string' && entry.prompt !== '')).toBe(true)
      expect(list.repository).toContain('github.com/')
    }
    expect(downloadImage).not.toHaveBeenCalled()
  })

  it('retains numeric legacy IDs, newest-first order, labels, and old unscoped state', async () => {
    await mkdir(path.join(root, 'templates'), { recursive: true })
    await writeFile(path.join(root, 'templates', 'cases.json'), JSON.stringify({ cases: [item('2', 'images/case2.png'), item(42, 'case42.png')] }))
    await mkdir(path.join(root, 'template-images'), { recursive: true })
    await writeFile(path.join(root, 'template-images', 'case42.png'), png)
    const list = await listTemplates('vibeui')
    expect(list.origin).toBe('refreshed')
    expect(list.cases.map(entry => entry.id)).toEqual([42, 2])
    expect(list.cases[0]!.categoryZh).toBe('艺术')
    expect(list.cases[1]!.image).toBe('case2.png')
    expect(await readTemplateImage('vibeui', 'case42.png')).toEqual({ data: png, mime: 'image/png' })
    expect(downloadImage).not.toHaveBeenCalled()
  })

  it('reads existing numeric favorites and preserves their keys when string cases are saved', async () => {
    await mkdir(path.join(root, 'templates'), { recursive: true })
    await writeFile(path.join(root, 'templates', 'favorites.json'), JSON.stringify([
      { key: 'vibeui:42', sourceId: 'vibeui', savedAt: '2026-09-14T00:00:00.000Z', case: item(42) },
      { key: 'canghe:7', sourceId: 'canghe', savedAt: '2026-09-14T00:00:00.000Z', case: item('7') },
      { key: 'vibeui:99', sourceId: 'vibeui', savedAt: '', case: item(42) },
    ]))
    expect((await listTemplateFavorites()).map(entry => [entry.key, entry.case.id])).toEqual([['vibeui:42', 42], ['canghe:7', 7]])
    const community = (await listTemplates('handraw')).cases[0]!
    await addTemplateFavorite('handraw', community)
    await addTemplateFavorite('vibeui', item(42))
    clearTemplateFavoritesMemo()
    const favorites = await listTemplateFavorites()
    expect(favorites.map(entry => entry.key)).toEqual(['vibeui:42', templateFavoriteKey('handraw', community.id), 'canghe:7'])
    expect(favorites[0]!.case.id).toBe(42)
    expect(favorites[1]!.case).toEqual(community)
    expect(JSON.parse(await readFile(path.join(root, 'templates', 'favorites.json'), 'utf8'))).toHaveLength(3)
    expect(await removeTemplateFavorite(templateFavoriteKey('handraw', community.id))).toHaveLength(2)
  })

  it('excludes release snapshots from online refresh while sampling all five sources', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cases: [item(1)] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshTemplates('handraw')).rejects.toThrow('内置快照')
    const reports = await syncAllTemplates()
    expect(reports).toHaveLength(5)
    expect(reports.every(report => report.ok)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Set((await sampleTemplates(5)).map(entry => entry.sourceId)).size).toBe(5)
  })
})

describe('source-scoped URL image cache', () => {
  const image = 'https://raw.githubusercontent.com/andy7076/image_prompt/pinned/public/images/sample.png'

  it('fetches registered references safely, deduplicates requests, and caches by URL hash under the selected root', async () => {
    await snapshot('prompt-signal', [item('raw-sample', image)])
    const [first, second] = await Promise.all([readTemplateImage('prompt-signal', image), readTemplateImage('prompt-signal', image)])
    expect(first).toEqual({ data: png, mime: 'image/png' })
    expect(second).toEqual(first)
    expect(downloadImage).toHaveBeenCalledTimes(1)
    expect(downloadImage).toHaveBeenCalledWith(expect.objectContaining({ url: image, apiKey: '', maxBytes: 20 * 1024 * 1024, maxRedirects: 0 }))
    const cacheFile = `${createHash('sha256').update(image).digest('hex').slice(0, 32)}.png`
    expect(await readdir(path.join(root, 'template-images', 'prompt-signal'))).toEqual([cacheFile])
    expect(await readTemplateImage('prompt-signal', image)).toEqual(first)
    expect(downloadImage).toHaveBeenCalledTimes(1)
    const nextRoot = await mkdtemp(path.join(tmpdir(), 'cqai-community-next-root-'))
    roots.push(nextRoot)
    setImageDataRoot(nextRoot)
    expect(await readTemplateImage('prompt-signal', image)).toBeUndefined()
    expect(downloadImage).toHaveBeenCalledTimes(1)
  })

  it('blocks unknown images, source confusion, unsafe schemes, credentials, ports and hosts before connecting', async () => {
    const invalid = [
      'https://127.0.0.1/private.png', 'https://raw.githubusercontent.com.evil.test/image.png',
      'http://raw.githubusercontent.com/image.png', 'https://user:secret@raw.githubusercontent.com/image.png',
      'https://raw.githubusercontent.com:8443/image.png', 'file:///tmp/image.png', '../case42.png',
    ]
    await snapshot('prompt-signal', invalid.map((ref, index) => item(`unsafe-${index}`, ref)))
    for (const ref of invalid) expect(await readTemplateImage('prompt-signal', ref)).toBeUndefined()
    expect(await readTemplateImage('prompt-signal', image)).toBeUndefined()
    await snapshot('vibeui', [item(42, image)])
    expect(await readTemplateImage('vibeui', image)).toBeUndefined()
    expect(await readTemplateImage('__proto__', 'case42.png')).toBeUndefined()
    expect(downloadImage).not.toHaveBeenCalled()
  })

  it('uses only the explicit registered handraw mirror when its CDN fails', async () => {
    const handraw = (await listTemplates('handraw')).cases.find(entry => entry.image.startsWith('https://cdn.jsdelivr.net/gh/yang0/handraw-style@'))!
    downloadImage.mockRejectedValueOnce(new Error('CDN unavailable'))
    expect(await readTemplateImage('handraw', handraw.image)).toEqual({ data: png, mime: 'image/png' })
    expect(downloadImage).toHaveBeenCalledTimes(2)
    expect(downloadImage.mock.calls[1]![0].url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/yang0\/handraw-style\//)
    expect(downloadImage.mock.calls.every(call => call[0].maxRedirects === 0)).toBe(true)
  })

  it('does not serve HTML from an old poisoned cache just because its extension says PNG', async () => {
    await snapshot('vibeui', [item(42, 'case42.png')])
    const directory = path.join(root, 'template-images', 'vibeui')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'case42.png'), '<html>not an image</html>')
    downloadImage.mockRejectedValue(new Error('unavailable'))
    expect(await readTemplateImage('vibeui', 'case42.png')).toBeUndefined()
    expect(downloadImage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://vibeui.top/extra/awesome-gpt-image-2/data/images/case42.png' }))
  })
})

describe('release snapshot data parsing', () => {
  it('reads pinned literal data and source references without running any top-level code', () => {
    const data = `globalThis.shouldNeverRun(); export const SOURCE = {url: 'https://example.test'}; export const featuredPrompts = [{id: 'a', source: SOURCE.url, tags: ['art'], featured: true}];`
    expect(parseFeaturedPrompts(data)).toEqual([{ id: 'a', source: 'https://example.test', tags: ['art'], featured: true }])
  })

  it('fails closed when a data field contains executable expressions', () => {
    expect(() => parseFeaturedPrompts('export const featuredPrompts = [{prompt: process.exit(0)}]')).toThrow('executable expression')
    expect(() => parseFeaturedPrompts('export const featuredPrompts = (() => [])()')).toThrow('executable expression')
  })
})
