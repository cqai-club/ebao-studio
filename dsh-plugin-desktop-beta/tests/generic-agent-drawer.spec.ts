// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { AdvancedFrame, type AdvancedFrameProps } from '../src/client/AdvancedFrame.tsx'
import { ExtendedFrame } from '../src/client/ExtendedFrame.tsx'
import { DesktopLayoutState } from '../src/client/layout-state.ts'
import { installDesktopOwnedStyles } from '../src/client/styles.ts'

const TRACK_PANEL = 'cqai-track' as MainPanelId
const PUBLISHER_PANEL = 'cqai-publisher' as MainPanelId
const DRAWER_EVENT = 'dsh-desktop-agent-drawer'
const CAPABILITIES_EVENT = 'dsh-desktop-agent-drawer-capabilities'
const PUBLISHER_EVENT = 'cqai-publisher-agent-drawer'

let root: Root | undefined
let container: HTMLDivElement | undefined

async function mount(Frame: typeof AdvancedFrame | typeof ExtendedFrame, width = 1600, Conversation?: () => React.ReactElement) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width)
  const layout = new DesktopLayoutState(id => id === TRACK_PANEL || id === PUBLISHER_PANEL)
  layout.selectPanel(TRACK_PANEL)
  const renderSlot = vi.fn((slot: string, _owner: unknown, options?: { entryKey?: string }) =>
    slot === 'main' && options?.entryKey === 'conversation' && Conversation
      ? createElement(Conversation)
      : createElement('span', { 'data-rendered-slot': slot, 'data-entry-key': options?.entryKey }))
  const props = {
    layout, platform: 'darwin', renderSlot,
    usePanelInfo: (select: (info: PanelInfo) => unknown) => select(layout.getPanelInfo()),
  } as unknown as AdvancedFrameProps
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async () => { await act(async () => { root!.render(createElement(Frame, props)) }) }
  await render()
  return { layout, render, renderSlot }
}

async function request(detail: unknown, eventName = DRAWER_EVENT) {
  await act(async () => { window.dispatchEvent(new CustomEvent(eventName, { detail })) })
}

const openTrack = (overrides: Record<string, unknown> = {}) => ({
  open: true, panelId: TRACK_PANEL, entityId: 'track-1', requestId: 'request-1',
  title: 'Agent · 当前轨迹', mode: 'simple', side: 'left', ...overrides,
})
const drawer = () => container!.querySelector<HTMLElement>('#desktop-agent-drawer')

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe.each([['advanced', AdvancedFrame], ['extended', ExtendedFrame]] as const)('%s business Agent drawer', (_mode, Frame) => {
  it('places a single official conversation before the main panel and returns focus on close', async () => {
    const { renderSlot } = await mount(Frame)
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    try {
      renderSlot.mockClear()
      await request(openTrack())
      const agent = drawer()!
      const surface = agent.parentElement!
      expect(surface.firstElementChild).toBe(agent)
      expect(surface.lastElementChild?.className).toBe('dshDesktopMainPanelSurface')
      expect(agent.dataset.panelId).toBe(TRACK_PANEL)
      expect(agent.dataset.entityId).toBe('track-1')
      expect(agent.dataset.requestId).toBe('request-1')
      expect(agent.dataset.conversationMode).toBe('simple')
      expect(agent.dataset.agentDrawerSide).toBe('left')
      expect(agent.querySelector('#desktop-agent-drawer-title')?.textContent).toBe('Agent · 当前轨迹')
      expect(container!.querySelectorAll('[data-entry-key="conversation"]')).toHaveLength(1)
      expect(renderSlot).toHaveBeenCalledWith('main', {}, { entryKey: 'conversation' })
      expect(container!.querySelector('[data-pub-agent-open]')).toBeNull()
      const close = agent.querySelector<HTMLButtonElement>('button')!
      expect(document.activeElement).toBe(close)
      const closed = vi.fn()
      window.addEventListener(DRAWER_EVENT, closed)
      try {
        await act(async () => { close.click() })
        expect(drawer()).toBeNull()
        expect(closed).toHaveBeenCalledWith(expect.objectContaining({ detail: {
          open: false, panelId: TRACK_PANEL, entityId: 'track-1', requestId: 'request-1',
        } }))
        expect(document.activeElement).toBe(opener)
      } finally { window.removeEventListener(DRAWER_EVENT, closed) }
    } finally { opener.remove() }
  })

  it('ignores stale and foreign closes while replacing entity requests in the same panel', async () => {
    await mount(Frame)
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DRAWER_EVENT, { detail: openTrack() }))
      window.dispatchEvent(new CustomEvent(DRAWER_EVENT, { detail: openTrack({ entityId: 'track-2', requestId: 'request-2' }) }))
      window.dispatchEvent(new CustomEvent(DRAWER_EVENT, { detail: { open: false, panelId: TRACK_PANEL, requestId: 'request-1' } }))
    })
    expect(drawer()?.dataset.entityId).toBe('track-2')
    await request({ open: false, panelId: PUBLISHER_PANEL, requestId: 'request-2' })
    await request({ open: false, panelId: TRACK_PANEL })
    await request({ open: false, panelId: TRACK_PANEL, entityId: 'track-1', requestId: 'request-2' })
    await request({ open: false }, PUBLISHER_EVENT)
    expect(drawer()?.dataset.entityId).toBe('track-2')
    await request({ open: false, panelId: TRACK_PANEL, entityId: 'track-2', requestId: 'request-2' })
    expect(drawer()).toBeNull()
  })

  it('updates a continuing summary without moving focus, remounting conversation or losing its draft', async () => {
    let mounted = 0, unmounted = 0
    function Conversation() {
      const [draft, setDraft] = useState('')
      useEffect(() => { mounted += 1; return () => { unmounted += 1 } }, [])
      return createElement('div', { 'data-native-conversation': '' },
        createElement('button', { 'data-write-draft': '', onClick: () => setDraft('尚未发送的线路问题') }, '写草稿'),
        createElement('textarea', { 'data-native-composer': '', value: draft, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value) }))
    }
    await mount(Frame, 900, Conversation)
    await request(openTrack({ entityId: 'track-library', title: 'Agent · 轨迹助手', summary: {
      items: [{ label: '轨迹库', value: '2 条轨迹' }, { label: '当前页面', value: '轨迹列表' }], note: '可以继续描述需求。',
    } }))
    const native = drawer()!.querySelector('[data-native-conversation]')!
    const input = drawer()!.querySelector<HTMLTextAreaElement>('[data-native-composer]')!
    await act(async () => { drawer()!.querySelector<HTMLButtonElement>('[data-write-draft]')!.click() })
    input.focus()
    await request({ open: true, panelId: TRACK_PANEL, requestId: 'request-1', summary: {
      items: [{ label: '轨迹库', value: '2 条轨迹' }, { label: '当前页面', value: '轨迹详情' }, { label: '当前线路', value: '峨眉山' }],
    } })
    expect(drawer()?.dataset.agentDrawerSide).toBe('left')
    expect(drawer()?.dataset.conversationMode).toBe('simple')
    expect(drawer()?.dataset.entityId).toBe('track-library')
    expect(drawer()?.querySelector('#desktop-agent-drawer-title')?.textContent).toBe('Agent · 轨迹助手')
    expect(drawer()?.querySelector('[data-agent-drawer-summary]')?.textContent).toContain('峨眉山')
    expect(drawer()?.querySelector('[data-native-conversation]')).toBe(native)
    expect(drawer()?.querySelector('[data-native-composer]')).toBe(input)
    expect(input.value).toBe('尚未发送的线路问题')
    expect(document.activeElement).toBe(input)
    expect(mounted).toBe(1)
    expect(unmounted).toBe(0)
    await request({ open: true, panelId: TRACK_PANEL, requestId: 'request-1', summary: { items: [] } })
    expect(drawer()?.querySelector('[data-agent-drawer-summary]')).toBeNull()
    expect(drawer()?.querySelector('[data-native-composer]')).toBe(input)
    expect(input.value).toBe('尚未发送的线路问题')
    expect(document.activeElement).toBe(input)
    expect(mounted).toBe(1)
  })

  it('bounds summary text and rejects malformed items without rendering caller HTML', async () => {
    await mount(Frame)
    await request(openTrack({ summary: {
      items: [null, { label: 1, value: 'bad' }, { label: 'bad', value: 1 },
        ...Array.from({ length: 9 }, (_, index) => ({ label: String(index) + 'l'.repeat(80), value: '<img src=x>' + 'v'.repeat(200) }))],
      note: '<b>note</b>' + 'n'.repeat(300),
    } }))
    const summary = drawer()!.querySelector('[data-agent-drawer-summary]')!
    expect(summary.querySelectorAll('dt')).toHaveLength(6)
    expect([...summary.querySelectorAll('dt')].every(item => item.textContent?.length === 40)).toBe(true)
    expect([...summary.querySelectorAll('dd')].every(item => item.textContent?.length === 160)).toBe(true)
    expect(summary.querySelector('p')?.textContent?.length).toBe(240)
    expect(summary.querySelector('img, b')).toBeNull()
    for (const malformed of [null, [], 'text', { items: 'text', note: 'ignored' }, { items: [{ label: '', value: 'bad' }, { label: 'valid', value: null }], note: 5 }]) {
      await request(openTrack({ summary: malformed }))
      expect(drawer()?.querySelector('[data-agent-drawer-summary]')).toBeNull()
    }
    await request(openTrack({ summary: { items: [], note: '只有说明' } }))
    expect(drawer()?.querySelector('[data-agent-drawer-summary] p')?.textContent).toBe('只有说明')
  })

  it('announces sides synchronously and removes the capability listener on unmount', async () => {
    const accept = vi.fn()
    window.dispatchEvent(new CustomEvent(CAPABILITIES_EVENT, { detail: { accept } }))
    expect(accept).not.toHaveBeenCalled()
    await mount(Frame)
    window.dispatchEvent(new CustomEvent(CAPABILITIES_EVENT, { detail: { accept } }))
    expect(accept).toHaveBeenCalledWith({ sides: ['left', 'right'] })
    await act(async () => { root!.unmount() })
    root = undefined
    accept.mockClear()
    window.dispatchEvent(new CustomEvent(CAPABILITIES_EVENT, { detail: { accept } }))
    expect(accept).not.toHaveBeenCalled()
  })

  it('rejects malformed requests and opens only for the active business panel', async () => {
    const { layout, render } = await mount(Frame)
    for (const detail of [null, {}, { open: 'true', panelId: TRACK_PANEL }, { open: true }, { open: true, panelId: '' }, { open: true, panelId: 'conversation' }, openTrack({ panelId: PUBLISHER_PANEL })]) {
      await request(detail)
    }
    expect(drawer()).toBeNull()
    layout.selectPanel(null)
    await render()
    await request(openTrack())
    expect(drawer()).toBeNull()
    layout.selectPanel(TRACK_PANEL)
    await render()
    expect(drawer()).toBeNull()
  })

  it('preserves rightbar preferences while a business Agent owns the center', async () => {
    const { layout, render } = await mount(Frame)
    layout.setRightbar(420, 1600)
    layout.openRightbar(true, false)
    await render()
    await request(openTrack())
    const frame = container!.querySelector<HTMLElement>('.dshDesktopFrame')!
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    expect(frame.querySelector('[data-agent-drawer-overlay]')).toBeNull()
    expect(frame.querySelector('.dshDesktopMainPanelSurface')?.hasAttribute('inert')).toBe(false)
    await request({ open: false, panelId: TRACK_PANEL, requestId: 'request-1' })
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 420px')
    expect(layout.getSnapshot().rightbar).toBe(420)
  })

  it('uses a left overlay in narrow space and safely renders request titles as text', async () => {
    await mount(Frame, 900)
    await request(openTrack({ title: '<img src=x onerror=alert(1)>' }))
    expect(drawer()?.parentElement?.hasAttribute('data-agent-drawer-overlay')).toBe(true)
    expect(container!.querySelector('.dshDesktopMainPanelSurface')?.hasAttribute('inert')).toBe(true)
    expect(container!.querySelector('.dshDesktopSidebarSurface')?.hasAttribute('inert')).toBe(false)
    expect(drawer()?.querySelector('img')).toBeNull()
    expect(drawer()?.querySelector('#desktop-agent-drawer-title')?.textContent).toBe('<img src=x onerror=alert(1)>')
    await request({ open: true, panelId: TRACK_PANEL })
    const agent = drawer()!
    expect(agent.parentElement?.lastElementChild).toBe(agent)
    expect(agent.dataset.agentDrawerSide).toBe('right')
    expect(agent.dataset.conversationMode).toBe('full')
    expect(agent.querySelector('#desktop-agent-drawer-title')?.textContent).toBe('Agent · 当前内容')
  })

  it('restores the covered opener only after removing inert on button and external close', async () => {
    await mount(Frame, 900)
    const main = container!.querySelector<HTMLElement>('.dshDesktopMainPanelSurface')!
    const opener = document.createElement('button')
    main.append(opener)
    opener.focus()
    const nativeFocus = opener.focus.bind(opener)
    const restored = vi.spyOn(opener, 'focus').mockImplementation(() => {
      expect(opener.closest('[inert]')).toBeNull()
      nativeFocus()
    })
    try {
      await request(openTrack())
      expect(main.hasAttribute('inert')).toBe(true)
      await act(async () => { drawer()!.querySelector<HTMLButtonElement>('button')!.click() })
      expect(main.hasAttribute('inert')).toBe(false)
      expect(restored).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(opener)
      await request(openTrack())
      await request({ open: false, panelId: TRACK_PANEL, entityId: 'track-1', requestId: 'request-1' })
      expect(main.hasAttribute('inert')).toBe(false)
      expect(restored).toHaveBeenCalledTimes(2)
      expect(document.activeElement).toBe(opener)
    } finally { opener.remove() }
  })

  it('keeps native dialog Escape ownership and emits the source close when leaving the panel', async () => {
    const { layout, render } = await mount(Frame)
    await request(openTrack())
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    try {
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(drawer()).not.toBeNull()
    } finally { modal.remove() }
    const nativeDialog = document.createElement('dialog')
    nativeDialog.setAttribute('open', '')
    document.body.append(nativeDialog)
    try {
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(drawer()).not.toBeNull()
    } finally { nativeDialog.remove() }
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(drawer()).toBeNull()
    await request(openTrack())
    const closed = vi.fn()
    window.addEventListener(DRAWER_EVENT, closed)
    try {
      layout.selectPanel(null)
      await render()
      expect(drawer()).toBeNull()
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({ detail: {
        open: false, panelId: TRACK_PANEL, entityId: 'track-1', requestId: 'request-1',
      } }))
      layout.selectPanel(TRACK_PANEL)
      await render()
      expect(drawer()).toBeNull()
    } finally { window.removeEventListener(DRAWER_EVENT, closed) }
  })

  it('isolates Generic and Publisher source events and retains Publisher content labels', async () => {
    const { layout, render } = await mount(Frame)
    layout.selectPanel(PUBLISHER_PANEL)
    await render()
    await request({ open: true, contentId: 'draft-1', contentType: 'image-note', mode: 'simple' }, PUBLISHER_EVENT)
    await request({ open: false, panelId: PUBLISHER_PANEL })
    const publisher = container!.querySelector<HTMLElement>('#pub-agent-drawer')!
    expect(publisher.dataset.contentId).toBe('draft-1')
    expect(publisher.querySelector('#pub-agent-drawer-title')?.textContent).toBe('Agent · 当前图文')
    expect(publisher.parentElement?.lastElementChild).toBe(publisher)
    expect(container!.querySelector('[data-agent-drawer-open]')).toBeNull()
    await request({ open: true, panelId: PUBLISHER_PANEL, entityId: 'generic', requestId: 'generic-request', side: 'left' })
    await request({ open: false }, PUBLISHER_EVENT)
    expect(drawer()).not.toBeNull()
    await request({ open: false, panelId: PUBLISHER_PANEL, requestId: 'generic-request' })
    expect(drawer()).toBeNull()
  })
})

it('scopes the left border and overlay placement to business drawers', () => {
  const remove = installDesktopOwnedStyles()
  try {
    const css = document.head.querySelector<HTMLStyleElement>('style[data-plugin-css="dsh-plugin-desktop/desktop-owned-layout"]')?.textContent
    expect(css).toContain('.dshDesktopAgentDrawer[data-agent-drawer-side="left"] { border-left: 0; border-right:')
    expect(css).toContain('.dshDesktopConversationSurface[data-agent-drawer-overlay] .dshDesktopAgentDrawer[data-agent-drawer-side="left"] { right: auto; left: 0;')
    expect(css).toContain('.dshDesktopConversationSurface[data-pub-agent-overlay] .dshDesktopAgentDrawer')
    expect(css).toContain('.dshDesktopAgentDrawerSummary { box-sizing: border-box; flex: 0 1 auto; min-height: 0; max-height: min(180px, 25vh); overflow-y: auto;')
  } finally { remove() }
})
