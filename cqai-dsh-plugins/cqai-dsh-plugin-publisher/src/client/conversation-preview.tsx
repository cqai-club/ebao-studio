import { useEffect, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { API, type PublisherAsset, type PublisherContent, type PublisherSessionContent } from '../protocol.ts'

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

/** A tab may retain state across session switches; only its current session can be shown or published. */
export function previewForSession(snapshot: SessionContentSnapshot | undefined, error: PreviewError | undefined, sessionId: string) {
  const currentSnapshot = snapshot?.sessionId === sessionId ? snapshot : undefined
  const currentError = error?.sessionId === sessionId ? error.message : ''
  const content = currentSnapshot?.content ?? null
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

/** A small, safe Markdown preview. Only draft-owned image references become images. */
function ArticleBody({ content }: { content: PublisherContent }): ReactNode {
  const inline = (line: string): ReactNode[] => {
    const nodes: ReactNode[] = []
    const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/gu
    let offset = 0
    for (const match of line.matchAll(tokens)) {
      const index = match.index ?? 0
      if (index > offset) nodes.push(line.slice(offset, index))
      const token = match[0]
      if (token.startsWith('`')) nodes.push(<code key={index}>{token.slice(1, -1)}</code>)
      else if (token.startsWith('**')) nodes.push(<strong key={index}>{token.slice(2, -2)}</strong>)
      else nodes.push(<em key={index}>{token.slice(1, -1)}</em>)
      offset = index + token.length
    }
    if (offset < line.length) nodes.push(line.slice(offset))
    return nodes
  }
  const blocks: ReactNode[] = []
  let fenced: string[] | undefined
  for (const [index, line] of content.body.split(/\r?\n/u).entries()) {
    if (line.startsWith('```')) {
      if (fenced) { blocks.push(<pre key={index}><code>{fenced.join('\n')}</code></pre>); fenced = undefined }
      else fenced = []
      continue
    }
    if (fenced) { fenced.push(line); continue }
    const image = /^!\[([^\]]*)\]\(ebao-asset:\/\/([0-9a-f-]{36})\)$/iu.exec(line.trim())
    if (image) {
      const asset = content.assets.find(item => item.id === image[2])
      blocks.push(asset
        ? <figure key={index}><AssetImage content={content} asset={asset}/>{image[1] && <figcaption>{image[1]}</figcaption>}</figure>
        : <p key={index} className="pub-conv-missing-image">正文引用的图片已不存在</p>)
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line)
    if (heading) {
      blocks.push(heading[1].length === 1 ? <h2 key={index}>{inline(heading[2])}</h2> : <h3 key={index}>{inline(heading[2])}</h3>)
      continue
    }
    if (/^[-*]\s+/u.test(line)) { blocks.push(<p key={index}>• {inline(line.slice(2))}</p>); continue }
    if (/^\d+\.\s+/u.test(line)) { blocks.push(<p key={index}>{inline(line)}</p>); continue }
    if (/^>\s?/u.test(line)) { blocks.push(<blockquote key={index}>{inline(line.replace(/^>\s?/u, ''))}</blockquote>); continue }
    if (/^---+\s*$/u.test(line)) { blocks.push(<hr key={index}/>); continue }
    blocks.push(<p key={index}>{line ? inline(line) : '\u00a0'}</p>)
  }
  if (fenced) blocks.push(<pre key="last"><code>{fenced.join('\n')}</code></pre>)
  return <div className="pub-conv-body">{blocks}</div>
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
.pub-conv-page h2 { font-size: 18px; }
.pub-conv-page h3 { font-size: 16px; }
.pub-conv-page p, .pub-conv-page blockquote { white-space: pre-wrap; overflow-wrap: anywhere; }
.pub-conv-page pre { overflow-x: auto; padding: 10px; background: var(--dsw-alias-bg-module-platform, #f5f6f7); }
.pub-conv-page blockquote { border-left: 3px solid var(--dsw-alias-border-l2, #e4e6e9); margin-left: 0; padding-left: 10px; }
.pub-conv-page figure { margin: 16px 0; }
.pub-conv-page figure img, .pub-conv-gallery img { display: block; max-width: 100%; height: auto; border-radius: 8px; }
.pub-conv-page figcaption { color: var(--dsw-alias-label-tertiary, #777d85); font-size: 12px; }
.pub-conv-gallery { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 18px; }
.pub-conv-page[data-device=pc] .pub-conv-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pub-conv-gallery img { width: 100%; aspect-ratio: 1; object-fit: cover; }
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
`

export function ConversationPreview({ sessionId, useTabInfo, onPublish }: PropsRuntime<'sidebar.right.pane.tab'> & {
  onPublish(content: Pick<PublisherContent, 'id' | 'contentType'>): void
}): ReactNode {
  const { tab } = useTabInfo()
  const [device, setDevice] = useState<'mobile' | 'pc'>('mobile')
  const [snapshot, setSnapshot] = useState<SessionContentSnapshot>()
  const [error, setError] = useState<PreviewError>()
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
      } catch (cause) {
        if (!controller.signal.aborted) setError({ sessionId, message: cause instanceof Error ? cause.message : '无法读取会话草稿' })
      } finally { pending = false }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 3000)
    const onVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility) }
  }, [sessionId, tab.visible])
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
        <article className="pub-conv-page" data-device={device}>
          {content.contentType === 'image-note' && content.assets.length > 0 && <div className="pub-conv-gallery" aria-label="图文图片">{content.assets.map(asset => <AssetImage key={asset.id} content={content} asset={asset}/>)}</div>}
          <h1>{content.title || '未命名草稿'}</h1>
          {content.contentType === 'article' && content.coverAssetId && !content.body.includes(`ebao-asset://${content.coverAssetId}`) && (() => {
            const cover = content.assets.find(asset => asset.id === content.coverAssetId)
            return cover ? <figure><AssetImage content={content} asset={cover}/><figcaption>封面</figcaption></figure> : null
          })()}
          {content.contentType === 'article' ? <ArticleBody content={content}/> : <p>{content.body || '正文待完善'}</p>}
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

/** Only discover the first draft in a session. Preview refresh itself runs only while visible. */
const openedSessions = new Set<string>()

export function ConversationPreviewAction({ sessionId, openPreview }: PropsRuntime<'conversation.session.header.utilities'> & {
  openPreview(): void
}): ReactNode {
  useEffect(() => {
    if (openedSessions.has(sessionId)) return undefined
    const controller = new AbortController()
    let pending = false
    const discover = async () => {
      if (pending || openedSessions.has(sessionId) || document.hidden) return
      pending = true
      try {
        const snapshot = await readSessionContent(sessionId, controller.signal)
        if (controller.signal.aborted || !snapshot.contentId) return
        openPreview()
        openedSessions.add(sessionId)
      } catch { /* The preview button remains available; discovery retries. */ }
      finally { pending = false }
    }
    void discover()
    const interval = window.setInterval(() => { void discover() }, 3500)
    const onVisibility = () => { if (!document.hidden) void discover() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility) }
  }, [sessionId, openPreview])
  return <button type="button" title="打开当前会话的内容预览" onClick={openPreview} style={{ cursor: 'pointer', border: 0, borderRadius: 8, padding: '5px 8px', background: 'transparent', color: 'inherit', font: 'inherit' }}>内容预览</button>
}
