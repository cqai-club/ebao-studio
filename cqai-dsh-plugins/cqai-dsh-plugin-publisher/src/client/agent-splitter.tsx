import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

const WIDTH_STORAGE_KEY = 'cqai.publisher.agent-panel-width'
const MIN_AGENT_WIDTH = 280
const MIN_CONTENT_WIDTH = 360
const SPLITTER_WIDTH = 8
const OVERLAY_BREAKPOINT = 620

type Drag = { pointerId: number; startX: number; startWidth: number; width: number; moved: boolean; target: HTMLElement; surface: HTMLElement | null }
type SplitterProps = Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown' | 'onDoubleClick' | 'tabIndex' | 'aria-hidden' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuenow' | 'aria-valuetext'>

function savedWidth(): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
    return Number.isFinite(value) && value >= MIN_AGENT_WIDTH ? value : undefined
  } catch { return undefined }
}

function storeWidth(width: number | undefined) {
  try {
    if (width === undefined) window.localStorage.removeItem(WIDTH_STORAGE_KEY)
    else window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  } catch { /* Storage may be disabled; resizing remains usable for this page. */ }
}

function maximumWidth(available: number) {
  // At the existing narrow overlay boundary, keep the Agent usable and let
  // the content take the remaining space until both minima fit again.
  return Math.max(MIN_AGENT_WIDTH, Math.floor(available - SPLITTER_WIDTH - MIN_CONTENT_WIDTH))
}

function fitWidth(width: number, available: number) {
  return Math.round(Math.max(MIN_AGENT_WIDTH, Math.min(width, maximumWidth(available))))
}

function defaultWidth(available: number) {
  return fitWidth(available <= 760 ? MIN_AGENT_WIDTH : Math.max(320, Math.min(available * 0.34, 440)), available)
}

/** Resize only the Publisher split; hiding or shrinking it never rewrites the user's preference. */
export function usePublisherAgentResize(surfaceRef: RefObject<HTMLElement | null>, enabled: boolean): { width: number | undefined; splitterProps: SplitterProps } {
  const [width, setWidth] = useState<number>()
  const [available, setAvailable] = useState(0)
  const [initialPreference] = useState(savedWidth)
  const preferred = useRef<number | undefined>(initialPreference)
  const availableRef = useRef(0)
  const drag = useRef<Drag>()
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const finishDrag = useCallback((commit: boolean, update = true) => {
    const active = drag.current
    if (!active) return
    drag.current = undefined
    active.surface?.removeAttribute('data-agent-resizing')
    if (commit && active.moved) {
      preferred.current = active.width
      storeWidth(active.width)
    }
    if (update) setWidth(fitWidth(preferred.current ?? defaultWidth(availableRef.current), availableRef.current))
    try { active.target.releasePointerCapture(active.pointerId) } catch { /* The pointer may already be released. */ }
  }, [surfaceRef])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const measure = () => {
      const next = surface.getBoundingClientRect().width || surface.clientWidth
      availableRef.current = next
      setAvailable(next)
      if (!enabledRef.current || next <= OVERLAY_BREAKPOINT) finishDrag(false)
      if (next > 0) {
        const active = drag.current
        const fitted = fitWidth(active?.width ?? preferred.current ?? defaultWidth(next), next)
        setWidth(fitted)
      }
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(surface)
    if (!observer) window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      finishDrag(false, false)
    }
  }, [surfaceRef, enabled, finishDrag])

  const canResize = enabled && available > OVERLAY_BREAKPOINT
  const shownWidth = width ?? defaultWidth(available)
  const reset = useCallback(() => {
    if (!enabledRef.current || availableRef.current <= OVERLAY_BREAKPOINT) return
    finishDrag(false)
    preferred.current = undefined
    storeWidth(undefined)
    setWidth(defaultWidth(availableRef.current))
  }, [finishDrag])

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabledRef.current || availableRef.current <= OVERLAY_BREAKPOINT || event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    finishDrag(false)
    const current = fitWidth(preferred.current ?? defaultWidth(availableRef.current), availableRef.current)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: current, width: current, moved: false, target: event.currentTarget, surface: surfaceRef.current }
    event.currentTarget.focus({ preventScroll: true })
    surfaceRef.current?.setAttribute('data-agent-resizing', '')
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window listeners below also finish an uncaptured pointer. */ }
  }, [finishDrag, surfaceRef])

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    active.moved ||= event.clientX !== active.startX
    active.width = fitWidth(active.startWidth + event.clientX - active.startX, availableRef.current)
    setWidth(active.width)
  }, [])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) finishDrag(true)
  }, [finishDrag])
  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) finishDrag(false)
  }, [finishDrag])

  useEffect(() => {
    const finish = (event: globalThis.PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) finishDrag(event.type === 'pointerup')
    }
    const cancel = () => finishDrag(false)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', cancel)
    }
  }, [finishDrag])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabledRef.current || availableRef.current <= OVERLAY_BREAKPOINT || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      reset()
      return
    }
    const current = fitWidth(preferred.current ?? defaultWidth(availableRef.current), availableRef.current)
    const step = event.shiftKey ? 64 : 16
    const next = event.key === 'ArrowLeft' ? current - step
      : event.key === 'ArrowRight' ? current + step
        : event.key === 'Home' ? MIN_AGENT_WIDTH
          : event.key === 'End' ? maximumWidth(availableRef.current) : undefined
    if (next === undefined) return
    event.preventDefault()
    const fitted = fitWidth(next, availableRef.current)
    if (fitted === current) return
    finishDrag(false)
    preferred.current = fitted
    storeWidth(preferred.current)
    setWidth(preferred.current)
  }, [finishDrag, reset])

  return { width, splitterProps: {
    tabIndex: canResize ? 0 : -1,
    'aria-hidden': canResize ? undefined : true,
    'aria-valuemin': MIN_AGENT_WIDTH,
    'aria-valuemax': maximumWidth(available),
    'aria-valuenow': shownWidth,
    'aria-valuetext': `Agent 面板宽度 ${shownWidth} 像素，左右方向键调整，按 Enter 恢复默认`,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel,
    onKeyDown, onDoubleClick: reset,
  } }
}

export function PublisherAgentSplitter(props: SplitterProps) {
  return <div className="pub-agent-splitter" role="separator" aria-label="调整 Agent 面板宽度" aria-orientation="vertical" aria-controls="pub-agent-drawer" title="拖动调整宽度 · 双击恢复默认" {...props}/>
}

export const agentSplitterCss = `
.pub-agent-splitter { position: relative; flex: 0 0 8px; min-width: 8px; min-height: 0; cursor: col-resize; touch-action: none; outline: none; background: transparent; }
.pub-agent-splitter::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: var(--dsw-alias-border-l1, #e4e6e9); }
.pub-agent-splitter:focus-visible { box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary, #4176e6); }
.pub-surface[data-agent-resizing], .pub-surface[data-agent-resizing] * { cursor: col-resize !important; user-select: none !important; -webkit-user-select: none !important; }
.pub-surface[data-agent-resizing] iframe { pointer-events: none; }
@container publisher-surface (max-width: 620px) { .pub-agent-splitter { display: none; } }
`
