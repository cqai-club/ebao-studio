import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchPublisherSession } from '../src/client/session-navigation.ts'
import { api } from '../src/client/shared.tsx'

vi.mock('../src/client/shared.tsx', () => ({ api: vi.fn() }))
const lookup = vi.mocked(api)
const cleanups: (() => void)[] = []
afterEach(() => { for (const close of cleanups.splice(0)) close(); lookup.mockReset() })

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; for (const listener of listeners) listener() },
    listenerCount: () => listeners.size,
  }
}
function fixture() {
  const list = store({ ids: [] as string[], byId: {} as Record<string, { origin?: string }>, phase: 'ready' })
  const references = new Map<string, number>()
  const sessions = { list, retainInfo: (id: string) => ({ getSnapshot: () => ({ retainedBy: { mainView: references.get(id) ?? 0 } }) }) }
  const workspaceList = store({ phase: 'ready', items: [], archivedSessionIds: [] as string[] })
  const workspaces = { list: workspaceList }
  const panelInfo = store({ activePanelId: null as string | null })
  let navigation = new AbortController()
  const layout = {
    panelInfo,
    beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    selectPanel: (panel: string | null) => { layout.beginNavigation(); panelInfo.set({ activePanelId: panel }) },
  }
  const open = vi.fn()
  const close = watchPublisherSession(sessions as never, workspaces as never, layout as never, open)
  cleanups.push(close)
  let current: string | undefined
  const retain = (id: string, count: number, origin?: string) => {
    references.set(id, count)
    const snapshot = list.getSnapshot()
    list.set({ ...snapshot, ids: [...new Set([...snapshot.ids, id])], byId: { ...snapshot.byId, [id]: { origin } } })
  }
  const navigateSession = (id: string, origin?: string) => {
    retain(id, (references.get(id) ?? 0) + 1, origin)
    if (current) retain(current, (references.get(current) ?? 0) - 1)
    current = id
    layout.selectPanel(null)
  }
  return { list, workspaceList, layout, open, close, retain, navigateSession }
}
async function settle() { for (let index = 0; index < 5; index++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('Publisher navigation from a native session row', () => {
  it.each(['article', 'image-note', 'video'] as const)('restores the %s content without a mounted Publisher page', async contentType => {
    lookup.mockResolvedValue({ sessionId: 'owned', contentId: 'content-1', contentType })
    const host = fixture()
    host.navigateSession('owned')
    await settle()
    expect(host.open).toHaveBeenCalledExactlyOnceWith({ contentId: 'content-1', contentType })
    expect(lookup).toHaveBeenCalledExactlyOnceWith('agent-draft-content/owned', undefined, expect.any(AbortSignal))
  })

  it('waits until old and new main references have settled before looking up the new session', async () => {
    lookup.mockResolvedValue({ sessionId: 'second', contentId: 'second-content', contentType: 'article' })
    const host = fixture()
    host.layout.selectPanel('cqai-publisher')
    host.navigateSession('first')
    host.navigateSession('second')
    await settle()
    expect(lookup).toHaveBeenCalledExactlyOnceWith('agent-draft-content/second', undefined, expect.any(AbortSignal))
    expect(host.open).toHaveBeenCalledExactlyOnceWith({ contentId: 'second-content', contentType: 'article' })
  })

  it('does not interfere with an editor opening its Agent in the same synchronous navigation', async () => {
    const host = fixture()
    host.navigateSession('owned')
    host.layout.selectPanel('cqai-publisher')
    await settle()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('reopens the same session after leaving Publisher and ignores ordinary session updates', async () => {
    lookup.mockResolvedValue({ sessionId: 'owned', contentId: 'content-1', contentType: 'video' })
    const host = fixture()
    host.navigateSession('owned')
    await settle()
    host.list.set({ ...host.list.getSnapshot() })
    await settle()
    expect(lookup).toHaveBeenCalledTimes(1)
    host.layout.selectPanel('cqai-publisher')
    host.navigateSession('owned')
    await settle()
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('keeps ordinary, retired or source conversations on the ordinary conversation page', async () => {
    lookup.mockResolvedValue({ sessionId: 'ordinary', contentId: null, contentType: null })
    const host = fixture()
    host.navigateSession('ordinary')
    await settle()
    expect(host.open).not.toHaveBeenCalled()
    expect(host.layout.panelInfo.getSnapshot().activePanelId).toBeNull()
  })

  it('excludes archived conversations and subagents before making a request', async () => {
    const host = fixture()
    host.workspaceList.set({ ...host.workspaceList.getSnapshot(), archivedSessionIds: ['archived'] })
    host.navigateSession('archived')
    await settle()
    host.navigateSession('child', 'subagent')
    await settle()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('ignores a late response after the user opens another panel', async () => {
    const response = deferred<unknown>()
    lookup.mockReturnValue(response.promise)
    const host = fixture()
    host.navigateSession('owned')
    await settle()
    const signal = lookup.mock.calls[0][2]!
    host.layout.selectPanel('another-panel')
    response.resolve({ sessionId: 'owned', contentId: 'content-1', contentType: 'article' })
    await settle()
    expect(signal.aborted).toBe(true)
    expect(host.open).not.toHaveBeenCalled()
  })

  it('does not supersede an asynchronous Workspace navigation that has not changed the page yet', async () => {
    const response = deferred<unknown>()
    lookup.mockReturnValue(response.promise)
    const host = fixture()
    host.navigateSession('owned')
    await settle()
    const userNavigation = host.layout.beginNavigation()
    host.list.set({ ...host.list.getSnapshot() })
    response.resolve({ sessionId: 'owned', contentId: 'content-1', contentType: 'article' })
    await settle()
    expect(userNavigation.aborted).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(host.open).not.toHaveBeenCalled()
  })

  it('keeps a new selection when the previous session lookup finishes later', async () => {
    const first = deferred<unknown>()
    lookup.mockImplementation(route => route.endsWith('/first') ? first.promise
      : Promise.resolve({ sessionId: 'second', contentId: 'second-content', contentType: 'image-note' }))
    const host = fixture()
    host.navigateSession('first')
    await settle()
    host.navigateSession('second')
    await settle()
    first.resolve({ sessionId: 'first', contentId: 'first-content', contentType: 'article' })
    await settle()
    expect(host.open).toHaveBeenCalledExactlyOnceWith({ contentId: 'second-content', contentType: 'image-note' })
  })

  it('stops an in-flight lookup when the session is archived or the plugin is disposed', async () => {
    const response = deferred<unknown>()
    lookup.mockReturnValue(response.promise)
    const host = fixture()
    host.navigateSession('owned')
    await settle()
    host.workspaceList.set({ ...host.workspaceList.getSnapshot(), archivedSessionIds: ['owned'] })
    await settle()
    host.close()
    response.resolve({ sessionId: 'owned', contentId: 'content-1', contentType: 'article' })
    await settle()
    expect(host.open).not.toHaveBeenCalled()
    expect(host.list.listenerCount()).toBe(0)
    expect(host.workspaceList.listenerCount()).toBe(0)
    expect(host.layout.panelInfo.listenerCount()).toBe(0)
  })
})
