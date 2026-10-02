import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './contracts.ts'
import type { DesktopClientPlatform } from './environment.ts'
import {
  collapsedSidebarWidth, computeDesktopColumns, DesktopLayoutState,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, RIGHTBAR_DEFAULT_RATIO,
} from './layout-state.ts'

const PUBLISHER_PANEL = 'cqai-publisher'
const PUBLISHER_AGENT_DRAWER_EVENT = 'cqai-publisher-agent-drawer'
const AGENT_CONTENT_LABELS = { article: '文章', 'image-note': '图文', video: '视频' } as const
const DESKTOP_AGENT_DRAWER_EVENT = 'dsh-desktop-agent-drawer'
const DESKTOP_AGENT_DRAWER_CAPABILITIES_EVENT = 'dsh-desktop-agent-drawer-capabilities'

interface PublisherAgentDrawerRequest {
  open: boolean
  contentId?: string
  contentType?: keyof typeof AGENT_CONTENT_LABELS
  /** The opener chooses whether a blank conversation shows the home presentation. */
  mode?: 'full' | 'simple'
}

interface AgentDrawerSummary {
  items: readonly { label: string; value: string }[]
  note?: string
}

/** Keep caller context bounded and textual before it reaches the shared shell. */
function normalizeAgentDrawerSummary(value: unknown): AgentDrawerSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const summary = value as { items?: unknown; note?: unknown }
  if (!Array.isArray(summary.items)) return
  const items: { label: string; value: string }[] = []
  for (const candidate of summary.items) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const item = candidate as { label?: unknown; value?: unknown }
    if (typeof item.label !== 'string' || typeof item.value !== 'string') continue
    const label = item.label.trim().slice(0, 40)
    if (!label) continue
    items.push({ label, value: item.value.trim().slice(0, 160) })
    if (items.length === 6) break
  }
  const note = typeof summary.note === 'string' ? summary.note.trim().slice(0, 240) : undefined
  if (!items.length && !note) return
  return { items, ...(note ? { note } : {}) }
}

/** Business panels reuse the official conversation through this Desktop-owned event. */
interface DesktopAgentDrawerRequest {
  open: boolean
  panelId: string
  entityId?: string
  requestId?: string
  title?: string
  mode?: 'full' | 'simple'
  side?: 'left' | 'right'
  summary?: AgentDrawerSummary
}

interface AgentDrawerState extends PublisherAgentDrawerRequest {
  sourceEvent?: typeof PUBLISHER_AGENT_DRAWER_EVENT | typeof DESKTOP_AGENT_DRAWER_EVENT
  panelId?: string
  entityId?: string
  requestId?: string
  title?: string
  side?: 'left' | 'right'
  summary?: AgentDrawerSummary | undefined
}

/** Private values assembled by one Desktop-owned shell registration. */
export interface AdvancedFrameInjected {
  /** Desktop-owned panel state exposed through the standard layout service. */
  layout: DesktopLayoutState
  /** Host platform controlling native title-bar spacing. */
  platform: DesktopClientPlatform
}

/** Full enhanced-mode root slot props. */
export type AdvancedFrameProps = PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.overlay'>
  & AdvancedFrameInjected

/** Enhanced-mode owner preserving the original Desktop layout contract. */
export function AdvancedFrame(props: AdvancedFrameProps) {
  return <DesktopOwnedFrame {...props} mode="advanced" />
}

/** Shared panel mechanics below the two mode-specific root boundaries. */
export function DesktopOwnedFrame({
  layout,
  mode,
  platform,
  renderSlot,
  usePanelInfo,
}: AdvancedFrameProps & {
  readonly mode: 'extended' | 'advanced'
}) {
  const subscribeLayout = useCallback((listener: () => void) => layout.subscribe(listener), [layout])
  const readLayout = useCallback(() => layout.getSnapshot(), [layout])
  const panels = useSyncExternalStore(subscribeLayout, readLayout, readLayout)
  const frameRef = useRef<HTMLDivElement>(null)
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const panelId = usePanelInfo(info => info.activePanelId)
  const panelIdRef = useRef(panelId)
  panelIdRef.current = panelId
  const [agentDrawer, setAgentDrawer] = useState<AgentDrawerState>({ open: false })
  const agentDrawerRef = useRef<AgentDrawerState>({ open: false })
  const closeAgentButtonRef = useRef<HTMLButtonElement>(null)
  const agentReturnFocusRef = useRef<HTMLElement | null>(null)
  const pendingAgentReturnFocusRef = useRef<HTMLElement | null>(null)
  const agentDrawerVisible = panelId === agentDrawer.panelId && agentDrawer.open
  const publisherDrawerVisible = agentDrawerVisible && agentDrawer.sourceEvent === PUBLISHER_AGENT_DRAWER_EVENT
  const genericDrawerVisible = agentDrawerVisible && agentDrawer.sourceEvent === DESKTOP_AGENT_DRAWER_EVENT
  const agentDrawerSide = agentDrawer.side ?? 'right'

  const closeAgentDrawer = useCallback(() => {
    const current = agentDrawerRef.current
    if (!current.open || !current.sourceEvent) return
    const detail = current.sourceEvent === PUBLISHER_AGENT_DRAWER_EVENT
      ? { open: false }
      : {
          open: false, panelId: current.panelId,
          ...(current.entityId !== undefined ? { entityId: current.entityId } : {}),
          ...(current.requestId !== undefined ? { requestId: current.requestId } : {}),
        }
    window.dispatchEvent(new CustomEvent(current.sourceEvent, { detail }))
  }, [])

  useEffect(() => {
    const updateDrawer = (next: AgentDrawerState) => {
      if (next.open && !agentDrawerRef.current.open) {
        agentReturnFocusRef.current = pendingAgentReturnFocusRef.current
          ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        pendingAgentReturnFocusRef.current = null
      } else if (!next.open && agentDrawerRef.current.open) {
        pendingAgentReturnFocusRef.current = agentReturnFocusRef.current
        agentReturnFocusRef.current = null
      }
      agentDrawerRef.current = next
      setAgentDrawer(next)
    }
    const onPublisherRequest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || typeof (detail as { open?: unknown }).open !== 'boolean') return
      const request = detail as PublisherAgentDrawerRequest
      if (request.open) {
        if (panelIdRef.current !== PUBLISHER_PANEL) return
        const contentType = typeof request.contentType === 'string' && Object.hasOwn(AGENT_CONTENT_LABELS, request.contentType)
          ? request.contentType : 'article'
        updateDrawer({
          open: true, contentType, sourceEvent: PUBLISHER_AGENT_DRAWER_EVENT, panelId: PUBLISHER_PANEL,
          mode: request.mode === 'simple' ? 'simple' : 'full', side: 'right',
          ...(typeof request.contentId === 'string' ? { contentId: request.contentId } : {}),
        })
      } else if (agentDrawerRef.current.sourceEvent === PUBLISHER_AGENT_DRAWER_EVENT) {
        updateDrawer({ open: false })
      }
    }
    const onDesktopRequest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || typeof (detail as { open?: unknown }).open !== 'boolean') return
      const request = detail as DesktopAgentDrawerRequest
      // The conversation main panel already owns this slot; a drawer there would mount it twice.
      if (typeof request.panelId !== 'string' || !request.panelId || request.panelId === 'conversation') return
      if (request.open) {
        if (panelIdRef.current !== request.panelId) return
        const current = agentDrawerRef.current
        const continuing = current.open && current.sourceEvent === DESKTOP_AGENT_DRAWER_EVENT
          && current.panelId === request.panelId && typeof request.requestId === 'string' && current.requestId === request.requestId
        updateDrawer({
          ...(continuing ? current : {}),
          open: true, sourceEvent: DESKTOP_AGENT_DRAWER_EVENT, panelId: request.panelId,
          mode: continuing && request.mode === undefined ? current.mode ?? 'full' : request.mode === 'simple' ? 'simple' : 'full',
          side: continuing && request.side === undefined ? current.side ?? 'right' : request.side === 'left' ? 'left' : 'right',
          ...(typeof request.entityId === 'string' ? { entityId: request.entityId } : {}),
          ...(typeof request.requestId === 'string' ? { requestId: request.requestId } : {}),
          ...(typeof request.title === 'string' ? { title: request.title } : {}),
          summary: continuing && request.summary === undefined ? current.summary : normalizeAgentDrawerSummary(request.summary),
        })
      } else {
        const current = agentDrawerRef.current
        if (current.sourceEvent !== DESKTOP_AGENT_DRAWER_EVENT || current.panelId !== request.panelId
          || current.requestId !== request.requestId
          || (request.entityId !== undefined && current.entityId !== request.entityId)) return
        updateDrawer({ open: false })
      }
    }
    // Synchronous client capability detection, not an authorization boundary.
    const onCapabilitiesRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ accept?: (capability: { sides: readonly ['left', 'right'] }) => void }>).detail
      if (detail && typeof detail.accept === 'function') detail.accept({ sides: ['left', 'right'] })
    }
    window.addEventListener(PUBLISHER_AGENT_DRAWER_EVENT, onPublisherRequest)
    window.addEventListener(DESKTOP_AGENT_DRAWER_EVENT, onDesktopRequest)
    window.addEventListener(DESKTOP_AGENT_DRAWER_CAPABILITIES_EVENT, onCapabilitiesRequest)
    return () => {
      window.removeEventListener(PUBLISHER_AGENT_DRAWER_EVENT, onPublisherRequest)
      window.removeEventListener(DESKTOP_AGENT_DRAWER_EVENT, onDesktopRequest)
      window.removeEventListener(DESKTOP_AGENT_DRAWER_CAPABILITIES_EVENT, onCapabilitiesRequest)
    }
  }, [])

  useEffect(() => {
    const current = agentDrawerRef.current
    if (current.open && panelId !== current.panelId) closeAgentDrawer()
  }, [panelId, agentDrawer.open, agentDrawer.panelId, closeAgentDrawer])

  useEffect(() => {
    if (!agentDrawerVisible) return
    closeAgentButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]')) return
      event.preventDefault()
      closeAgentDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [agentDrawerVisible, closeAgentDrawer])

  useEffect(() => {
    const element = frameRef.current
    if (element === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = element.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { layout.setNarrow(narrow) }, [layout, narrow])

  const collapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = collapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const rightbarPreference = panels.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Business panels with an Agent own the center width. The Session rightbar
  // keeps its preference without reserving a second conversation track.
  const businessAgentPanel = panelId === PUBLISHER_PANEL || genericDrawerVisible
  const normal = computeDesktopColumns(
    viewport, !panels.rightbarShown && narrow ? 0 : sidebarPreference,
    businessAgentPanel ? 0 : rightbarPreference, collapsedSidebarWidth(mode, platform),
  )
  const normalRef = useRef(normal)
  normalRef.current = normal
  const columns = computeDesktopColumns(
    viewport,
    sidebarPreference,
    !businessAgentPanel && panels.rightbarTrack ? rightbarPreference : 0,
    collapsedSidebarWidth(mode, platform),
  )
  // Enhanced macOS keeps a wider native rail around the centered upstream
  // sidebar. Extended mode and other platforms retain the upstream 56px rail.
  const sidebarOwnerWidth = collapsed ? SIDEBAR_COLLAPSED : columns.sidebar
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const genericDrawerOverlay = genericDrawerVisible && columns.center < 960
  useEffect(() => {
    const element = mainPanelRef.current
    if (!element) return
    // React 18 does not expose inert as a JSX prop. Only the covered business
    // surface is disabled; the visible sidebar keeps its navigation controls.
    if (genericDrawerOverlay) element.setAttribute('inert', '')
    else element.removeAttribute('inert')
    return () => { element.removeAttribute('inert') }
  }, [genericDrawerOverlay])

  useEffect(() => {
    if (agentDrawerVisible) return
    const target = pendingAgentReturnFocusRef.current
    pendingAgentReturnFocusRef.current = null
    // The preceding effect removes inert before the opener receives focus.
    if (target?.isConnected) target.focus()
  }, [agentDrawerVisible])

  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => {
    sidebarBase.current = columnsRef.current.sidebar
    setDragging(true)
  }, [])
  const onRightbarStart = useCallback(() => {
    rightbarBase.current = normalRef.current.rightbar
    setDragging(true)
  }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    layout.setSidebar(sidebarBase.current + dx)
  }, [layout])
  const onRightbarDrag = useCallback((dx: number) => {
    layout.setRightbar(rightbarBase.current - dx, viewport)
  }, [layout, viewport])

  const drawerId = publisherDrawerVisible ? 'pub-agent-drawer' : 'desktop-agent-drawer'
  const drawerTitleId = `${drawerId}-title`
  const agentDrawerElement = agentDrawerVisible && <aside
    id={drawerId}
    className="dshDesktopAgentDrawer"
    aria-labelledby={drawerTitleId}
    data-content-id={agentDrawer.contentId}
    data-panel-id={genericDrawerVisible ? agentDrawer.panelId : undefined}
    data-entity-id={genericDrawerVisible ? agentDrawer.entityId : undefined}
    data-request-id={genericDrawerVisible ? agentDrawer.requestId : undefined}
    data-agent-drawer-side={genericDrawerVisible ? agentDrawerSide : undefined}
    data-conversation-mode={agentDrawer.mode ?? 'full'}
  >
    <div className="dshDesktopAgentDrawerHeader">
      <span id={drawerTitleId}>{publisherDrawerVisible ? 'Agent · 当前' + AGENT_CONTENT_LABELS[agentDrawer.contentType ?? 'article'] : agentDrawer.title ?? 'Agent · 当前内容'}</span>
      <button ref={closeAgentButtonRef} type="button" className="dshDesktopAgentDrawerClose" aria-label="关闭 Agent 对话" onClick={closeAgentDrawer}>×</button>
    </div>
    {genericDrawerVisible && agentDrawer.summary && <div className="dshDesktopAgentDrawerSummary" data-agent-drawer-summary="">
      {agentDrawer.summary.items.length > 0 && <dl>
        {agentDrawer.summary.items.map((item, index) => <div key={index} className="dshDesktopAgentDrawerSummaryItem">
          <dt>{item.label}</dt><dd>{item.value}</dd>
        </div>)}
      </dl>}
      {agentDrawer.summary.note && <p>{agentDrawer.summary.note}</p>}
    </div>}
    <div className="dshDesktopAgentConversation">{renderSlot('main', {}, { entryKey: 'conversation' })}</div>
  </aside>

  return (
    <div
      ref={frameRef}
      className="dshDesktopFrame"
      data-desktop-mode={mode}
      data-desktop-platform={platform}
      data-sidebar-collapsed={collapsed || undefined}
      data-rightbar-collapsed={columns.rightbar === 0 || undefined}
      data-pub-agent-open={publisherDrawerVisible || undefined}
      data-agent-drawer-open={genericDrawerVisible || undefined}
      data-agent-drawer-side={genericDrawerVisible ? agentDrawerSide : undefined}
      data-agent-drawer-mode={genericDrawerVisible ? agentDrawer.mode : undefined}
      data-rightbar-fullscreen={!businessAgentPanel && panels.rightbarFullscreen || undefined}
      data-dragging={dragging || undefined}
      style={{ gridTemplateColumns: `${columns.sidebar}px minmax(0, 1fr) ${columns.rightbar}px` }}
    >
      {mode === 'advanced' && platform === 'darwin' && <div className="dshDesktopMacCaptionRow" aria-hidden="true" />}
      <aside className="dshDesktopSidebarSurface">
        {/*
          Desktop owns the layout, so the upstream Web frame — and the CSS module
          class `<hash>_sidebarCol` plugins anchor on — never reaches the DOM.
          Carry both anchors here so a plugin written against the Web sidebar
          column keeps resolving one; `dshDesktop_sidebarCol` holds no styles.
        */}
        <div
          className="dshDesktopUpstreamSidebar dshDesktop_sidebarCol"
          data-pane="sidebar"
        >
          {renderSlot('sidebar', { collapsed, width: sidebarOwnerWidth })}
        </div>
      </aside>
      <main
        className="dshDesktopConversationSurface"
        data-pub-agent-overlay={publisherDrawerVisible && columns.center < 960 || undefined}
        data-agent-drawer-overlay={genericDrawerOverlay || undefined}
      >
        {agentDrawerSide === 'left' && agentDrawerElement}
        <div ref={mainPanelRef} className="dshDesktopMainPanelSurface"><MainPanel panelId={panelId} renderSlot={renderSlot} /></div>
        {agentDrawerSide === 'right' && agentDrawerElement}
      </main>
      <aside className="dshDesktopRightbarSurface" data-rightbar-col>
        {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
      </aside>
      {/* Electron resolves app regions in DOM order; Desktop overlays must remain later. */}
      {mode === 'advanced' && platform === 'win32' && <div className="dshDesktopWindowsCaptionRow" aria-hidden="true" />}
      <div className="dshDesktopOverlay" data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {!collapsed && (
        <ResizeHandle
          side="sidebar"
          left={columns.sidebar}
          onStart={onSidebarStart}
          onDrag={onSidebarDrag}
          onEnd={onDragEnd}
        />
      )}
      {!businessAgentPanel && panels.rightbarShown && normal.rightbar > 0 && !panels.rightbarFullscreen && (
        <ResizeHandle
          side="rightbar"
          left={viewport - normal.rightbar}
          onStart={onRightbarStart}
          onDrag={onRightbarDrag}
          onEnd={onDragEnd}
        />
      )}
    </div>
  )
}

function MainPanel({ panelId, renderSlot }: { panelId: ReturnType<DesktopLayoutState['getPanelInfo']>['activePanelId'] } & PropsRenderSlots<'main'>) {
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}

function ResizeHandle(props: {
  side: 'sidebar' | 'rightbar'
  left: number
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  return (
    <div
      className="dshDesktopResizeHandle"
      data-side={props.side}
      data-dragging={dragging || undefined}
      style={{ left: props.left }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
