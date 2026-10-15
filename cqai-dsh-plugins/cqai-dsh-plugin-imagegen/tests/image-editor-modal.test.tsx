// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorModal, type EditorApplyResult } from '../src/client/image-editor/EditorModal.tsx'

class TestImage {
  naturalWidth = 200
  naturalHeight = 100
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(url: string) { queueMicrotask(() => url.includes('broken') ? this.onerror?.() : this.onload?.()) }
}

beforeEach(() => {
  vi.stubGlobal('Image', TestImage)
  const context = {
    drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    save: vi.fn(), restore: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), fillText: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) })),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png pixels'], { type: 'image/png' })))
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const source = { previewUrl: '/image.png', name: '生成图片.png' }
async function loaded(): Promise<void> { await waitFor(() => expect(screen.getByRole('img', { name: '图片编辑预览' })).toBeTruthy()) }

describe('image editor interaction', () => {
  it('adds a keyboard-accessible comment and exports the entered request', async () => {
    const onApply = vi.fn(), onCancel = vi.fn(), onIntentChange = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={onCancel} onIntentChange={onIntentChange} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
    const comment = screen.getByRole('textbox', { name: '标注 1' })
    expect(document.activeElement).toBe(comment)
    fireEvent.change(comment, { target: { value: '把这里换成玫瑰' } })
    expect(onIntentChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '保存编辑' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    const result = onApply.mock.calls[0][0] as EditorApplyResult
    expect(result.manifest.source).toEqual({ name: source.name, width: 200, height: 100 })
    expect(result.manifest.markers).toEqual([{ id: 1, x: 0.5, y: 0.5, text: '把这里换成玫瑰' }])
    expect(result.files.map(file => file.type)).toEqual(['image/png', 'image/png'])
    expect(result.manifest.files.mask).toBeUndefined()
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })

  it('keeps the editing request after a rejected save and lets the user retry', async () => {
    const onApply = vi.fn().mockRejectedValueOnce(new Error('保存服务暂时不可用')).mockResolvedValue(undefined)
    const onCancel = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={onCancel} applyLabel="另存图片" />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '另存图片' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('保存服务暂时不可用'))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '另存图片' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })

  it('prevents closing or repeated submissions while asynchronous processing is pending', async () => {
    let resolveSave!: () => void
    const onApply = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve }))
    const onCancel = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={onCancel} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '保存编辑' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '关闭图片编辑器' }))
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => resolveSave())
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('traps keyboard focus and restores the original trigger when closed', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    const onCancel = vi.fn()
    const view = render(<EditorModal source={source} onApply={vi.fn()} onCancel={onCancel} />)
    await loaded()
    const close = screen.getByRole('button', { name: '关闭图片编辑器' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '保存编辑' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    view.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('does not export invalid dimensions and clears shifted annotations after changing aspect ratio', async () => {
    const onApply = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={vi.fn()} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
    fireEvent.change(screen.getByRole('textbox', { name: '宽度' }), { target: { value: '99999' } })
    expect(screen.getByRole('alert').textContent).toContain('上限')
    expect((screen.getByRole('button', { name: '保存编辑' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    expect(screen.queryByRole('textbox', { name: '标注 1' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('重新标注')
    fireEvent.click(screen.getByRole('button', { name: '保存编辑' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect((onApply.mock.calls[0][0] as EditorApplyResult).manifest.size).toMatchObject({ width: 512, height: 512, changed: true })
  })

  it('shows a recoverable image loading error without exporting anything', async () => {
    const onApply = vi.fn()
    const view = render(<EditorModal source={{ ...source, previewUrl: '/broken.png' }} onApply={onApply} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法读取'))
    expect((screen.getByRole('button', { name: '保存编辑' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy()
    view.rerender(<EditorModal source={source} onApply={onApply} onCancel={vi.fn()} />)
    await loaded()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the modal open if PNG encoding fails and never reports a successful save', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(null))
    const onApply = vi.fn(), onCancel = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={onCancel} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '保存编辑' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('导出失败'))
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '保存编辑' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('rejects an oversized decoded source before building an editing bitmap', async () => {
    class LargeImage extends TestImage { naturalWidth = 10000; naturalHeight = 5000 }
    vi.stubGlobal('Image', LargeImage)
    const onApply = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('读取上限'))
    expect(screen.queryByRole('img', { name: '图片编辑预览' })).toBeNull()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('exposes brush controls, supports undo/clear, and omits an empty exported mask', async () => {
    const onApply = vi.fn(), onIntentChange = vi.fn()
    render(<EditorModal source={source} onApply={onApply} onCancel={vi.fn()} onIntentChange={onIntentChange} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: '擦除' }))
    expect(screen.getByRole('button', { name: '擦回' })).toBeTruthy()
    const tools = within(screen.getByRole('toolbar', { name: '图片编辑工具' }))
    expect(tools.getByRole('button', { name: '擦除' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '保存编辑' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect((onApply.mock.calls[0][0] as EditorApplyResult).manifest.erase.strokes).toBe(0)
    expect(onIntentChange).toHaveBeenLastCalledWith(false)
  })

  it('returns keyboard focus and the viewport to the picture when a drawing tool is chosen', async () => {
    render(<EditorModal source={source} onApply={vi.fn()} onCancel={vi.fn()} />)
    await loaded()
    const preview = screen.getByRole('img', { name: '图片编辑预览' })
    const scrollIntoView = vi.fn()
    Object.defineProperty(preview, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    fireEvent.click(screen.getByRole('button', { name: '添加评论' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '标注 1' }))
    fireEvent.click(screen.getByRole('button', { name: '擦除' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(document.activeElement).toBe(preview)
    fireEvent.click(screen.getByRole('button', { name: '标注' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
