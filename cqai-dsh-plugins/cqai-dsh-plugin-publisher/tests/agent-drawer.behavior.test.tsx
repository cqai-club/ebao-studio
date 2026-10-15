// @vitest-environment jsdom
import { act, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherContent } from '../src/protocol.ts'
import { apply } from '../src/client/index.tsx'
import { api } from '../src/client/shared.tsx'
import { subscribePublisherHandoff } from '../src/client/handoff.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <button {...props}>{children}</button>,
}))
vi.mock('../src/client/accounts.tsx', () => ({ AccountsPage: () => null }))
vi.mock('../src/client/history.tsx', () => ({ SubmissionHistory: () => null }))
vi.mock('../src/client/project-directory-info.tsx', () => ({ ProjectDirectoryInfo: () => null }))
vi.mock('../src/client/video.tsx', () => ({
  VideoPage: (props: any) => <MockEditor {...props} contentType="video"/>,
}))
vi.mock('../src/client/conversation-preview.tsx', () => ({
  ConversationPreview: () => null, ConversationPreviewAction: () => null,
  PREVIEW_ID: 'publisher-preview', PREVIEW_KIND: 'publisher-preview',
}))
vi.mock('../src/client/handoff.ts', () => ({
  readPublisherHandoff: () => undefined,
  clearPublisherHandoff: vi.fn(),
  requestPublisherHandoff: vi.fn(),
  subscribePublisherHandoff: vi.fn(() => () => {}),
}))
vi.mock('../src/client/tips.tsx', () => ({
  PublisherTipsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(), css: '',
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  PublisherModal: ({ open, title, footer }: any) => open ? <div role="dialog" aria-label={title}>{footer}</div> : null,
}))
vi.mock('../src/client/draft-gallery.tsx', () => ({
  DraftGallery: ({ active, contentType, trash, onOpen, onPreview, onPublish, onDelete, onRestore }: any) => active ? trash
    ? <><button type="button" onClick={() => onDelete('pending-trash')}>重试删除稿件</button><button type="button" onClick={() => onRestore('pending-restore')}>重试恢复稿件</button></>
    : <><button type="button" onClick={() => onOpen(`${contentType}-1`)}>
      打开{contentType === 'article' ? '文章' : contentType === 'image-note' ? '图文' : '视频'}草稿
    </button><button type="button" onClick={() => onPreview(`${contentType}-1`)}>快捷预览</button><button type="button" onClick={() => onPublish(`${contentType}-1`)}>快捷发布</button></> : null,
}))
vi.mock('../src/client/content.tsx', () => ({ ContentEditor: (props: any) => <MockEditor {...props}/> }))

function MockEditor({ active, selectedContentId, contentType, initialMode, agentOpen, onDraftReady, onToggleAgent, onAgentTargetChange, onRestartAgent, onDeleteContent, onReturnToSource, onBack }: any) {
  const content = { id: selectedContentId, contentType, revision: 7 } as PublisherContent
  useEffect(() => { if (active) onDraftReady?.(content) }, [active, selectedContentId, onDraftReady])
  return active ? <div data-editor-id={selectedContentId} data-initial-mode={initialMode}>
    {onToggleAgent && <button type="button" onClick={() => void onToggleAgent(content).catch(() => {})}>{agentOpen ? '关闭 Agent' : '打开 Agent'}</button>}
    {onAgentTargetChange && <button type="button" onClick={() => void onAgentTargetChange(content, { kind: 'platform', platform: 'juejin' })}>切换平台</button>}
    {onRestartAgent && <button type="button" onClick={() => void onRestartAgent(content)}>重新开始对话</button>}
    {onDeleteContent && <button type="button" onClick={() => void onDeleteContent(selectedContentId).then(onBack)}>删除稿件</button>}
    {onReturnToSource && <button type="button" onClick={() => void onReturnToSource('unrelated-session')}>返回来源对话</button>}
    <button type="button" onClick={onBack}>返回草稿列表</button>
  </div> : null
}

const queryApi = api as unknown as Mock
const DRAWER_EVENT = 'cqai-publisher-agent-drawer'
const AGENT_WORKSPACE_PATH = '/app/publisher-agent'
let container: HTMLDivElement | undefined
let frame: HTMLDivElement | undefined
let root: Root | undefined

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

type MockSessionReference = { sessionId: string; binding: { sessionId: string }; ready: Promise<void>; release: ReturnType<typeof vi.fn> }
type ReferenceLifecycle = { type: 'mounted' | 'unmounted' | 'released'; reference: MockSessionReference }

function fakeSessions(workspaces: ReturnType<typeof fakeWorkspaces>) {
  let mainViewSessionId: string | undefined = 'unrelated-session'
  let ids = ['unrelated-session']
  let byId: Record<string, { id: string; parentId?: string; origin?: string }> = {
    'unrelated-session': { id: 'unrelated-session' },
  }
  let phase: 'pending' | 'ready' = 'ready'
  let created = 0
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  const sources = new Map<string, Record<string, number>>()
  const references: MockSessionReference[] = []
  const mountedReferences = new Set<MockSessionReference>()
  const referenceLifecycle: ReferenceLifecycle[] = []
  return {
    references, mountedReferences, referenceLifecycle,
    list: {
      getSnapshot: () => ({ ids, byId, phase }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
    retainInfo: (id: string) => ({
      getSnapshot: (): { referenceCount: number; retainedBy: Record<string, number> } => ({
        referenceCount: (mainViewSessionId === id ? 1 : 0) + Object.values(sources.get(id) ?? {}).reduce((sum, count) => sum + count, 0),
        retainedBy: { ...(sources.get(id) ?? {}), ...(mainViewSessionId === id ? { mainView: 1 } : {}) },
      }),
    }),
    retain: vi.fn((id: string, options: { source: string }) => {
      const counts = sources.get(id) ?? {}
      counts[options.source] = (counts[options.source] ?? 0) + 1
      sources.set(id, counts)
      let released = false
      const binding = { sessionId: id }
      const reference: MockSessionReference = { sessionId: id, get binding() {
        if (released) throw new Error(`Session reference "${id}" is released`)
        return binding
      }, ready: Promise.resolve(), release: vi.fn(() => {
        if (released) return
        referenceLifecycle.push({ type: 'released', reference })
        if (mountedReferences.has(reference)) throw new Error(`Session reference "${id}" was released before its Provider unmounted`)
        released = true
        counts[options.source]--
        notify()
      }) }
      references.push(reference)
      notify()
      return reference
    }),
    create: vi.fn(async (options: { workspaceId?: string } = {}) => {
      const id = `new-session-${++created}`
      ids = [...ids, id]
      byId = { ...byId, [id]: { id } }
      if (options.workspaceId) workspaces.own(id, options.workspaceId)
      notify()
      return id
    }),
    refresh: vi.fn(async () => {}),
    open: vi.fn((id: string) => { mainViewSessionId = id; notify() }),
    changeCurrent: (id: string) => { mainViewSessionId = id; notify() },
    add: (id: string, details: { parentId?: string; origin?: string } = {}) => {
      ids = [...ids, id]
      byId = { ...byId, [id]: { id, ...details } }
      notify()
    },
    remove: (id: string) => {
      ids = ids.filter(item => item !== id)
      const next = { ...byId }
      delete next[id]
      byId = next
      if (mainViewSessionId === id) mainViewSessionId = undefined
      notify()
    },
    setPhase: (value: 'pending' | 'ready') => { phase = value; notify() },
  }
}

function fakeWorkspaces() {
  type Workspace = { workspaceId: string; path: string; title: string; sessionIds: string[] }
  let items: Workspace[] = []
  let archivedSessionIds: string[] = []
  let phase: 'pending' | 'ready' = 'ready'
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  return {
    list: {
      getSnapshot: () => ({ items, archivedSessionIds, phase }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
    create: vi.fn(async ({ path }: { path: string }) => {
      let workspace = items.find(item => item.path === path)
      if (!workspace) {
        workspace = { workspaceId: 'publisher-workspace', path, title: '多平台发布', sessionIds: [] }
        items = [...items, workspace]
        notify()
      }
      return workspace
    }),
    own: (sessionId: string, workspaceId = 'existing-workspace') => {
      if (!items.some(item => item.workspaceId === workspaceId)) {
        items = [...items, { workspaceId, path: '/projects/existing', title: '现有工作区', sessionIds: [] }]
      }
      items = items.map(item => item.workspaceId === workspaceId
        ? { ...item, sessionIds: [...item.sessionIds, sessionId] }
        : item)
      notify()
    },
    archive: (id: string) => { archivedSessionIds = [...archivedSessionIds, id]; notify() },
    setPhase: (value: 'pending' | 'ready') => { phase = value; notify() },
  }
}

function mockDraftSessions(runtime: Awaited<ReturnType<typeof renderPublisher>>, linked: Record<string, string> = {}) {
  let sequence = 0
  let token = 0
  const sessionIds = new Map(Object.entries(linked))
  queryApi.mockImplementation(async (route: string, payload?: any) => {
    if (route === 'agent-draft-session') {
      const contentId = payload.contentId
      const sessionId = sessionIds.get(contentId) ?? `edit-session-${++sequence}`
      sessionIds.set(contentId, sessionId)
      if (!runtime.sessions.list.getSnapshot().ids.includes(sessionId)) runtime.sessions.add(sessionId)
      if (!runtime.workspaces.list.getSnapshot().items.some(item => item.sessionIds.includes(sessionId))) runtime.workspaces.own(sessionId, 'publisher-workspace')
      return { contentId, sessionId, workspaceId: 'publisher-workspace', path: AGENT_WORKSPACE_PATH }
    }
    if (route === 'agent-draft-session-delete') {
      const old = sessionIds.get(payload.contentId)
      if (old) runtime.workspaces.archive(old)
      sessionIds.delete(payload.contentId)
      return { contentId: payload.contentId, sessionId: null }
    }
    if (route === 'content-delete') {
      const old = sessionIds.get(payload.id)
      if (old) runtime.workspaces.archive(old)
      return { id: payload.id }
    }
    if (route === 'agent-draft-bind') return { ...payload, bindingToken: payload.contentId ? `token-${++token}` : null }
    return undefined
  })
}

async function renderPublisher(mode: 'compatibility' | 'extended' | 'advanced', nativeArchiveNavigation = false) {
  frame = document.createElement('div')
  frame.className = 'dshDesktopFrame'
  frame.dataset.desktopMode = mode
  document.body.append(frame)
  container = document.createElement('div')
  frame.append(container)
  const workspaces = fakeWorkspaces()
  const sessions = fakeSessions(workspaces)
  let activePanel: string | null = 'cqai-publisher'
  let navigation = new AbortController()
  const panelListeners = new Set<() => void>()
  const layout = {
    beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    selectPanel: vi.fn((panel: string | null) => {
      layout.beginNavigation()
      activePanel = panel
      panelListeners.forEach(listener => listener())
    }),
    subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener) } },
    getSnapshot: () => activePanel,
    panelInfo: {
      getSnapshot: () => ({ activePanelId: activePanel }),
      subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener) } },
    },
  }
  if (nativeArchiveNavigation) workspaces.list.subscribe(() => {
    const archivedCurrent = workspaces.list.getSnapshot().archivedSessionIds.find(id =>
      (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0)
    if (archivedCurrent) {
      sessions.changeCurrent('')
      layout.selectPanel(null)
    }
  })
  let Page: ((props: any) => ReactNode) | undefined
  const SessionProvider = ({ session, children }: { session: MockSessionReference; children: ReactNode }) => {
    // The real DS Provider resolves reference.binding during every render.
    const binding = session.binding
    useLayoutEffect(() => {
      sessions.mountedReferences.add(session)
      sessions.referenceLifecycle.push({ type: 'mounted', reference: session })
      return () => {
        sessions.mountedReferences.delete(session)
        sessions.referenceLifecycle.push({ type: 'unmounted', reference: session })
      }
    }, [session])
    return <div data-provider-session={binding.sessionId}>{children}</div>
  }
  const renderSlot = vi.fn((name: string) => name === 'publisher.agent' ? <div data-local-agent-ui>DS Agent</div> : null)
  const ctx = {
    sessions,
    workspaces,
    uiWorkspace: { openSession: (id: string) => { sessions.open(id); layout.selectPanel(null) } },
    slots: {
      inject: (_slot: string, callback: () => void) => callback(),
      register: (options: { name: string; key?: string }, renderer: (props: any) => ReactNode) => {
        if (options.name === 'main' && options.key === 'cqai-publisher') Page = renderer
        return () => {}
      },
    },
    effect: (callback: () => void) => callback(),
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { active: () => undefined, openTab: vi.fn() },
    layout,
  }
  apply(ctx as never)
  if (!Page) throw new Error('Publisher main panel was not registered')
  root = createRoot(container)
  const RegisteredPage = Page as (props: any) => ReactNode
  function Panel() {
    const panel = useSyncExternalStore(layout.subscribe, layout.getSnapshot)
    return panel === 'cqai-publisher' ? <RegisteredPage SessionProvider={SessionProvider} renderSlot={renderSlot}/> : <div>普通对话</div>
  }
  await act(async () => { root!.render(<Panel/>) })
  return { sessions, workspaces, layout, renderSlot }
}

async function click(label: string) {
  const button = Array.from(container!.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  localStorage.setItem('cqai-publisher-content-type', 'article')
  queryApi.mockReset()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  frame?.remove()
  root = undefined
  container = undefined
  frame = undefined
  vi.unstubAllGlobals()
})

describe('Publisher plugin-contained Agent session binding', () => {
  it('embeds the retained DS conversation in compatibility mode without selecting the main conversation', async () => {
    const runtime = await renderPublisher('compatibility')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    expect(container!.querySelector('[data-editor-id="article-1"]')).not.toBeNull()
    expect(container!.querySelector('[data-provider-session="edit-session-1"] [data-local-agent-ui]')).not.toBeNull()
    expect(runtime.sessions.retainInfo('edit-session-1').getSnapshot().retainedBy.publisherView).toBe(1)
    expect(runtime.sessions.retainInfo('edit-session-1').getSnapshot().retainedBy.mainView).toBeUndefined()
    expect(runtime.sessions.retainInfo('unrelated-session').getSnapshot().retainedBy.mainView).toBe(1)
    expect(runtime.sessions.open).not.toHaveBeenCalled()
  })

  it.each([['article', '文章'], ['image-note', '图文'], ['video', '视频']] as const)('passes %s gallery preview and publish shortcuts to the editor', async (type, label) => {
    await renderPublisher('compatibility')
    if (type !== 'article') await click(label)
    await click('快捷预览')
    expect(container!.querySelector(`[data-editor-id="${type}-1"]`)?.getAttribute('data-initial-mode')).toBe('preview')
    await click('返回草稿列表')
    await click('快捷发布')
    expect(container!.querySelector(`[data-editor-id="${type}-1"]`)?.getAttribute('data-initial-mode')).toBe('publish')
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('retries the matching content lifecycle action from the recycle bin', async () => {
    await renderPublisher('compatibility')
    queryApi.mockResolvedValue(undefined)
    await click('回收站')
    await click('重试删除稿件')
    expect(queryApi).toHaveBeenCalledWith('content-delete', { id: 'pending-trash' })
    await click('重试恢复稿件')
    expect(queryApi).toHaveBeenCalledWith('content-restore', { id: 'pending-restore' })
    expect(queryApi.mock.calls.some(([route]) => route === 'agent-draft-session' || route === 'submissions')).toBe(false)
  })

  it.each([['article', '文章'], ['image-note', '图文'], ['video', '视频']] as const)('automatically opens %s in the shared publishing workspace', async (type, label) => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    if (type !== 'article') await click(label)
    const events: unknown[] = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener(DRAWER_EVENT, listener)
    try {
      await click(`打开${label}草稿`)
      expect(queryApi).toHaveBeenCalledWith('agent-draft-session', { contentId: `${type}-1` })
      expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { contentId: `${type}-1`, sessionId: 'edit-session-1', target: { kind: 'main' } })
      expect(runtime.sessions.retain).toHaveBeenCalledWith('edit-session-1', { source: 'publisherView' })
      expect(runtime.sessions.create).not.toHaveBeenCalled()
      expect(runtime.workspaces.create).not.toHaveBeenCalled()
      expect(events).toEqual([])
      expect(container!.querySelector('.pub-head')?.hasAttribute('hidden')).toBe(true)
      expect(container!.querySelector('.pub-type-nav')?.hasAttribute('hidden')).toBe(true)
      expect(container!.querySelector('.pub')?.getAttribute('data-editor-open')).toBe('true')
      expect(runtime.layout.getSnapshot()).toBe('cqai-publisher')
      expect(container!.textContent).not.toContain('普通对话')
      await click('返回草稿列表')
      expect(runtime.sessions.references[0]?.release).toHaveBeenCalledOnce()
      expect(runtime.sessions.retainInfo('edit-session-1').getSnapshot().retainedBy.publisherView).toBe(0)
      expect(events).toEqual([])
      expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: null, bindingToken: 'token-1' })
      expect(container!.querySelector('.pub-head')?.hasAttribute('hidden')).toBe(false)
    } finally { window.removeEventListener(DRAWER_EVENT, listener) }
  })

  it.each(['compatibility', 'extended', 'advanced'] as const)('opens automatically once per editing entry in %s mode and reuses its session', async mode => {
    const runtime = await renderPublisher(mode)
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
    await click('关闭 Agent')
    expect(container!.textContent).toContain('打开 Agent')
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
    await click('打开 Agent')
    expect(runtime.sessions.retain).toHaveBeenNthCalledWith(2, 'edit-session-1', { source: 'publisherView' })
    await click('返回草稿列表')
    await click('打开文章草稿')
    expect(runtime.sessions.retain).toHaveBeenNthCalledWith(3, 'edit-session-1', { source: 'publisherView' })
    expect(runtime.workspaces.create).not.toHaveBeenCalled()
    expect(runtime.sessions.create).not.toHaveBeenCalled()
  })

  it.each(['关闭 Agent', '返回草稿列表'])('unmounts the explicit DS Provider before releasing its reference on %s', async action => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    const reference = runtime.sessions.references[0]
    expect(runtime.sessions.mountedReferences.has(reference)).toBe(true)
    expect(reference.binding.sessionId).toBe('edit-session-1')
    await click(action)
    expect(runtime.sessions.mountedReferences.has(reference)).toBe(false)
    expect(reference.release).toHaveBeenCalledOnce()
    expect(runtime.sessions.referenceLifecycle.filter(event => event.reference === reference).map(event => event.type))
      .toEqual(['mounted', 'unmounted', 'released'])
    expect(() => reference.binding).toThrow('Session reference "edit-session-1" is released')
    expect(container!.querySelector('[data-provider-session]')).toBeNull()
  })

  it('removes the dedicated Provider before release when returning to the ordinary source conversation', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    queryApi.mockImplementation((route, payload) => route === 'article-origin/article-1'
      ? Promise.resolve({ source: { sessionId: 'unrelated-session' }, sourceSessionAvailable: true })
      : base(route, payload))
    await click('打开文章草稿')
    const reference = runtime.sessions.references[0]
    await click('返回来源对话')
    expect(runtime.sessions.referenceLifecycle.filter(event => event.reference === reference).map(event => event.type))
      .toEqual(['mounted', 'unmounted', 'released'])
    expect(reference.release).toHaveBeenCalledOnce()
    expect(runtime.sessions.open).toHaveBeenCalledExactlyOnceWith('unrelated-session')
    expect(container!.textContent).toBe('普通对话')
  })

  it('preserves the mounted reference across platform rebinding and releases it only on closing', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    const reference = runtime.sessions.references[0]
    await click('切换平台')
    expect(runtime.sessions.mountedReferences.has(reference)).toBe(true)
    expect(reference.release).not.toHaveBeenCalled()
    expect(reference.binding.sessionId).toBe('edit-session-1')
    expect(runtime.sessions.referenceLifecycle.filter(event => event.reference === reference).map(event => event.type)).toEqual(['mounted'])
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
    await click('关闭 Agent')
    expect(runtime.sessions.referenceLifecycle.filter(event => event.reference === reference).map(event => event.type))
      .toEqual(['mounted', 'unmounted', 'released'])
  })

  it('reclaims an installed reference even when opening and closing are batched before its Provider commits', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const binding = deferred<any>()
    queryApi.mockImplementation((route, payload) => route === 'agent-draft-bind' && payload?.contentId ? binding.promise : base(route, payload))
    await click('打开文章草稿')
    const reference = runtime.sessions.references[0]
    expect(reference).toBeDefined()
    expect(runtime.sessions.referenceLifecycle).toEqual([])
    const toggle = Array.from(container!.querySelectorAll('button')).find(item => item.textContent?.trim() === '打开 Agent')!
    // The opener already awaits this promise. Its continuation installs the
    // binding before this later callback closes it, within the same React act.
    await act(async () => {
      const closing = binding.promise.then(() => toggle.click())
      binding.resolve({ contentId: 'article-1', sessionId: 'edit-session-1', bindingToken: 'quick-token' })
      await closing
    })
    expect(runtime.sessions.referenceLifecycle.filter(event => event.reference === reference).map(event => event.type)).toEqual(['released'])
    expect(reference.release).toHaveBeenCalledOnce()
    expect(runtime.sessions.retainInfo('edit-session-1').getSnapshot().referenceCount).toBe(0)
    expect(container!.querySelector('[data-provider-session]')).toBeNull()
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: null, bindingToken: 'quick-token' })
  })

  it('keeps each content in a separate session within the same workspace', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await click('返回草稿列表')
    await click('视频')
    await click('打开视频草稿')
    expect(runtime.sessions.retain.mock.calls).toEqual([['edit-session-1', { source: 'publisherView' }], ['edit-session-2', { source: 'publisherView' }]])
    expect(runtime.workspaces.list.getSnapshot().items).toHaveLength(1)
    expect(runtime.workspaces.list.getSnapshot().items[0]?.sessionIds).toEqual(['edit-session-1', 'edit-session-2'])
  })

  it('waits for archive and workspace snapshots before opening the session', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime, { 'article-1': 'linked-session' })
    runtime.workspaces.setPhase('pending')
    await click('打开文章草稿')
    expect(runtime.sessions.refresh).toHaveBeenCalledOnce()
    expect(runtime.sessions.retain).not.toHaveBeenCalled()
    await act(async () => { runtime.workspaces.setPhase('ready') })
    expect(runtime.sessions.retain).toHaveBeenCalledWith('linked-session', { source: 'publisherView' })
  })

  it('does not open a late session after returning to the gallery', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const pending = deferred<any>()
    queryApi.mockImplementation((route, payload) => route === 'agent-draft-session' ? pending.promise : base(route, payload))
    await click('打开文章草稿')
    await click('返回草稿列表')
    await act(async () => { pending.resolve({ contentId: 'article-1', sessionId: 'late', workspaceId: 'publisher-workspace', path: AGENT_WORKSPACE_PATH }) })
    expect(runtime.sessions.open).not.toHaveBeenCalled()
    expect(queryApi.mock.calls.some(([route]) => route === 'agent-draft-bind')).toBe(false)
  })

  it('does not open after returning while archive state is pending', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    runtime.workspaces.setPhase('pending')
    await click('打开文章草稿')
    await click('返回草稿列表')
    await act(async () => { runtime.workspaces.setPhase('ready') })
    expect(runtime.sessions.open).not.toHaveBeenCalled()
  })

  it('revokes a late bind token after the editor is closed', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const pending = deferred<any>()
    queryApi.mockImplementation((route, payload) => route === 'agent-draft-bind' && payload?.contentId ? pending.promise : base(route, payload))
    await click('打开文章草稿')
    await click('返回草稿列表')
    await act(async () => { pending.resolve({ contentId: 'article-1', sessionId: 'edit-session-1', bindingToken: 'late-token' }) })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: null, bindingToken: 'late-token' })
    expect(container!.textContent).not.toContain('关闭 Agent')
  })

  it.each(['archived', 'removed'] as const)('closes an %s conversation and keeps the content editor', async kind => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await act(async () => {
      if (kind === 'archived') runtime.workspaces.archive('edit-session-1')
      else runtime.sessions.remove('edit-session-1')
    })
    expect(container!.textContent).toContain('打开 Agent')
    expect(container!.querySelector('[data-editor-id="article-1"]')).not.toBeNull()
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: null, bindingToken: 'token-1' })
    expect(queryApi.mock.calls.some(([route]) => route === 'content-delete')).toBe(false)
  })

  it('rebinds the selected platform without opening another session', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await click('切换平台')
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: 'article-1', target: { kind: 'platform', platform: 'juejin' } })
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
    expect(queryApi.mock.calls.filter(([route]) => route === 'agent-draft-session')).toHaveLength(1)
  })

  it('rebinds an existing drawer when a same-content handoff resets the editor to main', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await click('切换平台')
    const callback = (subscribePublisherHandoff as Mock).mock.calls.at(-1)![0]
    await act(async () => { callback({ contentId: 'article-1', contentType: 'article', initialMode: 'preview' }) })
    expect(queryApi.mock.calls.filter(([route]) => route === 'agent-draft-bind').at(-1))
      .toEqual(['agent-draft-bind', { sessionId: 'edit-session-1', contentId: 'article-1', target: { kind: 'main' } }])
    expect(container!.querySelector('[data-editor-id="article-1"]')?.getAttribute('data-initial-mode')).toBe('preview')
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
  })

  it('replaces the first delayed bind with the platform selected while the drawer is opening', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const firstBind = deferred<any>()
    let delayed = false
    queryApi.mockImplementation((route, payload) => {
      if (route === 'agent-draft-bind' && payload?.contentId && !delayed) {
        delayed = true
        return firstBind.promise
      }
      return base(route, payload)
    })
    await click('打开文章草稿')
    await click('切换平台')
    await act(async () => { firstBind.resolve({ contentId: 'article-1', sessionId: 'edit-session-1', bindingToken: 'old-main-token' }) })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: null, bindingToken: 'old-main-token' })
    expect(queryApi).toHaveBeenLastCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: 'article-1', target: { kind: 'platform', platform: 'juejin' } })
    expect(container!.textContent).toContain('关闭 Agent')
    await click('关闭 Agent')
    expect(queryApi).toHaveBeenLastCalledWith('agent-draft-bind', { sessionId: 'edit-session-1', contentId: null, bindingToken: 'token-1' })
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
  })

  it('archives the edit session and starts a new session while keeping the same content', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await click('重新开始对话')
    expect(queryApi).toHaveBeenCalledWith('agent-draft-session-delete', { contentId: 'article-1' })
    expect(runtime.workspaces.list.getSnapshot().archivedSessionIds).toContain('edit-session-1')
    expect(runtime.sessions.retain).toHaveBeenNthCalledWith(2, 'edit-session-2', { source: 'publisherView' })
    expect(container!.querySelector('[data-editor-id="article-1"]')).not.toBeNull()
    expect(queryApi.mock.calls.some(([route]) => route === 'content-delete' || route === 'content-copy')).toBe(false)
  })

  it.each(['article', 'image-note', 'video'] as const)('keeps Publisher visible after native current-session clearing while deleting %s', async type => {
    const runtime = await renderPublisher('extended', true)
    mockDraftSessions(runtime)
    if (type !== 'article') await click(type === 'video' ? '视频' : '图文')
    await click(`打开${type === 'article' ? '文章' : type === 'video' ? '视频' : '图文'}草稿`)
    await act(async () => { runtime.sessions.changeCurrent('edit-session-1') })
    await click('删除稿件')
    expect(runtime.workspaces.list.getSnapshot().archivedSessionIds).toContain('edit-session-1')
    expect(runtime.layout.getSnapshot()).toBe('cqai-publisher')
    expect(container!.textContent).not.toContain('普通对话')
    expect(container!.textContent).toContain('回收站')
    expect(container!.querySelector('[data-editor-id]')).toBeNull()
  })

  it('keeps Publisher visible when restarting a conversation whose drawer has already closed', async () => {
    const runtime = await renderPublisher('extended', true)
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await click('关闭 Agent')
    await act(async () => { runtime.sessions.changeCurrent('edit-session-1') })
    await click('重新开始对话')
    expect(runtime.workspaces.list.getSnapshot().archivedSessionIds).toContain('edit-session-1')
    expect(runtime.layout.getSnapshot()).toBe('cqai-publisher')
    expect(runtime.sessions.retain).toHaveBeenLastCalledWith('edit-session-2', { source: 'publisherView' })
    expect(container!.querySelector('[data-editor-id="article-1"]')).not.toBeNull()
  })

  it('allows user navigation to supersede a pending content deletion', async () => {
    const runtime = await renderPublisher('extended', true)
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const deleting = deferred<any>()
    queryApi.mockImplementation((route, payload) => route === 'content-delete' ? deleting.promise : base(route, payload))
    await click('打开文章草稿')
    await click('删除稿件')
    await act(async () => { runtime.layout.selectPanel('settings') })
    await act(async () => { runtime.workspaces.archive('edit-session-1'); deleting.resolve({ id: 'article-1' }) })
    expect(runtime.layout.getSnapshot()).not.toBe('cqai-publisher')
    expect(container!.textContent).toBe('普通对话')
  })

  it('keeps the embedded conversation and binding when the global main view changes', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    await click('打开文章草稿')
    await act(async () => { runtime.sessions.changeCurrent('another-main-session') })
    expect(container!.querySelector('[data-provider-session="edit-session-1"] [data-local-agent-ui]')).not.toBeNull()
    expect(container!.textContent).toContain('关闭 Agent')
    expect(runtime.sessions.references[0]?.release).not.toHaveBeenCalled()
    expect(runtime.sessions.open).not.toHaveBeenCalled()
    expect(queryApi.mock.calls.some(([route, payload]) => route === 'agent-draft-bind' && payload?.contentId === null)).toBe(false)
  })

  it('releases a late retained reference without binding after the editor closes', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const ready = deferred<void>()
    const retain = runtime.sessions.retain.getMockImplementation()!
    runtime.sessions.retain.mockImplementationOnce((id, options) => {
      const reference = retain(id, options)
      reference.ready = ready.promise
      return reference
    })
    await click('打开文章草稿')
    expect(runtime.sessions.retain).toHaveBeenCalledOnce()
    await click('返回草稿列表')
    expect(runtime.sessions.references[0]?.release).toHaveBeenCalledOnce()
    expect(runtime.sessions.retainInfo('edit-session-1').getSnapshot().retainedBy.publisherView).toBe(0)
    await act(async () => { ready.resolve() })
    expect(runtime.sessions.retainInfo('edit-session-1').getSnapshot().referenceCount).toBe(0)
    expect(queryApi.mock.calls.some(([route]) => route === 'agent-draft-bind')).toBe(false)
    expect(container!.querySelector('[data-local-agent-ui]')).toBeNull()
  })
  it('reports automatic opening failure and allows an explicit retry while editing remains available', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    let fail = true
    queryApi.mockImplementation((route, payload) => route === 'agent-draft-session' && fail ? Promise.reject(new Error('offline')) : base(route, payload))
    await click('打开文章草稿')
    expect(container!.textContent).toContain('Agent 对话暂时无法打开')
    expect(container!.querySelector('[data-editor-id="article-1"]')).not.toBeNull()
    expect(runtime.sessions.open).not.toHaveBeenCalled()
    fail = false
    await click('打开 Agent')
    expect(runtime.sessions.retain).toHaveBeenCalledWith('edit-session-1', { source: 'publisherView' })
  })

  it('starts the exact queued delegation only after its native binding and carries the editor revision', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const task = { taskId: 'task-1', contentId: 'article-1', publisherSessionId: 'edit-session-1', status: 'queued' }
    queryApi.mockImplementation((route, payload) => {
      if (route === 'publisher-delegation-for-content/article-1') return Promise.resolve(task)
      if (route === 'publisher-delegation-start') { task.status = 'running'; return Promise.resolve(task) }
      return base(route, payload)
    })
    await click('打开文章草稿')
    expect(queryApi).toHaveBeenCalledWith('publisher-delegation-start', { taskId: 'task-1', sessionId: 'edit-session-1', bindingToken: 'token-1', expectedContentRevision: 7 })
    const routes = queryApi.mock.calls.map(([route]) => route)
    expect(routes.indexOf('agent-draft-bind')).toBeLessThan(routes.indexOf('publisher-delegation-start'))
    await click('关闭 Agent'); await click('打开 Agent')
    expect(queryApi.mock.calls.filter(([route]) => route === 'publisher-delegation-start')).toHaveLength(1)
    expect(runtime.sessions.retain.mock.calls[1][0]).toBe('edit-session-1')
  })

  it.each(['running', 'completed', 'failed', 'interrupted'])('does not restart a %s delegation when reopening the editor', async status => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    queryApi.mockImplementation((route, payload) => route === 'publisher-delegation-for-content/article-1'
      ? Promise.resolve({ taskId: 'task-1', contentId: 'article-1', publisherSessionId: 'edit-session-1', status }) : base(route, payload))
    await click('打开文章草稿')
    expect(queryApi.mock.calls.some(([route]) => route === 'publisher-delegation-start')).toBe(false)
  })

  it('does not start a delayed delegation after selecting a platform-specific editor target', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    const pending = deferred<any>()
    queryApi.mockImplementation((route, payload) => route === 'publisher-delegation-for-content/article-1' ? pending.promise : base(route, payload))
    await click('打开文章草稿')
    await click('切换平台')
    await act(async () => { pending.resolve({ taskId: 'task-1', contentId: 'article-1', publisherSessionId: 'edit-session-1', status: 'queued' }) })
    expect(queryApi.mock.calls.some(([route]) => route === 'publisher-delegation-start')).toBe(false)
    expect(runtime.sessions.references[0].release).not.toHaveBeenCalled()
  })

  it('keeps the bound draft usable after a start conflict and allows an explicit reopening retry', async () => {
    const runtime = await renderPublisher('extended')
    mockDraftSessions(runtime)
    const base = queryApi.getMockImplementation()!
    let failures = 1
    queryApi.mockImplementation((route, payload) => {
      if (route === 'publisher-delegation-for-content/article-1') return Promise.resolve({ taskId: 'task-1', contentId: 'article-1', publisherSessionId: 'edit-session-1', status: 'queued' })
      if (route === 'publisher-delegation-start') return failures-- > 0 ? Promise.reject(new Error('发布稿已修改')) : Promise.resolve({ status: 'running' })
      return base(route, payload)
    })
    await click('打开文章草稿')
    expect(container!.textContent).toContain('发布任务暂时无法开始：发布稿已修改')
    expect(runtime.sessions.references[0].release).not.toHaveBeenCalled()
    await click('关闭 Agent'); await click('打开 Agent')
    expect(queryApi.mock.calls.filter(([route]) => route === 'publisher-delegation-start')).toHaveLength(2)
    expect(container!.querySelector('[data-editor-id="article-1"]')).not.toBeNull()
  })
})
