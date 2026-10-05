// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ContentEditor } from '../src/client/content.tsx'
import { PublisherTipsProvider } from '../src/client/tips.tsx'
import { api, uploadAsset } from '../src/client/shared.tsx'
import { listImagegenImages, readImagegenFile, type ImagegenImage } from '../src/client/imagegen-library.ts'
import type { PublisherContent } from '../src/protocol.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button type="button" {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>, Menu: ({ anchor }: any) => anchor, IconChevronDownOutlineMedium: () => null,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(), uploadAsset: vi.fn(), STATEMENT_LABELS: { none: '不声明' },
  capabilityMessage: () => '', errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : '操作失败',
  ConfirmDialog: () => null, PlatformAccountSelect: () => null,
  PublisherModal: ({ open, title, description, footer, children, onClose }: any) => open
    ? <div role="dialog" aria-label={title}><button aria-label="关闭图片选择" onClick={onClose}>关闭</button>
        <p>{description}</p>{children}<footer>{footer}</footer></div> : null,
}))
vi.mock('../src/client/content-preview.tsx', () => ({
  PublisherContentPreview: () => null, AssetPreviewImage: () => null, contentAssetUrl: () => '/asset',
}))
vi.mock('../src/client/imagegen-library.ts', () => ({ listImagegenImages: vi.fn(), readImagegenFile: vi.fn() }))
const queryApi = api as unknown as Mock
const upload = uploadAsset as unknown as Mock
const list = listImagegenImages as unknown as Mock
const read = readImagegenFile as unknown as Mock
const images: ImagegenImage[] = [
  { id: 'one', url: '/one', name: 'one.png', prompt: '山峰', source: 'normal', label: '普通生图', createdAt: 0 },
  { id: 'two', url: '/two', name: 'two.webp', prompt: '城市', source: 'normal', label: '普通生图', createdAt: 0 },
  { id: 'three', url: '/three', name: 'three.png', prompt: '星空', source: 'normal', label: '普通生图', createdAt: 0 },
]
let server: Map<string, PublisherContent>
let root: Root | undefined
let container: HTMLDivElement
function draft(id: string, contentType: 'article' | 'image-note' = 'image-note'): PublisherContent {
  return { id, contentType, title: `${id}标题`, body: '正文', summary: '', revision: 1, createdAt: '', updatedAt: '',
    assets: [], tags: [], creativeStatement: 'none', platformFields: {}, platformVariants: { xhs: { assetOrder: [] } } }
}
function file(image: ImagegenImage) { return new File(['image-bytes'], image.name, { type: image.name.endsWith('.webp') ? 'image/webp' : 'image/png' }) }
function saveImage(id: string, imageFile: File): PublisherContent {
  const current = server.get(id)!
  const saved: PublisherContent = { ...current, revision: current.revision + 1,
    assets: [...current.assets, { id: `asset-${current.assets.length + 1}`, name: imageFile.name,
      bytes: imageFile.size, mime: imageFile.type as 'image/png' | 'image/webp' }] }
  server.set(id, saved)
  return saved
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function render(id = 'first', contentType: 'article' | 'image-note' = 'image-note') {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await act(async () => { root!.render(<PublisherTipsProvider><ContentEditor contentType={contentType} active selectedContentId={id} onBack={vi.fn()}/></PublisherTipsProvider>) })
}
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)! }
async function click(target: HTMLElement) { expect(target).not.toBeNull(); await act(async () => { target.click() }) }
async function choose(name: string) { await click(container.querySelector(`[aria-label="选择${name}"]`)!) }
async function open() { await click(button('从 e图宝选择')) }
async function enterTitle(value: string) {
  const input = container.querySelector<HTMLInputElement>('#pub-image-note-title')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true })) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ apps: [] }) })))
  server = new Map([['first', draft('first')], ['second', draft('second')], ['article', draft('article', 'article')]])
  queryApi.mockReset(); upload.mockReset(); list.mockReset(); read.mockReset()
  list.mockResolvedValue(images); read.mockImplementation(async (image: ImagegenImage) => file(image))
  upload.mockImplementation(async (id: string, imageFile: File) => saveImage(id, imageFile))
  queryApi.mockImplementation(async (route: string, payload?: any) => {
    if (route === 'capability') return { supported: true, running: true }
    if (route === 'accounts' || route === 'platform-capabilities') return []
    if (route.startsWith('content/')) return server.get(route.slice('content/'.length))
    if (route === 'project-workspace') return { contentId: payload.contentId, path: '/projects' }
    if (route === 'content-save') {
      const current = server.get(payload.id)!
      const saved = { ...current, ...payload, revision: current.revision + 1 }
      server.set(payload.id, saved)
      return saved
    }
    throw new Error(`Unexpected route ${route}`)
  })
})
afterEach(async () => { await act(async () => { root?.unmount() }); container?.remove(); root = undefined; vi.unstubAllGlobals() })

describe('e图宝 imports into the image-note editor', () => {
  it('offers the picker beside local uploads only for image notes', async () => {
    await render('article', 'article')
    expect(button('从 e图宝选择')).toBeUndefined()
    await render('first')
    expect(button('从 e图宝选择').parentElement).toBe(button('添加图片').parentElement)
    await open(); await click(button('取消'))
    expect(list).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled()
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('flushes edits first, then uploads in selection order one at a time without converting WebP or overwriting manifests', async () => {
    const firstUpload = deferred<PublisherContent>()
    const uploadedFiles: File[] = []
    upload.mockImplementation(async (id: string, imageFile: File) => {
      uploadedFiles.push(imageFile)
      const saved = saveImage(id, imageFile)
      return uploadedFiles.length === 1 ? firstUpload.promise : saved
    })
    await render(); await enterTitle('导入前已修改标题'); await open()
    expect(server.get('first')?.title).toBe('导入前已修改标题')
    expect(queryApi.mock.calls.filter(([route]) => route === 'content-save')).toHaveLength(1)
    await choose('two.webp'); await choose('one.png'); await click(button('导入选中图片（2）'))
    expect(read).toHaveBeenCalledTimes(1); expect(upload).toHaveBeenCalledTimes(1)
    expect(uploadedFiles[0].type).toBe('image/webp')
    expect(button('取消').disabled).toBe(true)
    const firstSaved = server.get('first')!
    await act(async () => { firstUpload.resolve(firstSaved) })
    expect(read.mock.calls.map(([image]) => image.id)).toEqual(['two', 'one'])
    expect(upload.mock.calls.map(([id, imageFile]) => [id, imageFile.name])).toEqual([['first', 'two.webp'], ['first', 'one.png']])
    expect(upload.mock.calls[0][1]).toBe(uploadedFiles[0])
    expect(server.get('first')?.assets.map(asset => asset.name)).toEqual(['two.webp', 'one.png'])
    expect(server.get('first')?.revision).toBe(4)
    expect(server.get('first')?.platformVariants).toEqual({ xhs: { assetOrder: [] } })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelectorAll('.pub-assets .pub-asset')).toHaveLength(2)
    expect(queryApi.mock.calls.filter(([route]) => route === 'content-save')).toHaveLength(1)
  })

  it('retains saved images after partial failure and retries only the remaining selection', async () => {
    let attempts = 0
    upload.mockImplementation(async (id: string, imageFile: File) => {
      if (++attempts === 2) throw new Error('磁盘写入失败')
      return saveImage(id, imageFile)
    })
    await render(); await open(); await choose('one.png'); await choose('two.webp'); await choose('three.png')
    await click(button('导入选中图片（3）'))
    expect(server.get('first')?.assets.map(asset => asset.name)).toEqual(['one.png'])
    expect(read.mock.calls.map(([image]) => image.id)).toEqual(['one', 'two'])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('已导入 1 张图片，剩余 2 张未导入')
    expect(container.querySelector<HTMLInputElement>('[aria-label="选择one.png"]')?.checked).toBe(false)
    await click(button('导入选中图片（2）'))
    expect(server.get('first')?.assets.map(asset => asset.name)).toEqual(['one.png', 'two.webp', 'three.png'])
    expect(container.querySelectorAll('.pub-assets .pub-asset')).toHaveLength(3)
    expect(queryApi.mock.calls.some(([route]) => route === 'content-save')).toBe(false)
  })

  it('stops before upload when the image cannot be read', async () => {
    read.mockRejectedValue(new Error('图片已删除'))
    await render(); await open(); await choose('one.png'); await click(button('导入选中图片（1）'))
    expect(upload).not.toHaveBeenCalled()
    expect(server.get('first')?.assets).toEqual([])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('图片已删除')
    expect(button('取消').disabled).toBe(false)
  })

  it('does not upload a late image read after the selected draft switches', async () => {
    const pending = deferred<File>()
    read.mockImplementation(() => pending.promise)
    await render(); await open(); await choose('one.png'); await click(button('导入选中图片（1）'))
    const signal = read.mock.calls[0][1] as AbortSignal
    await render('second')
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve(file(images[0])) })
    expect(upload).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('#pub-image-note-title')?.value).toBe('second标题')
    expect(server.get('first')?.assets).toEqual([])
    expect(server.get('second')?.assets).toEqual([])
  })

  it('keeps an in-flight saved image in its original draft without replacing a newly selected draft', async () => {
    const pending = deferred<PublisherContent>()
    upload.mockImplementation((id: string, imageFile: File) => { saveImage(id, imageFile); return pending.promise })
    await render(); await open(); await choose('one.png'); await choose('two.webp'); await click(button('导入选中图片（2）'))
    const saved = server.get('first')!
    await render('second')
    await act(async () => { pending.resolve(saved) })
    expect(upload).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledOnce()
    expect(server.get('first')?.assets.map(asset => asset.name)).toEqual(['one.png'])
    expect(server.get('second')?.assets).toEqual([])
    expect(container.querySelector<HTMLInputElement>('#pub-image-note-title')?.value).toBe('second标题')
  })

  it('uses the main draft capacity even when the platform has an empty independent selection', async () => {
    server.get('first')!.assets = Array.from({ length: 19 }, (_, index) => ({ id: `existing-${index}`, name: `${index}.png`, mime: 'image/png', bytes: 1 }))
    await render(); await open(); await choose('one.png')
    expect(container.querySelector<HTMLInputElement>('[aria-label="选择two.webp"]')?.disabled).toBe(true)
    expect(container.textContent).toContain('当前草稿还能添加 1 张')
    await click(button('导入选中图片（1）'))
    expect(server.get('first')?.assets).toHaveLength(20)
    expect(server.get('first')?.platformVariants).toEqual({ xhs: { assetOrder: [] } })
    expect(button('从 e图宝选择').disabled).toBe(true)
  })
})
