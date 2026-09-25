import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { API, PLATFORM_LABELS, type Platform, type PublisherContent, type PublisherSessionContent } from '../protocol.ts'
import { PublisherContentPreview } from './content-preview.tsx'
import { contentPreviewCss } from './content-preview-style.ts'
import { SourceDocumentPreview, type SourceDocumentSnapshot } from './source-document-preview.tsx'

export { contentAssetUrl } from './content-preview.tsx'

export const PREVIEW_KIND = 'cqai-publisher-preview'
export const PREVIEW_ID = 'cqai-dsh-plugin-publisher/preview'

export type SessionContentSnapshot = PublisherSessionContent

export function sessionContentUrl(sessionId: string): string {
  return `${API}/session-content/${encodeURIComponent(sessionId)}`
}

export function sessionPreviewUrl(sessionId: string): string {
  return `${API}/session-preview/${encodeURIComponent(sessionId)}`
}

export function sourceImageUrl(sourceId: string, imageId: string): string {
  return `${API}/source-image/${encodeURIComponent(sourceId)}/${encodeURIComponent(imageId)}`
}

export interface SessionPublicationCandidate {
  id: string
  sessionId: string
  sourceId: string
  sourceRevision: string
  contentType: 'article' | 'image-note'
  platforms: Platform[]
  title: string
  body: string
  summary: string
  tags: string[]
  platformVariants: Partial<Record<Platform, { title?: string; body?: string; summary?: string; tags?: string[] }>>
  warnings?: Partial<Record<Platform, string[]>>
}

export interface SessionPreviewSnapshot {
  sessionId: string
  source: SourceDocumentSnapshot | null
  candidate: SessionPublicationCandidate | null
}

export function sameSessionPreview(previous: SessionPreviewSnapshot | undefined, next: SessionPreviewSnapshot): boolean {
  return previous?.sessionId === next.sessionId
    && previous.source?.id === next.source?.id
    && previous.source?.revision === next.source?.revision
    && previous.candidate?.id === next.candidate?.id
}

export function sameDraftRevision(previous: SessionContentSnapshot | undefined, next: SessionContentSnapshot): boolean {
  return previous?.sessionId === next.sessionId
    && previous.contentId === next.contentId
    && previous.revision === next.revision
}

interface PreviewError { sessionId: string; message: string }

function previewableContentId(snapshot: SessionContentSnapshot): string | null {
  const content = snapshot.content
  return content && snapshot.contentId === content.id
    && (content.contentType === 'article' || content.contentType === 'image-note') ? content.id : null
}

export interface PreviewDiscoveryState {
  sessionId: string
  contentId: string | null
  autoOpened: boolean
}

/** The first successful read is a baseline; only a later first draft may open the preview. */
export function advancePreviewDiscovery(previous: PreviewDiscoveryState | undefined, snapshot: SessionContentSnapshot) {
  const prior = previous?.sessionId === snapshot.sessionId ? previous : undefined
  const contentId = previewableContentId(snapshot)
  const autoOpen = !!prior && prior.contentId === null && contentId !== null && !prior.autoOpened
  const closePreview = !!prior && prior.contentId !== null && contentId === null
  return {
    state: { sessionId: snapshot.sessionId, contentId, autoOpened: (prior?.autoOpened ?? contentId !== null) || autoOpen },
    showAction: contentId !== null,
    autoOpen,
    closePreview,
  }
}

/** The source document owns discovery; a legacy Publisher draft is used only when it is absent. */
export function advanceSessionPreviewDiscovery(
  previous: PreviewDiscoveryState | undefined,
  snapshot: SessionPreviewSnapshot,
  legacy?: SessionContentSnapshot,
) {
  const source = snapshot.source?.sessionId === snapshot.sessionId ? snapshot.source : null
  const contentId = source ? `source:${source.id}`
    : legacy?.sessionId === snapshot.sessionId ? previewableContentId(legacy) : null
  const prior = previous?.sessionId === snapshot.sessionId ? previous : undefined
  const autoOpen = !!prior && prior.contentId === null && contentId !== null && !prior.autoOpened
  const closePreview = !!prior && prior.contentId !== null && contentId === null
  return {
    state: { sessionId: snapshot.sessionId, contentId, autoOpened: (prior?.autoOpened ?? contentId !== null) || autoOpen },
    showAction: contentId !== null,
    autoOpen,
    closePreview,
  }
}

type PreviewTabClose = { signal: AbortSignal; close(): void; closing: boolean }

/** Keep a session-scoped close handle while a tab exists, including when its body is hidden. */
export class PreviewTabRegistry {
  private readonly bySession = new Map<string, Map<string, PreviewTabClose>>()

  register(sessionId: string, tabId: string, signal: AbortSignal, close: () => void): void {
    if (signal.aborted) return
    let tabs = this.bySession.get(sessionId)
    if (!tabs) { tabs = new Map(); this.bySession.set(sessionId, tabs) }
    if (tabs.get(tabId)?.signal === signal) return
    tabs.set(tabId, { signal, close, closing: false })
    signal.addEventListener('abort', () => {
      if (tabs!.get(tabId)?.signal !== signal) return
      tabs!.delete(tabId)
      if (tabs!.size === 0) this.bySession.delete(sessionId)
    }, { once: true })
  }

  closeSession(sessionId: string): void {
    for (const tab of this.bySession.get(sessionId)?.values() ?? []) {
      if (tab.closing) continue
      tab.closing = true
      try { tab.close() } catch { tab.closing = false }
    }
  }
}

const previewTabs = new PreviewTabRegistry()

/** A tab may retain state across session switches; only its current session can be shown or published. */
export function previewForSession(snapshot: SessionContentSnapshot | undefined, error: PreviewError | undefined, sessionId: string) {
  const currentSnapshot = snapshot?.sessionId === sessionId ? snapshot : undefined
  const currentError = error?.sessionId === sessionId ? error.message : ''
  const content = currentSnapshot && previewableContentId(currentSnapshot) ? currentSnapshot.content : null
  const canPublish = !!content && !currentError && (content.contentType === 'article' || content.contentType === 'image-note')
  return { currentSnapshot, currentError, content, canPublish }
}

/** A candidate belongs to one exact source revision and session. */
export function sourcePreviewForSession(
  snapshot: SessionPreviewSnapshot | undefined,
  legacy: SessionContentSnapshot | undefined,
  error: PreviewError | undefined,
  sessionId: string,
) {
  const currentPreview = snapshot?.sessionId === sessionId ? snapshot : undefined
  const currentError = error?.sessionId === sessionId ? error.message : ''
  const source = currentPreview?.source?.sessionId === sessionId ? currentPreview.source : null
  const offered = currentPreview?.candidate
  const candidate = source && offered?.sessionId === sessionId && offered.sourceId === source.id
    && offered.sourceRevision === source.revision
    && (offered.contentType === 'article' || offered.contentType === 'image-note')
    && Array.isArray(offered.platforms) && offered.platforms.length > 0 ? offered : null
  const fallback = !source ? previewForSession(legacy, error, sessionId) : null
  return {
    currentPreview, currentError, source, candidate,
    candidateStale: !!source && !!offered && !candidate,
    content: fallback?.content ?? null,
    canPublish: !currentError && (!!candidate || !!fallback?.canPublish),
  }
}

async function readSessionPreview(sessionId: string, signal: AbortSignal): Promise<SessionPreviewSnapshot> {
  const response = await fetch(sessionPreviewUrl(sessionId), { signal, cache: 'no-store' })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('内容预览服务暂未就绪')
  }
  const result = await response.json() as SessionPreviewSnapshot & { error?: string }
  if (!response.ok) throw new Error(result.error || '无法读取原始文档')
  if (result.sessionId !== sessionId) throw new Error('内容预览与当前对话不匹配')
  return result
}

async function readCurrentPreview(sessionId: string, signal: AbortSignal) {
  const preview = await readSessionPreview(sessionId, signal)
  const legacy = preview.source ? undefined : await readSessionContent(sessionId, signal).catch(() => undefined)
  return { preview, legacy }
}

export async function openPublicationCandidate(sessionId: string, candidateId: string, signal?: AbortSignal): Promise<PublisherContent> {
  const response = await fetch(`${API}/publication-open`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ejianbao': '1' },
    body: JSON.stringify({ sessionId, candidateId }), signal,
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('发布准备服务暂未就绪')
  }
  const result = await response.json() as PublisherContent & { error?: string }
  if (!response.ok) throw new Error(result.error || '无法创建发布准备单')
  if (!result || typeof result.id !== 'string' || (result.contentType !== 'article' && result.contentType !== 'image-note')) {
    throw new Error('发布准备单响应无效')
  }
  return result
}

async function readSessionContent(sessionId: string, signal: AbortSignal): Promise<SessionContentSnapshot> {
  const response = await fetch(sessionContentUrl(sessionId), { signal })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('多平台发布服务暂未就绪')
  }
  const result = await response.json() as SessionContentSnapshot & { error?: string }
  if (!response.ok) throw new Error(result.error || '无法读取会话草稿')
  if (result.sessionId !== sessionId) throw new Error('会话草稿与当前对话不匹配')
  return result
}

const styles = `
.pub-conv-preview { height: 100%; min-height: 0; overflow: auto; padding: 14px; box-sizing: border-box; color: var(--dsw-alias-label-primary, #111318); background: var(--dsw-alias-bg-base, #fff); font: 14px/1.6 var(--dsw-font-family, inherit); }
.pub-conv-preview * { box-sizing: border-box; }
.pub-conv-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.pub-conv-controls strong { font-size: 14px; }
.pub-conv-switch { display: flex; gap: 4px; }
.pub-conv-views { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
.pub-conv-preview button { cursor: pointer; border: 1px solid var(--dsw-alias-border-l2, #e4e6e9); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; padding: 5px 9px; font: inherit; }
.pub-conv-preview button[aria-pressed=true] { background: var(--dsw-specific-sidebar-nav-item-active, #edf0f3); font-weight: 600; }
.pub-conv-preview button:disabled { cursor: not-allowed; opacity: .5; }
.pub-conv-preview button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-conv-device-scroll { overflow-x: auto; }
.pub-conv-device-scroll[data-device=mobile] .pub-source-preview { max-width: 390px; }
.pub-conv-device-scroll[data-device=pc] .pub-source-preview { width: 720px; max-width: none; }
.pub-conv-note, .pub-conv-error, .pub-conv-muted { color: var(--dsw-alias-label-tertiary, #777d85); font-size: 12px; }
.pub-conv-error { color: var(--dsw-alias-state-error-primary, #dc2626); }
.pub-conv-footer { display: flex; justify-content: flex-end; margin-top: 14px; }
.pub-conv-footer button { background: var(--dsw-alias-state-business-primary, #4176e6); color: #fff; border-color: transparent; padding: 7px 18px; }
${contentPreviewCss}
`

export function ConversationPreview({ sessionId, useTabInfo, onPublish }: PropsRuntime<'sidebar.right.pane.tab'> & {
  onPublish(content: Pick<PublisherContent, 'id' | 'contentType'>, intendedPlatforms?: Platform[]): void
}): ReactNode {
  const { tab } = useTabInfo()
  const [device, setDevice] = useState<'mobile' | 'pc'>('mobile')
  const [view, setView] = useState<'source' | 'master' | Platform>('source')
  const [snapshot, setSnapshot] = useState<SessionPreviewSnapshot>()
  const [legacySnapshot, setLegacySnapshot] = useState<SessionContentSnapshot>()
  const [error, setError] = useState<PreviewError>()
  const [actionError, setActionError] = useState<PreviewError>()
  const [publishing, setPublishing] = useState(false)
  const publishingRef = useRef(false)
  const openControllerRef = useRef<AbortController>()
  const activeSessionRef = useRef(sessionId)
  activeSessionRef.current = sessionId
  useEffect(() => { previewTabs.register(sessionId, tab.id, tab.signal, () => tab.actions.close()) }, [sessionId, tab.id, tab.signal, tab.actions])
  useEffect(() => {
    setView('source')
    setActionError(undefined)
    setPublishing(false)
    publishingRef.current = false
    return () => { openControllerRef.current?.abort() }
  }, [sessionId])
  useEffect(() => {
    const abort = () => openControllerRef.current?.abort()
    tab.signal.addEventListener('abort', abort)
    return () => tab.signal.removeEventListener('abort', abort)
  }, [tab.signal])
  useEffect(() => {
    if (!tab.visible) return undefined
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || document.hidden) return
      pending = true
      try {
        const next = await readCurrentPreview(sessionId, controller.signal)
        if (controller.signal.aborted) return
        setSnapshot(previous => sameSessionPreview(previous, next.preview) ? previous : next.preview)
        setLegacySnapshot(previous => next.legacy && sameDraftRevision(previous, next.legacy) ? previous : next.legacy)
        setError(undefined)
        if (!next.preview.source && !(next.legacy && previewableContentId(next.legacy))) tab.actions.close()
      } catch (cause) {
        if (!controller.signal.aborted) setError({ sessionId, message: cause instanceof Error ? cause.message : '无法读取内容预览' })
      } finally { pending = false }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 3000)
    const onVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility) }
  }, [sessionId, tab.visible, tab.actions])
  const { currentPreview, currentError, source, candidate, candidateStale, content, canPublish } =
    sourcePreviewForSession(snapshot, legacySnapshot, error, sessionId)
  const activeView = candidate && (view === 'source' || view === 'master' || candidate.platforms.includes(view)) ? view : 'source'
  const variant = candidate && activeView !== 'source' && activeView !== 'master' ? candidate.platformVariants[activeView] : undefined
  const displaySource = source && candidate && activeView !== 'source'
    ? { ...source, title: variant?.title ?? candidate.title, body: variant?.body ?? candidate.body }
    : source
  const publish = async () => {
    if (!canPublish || publishingRef.current) return
    if (!source) {
      if (!content) return
      try { onPublish(content) }
      catch (cause) { setActionError({ sessionId, message: cause instanceof Error ? cause.message : '无法打开发布页面' }) }
      return
    }
    if (!candidate) return
    const controller = new AbortController()
    openControllerRef.current = controller
    publishingRef.current = true
    setPublishing(true)
    setActionError(undefined)
    try {
      const preparation = await openPublicationCandidate(sessionId, candidate.id, controller.signal)
      if (!controller.signal.aborted && activeSessionRef.current === sessionId) onPublish(preparation, [...candidate.platforms])
    } catch (cause) {
      if (!controller.signal.aborted && activeSessionRef.current === sessionId) {
        setActionError({ sessionId, message: cause instanceof Error ? cause.message : '无法创建发布准备单' })
      }
    } finally {
      if (openControllerRef.current === controller) {
        openControllerRef.current = undefined
        publishingRef.current = false
        if (activeSessionRef.current === sessionId) setPublishing(false)
      }
    }
  }
  return <div className="pub-conv-preview" data-publisher-preview-session={sessionId}>
    <style>{styles}</style>
    <div className="pub-conv-controls"><strong>内容预览</strong><div className="pub-conv-switch" role="group" aria-label="预览设备">
      <button type="button" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>移动端</button>
      <button type="button" aria-pressed={device === 'pc'} onClick={() => setDevice('pc')}>PC</button>
    </div></div>
    {currentError && <p className="pub-conv-error" role="status">{currentError}；稍后会自动重试。</p>}
    {actionError?.sessionId === sessionId && <p className="pub-conv-error" role="status">{actionError.message}</p>}
    {!currentPreview && !currentError && <p className="pub-conv-muted">正在读取原始文档…</p>}
    {currentPreview && !source && !content && <p className="pub-conv-note">与 Agent 完成内容后，原始 MD 会显示在这里。</p>}
    {source && <>
      {candidate && <div className="pub-conv-views" role="group" aria-label="发布候选预览">
        <button type="button" aria-pressed={activeView === 'source'} onClick={() => setView('source')}>原稿</button>
        <button type="button" aria-pressed={activeView === 'master'} onClick={() => setView('master')}>发布主稿</button>
        {candidate.platforms.map(platform => <button type="button" key={platform} aria-pressed={activeView === platform}
          onClick={() => setView(platform)}>{PLATFORM_LABELS[platform]}</button>)}
      </div>}
      {candidateStale && <p className="pub-conv-error" role="status">原稿已更新，发布候选已失效。请在对话中重新准备发布预览。</p>}
      <div className="pub-conv-device-scroll" data-device={device} aria-label={device === 'mobile' ? '移动端内容预览' : 'PC 内容预览'}>
        {displaySource && <SourceDocumentPreview source={displaySource} imageUrl={sourceImageUrl} showUnusedImages={activeView === 'source'}
          imagePresentation={candidate && activeView !== 'source' && candidate.contentType === 'image-note' ? 'gallery' : 'inline'}/>}
      </div>
      {candidate && activeView !== 'source' && <div className="pub-conv-note" aria-label="发布候选信息">
        <div>内容类型：{candidate.contentType === 'article' ? '文章' : '图文'}</div>
        <div>摘要：{(variant?.summary ?? candidate.summary) || '未设置'}</div>
        <div>标签：{(variant?.tags ?? candidate.tags).length ? (variant?.tags ?? candidate.tags).map(tag => `#${tag}`).join(' ') : '未设置'}</div>
        {candidate.contentType === 'image-note' && <div>图片素材将在发布页作为图集提交；Markdown 图片语法不作为图文正文。</div>}
        {activeView !== 'master' && (candidate.warnings?.[activeView] ?? []).map((warning, index) =>
          <div className="pub-conv-error" role="status" key={`${activeView}-${index}`}>{warning}</div>)}
      </div>}
      {candidate ? <p className="pub-conv-note">{activeView === 'source' ? '原始 MD 内容预览。' : '发布候选预览；各平台最终呈现请以平台后台为准。'}</p>
        : !candidateStale && <p className="pub-conv-note">明确要求发布并准备目标平台后，才会出现发布候选。</p>}
      {(candidate || candidateStale) && <div className="pub-conv-footer"><button type="button" disabled={!canPublish || publishing} onClick={() => { void publish() }}>
        {publishing ? '正在准备发布…' : '发布'}
      </button></div>}
    </>}
    {!source && content && <>
      <div className="pub-conv-device-scroll" aria-label={device === 'mobile' ? '移动端内容预览' : 'PC 内容预览'}>
        <PublisherContentPreview content={content} device={device}/>
      </div>
      <p className="pub-conv-note">这是旧会话草稿的预览；各平台实际显示以发布后的页面为准。</p>
      <div className="pub-conv-footer"><button type="button" disabled={!canPublish} onClick={() => { void publish() }}>发布</button></div>
    </>}
  </div>
}

export function ConversationPreviewAction({ sessionId, openPreview }: PropsRuntime<'conversation.session.header.utilities'> & {
  openPreview(): void
}): ReactNode {
  const [availability, setAvailability] = useState<{ sessionId: string; showAction: boolean }>()
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    let previous: PreviewDiscoveryState | undefined
    const discover = async () => {
      if (pending || document.hidden) return
      pending = true
      try {
        const snapshot = await readCurrentPreview(sessionId, controller.signal)
        if (controller.signal.aborted) return
        const next = advanceSessionPreviewDiscovery(previous, snapshot.preview, snapshot.legacy)
        previous = next.state
        setAvailability(current => current?.sessionId === sessionId && current.showAction === next.showAction
          ? current : { sessionId, showAction: next.showAction })
        if (next.closePreview) previewTabs.closeSession(sessionId)
        if (next.autoOpen) openPreview()
      } catch { /* Keep the last known visibility and retry after a read failure. */ }
      finally { pending = false }
    }
    void discover()
    const interval = window.setInterval(() => { void discover() }, 3500)
    const onVisibility = () => { if (!document.hidden) void discover() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility) }
  }, [sessionId, openPreview])
  if (availability?.sessionId !== sessionId || !availability.showAction) return null
  return <button type="button" title="打开当前会话的内容预览" onClick={openPreview} style={{ cursor: 'pointer', border: 0, borderRadius: 8, padding: '5px 8px', background: 'transparent', color: 'inherit', font: 'inherit' }}>内容预览</button>
}
