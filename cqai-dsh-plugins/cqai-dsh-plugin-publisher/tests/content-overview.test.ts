import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentsRoot, createContent, queryContents } from '../src/contents.ts'
import { annotateContentOverview } from '../src/content-overview.ts'
import { restoreContent, trashContent, type ContentLifecycleAdapter } from '../src/content-lifecycle.ts'
import { reserveAgentDraftSession } from '../src/agent-draft-session.ts'
import type { PublisherSubmission } from '../src/protocol.ts'

const homes: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'publisher-overview-'))
  homes.push(home)
  return { DSH_HOME: home }
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function record(contentId: string, fields: Partial<PublisherSubmission> = {}): PublisherSubmission {
  return { id: '11111111-1111-4111-8111-111111111111', contentId, contentType: 'article',
    title: '文章', createdAt: '2026-10-13T08:00:00.000Z', mode: 'publish', state: 'queued', targets: [], ...fields }
}

describe('derived publishing overview', () => {
  it.each([
    ['queued', 'publish', 'queued'], ['running', 'publish', 'publishing'],
    ['completed', 'publish', 'published'], ['completed', 'draft', 'platform-draft'],
    ['failed', 'publish', 'failed'], ['unknown', 'publish', 'unknown'], [undefined, 'publish', 'unknown'],
  ] as const)('maps Worker state %s with mode %s to %s without changing the draft', (state, mode, expected) => {
    const env = fixture()
    const content = createContent('article', env)
    const file = join(contentsRoot(env), content.id, 'manifest.json')
    const before = readFileSync(file)
    const result = annotateContentOverview(queryContents({ contentType: 'article', query: '' }, env),
      [record(content.id, { state, mode })], env)
    expect(result.items[0]?.publication).toMatchObject({ state: expected, submittedAt: '2026-10-13T08:00:00.000Z', mode })
    expect(readFileSync(file)).toEqual(before)
  })

  it('uses the newest real record for each content and distinguishes unavailable history from no submissions', () => {
    const env = fixture()
    const first = createContent('article', env)
    const second = createContent('article', env)
    const cards = queryContents({ contentType: 'article', query: '' }, env)
    const result = annotateContentOverview(cards, [
      record(first.id, { state: 'failed', createdAt: '2026-10-13T09:00:00.000Z' }),
      record(first.id, { state: 'completed', createdAt: '2026-10-13T07:00:00.000Z' }),
      record('unrelated-content', { state: 'running', createdAt: '2026-10-13T10:00:00.000Z' }),
    ], env)
    expect(result.items.find(card => card.id === first.id)?.publication?.state).toBe('failed')
    expect(result.items.find(card => card.id === second.id)?.publication?.state).toBe('unpublished')
    expect(annotateContentOverview(cards, null, env).items.every(card => card.publication?.state === 'unknown')).toBe(true)
    expect(annotateContentOverview(cards, [], env).items.every(card => card.publication?.state === 'unpublished')).toBe(true)
    expect(cards.items.every(card => card.publication === undefined)).toBe(true)
  })

  it('exposes pending delete and restore intent for the recycle-bin retry actions', async () => {
    const env = fixture()
    const content = createContent('article', env)
    const sessionId = reserveAgentDraftSession(content.id, env)
    const archived = new Set<string>()
    const bridge: ContentLifecycleAdapter = {
      isAvailable: id => id === sessionId, isArchived: id => archived.has(id),
      archiveSession: () => { throw new Error('archive failed') },
      restoreSession: () => { throw new Error('restore failed') },
    }
    await expect(trashContent(content.id, bridge, env)).rejects.toThrow('archive failed')
    const query = () => annotateContentOverview(queryContents({ contentType: 'article', query: '', trash: true }, env), [], env)
    expect(query().items[0]?.lifecyclePending).toBe('trash')
    bridge.archiveSession = id => { archived.add(id) }
    await trashContent(content.id, bridge, env)
    expect(query().items[0]?.lifecyclePending).toBeUndefined()
    await expect(restoreContent(content.id, bridge, env)).rejects.toThrow('restore failed')
    expect(query().items[0]?.lifecyclePending).toBe('restore')
    bridge.restoreSession = id => { archived.delete(id) }
    await restoreContent(content.id, bridge, env)
    expect(annotateContentOverview(queryContents({ contentType: 'article', query: '' }, env), [], env)
      .items[0]?.lifecyclePending).toBeUndefined()
  })
})
