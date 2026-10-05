// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ImagegenPicker, type ImagegenImportResult } from '../src/client/imagegen-picker.tsx'
import { listImagegenImages, type ImagegenImage } from '../src/client/imagegen-library.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : '操作失败',
  PublisherModal: ({ title, description, children, footer, onClose, className }: any) => <div role="dialog" aria-label={title} className={className}>
    <button aria-label="关闭图片选择" onClick={onClose}>关闭</button><p>{description}</p>{children}{footer}</div>,
}))
vi.mock('../src/client/imagegen-library.ts', () => ({ listImagegenImages: vi.fn() }))
const list = listImagegenImages as unknown as Mock
let root: Root | undefined
let container: HTMLDivElement
const images: ImagegenImage[] = [
  { id: 'one', url: '/image-one', name: '第一张.png', prompt: '山峰', createdAt: 0, source: 'normal', label: '普通生图' },
  { id: 'two', url: '/image-two', name: '第二张.webp', prompt: '城市', createdAt: 0, source: 'normal', label: '普通生图' },
  { id: 'three', url: '/image-three', name: '第三张.png', prompt: '星空', createdAt: 0, source: 'normal', label: '普通生图' },
]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function render(props: { remaining?: number; onCancel?: () => void; onImport?: (images: ImagegenImage[], signal: AbortSignal) => Promise<ImagegenImportResult> } = {}) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await act(async () => { root!.render(<ImagegenPicker remaining={props.remaining ?? 20} onCancel={props.onCancel ?? vi.fn()}
    onImport={props.onImport ?? vi.fn(async () => ({ importedIds: [] }))}/>) })
}
function checkbox(name: string): HTMLInputElement { return container.querySelector(`[aria-label="选择${name}"]`)! }
function button(text: string): HTMLButtonElement { return Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)! }
async function click(target: HTMLElement) { expect(target).not.toBeNull(); await act(async () => { target.click() }) }
async function source(value: string) {
  const select = container.querySelector('select')!
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); list.mockReset(); list.mockResolvedValue(images) })
afterEach(async () => { await act(async () => { root?.unmount() }); container?.remove(); root = undefined; vi.unstubAllGlobals() })

describe('e图宝 image picker', () => {
  it('defaults to all generated images and keeps native checkbox selection order within capacity', async () => {
    const onImport = vi.fn(async () => ({ importedIds: ['two', 'one'] }))
    const onCancel = vi.fn()
    await render({ remaining: 2, onImport, onCancel })
    expect(list).toHaveBeenCalledWith('all', expect.any(AbortSignal))
    expect(container.querySelector('select')?.value).toBe('all')
    expect(Array.from(container.querySelectorAll('option')).map(option => option.textContent)).toEqual([
      '全部生图', '普通生图', '画布生图', '电商套图', '素材库',
    ])
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    await click(checkbox('第二张.webp')); await click(checkbox('第一张.png'))
    expect(checkbox('第三张.png').disabled).toBe(true)
    expect(container.textContent).toContain('已选 2 张 · 当前草稿还能添加 2 张')
    expect(container.querySelector('[aria-label="第 1 张"]')?.closest('.pub-imagegen-picker-card')?.textContent).toContain('第二张.webp')
    await click(button('导入选中图片（2）'))
    expect(onImport).toHaveBeenCalledWith([images[1], images[0]], expect.any(AbortSignal))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('searches prompts and names without changing selected order', async () => {
    await render()
    await click(checkbox('第二张.webp'))
    await search('山峰')
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    await click(checkbox('第一张.png'))
    await search('第二张')
    expect(checkbox('第二张.webp').checked).toBe(true)
    expect(container.textContent).toContain('已选 2 张')
  })

  it('finds a merged image by a different source alias without showing another selectable copy', async () => {
    list.mockResolvedValue([{ ...images[0]!, searchText: '图片节点\n图库收藏描述' }])
    await render()
    await search('图片节点')
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    await click(checkbox('第一张.png'))
    await search('图库收藏描述')
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(checkbox('第一张.png').checked).toBe(true)
  })

  it('selects images from different generation sources together in the all view', async () => {
    const mixed: ImagegenImage[] = [
      images[0]!,
      { ...images[1]!, source: 'canvas', label: '画布生成' },
      { ...images[2]!, source: 'ecommerce', label: '商品套图' },
    ]
    list.mockImplementation((value: string) => Promise.resolve(value === 'all' ? mixed : [mixed[0]]))
    const onImport = vi.fn(async () => ({ importedIds: ['three', 'two'] }))
    await render({ onImport })
    expect(container.textContent).toContain('画布生成')
    expect(container.textContent).toContain('商品套图')
    await click(checkbox('第三张.png')); await click(checkbox('第二张.webp'))
    await click(button('导入选中图片（2）'))
    expect(onImport).toHaveBeenCalledWith([mixed[2], mixed[1]], expect.any(AbortSignal))
    await source('normal')
    expect(list).toHaveBeenLastCalledWith('normal', expect.any(AbortSignal))
    expect(checkbox('第三张.png')).toBeNull()
    expect(checkbox('第一张.png')).not.toBeNull()
    expect(container.textContent).toContain('已选 0 张')
  })

  it('aborts source changes and ignores a late response from the previous source', async () => {
    const old = deferred<ImagegenImage[]>()
    list.mockImplementation((value: string) => value === 'all' ? old.promise : Promise.resolve([images[2]]))
    await render()
    expect(container.textContent).toContain('正在加载图片')
    const oldSignal = list.mock.calls[0][1] as AbortSignal
    await source('canvas')
    expect(oldSignal.aborted).toBe(true)
    expect(checkbox('第三张.png')).not.toBeNull()
    await act(async () => { old.resolve(images) })
    expect(checkbox('第一张.png')).toBeNull()
    await click(checkbox('第三张.png'))
    await source('gallery')
    expect(container.textContent).toContain('已选 0 张')
  })

  it('shows list failure, retry and empty-source feedback', async () => {
    list.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue([])
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('读取失败')
    await click(button('重新加载'))
    expect(list).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('此来源暂无可选图片')
    expect(button('导入选中图片（0）').disabled).toBe(true)
  })

  it('deselects a failed thumbnail and keeps it disabled until its retry loads', async () => {
    await render()
    await click(checkbox('第一张.png'))
    const image = container.querySelector('img')!
    await act(async () => { image.dispatchEvent(new Event('error')) })
    expect(checkbox('第一张.png').checked).toBe(false)
    expect(checkbox('第一张.png').disabled).toBe(true)
    await click(button('重试图片'))
    expect(checkbox('第一张.png').disabled).toBe(true)
    await act(async () => { container.querySelector('img')!.dispatchEvent(new Event('load')) })
    expect(checkbox('第一张.png').disabled).toBe(false)
  })

  it('locks cancellation and repeat import during saving and preserves only failed selections after partial success', async () => {
    const pending = deferred<ImagegenImportResult>()
    const onImport = vi.fn((_images: ImagegenImage[], _signal: AbortSignal) => pending.promise)
    const onCancel = vi.fn()
    await render({ onImport, onCancel })
    await click(checkbox('第一张.png')); await click(checkbox('第二张.webp'))
    const importButton = button('导入选中图片（2）')
    await act(async () => { importButton.click(); importButton.click() })
    await click(container.querySelector('[aria-label="关闭图片选择"]')!)
    expect(onImport).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
    expect(button('取消').disabled).toBe(true)
    expect(container.querySelector('select')?.disabled).toBe(true)
    await act(async () => { pending.resolve({ importedIds: ['one'], error: '第二张读取失败' }) })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('已导入 1 张图片，剩余 1 张未导入')
    expect(checkbox('第一张.png').checked).toBe(false)
    expect(checkbox('第二张.webp').checked).toBe(true)
    expect(button('导入选中图片（1）').disabled).toBe(false)
  })

  it('bounds the mounted thumbnails while searching the complete library', async () => {
    list.mockResolvedValue(Array.from({ length: 125 }, (_, index) => ({ ...images[0], id: String(index), name: `图片-${index}.png` })))
    await render()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(60)
    await click(button('显示更多图片（已显示 60/125）'))
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(120)
    await search('图片-124.png')
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(checkbox('图片-124.png')).not.toBeNull()
  })

  it('aborts both listing and pending image reads when the picker unmounts', async () => {
    const pending = deferred<ImagegenImportResult>()
    const onImport = vi.fn((_images: ImagegenImage[], _signal: AbortSignal) => pending.promise)
    await render({ onImport })
    const listSignal = list.mock.calls[0][1] as AbortSignal
    await click(checkbox('第一张.png')); await click(button('导入选中图片（1）'))
    const importSignal = onImport.mock.calls[0][1] as AbortSignal
    await act(async () => { root!.unmount() }); root = undefined
    expect(listSignal.aborted).toBe(true)
    expect(importSignal.aborted).toBe(true)
    await act(async () => { pending.resolve({ importedIds: ['one'] }) })
  })
})
