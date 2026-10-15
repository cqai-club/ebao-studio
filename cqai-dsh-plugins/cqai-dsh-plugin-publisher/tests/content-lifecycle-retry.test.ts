import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContent, listContents, patchContent, queryContents, readContent, readStoredContent } from '../src/contents.ts'
import { isCurrentPublisherSession, reserveAgentDraftSession } from '../src/agent-draft-session.ts'
import { restoreContent, trashContent, type ContentLifecycleAdapter } from '../src/content-lifecycle.ts'
import { annotateContentOverview } from '../src/content-overview.ts'

const fault = vi.hoisted(() => ({ failRestoreCompletion: false }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: ((from, to) => {
    if (fault.failRestoreCompletion && String(to).endsWith('content-lifecycle.json')) {
      const intent = JSON.parse(actual.readFileSync(from, 'utf8')) as { kind: string; status: string }
      if (intent.kind === 'restore' && intent.status === 'complete') {
        fault.failRestoreCompletion = false
        throw new Error('Lifecycle completion write failed')
      }
    }
    return actual.renameSync(from, to)
  }) as typeof actual.renameSync }
})

const homes: string[] = []
afterEach(() => {
  fault.failRestoreCompletion = false
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('recycle-bin restoration recovery', () => {
  it('keeps a restored manifest in the recycle bin until its durable restore operation completes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'publisher-lifecycle-retry-'))
    homes.push(home)
    const env = { DSH_HOME: home }
    const content = createContent('article', env)
    const sessionId = reserveAgentDraftSession(content.id, env)
    const archived = new Set<string>()
    const bridge: ContentLifecycleAdapter = {
      isAvailable: id => id === sessionId, isArchived: id => archived.has(id),
      archiveSession: id => { archived.add(id) },
      restoreSession: vi.fn(id => { archived.delete(id) }),
    }
    await trashContent(content.id, bridge, env)
    fault.failRestoreCompletion = true
    await expect(restoreContent(content.id, bridge, env)).rejects.toThrow('Lifecycle completion write failed')
    const restoredManifest = readStoredContent(content.id, env)
    expect(restoredManifest.trashedAt).toBeUndefined()
    expect(() => readContent(content.id, env)).toThrow('恢复尚未完成')
    expect(() => patchContent(content.id, { revision: restoredManifest.revision, patch: { title: '迟到修改' } }, env))
      .toThrow('恢复尚未完成')
    expect(isCurrentPublisherSession(sessionId, content.id, env)).toBe(false)
    expect(listContents(env)).toEqual([])
    expect(queryContents({ contentType: 'article', query: '' }, env).items).toEqual([])
    const recycleBin = annotateContentOverview(queryContents({ contentType: 'article', query: '', trash: true }, env), [], env)
    expect(recycleBin.items).toMatchObject([{ id: content.id, lifecyclePending: 'restore' }])

    const completed = await restoreContent(content.id, bridge, env)
    expect(completed.revision).toBe(restoredManifest.revision)
    expect(bridge.restoreSession).toHaveBeenCalledTimes(1)
    expect(isCurrentPublisherSession(sessionId, content.id, env)).toBe(true)
    expect(queryContents({ contentType: 'article', query: '', trash: true }, env).items).toEqual([])
    expect(listContents(env).map(row => row.id)).toEqual([content.id])
  })
})
