/** Read-only presentation metadata; hidden entities keep their files and Host registration. */
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { validAgentSessionId } from './agent-draft-binding.ts'
import { readPublisherSessionOwnership, type PublisherSessionOwnership } from './agent-draft-session.ts'
import { readStoredContent } from './contents.ts'

const MAX_RECORD_BYTES = 8 * 1024
const MAX_PATH_LENGTH = 4096
const OWNERSHIP_FILE = /^[0-9a-f]{64}\.json$/u

export interface PublisherWorkspaceVisibilityRegistry {
  list(): readonly { id: string; path: string; sessionIds: readonly string[] }[]
}

export interface PublisherWorkspaceVisibilitySession {
  sessionId: string
  origin?: string
  cwd?: string
}

export interface PublisherWorkspaceVisibility {
  workspaceIds: string[]
  sessionIds: string[]
}

function canonicalDirectory(path: string): boolean {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink() && realpathSync(path) === path)
}

function readRecord(file: string): Record<string, unknown> | null {
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) return null
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

function sharedDirectory(root: string): string | null {
  const stored = readRecord(join(root, 'publishing-workspace.json'))
  if (!stored || Object.keys(stored).sort().join(',') !== 'path,version' || stored.version !== 1
    || typeof stored.path !== 'string' || !stored.path || stored.path.length > MAX_PATH_LENGTH
    || stored.path.includes('\0') || !isAbsolute(stored.path) || resolve(stored.path) !== stored.path
    || !canonicalDirectory(stored.path)) return null
  return stored.path
}

/**
 * Visibility belongs to durable Publisher ownership, never a display title or an arbitrary cwd match.
 * Missing or malformed metadata leaves the native workspace browser visible and never repairs storage.
 */
export function readPublisherWorkspaceVisibility(
  registry: PublisherWorkspaceVisibilityRegistry | undefined,
  sessions?: readonly PublisherWorkspaceVisibilitySession[],
  env: NodeJS.ProcessEnv = process.env,
): PublisherWorkspaceVisibility {
  const empty = (): PublisherWorkspaceVisibility => ({ workspaceIds: [], sessionIds: [] })
  try {
    const home = resolveDshHome(undefined, env)
    if (!lstatSync(home, { throwIfNoEntry: false })?.isDirectory()) return empty()
    const root = join(realpathSync(home), 'publisher')
    if (!canonicalDirectory(root)) return empty()
    const shared = sharedDirectory(root)
    const ownershipRoot = join(root, 'session-ownership')
    if (!shared || !canonicalDirectory(ownershipRoot)) return empty()
    // The association reader derives this index from the canonical contents directory.
    // Reject a replaced contents directory instead of crossing a Profile or namespace boundary.
    if (!canonicalDirectory(join(root, 'contents'))) return empty()

    const summaries = new Map(sessions?.map(session => [session.sessionId, session]))
    const contentIsCurrentWorkflow = new Map<string, boolean>()
    const owners: PublisherSessionOwnership[] = []
    for (const fileName of readdirSync(ownershipRoot)) {
      if (!OWNERSHIP_FILE.test(fileName)) continue
      try {
        const candidate = readRecord(join(ownershipRoot, fileName))
        if (!candidate) continue
        const sessionId = validAgentSessionId(candidate.sessionId)
        if (`${createHash('sha256').update(sessionId).digest('hex')}.json` !== fileName) continue
        const owner = readPublisherSessionOwnership(sessionId, env)
        if (!owner) continue
        let currentWorkflow = contentIsCurrentWorkflow.get(owner.contentId)
        if (currentWorkflow === undefined) {
          currentWorkflow = readStoredContent(owner.contentId, env).workflowVersion === 2
          contentIsCurrentWorkflow.set(owner.contentId, currentWorkflow)
        }
        if (!currentWorkflow) continue
        const summary = summaries.get(sessionId)
        if (summary?.origin === 'subagent'
          || summary?.cwd !== undefined && resolve(summary.cwd) !== shared) continue
        owners.push(owner)
      } catch { /* A bad entry cannot hide unrelated rows or prevent other owned entries from being read. */ }
    }
    const ownedWorkspaces = new Set(owners.flatMap(owner => owner.workspaceId ? [owner.workspaceId] : []))
    const workspaceIds = registry?.list().filter(workspace =>
      ownedWorkspaces.has(workspace.id) && workspace.path === shared,
    ).map(workspace => workspace.id) ?? []
    // A mixed workspace is hidden, but ordinary/source/subagent members are not hidden here.
    // The client presentation keeps those members in its Ungrouped, flat, and search projections.
    return { workspaceIds: [...new Set(workspaceIds)].sort(), sessionIds: [...new Set(owners.map(owner => owner.sessionId))].sort() }
  } catch { return empty() }
}
