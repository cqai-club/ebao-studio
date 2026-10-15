// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import * as slotCore from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry as Registry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MessageImageLoader, MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ComponentType } from 'react'
import * as react from 'react'
import * as reactDOM from 'react-dom'
import * as reactDOMClient from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'
import { useEffect, useRef } from 'react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatImageSingleFit, registerChatImageEditors } from '../src/client/chat-image-editor.tsx'
import type { ImageEditorDialogProps } from '../src/client/ImageEditorDialog.tsx'
import type { ImageGenApi } from '../src/client/api.ts'
import type { ImageGenScope } from '../src/client/settings-scope.ts'

// Published browser clients expose a ModuleLoader factory, rather than ESM exports.
// Evaluate the installed bundle and give its real registry the same shared modules
// as this test; no registry/election behavior is mocked.
const shared: Record<string, unknown> = {
  react, 'react-dom': reactDOM, 'react-dom/client': reactDOMClient,
  'react/jsx-runtime': jsxRuntime, '@deepseek-ai/cordis': cordis,
  '@deepseek-ai/dsh-client-ui-slots': slotCore,
}
let handoff!: { factory(require: (name: string) => unknown): { SlotRegistry: new(ctx: Context) => Registry } }
const rendererPath = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-ui-renderer/client')
runInNewContext(readFileSync(rendererPath, 'utf8'), {
  window: { __ModuleLoader__: { load: (module: typeof handoff) => { handoff = module } } },
}, { filename: rendererPath })
const { SlotRegistry } = handoff.factory(name => {
  if (!(name in shared)) throw new Error(`Unexpected renderer dependency: ${name}`)
  return shared[name]
})

// Only decorative primitives are substituted; their published package includes
// unrelated client-only peers. The installed SlotRegistry above stays real.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconLoadingOutlineRegular: ({ className }: { className?: string }) => <svg className={className} data-icon="loading" />,
  IconRefreshOutlineRegular: () => <svg data-icon="retry" />,
}))

vi.mock('../src/client/ImageEditorDialog.tsx', () => ({
  ImageEditorDialog: ({ source, onClose, onComplete }: ImageEditorDialogProps) => {
    const button = useRef<HTMLButtonElement>(null)
    useEffect(() => {
      button.current?.focus()
      const escape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.preventDefault(); event.stopPropagation(); onClose()
      }
      window.addEventListener('keydown', escape, true)
      return () => window.removeEventListener('keydown', escape, true)
    }, [onClose])
    return <section role="dialog" aria-label="图片编辑器">
      <img src={source.previewUrl} alt="正在编辑的图片" />
      <button ref={button} onClick={onClose}>取消编辑</button>
      <button onClick={() => {
        onComplete?.({ kind: 'local', image: { b64: 'bmV3', mime: 'image/png' }, gallery: [], galleryAdded: true })
        onClose()
      }}>保存新版图片</button>
    </section>
  },
}))

const slotNames = ['conversation.message.images', 'conversation.trajectory.images', 'tool.call.images'] as const
type SlotName = typeof slotNames[number]
const disposers: Array<() => void> = []
afterEach(async () => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) dispose()
  await Promise.resolve()
  vi.restoreAllMocks()
})

const labels: Record<string, string> = {
  'image.label': '图片', 'image.openOriginal': '打开原图', 'image.loading': '正在加载图片',
  'image.loadFailed': '图片加载失败，点击重试', 'image.preview': '图片预览', 'image.closePreview': '关闭图片预览',
}
const t = (key: string, values?: { label?: string }): string => key === 'image.openOriginalLabel' ? `打开原图：${values?.label}` : labels[key] ?? key
const builtin = (): React.JSX.Element => <span>官方图片呈现</span>
const services = { api: {} as ImageGenApi, scope: {} as ImageGenScope }

function declareSlots(ctx: Context): () => void {
  return ctx.slots.register({ name: 'root', children: {
    'conversation.message.images': { kind: 'single', scope: 'session' },
    'conversation.trajectory.images': { kind: 'single', scope: 'session' },
    'tool.call.images': { kind: 'single', scope: 'session' },
  } }, (() => null) as never)
}

function setup() {
  const ctx = new Context()
  new SlotRegistry(ctx)
  disposers.push(declareSlots(ctx))
  for (const name of slotNames) disposers.push(ctx.slots.register({ name, locale: 'conversation' }, builtin))
  disposers.push(registerChatImageEditors(ctx, services))
  return { ctx, slots: ctx.slots }
}

/** Mount the actual elected entry, including its real registered inject callback. */
function mountSlot(slots: Registry, name: SlotName, owner: MessageImagesOwnerProps, sessionId = 'session-1') {
  const entry = slots.entriesOfSlot(name)[0]
  expect(entry.options.priority).toBe(-1)
  expect(entry.locale).toBe('conversation')
  const face = (entry.inject as (sessionId: string) => { sessionId: string })(sessionId)
  const Component = entry.component as ComponentType<MessageImagesOwnerProps & { sessionId: string; t: typeof t }>
  return render(<Component {...owner} {...face} t={t} />)
}

function reference(id = 'original', name = '原图.png'): ImageAttachmentRef {
  return Object.freeze({ attachmentId: id as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: 128, width: 200, height: 100, name })
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  return { promise: new Promise<T>((done, fail) => { resolve = done; reject = fail }), resolve, reject }
}

describe('official native image slot composition', () => {
  it.each([true, false])('shadows default images independent of load order and restores them on disposal (early=%s)', async early => {
    const ctx = new Context()
    new SlotRegistry(ctx)
    let editor: (() => void) | undefined
    if (early) editor = registerChatImageEditors(ctx, services)
    const frame = declareSlots(ctx)
    for (const name of slotNames) ctx.slots.register({ name }, builtin)
    if (!early) editor = registerChatImageEditors(ctx, services)
    for (const name of slotNames) {
      expect(ctx.slots.entries(name).map(entry => entry.options.priority ?? 0)).toEqual([-1, 0])
      expect(ctx.slots.entriesOfSlot(name)[0].component).not.toBe(builtin)
    }
    editor!()
    await Promise.resolve()
    for (const name of slotNames) expect(ctx.slots.entriesOfSlot(name)[0].component).toBe(builtin)
    frame()
  })

  it('re-registers for a later declaration epoch and stops waiting after disposal', async () => {
    const ctx = new Context()
    new SlotRegistry(ctx)
    const editor = registerChatImageEditors(ctx, services)
    const first = declareSlots(ctx)
    expect(ctx.slots.entriesOfSlot('conversation.message.images')[0].options.priority).toBe(-1)
    first()
    const second = declareSlots(ctx)
    expect(ctx.slots.entriesOfSlot('conversation.message.images')[0].options.priority).toBe(-1)
    editor()
    second()
    const third = declareSlots(ctx)
    for (const name of slotNames) expect(ctx.slots.entriesOfSlot(name)).toHaveLength(0)
    third()
  })

  it('opens a native message image in preview before editing, cancels back and retains the original after save', async () => {
    const { slots } = setup()
    const ref = reference()
    const loadImage = vi.fn(async (_ref: ImageAttachmentRef) => 'blob:canonical')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    mountSlot(slots, 'conversation.message.images', { images: [{ attachment: ref }], loadImage, align: 'end' })
    const thumbnail = await screen.findByRole('button', { name: '打开原图：原图.png' })
    await screen.findByRole('img', { name: '原图.png' })
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(ref)
    thumbnail.focus()
    fireEvent.click(thumbnail)
    const preview = screen.getByRole('dialog', { name: '图片预览' })
    expect(within(preview).getByRole('img', { name: '原图.png' }).getAttribute('src')).toBe('blob:canonical')
    fireEvent.click(within(preview).getByRole('button', { name: '编辑图片' }))
    expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '图片编辑器' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '保存新版图片' }))
    expect(screen.getByRole('status').textContent).toContain('另存到 e图库')
    expect(within(screen.getByRole('dialog', { name: '图片预览' })).getByRole('img').getAttribute('src')).toBe('data:image/png;base64,bmV3')
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))
    expect(document.activeElement).toBe(thumbnail)
    expect(screen.getByRole('img', { name: '原图.png' }).getAttribute('src')).toBe('blob:canonical')
    expect(screen.getByRole('img', { name: '编辑后的新版图片' }).getAttribute('src')).toBe('data:image/png;base64,bmV3')
    expect(ref.name).toBe('原图.png')
    expect(loadImage).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('preserves multi-image source order and edits the clicked image through the read_image child slot', async () => {
    const { slots } = setup()
    const first = reference('first', '第一张.png'), second = reference('second', '第二张.png')
    const loadImage = vi.fn(async (ref: ImageAttachmentRef) => `blob:${ref.attachmentId}`)
    mountSlot(slots, 'tool.call.images', { images: [{ attachment: first }, { attachment: second }], loadImage, align: 'start' })
    await screen.findByRole('img', { name: '第二张.png' })
    expect(screen.getAllByRole('img').map(image => image.getAttribute('alt'))).toEqual(['第一张.png', '第二张.png'])
    expect(screen.getAllByRole('button').map(button => button.getAttribute('data-variant'))).toEqual(['tile', 'tile'])
    fireEvent.click(screen.getByRole('button', { name: '打开原图：第二张.png' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    expect(screen.getByRole('img', { name: '正在编辑的图片' }).getAttribute('src')).toBe('blob:second')
    expect(loadImage.mock.calls.map(([ref]) => ref)).toEqual([first, second])
  })

  it('renders trajectory submission previews without invoking the durable loader or owning their URL lifetime', () => {
    const { slots } = setup()
    const loadImage = vi.fn(async (_ref: ImageAttachmentRef) => 'unused')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const view = mountSlot(slots, 'conversation.trajectory.images', {
      images: [{ preview: { url: 'blob:submission', name: '上传图片.png', width: 20, height: 10 } }], loadImage, align: 'end',
    })
    const thumbnail = screen.getByRole('button', { name: '打开原图：上传图片.png' })
    expect(thumbnail.style.width).toBe('20px')
    expect(thumbnail.style.height).toBe('10px')
    fireEvent.click(thumbnail)
    expect((screen.getByRole('button', { name: '编辑图片' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    expect(screen.getByRole('img', { name: '正在编辑的图片' }).getAttribute('src')).toBe('blob:submission')
    view.unmount()
    expect(loadImage).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('previews peek immediately but enables editing only after the canonical URL replaces the seed', async () => {
    const { slots } = setup()
    const ref = reference()
    const canonical = defer<string>()
    const loadImage: MessageImageLoader = Object.assign(vi.fn((_ref: ImageAttachmentRef) => canonical.promise), { peek: vi.fn(() => 'blob:seed') })
    mountSlot(slots, 'conversation.message.images', { images: [{ attachment: ref }], loadImage, align: 'start' })
    fireEvent.click(screen.getByRole('button', { name: '打开原图：原图.png' }))
    const preview = screen.getByRole('dialog', { name: '图片预览' })
    expect(within(preview).getByRole('img').getAttribute('src')).toBe('blob:seed')
    expect((screen.getByRole('button', { name: '编辑图片' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { canonical.resolve('blob:canonical') })
    expect(within(preview).getByRole('img').getAttribute('src')).toBe('blob:canonical')
    expect((screen.getByRole('button', { name: '编辑图片' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    expect(screen.getByRole('img', { name: '正在编辑的图片' }).getAttribute('src')).toBe('blob:canonical')
  })

  it('keeps a failed cached preview uneditable and retries the canonical load from the original reference', async () => {
    const { slots } = setup()
    const ref = reference()
    const canonical = defer<string>()
    const loadImage = Object.assign(vi.fn((_ref: ImageAttachmentRef) => canonical.promise), { peek: () => 'blob:seed' })
    mountSlot(slots, 'conversation.message.images', { images: [{ attachment: ref }], loadImage, align: 'start' })
    fireEvent.click(screen.getByRole('button', { name: '打开原图：原图.png' }))
    await act(async () => { canonical.reject(new Error('access denied')) })
    expect((screen.getByRole('button', { name: '编辑图片' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '图片加载失败，点击重试' }))
    loadImage.mockResolvedValue('blob:retried')
    fireEvent.click(screen.getByRole('button', { name: '图片加载失败，点击重试' }))
    await waitFor(() => expect(screen.getByRole('img', { name: '原图.png' }).getAttribute('src')).toBe('blob:retried'))
    expect(loadImage).toHaveBeenCalledTimes(2)
    expect(loadImage.mock.calls[1][0]).toBe(ref)
    fireEvent.click(screen.getByRole('button', { name: '打开原图：原图.png' }))
    expect((screen.getByRole('button', { name: '编辑图片' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('retains thumbnail loading and error icons, then retries without enlarging the row', async () => {
    const { slots } = setup()
    const response = defer<string>()
    const loadImage = vi.fn((_ref: ImageAttachmentRef) => response.promise)
    mountSlot(slots, 'conversation.message.images', { images: [{ attachment: reference() }], loadImage, align: 'start', thumbnail: true })
    const loading = screen.getByRole('button', { name: '正在加载图片' })
    expect(loading.getAttribute('data-variant')).toBe('thumbnail')
    expect(loading.getAttribute('aria-busy')).toBe('true')
    expect(loading.querySelector('svg')).toBeTruthy()
    expect(loading.textContent).not.toContain('正在加载图片')
    await act(async () => { response.reject(new Error('offline')) })
    const retry = screen.getByRole('button', { name: '图片加载失败，点击重试' })
    expect(retry.getAttribute('data-variant')).toBe('thumbnail')
    expect(retry.querySelector('svg')).toBeTruthy()
    loadImage.mockResolvedValue('blob:retried')
    fireEvent.click(retry)
    await screen.findByRole('img', { name: '原图.png' })
    expect(screen.getByRole('button', { name: '打开原图：原图.png' }).getAttribute('data-variant')).toBe('thumbnail')
  })

  it('contains preview focus and closes one level at a time, restoring the original opener', async () => {
    const { slots } = setup()
    mountSlot(slots, 'conversation.message.images', { images: [{ preview: { url: 'blob:local', name: '本地图.png' } }], loadImage: vi.fn(async (_ref: ImageAttachmentRef) => 'unused'), align: 'start' })
    const opener = screen.getByRole('button', { name: '打开原图：本地图.png' })
    opener.focus()
    fireEvent.click(opener)
    const close = screen.getByRole('button', { name: '关闭图片预览' })
    const edit = screen.getByRole('button', { name: '编辑图片' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(edit)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
    fireEvent.click(edit)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('ignores a late URL from a prior session after its registered renderer unmounts', async () => {
    const { slots } = setup()
    const old = defer<string>()
    const load = vi.fn((_ref: ImageAttachmentRef) => old.promise)
    const view = mountSlot(slots, 'conversation.message.images', { images: [{ attachment: reference() }], loadImage: load, align: 'start' })
    view.unmount()
    mountSlot(slots, 'conversation.message.images', { images: [{ preview: { url: 'blob:new-session', name: '新对话.png' } }], loadImage: load, align: 'start' }, 'session-2')
    await act(async () => { old.resolve('blob:old-session') })
    expect(screen.getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(['blob:new-session'])
    expect(load).toHaveBeenCalledOnce()
  })
})

describe('native single image geometry', () => {
  it('clamps very tall/wide thumbnails and never upscales small images', () => {
    expect(chatImageSingleFit(20, 10)).toEqual({ width: 20, height: 10, objectPosition: 'center' })
    expect(chatImageSingleFit(100, 2000)).toEqual({ width: 60, height: 240, objectPosition: 'center top' })
    expect(chatImageSingleFit(2000, 100)).toEqual({ width: 240, height: 60, objectPosition: 'left center' })
  })
})
