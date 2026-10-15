import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { API, type PublisherContentCard, type PublisherContentQueryResult, type PublisherContentType, type PublisherVideoSource } from '../protocol.ts'
import { contentAssetUrl } from './content-preview.tsx'
import { api, CONTENT_LABELS, errorMessage } from './shared.tsx'

export interface DraftGalleryProps {
  contentType: PublisherContentType
  active: boolean
  busy?: boolean
  trash?: boolean
  /** Change after a draft is created, copied, deleted, or saved to refresh the list. */
  refreshKey?: number
  onOpen(id: string): void
  onPreview?(id: string): void
  onPublish?(id: string): void
  onCreate(): void
  onCopy(id: string): void
  onDelete(id: string): void
  onRestore?(id: string): void
}

type GalleryState = {
  items: PublisherContentCard[]
  nextCursor: string | null
  initialized: boolean
  loading: boolean
  error: string
}

const emptyGallery: GalleryState = {
  items: [], nextCursor: null, initialized: false, loading: false, error: '',
}

/** A page can overlap a refreshed page when another edit changes its sort order. */
export function appendUniqueCards(previous: PublisherContentCard[], incoming: PublisherContentCard[]): PublisherContentCard[] {
  const seen = new Set(previous.map(item => item.id))
  return [...previous, ...incoming.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })]
}

export function galleryColumnCount(width: number): number {
  return width < 380 ? 1 : width < 700 ? 2 : width < 980 ? 3 : 4
}

/** Existing cards retain their column when a later page is appended. */
export function distributeGalleryCards(items: PublisherContentCard[], count: number): PublisherContentCard[][] {
  const columns = Array.from({ length: count }, () => [] as PublisherContentCard[])
  items.forEach((item, index) => columns[index % count]!.push(item))
  return columns
}

export function galleryCoverUrl(item: PublisherContentCard): string | undefined {
  return item.coverAssetId ? contentAssetUrl(item.id, item.coverAssetId) : undefined
}

export function videoGalleryPreviewUrl(source?: PublisherVideoSource): string | undefined {
  if (!source) return undefined
  const id = source.kind === 'work' ? source.workId : source.localVideoId
  return `${API}/video-preview/${source.kind}/${encodeURIComponent(id)}#t=0.1`
}

function updatedLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '修改时间未知' : `${date.toLocaleString()} 修改`
}

const PUBLICATION_LABELS: Record<NonNullable<PublisherContentCard['publication']>['state'], string> = {
  unpublished: '未发布', queued: '等待发布', publishing: '发布中', published: '已发布',
  'platform-draft': '已存平台草稿', failed: '发布失败', unknown: '状态未知',
}

/** Attach the existing range-capable preview only when the card approaches the scroll view. */
function VideoFirstFrame({ source }: { source?: PublisherVideoSource }) {
  const holderRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = videoGalleryPreviewUrl(source)

  useEffect(() => {
    setNear(false)
    setReady(false)
    setFailed(false)
    if (!url || !holderRef.current) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true)
        observer.disconnect()
      }
    }, { root: holderRef.current.closest('.pub'), rootMargin: '240px' })
    observer.observe(holderRef.current)
    return () => observer.disconnect()
  }, [url])

  return <div ref={holderRef} className="pub-gallery-video-frame">
    {url && near && !failed && <video className={ready ? 'pub-gallery-video-ready' : ''} src={url} preload="metadata" muted playsInline
      aria-hidden="true" tabIndex={-1}
      onLoadedMetadata={event => {
        const video = event.currentTarget
        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2)
      }}
      onLoadedData={() => setReady(true)} onSeeked={() => setReady(true)} onError={() => setFailed(true)}/>}
    {(!ready || failed) && <span className="pub-gallery-media-placeholder" aria-hidden="true">视频</span>}
    <span className="pub-gallery-play" aria-hidden="true">▶</span>
  </div>
}

export function DraftGalleryCard({ item, menuOpen, busy = false, trash = false, onRestore, onPreview, onPublish, onMenu, onOpen, onCopy, onDelete }: {
  item: PublisherContentCard
  menuOpen: boolean
  busy?: boolean
  trash?: boolean
  onRestore?(): void
  onPreview?(): void
  onPublish?(): void
  onMenu(): void
  onOpen(): void
  onCopy(): void
  onDelete(): void
}) {
  const title = item.title.trim() || '未命名草稿'
  const article = item.contentType === 'article'
  const cover = galleryCoverUrl(item)
  const [coverFailed, setCoverFailed] = useState(false)
  useEffect(() => setCoverFailed(false), [cover])
  return <article className={`pub-gallery-card ${article ? 'pub-gallery-card-article' : 'pub-gallery-card-social'}`}>
    <button type="button" className="pub-gallery-open" disabled={busy || trash} onClick={onOpen} aria-label={`${trash ? '已删除' : '编辑'}${CONTENT_LABELS[item.contentType]}：${title}`}>
      <div className="pub-gallery-media">
        {trash ? <span className="pub-gallery-media-placeholder" aria-hidden="true">{CONTENT_LABELS[item.contentType]}</span> : item.contentType === 'video'
          ? <VideoFirstFrame source={item.videoSource}/>
          : cover && !coverFailed
            ? <img src={cover} alt="" loading="lazy" onError={() => setCoverFailed(true)}/>
            : <span className="pub-gallery-media-placeholder" aria-hidden="true">{article ? '文章' : '图文'}</span>}
        {article && <span className="pub-gallery-article-overlay">{title}</span>}
      </div>
      <div className="pub-gallery-copy">
        {!article && <strong className="pub-gallery-title">{title}</strong>}
        {item.excerpt && <p>{item.excerpt}</p>}
        {!trash && <span className="pub-gallery-publication" aria-label={`发布状态：${PUBLICATION_LABELS[item.publication?.state ?? 'unknown']}`}>{PUBLICATION_LABELS[item.publication?.state ?? 'unknown']}</span>}
        {trash && item.lifecyclePending && <span className="pub-gallery-pending" role="status">{item.lifecyclePending === 'trash' ? '回收尚未完成，请重试删除。' : '恢复尚未完成，请重试恢复。'}</span>}
        <small>{updatedLabel(item.updatedAt)}</small>
      </div>
    </button>
    {trash ? <button type="button" className="pub-gallery-restore" disabled={busy}
      onClick={item.lifecyclePending === 'trash' ? onDelete : onRestore}
      aria-label={`${item.lifecyclePending === 'trash' ? '重试删除' : item.lifecyclePending === 'restore' ? '重试恢复' : '恢复'}${title}`}>
      {item.lifecyclePending === 'trash' ? '重试删除' : item.lifecyclePending === 'restore' ? '重试恢复' : '恢复稿件'}</button> : <>
    <div className="pub-gallery-quick-actions">{onPreview && <button type="button" disabled={busy} onClick={onPreview} aria-label={`预览${title}`}>预览</button>}{onPublish && <button type="button" disabled={busy} onClick={onPublish} aria-label={`发布${title}`}>发布</button>}</div>
    <button type="button" className="pub-gallery-more" aria-label={`${title}的更多操作`} aria-expanded={menuOpen}
      disabled={busy} onClick={onMenu}>···</button>
    <div className={`pub-gallery-actions${menuOpen ? ' pub-gallery-actions-open' : ''}`} role="group" aria-label={`${title}的草稿操作`}>
      <button type="button" disabled={busy} onClick={onOpen}>编辑</button>
      <button type="button" disabled={busy} onClick={onCopy}>复制</button>
      <button type="button" disabled={busy} className="pub-gallery-delete" onClick={onDelete}>删除</button>
    </div></>}
  </article>
}

export function DraftGallery({ contentType, active, busy = false, trash = false, refreshKey = 0, onOpen, onPreview, onPublish, onCreate, onCopy, onDelete, onRestore }: DraftGalleryProps) {
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [state, setState] = useState<GalleryState>(emptyGallery)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [columnCount, setColumnCount] = useState(4)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const savedScrollTop = useRef<number | null>(null)
  const generation = useRef(0)
  const loading = useRef(false)
  const activeRef = useRef(active)
  const searchPending = useRef(false)
  const previousRequest = useRef<{ contentType: PublisherContentType; query: string; refreshKey: number; trash: boolean } | null>(null)
  const refreshTargetCount = useRef<number | null>(null)
  const loadedFor = useRef('')
  const stateRef = useRef(state)
  activeRef.current = active
  stateRef.current = state
  const requestIdentity = `${contentType}\0${query}\0${refreshKey}\0${searchRevision}\0${trash}`

  const loadPage = useCallback(async (cursor: string | null) => {
    if (!activeRef.current || loading.current) return
    loading.current = true
    const requestedGeneration = generation.current
    setState(current => ({ ...current, loading: true, error: '' }))
    try {
      const result = await api<PublisherContentQueryResult>('contents-query', {
        contentType, query, ...(cursor ? { cursor } : {}), ...(trash ? { trash: true } : {}),
      })
      if (requestedGeneration !== generation.current || !activeRef.current) return
      if (!cursor) loadedFor.current = requestIdentity
      setState(current => ({
        items: cursor ? appendUniqueCards(current.items, result.items) : result.items,
        nextCursor: result.nextCursor,
        initialized: true,
        loading: false,
        error: '',
      }))
    } catch (cause) {
      if (requestedGeneration !== generation.current || !activeRef.current) return
      setState(current => ({ ...current, initialized: true, loading: false, error: errorMessage(cause) }))
    } finally {
      if (requestedGeneration === generation.current) loading.current = false
    }
  }, [contentType, query, requestIdentity])

  const refreshLoadedPages = useCallback(async (targetCount: number) => {
    if (!activeRef.current || loading.current) return
    loading.current = true
    const requestedGeneration = generation.current
    setState(current => ({ ...current, loading: true, error: '' }))
    try {
      let cursor: string | null = null
      let items: PublisherContentCard[] = []
      do {
        const result: PublisherContentQueryResult = await api<PublisherContentQueryResult>('contents-query', {
          contentType, query, ...(cursor ? { cursor } : {}), ...(trash ? { trash: true } : {}),
        })
        if (requestedGeneration !== generation.current || !activeRef.current) return
        items = appendUniqueCards(items, result.items)
        cursor = result.nextCursor
      } while (cursor && items.length < targetCount)
      loadedFor.current = requestIdentity
      refreshTargetCount.current = null
      setState({ items, nextCursor: cursor, initialized: true, loading: false, error: '' })
    } catch (cause) {
      if (requestedGeneration !== generation.current || !activeRef.current) return
      setState(current => ({ ...current, loading: false, error: errorMessage(cause) }))
    } finally {
      if (requestedGeneration === generation.current) loading.current = false
    }
  }, [contentType, query, requestIdentity])

  useEffect(() => {
    const previous = previousRequest.current
    const sameSearch = previous?.contentType === contentType && previous.query === query && previous.trash === trash
    const refreshing = sameSearch && previous?.refreshKey !== refreshKey && stateRef.current.initialized
    previousRequest.current = { contentType, query, refreshKey, trash }
    generation.current += 1
    loading.current = false
    if (refreshing) {
      // Keep loaded cards in place while replacing all previously loaded pages.
      // This preserves a deep scroll position when returning from the editor.
      refreshTargetCount.current = Math.max(1, stateRef.current.items.length)
      if (activeRef.current) void refreshLoadedPages(refreshTargetCount.current)
    } else {
      refreshTargetCount.current = null
      loadedFor.current = ''
      setState(emptyGallery)
      if (activeRef.current) void loadPage(null)
    }
    return () => { generation.current += 1; loading.current = false }
  }, [contentType, query, refreshKey, searchRevision, loadPage, refreshLoadedPages])

  useEffect(() => {
    if (!active) {
      generation.current += 1
      loading.current = false
      setState(current => ({ ...current, loading: false }))
    } else if (refreshTargetCount.current !== null && !loading.current && !state.error) {
      void refreshLoadedPages(refreshTargetCount.current)
    } else if (!state.initialized && !loading.current && !state.error && searchText.trim() === query) {
      void loadPage(null)
    }
  }, [active, state.initialized, state.error, searchText, query, loadPage, refreshLoadedPages])

  useEffect(() => {
    const nextQuery = searchText.trim()
    if (nextQuery === query) return
    const timeout = setTimeout(() => {
      searchPending.current = false
      setQuery(nextQuery)
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchText, query])

  useEffect(() => {
    if (!active || !state.initialized || state.loading || state.error || !state.nextCursor || searchText.trim() !== query) return
    const target = sentinelRef.current
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadPage(state.nextCursor)
    }, { root: target.closest('.pub'), rootMargin: '320px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [active, state.initialized, state.loading, state.error, state.nextCursor, searchText, query, loadPage])

  useLayoutEffect(() => {
    if (!active || savedScrollTop.current === null || state.loading || loadedFor.current !== requestIdentity) return
    const scrollRoot = rootRef.current?.closest('.pub')
    if (scrollRoot) scrollRoot.scrollTop = savedScrollTop.current
    savedScrollTop.current = null
  }, [active, state.loading, state.items.length, requestIdentity])

  useEffect(() => {
    if (!menuId) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuId(null) }
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.pub-gallery-more, .pub-gallery-actions')) setMenuId(null)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [menuId])

  useEffect(() => {
    if (contentType === 'article') return
    const gallery = rootRef.current
    if (!gallery) return
    const measure = () => {
      const width = gallery.getBoundingClientRect().width
      if (width > 0) setColumnCount(galleryColumnCount(width))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(gallery)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [contentType, active])

  const rememberScroll = () => { savedScrollTop.current = rootRef.current?.closest('.pub')?.scrollTop ?? 0 }
  const open = (id: string) => { rememberScroll(); setMenuId(null); onOpen(id) }
  const create = () => { rememberScroll(); setMenuId(null); onCreate() }
  const copy = (id: string) => { rememberScroll(); setMenuId(null); onCopy(id) }
  const remove = (id: string) => { setMenuId(null); onDelete(id) }
  const changeSearch = (value: string) => {
    const nextQuery = value.trim()
    if (nextQuery !== query) {
      generation.current += 1
      loading.current = false
      searchPending.current = true
    } else if (searchPending.current) {
      searchPending.current = false
      setSearchRevision(current => current + 1)
    }
    setSearchText(value)
  }
  const searchDebouncing = searchText.trim() !== query
  const label = CONTENT_LABELS[contentType]

  return <div ref={rootRef} className="pub-gallery" aria-label={`${label}${trash ? '回收站' : '草稿库'}`}>
    <div className="pub-gallery-toolbar">
      <input className="pub-input pub-gallery-search" type="search" aria-label={`搜索${label}草稿`}
        placeholder={`搜索${label}标题和${contentType === 'article' ? '摘要' : contentType === 'video' ? '简介' : '正文'}`}
        maxLength={200} value={searchText} onChange={event => changeSearch(event.target.value.slice(0, 200))}/>
      {!trash && <button type="button" className="pub-gallery-create" disabled={busy} onClick={create}>＋ 新增{label}</button>}
    </div>
    {searchDebouncing ? <p className="pub-gallery-status" role="status">正在搜索…</p>
      : <>
        {state.items.length > 0 && (contentType === 'article' ? <div className="pub-gallery-articles">
          {state.items.map(item => <DraftGalleryCard key={item.id} item={item} menuOpen={menuId === item.id} busy={busy} trash={trash} onRestore={() => onRestore?.(item.id)} onPreview={onPreview ? () => { rememberScroll(); onPreview(item.id) } : undefined} onPublish={onPublish ? () => { rememberScroll(); onPublish(item.id) } : undefined}
            onMenu={() => setMenuId(current => current === item.id ? null : item.id)}
            onOpen={() => open(item.id)} onCopy={() => copy(item.id)} onDelete={() => remove(item.id)}/>)}
        </div> : <div className={`pub-gallery-masonry pub-gallery-cols-${columnCount}`}>
          {distributeGalleryCards(state.items, columnCount).map((column, index) => <div className="pub-gallery-column" key={index}>
            {column.map(item => <DraftGalleryCard key={item.id} item={item} menuOpen={menuId === item.id} busy={busy} trash={trash} onRestore={() => onRestore?.(item.id)} onPreview={onPreview ? () => { rememberScroll(); onPreview(item.id) } : undefined} onPublish={onPublish ? () => { rememberScroll(); onPublish(item.id) } : undefined}
              onMenu={() => setMenuId(current => current === item.id ? null : item.id)}
              onOpen={() => open(item.id)} onCopy={() => copy(item.id)} onDelete={() => remove(item.id)}/>)}
          </div>)}
        </div>)}
        {state.loading && <p className="pub-gallery-status" role="status">正在加载草稿…</p>}
        {state.error && <div className="pub-gallery-status pub-gallery-load-error" role="alert">
          <span>加载失败：{state.error}</span>
          <button type="button" onClick={() => refreshTargetCount.current !== null
            ? void refreshLoadedPages(refreshTargetCount.current)
            : void loadPage(state.initialized && state.items.length ? state.nextCursor : null)}>重试</button>
        </div>}
        {state.initialized && !state.loading && !state.error && state.items.length === 0 && <div className="pub-empty">
          {query ? '没有找到匹配的草稿，请换个关键词。' : trash ? `没有已删除的${label}稿件。` : `还没有${label}草稿，点击“新增${label}”开始创作。`}
        </div>}
        {state.initialized && !state.loading && !state.error && state.items.length > 0 && !state.nextCursor && <p className="pub-gallery-status" role="status">已显示全部草稿</p>}
        {state.nextCursor && !state.error && <div ref={sentinelRef} className="pub-gallery-sentinel" aria-hidden="true"/>}
      </>}
  </div>
}
