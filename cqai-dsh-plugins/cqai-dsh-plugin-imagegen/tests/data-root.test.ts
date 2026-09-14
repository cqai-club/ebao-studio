import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  imageDataRoot,
  requestedImageDataRoot,
  resolveImageDataRoot,
  setImageDataRoot,
} from '../src/image-storage-path.ts'
import { addTemplateFavorite, listTemplateFavorites } from '../src/template-favorites.ts'
import { clearTemplateMemo, listTemplates } from '../src/templates-store.ts'

const roots: string[] = []

afterEach(async () => {
  setImageDataRoot(undefined)
  clearTemplateMemo()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('shared image data root', () => {
  it('resolves a pending settings root without switching the live store', () => {
    setImageDataRoot('/tmp/cqai-imagegen-current')
    const requested = requestedImageDataRoot([
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['localStoragePath'], value: ' ./next-image-root ' },
    ], undefined)

    expect(requested).toBe(' ./next-image-root ')
    expect(resolveImageDataRoot(requested)).toBe(path.resolve('./next-image-root'))
    expect(imageDataRoot()).toBe('/tmp/cqai-imagegen-current')
  })

  it('uses the inherited root when a section replacement or unset removes the override', () => {
    expect(requestedImageDataRoot([
      { op: 'set', path: [], value: { enabled: true } },
    ], '/tmp/cqai-imagegen-inherited')).toBe('/tmp/cqai-imagegen-inherited')
    expect(requestedImageDataRoot([
      { op: 'unset', path: ['localStoragePath'] },
    ], '/tmp/cqai-imagegen-inherited')).toBe('/tmp/cqai-imagegen-inherited')
    expect(requestedImageDataRoot([
      { op: 'set', path: ['enabled'], value: false },
    ], '/tmp/cqai-imagegen-inherited')).toBeUndefined()
  })

  it('keeps refreshed templates and favorites under the configured root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cqai-imagegen-root-'))
    roots.push(root)
    setImageDataRoot(root)
    expect(imageDataRoot()).toBe(root)

    const templateDir = path.join(root, 'templates', 'vibeui')
    await mkdir(templateDir, { recursive: true })
    await writeFile(path.join(templateDir, 'cases.json'), JSON.stringify({
      repository: 'local-test',
      fetchedAt: '2026-09-14T00:00:00.000Z',
      cases: [{ id: 42, title: 'Root test', prompt: 'A root test', image: '' }],
    }))
    clearTemplateMemo()

    const templates = await listTemplates('vibeui')
    expect(templates.origin).toBe('refreshed')
    expect(templates.cases.map(item => item.id)).toEqual([42])

    await addTemplateFavorite('vibeui', templates.cases[0]!)
    expect((await listTemplateFavorites()).map(item => item.case.id)).toEqual([42])
    const persisted = JSON.parse(await readFile(path.join(root, 'templates', 'favorites.json'), 'utf8')) as unknown[]
    expect(persisted).toHaveLength(1)
  })

  it('does not reuse a template or favorite memo after switching roots', async () => {
    const first = await mkdtemp(path.join(tmpdir(), 'cqai-imagegen-root-a-'))
    const second = await mkdtemp(path.join(tmpdir(), 'cqai-imagegen-root-b-'))
    roots.push(first, second)

    setImageDataRoot(first)
    const bundled = await listTemplates('vibeui')
    await addTemplateFavorite('vibeui', bundled.cases[0]!)
    expect(await listTemplateFavorites()).toHaveLength(1)

    setImageDataRoot(second)
    expect(await listTemplateFavorites()).toEqual([])
    expect((await listTemplates('vibeui')).origin).toBe('bundled')
  })
})
