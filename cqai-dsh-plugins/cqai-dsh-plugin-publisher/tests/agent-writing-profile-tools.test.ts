import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import { registerWritingProfileReadTool, registerWritingProfileWriteTool } from '../src/agent-writing-profile-tools.ts'
import { createContent, readContent, saveContent } from '../src/contents.ts'
import { readWritingProfile, updateWritingProfile } from '../src/writing-profile.ts'

const homes: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'ebao-writing-profile-tools-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  const env = { DSH_HOME: home }
  const article = createContent('article', env)
  const definitions = new Map<string, ToolDefinition>()
  const ctx = { tools: { register: (tool: ToolDefinition) => {
    definitions.set(tool.name, tool)
    return () => { definitions.delete(tool.name) }
  } } } as unknown as Context
  let authorized = true
  const bindings = new AgentDraftBindings(() => authorized)
  const exec = { agent: { id: 'article-agent' }, signal: new AbortController().signal } as unknown as ToolRunContext
  return { env, article, definitions, ctx, bindings, exec, revoke: () => { authorized = false } }
}

describe('bound Publisher writing-profile tools', () => {
  it('registers read and write independently and returns no preferences without an active binding', async () => {
    const test = fixture()
    const closeRead = registerWritingProfileReadTool(test.ctx, test.bindings)
    expect([...test.definitions.keys()]).toEqual(['publisher_get_writing_profile'])
    const read = test.definitions.get('publisher_get_writing_profile')!
    expect(await read.execute({}, test.exec)).toBeNull()
    const binding = test.bindings.bind('article-agent', test.article.id, test.env)!
    expect(await read.execute({}, test.exec)).toEqual({ enabled: true, revision: 0, instructions: null })
    test.revoke()
    expect(await read.execute({}, test.exec)).toBeNull()
    closeRead()
    const closeWrite = registerWritingProfileWriteTool(test.ctx, test.bindings)
    expect([...test.definitions.keys()]).toEqual(['publisher_update_writing_profile'])
    await expect(test.definitions.get('publisher_update_writing_profile')!.execute({
      content_id: test.article.id, binding_token: binding.bindingToken, expected_revision: 0, instructions: '拒绝失去归属后的更新。',
    }, test.exec)).rejects.toThrow('当前草稿已切换')
    closeWrite()
    expect(test.definitions.size).toBe(0)
  })

  it('requires the exact current token and profile revision while keeping the draft untouched', async () => {
    const test = fixture()
    registerWritingProfileReadTool(test.ctx, test.bindings)
    registerWritingProfileWriteTool(test.ctx, test.bindings)
    const initial = saveContent(test.article.id, { ...test.article, title: '当前草稿', body: '正文原样保留。' }, test.env)
    const binding = test.bindings.bind('article-agent', initial.id, test.env)!
    const update = test.definitions.get('publisher_update_writing_profile')!
    const base = { content_id: initial.id, binding_token: binding.bindingToken, expected_revision: 0, instructions: '多写具体经历，少用套话。' }
    await expect(update.execute({ ...base, binding_token: 'wrong' }, test.exec)).rejects.toThrow('当前草稿已切换')
    const other = createContent('article', test.env)
    await expect(update.execute({ ...base, content_id: other.id }, test.exec)).rejects.toThrow('当前草稿已切换')
    await expect(update.execute({ ...base, expected_revision: initial.revision }, test.exec)).rejects.toThrow('已在其他对话更新')
    expect(await update.execute(base, test.exec)).toEqual({ enabled: true, revision: 1, instructions: base.instructions })
    expect(readContent(initial.id, test.env)).toEqual(initial)
    const renewed = test.bindings.bind('article-agent', initial.id, test.env)!
    await expect(update.execute({ ...base, expected_revision: 1, instructions: '旧令牌' }, test.exec)).rejects.toThrow('当前草稿已切换')
    expect(await update.execute({ ...base, binding_token: renewed.bindingToken, expected_revision: 1, instructions: null }, test.exec))
      .toEqual({ enabled: true, revision: 2, instructions: null })
    test.bindings.bind('article-agent', null, test.env)
    await expect(update.execute({ ...base, binding_token: renewed.bindingToken, expected_revision: 2 }, test.exec)).rejects.toThrow('当前草稿已切换')
    expect(readWritingProfile(test.env)).toEqual({ enabled: true, revision: 2, instructions: null })
  })

  it('reuses saved style from a new article conversation without changing either article', async () => {
    const test = fixture()
    const oldBinding = test.bindings.bind('article-agent', test.article.id, test.env)!
    registerWritingProfileWriteTool(test.ctx, test.bindings)
    await test.definitions.get('publisher_update_writing_profile')!.execute({ content_id: test.article.id,
      binding_token: oldBinding.bindingToken, expected_revision: 0, instructions: '用日常口语讲述，数字给出处。' }, test.exec)
    test.bindings.clear()
    const next = createContent('article', test.env)
    const bindings = new AgentDraftBindings(() => true)
    bindings.bind('next-article-agent', next.id, test.env)
    registerWritingProfileReadTool(test.ctx, bindings)
    const exec = { ...test.exec, agent: { id: 'next-article-agent' } } as unknown as ToolRunContext
    expect(await test.definitions.get('publisher_get_writing_profile')!.execute({}, exec))
      .toEqual({ enabled: true, revision: 1, instructions: '用日常口语讲述，数字给出处。' })
    expect(readContent(test.article.id, test.env)).toEqual(test.article)
    expect(readContent(next.id, test.env)).toEqual(next)
  })

  it('checks cancellation before reading the binding or changing the profile', async () => {
    const test = fixture()
    const binding = test.bindings.bind('article-agent', test.article.id, test.env)!
    registerWritingProfileReadTool(test.ctx, test.bindings)
    registerWritingProfileWriteTool(test.ctx, test.bindings)
    const current = vi.spyOn(test.bindings, 'current')
    const require = vi.spyOn(test.bindings, 'require')
    const controller = new AbortController()
    controller.abort(new Error('用户取消'))
    const exec = { ...test.exec, signal: controller.signal } as ToolRunContext
    await expect(test.definitions.get('publisher_get_writing_profile')!.execute({}, exec)).rejects.toThrow('用户取消')
    await expect(test.definitions.get('publisher_update_writing_profile')!.execute({ content_id: test.article.id,
      binding_token: binding.bindingToken, expected_revision: 0, instructions: '不应写入。' }, exec)).rejects.toThrow('用户取消')
    expect(current).not.toHaveBeenCalled()
    expect(require).not.toHaveBeenCalled()
    expect(readWritingProfile(test.env)).toEqual({ enabled: true, revision: 0, instructions: null })
  })

  it('withholds disabled stored rules from Agent reads and preserves them when toggling with the current token', async () => {
    const test = fixture()
    const binding = test.bindings.bind('article-agent', test.article.id, test.env)!
    registerWritingProfileReadTool(test.ctx, test.bindings)
    registerWritingProfileWriteTool(test.ctx, test.bindings)
    updateWritingProfile({ expected_revision: 0, instructions: '只保留在设置中，停用时不得注入模型。', enabled: false }, test.env)
    const read = test.definitions.get('publisher_get_writing_profile')!
    const write = test.definitions.get('publisher_update_writing_profile')!
    expect(await read.execute({}, test.exec)).toEqual({ revision: 1, instructions: null, enabled: false })
    expect(readWritingProfile(test.env).instructions).toContain('只保留在设置中')
    const base = { content_id: test.article.id, binding_token: binding.bindingToken }
    expect(await write.execute({ ...base, expected_revision: 1, instructions: '编辑规则不应意外启用。' }, test.exec))
      .toEqual({ revision: 2, instructions: null, enabled: false })
    expect(readWritingProfile(test.env)).toEqual({ revision: 2, instructions: '编辑规则不应意外启用。', enabled: false })
    await expect(write.execute({ ...base, binding_token: 'stale-token', expected_revision: 2, enabled: true }, test.exec))
      .rejects.toThrow('当前草稿已切换')
    expect(await write.execute({ ...base, expected_revision: 2, enabled: true }, test.exec))
      .toEqual({ revision: 3, instructions: '编辑规则不应意外启用。', enabled: true })
    await expect(write.execute({ ...base, expected_revision: 2, enabled: false }, test.exec)).rejects.toThrow('已在其他对话更新')
    expect(await read.execute({}, test.exec)).toEqual({ revision: 3, instructions: '编辑规则不应意外启用。', enabled: true })
  })

  it('rejects missing Agent identity and invalid instruction types', async () => {
    const test = fixture()
    const binding = test.bindings.bind('article-agent', test.article.id, test.env)!
    registerWritingProfileReadTool(test.ctx, test.bindings)
    registerWritingProfileWriteTool(test.ctx, test.bindings)
    await expect(test.definitions.get('publisher_get_writing_profile')!.execute({}, { ...test.exec, agent: undefined }))
      .rejects.toThrow('需要 Agent 会话')
    await expect(test.definitions.get('publisher_update_writing_profile')!.execute({ content_id: test.article.id,
      binding_token: binding.bindingToken, expected_revision: 0, instructions: {} }, test.exec)).rejects.toThrow()
    expect(readWritingProfile(test.env)).toEqual({ enabled: true, revision: 0, instructions: null })
  })
})
