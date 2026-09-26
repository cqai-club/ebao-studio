import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Platform, PublisherContent, PublisherContentType } from '../protocol.ts'
import { AccountsPage } from './accounts.tsx'
import { ContentEditor } from './content.tsx'
import { ConversationPreview, ConversationPreviewAction, PREVIEW_ID, PREVIEW_KIND } from './conversation-preview.tsx'
import { DraftGallery } from './draft-gallery.tsx'
import { clearPublisherHandoff, readPublisherHandoff, requestPublisherHandoff, subscribePublisherHandoff } from './handoff.ts'
import { SubmissionHistory } from './history.tsx'
import { PublisherSettings } from './publisher-settings.tsx'
import { api, css, errorMessage, PublisherModal } from './shared.tsx'
import { PublisherTipsProvider } from './tips.tsx'
import { VideoPage } from './video.tsx'

export const inject = ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace']
const PUBLISHER_PANEL = 'cqai-publisher' as MainPanelId
const AGENT_DRAWER_EVENT = 'cqai-publisher-agent-drawer'
type PublisherTab = 'publish' | 'history' | 'accounts' | 'settings'
type AgentDrawerBinding = { contentId: string; sessionId: string; bindingToken: string; workspaceId: WorkspaceId }
type AgentDraftSession = { contentId: string; sessionId: string | null }

function requestAgentDrawer(open: boolean, contentId?: string) {
  window.dispatchEvent(new CustomEvent(AGENT_DRAWER_EVENT, { detail: { open, ...(contentId ? { contentId } : {}) } }))
}

function waitForArchiveSnapshot(workspaces: IWorkspaces): Promise<void> {
  if (workspaces.list.getSnapshot().phase === 'ready') return Promise.resolve()
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Agent 对话归档状态尚未就绪，请稍后重试'))
    }, 8000)
    const check = () => {
      if (workspaces.list.getSnapshot().phase !== 'ready') return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    }
    unsubscribe = workspaces.list.subscribe(check)
    check()
  })
}

function workspaceContainsSession(workspaces: IWorkspaces, sessionId: SessionId, workspaceId: WorkspaceId): boolean {
  return workspaces.list.getSnapshot().items.some(workspace => workspace.workspaceId === workspaceId
    && workspace.sessionIds.includes(sessionId))
}

function isMainSession(sessions: ISessions, sessionId: SessionId): boolean {
  return (sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0
}

function waitForWorkspaceSession(workspaces: IWorkspaces, workspaceId: WorkspaceId, sessionId: SessionId): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Agent 工作区尚未关联新对话，请稍后重试'))
    }, 8000)
    const check = () => {
      const workspace = workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (!workspace?.sessionIds.includes(sessionId)) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    }
    unsubscribe = workspaces.list.subscribe(check)
    check()
  })
}

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

function PublisherPage({ sessions, workspaces, uiWorkspace, layout }: { sessions: ISessions; workspaces: IWorkspaces; uiWorkspace: UiWorkspace; layout: ILayout }) {
  const [tab, setTab] = useState<PublisherTab>('publish')
  const pageTitleRef = useRef<HTMLHeadingElement>(null)
  const [editingIds, setEditingIds] = useState<Partial<Record<PublisherContentType, string>>>(() => {
    const handoff = readPublisherHandoff()
    return handoff ? { [handoff.contentType]: handoff.contentId } : {}
  })
  const [galleryRefresh, setGalleryRefresh] = useState<Record<PublisherContentType, number>>({ article: 0, 'image-note': 0, video: 0 })
  const [galleryBusy, setGalleryBusy] = useState(false)
  const galleryBusyRef = useRef(false)
  const [galleryError, setGalleryError] = useState<{ contentType: PublisherContentType; message: string }>()
  const [deleteTarget, setDeleteTarget] = useState<{ contentType: PublisherContentType; id: string }>()
  const [deleteError, setDeleteError] = useState('')
  const [agentDrawer, setAgentDrawer] = useState<AgentDrawerBinding>()
  const agentDrawerRef = useRef<AgentDrawerBinding>()
  const agentRequestGenerationRef = useRef(0)
  const activeArticleIdRef = useRef<string>()
  const [agentAvailable, setAgentAvailable] = useState(false)
  const [agentError, setAgentError] = useState('')
  useEffect(() => {
    setAgentAvailable(Boolean(document.querySelector(
      '.dshDesktopFrame[data-desktop-mode="extended"], .dshDesktopFrame[data-desktop-mode="advanced"]',
    )))
  }, [])
  const closeAgent = useCallback(async (broadcast = true) => {
    agentRequestGenerationRef.current += 1
    const open = agentDrawerRef.current
    agentDrawerRef.current = undefined
    setAgentDrawer(undefined)
    if (broadcast) requestAgentDrawer(false)
    if (!open) return
    try { await api('agent-draft-bind', { sessionId: open.sessionId, contentId: null, bindingToken: open.bindingToken }) }
    catch (cause) {
      if (!agentDrawerRef.current) setAgentError(`无法解除 Agent 与草稿的关联：${errorMessage(cause)}`)
    }
  }, [])
  useEffect(() => {
    const onDrawerEvent = (event: Event) => {
      if ((event as CustomEvent<{ open?: boolean }>).detail?.open === false) void closeAgent(false)
    }
    window.addEventListener(AGENT_DRAWER_EVENT, onDrawerEvent)
    return () => { window.removeEventListener(AGENT_DRAWER_EVENT, onDrawerEvent) }
  }, [closeAgent])
  useEffect(() => () => {
    agentRequestGenerationRef.current += 1
    const open = agentDrawerRef.current
    if (!open) return
    agentDrawerRef.current = undefined
    requestAgentDrawer(false)
    void api('agent-draft-bind', { sessionId: open.sessionId, contentId: null, bindingToken: open.bindingToken }).catch(() => {})
  }, [])
  useEffect(() => sessions.list.subscribe(() => {
    const open = agentDrawerRef.current
    if (!open) return
    const list = sessions.list.getSnapshot()
    if (!isMainSession(sessions, open.sessionId as SessionId)
      || (list.phase === 'ready' && !list.ids.includes(open.sessionId as SessionId))) void closeAgent()
  }), [sessions, closeAgent])
  useEffect(() => workspaces.list.subscribe(() => {
    const open = agentDrawerRef.current
    if (!open) return
    const snapshot = workspaces.list.getSnapshot()
    if (snapshot.archivedSessionIds.includes(open.sessionId as SessionId)
      || (snapshot.phase === 'ready' && !workspaceContainsSession(workspaces, open.sessionId as SessionId, open.workspaceId))) void closeAgent()
  }), [workspaces, closeAgent])
  const [intendedPlatforms, setIntendedPlatforms] = useState<{ contentId: string; platforms: Platform[] } | undefined>(() => {
    const handoff = readPublisherHandoff()
    return handoff?.platforms ? { contentId: handoff.contentId, platforms: handoff.platforms } : undefined
  })
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
  activeArticleIdRef.current = tab === 'publish' && contentType === 'article' ? editingIds.article : undefined
  useEffect(() => {
    const open = agentDrawerRef.current
    if (open && (tab !== 'publish' || contentType !== 'article' || editingIds.article !== open.contentId)) void closeAgent()
  }, [tab, contentType, editingIds.article, closeAgent])
  const toggleAgent = async (content: PublisherContent) => {
    if (content.contentType !== 'article') throw new Error('Agent 对话仅支持文章草稿')
    if (!agentAvailable) throw new Error('Agent 抽屉需要 Desktop 扩展布局')
    if (agentDrawerRef.current?.contentId === content.id) {
      await closeAgent()
      return
    }
    if (agentDrawerRef.current) await closeAgent()
    const generation = ++agentRequestGenerationRef.current
    const stillCurrent = () => generation === agentRequestGenerationRef.current && activeArticleIdRef.current === content.id
    setAgentError('')
    const { path } = await api<{ path: string }>('agent-workspace', { contentId: content.id })
    if (!stillCurrent()) return
    const workspace = await workspaces.create({ path })
    if (!stillCurrent()) return
    const linked = await api<AgentDraftSession>(`agent-draft-session/${content.id}`)
    if (!stillCurrent()) return
    let sessionId = linked.sessionId as SessionId | null
    if (sessionId) {
      await sessions.refresh()
      if (!stillCurrent()) return
      await waitForArchiveSnapshot(workspaces)
      if (!stillCurrent()) return
      const list = sessions.list.getSnapshot()
      if (list.phase !== 'ready') throw new Error('Agent 对话列表尚未就绪，请稍后重试')
      const summary = list.byId[sessionId]
      const archive = workspaces.list.getSnapshot()
      if (!list.ids.includes(sessionId) || !summary || summary.parentId || summary.origin === 'subagent'
        || archive.archivedSessionIds.includes(sessionId)
        || !workspaceContainsSession(workspaces, sessionId, workspace.workspaceId)) sessionId = null
    }
    if (!sessionId) {
      sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
      if (!stillCurrent()) return
      await waitForWorkspaceSession(workspaces, workspace.workspaceId, sessionId)
    }
    if (!stillCurrent()) return
    uiWorkspace.openSession(sessionId)
    // The conversation in the Agent drawer reads the selected Session, but
    // openSession also reveals the ordinary Conversation as the main panel.
    layout.selectPanel(PUBLISHER_PANEL)
    const binding = await api<Omit<AgentDrawerBinding, 'workspaceId'>>('agent-draft-bind', { sessionId, contentId: content.id })
    if (!stillCurrent() || !isMainSession(sessions, sessionId)) {
      await api('agent-draft-bind', { sessionId, contentId: null, bindingToken: binding.bindingToken })
      return
    }
    agentDrawerRef.current = { ...binding, workspaceId: workspace.workspaceId }
    setAgentDrawer(agentDrawerRef.current)
    requestAgentDrawer(true, content.id)
  }
  useEffect(() => subscribePublisherHandoff(handoff => {
    agentRequestGenerationRef.current += 1
    handoffGenerationRef.current += 1
    setTab('publish')
    contentTypeRef.current = handoff.contentType
    setContentType(handoff.contentType)
    setEditingIds(current => ({ ...current, [handoff.contentType]: handoff.contentId }))
    setIntendedPlatforms(handoff.platforms ? { contentId: handoff.contentId, platforms: handoff.platforms } : undefined)
    try { localStorage.setItem('cqai-publisher-content-type', handoff.contentType) } catch { /* optional preference */ }
  }), [])
  const chooseContentType = (value: PublisherContentType) => {
    if (value !== contentTypeRef.current) {
      agentRequestGenerationRef.current += 1
      clearPublisherHandoff()
    }
    contentTypeRef.current = value
    setContentType(value)
    setGalleryError(undefined)
    try { localStorage.setItem('cqai-publisher-content-type', value) } catch { /* optional preference */ }
  }
  const renderGeneration = handoffGenerationRef.current
  const selected = (type: 'article' | 'image-note', id?: string) => {
    if (renderGeneration !== handoffGenerationRef.current) return
    agentRequestGenerationRef.current += 1
    setEditingIds(current => ({ ...current, [type]: id }))
    if (intendedPlatforms && intendedPlatforms.contentId !== id) setIntendedPlatforms(undefined)
    const handoff = readPublisherHandoff()
    if (handoff?.contentType === type && handoff.contentId !== id) clearPublisherHandoff()
  }
  const returnToGallery = (type: PublisherContentType) => {
    agentRequestGenerationRef.current += 1
    const id = editingIds[type]
    setEditingIds(current => ({ ...current, [type]: undefined }))
    setGalleryRefresh(current => ({ ...current, [type]: current[type] + 1 }))
    if (intendedPlatforms?.contentId === id) setIntendedPlatforms(undefined)
    const handoff = readPublisherHandoff()
    if (handoff?.contentType === type && handoff.contentId === id) clearPublisherHandoff()
  }
  const runGalleryAction = async (type: PublisherContentType, task: () => Promise<void>) => {
    if (galleryBusyRef.current) return
    galleryBusyRef.current = true
    setGalleryBusy(true)
    setGalleryError(undefined)
    try { await task() } catch (cause) { setGalleryError({ contentType: type, message: errorMessage(cause) }) }
    finally { galleryBusyRef.current = false; setGalleryBusy(false) }
  }
  const createDraft = (type: PublisherContentType) => void runGalleryAction(type, async () => {
    const created = await api<PublisherContent>('contents', { contentType: type })
    setEditingIds(current => ({ ...current, [type]: created.id }))
  })
  const copyDraft = (type: PublisherContentType, id: string) => void runGalleryAction(type, async () => {
    const copy = await api<PublisherContent>('content-copy', { id })
    if (copy.contentType !== type) throw new Error('草稿内容类型不匹配')
    setEditingIds(current => ({ ...current, [type]: copy.id }))
  })
  const confirmDelete = () => {
    if (!deleteTarget) return
    const { contentType: type, id } = deleteTarget
    void runGalleryAction(type, async () => {
      try { await api('content-delete', { id }) }
      catch (cause) { setDeleteError(errorMessage(cause)); throw cause }
      setDeleteTarget(undefined)
      setDeleteError('')
      setGalleryRefresh(current => ({ ...current, [type]: current[type] + 1 }))
    })
  }
  const renderTypePanel = (type: PublisherContentType) => {
    const editingId = editingIds[type]
    const active = tab === 'publish' && contentType === type
    return <>
      <div hidden={!!editingId}>
        {galleryError?.contentType === type && active && <div className="pub-error" role="alert">{galleryError.message}</div>}
        <DraftGallery contentType={type} active={active && !editingId} busy={galleryBusy}
          refreshKey={galleryRefresh[type]} onOpen={id => { setGalleryError(undefined); setEditingIds(current => ({ ...current, [type]: id })) }}
          onCreate={() => createDraft(type)} onCopy={id => copyDraft(type, id)}
          onDelete={id => { setGalleryError(undefined); setDeleteError(''); setDeleteTarget({ contentType: type, id }) }}/>
      </div>
      {type === 'article' && agentError && <div className="pub-error" role="alert">{agentError}</div>}
      {editingId && (type === 'video'
        ? <VideoPage active={active} selectedContentId={editingId}
            onSelectedContentChange={id => setEditingIds(current => ({ ...current, video: id }))}
            onBack={() => returnToGallery(type)}/>
        : <ContentEditor contentType={type} active={active} selectedContentId={editingId}
            intendedPlatforms={intendedPlatforms?.contentId === editingId ? intendedPlatforms.platforms : undefined}
            handoffGeneration={handoffGenerationRef.current}
            agentOpen={type === 'article' && agentDrawer?.contentId === editingId}
            onToggleAgent={type === 'article' && agentAvailable ? toggleAgent : undefined}
            onSelectedContentChange={id => selected(type, id)} onBack={() => returnToGallery(type)}/>)}
    </>
  }
  return <PublisherTipsProvider><section className="pub"><style>{css}</style><div className="pub-wrap">
    <header className="pub-head">
      <div><h2 ref={pageTitleRef} tabIndex={-1}>多平台发布</h2></div>
      <nav className="pub-page-nav" aria-label="多平台发布页面导航">
        {tab !== 'publish' && <button type="button" className="pub-page-link" aria-controls="pub-panel-publish" onClick={() => { agentRequestGenerationRef.current += 1; setTab('publish'); pageTitleRef.current?.focus() }}>返回发布内容</button>}
        <button type="button" className="pub-page-link" aria-controls="pub-panel-history" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => { agentRequestGenerationRef.current += 1; setTab('history') }}>发布历史</button>
        <button type="button" className="pub-page-link" aria-controls="pub-panel-accounts" aria-current={tab === 'accounts' ? 'page' : undefined} onClick={() => { agentRequestGenerationRef.current += 1; setTab('accounts') }}>平台账号管理</button>
        <button type="button" className="pub-page-link" aria-controls="pub-panel-settings" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => { agentRequestGenerationRef.current += 1; setTab('settings') }}>设置</button>
      </nav>
    </header>
    <div id="pub-panel-publish" hidden={tab !== 'publish'}><div className="pub-layout">
      <nav className="pub-type-nav" role="tablist" aria-label="内容类型" onKeyDown={handleTabKeyDown}>
        {([
          ['article', '文章'], ['image-note', '图文'], ['video', '视频'],
        ] as const).map(([value, label]) => <button className="pub-type" key={value} id={`pub-type-${value}`} role="tab" aria-controls={`pub-content-${value}`} aria-selected={contentType === value} tabIndex={contentType === value ? 0 : -1} onClick={() => chooseContentType(value)}>{label}</button>)}
      </nav>
      <div className="pub-content-panels">
        <div id="pub-content-article" role="tabpanel" aria-labelledby="pub-type-article" hidden={contentType !== 'article'}>{renderTypePanel('article')}</div>
        <div id="pub-content-image-note" role="tabpanel" aria-labelledby="pub-type-image-note" hidden={contentType !== 'image-note'}>{renderTypePanel('image-note')}</div>
        <div id="pub-content-video" role="tabpanel" aria-labelledby="pub-type-video" hidden={contentType !== 'video'}>{renderTypePanel('video')}</div>
      </div>
    </div></div>
    <div id="pub-panel-history" hidden={tab !== 'history'}><SubmissionHistory active={tab === 'history'}/></div>
    <div id="pub-panel-accounts" hidden={tab !== 'accounts'}><AccountsPage active={tab === 'accounts'}/></div>
    <div id="pub-panel-settings" hidden={tab !== 'settings'}>{tab === 'settings' && <PublisherSettings/>}</div>
    <PublisherModal open={deleteTarget !== undefined} title="删除本地草稿" closeLabel="关闭删除草稿确认"
      description={deleteError ? `删除失败：${deleteError}` : '删除这份本地草稿？已提交的内容快照不受影响。'} className="pub-modal"
      onClose={() => { if (!galleryBusyRef.current) { setDeleteTarget(undefined); setDeleteError('') } }}
      footer={<><Button size="sm" variant="outline" data-pub-initial-focus disabled={galleryBusy} onClick={() => { setDeleteTarget(undefined); setDeleteError('') }}>取消</Button>
        <Button size="sm" variant="outline" className="pub-danger-action" disabled={galleryBusy} onClick={confirmDelete}>{galleryBusy ? '正在删除…' : '删除草稿'}</Button></>}/>
  </div></section></PublisherTipsProvider>
}

export function apply(ctx: Context): void {
  // This package also builds its Host entry, whose `sessions` property is a
  // different service. The client injection above guarantees this face here.
  const { sessions, workspaces, uiWorkspace } = ctx as unknown as { sessions: ISessions; workspaces: IWorkspaces; uiWorkspace: UiWorkspace }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PUBLISHER_PANEL }, () => <PublisherPage sessions={sessions} workspaces={workspaces} uiWorkspace={uiWorkspace} layout={ctx.layout}/>))
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
  }, (props: PropsRuntime<'sidebar.right.pane.tab'>) => <ConversationPreview {...props} onOpenPublisher={() => ctx.layout.selectPanel(PUBLISHER_PANEL)} onPublish={(preparation, platforms) => {
    if (preparation.contentType !== 'article' && preparation.contentType !== 'image-note') return
    // The source preview opens a persisted preparation before this handoff.
    requestPublisherHandoff({ contentId: preparation.id, contentType: preparation.contentType, ...(platforms ? { platforms } : {}) })
    ctx.layout.selectPanel(PUBLISHER_PANEL)
  }}/>))
}
