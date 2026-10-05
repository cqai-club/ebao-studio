import { useEffect, useMemo, useRef, useState } from 'react'
import { generationOrigin } from '../history-origin.ts'
import type { CanvasAssetRef, HistoryEntry } from '../protocol.ts'
import type { ImageGenApi } from './api.ts'
import { errorMessage, tt } from './helpers.ts'
import { loadRaster } from './image-ops.ts'
import { normalizeSize } from './normal-generation-stream.ts'
import css from './canvas-generation-history.module.css'

interface Props {
  api: ImageGenApi
  history: HistoryEntry[]
  projects: Array<{ id: string; title: string }>
  currentCanvasId?: string
  onHistoryChange?: (entries: HistoryEntry[]) => void
  onOpenProject: (id: string) => Promise<void>
  onAssets: (assets: CanvasAssetRef[]) => void
}

/** A source-owned history view. The shared asset picker and document undo
 * remain separate; deleting these images never mutates a canvas document. */
export function CanvasGenerationHistory(props: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('all')
  const [ratio, setRatio] = useState('all')
  const [project, setProject] = useState('all')
  const [confirmClear, setConfirmClear] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const requestVersion = useRef(0)
  const canvasIdRef = useRef(props.currentCanvasId)
  canvasIdRef.current = props.currentCanvasId

  useEffect(() => { setEntries(props.history.filter(entry => generationOrigin(entry) === 'canvas')) }, [props.history])

  const refresh = async (): Promise<void> => {
    const version = ++requestVersion.current
    setLoading(true); setError(null)
    try {
      const next = await props.api.historyList('canvas')
      if (version === requestVersion.current) setEntries(next.filter(entry => generationOrigin(entry) === 'canvas'))
    } catch (caught) {
      if (version === requestVersion.current) setError(errorMessage(caught))
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  const close = (): void => { setOpen(false); setConfirmClear(false); triggerRef.current?.focus() }
  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) { setOpen(false); setConfirmClear(false) }
    }
    window.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('pointerdown', outside) }
  }, [open])
  useEffect(() => () => { requestVersion.current += 1 }, [])

  const projectNames = new Map(props.projects.map(item => [item.id, item.title]))
  const models = useMemo(() => [...new Set(entries.map(entry => entry.model))].sort(), [entries])
  const ratios = useMemo(() => [...new Set(entries.map(entry => normalizeSize(entry.size)))].sort(), [entries])
  const projectIds = useMemo(() => [...new Set(entries.map(entry => entry.canvas!.canvasId))], [entries])
  const needle = query.trim().toLocaleLowerCase()
  const filtered = entries.filter(entry => (needle === '' || `${entry.prompt} ${entry.model} ${projectNames.get(entry.canvas!.canvasId) ?? ''}`.toLocaleLowerCase().includes(needle))
    && (model === 'all' || entry.model === model)
    && (ratio === 'all' || normalizeSize(entry.size) === ratio)
    && (project === 'all' || entry.canvas!.canvasId === project))

  const updateHistory = (next: HistoryEntry[]): void => {
    setEntries(next.filter(entry => generationOrigin(entry) === 'canvas'))
    props.onHistoryChange?.(next)
  }
  const remove = async (id: string): Promise<void> => {
    ++requestVersion.current; setBusy(true); setError(null)
    try { updateHistory(await props.api.historyRemove(id, 'canvas')) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false); setLoading(false) }
  }
  const clear = async (): Promise<void> => {
    ++requestVersion.current; setBusy(true); setError(null)
    try { updateHistory(await props.api.historyClear('canvas')); setConfirmClear(false) }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false); setLoading(false) }
  }
  const importEntry = async (entry: HistoryEntry): Promise<void> => {
    const targetCanvasId = props.currentCanvasId
    setBusy(true); setError(null)
    try {
      const assets = await Promise.all(entry.images.map(async (image, index) => {
        const raster = await loadRaster(image.url)
        return await props.api.canvasImport('history', entry.id, index, raster.width, raster.height)
      }))
      if (targetCanvasId !== canvasIdRef.current) throw new Error(tt('canvas.generationHistory.projectChanged'))
      props.onAssets(assets); close()
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }

  return <div ref={rootRef} className={css.root} data-canvas-no-zoom="" onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setConfirmClear(false) }
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); close() }
  }}>
    <button ref={triggerRef} type="button" className={css.trigger} aria-expanded={open} aria-controls="canvas-generation-history" onClick={() => {
      if (open) close()
      else { setOpen(true); void refresh() }
    }}>{tt('canvas.generationHistory.title')}</button>
    {open ? <section id="canvas-generation-history" className={css.panel} role="dialog" aria-label={tt('canvas.generationHistory.title')}>
      <header className={css.header}><strong>{tt('canvas.generationHistory.title')}</strong><button type="button" onClick={close}>{tt('canvas.close')}</button></header>
      <input ref={searchRef} className={css.search} value={query} onChange={event => setQuery(event.target.value)} placeholder={tt('history.search')} aria-label={tt('history.search')} />
      <div className={css.filters}>
        <select value={model} onChange={event => setModel(event.target.value)} aria-label={tt('history.model')}><option value="all">{tt('history.allModels')}</option>{models.map(value => <option key={value}>{value}</option>)}</select>
        <select value={ratio} onChange={event => setRatio(event.target.value)} aria-label={tt('history.ratio')}><option value="all">{tt('history.allRatios')}</option>{ratios.map(value => <option key={value}>{value}</option>)}</select>
        <select value={project} onChange={event => setProject(event.target.value)} aria-label={tt('canvas.project')}><option value="all">{tt('canvas.generationHistory.allProjects')}</option>{projectIds.map(id => <option key={id} value={id}>{projectNames.get(id) ?? id}</option>)}</select>
      </div>
      {error !== null ? <div className={css.error} role="alert">{error}<button type="button" disabled={loading || busy} onClick={() => { void refresh() }}>{tt('canvas.generationHistory.retry')}</button></div> : null}
      <div className={css.list} aria-busy={loading || busy}>
        {loading ? <p role="status">{tt('canvas.loading')}</p> : filtered.length === 0 ? <p>{entries.length === 0 ? tt('canvas.generationHistory.empty') : tt('canvas.generationHistory.noMatch')}</p> : filtered.map(entry => <article key={entry.id} className={css.row}>
          {entry.images[0] !== undefined ? <img src={entry.images[0].url} alt={entry.prompt} loading="lazy" /> : null}
          <div className={css.details}><strong>{entry.prompt}</strong><small>{projectNames.get(entry.canvas!.canvasId) ?? entry.canvas!.canvasId} · {entry.model} · {normalizeSize(entry.size)}</small><small>{new Date(entry.createdAt).toLocaleString()} · {entry.images.length} {tt('history.images')}</small>
            <div className={css.actions}>
              <button type="button" disabled={busy || !props.projects.some(item => item.id === entry.canvas!.canvasId)} onClick={() => {
                setBusy(true); void props.onOpenProject(entry.canvas!.canvasId).then(close, caught => setError(errorMessage(caught))).finally(() => setBusy(false))
              }}>{tt('canvas.generationHistory.openProject')}</button>
              <button type="button" disabled={busy || !props.currentCanvasId || entry.images.length === 0} onClick={() => { void importEntry(entry) }}>{tt('canvas.addToCanvas')}</button>
              <button type="button" disabled={busy} onClick={() => { void remove(entry.id) }}>{tt('history.delete')}</button>
            </div>
          </div>
        </article>)}
      </div>
      <footer className={css.footer}>{confirmClear ? <>
        <p>{tt('canvas.generationHistory.clearConfirm', { count: entries.length })}</p>
        <button type="button" disabled={busy} onClick={() => { void clear() }}>{tt('canvas.generationHistory.confirm')}</button><button type="button" disabled={busy} onClick={() => setConfirmClear(false)}>{tt('tasks.cancel')}</button>
      </> : <button type="button" disabled={busy || loading || entries.length === 0} onClick={() => setConfirmClear(true)}>{tt('canvas.generationHistory.clear')}</button>}</footer>
    </section> : null}
  </div>
}
