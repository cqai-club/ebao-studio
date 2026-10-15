/** Coordinates durable content conversations through the existing Host APIs. */
import { resolve } from 'node:path'
import { readContent, readStoredContent } from './contents.ts'
import { ensureAgentWorkspace } from './agent-workspace.ts'
import { isContentLifecyclePending } from './content-lifecycle.ts'
import {
  readAgentDraftSession, readPublisherSessionOwnership, reserveAgentDraftSession,
  retireAgentDraftSession, writeAgentDraftSession,
} from './agent-draft-session.ts'

export interface PublisherSessionSummary {
  sessionId: string
  origin?: string
  cwd?: string
}

export interface PublisherDraftSessionServices {
  workspace(path: string): Promise<{ id: string; path: string }>
  find(sessionId: string): Promise<PublisherSessionSummary | undefined>
  create(sessionId: string, workspaceId: string): Promise<void>
  rename?(sessionId: string, title: string): Promise<void>
  isArchived(sessionId: string): boolean
  archive(sessionId: string): Promise<void>
  revoke(sessionId: string): void
}

export interface PublisherDraftSessionResult {
  contentId: string
  sessionId: string
  workspaceId: string
  path: string
}

/** Serialize open/delete/recovery for one content without blocking another. */
export class PublisherDraftSessionController {
  private readonly tails = new Map<string, Promise<unknown>>()

  constructor(private readonly services: PublisherDraftSessionServices) {}

  async run<T>(contentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(contentId) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(operation)
    this.tails.set(contentId, task)
    try { return await task }
    finally { if (this.tails.get(contentId) === task) this.tails.delete(contentId) }
  }

  ensure(contentId: string): Promise<PublisherDraftSessionResult> {
    return this.run(contentId, async () => {
      const content = readContent(contentId)
      if (content.workflowVersion !== 2) throw new Error('旧版内容不进入新版发布编辑页面')
      if (isContentLifecyclePending(contentId)) throw new Error('内容回收或恢复尚未完成，请先重试该操作')
      const path = ensureAgentWorkspace(contentId)
      const workspace = await this.services.workspace(path)
      let sessionId = readAgentDraftSession(contentId)
      if (sessionId) {
        const owner = readPublisherSessionOwnership(sessionId)
        const existing = await this.services.find(sessionId)
        const samePath = existing?.cwd === undefined || resolve(existing.cwd) === resolve(path)
        if (!owner || owner.status !== 'current' || owner.contentId !== contentId
          || this.services.isArchived(sessionId) || existing?.origin === 'subagent' || !samePath
          || owner.workspaceId !== undefined && owner.workspaceId !== workspace.id) {
          if (owner?.contentId === contentId) {
            this.services.revoke(sessionId)
            retireAgentDraftSession(sessionId)
          }
          sessionId = null
        }
      }
      // Reserve before creation. A disconnected request or an attach failure
      // retries this exact identity instead of leaving another blank chat.
      sessionId ??= reserveAgentDraftSession(contentId)
      writeAgentDraftSession(contentId, sessionId, process.env, { workspaceId: workspace.id })
      await this.services.create(sessionId, workspace.id)
      if (content.title && this.services.rename) await this.services.rename(sessionId, content.title)
      return { contentId, sessionId, workspaceId: workspace.id, path: workspace.path }
    })
  }

  removeConversation(contentId: string): Promise<void> {
    return this.run(contentId, async () => {
      if (readStoredContent(contentId).workflowVersion !== 2) throw new Error('旧版内容不支持此操作')
      const sessionId = readAgentDraftSession(contentId, process.env, { includeTrash: true })
      if (!sessionId) return
      const owner = readPublisherSessionOwnership(sessionId)
      if (!owner || owner.status !== 'current' || owner.contentId !== contentId) {
        throw new Error('只能回收当前内容的专属对话')
      }
      this.services.revoke(sessionId)
      if (await this.services.find(sessionId)) await this.services.archive(sessionId)
      retireAgentDraftSession(sessionId)
    })
  }
}
