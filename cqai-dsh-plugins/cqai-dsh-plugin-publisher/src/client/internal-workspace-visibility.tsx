/** DS rc.2 display adapter. No Host registration, Session lifetime, or files are changed. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SnapshotSelectorHook, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useMemo, useSyncExternalStore, type ComponentType } from 'react'
import { API } from '../protocol.ts'

export interface PublisherWorkspaceVisibility {
  workspaceIds: string[]
  sessionIds: string[]
}
export interface PublisherWorkspaceVisibilitySnapshot {
  phase: 'pending' | 'ready'
  value: PublisherWorkspaceVisibility
}
type SelectorHook<T> = SnapshotSelectorHook<T>
type SearchValue = { items: { sessionId: string; [key: string]: unknown }[]; hasMore: boolean }
type WorkspaceComponentProps = Record<string, unknown> & {
  useWorkspaces?: SelectorHook<WorkspaceSnapshot>
  useSessions?: SelectorHook<SessionListState>
  searchSessions?: (query: string, signal: AbortSignal) => Promise<SearchValue>
}
type Source = { getSnapshot(): unknown; subscribe(listener: () => void): () => void }
const TARGETS = ['sidebar.workspaces', 'conversation.hero.workspace'] as const
type Target = typeof TARGETS[number]
const MARK = Symbol.for('cqai-publisher.internal-workspace-visibility.rc2')
const EMPTY = (): PublisherWorkspaceVisibilitySnapshot => ({ phase: 'pending', value: { workspaceIds: [], sessionIds: [] } })

function decodeVisibility(value: unknown): PublisherWorkspaceVisibility {
  if (!value || typeof value !== 'object') throw new Error('Invalid Publisher visibility metadata')
  const data = value as Partial<PublisherWorkspaceVisibility>
  const normalize = (ids: unknown): string[] => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 512)) {
      throw new Error('Invalid Publisher visibility identities')
    }
    return [...new Set(ids as string[])].sort()
  }
  return { workspaceIds: normalize(data.workspaceIds), sessionIds: normalize(data.sessionIds) }
}

class VisibilityStore {
  private snapshot = EMPTY()
  private listeners = new Set<() => void>()
  private operation: Promise<void> | undefined
  private controller: AbortController | undefined
  private dirty = false
  owners = 0
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  refresh = (): Promise<void> => {
    if (this.owners === 0) return Promise.resolve()
    this.dirty = true
    const markPending = () => {
      if (this.snapshot.phase === 'pending') return
      // Keep existing display exclusions while navigation waits for fresh ownership.
      this.snapshot = { phase: 'pending', value: this.snapshot.value }
      this.listeners.forEach(listener => listener())
    }
    if (this.operation) {
      markPending()
      return this.operation
    }
    const controller = new AbortController()
    this.controller = controller
    this.operation = (async () => {
      // Install the operation before notifying pending subscribers, including reentrant callers.
      await Promise.resolve()
      if (controller.signal.aborted) return
      do {
        this.dirty = false
        try {
          const response = await fetch(API + '/internal-workspace-visibility', { signal: controller.signal })
          if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
            throw new Error('Publisher visibility unavailable')
          }
          const value = decodeVisibility(await response.json())
          if (controller.signal.aborted) return
          // A concurrent mutation requested another round; its ownership must settle first.
          if (!this.dirty) {
            const stableValue = JSON.stringify(value) === JSON.stringify(this.snapshot.value) ? this.snapshot.value : value
            this.snapshot = { phase: 'ready', value: stableValue }
            this.listeners.forEach(listener => listener())
          }
        } catch {
          // An older Host or unavailable contract keeps the last display projection
          // while ordinary navigation cannot inherit an unverified internal folder.
          if (controller.signal.aborted) return
        }
      } while (this.dirty)
    })().finally(() => {
      if (this.controller === controller) {
        this.controller = undefined
        this.operation = undefined
      }
    })
    markPending()
    return this.operation
  }
  release(): void {
    if (--this.owners > 0) return
    this.controller?.abort()
    this.controller = undefined
    this.operation = undefined
    this.dirty = false
    this.snapshot = EMPTY()
    this.listeners.forEach(listener => listener())
  }
}
// Keep one metadata source across overlapping client HMR generations.
const STORE = Symbol.for('cqai-publisher.internal-workspace-visibility.store.rc2')
const globals = globalThis as unknown as Record<symbol, unknown>
const store = (globals[STORE] ??= new VisibilityStore()) as VisibilityStore
export const getPublisherWorkspaceVisibilitySnapshot = store.getSnapshot
export const subscribePublisherWorkspaceVisibility = store.subscribe
export const refreshPublisherWorkspaceVisibility = store.refresh

/** Immutable display projections; ordinary source conversations survive even in the same cwd. */
export function createPublisherVisibilityProjector(visibility: PublisherWorkspaceVisibility) {
  const hiddenWorkspaces = new Set(visibility.workspaceIds)
  const hiddenSessions = new Set(visibility.sessionIds)
  const workspaceCache = new WeakMap<WorkspaceSnapshot, WorkspaceSnapshot>()
  const sessionCache = new WeakMap<SessionListState, SessionListState>()
  const filterIds = <T extends string>(ids: readonly T[]): readonly T[] => {
    const result = ids.filter(id => !hiddenSessions.has(id))
    return result.length === ids.length ? ids : result
  }
  return {
    workspaces(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
      if (!snapshot || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.archivedSessionIds)
        || !Array.isArray(snapshot.pinnedSessionIds)
        || snapshot.items.some(item => !item || !Array.isArray(item.sessionIds))) return snapshot
      const cached = workspaceCache.get(snapshot)
      if (cached) return cached
      let changed = false
      const items = snapshot.items.filter(item => !hiddenWorkspaces.has(item.workspaceId)).map(item => {
        const sessionIds = filterIds(item.sessionIds)
        if (sessionIds === item.sessionIds) return item
        changed = true
        return { ...item, sessionIds }
      })
      const archivedSessionIds = filterIds(snapshot.archivedSessionIds)
      const pinnedSessionIds = filterIds(snapshot.pinnedSessionIds)
      const result = items.length !== snapshot.items.length || changed
        || archivedSessionIds !== snapshot.archivedSessionIds || pinnedSessionIds !== snapshot.pinnedSessionIds
        ? { ...snapshot, items, archivedSessionIds, pinnedSessionIds } : snapshot
      workspaceCache.set(snapshot, result)
      return result
    },
    sessions(snapshot: SessionListState): SessionListState {
      if (!snapshot || !Array.isArray(snapshot.ids) || !snapshot.byId || !snapshot.projectionsBySession) return snapshot
      const cached = sessionCache.get(snapshot)
      if (cached) return cached
      const ids = filterIds(snapshot.ids) as typeof snapshot.ids
      const hasHidden = Object.keys(snapshot.byId).some(id => hiddenSessions.has(id))
        || Object.keys(snapshot.projectionsBySession).some(id => hiddenSessions.has(id))
      const result = ids !== snapshot.ids || hasHidden ? {
        ...snapshot, ids,
        byId: Object.fromEntries(Object.entries(snapshot.byId).filter(([id]) => !hiddenSessions.has(id))),
        projectionsBySession: Object.fromEntries(Object.entries(snapshot.projectionsBySession).filter(([id]) => !hiddenSessions.has(id))),
      } : snapshot
      sessionCache.set(snapshot, result)
      return result
    },
    search<T extends SearchValue>(result: T): T {
      if (!result || !Array.isArray(result.items)) return result
      const items = result.items.filter(item => !hiddenSessions.has(item.sessionId))
      return items.length === result.items.length ? result : { ...result, items }
    },
  }
}

interface AdapterRecord {
  original: ComponentType<WorkspaceComponentProps>
  wrapper: ComponentType<WorkspaceComponentProps>
  owners: Set<object>
}
type MarkedComponent = ComponentType<WorkspaceComponentProps> & { [MARK]?: AdapterRecord }
function adapterOf(component: unknown): AdapterRecord | undefined {
  return typeof component === 'function' ? (component as MarkedComponent)[MARK] : undefined
}
function isOfficialEntry(entry: StoredEntry, target: Target): boolean {
  const original = adapterOf(entry.component)?.original ?? entry.component
  const expected = target === 'sidebar.workspaces' ? 'WorkspaceBrowser' : 'WorkspacePicker'
  if (typeof original !== 'function' || original.name !== expected) return false
  if (entry.locale !== 'workspace') return false
  const child = target === 'sidebar.workspaces' ? 'sidebar.workspaces.directoryFlow' : 'conversation.hero.workspace.directoryFlow'
  if (!entry.children?.[child]) return false
  // Older loaders use a generic fiber name. The exact shipped name and children are the fallback contract.
  return !entry.registrant || entry.registrant.includes('dsh-client-ui-workspace')
    || !entry.registrant.includes('plugin')
}
function makeRecord(original: ComponentType<WorkspaceComponentProps>): AdapterRecord {
  const record = { original, owners: new Set<object>() } as AdapterRecord
  function PublisherWorkspaceVisibilityAdapter(props: WorkspaceComponentProps) {
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const projected = useMemo(() => createPublisherVisibilityProjector(snapshot.value), [snapshot])
    const adapted = useMemo(() => {
      const next = { ...props }
      if (typeof props.useWorkspaces === 'function') {
        const useWorkspaces = props.useWorkspaces
        next.useWorkspaces = <S,>(select: (state: WorkspaceSnapshot) => S, equal?: (a: S, b: S) => boolean): S =>
          useWorkspaces<S>((state: WorkspaceSnapshot) => select(projected.workspaces(state)), equal)
      }
      if (typeof props.useSessions === 'function') {
        const useSessions = props.useSessions
        next.useSessions = <S,>(select: (state: SessionListState) => S, equal?: (a: S, b: S) => boolean): S =>
          useSessions<S>((state: SessionListState) => select(projected.sessions(state)), equal)
      }
      if (typeof props.searchSessions === 'function') {
        const searchSessions = props.searchSessions
        next.searchSessions = async (query, signal) => {
          const result = await searchSessions(query, signal)
          // A response may arrive after a new content owner was durably published.
          return createPublisherVisibilityProjector(store.getSnapshot().value).search(result)
        }
      }
      return next
    }, [props, projected])
    return createElement(original, adapted)
  }
  record.wrapper = PublisherWorkspaceVisibilityAdapter
  Object.defineProperty(record.wrapper, MARK, { value: record })
  return record
}

/**
 * Rc.2 compatibility adapter over the public registration inspection face.
 * Keep the original entry identity, store and authorized child-slot dispatcher.
 * Unsupported components remain unchanged; this does not patch DS source or domain services.
 */
export function registerPublisherWorkspaceVisibility(ctx: Context): () => void {
  const slots = ctx.slots
  if (typeof slots?.entriesOfSlot !== 'function' || typeof slots.subscribe !== 'function') return () => {}
  const owner = {}
  const installed = new Map<StoredEntry, AdapterRecord>()
  const cleanup: (() => void)[] = []
  let disposed = false
  store.owners += 1
  const invalidate = (target: Target) => {
    // A temporary non-winning cell only advances the public registration version.
    // It declares no children, changes no winner and leaves no new entry in the ledger.
    try {
      if (typeof slots.register === 'function' && slots.entriesOfSlot(target).length) {
        const remove = slots.register({ name: target, priority: Number.MAX_SAFE_INTEGER }, () => null)
        remove()
      }
    } catch (error) {
      // Cordis forbids new effects while this plugin's fiber is unloading.
      // Restoring the entry and publishing the empty display projection remain safe.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'INACTIVE_EFFECT') return
      throw error
    }
  }
  const install = (target: Target) => {
    if (disposed) return
    for (const entry of slots.entriesOfSlot(target)) {
      if (!isOfficialEntry(entry, target)) continue
      let record = adapterOf(entry.component)
      if (!record) {
        record = makeRecord(entry.component as ComponentType<WorkspaceComponentProps>)
        entry.component = record.wrapper
        invalidate(target)
      }
      if (installed.get(entry) === record) continue
      record.owners.add(owner)
      installed.set(entry, record)
    }
  }
  for (const target of TARGETS) {
    cleanup.push(slots.subscribe(target, () => install(target)))
    install(target)
  }
  const domains = ctx as unknown as { sessions?: { list?: Source }; workspaces?: { list?: Source } }
  for (const source of [domains.sessions?.list, domains.workspaces?.list]) {
    if (!source?.subscribe || !source.getSnapshot) continue
    let last = JSON.stringify(source.getSnapshot(), (key, value) => {
      return ['byId', 'projectionsBySession', 'updatedAt', 'retainedBy', 'running'].includes(key) ? undefined : value
    })
    cleanup.push(source.subscribe(() => {
      const next = JSON.stringify(source.getSnapshot(), (key, value) => {
        return ['byId', 'projectionsBySession', 'updatedAt', 'retainedBy', 'running'].includes(key) ? undefined : value
      })
      if (next !== last) { last = next; void store.refresh() }
    }))
  }
  if (typeof window !== 'undefined') {
    const refresh = () => { void store.refresh() }
    window.addEventListener('cqai-publisher-content-change', refresh)
    cleanup.push(() => window.removeEventListener('cqai-publisher-content-change', refresh))
  }

  void store.refresh()
  return () => {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    try {
      for (const dispose of cleanup.reverse()) {
        try { dispose() } catch (error) { errors.push(error) }
      }
      for (const [entry, record] of installed) {
        record.owners.delete(owner)
        if (record.owners.size === 0 && entry.component === record.wrapper) {
          entry.component = record.original
          const target = entry.children?.['sidebar.workspaces.directoryFlow'] ? TARGETS[0] : TARGETS[1]
          try { invalidate(target) } catch (error) { errors.push(error) }
        }
      }
    } finally {
      store.release()
    }
    if (errors.length) throw new AggregateError(errors, 'Publisher workspace visibility cleanup failed')
  }
}
