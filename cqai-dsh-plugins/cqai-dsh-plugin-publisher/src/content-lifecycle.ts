/** Retryable content recycling. Host supplies the real session archive and restore operations. */
import { existsSync, lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { deleteContent, directoryFor, readStoredContent, restoreStoredContent } from './contents.ts'
import {
  readAgentDraftSession, readPublisherSessionOwnership, retireAgentDraftSession,
} from './agent-draft-session.ts'
import type { PublisherContent } from './protocol.ts'

import { readContentLifecycleRecord, type ContentLifecycleIntent } from './content-lifecycle-record.ts'

const FILE_NAME = 'content-lifecycle.json'


export interface ContentLifecycleAdapter {
  isArchived(sessionId: string): boolean | Promise<boolean>
  isAvailable(sessionId: string): boolean | Promise<boolean>
  archiveSession(sessionId: string): void | Promise<void>
  restoreSession(sessionId: string): void | Promise<void>
  beforeTrash?(contentId: string, sessionId: string | null): void | Promise<void>
}

function readIntent(contentId: string, env: NodeJS.ProcessEnv): ContentLifecycleIntent | null {
  return readContentLifecycleRecord(directoryFor(contentId, env))
}

function writeIntent(contentId: string, intent: ContentLifecycleIntent, env: NodeJS.ProcessEnv): void {
  const directory = directoryFor(contentId, env)
  const file = join(directory, FILE_NAME)
  const current = lstatSync(file, { throwIfNoEntry: false })
  if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error('内容回收操作记录无效')
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(intent), { flag: 'wx', encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, file)
  } finally { if (existsSync(temporary)) rmSync(temporary) }
}

export function isContentLifecyclePending(contentId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return readIntent(contentId, env)?.status === 'pending'
}

export function readContentLifecyclePendingKind(
  contentId: string, env: NodeJS.ProcessEnv = process.env,
): 'trash' | 'restore' | undefined {
  const intent = readIntent(contentId, env)
  return intent?.status === 'pending' ? intent.kind : undefined
}

/** Suppress retirement only for the archive owned by this content-recycle operation. */
export function hasContentTrashIntent(contentId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const intent = readIntent(contentId, env)
  return !!intent && ((intent.kind === 'trash' && intent.status === 'pending') || !!readStoredContent(contentId, env).trashedAt)
}

export function shouldRetireArchivedPublisherSession(sessionId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const owner = readPublisherSessionOwnership(sessionId, env)
  if (!owner || owner.status !== 'current') return false
  const intent = readIntent(owner.contentId, env)
  if (intent?.sessionId === sessionId && hasContentTrashIntent(owner.contentId, env)) return false
  return true
}

function requireNewContent(contentId: string, env: NodeJS.ProcessEnv): PublisherContent {
  const content = readStoredContent(contentId, env)
  if (content.workflowVersion !== 2) throw new Error('旧版内容不支持此操作')
  return content
}

export async function trashContent(
  contentId: string, adapter: ContentLifecycleAdapter, env: NodeJS.ProcessEnv = process.env,
): Promise<PublisherContent> {
  const content = requireNewContent(contentId, env)
  let intent = readIntent(contentId, env)
  if (intent?.kind === 'restore' && intent.status === 'pending') throw new Error('内容正在恢复，请先重试恢复操作')
  if (!intent || intent.kind !== 'trash') {
    const linked = readAgentDraftSession(contentId, env, { includeTrash: true })
    const owner = linked ? readPublisherSessionOwnership(linked, env) : null
    const sessionId = owner?.status === 'current' && owner.contentId === contentId ? linked : null
    const restoreSession = !!sessionId && await adapter.isAvailable(sessionId) && !await adapter.isArchived(sessionId)
    intent = { version: 1, operationId: randomUUID(), kind: 'trash', status: 'pending', sessionId, restoreSession }
    writeIntent(contentId, intent, env)
  }
  if (content.trashedAt && intent.status === 'complete') return content
  // Persist the closed content state before any awaited stop/archive callback can fail.
  deleteContent(contentId, env)
  await adapter.beforeTrash?.(contentId, intent.sessionId)
  if (intent.sessionId && intent.restoreSession && await adapter.isAvailable(intent.sessionId)
    && !await adapter.isArchived(intent.sessionId)) await adapter.archiveSession(intent.sessionId)
  writeIntent(contentId, { ...intent, status: 'complete' }, env)
  return readStoredContent(contentId, env)
}

export async function restoreContent(
  contentId: string, adapter: ContentLifecycleAdapter, env: NodeJS.ProcessEnv = process.env,
): Promise<PublisherContent> {
  const content = requireNewContent(contentId, env)
  let intent = readIntent(contentId, env)
  if (!content.trashedAt && (!intent || intent.status === 'complete')) return content
  if (intent?.kind === 'trash' && intent.status === 'pending') {
    throw new Error('内容回收尚未完成，请先重试删除操作')
  }
  if (!intent || intent.kind !== 'restore') {
    intent = { version: 1, operationId: randomUUID(), kind: 'restore', status: 'pending',
      sessionId: intent?.sessionId ?? null, restoreSession: intent?.restoreSession ?? false }
    writeIntent(contentId, intent, env)
  }
  if (intent.sessionId) {
    const owner = readPublisherSessionOwnership(intent.sessionId, env)
    const stillLinked = owner?.status === 'current' && owner.contentId === contentId
      && readAgentDraftSession(contentId, env, { includeTrash: true }) === intent.sessionId
    if (stillLinked && !await adapter.isAvailable(intent.sessionId)) retireAgentDraftSession(intent.sessionId, env)
    else if (stillLinked && intent.restoreSession && await adapter.isArchived(intent.sessionId)) {
      await adapter.restoreSession(intent.sessionId)
    }
  }
  const restored = restoreStoredContent(contentId, env)
  writeIntent(contentId, { ...intent, status: 'complete' }, env)
  return restored
}
