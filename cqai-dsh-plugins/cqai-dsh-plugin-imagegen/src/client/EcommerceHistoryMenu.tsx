import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Image, MoreHorizontal, RefreshCw, X } from 'lucide-react'
import type { EcommerceRunStatus, EcommerceRunSummary } from '../ecommerce-run-protocol.ts'
import { activeImageGenLanguage, errorMessage } from './helpers.ts'
import { useImageGenLanguageTick } from './use-language.ts'
import { normalizeSize } from './normal-generation-stream.ts'
import { ecommerceHistoryCopy as t } from './ecommerce-history-copy.ts'
import css from './ecommerce-history.module.css'

export interface EcommerceHistoryMenuProps {
  runs: EcommerceRunSummary[]
  selectedId: string | null
  loading: boolean
  error: string | null
  openingId?: string | null
  onOpen(id: string): Promise<void>
  onRefresh(): void
  /** The owner confirms destructive actions and refreshes the saved list. */
  onRemove(id: string): Promise<void>
  onClear(): Promise<void>
  onCancel(id: string): Promise<void>
}

const STATUSES: EcommerceRunStatus[] = ['queued', 'running', 'completed', 'partial-failed', 'failed', 'cancelled', 'interrupted']
const isActive = (status: EcommerceRunStatus): boolean => status === 'queued' || status === 'running'

function taskDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return ''
  const language = activeImageGenLanguage()
  return new Date(timestamp).toLocaleString(language === 'zh' ? 'zh-CN' : language === 'ru' ? 'ru-RU' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** A compact product-set history picker; choosing a row only opens saved data. */
export function EcommerceHistoryMenu({ runs, selectedId, loading, error, openingId, onOpen, onRefresh, onRemove, onClear, onCancel }: EcommerceHistoryMenuProps): React.JSX.Element {
  useImageGenLanguageTick()
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const openSequence = useRef(0)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [model, setModel] = useState('')
  const [size, setSize] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [localOpeningId, setLocalOpeningId] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  const activeCount = runs.filter(run => isActive(run.status)).length
  const terminalCount = runs.length - activeCount
  const models = useMemo(() => [...new Set(runs.map(run => run.model).filter(Boolean))].sort(), [runs])
  const sizes = useMemo(() => [...new Set(runs.map(run => normalizeSize(run.size)))].sort(), [runs])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return runs.filter(run => (!needle || `${run.name} ${run.searchText ?? ''}`.toLocaleLowerCase().includes(needle))
      && (!status || run.status === status) && (!model || run.model === model) && (!size || normalizeSize(run.size) === size))
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }, [runs, query, status, model, size])

  const close = useCallback((): void => {
    ++openSequence.current
    setOpen(false)
    setActionId(null)
    setLocalOpeningId(null)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const updatePosition = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const inset = 12
      const width = Math.min(440, Math.max(0, window.innerWidth - inset * 2))
      const top = rect.bottom + 8
      const below = window.innerHeight - top - inset
      const above = rect.top - 8 - inset
      // Prefer the button's lower edge; near the viewport bottom, keep the
      // picker and its keyboard controls visible by anchoring above instead.
      const placeAbove = below < 280 && above > below
      setPosition({
        width,
        left: Math.min(Math.max(inset, rect.right - width), Math.max(inset, window.innerWidth - width - inset)),
        ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top }),
        maxHeight: Math.max(0, Math.min(640, placeAbove ? above : below)),
      })
    }
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close()
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    updatePosition()
    searchRef.current?.focus()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    // Close after the pointer's default focus change so returning focus to
    // the trigger also works in a browser, rather than only a synthetic DOM.
    document.addEventListener('click', outside)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('click', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, close])

  const resetFilters = (): void => { setQuery(''); setStatus(''); setModel(''); setSize('') }

  const openRun = async (runId: string): Promise<void> => {
    const sequence = ++openSequence.current
    setOperationError(null)
    setLocalOpeningId(runId)
    try {
      await onOpen(runId)
      if (sequence === openSequence.current) close()
    } catch (failure) {
      if (sequence === openSequence.current) setOperationError(errorMessage(failure))
    } finally {
      if (sequence === openSequence.current) setLocalOpeningId(null)
    }
  }

  const runAction = async (runId: string, action: () => Promise<void>): Promise<void> => {
    if (busyId) return
    setBusyId(runId)
    setOperationError(null)
    try {
      await action()
      setActionId(null)
    } catch (failure) {
      setOperationError(errorMessage(failure))
    } finally {
      setBusyId(null)
    }
  }

  const keyboardNavigation = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const controls = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(':is(button, input, select):not(:disabled)') ?? [])
    const edge = event.shiftKey ? controls[0] : controls[controls.length - 1]
    if (event.target === edge) {
      event.preventDefault()
      close()
    }
  }

  const menu = open ? <div
    ref={menuRef}
    id={`${id}-menu`}
    role="dialog"
    aria-labelledby={`${id}-title`}
    className={css.menu}
    style={position}
    data-ecommerce-history-menu
    onKeyDown={keyboardNavigation}
  >
    <div className={css.header}>
      <h2 id={`${id}-title`}>{t('title')}</h2>
      <div className={css.headerActions}>
        <button type="button" className={css.iconButton} onClick={onRefresh} disabled={loading} aria-label={t('refresh')}><RefreshCw size={15} aria-hidden="true" /></button>
        <button type="button" className={css.iconButton} onClick={close} aria-label={t('close')}><X size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <div className={css.filters}>
      <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
      <div className={css.filterSelects}>
        <select value={status} onChange={event => setStatus(event.target.value)} aria-label={t('statusFilter')}>
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
        </select>
        <select value={model} onChange={event => setModel(event.target.value)} aria-label={t('modelFilter')}>
          <option value="">{t('allModels')}</option>
          {models.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={size} onChange={event => setSize(event.target.value)} aria-label={t('sizeFilter')}>
          <option value="">{t('allSizes')}</option>
          {sizes.map(value => <option key={value} value={value}>{value === 'auto' ? t('autoSize') : value}</option>)}
        </select>
      </div>
    </div>
    <div className={css.list} aria-busy={loading}>
      {(error || operationError) && <div role="alert" className={css.error}>
        <span>{operationError ? t('operationError', { message: operationError }) : error}</span>
        {error && <button type="button" className={css.textButton} onClick={onRefresh} disabled={loading}>{t('retry')}</button>}
      </div>}
      {loading && runs.length === 0 ? <p className={css.message} role="status">{t('loading')}</p>
        : runs.length === 0 ? !error && <p className={css.message}>{t('empty')}</p>
        : filtered.length === 0 ? <div className={css.message}><p>{t('noMatches')}</p><button type="button" className={css.textButton} onClick={resetFilters}>{t('resetFilters')}</button></div>
        : <ul className={css.rows}>{filtered.map(run => {
          const name = run.name || t('untitled')
          const opening = (openingId ?? localOpeningId) === run.id
          const active = isActive(run.status)
          return <li key={run.id} data-ecommerce-history-row data-run-id={run.id} data-status={run.status} data-selected={selectedId === run.id || undefined} className={css.row}>
            <button type="button" className={css.openRow} onClick={() => void openRun(run.id)} aria-label={t('open', { name })} aria-current={selectedId === run.id ? 'true' : undefined} disabled={opening || busyId !== null}>
              <span className={css.thumbnail} aria-hidden="true"><Image size={22} />{run.thumbnail && <img src={run.thumbnail.url} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.display = 'none' }} onLoad={event => { event.currentTarget.style.display = '' }} />}</span>
              <span className={css.rowContent}>
                <span className={css.name}>{name}{run.legacy && <span className={css.legacy}>{t('legacy')}</span>}</span>
                <span className={css.date}>{taskDate(run.createdAt)}</span>
                <span className={css.progress}><span data-run-status={run.status}>{opening ? t('opening') : t(`status.${run.status}`)}</span><span>{run.legacy ? t('legacyProgress', { count: run.done }) : t('progress', { done: run.done, total: run.total })}</span></span>
              </span>
            </button>
            <div className={css.rowActions}>
              <button type="button" className={css.iconButton} aria-label={t('actions', { name })} aria-expanded={actionId === run.id} aria-controls={`${id}-actions-${run.id}`} disabled={busyId !== null || opening} onClick={() => setActionId(actionId === run.id ? null : run.id)}><MoreHorizontal size={18} aria-hidden="true" /></button>
              {actionId === run.id && <div id={`${id}-actions-${run.id}`} className={css.actionPanel}>
                <button type="button" className={css.dangerButton} disabled={busyId !== null} onClick={() => void runAction(run.id, () => active ? onCancel(run.id) : onRemove(run.id))}>{active ? t('cancel') : t('remove')}</button>
              </div>}
            </div>
          </li>
        })}</ul>}
    </div>
    <div className={css.footer}>
      <button type="button" className={css.clearButton} disabled={terminalCount === 0 || busyId !== null || loading} onClick={() => void runAction('clear', onClear)}>{t('clear')}</button>
      <span>{t('clearHint')}</span>
    </div>
  </div> : null

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? `${id}-menu` : undefined}
      data-ecommerce-history-trigger
      onClick={() => {
        if (open) close()
        else { setOperationError(null); setOpen(true); onRefresh() }
      }}
    >
      {t('trigger')}
      {activeCount > 0 && <span className={css.badge} aria-label={t('activeCount', { count: activeCount })}>{activeCount}</span>}
      {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
    {menu && createPortal(menu, document.body)}
  </>
}
