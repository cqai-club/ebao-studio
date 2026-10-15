import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PublisherContentType } from '../protocol.ts'
import { api } from './shared.tsx'

interface SessionContent {
  sessionId: string
  contentId: string | null
  contentType: PublisherContentType | null
}

/** Restore a content page even when the Publisher panel has not mounted. */
export function watchPublisherSession(
  sessions: ISessions, workspaces: IWorkspaces, layout: ILayout,
  openContent: (content: { contentId: string; contentType: PublisherContentType }) => void,
): () => void {
  let disposed = false
  let queued = false
  let generation = 0
  let selectionVersion = 0
  let mainSignature = ''
  let lastCandidate: string | undefined
  let request: AbortController | undefined
  let previousPanel = layout.panelInfo.getSnapshot().activePanelId

  const mainReferences = (): { id: SessionId; count: number; origin?: string }[] => {
    const list = sessions.list.getSnapshot()
    return list.ids.flatMap((id: SessionId) => {
      const count = sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0
      return count > 0 ? [{ id, count, origin: list.byId[id]?.origin }] : []
    })
  }
  const selected = () => {
    if (layout.panelInfo.getSnapshot().activePanelId !== null) return undefined
    const workspace = workspaces.list.getSnapshot()
    if (workspace.phase !== 'ready') return undefined
    const references = mainReferences()
    if (references.length !== 1 || references[0].origin === 'subagent'
      || workspace.archivedSessionIds.includes(references[0].id)) return undefined
    return references[0].id
  }
  const cancel = () => { generation += 1; request?.abort(); request = undefined }
  const check = () => {
    queued = false
    if (disposed) return
    const sessionId = selected()
    if (!sessionId) { lastCandidate = undefined; cancel(); return }
    const candidate = `${sessionId}:${selectionVersion}`
    if (candidate === lastCandidate) return
    lastCandidate = candidate
    cancel()
    const current = generation
    request = new AbortController()
    // Later navigation cancels this lookup, including a Workspace open that
    // is still waiting for the Host and has not changed the visible panel yet.
    const signal = AbortSignal.any([request.signal, layout.beginNavigation()])
    void api<SessionContent>(`agent-draft-content/${encodeURIComponent(sessionId)}`, undefined, signal).then(content => {
      if (disposed || signal.aborted || current !== generation || selected() !== sessionId
        || candidate !== `${sessionId}:${selectionVersion}` || content?.sessionId !== sessionId
        || !content.contentId || !['article', 'image-note', 'video'].includes(content.contentType ?? '')) return
      openContent({ contentId: content.contentId, contentType: content.contentType! })
    }).catch(() => { /* Ordinary conversations and unavailable lookups keep their current page. */ })
  }
  const schedule = () => {
    if (disposed || queued) return
    queued = true
    // replaceMain retains the new Session before releasing the previous one.
    // Wait until that synchronous navigation has reached a stable selection.
    queueMicrotask(check)
  }
  const sessionChanged = () => {
    const signature = mainReferences().map(({ id, count }) => `${id}:${count}`).sort().join(',')
    if (signature !== mainSignature) { mainSignature = signature; selectionVersion += 1; cancel() }
    schedule()
  }
  const panelChanged = () => {
    const panel = layout.panelInfo.getSnapshot().activePanelId
    if (panel !== previousPanel) { previousPanel = panel; lastCandidate = undefined; cancel() }
    schedule()
  }
  const unsubscribers = [
    sessions.list.subscribe(sessionChanged),
    layout.panelInfo.subscribe(panelChanged),
    workspaces.list.subscribe(schedule),
  ]
  sessionChanged()
  return () => { disposed = true; cancel(); for (const unsubscribe of unsubscribers) unsubscribe() }
}
