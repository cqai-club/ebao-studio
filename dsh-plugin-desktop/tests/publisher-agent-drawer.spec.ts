// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { AdvancedFrame, type AdvancedFrameProps } from '../src/client/AdvancedFrame.tsx'
import { ExtendedFrame } from '../src/client/ExtendedFrame.tsx'
import { DesktopLayoutState } from '../src/client/layout-state.ts'
import { installDesktopOwnedStyles } from '../src/client/styles.ts'

const PUBLISHER_PANEL = 'cqai-publisher' as MainPanelId
const DRAWER_EVENT = 'cqai-publisher-agent-drawer'

let root: Root | undefined
let container: HTMLDivElement | undefined

async function mount(Frame: typeof AdvancedFrame | typeof ExtendedFrame) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
  const layout = new DesktopLayoutState(id => id === PUBLISHER_PANEL)
  layout.selectPanel(PUBLISHER_PANEL)
  const renderSlot = vi.fn((slot: string, _owner: unknown, options?: { entryKey?: string }) =>
    createElement('span', { 'data-rendered-slot': slot, 'data-entry-key': options?.entryKey }))
  const props = {
    layout,
    platform: 'darwin',
    renderSlot,
    usePanelInfo: (select: (info: PanelInfo) => unknown) => select(layout.getPanelInfo()),
  } as unknown as AdvancedFrameProps
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async () => { await act(async () => { root!.render(createElement(Frame, props)) }) }
  await render()
  return { layout, render, renderSlot }
}

async function request(open: boolean, contentId?: string) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DRAWER_EVENT, { detail: { open, contentId } }))
  })
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe.each([['advanced', AdvancedFrame], ['extended', ExtendedFrame]] as const)('%s Publisher Agent drawer', (_mode, Frame) => {
  it('shows the existing conversation beside the Publisher and closes from its button', async () => {
    const { renderSlot } = await mount(Frame)
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    try {
      expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
      await request(true, 'draft-1')
      const drawer = container!.querySelector<HTMLElement>('#pub-agent-drawer')
      expect(drawer).not.toBeNull()
      expect(drawer?.dataset.contentId).toBe('draft-1')
      expect(container!.querySelector('[data-entry-key="cqai-publisher"]')).not.toBeNull()
      expect(drawer?.querySelector('[data-entry-key="conversation"]')).not.toBeNull()
      expect(renderSlot).toHaveBeenCalledWith('main', {}, { entryKey: 'conversation' })
      const close = drawer!.querySelector<HTMLButtonElement>('button[aria-label="关闭 Agent 对话"]')!
      expect(document.activeElement).toBe(close)
      await request(true, 'draft-2')
      expect(drawer?.dataset.contentId).toBe('draft-2')
      const closed = vi.fn()
      window.addEventListener(DRAWER_EVENT, closed)
      await act(async () => { close.click() })
      expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({ detail: { open: false } }))
      expect(document.activeElement).toBe(opener)
      window.removeEventListener(DRAWER_EVENT, closed)
    } finally { opener.remove() }
  })

  it('accepts external close, Escape, and clears itself when leaving Publisher', async () => {
    const { layout, render } = await mount(Frame)
    await request(true)
    expect(container!.querySelector('#pub-agent-drawer')).not.toBeNull()
    await request(false)
    expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
    await request(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
    await request(true)
    layout.selectPanel(null)
    await render()
    expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
    layout.selectPanel(PUBLISHER_PANEL)
    await render()
    expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
  })

  it('ignores open requests outside Publisher', async () => {
    const { layout, render } = await mount(Frame)
    layout.selectPanel(null)
    await render()
    await request(true)
    expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
    layout.selectPanel(PUBLISHER_PANEL)
    await render()
    expect(container!.querySelector('#pub-agent-drawer')).toBeNull()
  })

  it('uses the full center width even when the ordinary rightbar had a saved track', async () => {
    const { layout, render } = await mount(Frame)
    layout.setRightbar(420, 1600)
    layout.openRightbar(true, false)
    await render()
    await request(true)
    const frame = container!.querySelector<HTMLElement>('.dshDesktopFrame')!
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
    expect(frame.querySelector('#pub-agent-drawer')?.parentElement?.className).toBe('dshDesktopConversationSurface')
    expect(frame.querySelector('.dshDesktopConversationSurface')?.hasAttribute('data-pub-agent-overlay')).toBe(false)
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()

    layout.selectPanel(null)
    await render()
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 420px')
    expect(frame.querySelector('#pub-agent-drawer')).toBeNull()
  })
})

it('limits the reused conversation width inside the drawer', () => {
  const remove = installDesktopOwnedStyles()
  try {
    const css = document.head.querySelector<HTMLStyleElement>('style[data-plugin-css="dsh-plugin-desktop/desktop-owned-layout"]')?.textContent
    expect(css).toContain('.dshDesktopAgentDrawer [data-slot="main.conversation"] > *')
    expect(css).toContain('--dsh-chat-content-width: max(0px, calc(var(--dsh-conversation-column-width, 0px) - 48px))')
    expect(css).toContain('.dshDesktopConversationSurface[data-pub-agent-overlay] .dshDesktopAgentDrawer')
  } finally { remove() }
})
