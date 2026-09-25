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

interface PublisherAgentDrawerRequest {
  open: boolean
  contentId?: string
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
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const panelId = usePanelInfo(info => info.activePanelId)
  const panelIdRef = useRef(panelId)
  panelIdRef.current = panelId
  const [agentDrawer, setAgentDrawer] = useState<PublisherAgentDrawerRequest>({ open: false })
  const agentDrawerOpenRef = useRef(false)
  const closeAgentButtonRef = useRef<HTMLButtonElement>(null)
  const agentReturnFocusRef = useRef<HTMLElement | null>(null)
  const agentDrawerVisible = panelId === PUBLISHER_PANEL && agentDrawer.open

  const closeAgentDrawer = useCallback(() => {
    window.dispatchEvent(new CustomEvent<PublisherAgentDrawerRequest>(PUBLISHER_AGENT_DRAWER_EVENT, {
      detail: { open: false },
    }))
    if (agentReturnFocusRef.current?.isConnected) agentReturnFocusRef.current.focus()
    agentReturnFocusRef.current = null
  }, [])

  useEffect(() => {
    const onDrawerRequest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || typeof (detail as { open?: unknown }).open !== 'boolean') return
      const request = detail as PublisherAgentDrawerRequest
      if (request.open) {
        if (panelIdRef.current !== PUBLISHER_PANEL) return
        if (!agentDrawerOpenRef.current) {
          agentReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }
        agentDrawerOpenRef.current = true
        setAgentDrawer({ open: true, ...(typeof request.contentId === 'string' ? { contentId: request.contentId } : {}) })
      } else {
        agentDrawerOpenRef.current = false
        setAgentDrawer({ open: false })
      }
    }
    window.addEventListener(PUBLISHER_AGENT_DRAWER_EVENT, onDrawerRequest)
    return () => { window.removeEventListener(PUBLISHER_AGENT_DRAWER_EVENT, onDrawerRequest) }
  }, [])

  useEffect(() => {
    if (panelId !== PUBLISHER_PANEL && agentDrawer.open) closeAgentDrawer()
  }, [panelId, agentDrawer.open, closeAgentDrawer])

  useEffect(() => {
    if (!agentDrawerVisible) return
    closeAgentButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
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
  // Global Publisher content owns the full center width. The ordinary
  // Session rightbar keeps its preference but does not reserve an empty track.
  const publisherPanel = panelId === PUBLISHER_PANEL
  const normal = computeDesktopColumns(
    viewport, !panels.rightbarShown && narrow ? 0 : sidebarPreference,
    publisherPanel ? 0 : rightbarPreference, collapsedSidebarWidth(mode, platform),
  )
  const normalRef = useRef(normal)
  normalRef.current = normal
  const columns = computeDesktopColumns(
    viewport,
    sidebarPreference,
    !publisherPanel && panels.rightbarTrack ? rightbarPreference : 0,
    collapsedSidebarWidth(mode, platform),
  )
  // Enhanced macOS keeps a wider native rail around the centered upstream
  // sidebar. Extended mode and other platforms retain the upstream 56px rail.
  const sidebarOwnerWidth = collapsed ? SIDEBAR_COLLAPSED : columns.sidebar
  const columnsRef = useRef(columns)
  columnsRef.current = columns

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

  return (
    <div
      ref={frameRef}
      className="dshDesktopFrame"
      data-desktop-mode={mode}
      data-desktop-platform={platform}
      data-sidebar-collapsed={collapsed || undefined}
      data-rightbar-collapsed={columns.rightbar === 0 || undefined}
      data-pub-agent-open={agentDrawerVisible || undefined}
      data-rightbar-fullscreen={!publisherPanel && panels.rightbarFullscreen || undefined}
      data-dragging={dragging || undefined}
      style={{ gridTemplateColumns: `${columns.sidebar}px minmax(0, 1fr) ${columns.rightbar}px` }}
    >
      {mode === 'advanced' && platform === 'darwin' && <div className="dshDesktopMacCaptionRow" aria-hidden="true" />}
      <aside className="dshDesktopSidebarSurface">
        <div className="dshDesktopUpstreamSidebar">
          {renderSlot('sidebar', { collapsed, width: sidebarOwnerWidth })}
        </div>
      </aside>
      <main className="dshDesktopConversationSurface" data-pub-agent-overlay={agentDrawerVisible && columns.center < 960 || undefined}>
        <div className="dshDesktopMainPanelSurface"><MainPanel panelId={panelId} renderSlot={renderSlot} /></div>
        {agentDrawerVisible && <aside id="pub-agent-drawer" className="dshDesktopAgentDrawer" aria-labelledby="pub-agent-drawer-title" data-content-id={agentDrawer.contentId}>
          <div className="dshDesktopAgentDrawerHeader">
            <span id="pub-agent-drawer-title">Agent · 当前文章</span>
            <button ref={closeAgentButtonRef} type="button" className="dshDesktopAgentDrawerClose" aria-label="关闭 Agent 对话" onClick={closeAgentDrawer}>×</button>
          </div>
          <div className="dshDesktopAgentConversation">{renderSlot('main', {}, { entryKey: 'conversation' })}</div>
        </aside>}
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
      {!publisherPanel && panels.rightbarShown && normal.rightbar > 0 && !panels.rightbarFullscreen && (
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
