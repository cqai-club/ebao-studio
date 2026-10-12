// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { MarkdownImagePreviewProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerMarkdownImageEditor } from '../src/client/markdown-image-editor.tsx'
import type { ImageEditorDialogProps } from '../src/client/ImageEditorDialog.tsx'
import type { ImageGenApi } from '../src/client/api.ts'
import type { ImageGenScope } from '../src/client/settings-scope.ts'

const publicAPI = vi.hoisted(() => ({
  register: undefined as unknown,
  previews: [] as unknown[],
  removed: vi.fn(),
  editorProps: vi.fn(),
  saved: 0,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  get registerMarkdownImagePreview() { return publicAPI.register },
  IconLoadingOutlineRegular: () => <svg />,
  IconRefreshOutlineRegular: () => <svg />,
}))
vi.mock('../src/client/ImageEditorDialog.tsx', () => ({
  ImageEditorDialog: (props: ImageEditorDialogProps) => {
    publicAPI.editorProps(props)
    const [error, setError] = useState(false)
    const closeRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
      closeRef.current?.focus()
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.preventDefault(); event.stopPropagation(); props.onClose()
      }
      window.addEventListener('keydown', onKey, true)
      return () => window.removeEventListener('keydown', onKey, true)
    }, [props.onClose])
    return <section role="dialog" aria-label="图片编辑器">
      <img src={props.source.previewUrl} alt="待编辑图片" />
      <button ref={closeRef} onClick={props.onClose}>取消编辑</button>
      <button onClick={() => {
        publicAPI.saved++
        props.onComplete?.({ kind: 'local', image: { mime: 'image/png', b64: `new-${publicAPI.saved}` }, gallery: [], galleryAdded: true })
        props.onClose()
      }}>保存新版</button>
      <button onClick={() => { setError(true) }}>模拟保存失败</button>
      {error ? <p role="alert">保存失败，请重试</p> : null}
    </section>
  },
}))

const disposers: Array<() => void | Promise<void>> = []
afterEach(async () => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  publicAPI.previews.splice(0)
  publicAPI.saved = 0
  publicAPI.register = undefined
  vi.clearAllMocks()
})
const services = { api: {} as ImageGenApi, scope: {} as ImageGenScope }
const labels = { dialog: 'Markdown 图片预览', close: '关闭 Markdown 图片预览' }
const source = Object.freeze({ src: 'https://example.com/resolved-original.png', destination: '/generated/original.png', alt: 'Agent 生成图片' })

function installAPI() {
  publicAPI.register = vi.fn((Preview: ComponentType<MarkdownImagePreviewProps>) => {
    publicAPI.previews.push(Preview)
    return () => {
      publicAPI.previews.splice(publicAPI.previews.indexOf(Preview), 1)
      publicAPI.removed()
    }
  })
}

function register() {
  installAPI()
  const ctx = new Context()
  disposers.push(registerMarkdownImageEditor(ctx, services))
  return publicAPI.previews[0] as ComponentType<MarkdownImagePreviewProps>
}

/** Like LoadedMarkdownImage, the existing owner alone controls open/close. */
function mountOwner(Preview: ComponentType<MarkdownImagePreviewProps>, props = source) {
  const closed = vi.fn()
  const Owner = (): React.JSX.Element => {
    const [open, setOpen] = useState(false)
    return <>
      <button onClick={() => { setOpen(true) }} aria-label="打开 Agent 图片"><img src={props.src} alt={props.alt} /></button>
      {open ? <Preview {...props} labels={labels} onClose={() => { closed(); setOpen(false) }} /> : null}
    </>
  }
  render(<Owner />)
  const opener = screen.getByRole('button', { name: '打开 Agent 图片' })
  opener.focus()
  fireEvent.click(opener)
  return { opener, closed }
}

describe('public Markdown image preview registration', () => {
  it('ties registration to the owning Cordis fiber and installs again after reload', async () => {
    installAPI()
    const ctx = new Context()
    const plugin = { apply: (scope: Context) => { registerMarkdownImageEditor(scope, services) } }
    const first = ctx.plugin(plugin)
    await first.await()
    expect(publicAPI.previews).toHaveLength(1)
    expect(publicAPI.register).toHaveBeenCalledOnce()
    await first.dispose()
    expect(publicAPI.previews).toHaveLength(0)
    expect(publicAPI.removed).toHaveBeenCalledOnce()
    const next = ctx.plugin(plugin)
    await next.await()
    expect(publicAPI.previews).toHaveLength(1)
    disposers.push(() => next.dispose())
  })

  it('boots on older primitives without the optional preview API', () => {
    publicAPI.register = undefined
    const ctx = new Context()
    expect(() => registerMarkdownImageEditor(ctx, services)()).not.toThrow()
    expect(publicAPI.previews).toHaveLength(0)
  })

  it('uses the already resolved source URL and the same API/settings services', () => {
    mountOwner(register())
    const preview = screen.getByRole('dialog', { name: labels.dialog })
    expect(within(preview).getByRole('img').getAttribute('src')).toBe(source.src)
    fireEvent.click(within(preview).getByRole('button', { name: '编辑图片' }))
    expect(screen.queryByRole('dialog', { name: labels.dialog })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('img', { name: '待编辑图片' }).getAttribute('src')).toBe(source.src)
    const props = publicAPI.editorProps.mock.calls.at(-1)![0] as ImageEditorDialogProps
    expect(props.api).toBe(services.api)
    expect(props.scope).toBe(services.scope)
    expect(props.source.name).toBe(source.alt)
  })

  it('cancels back to the original preview and finally closes the Markdown owner', () => {
    const { opener, closed } = mountOwner(register())
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    expect(closed).not.toHaveBeenCalled()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(screen.getByRole('dialog', { name: labels.dialog })).getByRole('img').getAttribute('src')).toBe(source.src)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: labels.close }))
    expect(closed).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps the original thumbnail and props while showing, switching and continuing the saved version', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { opener } = mountOwner(register())
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '保存新版' }))
    const preview = screen.getByRole('dialog', { name: labels.dialog })
    expect(within(preview).getByRole('img').getAttribute('src')).toBe('data:image/png;base64,new-1')
    expect(within(opener).getByRole('img').getAttribute('src')).toBe(source.src)
    expect(screen.getByRole('status').textContent).toContain('另存到 e图库')
    fireEvent.click(screen.getByRole('button', { name: '查看原图' }))
    expect(within(preview).getByRole('img').getAttribute('src')).toBe(source.src)
    fireEvent.click(screen.getByRole('button', { name: '查看新版' }))
    fireEvent.click(screen.getByRole('button', { name: '继续编辑图片' }))
    expect(screen.getByRole('img', { name: '待编辑图片' }).getAttribute('src')).toBe('data:image/png;base64,new-1')
    fireEvent.click(screen.getByRole('button', { name: '保存新版' }))
    expect(within(screen.getByRole('dialog', { name: labels.dialog })).getByRole('img').getAttribute('src')).toBe('data:image/png;base64,new-2')
    expect(source.src).toBe('https://example.com/resolved-original.png')
    expect(source.destination).toBe('/generated/original.png')
    fireEvent.click(screen.getByRole('button', { name: labels.close }))
    expect(document.activeElement).toBe(opener)
    expect(within(opener).getByRole('img').getAttribute('src')).toBe(source.src)
    expect(revoke).not.toHaveBeenCalled()
    revoke.mockRestore()
  })

  it('keeps errors visible in the single editor until the user cancels or retries', () => {
    const { closed } = mountOwner(register())
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '模拟保存失败' }))
    expect(screen.getByRole('alert').textContent).toContain('保存失败')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(closed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存新版' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('contains preview focus and Escape only closes the currently visible layer', () => {
    const { opener, closed } = mountOwner(register())
    const close = screen.getByRole('button', { name: labels.close })
    const edit = screen.getByRole('button', { name: '编辑图片' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(edit)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
    fireEvent.click(edit)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: labels.dialog })).toBeTruthy()
    expect(closed).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes from the backdrop through the original owner callback', () => {
    const { closed, opener } = mountOwner(register())
    fireEvent.mouseDown(screen.getByRole('dialog', { name: labels.dialog }).querySelector('[aria-hidden="true"]')!)
    expect(closed).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)
  })

  it('resets local result state when the resolved Markdown source changes', async () => {
    const Preview = register()
    const props = { ...source, labels, onClose: vi.fn() }
    const view = render(<Preview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '保存新版' }))
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => { view.rerender(<Preview {...props} src="blob:different-source" destination="/new-source.png" />) })
    expect(screen.queryByRole('status')).toBeNull()
    expect(within(screen.getByRole('dialog', { name: labels.dialog })).getByRole('img').getAttribute('src')).toBe('blob:different-source')
  })
})
