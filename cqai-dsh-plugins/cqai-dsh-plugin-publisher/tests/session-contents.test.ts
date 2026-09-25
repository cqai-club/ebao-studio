import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContent, saveContent } from '../src/contents.ts'
import { readSessionContent, sessionContentsRoot } from '../src/session-contents.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('legacy conversation drafts remain readable', () => {
  it('opens a prior association without mutating its publication content', () => {
    const root = mkdtempSync(join(tmpdir(), 'ebao-legacy-session-'))
    roots.push(root)
    const env = { DSH_HOME: root }
    const sessionId = 'conversation-1'
    const created = createContent('article', env)
    const saved = saveContent(created.id, {
      revision: created.revision, title: '旧对话文章', body: '正文', summary: '', tags: [], creativeStatement: 'none',
    }, env)
    const associations = sessionContentsRoot(env)
    mkdirSync(associations, { recursive: true })
    const key = createHash('sha256').update(sessionId).digest('hex')
    writeFileSync(join(associations, `${key}.json`), JSON.stringify({ version: 1, sessionId, contentId: saved.id }))
    expect(readSessionContent(sessionId, env)).toEqual({ sessionId, contentId: saved.id, revision: saved.revision, content: saved })
    expect(readSessionContent('other-session', env)).toEqual({
      sessionId: 'other-session', contentId: null, revision: null, content: null,
    })
  })

  it('ignores a deleted legacy draft while rejecting a malformed association', () => {
    const root = mkdtempSync(join(tmpdir(), 'ebao-legacy-session-'))
    roots.push(root)
    const env = { DSH_HOME: root }
    const associations = sessionContentsRoot(env)
    mkdirSync(associations, { recursive: true })
    const sessionId = 'conversation-2'
    const key = createHash('sha256').update(sessionId).digest('hex')
    writeFileSync(join(associations, `${key}.json`), JSON.stringify({
      version: 1, sessionId, contentId: '11111111-1111-4111-8111-111111111111',
    }))
    expect(readSessionContent(sessionId, env).content).toBeNull()
    writeFileSync(join(associations, `${key}.json`), '{}')
    expect(() => readSessionContent(sessionId, env)).toThrow('关联无效')
  })
})
