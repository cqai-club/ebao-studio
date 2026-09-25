import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PublisherContentType } from '../protocol.ts'
import { AccountsPage } from './accounts.tsx'
import { ContentEditor } from './content.tsx'
import { ConversationPreview, ConversationPreviewAction, PREVIEW_ID, PREVIEW_KIND } from './conversation-preview.tsx'
import { clearPublisherHandoff, readPublisherHandoff, rememberPublisherHandoff, requestPublisherHandoff, subscribePublisherHandoff } from './handoff.ts'
import { SubmissionHistory } from './history.tsx'
import { css } from './shared.tsx'
import { PublisherTipsProvider } from './tips.tsx'
import { VideoPage } from './video.tsx'

export const inject = ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs']
const PUBLISHER_PANEL = 'cqai-publisher' as MainPanelId
type PublisherTab = 'publish' | 'history' | 'accounts'

function PublishIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/></svg>
}

function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const current = tabs.indexOf(event.target as HTMLButtonElement)
  if (current < 0) return
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
          : -1
  if (next < 0) return
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}

function PublisherPage() {
  const [tab, setTab] = useState<PublisherTab>('publish')
  const pageTitleRef = useRef<HTMLHeadingElement>(null)
  const [selectedContentId, setSelectedContentId] = useState(() => readPublisherHandoff()?.contentId)
  const [contentType, setContentType] = useState<PublisherContentType>(() => {
    const handoff = readPublisherHandoff()
    if (handoff) return handoff.contentType
    try {
      const saved = localStorage.getItem('cqai-publisher-content-type')
      return saved === 'article' || saved === 'image-note' || saved === 'video' ? saved : 'video'
    } catch { return 'video' }
  })
  const contentTypeRef = useRef(contentType)
  const handoffGenerationRef = useRef(0)
  contentTypeRef.current = contentType
  useEffect(() => subscribePublisherHandoff(handoff => {
    handoffGenerationRef.current += 1
    setTab('publish')
    contentTypeRef.current = handoff.contentType
    setContentType(handoff.contentType)
    setSelectedContentId(handoff.contentId)
    try { localStorage.setItem('cqai-publisher-content-type', handoff.contentType) } catch { /* optional preference */ }
  }), [])
  const chooseContentType = (value: PublisherContentType) => {
    if (value !== contentTypeRef.current) {
      handoffGenerationRef.current += 1
      setSelectedContentId(undefined)
      clearPublisherHandoff()
    }
    contentTypeRef.current = value
    setContentType(value)
    try { localStorage.setItem('cqai-publisher-content-type', value) } catch { /* optional preference */ }
  }
  const renderGeneration = handoffGenerationRef.current
  const selected = (type: 'article' | 'image-note', id?: string) => {
    if (type !== contentTypeRef.current || renderGeneration !== handoffGenerationRef.current) return
    setSelectedContentId(id)
    if (id) rememberPublisherHandoff({ contentId: id, contentType: type })
    else clearPublisherHandoff()
  }
  return <PublisherTipsProvider><section className="pub"><style>{css}</style><div className="pub-wrap">
    <header className="pub-head">
      <div><h1 ref={pageTitleRef} tabIndex={-1}>多平台发布</h1><div className="pub-muted">在 e宝工坊中编辑内容、选择账号并提交到本机发布队列。</div></div>
      <nav className="pub-page-nav" aria-label="多平台发布页面导航">
        {tab !== 'publish' && <button type="button" className="pub-page-link" aria-controls="pub-panel-publish" onClick={() => { setTab('publish'); pageTitleRef.current?.focus() }}>返回发布内容</button>}
        <button type="button" className="pub-page-link" aria-controls="pub-panel-history" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>发布历史</button>
        <button type="button" className="pub-page-link" aria-controls="pub-panel-accounts" aria-current={tab === 'accounts' ? 'page' : undefined} onClick={() => setTab('accounts')}>平台账号管理</button>
      </nav>
    </header>
    <div id="pub-panel-publish" hidden={tab !== 'publish'}><div className="pub-layout">
      <nav className="pub-type-nav" role="tablist" aria-label="内容类型" onKeyDown={handleTabKeyDown}>
        {([
          ['article', '文章'], ['image-note', '图文'], ['video', '视频'],
        ] as const).map(([value, label]) => <button className="pub-type" key={value} id={`pub-type-${value}`} role="tab" aria-controls={`pub-content-${value}`} aria-selected={contentType === value} tabIndex={contentType === value ? 0 : -1} onClick={() => chooseContentType(value)}>{label}</button>)}
      </nav>
      <div className="pub-content-panels">
        <div id="pub-content-article" role="tabpanel" aria-labelledby="pub-type-article" hidden={contentType !== 'article'}><ContentEditor contentType="article" active={tab === 'publish' && contentType === 'article'} selectedContentId={contentType === 'article' ? selectedContentId : undefined} onSelectedContentChange={id => selected('article', id)}/></div>
        <div id="pub-content-image-note" role="tabpanel" aria-labelledby="pub-type-image-note" hidden={contentType !== 'image-note'}><ContentEditor contentType="image-note" active={tab === 'publish' && contentType === 'image-note'} selectedContentId={contentType === 'image-note' ? selectedContentId : undefined} onSelectedContentChange={id => selected('image-note', id)}/></div>
        <div id="pub-content-video" role="tabpanel" aria-labelledby="pub-type-video" hidden={contentType !== 'video'}><VideoPage active={tab === 'publish' && contentType === 'video'}/></div>
      </div>
    </div></div>
    <div id="pub-panel-history" hidden={tab !== 'history'}><SubmissionHistory active={tab === 'history'}/></div>
    <div id="pub-panel-accounts" hidden={tab !== 'accounts'}><AccountsPage active={tab === 'accounts'}/></div>
  </div></section></PublisherTipsProvider>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PUBLISHER_PANEL }, PublisherPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PUBLISHER_PANEL, order: 42, label: '多平台发布' }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <PublishIcon size={size}/>))
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PREVIEW_ID,
    kind: PREVIEW_KIND,
    title: () => '预览',
  }), 'publisher: conversation preview tab')
  const openPreview = () => {
    // A fresh collapsed sidebar has no tabs yet. Keep the existing Files page
    // available beside the preview when the first draft opens the column.
    if (ctx.sidebarRight.active() === undefined) ctx.sidebarRight.openTab('files')
    ctx.sidebarRight.openTab(PREVIEW_KIND)
  }
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'cqai-publisher-preview', order: -5,
  }, (props: PropsRuntime<'conversation.session.header.utilities'>) => <ConversationPreviewAction {...props} openPreview={openPreview}/>))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PREVIEW_ID,
  }, (props: PropsRuntime<'sidebar.right.pane.tab'>) => <ConversationPreview {...props} onPublish={content => {
    if (content.contentType !== 'article' && content.contentType !== 'image-note') return
    requestPublisherHandoff({ contentId: content.id, contentType: content.contentType })
    ctx.layout.selectPanel(PUBLISHER_PANEL)
  }}/>))
}
