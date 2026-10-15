import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPublisherNewConversationGuard } from '../src/client/internal-workspace-navigation.ts'

const metadata = vi.hoisted(() => ({
  snapshot: { phase: 'ready' as 'pending' | 'ready', value: { workspaceIds: ['publisher'], sessionIds: ['owned'] } },
  refresh: vi.fn<() => Promise<void>>(),
}))
vi.mock('../src/client/internal-workspace-visibility.tsx', () => ({
  getPublisherWorkspaceVisibilitySnapshot: () => metadata.snapshot,
  refreshPublisherWorkspaceVisibility: metadata.refresh,
}))
const cleanups: (() => void)[] = []
beforeEach(() => {
  metadata.snapshot = { phase: 'ready', value: { workspaceIds: ['publisher'], sessionIds: ['owned'] } }
  metadata.refresh.mockReset().mockResolvedValue(undefined)
})
afterEach(() => cleanups.splice(0).reverse().forEach(dispose => dispose()))

function workspace(workspaceId: string, sessionIds: string[], createdAt = '2026-01-01T00:00:00.000Z') {
  return { workspaceId, sessionIds, path: `/${workspaceId}`, name: workspaceId, createdAt, updatedAt: createdAt }
}
function fixture(options: { current?: string; items?: ReturnType<typeof workspace>[]; times?: Record<string, number> } = {}) {
  const items = options.items ?? [workspace('publisher', ['owned']), workspace('ordinary', ['ordinary-session'])]
  const times = options.times ?? { owned: 1000, 'ordinary-session': 100 }
  let current = options.current
  const sessionSnapshot = { phase: 'ready', ids: Object.keys(times),
    byId: Object.fromEntries(Object.entries(times).map(([id, updatedAt]) => [id, { id, updatedAt }])), projectionsBySession: {} }
  const workspaceSnapshot = { phase: 'ready', items, archivedSessionIds: [], pinnedSessionIds: [] }
  const sessions = {
    list: { getSnapshot: () => sessionSnapshot },
    retainInfo: (id: string) => ({ getSnapshot: () => ({ retainedBy: { mainView: id === current ? 1 : 0 } }) }),
  }
  const workspaces = { list: { getSnapshot: () => workspaceSnapshot }, create: vi.fn() }
  const original = vi.fn(function (this: unknown, workspaceId?: string) { return { receiver: this, workspaceId } })
  const uiWorkspace = { startSession: original }
  let navigation = new AbortController()
  let panel: string | null = 'cqai-publisher'
  const layout = {
    beginNavigation: vi.fn(() => { navigation.abort(); navigation = new AbortController(); return navigation.signal }),
    selectPanel: vi.fn((next: string | null) => { layout.beginNavigation(); panel = next }),
    panelInfo: { getSnapshot: () => ({ activePanelId: panel }) },
  }
  const ctx = { layout }
  const services = { sessions, workspaces, uiWorkspace }
  const install = () => {
    const close = registerPublisherNewConversationGuard(ctx as never, services as never)
    cleanups.push(close)
    return close
  }
  const close = install()
  return { uiWorkspace, original, sessions, workspaces, sessionSnapshot, workspaceSnapshot, layout, ctx, services, close, install,
    selectSession: (id: string) => { current = id; layout.selectPanel(null) } }
}
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function settle() { for (let index = 0; index < 5; index++) await Promise.resolve() }

describe('Publisher internal Workspace New Conversation guard', () => {
  it('starts in the most recent ordinary Workspace when the current conversation belongs to Publisher', () => {
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('ordinary')
    expect(host.original.mock.results[0].value.receiver).toBe(host.uiWorkspace)
  })

  it('excludes the newest hidden Workspace from implicit recent navigation', () => {
    const host = fixture({ items: [workspace('publisher', ['owned']), workspace('older', ['old']), workspace('newer', ['new'])],
      times: { owned: 1000, old: 20, new: 50 } })
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('newer')
  })

  it('preserves an ordinary current Workspace before the most recent alternative', () => {
    const host = fixture({ current: 'old', items: [workspace('publisher', ['owned']), workspace('older', ['old']), workspace('newer', ['new'])],
      times: { owned: 1000, old: 20, new: 50 } })
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('older')
  })

  it('passes an explicit ordinary target through without overriding it with current or recent state', () => {
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession('explicit' as never)
    expect(host.original).toHaveBeenCalledExactlyOnceWith('explicit')
    expect(metadata.refresh).not.toHaveBeenCalled()
  })

  it('replaces an explicit internal target with the ordinary fallback', () => {
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession('publisher' as never)
    expect(host.original).toHaveBeenCalledExactlyOnceWith('ordinary')
  })

  it('uses creation timestamps for empty ordinary Workspaces and Host order for ties', () => {
    const host = fixture({ items: [workspace('publisher', ['owned']),
      workspace('first', [], '2026-03-01T00:00:00.000Z'), workspace('second', [], '2026-03-01T00:00:00.000Z'),
      workspace('old', [], '2026-02-01T00:00:00.000Z')], times: { owned: Date.parse('2026-04-01') } })
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('first')
  })

  it('keeps the page and creates nothing when only the internal Workspace exists', () => {
    const host = fixture({ current: 'owned', items: [workspace('publisher', ['owned'])], times: { owned: 1000 } })
    host.uiWorkspace.startSession()
    host.uiWorkspace.startSession('publisher' as never)
    expect(host.original).not.toHaveBeenCalled()
    expect(host.workspaces.create).not.toHaveBeenCalled()
    expect(host.layout.selectPanel).not.toHaveBeenCalled()
    expect(host.layout.panelInfo.getSnapshot().activePanelId).toBe('cqai-publisher')
  })

  it('keeps ordinary behavior unchanged when the Host reports no internal Workspace', () => {
    metadata.snapshot = { phase: 'ready', value: { workspaceIds: [], sessionIds: [] } }
    const host = fixture()
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('uses a known ordinary current Workspace even before catalog readiness', () => {
    const host = fixture({ current: 'ordinary-session' })
    host.workspaceSnapshot.phase = 'pending'
    host.sessionSnapshot.phase = 'pending'
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('ordinary')
  })

  it('does not inherit the internal current Workspace while ordinary catalog data is pending', () => {
    const host = fixture({ current: 'owned' })
    host.sessionSnapshot.phase = 'pending'
    host.uiWorkspace.startSession()
    expect(host.original).not.toHaveBeenCalled()
  })

  it('waits for pending ownership metadata before starting in the ordinary fallback', async () => {
    metadata.snapshot.phase = 'pending'
    const pending = deferred()
    metadata.refresh.mockReturnValue(pending.promise)
    const host = fixture({ current: 'owned' })
    expect(host.uiWorkspace.startSession()).toBeUndefined()
    expect(host.original).not.toHaveBeenCalled()
    expect(metadata.refresh).toHaveBeenCalledOnce()
    metadata.snapshot.phase = 'ready'
    pending.resolve()
    await settle()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('ordinary')
  })

  it.each(['pending', 'rejected'])('leaves the page intact when metadata refresh remains %s', async failure => {
    metadata.snapshot.phase = 'pending'
    if (failure === 'rejected') metadata.refresh.mockRejectedValue(new Error('offline'))
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession()
    await settle()
    expect(host.original).not.toHaveBeenCalled()
    expect(host.workspaces.create).not.toHaveBeenCalled()
    expect(host.layout.selectPanel).not.toHaveBeenCalled()
  })

  it('does not steal later panel navigation after pending metadata completes', async () => {
    metadata.snapshot.phase = 'pending'
    const pending = deferred()
    metadata.refresh.mockReturnValue(pending.promise)
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession()
    host.layout.selectPanel('another-panel')
    metadata.snapshot.phase = 'ready'
    pending.resolve()
    await settle()
    expect(host.original).not.toHaveBeenCalled()
    expect(host.layout.panelInfo.getSnapshot().activePanelId).toBe('another-panel')
  })

  it('keeps a later explicit New Conversation when an older metadata wait finishes', async () => {
    metadata.snapshot.phase = 'pending'
    const pending = deferred()
    metadata.refresh.mockReturnValue(pending.promise)
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession()
    metadata.snapshot.phase = 'ready'
    host.uiWorkspace.startSession('explicit' as never)
    pending.resolve()
    await settle()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('explicit')
  })

  it('restores exactly its own method and ignores a pending operation after unload', async () => {
    metadata.snapshot.phase = 'pending'
    const pending = deferred()
    metadata.refresh.mockReturnValue(pending.promise)
    const host = fixture({ current: 'owned' })
    host.uiWorkspace.startSession()
    host.close()
    expect(host.uiWorkspace.startSession).toBe(host.original)
    metadata.snapshot.phase = 'ready'
    pending.resolve()
    await settle()
    expect(host.original).not.toHaveBeenCalled()
  })

  it('does not overwrite a method another owner replaced while installed', () => {
    const host = fixture()
    const replacement = vi.fn()
    host.uiWorkspace.startSession = replacement
    host.close()
    expect(host.uiWorkspace.startSession).toBe(replacement)
  })

  it('shares one wrapper across overlapping client generations and restores on final unload', () => {
    const host = fixture({ current: 'owned' })
    const wrapper = host.uiWorkspace.startSession
    const closeSecond = host.install()
    expect(host.uiWorkspace.startSession).toBe(wrapper)
    host.close()
    host.uiWorkspace.startSession()
    expect(host.original).toHaveBeenCalledExactlyOnceWith('ordinary')
    closeSecond()
    expect(host.uiWorkspace.startSession).toBe(host.original)
  })

  it('wraps and restores an actual Cordis Service despite fresh traced method identities', () => {
    const host = fixture({ current: 'owned' })
    host.close()
    const ctx = new Context()
    ctx.provide('layout', host.layout)
    const calls: string[] = []
    class WorkspaceService extends Service {
      constructor() { super(ctx, 'uiWorkspace') }
      startSession(workspaceId?: string) {
        calls.push(workspaceId ?? 'implicit')
        // Verify the ordinary implementation still receives a valid traced service receiver.
        this.ctx.layout.panelInfo.getSnapshot()
      }
    }
    const service = new WorkspaceService()
    const original = service.startSession
    expect(ctx.uiWorkspace.startSession).not.toBe(ctx.uiWorkspace.startSession)
    const close = registerPublisherNewConversationGuard(ctx, { ...host.services, uiWorkspace: ctx.uiWorkspace } as never)
    cleanups.push(close)
    ctx.uiWorkspace.startSession()
    expect(calls).toEqual(['ordinary'])
    close()
    expect(Object.hasOwn(service, 'startSession')).toBe(false)
    expect(service.startSession).toBe(original)
    ctx.uiWorkspace.startSession()
    expect(calls).toEqual(['ordinary', 'implicit'])
  })
})
