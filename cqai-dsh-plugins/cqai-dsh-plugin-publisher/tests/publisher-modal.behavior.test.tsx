// @vitest-environment jsdom
import { act, StrictMode, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublisherModal } from '../src/client/shared.tsx'

// Keep the native Modal's portal, children-first layout focus, and independent
// document keyboard layer. These are the interactions the Publisher wrapper owns.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { useLayoutEffect, useRef } = await import('react')
  const { createPortal } = await import('react-dom')
  // Reuse the pinned implementation without loading the unrelated visual package dependencies.
  const { observeComposition } = await import('../../../deepseek-harness/packages/client/ui-primitives/src/keyboard-composition.ts')
  const layers: HTMLElement[] = []
  return {
    observeComposition,
    Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    Tag: ({ children }: any) => <span>{children}</span>,
    Modal: ({ open, title, children, footer, onClose, className, onKeyDownCapture, headless }: any) => {
      const ref = useRef<HTMLDivElement>(null)
      const close = useRef(onClose)
      close.current = onClose
      useLayoutEffect(() => {
        if (!open || !ref.current) return
        const dialog = ref.current
        const composition = observeComposition(document)
        const previous = document.activeElement as HTMLElement | null
        layers.push(dialog)
        ;(dialog.querySelector<HTMLElement>('button, input') ?? dialog).focus()
        const keydown = (event: KeyboardEvent) => {
          const composing = composition.guards(event)
          if (layers.at(-1) !== dialog || event.defaultPrevented || composing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
          if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) close.current() }
        }
        document.addEventListener('keydown', keydown)
        return () => {
          composition.dispose()
          const wasTop = layers.at(-1) === dialog
          layers.splice(layers.indexOf(dialog), 1)
          document.removeEventListener('keydown', keydown)
          if (wasTop && previous?.isConnected) previous.focus()
        }
      }, [open])
      if (!open) return null
      return createPortal(<div onKeyDownCapture={onKeyDownCapture}>
        <div ref={ref} className={className} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
          {!headless && <button aria-label={`关闭${title}`} onClick={onClose}/>}
          {children}<footer>{footer}</footer>
        </div>
      </div>, document.body)
    },
  }
})

let container: HTMLDivElement
let root: Root
let trigger: HTMLButtonElement

async function render(node: ReactNode) {
  await act(async () => { root.render(node) })
}

function dialog(title: string) {
  return document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${title}"]`)!
}

function control(title: string, text: string) {
  return Array.from(dialog(title).querySelectorAll('button')).find(button => button.textContent === text)!
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

async function key(element: HTMLElement, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  await act(async () => { element.dispatchEvent(event) })
  return event
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList
  })
  container = document.createElement('div')
  trigger = document.createElement('button')
  trigger.textContent = '文风设置'
  document.body.append(trigger, container)
  trigger.focus()
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  trigger.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function NestedDialogs({ startNested = false }: { startNested?: boolean }) {
  const [open, setOpen] = useState(true)
  const [confirming, setConfirming] = useState(startNested)
  return <PublisherModal open={open} title="文风设置" closeLabel="关闭" onClose={() => setOpen(false)}>
    <input aria-label="文风名称" data-pub-initial-focus/>
    <button onClick={() => setConfirming(true)}>清除文风</button>
    <PublisherModal open={confirming} title="确认清除" closeLabel="关闭" onClose={() => setConfirming(false)}>
      <button data-pub-initial-focus onClick={() => setConfirming(false)}>取消</button>
      <button onClick={() => setOpen(false)}>关闭全部</button>
    </PublisherModal>
  </PublisherModal>
}

describe('Publisher modal foreground focus', () => {
  it('selects a visible enabled initial control and returns to the original trigger', async () => {
    const close = vi.fn()
    const modal = (open: boolean) => <PublisherModal open={open} title="文风设置" closeLabel="关闭" onClose={close}>
      <button data-pub-initial-focus disabled>不可用</button>
      <button data-pub-initial-focus hidden>隐藏</button>
      <input aria-label="默认文风" data-pub-initial-focus/>
    </PublisherModal>
    await render(modal(true))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('默认文风')
    await render(modal(false))
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps a same-commit nested dialog above its ancestor despite children-first effects', async () => {
    await render(<NestedDialogs startNested/>)
    expect(document.activeElement).toBe(control('确认清除', '取消'))
    control('文风设置', '清除文风').focus()
    expect(dialog('确认清除').contains(document.activeElement)).toBe(true)
    const last = control('确认清除', '关闭全部')
    last.focus()
    expect((await key(last, 'Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭确认清除')
    expect((await key(document.activeElement as HTMLElement, 'Tab', { shiftKey: true })).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    await key(last, 'Escape')
    expect(dialog('确认清除')).toBeNull()
    expect(dialog('文风设置')).not.toBeNull()
    expect(dialog('文风设置').contains(document.activeElement)).toBe(true)
    await key(document.activeElement as HTMLElement, 'Escape')
    expect(dialog('文风设置')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('returns from confirmation to its invoking button, then from settings to the page', async () => {
    await render(<NestedDialogs/>)
    const clear = control('文风设置', '清除文风')
    clear.focus()
    await click(clear)
    expect(document.activeElement).toBe(control('确认清除', '取消'))
    await click(control('确认清除', '取消'))
    expect(document.activeElement).toBe(clear)
    await key(clear, 'Escape')
    expect(document.activeElement).toBe(trigger)
  })

  it('returns to the page when the whole nested tree closes in one commit', async () => {
    await render(<NestedDialogs/>)
    const clear = control('文风设置', '清除文风')
    clear.focus()
    await click(clear)
    await click(control('确认清除', '关闭全部'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('blocks background close controls and retains the foreground last focused field', async () => {
    const below = vi.fn()
    const top = vi.fn()
    await render(<>
      <PublisherModal open title="背景" closeLabel="关闭" onClose={below}><input aria-label="背景字段"/></PublisherModal>
      <PublisherModal open title="前景" closeLabel="关闭" onClose={top}><input aria-label="前景字段"/></PublisherModal>
    </>)
    const field = dialog('前景').querySelector('input')!
    field.focus()
    await click(dialog('背景').querySelector('button')!)
    expect(below).not.toHaveBeenCalled()
    trigger.focus()
    expect(document.activeElement).toBe(field)
    await key(field, 'Escape')
    expect(top).toHaveBeenCalledOnce()
    expect(below).not.toHaveBeenCalled()
  })

  it('survives StrictMode setup/cleanup and leaves no trap after closure', async () => {
    const modal = (open: boolean) => <StrictMode><PublisherModal open={open} title="文风设置" closeLabel="关闭" onClose={() => {}}>
      <input data-pub-initial-focus aria-label="名称"/>
    </PublisherModal></StrictMode>
    await render(modal(true))
    expect(dialog('文风设置').contains(document.activeElement)).toBe(true)
    await render(modal(false))
    expect(document.activeElement).toBe(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    await render(modal(true))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('名称')
    await render(modal(false))
    expect(document.activeElement).toBe(trigger)
  })

  it('preserves nested ordering and the original return target through StrictMode replay', async () => {
    await render(<StrictMode><NestedDialogs startNested/></StrictMode>)
    expect(document.activeElement).toBe(control('确认清除', '取消'))
    await key(document.activeElement as HTMLElement, 'Escape')
    expect(dialog('确认清除')).toBeNull()
    expect(dialog('文风设置').contains(document.activeElement)).toBe(true)
    await key(document.activeElement as HTMLElement, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('preserves local capture ownership and ignores composition, modified, or repeated Escape', async () => {
    const close = vi.fn()
    const capture = vi.fn((event: { key: string; preventDefault(): void }) => { if (event.key === 'Escape') event.preventDefault() })
    await render(<PublisherModal open title="菜单" closeLabel="关闭" onClose={close} onKeyDownCapture={capture}><input/></PublisherModal>)
    await key(document.activeElement as HTMLElement, 'Escape')
    expect(capture).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    await render(<PublisherModal open title="菜单" closeLabel="关闭" onClose={close}><input/></PublisherModal>)
    for (const extra of [{ isComposing: true }, { shiftKey: true }, { ctrlKey: true }, { repeat: true }]) {
      await key(document.activeElement as HTMLElement, 'Escape', extra)
    }
    expect(close).not.toHaveBeenCalled()
  })

  it('retains focus in a headless dialog with no focusable controls', async () => {
    await render(<PublisherModal open headless title="处理中" onClose={() => {}}><p>正在保存…</p></PublisherModal>)
    expect(document.activeElement).toBe(dialog('处理中'))
    expect((await key(dialog('处理中'), 'Tab')).defaultPrevented).toBe(true)
    trigger.focus()
    expect(document.activeElement).toBe(dialog('处理中'))
  })

  it.each(['active composition', 'composition-end keydown', 'legacy IME keydown'])(
    'keeps the modal open for an Escape owned by %s', async mode => {
      const close = vi.fn()
      await render(<PublisherModal open title="文风设置" closeLabel="关闭" onClose={close}><input/></PublisherModal>)
      const input = dialog('文风设置').querySelector('input')!
      if (mode !== 'legacy IME keydown') {
        await act(async () => { input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
        if (mode === 'composition-end keydown') {
          await act(async () => { input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
        }
      }
      await key(input, 'Escape', mode === 'legacy IME keydown' ? { keyCode: 229 } : {})
      expect(close).not.toHaveBeenCalled()
      expect(dialog('文风设置')).not.toBeNull()

      if (mode === 'active composition') {
        await act(async () => { input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
      }
      await act(async () => { input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })) })
      await key(input, 'Escape')
      expect(close).toHaveBeenCalledOnce()
    },
  )
})
