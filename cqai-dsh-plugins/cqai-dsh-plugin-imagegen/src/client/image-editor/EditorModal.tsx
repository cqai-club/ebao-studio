/**
 * Adapted from Dogwind221/img2img-studio, MIT License.
 * Copyright (c) 2026 img2img-studio contributors.
 * Source: plugins/dsh-img2img-config/src/client/EditorModal.tsx at ff2b2bb.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, MessageSquarePlus, Pencil, Scaling, ScanLine, X } from 'lucide-react'
import {
  assertBitmapSize, canvasToBlob, composeEdited, context2d, drawBase, fitWithin,
  MAX_EDITOR_DIMENSION, maskHasPaint, paintMarkers, renderMask,
  type CutoutSpec, type MarkerItem, type SizeMode, type SizeSpec, type Stroke,
} from './raster.ts'
import type { EditManifest } from './manifest.ts'
import css from './editor.module.css'

export interface ImageEditorSource {
  readonly previewUrl: string
  readonly name: string
}

export interface EditorApplyResult {
  readonly files: File[]
  readonly legend: string[]
  readonly manifest: EditManifest
}

export interface EditorModalProps {
  readonly source: ImageEditorSource
  onCancel(): void
  onApply(result: EditorApplyResult): void | Promise<void>
  readonly options?: ReactNode
  readonly applyLabel?: string
  onIntentChange?(needsGeneration: boolean): void
}

const RATIOS = [
  { label: '原图', ratio: null }, { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 }, { label: '3:4', ratio: 3 / 4 },
  { label: '16:9', ratio: 16 / 9 }, { label: '9:16', ratio: 9 / 16 },
] as const
const MIN_SIDE = 64
const INITIAL_SIZE: SizeSpec = { width: 1, height: 1, mode: 'cover' }
const INITIAL_CUTOUT: CutoutSpec = { enabled: false, tolerance: 36 }
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** A local editor; only its caller stores files or invokes image generation. */
export function EditorModal({ source, onCancel, onApply, options, applyLabel = '保存编辑', onIntentChange }: EditorModalProps): React.JSX.Element {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const widthRef = useRef<HTMLInputElement>(null)
  const markerRefs = useRef(new Map<number, HTMLTextAreaElement>())
  const dragRef = useRef<{ kind: 'marker'; id: number } | { kind: 'stroke' } | null>(null)
  const markerIdRef = useRef(1)
  const actionRef = useRef({ onCancel, onApply })
  actionRef.current = { onCancel, onApply }
  const busyRef = useRef(false)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState({ width: 1, height: 1 })
  const [size, setSize] = useState<SizeSpec>(INITIAL_SIZE)
  const [draftSize, setDraftSize] = useState({ width: '1', height: '1' })
  const [cutout, setCutout] = useState<CutoutSpec>(INITIAL_CUTOUT)
  const [base, setBase] = useState<HTMLCanvasElement | null>(null)
  const [markers, setMarkers] = useState<MarkerItem[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [tool, setTool] = useState<'marker' | 'erase'>('marker')
  const [brush, setBrush] = useState(0.05)
  const [eraseMode, setEraseMode] = useState<'paint' | 'restore'>('paint')
  const [erasePrompt, setErasePrompt] = useState('移除涂抹区域的内容，用周围背景自然填补')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [focusMarkerId, setFocusMarkerId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const dimensionError = (() => {
    if (image === null) return null
    if (!/^\d+$/u.test(draftSize.width) || !/^\d+$/u.test(draftSize.height)) return '请输入完整的图片宽高'
    const width = Number(draftSize.width)
    const height = Number(draftSize.height)
    if (width < MIN_SIDE || height < MIN_SIDE) return `宽高至少为 ${MIN_SIDE} 像素`
    try { assertBitmapSize(width, height); return null } catch (error) { return errorText(error) }
  })()
  const display = base === null ? null : fitWithin(base.width, base.height, 1100, 800)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    rootRef.current?.querySelector<HTMLButtonElement>('[data-editor-close]')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!busyRef.current) actionRef.current.onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]') ?? [])
        .filter(control => !(control as HTMLButtonElement).disabled && control.closest('fieldset:disabled') === null)
      if (controls.length === 0) { event.preventDefault(); rootRef.current?.focus(); return }
      const index = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError(null); setImage(null); setBase(null)
    setMarkers([]); setStrokes([]); setActiveId(null); setNotice(null); setSaveError(null)
    setCutout(INITIAL_CUTOUT); setSize(INITIAL_SIZE); setDraftSize({ width: '1', height: '1' })
    dragRef.current = null
    markerIdRef.current = 1
    const element = new Image()
    element.onload = () => {
      if (cancelled) return
      if (element.naturalWidth < 1 || element.naturalHeight < 1 || element.naturalWidth > 16384 || element.naturalHeight > 16384 || element.naturalWidth * element.naturalHeight > 40_000_000) {
        setLoadError('原图尺寸超出本地读取上限，请先提供较小的图片'); setLoading(false); return
      }
      const output = fitWithin(element.naturalWidth, element.naturalHeight, MAX_EDITOR_DIMENSION, MAX_EDITOR_DIMENSION)
      setNatural({ width: element.naturalWidth, height: element.naturalHeight })
      setSize({ ...output, mode: 'cover' })
      setDraftSize({ width: String(output.width), height: String(output.height) })
      setImage(element); setLoading(false)
      if (output.width !== element.naturalWidth || output.height !== element.naturalHeight) setNotice('原图较大，编辑尺寸已按比例缩小到 4096 像素以内')
    }
    element.onerror = () => { if (!cancelled) { setLoadError('无法读取图片，请重试或重新打开原图'); setLoading(false) } }
    element.src = source.previewUrl
    return () => { cancelled = true; element.onload = null; element.onerror = null }
  }, [source.previewUrl, source.name, reload])

  useEffect(() => {
    setBase(null); setRenderError(null)
    if (image === null) return
    try { setBase(drawBase(image, size, cutout)) } catch (error) { setRenderError(errorText(error)) }
  }, [image, size, cutout])

  useEffect(() => {
    const target = previewRef.current
    if (base === null || target === null) return
    try {
      const ctx = context2d(target)
      ctx.clearRect(0, 0, target.width, target.height)
      ctx.drawImage(base, 0, 0, target.width, target.height)
      if (strokes.length > 0) ctx.drawImage(renderMask(strokes, target.width, target.height, 'overlay'), 0, 0)
      paintMarkers(ctx, markers, target.width, target.height, activeId ?? undefined)
    } catch (error) { setRenderError(errorText(error)) }
  }, [base, markers, strokes, activeId])

  useEffect(() => { onIntentChange?.(markers.length > 0 || strokes.some(stroke => stroke.mode === 'paint')) }, [markers, strokes, onIntentChange])
  useEffect(() => { if (focusMarkerId !== null) markerRefs.current.get(focusMarkerId)?.focus() }, [focusMarkerId, markers])

  const addMarker = useCallback((point: { x: number; y: number }, focusComment = false): number => {
    const id = markerIdRef.current++
    setMarkers(previous => [...previous, { id, ...point, text: '' }]); setActiveId(id)
    if (focusComment) setFocusMarkerId(id)
    return id
  }, [])

  const selectTool = (next: 'marker' | 'erase'): void => {
    setTool(next)
    previewRef.current?.scrollIntoView?.({ block: 'nearest' })
    previewRef.current?.focus({ preventScroll: true })
  }

  const replaceSize = (next: SizeSpec): void => {
    try { assertBitmapSize(next.width, next.height) } catch (error) { setSaveError(errorText(error)); return }
    const shapeChanged = size.mode !== next.mode || Math.abs(size.width / size.height - next.width / next.height) > 0.0001
    if (shapeChanged && (markers.length > 0 || strokes.length > 0)) {
      setMarkers([]); setStrokes([]); setActiveId(null)
      setNotice('画面比例或裁切方式已改变，请重新标注和涂抹修改位置')
    }
    setSaveError(null); setSize(next); setDraftSize({ width: String(next.width), height: String(next.height) })
  }
  const commitSize = (): void => {
    if (dimensionError !== null) return
    const width = Number(draftSize.width), height = Number(draftSize.height)
    if (width !== size.width || height !== size.height) replaceSize({ ...size, width, height })
  }
  const applyRatio = (ratio: number | null): void => {
    if (ratio === null) { replaceSize({ ...size, ...fitWithin(natural.width, natural.height, MAX_EDITOR_DIMENSION, MAX_EDITOR_DIMENSION) }); return }
    const longSide = Math.min(MAX_EDITOR_DIMENSION, Math.max(natural.width, natural.height, 512))
    replaceSize({ ...size, width: ratio >= 1 ? longSide : Math.round(longSide * ratio), height: ratio >= 1 ? Math.round(longSide / ratio) : longSide })
  }
  const pointAt = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)), y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)) }
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (busy || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = pointAt(event)
    if (tool === 'marker') {
      const rect = event.currentTarget.getBoundingClientRect()
      const hit = markers.find(marker => Math.hypot((marker.x - point.x) * rect.width, (marker.y - point.y) * rect.height) <= 18)
      const id = hit?.id ?? addMarker(point)
      setActiveId(id); dragRef.current = { kind: 'marker', id }
    } else {
      setStrokes(previous => [...previous, { mode: eraseMode, radius: brush, points: [[point.x, point.y]] }])
      dragRef.current = { kind: 'stroke' }
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current
    if (drag === null || busy) return
    const point = pointAt(event)
    if (drag.kind === 'marker') { setMarkers(previous => previous.map(marker => marker.id === drag.id ? { ...marker, ...point } : marker)); return }
    setStrokes(previous => {
      const last = previous.at(-1), tail = last?.points.at(-1)
      if (last === undefined || (tail !== undefined && Math.hypot(tail[0] - point.x, tail[1] - point.y) < 0.002)) return previous
      return [...previous.slice(0, -1), { ...last, points: [...last.points, [point.x, point.y] as [number, number]] }]
    })
  }

  const confirm = async (): Promise<void> => {
    if (base === null || busyRef.current || dimensionError !== null) return
    if (Number(draftSize.width) !== size.width || Number(draftSize.height) !== size.height) { commitSize(); setNotice('尺寸已更新，请确认预览后保存'); return }
    if (base.width !== size.width || base.height !== size.height) { setNotice('正在更新图片预览，请稍后保存'); return }
    busyRef.current = true; setBusy(true); setSaveError(null)
    try {
      const stamp = Date.now().toString(36)
      const ordered = [...markers].sort((a, b) => a.id - b.id)
      const files: File[] = [], legend: string[] = []
      const editedName = `edited-${stamp}.png`
      const markedName = ordered.length > 0 ? `marked-${stamp}.png` : undefined
      const mask = strokes.length > 0 ? renderMask(strokes, base.width, base.height, 'binary') : null
      const maskPixels = mask === null ? null : context2d(mask).getImageData(0, 0, mask.width, mask.height).data
      const hasMask = maskPixels !== null && maskHasPaint(maskPixels)
      const maskName = hasMask ? `mask-${stamp}.png` : undefined
      if (markedName !== undefined) {
        files.push(new File([await canvasToBlob(composeEdited(base, ordered))], markedName, { type: 'image/png' }))
        legend.push(`${markedName}：编号标注位置图，标注不能出现在成图里`)
      }
      files.push(new File([await canvasToBlob(base)], editedName, { type: 'image/png' }))
      legend.push(`${editedName}：${base.width}×${base.height} 的干净底图`)
      if (maskName !== undefined && mask !== null) {
        files.push(new File([await canvasToBlob(mask)], maskName, { type: 'image/png' }))
        legend.push(`${maskName}：白色区域修改，黑色区域保留`)
      }
      const manifest: EditManifest = {
        version: 1, createdAt: new Date().toISOString(),
        source: { name: source.name, width: natural.width, height: natural.height },
        size: { width: base.width, height: base.height, mode: size.mode, changed: base.width !== natural.width || base.height !== natural.height },
        bgRemove: { requested: cutout.enabled, localPreview: cutout.enabled, tolerance: cutout.tolerance },
        erase: { strokes: hasMask ? strokes.length : 0, prompt: erasePrompt.trim() },
        markers: ordered.map(marker => ({ ...marker, text: marker.text.trim() })),
        files: { edited: editedName, ...(markedName === undefined ? {} : { marked: markedName }), ...(maskName === undefined ? {} : { mask: maskName }) },
      }
      await actionRef.current.onApply({ files, legend, manifest })
      actionRef.current.onCancel()
    } catch (error) { setSaveError(errorText(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const shownError = saveError ?? dimensionError ?? renderError ?? loadError
  return createPortal(<div className={css.overlay}>
    <div ref={rootRef} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className={css.header}>
        <div><h2 id={titleId}>编辑图片</h2><span className={css.filename} title={source.name}>{source.name}</span></div>
        <button data-editor-close type="button" className={css.close} aria-label="关闭图片编辑器" disabled={busy} onClick={onCancel}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={css.toolbar} role="toolbar" aria-label="图片编辑工具">
        <button type="button" aria-pressed={tool === 'marker'} disabled={busy || image === null} onClick={() => selectTool('marker')}><Pencil size={17} aria-hidden="true" />标注</button>
        <button type="button" disabled={busy || image === null} onClick={() => { setTool('marker'); const selected = markers.find(marker => marker.id === activeId); if (selected !== undefined) { setFocusMarkerId(null); markerRefs.current.get(selected.id)?.focus() } else addMarker({ x: 0.5, y: 0.5 }, true) }}><MessageSquarePlus size={17} aria-hidden="true" />添加评论</button>
        <button type="button" aria-pressed={cutout.enabled} disabled={busy || image === null} onClick={() => { setSaveError(null); setCutout(previous => ({ ...previous, enabled: !previous.enabled })) }}><ScanLine size={17} aria-hidden="true" />{cutout.enabled ? '恢复背景' : '移除背景'}</button>
        <button type="button" aria-pressed={tool === 'erase'} disabled={busy || image === null} onClick={() => selectTool('erase')}><Eraser size={17} aria-hidden="true" />擦除</button>
        <button type="button" disabled={busy || image === null} onClick={() => { widthRef.current?.focus(); widthRef.current?.scrollIntoView?.({ block: 'nearest' }) }}><Scaling size={17} aria-hidden="true" />调整大小</button>
      </div>
      {shownError !== null && <div className={css.error} role="alert">{shownError}{loadError !== null && <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button>}</div>}
      {notice !== null && <div className={css.notice} role="status">{notice}</div>}
      <div className={css.body}>
        <div className={css.previewArea}>
          {loading ? <p role="status">正在读取图片…</p> : base === null || display === null ? <p>图片预览不可用</p> : <>
            <div className={css.checker}><canvas ref={previewRef} width={display.width} height={display.height} className={css.preview} tabIndex={0} role="img" aria-label="图片编辑预览" aria-describedby={`${titleId}-hint`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }} onKeyDown={event => {
              if (busy || tool !== 'marker') return
              if (event.key === 'Enter') { event.preventDefault(); addMarker({ x: 0.5, y: 0.5 }, true) }
              if ((event.key === 'Delete' || event.key === 'Backspace') && activeId !== null) { event.preventDefault(); setMarkers(previous => previous.filter(marker => marker.id !== activeId)); setActiveId(null) }
              const delta = ({ ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] } as Record<string, number[]>)[event.key]
              if (delta !== undefined && activeId !== null) { event.preventDefault(); setMarkers(previous => previous.map(marker => marker.id === activeId ? { ...marker, x: clamp01(marker.x + delta[0]), y: clamp01(marker.y + delta[1]) } : marker)) }
            }} /></div>
            <p id={`${titleId}-hint`} className={css.hint}>{tool === 'marker' ? '点击图片标注位置，再填写修改意见。也可用 Enter 添加标注、方向键移动。' : '涂抹要移除或重绘的区域，保存时会交给图片模型处理。'}</p>
          </>}
        </div>
        <aside className={css.panels} aria-label="图片编辑参数">
          <fieldset className={css.section} disabled={busy}><legend>修改意见 · {markers.length}</legend>
            {markers.length === 0 && <p className={css.hint}>在图片上标注，或点击“添加评论”。</p>}
            {markers.map(marker => <div key={marker.id} className={css.comment}>
              <div className={css.commentHeader}><label htmlFor={`${titleId}-marker-${marker.id}`}>标注 {marker.id}</label><button type="button" aria-label={`删除标注 ${marker.id}`} onClick={() => { setMarkers(previous => previous.filter(item => item.id !== marker.id)); if (activeId === marker.id) setActiveId(null) }}><X size={16} aria-hidden="true" /></button></div>
              <textarea id={`${titleId}-marker-${marker.id}`} ref={element => { if (element !== null) markerRefs.current.set(marker.id, element); else markerRefs.current.delete(marker.id) }} value={marker.text} placeholder="例如：把这里的花换成玫瑰" rows={2} onFocus={() => setActiveId(marker.id)} onChange={event => { const text = event.target.value; setMarkers(previous => previous.map(item => item.id === marker.id ? { ...item, text } : item)) }} />
            </div>)}
          </fieldset>
          <fieldset className={css.section} disabled={busy}><legend>涂抹区域</legend>
            <label className={css.range}>画笔大小<input type="range" min={0.01} max={0.16} step={0.005} value={brush} onChange={event => setBrush(Number(event.target.value))} /></label>
            <div className={css.actions}><button type="button" aria-pressed={eraseMode === 'paint'} onClick={() => { selectTool('erase'); setEraseMode('paint') }}>涂抹</button><button type="button" aria-pressed={eraseMode === 'restore'} onClick={() => { selectTool('erase'); setEraseMode('restore') }}>擦回</button><button type="button" disabled={strokes.length === 0} onClick={() => setStrokes(previous => previous.slice(0, -1))}>撤销一笔</button><button type="button" disabled={strokes.length === 0} onClick={() => setStrokes([])}>全部清除</button></div>
            <label>区域处理要求<textarea value={erasePrompt} rows={2} onChange={event => setErasePrompt(event.target.value)} /></label>
            {markers.length > 0 && strokes.some(stroke => stroke.mode === 'paint') && <p className={css.hint}>同时使用标注和涂抹时，仅涂抹区域内的内容会被修改。</p>}
          </fieldset>
          {cutout.enabled && <fieldset className={css.section} disabled={busy}><legend>移除背景</legend><label className={css.range}>背景容差<input type="range" min={8} max={90} step={2} value={cutout.tolerance} onChange={event => setCutout(previous => ({ ...previous, tolerance: Number(event.target.value) }))} /><output>{cutout.tolerance}</output></label><p className={css.hint}>适合纯色或近色背景，复杂背景需要在评论中描述修改要求。</p></fieldset>}
          <fieldset className={css.section} disabled={busy || image === null}><legend>调整大小</legend>
            <div className={css.actions}>{RATIOS.map(preset => <button key={preset.label} type="button" onClick={() => applyRatio(preset.ratio)}>{preset.label}</button>)}</div>
            <div className={css.dimensions}><label>宽度<input ref={widthRef} inputMode="numeric" value={draftSize.width} aria-invalid={dimensionError !== null} onChange={event => setDraftSize(previous => ({ ...previous, width: event.target.value }))} onBlur={commitSize} onKeyDown={event => { if (event.key === 'Enter') commitSize() }} /></label><span>×</span><label>高度<input inputMode="numeric" value={draftSize.height} aria-invalid={dimensionError !== null} onChange={event => setDraftSize(previous => ({ ...previous, height: event.target.value }))} onBlur={commitSize} onKeyDown={event => { if (event.key === 'Enter') commitSize() }} /></label></div>
            <label>填充方式<select value={size.mode} onChange={event => replaceSize({ ...size, mode: event.target.value as SizeMode })}><option value="cover">裁切填满</option><option value="contain">完整放入</option><option value="stretch">拉伸</option></select></label>
          </fieldset>
        </aside>
      </div>
      <footer className={css.footer}>
        <div className={css.options}>{options}</div>
        <div className={css.actions}><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className={css.primary} disabled={busy || loading || base === null || dimensionError !== null || renderError !== null} onClick={() => { void confirm() }}>{busy ? '正在处理…' : applyLabel}</button></div>
      </footer>
    </div>
  </div>, document.body)
}
