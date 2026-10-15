import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { retireAgentDraftSession, writeAgentDraftSession } from '../src/agent-draft-session.ts'
import { ensureAgentWorkspace } from '../src/agent-workspace.ts'
import { contentsRoot, createContent, deleteContent } from '../src/contents.ts'
import { readPublisherWorkspaceVisibility, type PublisherWorkspaceVisibilitySession } from '../src/internal-workspace-visibility.ts'
import { saveProjectSettings } from '../src/project-workspace.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'publisher-hidden-workspace-'))
  homes.push(home)
  const env = { DSH_HOME: home }
  const workspaces: Array<{ id: string; path: string; title: string; sessionIds: string[] }> = []
  const sessions: PublisherWorkspaceVisibilitySession[] = []
  const registry = { list: vi.fn(() => workspaces) }
  function own(sessionId: string, options: { workspaceId?: string; type?: 'article' | 'image-note' | 'video' } = {}) {
    const content = createContent(options.type ?? 'article', env)
    const path = ensureAgentWorkspace(content.id, env)
    const workspaceId = options.workspaceId ?? 'publisher-owned-workspace'
    writeAgentDraftSession(content.id, sessionId, env, { workspaceId })
    const workspace = workspaces.find(item => item.id === workspaceId)
    if (workspace) workspace.sessionIds.push(sessionId)
    else workspaces.push({ id: workspaceId, path, title: '可以任意重命名', sessionIds: [sessionId] })
    const summary = { sessionId, cwd: path }
    sessions.push(summary)
    return { content, path, summary }
  }
  return { home, env, registry, workspaces, sessions, own,
    read: () => readPublisherWorkspaceVisibility(registry, sessions, env) }
}

describe('Publisher internal workspace presentation metadata', () => {
  it('hides exact owned current, retired and recycled conversations without changing storage', () => {
    const test = fixture()
    const current = test.own('current', { type: 'article' })
    test.own('retired', { type: 'image-note' })
    const recycled = test.own('recycled', { type: 'video' })
    retireAgentDraftSession('retired', test.env)
    deleteContent(recycled.content.id, test.env)
    const files = [
      join(test.home, 'publisher', 'publishing-workspace.json'),
      ...readdirSync(join(test.home, 'publisher', 'session-ownership')).map(file =>
        join(test.home, 'publisher', 'session-ownership', file)),
      join(contentsRoot(test.env), current.content.id, 'manifest.json'),
      join(contentsRoot(test.env), recycled.content.id, 'manifest.json'),
    ]
    const before = files.map(file => readFileSync(file))
    expect(test.read()).toEqual({ workspaceIds: ['publisher-owned-workspace'], sessionIds: ['current', 'recycled', 'retired'] })
    expect(test.read()).toEqual({ workspaceIds: ['publisher-owned-workspace'], sessionIds: ['current', 'recycled', 'retired'] })
    expect(files.map(file => readFileSync(file))).toEqual(before)
  })

  it('keeps ordinary, source and subagent sessions visible even inside the same hidden workspace', () => {
    const test = fixture()
    const owned = test.own('owned')
    const workspace = test.workspaces[0]
    workspace.sessionIds.push('ordinary', 'source', 'subagent')
    test.sessions.push({ sessionId: 'ordinary', cwd: owned.path }, { sessionId: 'source', cwd: owned.path },
      { sessionId: 'subagent', cwd: owned.path, origin: 'subagent' })
    const sourceContent = createContent('article', test.env)
    writeFileSync(join(contentsRoot(test.env), sourceContent.id, 'agent-session.json'),
      JSON.stringify({ version: 1, sessionId: 'source' }))
    expect(test.read()).toEqual({ workspaceIds: ['publisher-owned-workspace'], sessionIds: ['owned'] })
    expect(workspace.sessionIds).toEqual(['owned', 'ordinary', 'source', 'subagent'])
    expect(test.sessions).toHaveLength(4)
  })

  it('uses persistent exact workspace IDs and canonical paths rather than title or shared cwd', () => {
    const test = fixture()
    const owned = test.own('owned')
    test.workspaces.push({ id: 'foreign-same-title', path: test.home, title: '多平台发布', sessionIds: ['foreign'] },
      { id: 'foreign-same-cwd', path: owned.path, title: '多平台发布', sessionIds: ['ordinary'] })
    expect(test.read()).toEqual({ workspaceIds: ['publisher-owned-workspace'], sessionIds: ['owned'] })
    test.workspaces[0].path = test.home
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: ['owned'] })
    test.workspaces.splice(0)
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: ['owned'] })
  })

  it('supports a custom root without hiding unrelated sessions or changing its files', () => {
    const test = fixture()
    const root = join(test.home, 'user-articles')
    mkdirSync(root)
    const userFile = join(root, 'user.md')
    writeFileSync(userFile, '用户原文')
    saveProjectSettings(root, test.env)
    const owned = test.own('owned-custom')
    test.sessions.push({ sessionId: 'ordinary-custom', cwd: root })
    test.workspaces[0].sessionIds.push('ordinary-custom')
    expect(owned.path).toBe(root)
    expect(test.read()).toEqual({ workspaceIds: ['publisher-owned-workspace'], sessionIds: ['owned-custom'] })
    expect(readFileSync(userFile, 'utf8')).toBe('用户原文')
  })

  it('does not create missing directories or recreate a missing shared-workspace record', () => {
    const test = fixture()
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
    expect(readdirSync(test.home)).toEqual([])
    test.own('owned')
    const file = join(test.home, 'publisher', 'publishing-workspace.json')
    rmSync(file)
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
    expect(existsSync(file)).toBe(false)
  })

  it('reads cold and archived ownership without requiring a live summary or registered workspace', () => {
    const test = fixture()
    test.own('cold')
    test.own('retired')
    retireAgentDraftSession('retired', test.env)
    expect(readPublisherWorkspaceVisibility(test.registry, [], test.env)).toEqual({
      workspaceIds: ['publisher-owned-workspace'], sessionIds: ['cold', 'retired'],
    })
    expect(readPublisherWorkspaceVisibility(undefined, undefined, test.env)).toEqual({
      workspaceIds: [], sessionIds: ['cold', 'retired'],
    })
  })

  it('rejects malformed, noncanonical, oversized and linked shared-workspace records', () => {
    const test = fixture()
    const owned = test.own('owned')
    const file = join(test.home, 'publisher', 'publishing-workspace.json')
    const malformed = [
      '{broken', JSON.stringify({ version: 2, path: owned.path }),
      JSON.stringify({ version: 1, path: owned.path, extra: true }),
      JSON.stringify({ version: 1, path: 'relative' }),
      JSON.stringify({ version: 1, path: `${owned.path}/../projects` }),
      JSON.stringify({ version: 1, path: `${owned.path}\0` }),
      JSON.stringify({ version: 1, path: 'x'.repeat(9000) }),
    ]
    for (const value of malformed) {
      writeFileSync(file, value)
      expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
      expect(readFileSync(file, 'utf8')).toBe(value)
    }
    rmSync(file)
    symlinkSync(test.home, file, 'junction')
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
  })

  it('rejects index filename substitution, oversized records and linked namespace directories', () => {
    const test = fixture()
    test.own('owned')
    const root = join(test.home, 'publisher', 'session-ownership')
    const file = join(root, `${createHash('sha256').update('owned').digest('hex')}.json`)
    const valid = readFileSync(file)
    const substituted = join(root, `${createHash('sha256').update('substituted').digest('hex')}.json`)
    writeFileSync(substituted, valid)
    writeFileSync(join(root, 'arbitrary.json'), valid)
    expect(test.read().sessionIds).toEqual(['owned'])
    writeFileSync(file, Buffer.alloc(8193, ' '))
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
    rmSync(root, { recursive: true, force: true })
    const outside = join(test.home, 'unrelated-index')
    mkdirSync(outside)
    writeFileSync(join(outside, 'preserved.txt'), '保留')
    symlinkSync(outside, root, 'junction')
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
    expect(readFileSync(join(outside, 'preserved.txt'), 'utf8')).toBe('保留')
  })

  it('does not hide a mismatched cwd, subagent origin or old-workflow content despite a stale index', () => {
    const test = fixture()
    const mismatch = test.own('mismatch')
    mismatch.summary.cwd = test.home
    const subagent = test.own('subagent')
    Object.assign(subagent.summary, { origin: 'subagent' })
    const legacy = test.own('legacy')
    const file = join(contentsRoot(test.env), legacy.content.id, 'manifest.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { workflowVersion?: number }
    delete manifest.workflowVersion
    writeFileSync(file, JSON.stringify(manifest))
    expect(test.read()).toEqual({ workspaceIds: [], sessionIds: [] })
  })
})
