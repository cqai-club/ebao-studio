// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherContent } from '../src/protocol.ts'
import { apply } from '../src/client/index.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <button {...props}>{children}</button>,
}))
vi.mock('../src/client/accounts.tsx', () => ({ AccountsPage: () => null }))
vi.mock('../src/client/history.tsx', () => ({ SubmissionHistory: () => null }))
vi.mock('../src/client/project-directory-info.tsx', () => ({ ProjectDirectoryInfo: () => null }))
vi.mock('../src/client/video.tsx', () => ({ VideoPage: () => null }))
vi.mock('../src/client/conversation-preview.tsx', () => ({
  ConversationPreview: () => null, ConversationPreviewAction: () => null,
  PREVIEW_ID: 'publisher-preview', PREVIEW_KIND: 'publisher-preview',
}))
vi.mock('../src/client/handoff.ts', () => ({
  readPublisherHandoff: () => undefined,
  clearPublisherHandoff: vi.fn(),
  requestPublisherHandoff: vi.fn(),
  subscribePublisherHandoff: () => () => {},
}))
vi.mock('../src/client/tips.tsx', () => ({
  PublisherTipsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(), css: '',
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  PublisherModal: () => null,
}))
vi.mock('../src/client/draft-gallery.tsx', () => ({
  DraftGallery: ({ active, onOpen }: { active: boolean; onOpen: (id: string) => void }) =>
    active ? <button type="button" onClick={() => onOpen('article-1')}>打开文章草稿</button> : null,
}))
vi.mock('../src/client/content.tsx', () => ({
  ContentEditor: ({ active, agentOpen, onToggleAgent, onBack }: {
    active: boolean
    agentOpen?: boolean
    onToggleAgent?: (content: PublisherContent) => Promise<void>
    onBack: () => void
  }) => active ? <>
    {onToggleAgent && <button type="button" onClick={() => void onToggleAgent({ id: 'article-1', contentType: 'article' } as PublisherContent)}>
      {agentOpen ? '关闭 Agent' : '打开 Agent'}
    </button>}
    <button type="button" onClick={onBack}>返回草稿列表</button>
  </> : null,
}))

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

function fakeSessions(workspaces: ReturnType<typeof fakeWorkspaces>) {
  let current: string | undefined = 'unrelated-session'
  let ids = ['unrelated-session']
  let byId: Record<string, { id: string; parentId?: string; origin?: string }> = {
    'unrelated-session': { id: 'unrelated-session' },
  }
  let phase: 'pending' | 'ready' = 'ready'
  let created = 0
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  return {
    list: {
      getSnapshot: () => ({ current, currentAddress: undefined, ids, byId, phase }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
    create: vi.fn(async (options: { workspaceId?: string } = {}) => {
      const id = `new-session-${++created}`
      ids = [...ids, id]
      byId = { ...byId, [id]: { id } }
      if (options.workspaceId) workspaces.own(id, options.workspaceId)
      notify()
      return id
    }),
    refresh: vi.fn(async () => {}),
    open: vi.fn((id: string) => { current = id; notify() }),
    changeCurrent: (id: string) => { current = id; notify() },
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
      if (current === id) current = undefined
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

async function ownProjectSession(workspaces: ReturnType<typeof fakeWorkspaces>, sessionId: string) {
  await workspaces.create({ path: AGENT_WORKSPACE_PATH })
  workspaces.own(sessionId, 'publisher-workspace')
  workspaces.create.mockClear()
}

function mockDraftSession(sessionId: string | null) {
  let linkedSessionId = sessionId
  queryApi.mockImplementation((route: string, payload?: { sessionId: string; contentId: string | null }) => {
    if (route === 'agent-draft-session/article-1') return Promise.resolve({ contentId: 'article-1', sessionId: linkedSessionId })
    if (route === 'agent-workspace') return Promise.resolve({ path: AGENT_WORKSPACE_PATH })
    if (route === 'agent-draft-bind' && payload?.contentId) {
      linkedSessionId = payload.sessionId
      return Promise.resolve({ ...payload, bindingToken: `token-${payload.sessionId}` })
    }
    if (route === 'agent-draft-bind') return Promise.resolve({ sessionId: payload?.sessionId, contentId: null, bindingToken: null })
    return Promise.resolve(undefined)
  })
}

async function renderPublisher(mode: 'compatibility' | 'extended') {
  frame = document.createElement('div')
  frame.className = 'dshDesktopFrame'
  frame.dataset.desktopMode = mode
  document.body.append(frame)
  container = document.createElement('div')
  frame.append(container)
  const workspaces = fakeWorkspaces()
  const sessions = fakeSessions(workspaces)
  let Page: (() => ReactNode) | undefined
  const ctx = {
    sessions,
    workspaces,
    uiWorkspace: { openSession: sessions.open },
    slots: {
      inject: (_slot: string, callback: () => void) => callback(),
      register: (options: { name: string; key?: string }, renderer: () => ReactNode) => {
        if (options.name === 'main' && options.key === 'cqai-publisher') Page = renderer
        return () => {}
      },
    },
    effect: (callback: () => void) => callback(),
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { active: () => undefined, openTab: vi.fn() },
    layout: { selectPanel: vi.fn() },
  }
  apply(ctx as never)
  if (!Page) throw new Error('Publisher main panel was not registered')
  root = createRoot(container)
  const RegisteredPage = Page as () => ReactNode
  await act(async () => { root!.render(<RegisteredPage/>) })
  return { sessions, workspaces }
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

describe('Publisher Agent drawer binding', () => {
  it('offers the drawer only when the Desktop extended layout is active', async () => {
    await renderPublisher('compatibility')
    await click('打开文章草稿')
    expect(container!.textContent).not.toContain('打开 Agent')
    expect(queryApi).not.toHaveBeenCalledWith('agent-draft-bind', expect.anything())
  })

  it('creates a new conversation for a fresh article instead of using the unrelated current conversation', async () => {
    mockDraftSession(null)
    const events: Array<{ open: boolean; contentId?: string }> = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener(DRAWER_EVENT, listener)
    try {
      const { sessions, workspaces } = await renderPublisher('extended')
      await click('打开文章草稿')
      await click('打开 Agent')
      expect(queryApi).toHaveBeenCalledWith('agent-draft-session/article-1')
      expect(queryApi).toHaveBeenCalledWith('agent-workspace', { contentId: 'article-1' })
      expect(workspaces.create).toHaveBeenCalledWith({ path: AGENT_WORKSPACE_PATH })
      expect(sessions.create).toHaveBeenCalledOnce()
      expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'publisher-workspace' })
      expect(sessions.open).toHaveBeenCalledWith('new-session-1')
      expect(workspaces.list.getSnapshot().items[0]?.sessionIds).toContain('new-session-1')
      expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'new-session-1', contentId: 'article-1' })
      expect(queryApi).not.toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'unrelated-session', contentId: 'article-1' })
      expect(events).toContainEqual({ open: true, contentId: 'article-1' })
      expect(container!.textContent).toContain('关闭 Agent')

      await click('发布历史')
      expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
        sessionId: 'new-session-1', contentId: null, bindingToken: 'token-new-session-1',
      })
      expect(events).toContainEqual({ open: false })
      expect(queryApi.mock.calls.filter(([route]) => route === 'submissions')).toHaveLength(0)
    } finally {
      window.removeEventListener(DRAWER_EVENT, listener)
    }
  })

  it('reopens the same article in its associated conversation', async () => {
    mockDraftSession(null)
    const { sessions, workspaces } = await renderPublisher('extended')
    await click('打开文章草稿')
    await click('打开 Agent')
    await click('关闭 Agent')
    await click('打开 Agent')
    expect(sessions.create).toHaveBeenCalledOnce()
    expect(workspaces.create).toHaveBeenCalledTimes(2)
    expect(sessions.refresh).toHaveBeenCalledOnce()
    expect(sessions.open).toHaveBeenNthCalledWith(2, 'new-session-1')
    expect(queryApi.mock.calls.filter(([route, body]) => route === 'agent-draft-bind' &&
      (body as { contentId?: string }).contentId === 'article-1')).toHaveLength(2)
    expect(container!.textContent).toContain('关闭 Agent')
  })

  it('waits for the archive snapshot before reusing an associated conversation', async () => {
    mockDraftSession('linked-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('linked-session')
    await ownProjectSession(workspaces, 'linked-session')
    workspaces.setPhase('pending')
    await click('打开文章草稿')
    await click('打开 Agent')
    expect(sessions.refresh).toHaveBeenCalledOnce()
    expect(sessions.open).not.toHaveBeenCalled()
    expect(sessions.create).not.toHaveBeenCalled()

    await act(async () => { workspaces.setPhase('ready') })
    expect(sessions.open).toHaveBeenCalledWith('linked-session')
    expect(sessions.create).not.toHaveBeenCalled()
    expect(workspaces.create).toHaveBeenCalledOnce()
    expect(queryApi).toHaveBeenCalledWith('agent-workspace', { contentId: 'article-1' })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'linked-session', contentId: 'article-1' })
    expect(container!.textContent).toContain('关闭 Agent')
  })

  it('does not open a conversation after navigation while archive state is pending', async () => {
    mockDraftSession('linked-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('linked-session')
    await ownProjectSession(workspaces, 'linked-session')
    workspaces.setPhase('pending')
    await click('打开文章草稿')
    await click('打开 Agent')
    await click('发布历史')
    await act(async () => { workspaces.setPhase('ready') })
    expect(sessions.open).not.toHaveBeenCalled()
    expect(sessions.create).not.toHaveBeenCalled()
    expect(queryApi.mock.calls.filter(([route]) => route === 'agent-draft-bind')).toHaveLength(0)
  })

  it.each([
    ['deleted', 'deleted-session'],
    ['archived', 'archived-session'],
    ['subagent', 'child-session'],
  ])('creates a new conversation when the associated one is %s', async (kind, linkedId) => {
    mockDraftSession(linkedId)
    const { sessions, workspaces } = await renderPublisher('extended')
    if (kind !== 'deleted') {
      sessions.add(linkedId, kind === 'subagent' ? { origin: 'subagent', parentId: 'parent-session' } : {})
      await ownProjectSession(workspaces, linkedId)
    }
    if (kind === 'archived') workspaces.archive(linkedId)
    await click('打开文章草稿')
    await click('打开 Agent')
    expect(sessions.refresh).toHaveBeenCalledOnce()
    expect(sessions.create).toHaveBeenCalledOnce()
    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'publisher-workspace' })
    expect(sessions.open).toHaveBeenCalledWith('new-session-1')
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', { sessionId: 'new-session-1', contentId: 'article-1' })
    expect(container!.textContent).toContain('关闭 Agent')
  })

  it('replaces a linked conversation that has no workspace', async () => {
    mockDraftSession('old-unassigned-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('old-unassigned-session')
    await click('打开文章草稿')
    await click('打开 Agent')
    expect(sessions.open).not.toHaveBeenCalledWith('old-unassigned-session')
    expect(workspaces.create).toHaveBeenCalledWith({ path: AGENT_WORKSPACE_PATH })
    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'publisher-workspace' })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
      sessionId: 'new-session-1', contentId: 'article-1',
    })
    await click('关闭 Agent')
    await click('打开 Agent')
    expect(sessions.create).toHaveBeenCalledOnce()
    expect(sessions.open).toHaveBeenLastCalledWith('new-session-1')
  })

  it('replaces a linked conversation from the old shared workspace', async () => {
    mockDraftSession('old-shared-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('old-shared-session')
    workspaces.own('old-shared-session')
    await click('打开文章草稿')
    await click('打开 Agent')
    expect(sessions.open).not.toHaveBeenCalledWith('old-shared-session')
    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'publisher-workspace' })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
      sessionId: 'new-session-1', contentId: 'article-1',
    })
  })

  it('closes and unbinds when the associated conversation is deleted while open', async () => {
    mockDraftSession('linked-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('linked-session')
    await ownProjectSession(workspaces, 'linked-session')
    await click('打开文章草稿')
    await click('打开 Agent')
    await act(async () => { sessions.remove('linked-session') })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
      sessionId: 'linked-session', contentId: null, bindingToken: 'token-linked-session',
    })
    expect(container!.textContent).toContain('打开 Agent')
  })

  it('closes and unbinds when the associated conversation is archived while open', async () => {
    mockDraftSession('linked-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('linked-session')
    await ownProjectSession(workspaces, 'linked-session')
    await click('打开文章草稿')
    await click('打开 Agent')
    await act(async () => { workspaces.archive('linked-session') })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
      sessionId: 'linked-session', contentId: null, bindingToken: 'token-linked-session',
    })
    expect(container!.textContent).toContain('打开 Agent')
  })

  it('does not create a conversation after navigation while the association lookup is still pending', async () => {
    const pending = deferred<{ contentId: string; sessionId: string | null }>()
    queryApi.mockImplementation((route: string) => {
      if (route === 'agent-draft-session/article-1') return pending.promise
      if (route === 'agent-workspace') return Promise.resolve({ path: AGENT_WORKSPACE_PATH })
      return Promise.resolve(undefined)
    })
    const { sessions } = await renderPublisher('extended')
    await click('打开文章草稿')
    await click('打开 Agent')
    await click('发布历史')
    await act(async () => { pending.resolve({ contentId: 'article-1', sessionId: null }) })
    expect(sessions.create).not.toHaveBeenCalled()
    expect(queryApi.mock.calls.filter(([route]) => route === 'agent-draft-bind')).toHaveLength(0)
  })

  it('releases a late bind result after navigation without opening the drawer', async () => {
    const pending = deferred<{ sessionId: string; contentId: string; bindingToken: string }>()
    queryApi.mockImplementation((route: string) => {
      if (route === 'agent-draft-session/article-1') return Promise.resolve({ contentId: 'article-1', sessionId: null })
      if (route === 'agent-workspace') return Promise.resolve({ path: AGENT_WORKSPACE_PATH })
      if (route === 'agent-draft-bind') return pending.promise
      return Promise.resolve(undefined)
    })
    const events: Array<{ open: boolean }> = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener(DRAWER_EVENT, listener)
    try {
      await renderPublisher('extended')
      await click('打开文章草稿')
      await click('打开 Agent')
      await click('发布历史')
      queryApi.mockResolvedValue(undefined)
      await act(async () => { pending.resolve({ sessionId: 'new-session-1', contentId: 'article-1', bindingToken: 'late-token' }) })
      expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
        sessionId: 'new-session-1', contentId: null, bindingToken: 'late-token',
      })
      expect(events.some(event => event.open === true)).toBe(false)
    } finally {
      window.removeEventListener(DRAWER_EVENT, listener)
    }
  })

  it('unbinds if the existing conversation session changes', async () => {
    mockDraftSession('linked-session')
    const { sessions, workspaces } = await renderPublisher('extended')
    sessions.add('linked-session')
    await ownProjectSession(workspaces, 'linked-session')
    await click('打开文章草稿')
    await click('打开 Agent')
    await act(async () => { sessions.changeCurrent('session-2') })
    expect(queryApi).toHaveBeenCalledWith('agent-draft-bind', {
      sessionId: 'linked-session', contentId: null, bindingToken: 'token-linked-session',
    })
    expect(container!.textContent).toContain('打开 Agent')
  })
})
