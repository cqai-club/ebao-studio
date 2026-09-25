import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgentDraftSession, writeAgentDraftSession } from '../src/agent-draft-session.ts'
import { contentsRoot, createContent, deleteContent, duplicateContent, readContent } from '../src/contents.ts'

const homes: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'ebao-agent-draft-session-'))
  homes.push(home)
  return { DSH_HOME: home }
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

describe('durable article Agent conversation association', () => {
  it('keeps a separate session ID without changing the draft revision or copying the association', () => {
    const env = fixture()
    const draft = createContent('article', env)
    expect(readAgentDraftSession(draft.id, env)).toBeNull()
    writeAgentDraftSession(draft.id, 'article-conversation-1', env)
    expect(readAgentDraftSession(draft.id, env)).toBe('article-conversation-1')
    expect(readContent(draft.id, env).revision).toBe(draft.revision)
    const copy = duplicateContent(draft.id, env)
    expect(readAgentDraftSession(copy.id, env)).toBeNull()
    writeAgentDraftSession(draft.id, 'article-conversation-2', env)
    expect(readAgentDraftSession(draft.id, env)).toBe('article-conversation-2')
    deleteContent(draft.id, env)
    expect(() => readAgentDraftSession(draft.id, env)).toThrow('草稿不存在')
  })

  it('rejects other content types and malformed or symlinked association files', () => {
    const env = fixture()
    const imageNote = createContent('image-note', env)
    expect(() => writeAgentDraftSession(imageNote.id, 'conversation', env)).toThrow('只支持编辑文章草稿')
    const draft = createContent('article', env)
    const file = join(contentsRoot(env), draft.id, 'agent-session.json')
    writeFileSync(file, '{broken')
    expect(() => readAgentDraftSession(draft.id, env)).toThrow('Agent 会话关联无效')
    rmSync(file)
    const outside = join(env.DSH_HOME, 'outside.txt')
    writeFileSync(outside, 'private')
    symlinkSync(outside, file)
    expect(() => readAgentDraftSession(draft.id, env)).toThrow('Agent 会话关联无效')
    expect(readFileSync(outside, 'utf8')).toBe('private')
  })
})
