/** Durable current conversation association and reverse ownership, separate from draft revisions. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { validAgentSessionId } from './agent-draft-binding.ts'
import { CONTENT_ID, contentsRoot, directoryFor, readContent, readStoredContent } from './contents.ts'

const FILE_NAME = 'agent-session.json'
const MAX_FILE_BYTES = 8192

export interface PublisherSessionOwnership {
  contentId: string
  sessionId: string
  workspaceId?: string
  status: 'current' | 'retired'
}

function readRecord(file: string): Record<string, unknown> | null {
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error('Agent 会话关联无效')
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* Use a stable validation error. */ }
  throw new Error('Agent 会话关联无效')
}

function writeRecord(file: string, record: object): void {
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Agent 会话关联无效')
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally { if (existsSync(temporary)) rmSync(temporary) }
}

function ownershipFile(sessionId: string, env: NodeJS.ProcessEnv, create: boolean): string {
  const contents = contentsRoot(env)
  const root = join(dirname(existsSync(contents) ? realpathSync(contents) : contents), 'session-ownership')
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 })
  const stat = lstatSync(root, { throwIfNoEntry: false })
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root)) {
    throw new Error('Agent 会话归属目录无效')
  }
  return join(root, `${createHash('sha256').update(validAgentSessionId(sessionId)).digest('hex')}.json`)
}

export function readAgentDraftSession(
  contentId: string, env: NodeJS.ProcessEnv = process.env, options: { includeTrash?: boolean } = {},
): string | null {
  if (options.includeTrash) readStoredContent(contentId, env)
  else readContent(contentId, env)
  const value = readRecord(join(directoryFor(contentId, env), FILE_NAME))
  if (!value) return null
  const keys = Object.keys(value).sort().join(',')
  if ((value.version !== 1 && value.version !== 2)
    || (keys !== 'sessionId,version' && !(value.version === 2 && keys === 'sessionId,version,workspaceId'))) {
    throw new Error('Agent 会话关联无效')
  }
  try {
    if (value.workspaceId !== undefined) validAgentSessionId(value.workspaceId)
    return validAgentSessionId(value.sessionId)
  } catch { throw new Error('Agent 会话关联无效') }
}

export function readPublisherSessionOwnership(
  sessionId: string, env: NodeJS.ProcessEnv = process.env,
): PublisherSessionOwnership | null {
  const value = readRecord(ownershipFile(sessionId, env, false))
  if (!value) return null
  const keys = Object.keys(value).sort().join(',')
  if (value.version !== 1 || (keys !== 'contentId,sessionId,status,version'
    && keys !== 'contentId,sessionId,status,version,workspaceId')
    || typeof value.contentId !== 'string' || !CONTENT_ID.test(value.contentId)
    || value.sessionId !== sessionId || !['current', 'retired'].includes(String(value.status))) {
    throw new Error('Agent 会话关联无效')
  }
  if (value.workspaceId !== undefined) validAgentSessionId(value.workspaceId)
  return { contentId: value.contentId, sessionId, status: value.status as PublisherSessionOwnership['status'],
    ...(value.workspaceId === undefined ? {} : { workspaceId: value.workspaceId as string }) }
}

export function isCurrentPublisherSession(
  sessionId: string, contentId?: string, env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const owner = readPublisherSessionOwnership(sessionId, env)
    if (!owner || owner.status !== 'current' || (contentId !== undefined && owner.contentId !== contentId)) return false
    const content = readContent(owner.contentId, env)
    const lifecycle = readRecord(join(directoryFor(owner.contentId, env), 'content-lifecycle.json'))
    if (lifecycle?.status === 'pending') return false
    return content.workflowVersion === 2 && readAgentDraftSession(owner.contentId, env) === sessionId
  } catch { return false }
}

export function writeAgentDraftSession(
  contentId: string, sessionId: string, env: NodeJS.ProcessEnv = process.env,
  options: { workspaceId?: string } = {},
): void {
  const content = readContent(contentId, env)
  if (content.workflowVersion !== 2) throw new Error('旧版内容不支持此操作')
  const validId = validAgentSessionId(sessionId)
  const owner = readPublisherSessionOwnership(validId, env)
  if (owner && owner.contentId !== contentId) throw new Error('Agent 会话已属于其他内容')
  if (owner?.status === 'retired') throw new Error('Agent 会话已解除关联，请创建新对话')
  const previous = readAgentDraftSession(contentId, env)
  if (previous && previous !== validId && readPublisherSessionOwnership(previous, env)?.contentId === contentId) {
    retireAgentDraftSession(previous, env)
  }
  const workspaceId = options.workspaceId === undefined ? owner?.workspaceId : validAgentSessionId(options.workspaceId)
  const record = { contentId, sessionId: validId, status: 'current' as const,
    ...(workspaceId ? { workspaceId } : {}) }
  // The per-content association is canonical; retry repairs a missing reverse entry.
  writeRecord(join(directoryFor(contentId, env), FILE_NAME), { version: 2, sessionId: validId,
    ...(workspaceId ? { workspaceId } : {}) })
  writeRecord(ownershipFile(validId, env, true), { version: 1, ...record })
}

/** A stable ID reserved before Host session creation makes uncertain outcomes retryable. */
export function reserveAgentDraftSession(contentId: string, env: NodeJS.ProcessEnv = process.env): string {
  const existing = readAgentDraftSession(contentId, env)
  if (existing) {
    const owner = readPublisherSessionOwnership(existing, env)
    const record = readRecord(join(directoryFor(contentId, env), FILE_NAME))
    if ((owner?.status === 'current' && owner.contentId === contentId) || (!owner && record?.version === 2)) {
      writeAgentDraftSession(contentId, existing, env)
      return existing
    }
  }
  const sessionId = randomUUID()
  writeAgentDraftSession(contentId, sessionId, env)
  return sessionId
}

/** Retiring a conversation never changes or deletes its content. Restoring it cannot reclaim ownership. */
export function retireAgentDraftSession(sessionId: string, env: NodeJS.ProcessEnv = process.env): void {
  const owner = readPublisherSessionOwnership(sessionId, env)
  if (!owner) return
  writeRecord(ownershipFile(sessionId, env, true), { version: 1, ...owner, status: 'retired' })
  const file = join(directoryFor(owner.contentId, env), FILE_NAME)
  if (readAgentDraftSession(owner.contentId, env, { includeTrash: true }) === sessionId) rmSync(file)
}
