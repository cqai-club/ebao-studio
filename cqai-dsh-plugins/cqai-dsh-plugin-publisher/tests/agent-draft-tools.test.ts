import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import { registerAgentDraftTools, AGENT_DRAFT_GUIDANCE } from '../src/agent-draft-tools.ts'
import { createContent, readAsset, readContent, saveContent } from '../src/contents.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'ebao-draft-agent-'))
  homes.push(home)
  const env = { DSH_HOME: home }
  const article = createContent('article', env)
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
  const digest = createHash('sha256').update(png).digest('hex')
  const attachment = {
    attachment_id: `sha256:${digest}`, media_type: 'image/png', bytes: png.length,
    width: 1, height: 1, name: '插图.png',
  }
  const definitions = new Map<string, ToolDefinition>()
  let guidance = ''
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } },
    attachments: { readImage: async () => ({ ref: {
      attachmentId: attachment.attachment_id, mediaType: attachment.media_type,
      bytes: attachment.bytes, width: 1, height: 1, name: attachment.name,
    }, data: png }) },
    systemPrompt: { section: (section: { text: string }) => { guidance = section.text; return () => { guidance = '' } } },
  } as unknown as Context
  const bindings = new AgentDraftBindings()
  const exec = { agent: { id: 'conversation-1' }, signal: new AbortController().signal } as unknown as ToolRunContext
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const dispose = registerAgentDraftTools(ctx, bindings)
  function cleanup() {
    dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  return { home, env, article, png, attachment, definitions, bindings, exec, cleanup, get guidance() { return guidance } }
}

describe('current Publisher article Agent tools', () => {
  it('ignores a delayed unbind for an older drawer binding', () => {
    const test = setup()
    try {
      const first = test.bindings.bind('conversation-1', test.article.id, test.env)!
      const second = test.bindings.bind('conversation-1', test.article.id, test.env)!
      expect(test.bindings.unbind('conversation-1', first.bindingToken)).toBe(false)
      expect(test.bindings.current('conversation-1')).toEqual(second)
      expect(test.bindings.unbind('conversation-1', second.bindingToken)).toBe(true)
      expect(test.bindings.current('conversation-1')).toBeUndefined()
    } finally { test.cleanup() }
  })

  it('requires an explicit live article binding and preserves non-editable fields', async () => {
    const test = setup()
    try {
      expect(test.guidance).toBe(AGENT_DRAFT_GUIDANCE)
      expect([...test.definitions.keys()]).toEqual([
        'publisher_get_current_draft', 'publisher_update_current_draft', 'publisher_insert_current_draft_image',
      ])
      const get = test.definitions.get('publisher_get_current_draft')!
      const update = test.definitions.get('publisher_update_current_draft')!
      expect(await get.execute({}, test.exec)).toBeNull()
      const initial = saveContent(test.article.id, {
        revision: 1, title: '原题', body: '旧正文', summary: '原摘要', tags: ['AI'],
        creativeStatement: 'none', articleTheme: 'classic',
        platformFields: { juejin: { category: '前端' } },
        platformVariants: { juejin: { title: '掘金稿' } },
      }, test.env)
      const binding = test.bindings.bind('conversation-1', initial.id, test.env)!
      const current = await get.execute({}, test.exec) as { content_id: string; binding_token: string; revision: number }
      expect(current).toMatchObject({ content_id: initial.id, binding_token: binding.bindingToken, revision: 2 })
      await expect(update.execute({ content_id: initial.id, binding_token: 'wrong', expected_revision: 2, body: '恶意正文' }, test.exec))
        .rejects.toThrow('当前文章已切换')
      const saved = await update.execute({
        content_id: initial.id, binding_token: binding.bindingToken, expected_revision: 2,
        body: '新正文', title: '新题', tags: ['AI', '文章'],
      }, test.exec) as { revision: number; body: string }
      expect(saved).toMatchObject({ revision: 3, body: '新正文' })
      expect(readContent(initial.id, test.env)).toMatchObject({
        title: '新题', body: '新正文', summary: '原摘要', tags: ['AI', '文章'],
        articleTheme: 'classic', creativeStatement: 'none',
        platformFields: { juejin: { category: '前端' } },
        platformVariants: { juejin: { title: '掘金稿' } },
      })
      await expect(update.execute({ content_id: initial.id, binding_token: binding.bindingToken, expected_revision: 2, body: '旧版本' }, test.exec))
        .rejects.toThrow('草稿已在其他页面更新')
      test.bindings.bind('conversation-1', null, test.env)
      await expect(update.execute({ content_id: initial.id, binding_token: binding.bindingToken, expected_revision: 3, body: '关闭后写入' }, test.exec))
        .rejects.toThrow('抽屉已关闭')
      expect(readContent(initial.id, test.env).body).toBe('新正文')
    } finally { test.cleanup() }
    expect(test.definitions.size).toBe(0)
  })

  it('imports a generated image as a managed asset and inserts it in one revision', async () => {
    const test = setup()
    try {
      const binding = test.bindings.bind('conversation-1', test.article.id, test.env)!
      const insert = test.definitions.get('publisher_insert_current_draft_image')!
      const args = {
        content_id: test.article.id, binding_token: binding.bindingToken, expected_revision: 1,
        source_image: test.attachment, body_with_image_marker: '第一段\n\n{{PUBLISHER_IMAGE}}\n\n第二段', alt: '示意图',
      }
      const saved = await insert.execute(args, test.exec) as { revision: number; body: string; assets: Array<{ id: string }> }
      expect(saved.revision).toBe(2)
      expect(saved.body).toMatch(/^第一段\n\n!\[示意图\]\(ebao-asset:\/\/[\w-]+\)\n\n第二段$/u)
      expect(saved.assets).toHaveLength(1)
      expect(readAsset(test.article.id, saved.assets[0]!.id, test.env).data).toEqual(test.png)
      expect(readContent(test.article.id, test.env).coverAssetId).toBe(saved.assets[0]!.id)
      await expect(insert.execute(args, test.exec)).rejects.toThrow('草稿已在其他页面更新')
      expect(readContent(test.article.id, test.env).assets).toHaveLength(1)
    } finally { test.cleanup() }
  })

  it('rejects non-articles and invalid image marker without modifying the draft', async () => {
    const test = setup()
    try {
      const imageNote = createContent('image-note', test.env)
      expect(() => test.bindings.bind('conversation-1', imageNote.id, test.env)).toThrow('只支持编辑文章')
      const binding = test.bindings.bind('conversation-1', test.article.id, test.env)!
      const insert = test.definitions.get('publisher_insert_current_draft_image')!
      await expect(insert.execute({
        content_id: test.article.id, binding_token: binding.bindingToken, expected_revision: 1,
        source_image: test.attachment, body_with_image_marker: '没有标记', alt: '图',
      }, test.exec)).rejects.toThrow('恰好一个')
      expect(readContent(test.article.id, test.env)).toMatchObject({ revision: 1, assets: [], body: '' })
      const saved = await insert.execute({
        content_id: test.article.id, binding_token: binding.bindingToken, expected_revision: 1,
        source_image: test.attachment, body_with_image_marker: '{{PUBLISHER_IMAGE}}', alt: '路径\\',
      }, test.exec) as { body: string }
      expect(saved.body).toMatch(/^!\[路径 \]\(ebao-asset:\/\/[\w-]+\)$/u)
    } finally { test.cleanup() }
  })
})
