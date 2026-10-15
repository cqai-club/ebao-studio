// @vitest-environment jsdom
import { act, createElement, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotCore, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  createPublisherVisibilityProjector,
  getPublisherWorkspaceVisibilitySnapshot,
  refreshPublisherWorkspaceVisibility,
  registerPublisherWorkspaceVisibility,
  subscribePublisherWorkspaceVisibility,
} from '../src/client/internal-workspace-visibility.tsx'

const OWNED = { workspaceIds: ['publisher-workspace'], sessionIds: ['publisher-session', 'retired-session'] }
const disposers: (() => void)[] = []
let root: Root | undefined
let container: HTMLDivElement
let metadata: unknown
let request: ReturnType<typeof vi.fn>

function source<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (value: T) => { snapshot = value; listeners.forEach(listener => listener()) },
  }
}
function workspaceSnapshot(): WorkspaceSnapshot {
  return {
    phase: 'ready', state: 'idle', error: null,
    items: [
      { workspaceId: 'publisher-workspace', title: '多平台发布', path: '/publisher', sessionIds: ['publisher-session', 'source-session'], createdAt: 'a', updatedAt: 'a' },
      { workspaceId: 'ordinary-workspace', title: '多平台发布', path: '/ordinary', sessionIds: ['ordinary-session'], createdAt: 'a', updatedAt: 'a' },
    ],
    archivedSessionIds: ['retired-session', 'ordinary-archive'],
    pinnedSessionIds: ['publisher-session', 'ordinary-session'],
  } as unknown as WorkspaceSnapshot
}
function sessionSnapshot(): SessionListState {
  return {
    ids: ['publisher-session', 'retired-session', 'source-session', 'ordinary-session'],
    byId: Object.fromEntries(['publisher-session', 'retired-session', 'source-session', 'ordinary-session'].map(id => [id, {
      id, displayTitle: id, cwd: id === 'ordinary-session' ? '/ordinary' : '/publisher',
      retainedBy: id === 'publisher-session' ? { publisherView: 1 } : {},
      running: false, blank: false, updatedAt: 5,
    }])),
    phase: 'ready',
    projectionsBySession: { 'publisher-session': { state: 'ready', error: null, values: {} }, 'source-session': { state: 'ready', error: null, values: {} } },
  } as unknown as SessionListState
}
function WorkspaceBrowser(props: any) {
  const workspaces = props.useWorkspaces((state: WorkspaceSnapshot) => state, props.equality)
  const sessions = props.useSessions((state: SessionListState) => state, props.equality)
  return <section data-workspaces={JSON.stringify(workspaces.items.map((row: any) => row.workspaceId))}
    data-sessions={JSON.stringify(sessions.ids)}
    data-pinned={JSON.stringify(workspaces.pinnedSessionIds)}>
    {props.renderSlot('sidebar.workspaces.directoryFlow', { open: false })}
    <button onClick={async () => {
      const result = await props.searchSessions('query', new AbortController().signal)
      props.onSearch(result)
    }}>Search</button>
  </section>
}
function WorkspacePicker(props: any) {
  return <nav data-picker={JSON.stringify(props.useWorkspaces((state: WorkspaceSnapshot) => state.items).map((row: any) => row.workspaceId))}/>
}

function fixture(options: { deferBrowser?: boolean; customBrowser?: boolean } = {}) {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'conversation.hero.workspace': { kind: 'single', scope: 'root' },
  } }, (() => null) as any)
  const registerBrowser = (component: unknown = WorkspaceBrowser) => core.register({
    name: 'sidebar.workspaces', locale: 'workspace', registrant: options.customBrowser ? 'some-custom-plugin' : '@deepseek-ai/dsh-client-ui-workspace',
    children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
  }, component as any)
  if (!options.deferBrowser) registerBrowser(options.customBrowser ? function CustomWorkspaceBrowser() { return <span>custom</span> } : WorkspaceBrowser)
  core.register({
    name: 'conversation.hero.workspace', locale: 'workspace', registrant: '@deepseek-ai/dsh-client-ui-workspace',
    children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
  }, WorkspacePicker as any)
  const workspaces = source(workspaceSnapshot())
  const sessions = source(sessionSnapshot())
  const ctx = { slots: {
    entriesOfSlot: core.entriesOfSlot.bind(core),
    subscribe: core.subscribe.bind(core),
    register: core.register.bind(core),
  }, workspaces: { list: workspaces }, sessions: { list: sessions } } as unknown as Context
  const props = {
    equality: undefined as ((a: any, b: any) => boolean) | undefined,
    useWorkspaces: vi.fn(<S,>(select: (state: WorkspaceSnapshot) => S, _equal?: (a: S, b: S) => boolean) => useSyncExternalStore(workspaces.subscribe, () => select(workspaces.getSnapshot()))),
    useSessions: vi.fn(<S,>(select: (state: SessionListState) => S, _equal?: (a: S, b: S) => boolean) => useSyncExternalStore(sessions.subscribe, () => select(sessions.getSnapshot()))),
    renderSlot: vi.fn(() => <aside>native child</aside>),
    actions: { untouched: vi.fn() }, useStore: vi.fn(),
    searchSessions: vi.fn(async () => ({
      items: ['publisher-session', 'source-session', 'ordinary-session'].map(sessionId => ({ sessionId, snippet: 'query' })), hasMore: true,
    })),
    onSearch: vi.fn(),
  }
  function Outlet({ slot }: { slot: 'sidebar.workspaces' | 'conversation.hero.workspace' }) {
    useSyncExternalStore(listener => core.subscribe(slot, listener), () => core.getVersion(slot))
    const component = core.entriesOfSlot(slot)[0]?.component as ComponentType<any>
    return component ? createElement(component, props) : null
  }
  return { core, ctx, props, workspaces, sessions, Outlet, registerBrowser }
}

async function flush() {
  await act(async () => { await refreshPublisherWorkspaceVisibility(); await Promise.resolve() })
}
async function mount(element: React.ReactNode) {
  root = createRoot(container)
  await act(async () => { root!.render(element); await Promise.resolve() })
}
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  metadata = OWNED
  request = vi.fn(async () => ({
    ok: true, headers: { get: () => 'application/json' }, json: async () => metadata,
  }))
  vi.stubGlobal('fetch', request)
  container = document.createElement('div')
  document.body.append(container)
})
afterEach(async () => {
  await act(async () => { root?.unmount(); root = undefined; disposers.splice(0).reverse().forEach(dispose => dispose()) })
  container.remove()
  vi.unstubAllGlobals()
})

describe('Publisher internal workspace display projection', () => {
  it('hides only durable ownership identities, keeping same-name workspaces and same-cwd source sessions', () => {
    const project = createPublisherVisibilityProjector(OWNED)
    const workspaces = workspaceSnapshot()
    const sessions = sessionSnapshot()
    const visibleWorkspaces = project.workspaces(workspaces)
    expect(visibleWorkspaces.items.map(row => row.workspaceId)).toEqual(['ordinary-workspace'])
    expect(visibleWorkspaces.items[0]).toBe(workspaces.items[1])
    expect(visibleWorkspaces.archivedSessionIds).toEqual(['ordinary-archive'])
    expect(visibleWorkspaces.pinnedSessionIds).toEqual(['ordinary-session'])
    const visibleSessions = project.sessions(sessions)
    expect(visibleSessions.ids).toEqual(['source-session', 'ordinary-session'])
    expect(visibleSessions.byId['source-session']).toBe(sessions.byId['source-session'])
    expect(visibleSessions.byId['source-session']?.cwd).toBe('/publisher')
    expect(visibleSessions.projectionsBySession).toEqual({ 'source-session': sessions.projectionsBySession['source-session'] })
    expect(sessions.ids).toContain('publisher-session')
    expect(workspaces.items).toHaveLength(2)
  })

  it('keeps immutable selector identities stable and preserves untouched snapshots', () => {
    const project = createPublisherVisibilityProjector(OWNED)
    const workspaces = workspaceSnapshot()
    const sessions = sessionSnapshot()
    expect(project.workspaces(workspaces)).toBe(project.workspaces(workspaces))
    expect(project.sessions(sessions)).toBe(project.sessions(sessions))
    const ordinaryProject = createPublisherVisibilityProjector({ workspaceIds: [], sessionIds: [] })
    expect(ordinaryProject.workspaces(workspaces)).toBe(workspaces)
    expect(ordinaryProject.sessions(sessions)).toBe(sessions)
  })

  it('removes owned sessions from ordinary accounts while preserving their other fields', () => {
    const project = createPublisherVisibilityProjector({ workspaceIds: [], sessionIds: OWNED.sessionIds })
    const original = workspaceSnapshot()
    const projected = project.workspaces(original)
    expect(projected.items[0].sessionIds).toEqual(['source-session'])
    expect(projected.items[0].path).toBe('/publisher')
    expect(original.items[0].sessionIds).toEqual(['publisher-session', 'source-session'])
  })

  it('filters content search without changing snippet, result limit state, or unrelated result identity', () => {
    const project = createPublisherVisibilityProjector(OWNED)
    const row = { sessionId: 'source-session', snippet: 'literal match' }
    const result = { items: [{ sessionId: 'publisher-session', snippet: 'owned match' }, row], hasMore: true, limit: 50 }
    expect(project.search(result)).toEqual({ items: [row], hasMore: true, limit: 50 })
    expect(project.search(result).items[0]).toBe(row)
    const ordinary = { items: [row], hasMore: false }
    expect(project.search(ordinary)).toBe(ordinary)
  })
})


function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function response(value: unknown) {
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => value }
}
async function ticks() { for (let index = 0; index < 5; index += 1) await Promise.resolve() }

describe('DS rc.2 component compatibility adapter', () => {
  it('synchronously marks a previously empty ready snapshot pending while new ownership is in flight', async () => {
    metadata = { workspaceIds: [], sessionIds: [] }
    const f = fixture()
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    const oldValue = getPublisherWorkspaceVisibilitySnapshot().value
    const pending = deferred<ReturnType<typeof response>>()
    request.mockReturnValueOnce(pending.promise)
    let operation!: Promise<void>
    await act(async () => {
      operation = refreshPublisherWorkspaceVisibility()
      expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'pending', value: oldValue })
      expect(getPublisherWorkspaceVisibilitySnapshot().value).toBe(oldValue)
      await ticks()
    })
    await act(async () => { pending.resolve(response(OWNED)); await operation })
    expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'ready', value: OWNED })
  })

  it('keeps the last exclusions pending through coalesced reentry and publishes only the final successful round', async () => {
    const f = fixture()
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    const oldValue = getPublisherWorkspaceVisibilitySnapshot().value
    const first = deferred<ReturnType<typeof response>>()
    const second = deferred<ReturnType<typeof response>>()
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const snapshots: ReturnType<typeof getPublisherWorkspaceVisibilitySnapshot>[] = []
    disposers.push(subscribePublisherWorkspaceVisibility(() => snapshots.push(getPublisherWorkspaceVisibilitySnapshot())))
    let operation!: Promise<void>
    await act(async () => { operation = refreshPublisherWorkspaceVisibility(); await ticks() })
    const sameOperation = refreshPublisherWorkspaceVisibility()
    expect(sameOperation).toBe(operation)
    await act(async () => {
      first.resolve(response({ workspaceIds: ['intermediate-workspace'], sessionIds: ['intermediate-session'] }))
      await ticks()
    })
    expect(getPublisherWorkspaceVisibilitySnapshot().phase).toBe('pending')
    expect(getPublisherWorkspaceVisibilitySnapshot().value).toBe(oldValue)
    expect(snapshots.map(snapshot => snapshot.phase)).toEqual(['pending'])
    expect(container.querySelector('section')?.getAttribute('data-workspaces')).toBe('["ordinary-workspace"]')
    expect(container.querySelector('section')?.getAttribute('data-sessions')).toBe('["source-session","ordinary-session"]')
    const final = { workspaceIds: ['publisher-workspace'], sessionIds: ['new-owned', ...OWNED.sessionIds] }
    await act(async () => { second.resolve(response(final)); await operation })
    expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'ready', value: final })
    expect(snapshots.map(snapshot => snapshot.phase)).toEqual(['pending', 'ready'])
  })

  it('retains all existing exclusions on deferred refresh failure and recovers readiness after a successful retry', async () => {
    const f = fixture()
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    const ready = getPublisherWorkspaceVisibilitySnapshot()
    const pending = deferred<ReturnType<typeof response>>()
    request.mockReturnValueOnce(pending.promise)
    let operation!: Promise<void>
    await act(async () => { operation = refreshPublisherWorkspaceVisibility(); await ticks() })
    expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'pending', value: ready.value })
    expect(getPublisherWorkspaceVisibilitySnapshot().value).toBe(ready.value)
    expect(container.querySelector('section')?.getAttribute('data-sessions')).not.toContain('publisher-session')
    await act(async () => { pending.reject(new Error('offline')); await operation })
    expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'pending', value: ready.value })
    expect(container.querySelector('section')?.getAttribute('data-workspaces')).toBe('["ordinary-workspace"]')
    expect(container.querySelector('section')?.getAttribute('data-sessions')).not.toContain('publisher-session')
    await flush()
    expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual(ready)
    expect(getPublisherWorkspaceVisibilitySnapshot().value).toBe(ready.value)
  })

  it('restores both native entries and releases metadata during actual Cordis inactive-fiber cleanup', async () => {
    const f = fixture()
    const ctx = new Context()
    ctx.provide('sessions', (f.ctx as any).sessions)
    ctx.provide('workspaces', (f.ctx as any).workspaces)
    const inactiveCodes: string[] = []
    class SlotsService extends Service {
      constructor() { super(ctx, 'slots') }
      entriesOfSlot(key: string) { return f.core.entriesOfSlot(key) }
      subscribe(key: string, listener: () => void) { return f.core.subscribe(key, listener) }
      register(options: any, component: any) {
        try {
          // This is the real SlotRegistry method's public Cordis effect contract.
          return this.ctx.effect(() => f.core.register(options, component))
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error) inactiveCodes.push(String(error.code))
          throw error
        }
      }
    }
    new SlotsService()
    try {
      const owner = await ctx.plugin({
        name: 'publisher-visibility-unload-fixture', inject: ['slots'],
        apply(pluginCtx: Context) {
          pluginCtx.effect(() => registerPublisherWorkspaceVisibility(pluginCtx))
        },
      })
      await flush()
      expect(f.core.entriesOfSlot('sidebar.workspaces')[0]?.component).not.toBe(WorkspaceBrowser)
      expect(f.core.entriesOfSlot('conversation.hero.workspace')[0]?.component).not.toBe(WorkspacePicker)
      await owner.dispose()
      expect(inactiveCodes).toEqual(['INACTIVE_EFFECT', 'INACTIVE_EFFECT'])
      expect(f.core.entriesOfSlot('sidebar.workspaces')[0]?.component).toBe(WorkspaceBrowser)
      expect(f.core.entriesOfSlot('conversation.hero.workspace')[0]?.component).toBe(WorkspacePicker)
      expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'pending', value: { workspaceIds: [], sessionIds: [] } })
      const requestCount = request.mock.calls.length
      await refreshPublisherWorkspaceVisibility()
      window.dispatchEvent(new Event('cqai-publisher-content-change'))
      await Promise.resolve()
      expect(request).toHaveBeenCalledTimes(requestCount)
      expect(f.core.entries('sidebar.workspaces')).toHaveLength(1)
      expect(f.core.entries('conversation.hero.workspace')).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('finishes all restore and metadata release even if one registry notification fails unexpectedly', async () => {
    const f = fixture()
    const originalRegister = f.ctx.slots.register
    const dispose = registerPublisherWorkspaceVisibility(f.ctx)
    await flush()
    f.ctx.slots.register = (() => { throw new Error('notification failure') }) as typeof originalRegister
    expect(() => dispose()).toThrow('Publisher workspace visibility cleanup failed')
    expect(f.core.entriesOfSlot('sidebar.workspaces')[0]?.component).toBe(WorkspaceBrowser)
    expect(f.core.entriesOfSlot('conversation.hero.workspace')[0]?.component).toBe(WorkspacePicker)
    expect(getPublisherWorkspaceVisibilitySnapshot().phase).toBe('pending')
    const requestCount = request.mock.calls.length
    await refreshPublisherWorkspaceVisibility()
    expect(request).toHaveBeenCalledTimes(requestCount)
  })

  it('forwards native selector equality functions through both projected hooks', async () => {
    const f = fixture()
    const equality = vi.fn(Object.is)
    f.props.equality = equality
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    expect(f.props.useWorkspaces.mock.calls.some(call => call[1] === equality)).toBe(true)
    expect(f.props.useSessions.mock.calls.some(call => call[1] === equality)).toBe(true)
  })

  it('does not request metadata for unsupported surfaces with no active registration', async () => {
    const dispose = registerPublisherWorkspaceVisibility({ slots: {} } as unknown as Context)
    await refreshPublisherWorkspaceVisibility()
    expect(request).not.toHaveBeenCalled()
    dispose()
  })

  it('updates already mounted native browser and picker while preserving entry, child authorization and actions', async () => {
    const f = fixture()
    const entry = f.core.entriesOfSlot('sidebar.workspaces')[0]
    const children = entry.children
    await mount(<><f.Outlet slot="sidebar.workspaces"/><f.Outlet slot="conversation.hero.workspace"/></>)
    expect(container.querySelector('section')?.getAttribute('data-workspaces')).toContain('publisher-workspace')
    await act(async () => { disposers.push(registerPublisherWorkspaceVisibility(f.ctx)); await Promise.resolve() })
    await flush()
    expect(f.core.entriesOfSlot('sidebar.workspaces')[0]).toBe(entry)
    expect(entry.children).toBe(children)
    expect(f.core.entries('sidebar.workspaces')).toHaveLength(1)
    expect(container.querySelector('section')?.getAttribute('data-workspaces')).toBe('["ordinary-workspace"]')
    expect(container.querySelector('section')?.getAttribute('data-sessions')).toBe('["source-session","ordinary-session"]')
    expect(container.querySelector('nav')?.getAttribute('data-picker')).toBe('["ordinary-workspace"]')
    expect(f.props.renderSlot).toHaveBeenLastCalledWith('sidebar.workspaces.directoryFlow', { open: false })
    expect(container.textContent).toContain('native child')
    expect(f.props.actions.untouched).not.toHaveBeenCalled()
    await act(async () => { container.querySelector('button')?.click(); await Promise.resolve() })
    expect(f.props.onSearch).toHaveBeenCalledWith({
      items: [{ sessionId: 'source-session', snippet: 'query' }, { sessionId: 'ordinary-session', snippet: 'query' }], hasMore: true,
    })
  })

  it('responds to metadata changes from content events without requiring the Publisher page', async () => {
    const f = fixture()
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    metadata = { workspaceIds: [], sessionIds: [] }
    await act(async () => { window.dispatchEvent(new Event('cqai-publisher-content-change')); await refreshPublisherWorkspaceVisibility() })
    expect(container.querySelector('section')?.getAttribute('data-workspaces')).toContain('publisher-workspace')
    expect(container.querySelector('section')?.getAttribute('data-sessions')).toContain('publisher-session')
  })

  it('does not fetch on mere retained-source updates but refreshes when catalog identities change', async () => {
    const f = fixture()
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    const initialRequests = request.mock.calls.length
    const original = f.sessions.getSnapshot()
    f.sessions.set({ ...original, byId: { ...original.byId, 'source-session': { ...original.byId['source-session'], retainedBy: { mainView: 1 } } } })
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(initialRequests)
    f.sessions.set({ ...original, ids: original.ids.filter(id => id !== 'retired-session') })
    await flush()
    expect(request.mock.calls.length).toBeGreaterThan(initialRequests)
  })

  it('handles late official registration and overlapping HMR without double wrapping or premature restore', async () => {
    const f = fixture({ deferBrowser: true })
    const disposeFirst = registerPublisherWorkspaceVisibility(f.ctx)
    disposers.push(disposeFirst)
    await act(async () => { f.registerBrowser(); await Promise.resolve() })
    const entry = f.core.entriesOfSlot('sidebar.workspaces')[0]
    const wrapper = entry.component
    const disposeSecond = registerPublisherWorkspaceVisibility(f.ctx)
    disposers.push(disposeSecond)
    expect(entry.component).toBe(wrapper)
    disposeFirst()
    expect(entry.component).toBe(wrapper)
    await flush()
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    expect(container.querySelector('section')?.getAttribute('data-sessions')).not.toContain('publisher-session')
    await act(async () => { disposeSecond(); await Promise.resolve() })
    expect(entry.component).toBe(WorkspaceBrowser)
    expect(f.core.entries('sidebar.workspaces')).toHaveLength(1)
    expect(container.querySelector('section')?.getAttribute('data-sessions')).toContain('publisher-session')
  })

  it('leaves another plugin occupant and unsupported SDK structures unchanged', async () => {
    const f = fixture({ customBrowser: true })
    const entry = f.core.entriesOfSlot('sidebar.workspaces')[0]
    const original = entry.component
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    expect(entry.component).toBe(original)
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    expect(container.textContent).toBe('custom')
    const unsupported = registerPublisherWorkspaceVisibility({ slots: {} } as unknown as Context)
    expect(() => unsupported()).not.toThrow()
  })

  it('does not overwrite a newer component replacement during unload', () => {
    const f = fixture()
    const dispose = registerPublisherWorkspaceVisibility(f.ctx)
    const entry = f.core.entriesOfSlot('sidebar.workspaces')[0]
    const replacement = () => null
    entry.component = replacement
    dispose()
    expect(entry.component).toBe(replacement)
  })

  it('fails open for unavailable or malformed metadata and preserves the last valid ownership on transient failures', async () => {
    const f = fixture()
    request.mockResolvedValue({ ok: false, headers: { get: () => null } })
    disposers.push(registerPublisherWorkspaceVisibility(f.ctx))
    await flush()
    await mount(<f.Outlet slot="sidebar.workspaces"/>)
    expect(getPublisherWorkspaceVisibilitySnapshot().phase).toBe('pending')
    expect(container.querySelector('section')?.getAttribute('data-sessions')).toContain('publisher-session')
    request.mockImplementation(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => OWNED }))
    await flush()
    const ready = getPublisherWorkspaceVisibilitySnapshot()
    request.mockImplementation(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ workspaceIds: [null], sessionIds: [] }) }))
    await flush()
    expect(getPublisherWorkspaceVisibilitySnapshot()).toEqual({ phase: 'pending', value: ready.value })
    expect(getPublisherWorkspaceVisibilitySnapshot().value).toBe(ready.value)
    expect(container.querySelector('section')?.getAttribute('data-sessions')).not.toContain('publisher-session')
  })

  it('removes subscriptions and stops further event-driven requests when unloaded', async () => {
    const f = fixture()
    const dispose = registerPublisherWorkspaceVisibility(f.ctx)
    disposers.push(dispose)
    await flush()
    dispose()
    const count = request.mock.calls.length
    window.dispatchEvent(new Event('cqai-publisher-content-change'))
    f.sessions.set({ ...f.sessions.getSnapshot(), ids: [] })
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(count)
    expect(f.core.entriesOfSlot('sidebar.workspaces')[0]?.component).toBe(WorkspaceBrowser)
  })
})
