import { useEffect, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { API, resolveArticleTheme, type PublisherAsset, type PublisherContent, type PublisherSessionContent } from '../protocol.ts'
import { ImageNoteCarousel, imageNoteCarouselCss } from './image-note-carousel.tsx'
import { ArticleMarkdownPreview } from './wechat-preview-html.tsx'
import { articlePreviewCss } from './article-preview-style.ts'

export const PREVIEW_KIND = 'cqai-publisher-preview'
export const PREVIEW_ID = 'cqai-dsh-plugin-publisher/preview'

export type SessionContentSnapshot = PublisherSessionContent

export function sessionContentUrl(sessionId: string): string {
  return `${API}/session-content/${encodeURIComponent(sessionId)}`
}

export function contentAssetUrl(contentId: string, assetId: string): string {
  return `${API}/content-asset/${encodeURIComponent(contentId)}/${encodeURIComponent(assetId)}`
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

function AssetImage({ content, asset, className = '' }: {
  content: PublisherContent
  asset: PublisherAsset
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [content.id, asset.id])
  return failed
    ? <div className={`pub-conv-image-error ${className}`} role="img" aria-label={`${asset.name} 加载失败`}>图片暂时无法显示：{asset.name}</div>
    : <img className={className} src={contentAssetUrl(content.id, asset.id)} alt={asset.name} loading="lazy" onError={() => setFailed(true)}/>
}

const styles = `
.pub-conv-preview { height: 100%; min-height: 0; overflow: auto; padding: 14px; box-sizing: border-box; color: var(--dsw-alias-label-primary, #111318); background: var(--dsw-alias-bg-base, #fff); font: 14px/1.6 var(--dsw-font-family, inherit); }
.pub-conv-preview * { box-sizing: border-box; }
.pub-conv-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.pub-conv-controls strong { font-size: 14px; }
.pub-conv-switch { display: flex; gap: 4px; }
.pub-conv-preview button { cursor: pointer; border: 1px solid var(--dsw-alias-border-l2, #e4e6e9); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; padding: 5px 9px; font: inherit; }
.pub-conv-preview button[aria-pressed=true] { background: var(--dsw-specific-sidebar-nav-item-active, #edf0f3); font-weight: 600; }
.pub-conv-preview button:disabled { cursor: not-allowed; opacity: .5; }
.pub-conv-preview button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-conv-device-scroll { overflow-x: auto; }
.pub-conv-page { width: min(100%, 390px); min-height: 480px; margin: 0 auto; padding: 18px; border: 1px solid var(--dsw-alias-border-l2, #e4e6e9); border-radius: 18px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 4px 18px #0000000a; }
.pub-conv-page[data-device=pc] { width: 720px; min-width: 720px; border-radius: 8px; }
.pub-conv-page h1 { margin: 0 0 14px; font-size: 21px; line-height: 1.4; overflow-wrap: anywhere; }
.pub-conv-page.ebao-article-reader[data-theme=editorial] > h1 { color: #214d42; padding-bottom: 16px; border-bottom: 1px solid #c9ddd2; }
.pub-conv-page h2 { font-size: 18px; }
.pub-conv-page h3 { font-size: 16px; }
.pub-conv-page p, .pub-conv-page blockquote { white-space: pre-wrap; overflow-wrap: anywhere; }
.pub-conv-page pre { overflow-x: auto; padding: 10px; background: var(--dsw-alias-bg-module-platform, #f5f6f7); }
.pub-conv-page blockquote { border-left: 3px solid var(--dsw-alias-border-l2, #e4e6e9); margin-left: 0; padding-left: 10px; }
.pub-conv-page figure { margin: 16px 0; }
.pub-conv-page figure img { display: block; max-width: 100%; height: auto; border-radius: 8px; }
.pub-conv-page figcaption { color: var(--dsw-alias-label-tertiary, #777d85); font-size: 12px; }
.pub-conv-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub-conv-assets { margin-top: 18px; }
.pub-conv-assets h2 { font-size: 13px; }
.pub-conv-assets-list { display: flex; gap: 8px; overflow-x: auto; }
.pub-conv-assets-list img, .pub-conv-assets-list .pub-conv-image-error { flex: 0 0 72px; width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }
.pub-conv-image-error { display: grid; place-items: center; padding: 6px; background: var(--dsw-alias-bg-module-platform, #f5f6f7); color: var(--dsw-alias-label-secondary, #535961); font-size: 11px; }
.pub-conv-note, .pub-conv-error, .pub-conv-muted { color: var(--dsw-alias-label-tertiary, #777d85); font-size: 12px; }
.pub-conv-error { color: var(--dsw-alias-state-error-primary, #dc2626); }
.pub-conv-footer { display: flex; justify-content: flex-end; margin-top: 14px; }
.pub-conv-footer button { background: var(--dsw-alias-state-business-primary, #4176e6); color: #fff; border-color: transparent; padding: 7px 18px; }
${imageNoteCarouselCss}
${articlePreviewCss}
`

export function ConversationPreview({ sessionId, useTabInfo, onPublish }: PropsRuntime<'sidebar.right.pane.tab'> & {
  onPublish(content: Pick<PublisherContent, 'id' | 'contentType'>): void
}): ReactNode {
  const { tab } = useTabInfo()
  const [device, setDevice] = useState<'mobile' | 'pc'>('mobile')
  const [snapshot, setSnapshot] = useState<SessionContentSnapshot>()
  const [error, setError] = useState<PreviewError>()
  useEffect(() => { previewTabs.register(sessionId, tab.id, tab.signal, () => tab.actions.close()) }, [sessionId, tab.id, tab.signal, tab.actions])
  useEffect(() => {
    if (!tab.visible) return undefined
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || document.hidden) return
      pending = true
      try {
        const next = await readSessionContent(sessionId, controller.signal)
        if (controller.signal.aborted) return
        setSnapshot(previous => sameDraftRevision(previous, next) ? previous : next)
        setError(undefined)
        if (!previewableContentId(next)) tab.actions.close()
      } catch (cause) {
        if (!controller.signal.aborted) setError({ sessionId, message: cause instanceof Error ? cause.message : '无法读取会话草稿' })
      } finally { pending = false }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 3000)
    const onVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility) }
  }, [sessionId, tab.visible, tab.actions])
  const { currentSnapshot, currentError, content, canPublish } = previewForSession(snapshot, error, sessionId)
  const publish = () => {
    if (!content || !canPublish) return
    try { onPublish(content) }
    catch (cause) { setError({ sessionId, message: cause instanceof Error ? cause.message : '无法打开发布页面' }) }
  }
  return <div className="pub-conv-preview" data-publisher-preview-session={sessionId}>
    <style>{styles}</style>
    <div className="pub-conv-controls"><strong>内容预览</strong><div className="pub-conv-switch" role="group" aria-label="预览设备">
      <button type="button" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>移动端</button>
      <button type="button" aria-pressed={device === 'pc'} onClick={() => setDevice('pc')}>PC</button>
    </div></div>
    {currentError && <p className="pub-conv-error" role="status">{currentError}；稍后会自动重试。</p>}
    {!currentSnapshot && !currentError && <p className="pub-conv-muted">正在读取会话草稿…</p>}
    {currentSnapshot && !content && <p className="pub-conv-note">在对话中和 Agent 讨论内容。形成标题、正文或图片后，草稿会显示在这里。</p>}
    {content && <>
      <div className="pub-conv-device-scroll" aria-label={device === 'mobile' ? '移动端内容预览' : 'PC 内容预览'}>
        <article className={`pub-conv-page${content.contentType === 'article' ? ' ebao-article-reader' : ''}`} data-device={device} data-theme={content.contentType === 'article' ? resolveArticleTheme(content) : undefined}>
          {content.contentType === 'image-note' && <ImageNoteCarousel contentId={content.id} assets={content.assets} renderImage={asset => <AssetImage content={content} asset={asset}/>}/>}
          <h1>{content.title || '未命名草稿'}</h1>
          {content.contentType === 'article' && content.coverAssetId && !content.body.includes(`ebao-asset://${content.coverAssetId}`) && (() => {
            const cover = content.assets.find(asset => asset.id === content.coverAssetId)
            return cover ? <figure><AssetImage content={content} asset={cover}/><figcaption>封面</figcaption></figure> : null
          })()}
          {content.contentType === 'article'
            ? <ArticleMarkdownPreview body={content.body || '正文待完善'} content={content} assetUrl={id => contentAssetUrl(content.id, id)}/>
            : <p>{content.body || '正文待完善'}</p>}
          {content.tags.length > 0 && <div className="pub-conv-tags">{content.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
        </article>
      </div>
      <section className="pub-conv-assets" aria-label="发布图片素材"><h2>图片素材 · {content.assets.length} 张</h2>
        {content.assets.length > 0 ? <div className="pub-conv-assets-list">{content.assets.map(asset => <AssetImage key={asset.id} content={content} asset={asset}/>)}</div> : <p className="pub-conv-muted">暂无图片</p>}
      </section>
      <p className="pub-conv-note">此处为通用排版预览；各平台实际显示以发布后的页面为准。</p>
      <div className="pub-conv-footer"><button type="button" disabled={!canPublish} onClick={publish}>发布</button></div>
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
        const snapshot = await readSessionContent(sessionId, controller.signal)
        if (controller.signal.aborted) return
        const next = advancePreviewDiscovery(previous, snapshot)
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
