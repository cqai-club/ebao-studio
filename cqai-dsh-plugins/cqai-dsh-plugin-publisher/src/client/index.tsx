import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import pluginIcon from '../../assets/plugin-icon.svg'
import type { Platform, PublisherContent, PublisherContentType } from '../protocol.ts'
import { AccountsPage } from './accounts.tsx'
import { registerPublisherWorkspaceVisibility, refreshPublisherWorkspaceVisibility } from './internal-workspace-visibility.tsx'
import { ArticleHandoffToolView, ArticleHandoffTurnTail, watchAutomaticPublisherHandoffs } from './article-handoff-card.tsx'
import type { PublisherArticleHandoff, PublisherArticleHandoffResult } from '../article-handoff-protocol.ts'
import type { PublisherDelegation } from '../publisher-delegation-protocol.ts'
import { registerPublisherNewConversationGuard } from './internal-workspace-navigation.ts'
import { PUBLISHER_AGENT_SLOT, PUBLISHER_AGENT_REFERENCE_SOURCE, registerPublisherAgent, type PublisherAgentRenderProps } from './agent-panel.tsx'
import { agentSplitterCss, PublisherAgentSplitter, usePublisherAgentResize } from './agent-splitter.tsx'
import { AgentPublicationToolView } from './agent-publication-card.tsx'
import { AgentPublicationTurnTail } from './agent-publication-turn-tail.tsx'
import { ContentEditor } from './content.tsx'
import type { PublisherEditorTarget } from './content-patch.ts'
import { CreateDraftDialog } from './create-draft-dialog.tsx'
import { ConversationPreview, ConversationPreviewAction, PREVIEW_ID, PREVIEW_KIND } from './conversation-preview.tsx'
import { DraftGallery } from './draft-gallery.tsx'
import { clearPublisherHandoff, readPublisherHandoff, requestPublisherHandoff, subscribePublisherHandoff } from './handoff.ts'
import { SubmissionHistory } from './history.tsx'
import { PublisherSettings } from './publisher-settings.tsx'
import { WritingProfileDialog } from './writing-profile-dialog.tsx'
import { api, css, errorMessage, PublisherModal } from './shared.tsx'
import { PublisherTipsProvider } from './tips.tsx'
import { watchPublisherSession } from './session-navigation.ts'
import { VideoPage } from './video.tsx'

export const inject = ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace']
const PUBLISHER_PANEL = 'cqai-publisher' as MainPanelId
type PublisherTab = 'publish' | 'trash' | 'history' | 'accounts' | 'settings'
type AgentDrawerBinding = { contentId: string; contentType: PublisherContentType; sessionId: string; bindingToken: string; workspaceId: WorkspaceId; target: PublisherEditorTarget; reference: SessionReference }
type AgentDraftSession = { contentId: string; sessionId: string; workspaceId: WorkspaceId; path: string }


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

function isPublisherSession(sessions: ISessions, sessionId: SessionId): boolean {
  return (sessions.retainInfo(sessionId).getSnapshot().retainedBy[PUBLISHER_AGENT_REFERENCE_SOURCE] ?? 0) > 0
}

/** Keep a Publisher-owned archive from revealing the ordinary Conversation. */
async function keepPublisherDuringArchive<T>(layout: ILayout, workspaces: IWorkspaces, sessionId: string | undefined, operation: () => Promise<T>): Promise<T> {
  if (!sessionId || layout.panelInfo.getSnapshot().activePanelId !== PUBLISHER_PANEL) return operation()
  let preserve = true
  const unsubscribe = layout.panelInfo.subscribe(() => {
    if (!preserve) return
    const panel = layout.panelInfo.getSnapshot().activePanelId
    if (panel === PUBLISHER_PANEL) return
    if (panel === null && workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId as SessionId)) {
      // uiWorkspace clears an archived current Session and selects null in
      // the same synchronous notification. Restore before React unmounts us.
      preserve = false
      layout.selectPanel(PUBLISHER_PANEL)
    } else preserve = false // A user navigation supersedes this operation.
  })
  try { return await operation() } finally { unsubscribe() }
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
  return <img className="cqai-plugin-panel-icon" src={pluginIcon} width={size} height={size} alt="" draggable={false} />
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

function PublisherPage({ sessions, workspaces, layout, uiWorkspace, agentRenderer }: { sessions: ISessions; workspaces: IWorkspaces; layout: ILayout; uiWorkspace: UiWorkspace; agentRenderer: PublisherAgentRenderProps }) {
  const surfaceRef = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<PublisherTab>('publish')
  const [writingProfileOpen, setWritingProfileOpen] = useState(false)
  const settingsDirtyRef = useRef(false)
  const settingsBusyRef = useRef(false)
  const [pendingSettingsNavigation, setPendingSettingsNavigation] = useState<(() => void)>()
  const markSettingsDirty = useCallback((dirty: boolean) => { settingsDirtyRef.current = dirty }, [])
  const markSettingsBusy = useCallback((busy: boolean) => { settingsBusyRef.current = busy }, [])
  const pageTitleRef = useRef<HTMLHeadingElement>(null)
  const [editingIds, setEditingIds] = useState<Partial<Record<PublisherContentType, string>>>(() => {
    const handoff = readPublisherHandoff()
    return handoff ? { [handoff.contentType]: handoff.contentId } : {}
  })
  const [galleryRefresh, setGalleryRefresh] = useState<Record<PublisherContentType, number>>({ article: 0, 'image-note': 0, video: 0 })
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'publish'>(() => readPublisherHandoff()?.initialMode ?? 'edit')
  const [galleryBusy, setGalleryBusy] = useState(false)
  const galleryBusyRef = useRef(false)
  const [galleryError, setGalleryError] = useState<{ contentType: PublisherContentType; message: string }>()
  const [createTarget, setCreateTarget] = useState<PublisherContentType>()
  const [deleteTarget, setDeleteTarget] = useState<{ contentType: PublisherContentType; id: string }>()
  const [deleteError, setDeleteError] = useState('')
  const [agentDrawer, setAgentDrawer] = useState<AgentDrawerBinding>()
  const agentDrawerRef = useRef<AgentDrawerBinding>()
  const retiredAgentReferences = useRef(new Set<SessionReference>())
  const [retireRevision, setRetireRevision] = useState(0)
  const pendingAgentReferenceRef = useRef<SessionReference>()
  const agentRequestGenerationRef = useRef(0)
  const activeContentRef = useRef<{ id: string; type: PublisherContentType }>()
  const releasePendingAgent = () => {
    pendingAgentReferenceRef.current?.release()
    pendingAgentReferenceRef.current = undefined
  }
  const navigatePage = (next: PublisherTab) => {
    if (tab === next || settingsBusyRef.current) return
    const navigate = () => {
      settingsDirtyRef.current = false
      releasePendingAgent()
      agentRequestGenerationRef.current += 1
      setTab(next)
      if (next === 'publish') pageTitleRef.current?.focus()
    }
    if (tab === 'settings' && settingsDirtyRef.current) setPendingSettingsNavigation(() => navigate)
    else navigate()
  }
  const [agentError, setAgentError] = useState('')
  const autoOpenedRef = useRef<string>()
  const agentTargetsRef = useRef<Record<string, PublisherEditorTarget>>({})
  const agentSessionIdsRef = useRef<Record<string, string>>({})
  const delegationStarts = useRef(new Set<string>())
  const closeAgent = useCallback(async () => {
    agentRequestGenerationRef.current += 1
    pendingAgentReferenceRef.current?.release()
    pendingAgentReferenceRef.current = undefined
    const open = agentDrawerRef.current
    agentDrawerRef.current = undefined
    if (open) retiredAgentReferences.current.add(open.reference)
    setAgentDrawer(undefined)
    if (!open) return
    setRetireRevision(value => value + 1)
    try { await api('agent-draft-bind', { sessionId: open.sessionId, contentId: null, bindingToken: open.bindingToken }) }
    catch (cause) {
      if (!agentDrawerRef.current) setAgentError(`无法解除 Agent 与草稿的关联：${errorMessage(cause)}`)
    }
  }, [])
  useEffect(() => {
    // SessionProvider reads reference.binding during rendering. Release only
    // after React has committed the removal of its previous Provider.
    for (const reference of retiredAgentReferences.current) {
      if (reference === agentDrawer?.reference) continue
      retiredAgentReferences.current.delete(reference)
      reference.release()
    }
  }, [agentDrawer, retireRevision])
  const returnToSource = async (sessionId: string, navigation = layout.beginNavigation()) => {
    const selected = activeContentRef.current?.id
    if (!selected || navigation.aborted) return
    const origin = await api<(PublisherArticleHandoff & { sourceSessionAvailable: boolean }) | null>(`article-origin/${selected}`)
    if (navigation.aborted || selected !== activeContentRef.current?.id) return
    if (!origin || origin.source.sessionId !== sessionId || !origin.sourceSessionAvailable) throw new Error('来源对话已删除或归档，发布草稿仍可继续编辑')
    await closeAgent()
    if (!navigation.aborted && selected === activeContentRef.current?.id) uiWorkspace.openSession(sessionId as SessionId)
  }
  useEffect(() => () => {
    agentRequestGenerationRef.current += 1
    pendingAgentReferenceRef.current?.release()
    pendingAgentReferenceRef.current = undefined
    const open = agentDrawerRef.current
    agentDrawerRef.current = undefined
    for (const reference of retiredAgentReferences.current) reference.release()
    retiredAgentReferences.current.clear()
    if (!open) return
    open.reference.release()
    void api('agent-draft-bind', { sessionId: open.sessionId, contentId: null, bindingToken: open.bindingToken }).catch(() => {})
  }, [])
  useEffect(() => sessions.list.subscribe(() => {
    const open = agentDrawerRef.current
    if (!open) return
    const list = sessions.list.getSnapshot()
    if (!isPublisherSession(sessions, open.sessionId as SessionId)
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
  activeContentRef.current = tab === 'publish' && editingIds[contentType]
    ? { id: editingIds[contentType], type: contentType } : undefined
  useEffect(() => {
    const open = agentDrawerRef.current
    if (open && (tab !== 'publish' || contentType !== open.contentType || editingIds[contentType] !== open.contentId)) void closeAgent()
  }, [tab, contentType, editingIds, closeAgent])
  const startPublisherDelegation = async (content: PublisherContent, bound: AgentDrawerBinding) => {
    const current = () => agentDrawerRef.current?.bindingToken === bound.bindingToken
      && agentDrawerRef.current?.sessionId === bound.sessionId && activeContentRef.current?.id === content.id
      && agentDrawerRef.current?.target.kind === 'main'
    if (!current()) return
    try {
      const task = await api<PublisherDelegation | null>(`publisher-delegation-for-content/${encodeURIComponent(content.id)}`)
      if (!current() || !task || task.status !== 'queued' || task.contentId !== content.id
        || task.publisherSessionId !== bound.sessionId || delegationStarts.current.has(task.taskId)) return
      delegationStarts.current.add(task.taskId)
      try {
        await api('publisher-delegation-start', { taskId: task.taskId, sessionId: bound.sessionId, bindingToken: bound.bindingToken,
          ...(typeof content.revision === 'number' ? { expectedContentRevision: content.revision } : {}) })
      } catch (cause) { delegationStarts.current.delete(task.taskId); throw cause }
    } catch (cause) {
      if (current()) setAgentError(`发布任务暂时无法开始：${errorMessage(cause)}。稿件和当前对话会保留。`)
    }
  }
  const openAgent = async (content: PublisherContent, requestedTarget?: PublisherEditorTarget) => {
    if (content.contentType !== contentType) throw new Error('当前草稿内容类型不匹配')
    if (requestedTarget) agentTargetsRef.current[content.id] = requestedTarget
    if (agentDrawerRef.current?.contentId === content.id && agentDrawerRef.current.contentType === content.contentType) {
      const desired = agentTargetsRef.current[content.id] ?? agentDrawerRef.current.target
      if (JSON.stringify(desired) !== JSON.stringify(agentDrawerRef.current.target)) await changeAgentTarget(content, desired)
      return
    }
    if (agentDrawerRef.current || pendingAgentReferenceRef.current) await closeAgent()
    const generation = ++agentRequestGenerationRef.current
    const stillCurrent = () => generation === agentRequestGenerationRef.current
      && activeContentRef.current?.id === content.id && activeContentRef.current.type === content.contentType
    setAgentError('')
    const linked = await api<AgentDraftSession>('agent-draft-session', { contentId: content.id })
    void refreshPublisherWorkspaceVisibility()
    if (!stillCurrent()) return
    const sessionId = linked.sessionId as SessionId
    agentSessionIdsRef.current[content.id] = sessionId
    await sessions.refresh()
    if (!stillCurrent()) return
    await waitForArchiveSnapshot(workspaces)
    if (!stillCurrent()) return
    await waitForWorkspaceSession(workspaces, linked.workspaceId, sessionId)
    if (!stillCurrent()) return
    const reference = sessions.retain(sessionId, { source: PUBLISHER_AGENT_REFERENCE_SOURCE })
    pendingAgentReferenceRef.current = reference
    let installed = false
    try {
      await reference.ready
      if (!stillCurrent()) return
      let target = agentTargetsRef.current[content.id] ?? { kind: 'main' }
      let binding: Pick<AgentDrawerBinding, 'contentId' | 'sessionId' | 'bindingToken'>
      // A platform can change while the first binding is still in flight.
      for (;;) {
        binding = await api('agent-draft-bind', { sessionId, contentId: content.id, target })
        if (!stillCurrent() || !isPublisherSession(sessions, sessionId)) {
          await api('agent-draft-bind', { sessionId, contentId: null, bindingToken: binding.bindingToken })
          return
        }
        const desired = agentTargetsRef.current[content.id] ?? { kind: 'main' }
        if (JSON.stringify(desired) === JSON.stringify(target)) break
        await api('agent-draft-bind', { sessionId, contentId: null, bindingToken: binding.bindingToken })
        if (!stillCurrent()) return
        target = desired
      }
      agentDrawerRef.current = { ...binding, contentType: content.contentType, workspaceId: linked.workspaceId, target, reference }
      installed = true
      setAgentDrawer(agentDrawerRef.current)
      void startPublisherDelegation(content, agentDrawerRef.current)
    } catch (cause) {
      if (stillCurrent()) throw cause
    } finally {
      if (pendingAgentReferenceRef.current === reference) pendingAgentReferenceRef.current = undefined
      if (!installed) reference.release()
    }
  }
  const toggleAgent = async (content: PublisherContent, target?: PublisherEditorTarget) => {
    if (agentDrawerRef.current?.contentId === content.id) await closeAgent()
    else await openAgent(content, target)
  }
  const draftReady = (content: PublisherContent, target: PublisherEditorTarget = { kind: 'main' }) => {
    if (activeContentRef.current?.id !== content.id || autoOpenedRef.current === content.id) return
    autoOpenedRef.current = content.id
    agentTargetsRef.current[content.id] = target
    void openAgent(content).catch(cause => setAgentError(`Agent 对话暂时无法打开：${errorMessage(cause)}。可使用“Agent 辅助编辑”重试。`))
  }
  const changeAgentTarget = async (content: PublisherContent, target: PublisherEditorTarget) => {
    agentTargetsRef.current[content.id] = target
    const open = agentDrawerRef.current
    if (!open || open.contentId !== content.id || JSON.stringify(open.target) === JSON.stringify(target)) return
    const generation = ++agentRequestGenerationRef.current
    const binding = await api<Pick<AgentDrawerBinding, 'contentId' | 'sessionId' | 'bindingToken'>>('agent-draft-bind', { sessionId: open.sessionId, contentId: content.id, target })
    if (generation !== agentRequestGenerationRef.current || agentDrawerRef.current?.contentId !== content.id) {
      await api('agent-draft-bind', { sessionId: open.sessionId, contentId: null, bindingToken: binding.bindingToken })
      return
    }
    agentDrawerRef.current = { ...open, ...binding, target }
    setAgentDrawer(agentDrawerRef.current)
    if (target.kind === 'main') void startPublisherDelegation(content, agentDrawerRef.current)
  }
  const restartAgent = async (content: PublisherContent, target?: PublisherEditorTarget) => {
    const sessionId = agentSessionIdsRef.current[content.id]
    await closeAgent()
    await keepPublisherDuringArchive(layout, workspaces, sessionId, () => api('agent-draft-session-delete', { contentId: content.id }))
    await openAgent(content, target)
  }
  const deleteEditorContent = async (id: string) => {
    const sessionId = agentSessionIdsRef.current[id]
    await closeAgent()
    await keepPublisherDuringArchive(layout, workspaces, sessionId, () => api('content-delete', { id }))
  }
  useEffect(() => subscribePublisherHandoff(handoff => {
    releasePendingAgent()
    agentRequestGenerationRef.current += 1
    handoffGenerationRef.current += 1
    autoOpenedRef.current = undefined
    setTab('publish')
    setEditorMode(handoff.initialMode ?? 'edit')
    contentTypeRef.current = handoff.contentType
    setContentType(handoff.contentType)
    setEditingIds(current => ({ ...current, [handoff.contentType]: handoff.contentId }))
    setIntendedPlatforms(handoff.platforms ? { contentId: handoff.contentId, platforms: handoff.platforms } : undefined)
    try { localStorage.setItem('cqai-publisher-content-type', handoff.contentType) } catch { /* optional preference */ }
  }), [])
  const chooseContentType = (value: PublisherContentType) => {
    if (value !== contentTypeRef.current) {
      releasePendingAgent()
      agentRequestGenerationRef.current += 1
      clearPublisherHandoff()
    }
    contentTypeRef.current = value
    setContentType(value)
    setGalleryError(undefined)
    try { localStorage.setItem('cqai-publisher-content-type', value) } catch { /* optional preference */ }
  }
  const renderGeneration = handoffGenerationRef.current
  const selected = (type: PublisherContentType, id?: string) => {
    if (renderGeneration !== handoffGenerationRef.current) return
    releasePendingAgent()
    agentRequestGenerationRef.current += 1
    autoOpenedRef.current = undefined
    setEditorMode('edit')
    setEditingIds(current => ({ ...current, [type]: id }))
    if (intendedPlatforms && intendedPlatforms.contentId !== id) setIntendedPlatforms(undefined)
    const handoff = readPublisherHandoff()
    if (handoff?.contentType === type && handoff.contentId !== id) clearPublisherHandoff()
  }
  const returnToGallery = (type: PublisherContentType) => {
    releasePendingAgent()
    agentRequestGenerationRef.current += 1
    autoOpenedRef.current = undefined
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
  const createDraft = (type: PublisherContentType) => {
    if (galleryBusyRef.current) return
    setGalleryError(undefined)
    setCreateTarget(type)
  }
  const copyDraft = (type: PublisherContentType, id: string) => void runGalleryAction(type, async () => {
    const copy = await api<PublisherContent>('content-copy', { id })
    if (copy.contentType !== type) throw new Error('草稿内容类型不匹配')
    autoOpenedRef.current = undefined
    setEditorMode('edit')
    setEditingIds(current => ({ ...current, [type]: copy.id }))
  })
  const restoreDraft = (type: PublisherContentType, id: string) => void runGalleryAction(type, async () => {
    try { await api<PublisherContent>('content-restore', { id }) }
    finally { setGalleryRefresh(current => ({ ...current, [type]: current[type] + 1 })) }
  })
  const retryTrashDeletion = (type: PublisherContentType, id: string) => void runGalleryAction(type, async () => {
    try { await deleteEditorContent(id) }
    finally { setGalleryRefresh(current => ({ ...current, [type]: current[type] + 1 })) }
  })
  const confirmDelete = () => {
    if (!deleteTarget) return
    const { contentType: type, id } = deleteTarget
    void runGalleryAction(type, async () => {
      try { await deleteEditorContent(id) }
      catch (cause) {
        setDeleteError(errorMessage(cause))
        setGalleryRefresh(current => ({ ...current, [type]: current[type] + 1 }))
        throw cause
      }
      setDeleteTarget(undefined)
      setDeleteError('')
      setGalleryRefresh(current => ({ ...current, [type]: current[type] + 1 }))
    })
  }
  const renderTypePanel = (type: PublisherContentType) => {
    const editingId = editingIds[type]
    const active = tab === 'publish' && contentType === type
    const openEditor = (id: string, mode: 'edit' | 'preview' | 'publish') => {
      autoOpenedRef.current = undefined
      setGalleryError(undefined)
      setEditorMode(mode)
      setEditingIds(current => ({ ...current, [type]: id }))
    }
    return <>
      <div hidden={!!editingId}>
        {galleryError?.contentType === type && active && <div className="pub-error" role="alert">{galleryError.message}</div>}
        <DraftGallery contentType={type} active={active && !editingId} busy={galleryBusy}
          refreshKey={galleryRefresh[type]} onOpen={id => openEditor(id, 'edit')} onPreview={id => openEditor(id, 'preview')} onPublish={id => openEditor(id, 'publish')}
          onCreate={() => createDraft(type)} onCopy={id => copyDraft(type, id)}
          onDelete={id => { setGalleryError(undefined); setDeleteError(''); setDeleteTarget({ contentType: type, id }) }}/>
      </div>
      {type === contentType && agentError && <div className="pub-error" role="alert">{agentError}</div>}
      {editingId && (type === 'video'
        ? <VideoPage active={active} selectedContentId={editingId} initialMode={editorMode}
            agentOpen={agentDrawer?.contentId === editingId && agentDrawer.contentType === type}
            onToggleAgent={toggleAgent}
            onDraftReady={draftReady} onRestartAgent={restartAgent}
            onDeleteContent={deleteEditorContent}
            onOpenWritingProfile={() => setWritingProfileOpen(true)}
            onSelectedContentChange={id => selected(type, id)}
            onBack={() => returnToGallery(type)}/>
        : <ContentEditor contentType={type} active={active} selectedContentId={editingId} initialMode={editorMode}
            intendedPlatforms={intendedPlatforms?.contentId === editingId ? intendedPlatforms.platforms : undefined}
            handoffGeneration={handoffGenerationRef.current}
            agentOpen={agentDrawer?.contentId === editingId && agentDrawer.contentType === type}
            onToggleAgent={toggleAgent}
            onDraftReady={draftReady} onAgentTargetChange={changeAgentTarget} onRestartAgent={restartAgent}
            onDeleteContent={deleteEditorContent}
            onOpenWritingProfile={() => setWritingProfileOpen(true)}
            onReturnToSource={returnToSource}
            onSourceNavigation={() => layout.beginNavigation()}
            onSelectedContentChange={id => selected(type, id)} onBack={() => returnToGallery(type)}/>)}
    </>
  }
  const editing = tab === 'publish' && Boolean(editingIds[contentType])
  const visibleAgent = editing && agentDrawer && agentDrawer.contentId === editingIds[contentType] && agentDrawer.contentType === contentType ? agentDrawer : undefined
  const agentResize = usePublisherAgentResize(surfaceRef, Boolean(visibleAgent))
  return <PublisherTipsProvider><section ref={surfaceRef} className="pub-surface" data-agent-open={visibleAgent ? 'true' : undefined}><style>{css}{agentSplitterCss}</style>
    {visibleAgent && <><aside id="pub-agent-drawer" className="pub-agent-panel" aria-label="Agent 辅助编辑" data-session-id={visibleAgent.sessionId} data-content-id={visibleAgent.contentId}
      style={{ '--pub-agent-width': agentResize.width === undefined ? undefined : `${agentResize.width}px` } as CSSProperties}>
      <header className="pub-agent-header"><span>Agent · {contentType === 'article' ? '文章' : contentType === 'image-note' ? '图文' : '视频'}</span><button type="button" aria-label="收起 Agent" onClick={() => void closeAgent()}>×</button></header>
      <div className="pub-agent-conversation"><agentRenderer.SessionProvider session={visibleAgent.reference}>{agentRenderer.renderSlot(PUBLISHER_AGENT_SLOT, { contentType: visibleAgent.contentType })}</agentRenderer.SessionProvider></div>
    </aside><PublisherAgentSplitter {...agentResize.splitterProps}/></>}
    <section className="pub" data-editor-open={editing ? 'true' : undefined}><div className="pub-wrap">
    <header className="pub-head" hidden={editing}>
      <div><h2 ref={pageTitleRef} tabIndex={-1}>多平台发布</h2></div>
      <nav className="pub-page-nav" aria-label="多平台发布页面导航">
        {tab !== 'publish' && <button type="button" className="pub-page-link" aria-controls="pub-panel-publish" onClick={() => navigatePage('publish')}>返回发布内容</button>}
        <button type="button" className="pub-page-link" aria-controls="pub-panel-history" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => navigatePage('history')}>发布历史</button>
        <button type="button" className="pub-page-link" aria-controls="pub-panel-accounts" aria-current={tab === 'accounts' ? 'page' : undefined} onClick={() => navigatePage('accounts')}>平台账号管理</button>
        <button type="button" className="pub-page-link" aria-controls="pub-panel-settings" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => navigatePage('settings')}>设置</button>
        <button type="button" className="pub-page-link" aria-controls="pub-panel-trash" aria-current={tab === 'trash' ? 'page' : undefined} onClick={() => navigatePage('trash')}>回收站</button>
      </nav>
    </header>
    <div id="pub-panel-publish" hidden={tab !== 'publish'}><div className="pub-layout">
      <nav className="pub-type-nav" hidden={editing} role="tablist" aria-label="内容类型" onKeyDown={handleTabKeyDown}>
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
    <div id="pub-panel-trash" hidden={tab !== 'trash'}>
      <h3>回收站</h3><p className="pub-muted">稿件和素材会保留。恢复后再次打开稿件，将继续或新建它的编辑对话。</p>
      {tab === 'trash' && <><nav className="pub-type-nav" role="tablist" aria-label="回收站内容类型" onKeyDown={handleTabKeyDown}>{([['article', '文章'], ['image-note', '图文'], ['video', '视频']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={contentType === value} tabIndex={contentType === value ? 0 : -1} className="pub-type" onClick={() => chooseContentType(value)}>{label}</button>)}</nav>
        {galleryError?.contentType === contentType && <div className="pub-error" role="alert">{galleryError.message}</div>}
        <DraftGallery contentType={contentType} active busy={galleryBusy} trash refreshKey={galleryRefresh[contentType]} onOpen={() => {}} onCreate={() => {}} onCopy={() => {}} onDelete={id => retryTrashDeletion(contentType, id)} onRestore={id => restoreDraft(contentType, id)}/></>}
    </div>
    <div id="pub-panel-history" hidden={tab !== 'history'}><SubmissionHistory active={tab === 'history'}/></div>
    <div id="pub-panel-accounts" hidden={tab !== 'accounts'}><AccountsPage active={tab === 'accounts'}/></div>
    <div id="pub-panel-settings" hidden={tab !== 'settings'}>{tab === 'settings' && <PublisherSettings onWritingProfileDirtyChange={markSettingsDirty} onWritingProfileBusyChange={markSettingsBusy}/>}</div>
    <WritingProfileDialog open={writingProfileOpen} onClose={() => setWritingProfileOpen(false)}/>
    <PublisherModal open={pendingSettingsNavigation !== undefined} title="离开写作风格设置？" closeLabel="继续修改文风"
      description="写作风格还有未保存的修改，离开后将保留之前的设置。" className="pub-modal"
      onClose={() => setPendingSettingsNavigation(undefined)}
      footer={<><Button size="sm" variant="outline" data-pub-initial-focus onClick={() => setPendingSettingsNavigation(undefined)}>继续修改</Button>
        <Button size="sm" variant="outline" onClick={() => { pendingSettingsNavigation?.(); setPendingSettingsNavigation(undefined) }}>放弃修改并离开</Button></>}/>
    {createTarget && <CreateDraftDialog contentType={createTarget} onCancel={() => setCreateTarget(undefined)}
      onCreated={created => {
        autoOpenedRef.current = undefined
        setEditorMode('edit')
        setEditingIds(current => ({ ...current, [created.contentType]: created.id }))
        setCreateTarget(undefined)
      }}/>}
    <PublisherModal open={deleteTarget !== undefined} title="删除本地草稿" closeLabel="关闭删除草稿确认"
      description={deleteError ? `删除失败：${deleteError}` : '将这份稿件和关联对话一起移入回收站？素材保留，稿件可恢复，已发布记录也会保留。'} className="pub-modal"
      onClose={() => { if (!galleryBusyRef.current) { setDeleteTarget(undefined); setDeleteError('') } }}
      footer={<><Button size="sm" variant="outline" data-pub-initial-focus disabled={galleryBusy} onClick={() => { setDeleteTarget(undefined); setDeleteError('') }}>取消</Button>
        <Button size="sm" variant="outline" className="pub-danger-action" disabled={galleryBusy} onClick={confirmDelete}>{galleryBusy ? '正在删除…' : '删除草稿'}</Button></>}/>
  </div></section></section></PublisherTipsProvider>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'cqai-publisher-publication-confirmation', order: 10,
  }, AgentPublicationTurnTail))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'publisher_request_publication',
  }, AgentPublicationToolView))
  // This package also builds its Host entry, whose `sessions` property is a
  // different service. The client injection above guarantees this face here.
  const { sessions, workspaces, uiWorkspace } = ctx as unknown as { sessions: ISessions; workspaces: IWorkspaces; uiWorkspace: UiWorkspace }
  const openTransferredArticle = (result: PublisherArticleHandoffResult) => {
    if (result.content.contentType !== 'article' && result.content.contentType !== 'image-note') return
    requestPublisherHandoff({ contentId: result.content.id, contentType: result.content.contentType, initialMode: 'edit',
      ...(result.handoff.platforms.length ? { platforms: result.handoff.platforms } : {}) })
    ctx.layout.selectPanel(PUBLISHER_PANEL)
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'cqai-publisher-article-handoff', order: 11,
  }, (props: PropsRuntime<'conversation.chat.turnTail'>) => <ArticleHandoffTurnTail {...props} beginNavigation={() => ctx.layout.beginNavigation()} onOpen={openTransferredArticle}/>))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'handoff_to_publisher',
  }, ArticleHandoffToolView))
  ctx.effect(() => registerPublisherWorkspaceVisibility(ctx))
  ctx.effect(() => watchAutomaticPublisherHandoffs(sessions, ctx.layout, openTransferredArticle))
  ctx.effect(() => registerPublisherNewConversationGuard(ctx, { sessions, workspaces, uiWorkspace }))
  registerPublisherAgent(ctx)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PUBLISHER_PANEL,
    children: { [PUBLISHER_AGENT_SLOT]: { kind: 'single', scope: 'session' } },
  }, (props: PublisherAgentRenderProps) => <PublisherPage sessions={sessions} workspaces={workspaces} layout={ctx.layout} uiWorkspace={uiWorkspace} agentRenderer={props}/>))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PUBLISHER_PANEL, order: 42, label: '多平台发布' }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <PublishIcon size={size}/>))
  ctx.effect(() => watchPublisherSession(sessions, workspaces, ctx.layout, content => {
    requestPublisherHandoff({ ...content, initialMode: 'edit' })
    ctx.layout.selectPanel(PUBLISHER_PANEL)
  }))
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
