import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  getPublisherWorkspaceVisibilitySnapshot,
  refreshPublisherWorkspaceVisibility,
} from './internal-workspace-visibility.tsx'

type NavigationServices = { sessions: ISessions; workspaces: IWorkspaces; uiWorkspace: UiWorkspace }
type StartSession = UiWorkspace['startSession']
type Owner = { ctx: Context; services: NavigationServices; generation: number; disposed: boolean }
type Guard = {
  original: StartSession
  originalDescriptor?: PropertyDescriptor
  wrapper: StartSession
  owners: Owner[]
}
const GUARD = Symbol.for('cqai-publisher.internal-workspace-navigation.rc2')
// Cordis exposes the origin through this global registry key in DS rc.2.
// Avoid adding Cordis itself to the browser's platform-module requirements.
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
type MarkedStartSession = StartSession & { [GUARD]?: Guard }

/** Match DS Workspace navigation order while excluding Publisher-owned folders. */
function visibleTarget(owner: Owner, hidden: ReadonlySet<string>): WorkspaceId | undefined {
  const workspace = owner.services.workspaces.list.getSnapshot()
  const sessions = owner.services.sessions.list.getSnapshot()
  const current = (Object.keys(sessions.byId) as SessionId[]).find(id => {
    return (owner.services.sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0
  })
  const currentWorkspace = current === undefined ? undefined
    : workspace.items.find(item => item.sessionIds.includes(current))
  if (currentWorkspace && !hidden.has(currentWorkspace.workspaceId)) return currentWorkspace.workspaceId
  if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return undefined
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const item of workspace.items) {
    if (hidden.has(item.workspaceId)) continue
    let latest = Number.NEGATIVE_INFINITY
    for (const id of item.sessionIds) {
      const session = sessions.byId[id]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(item.createdAt)
    // Strict greater-than preserves the Host order for timestamp ties.
    if (selected === undefined || latest > selectedTime) {
      selected = item.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/**
 * New Conversation keeps DS's ordinary Workspace behavior, but never inherits
 * Publisher's internal Workspace. It does not create, hide or delete domain rows.
 */
export function registerPublisherNewConversationGuard(ctx: Context, services: NavigationServices): () => void {
  // Cordis returns a fresh context-tracing method proxy on every read. Resolve
  // its exported origin identity so cleanup restores precisely our own method.
  const service = (services.uiWorkspace as unknown as Record<symbol, UiWorkspace | undefined>)[CORDIS_ORIGINAL]
    ?? services.uiWorkspace
  if (typeof service?.startSession !== 'function') return () => {}
  let guard = (service.startSession as MarkedStartSession)[GUARD]
  if (!guard) {
    guard = {
      original: service.startSession,
      originalDescriptor: Object.getOwnPropertyDescriptor(service, 'startSession'),
      wrapper: undefined as unknown as StartSession,
      owners: [],
    }
    const record = guard
    record.wrapper = function (this: UiWorkspace, workspaceId?: WorkspaceId) {
      const owner = record.owners.at(-1)
      if (!owner || owner.disposed) return record.original.call(this, workspaceId)
      const generation = ++owner.generation
      const invoke = () => {
        const visibility = getPublisherWorkspaceVisibilitySnapshot()
        // Unavailable metadata must not fall through to DS's hidden-folder
        // inheritance. Keeping the page is safe until the next user attempt.
        if (visibility.phase !== 'ready') return
        const hidden = new Set(visibility.value.workspaceIds)
        if (hidden.size === 0 || workspaceId !== undefined && !hidden.has(workspaceId)) {
          record.original.call(this, workspaceId)
          return
        }
        const target = visibleTarget(owner, hidden)
        // DS rc.2 exposes no public clearMain. If only an internal Workspace
        // exists, preserve the current page rather than creating into it.
        if (target !== undefined) record.original.call(this, target)
      }
      if (getPublisherWorkspaceVisibilitySnapshot().phase === 'ready') {
        invoke()
        return
      }
      const navigation = owner.ctx.layout.beginNavigation()
      void refreshPublisherWorkspaceVisibility().then(() => {
        if (owner.disposed || owner.generation !== generation || navigation.aborted
          || record.owners.at(-1) !== owner || service.startSession !== record.wrapper) return
        invoke()
      }).catch(() => { /* An unavailable Host leaves the current page intact. */ })
    }
    Object.defineProperty(record.wrapper, GUARD, { value: record })
    Object.defineProperty(service, 'startSession', {
      configurable: true, writable: true, enumerable: guard.originalDescriptor?.enumerable ?? false,
      value: record.wrapper,
    })
  }
  const owner: Owner = { ctx, services, generation: 0, disposed: false }
  guard.owners.push(owner)
  const record = guard
  return () => {
    if (owner.disposed) return
    owner.disposed = true
    owner.generation += 1
    record.owners = record.owners.filter(item => item !== owner)
    if (record.owners.length || service.startSession !== record.wrapper) return
    if (record.originalDescriptor) Object.defineProperty(service, 'startSession', record.originalDescriptor)
    else delete (service as Partial<UiWorkspace>).startSession
  }
}
