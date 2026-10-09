import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import { registerAgentDraftTools } from '../src/agent-draft-tools.ts'
import { createContent, readAsset, readContent, saveContent } from '../src/contents.ts'
import { worksRoot } from '../src/works.ts'

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
  let onReadImage: (() => void) | undefined
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } },
    attachments: { readImage: async () => {
      onReadImage?.()
      return { ref: {
        attachmentId: attachment.attachment_id, mediaType: attachment.media_type,
        bytes: attachment.bytes, width: 1, height: 1, name: attachment.name,
      }, data: png }
    } },
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
  return { home, env, article, png, attachment, definitions, bindings, exec, cleanup,
    duringImageRead: (callback: () => void) => { onReadImage = callback },
    }
}

describe('current Publisher draft Agent tools', () => {
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
      expect([...test.definitions.keys()]).toEqual([
        'publisher_get_current_draft', 'publisher_update_current_draft', 'publisher_insert_current_draft_image',
        'publisher_add_current_draft_image', 'publisher_remove_current_draft_image',
        'publisher_list_video_works', 'publisher_select_current_video_work',
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
        .rejects.toThrow('当前草稿已切换')
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

  it('restricts article image insertion and rejects invalid image markers', async () => {
    const test = setup()
    try {
      const imageNote = createContent('image-note', test.env)
      const imageBinding = test.bindings.bind('conversation-1', imageNote.id, test.env)!
      const insert = test.definitions.get('publisher_insert_current_draft_image')!
      await expect(insert.execute({
        content_id: imageNote.id, binding_token: imageBinding.bindingToken, expected_revision: 1,
        source_image: test.attachment, body_with_image_marker: '{{PUBLISHER_IMAGE}}', alt: '图',
      }, test.exec)).rejects.toThrow('内容类型不匹配')
      const binding = test.bindings.bind('conversation-1', test.article.id, test.env)!
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

  it('edits image-note copy and managed images with revision checks', async () => {
    const test = setup()
    try {
      const imageNote = createContent('image-note', test.env)
      const binding = test.bindings.bind('conversation-1', imageNote.id, test.env)!
      const get = test.definitions.get('publisher_get_current_draft')!
      const update = test.definitions.get('publisher_update_current_draft')!
      const add = test.definitions.get('publisher_add_current_draft_image')!
      const remove = test.definitions.get('publisher_remove_current_draft_image')!
      expect(await get.execute({}, test.exec)).toMatchObject({
        content_id: imageNote.id, content_type: 'image-note', revision: 1, assets: [],
      })
      const common = { content_id: imageNote.id, binding_token: binding.bindingToken }
      const copy = await update.execute({ ...common, expected_revision: 1,
        title: '新图文', body: '更新文案', tags: ['旅行'], creative_statement: 'ai_generated',
      }, test.exec) as { revision: number }
      expect(copy.revision).toBe(2)
      await expect(update.execute({ ...common, expected_revision: 2, description: '视频简介' }, test.exec))
        .rejects.toThrow('不能修改视频简介')
      const first = await add.execute({ ...common, expected_revision: 2,
        source_image: test.attachment }, test.exec) as { revision: number; assets: Array<{ id: string }> }
      expect(first.revision).toBe(3)
      expect(first.assets).toHaveLength(1)
      expect(readAsset(imageNote.id, first.assets[0]!.id, test.env).data).toEqual(test.png)
      await expect(add.execute({ ...common, expected_revision: 2,
        source_image: test.attachment }, test.exec)).rejects.toThrow('草稿已在其他页面更新')
      const second = await add.execute({ ...common, expected_revision: 3,
        source_image: test.attachment }, test.exec) as { revision: number; assets: Array<{ id: string }> }
      const order = [second.assets[1]!.id, second.assets[0]!.id]
      await expect(update.execute({ ...common, expected_revision: 4,
        cover_asset_id: 'missing' }, test.exec)).rejects.toThrow('封面素材无效')
      await update.execute({ ...common, expected_revision: 4,
        asset_order: order, cover_asset_id: order[0] }, test.exec)
      expect(readContent(imageNote.id, test.env)).toMatchObject({
        coverAssetId: order[0], assets: [{ id: order[0] }, { id: order[1] }],
      })
      const removed = await remove.execute({ ...common, expected_revision: 5,
        asset_id: order[1] }, test.exec) as { revision: number; assets: Array<{ id: string }> }
      expect(removed).toMatchObject({ revision: 6, assets: [{ id: order[0] }] })
      expect(readContent(imageNote.id, test.env)).toMatchObject({
        title: '新图文', body: '更新文案', tags: ['旅行'], creativeStatement: 'ai_generated',
      })
      expect(() => readAsset(imageNote.id, order[1], test.env)).toThrow()
      await expect(remove.execute({ ...common, expected_revision: 5, asset_id: order[0] }, test.exec))
        .rejects.toThrow('草稿已在其他页面更新')
    } finally { test.cleanup() }
  })

  it('rejects image-note attachment writes after the drawer switches drafts during attachment reading', async () => {
    const test = setup()
    try {
      const imageNote = createContent('image-note', test.env)
      const binding = test.bindings.bind('conversation-1', imageNote.id, test.env)!
      test.duringImageRead(() => { test.bindings.bind('conversation-1', test.article.id, test.env) })
      const add = test.definitions.get('publisher_add_current_draft_image')!
      await expect(add.execute({ content_id: imageNote.id, binding_token: binding.bindingToken,
        expected_revision: 1, source_image: test.attachment }, test.exec))
        .rejects.toThrow('当前草稿已切换')
      expect(readContent(imageNote.id, test.env)).toMatchObject({ revision: 1, assets: [] })
      expect(readContent(test.article.id, test.env)).toMatchObject({ revision: 1, assets: [] })
    } finally { test.cleanup() }
  })

  it('rejects image-note attachment references that disagree with verified bytes before saving', async () => {
    const test = setup()
    try {
      const imageNote = createContent('image-note', test.env)
      const binding = test.bindings.bind('conversation-1', imageNote.id, test.env)!
      const add = test.definitions.get('publisher_add_current_draft_image')!
      for (const source of [
        { ...test.attachment, attachment_id: `sha256:${'0'.repeat(64)}` },
        { ...test.attachment, bytes: test.png.length + 1 },
        { ...test.attachment, media_type: 'image/jpeg' },
      ]) {
        await expect(add.execute({ content_id: imageNote.id, binding_token: binding.bindingToken,
          expected_revision: 1, source_image: source }, test.exec))
          .rejects.toThrow('图片附件字节与引用不一致')
      }
      expect(readContent(imageNote.id, test.env)).toMatchObject({ revision: 1, assets: [] })
    } finally { test.cleanup() }
  })

  it('edits video publication copy and selects only an existing completed work', async () => {
    const test = setup()
    try {
      const workId = '11111111-1111-4111-8111-111111111111'
      const workDirectory = join(worksRoot(test.env), workId)
      mkdirSync(workDirectory, { recursive: true })
      writeFileSync(join(workDirectory, 'final_video.mp4'), Buffer.alloc(48, 1))
      writeFileSync(join(workDirectory, 'job.json'), JSON.stringify({
        id: workId, options: { title: '已有成片' }, createdAt: '2026-09-22T02:00:00.000Z',
      }))
      const video = createContent('video', test.env)
      const initial = saveContent(video.id, {
        revision: 1, title: '原视频', body: '', summary: '', tags: ['原标签'],
        creativeStatement: 'none', description: '原简介', shortTitle: '原短标题',
        videoSource: { kind: 'local', localVideoId: '44444444-4444-4444-8444-444444444444',
          fileName: '已有本地素材.mp4', bytes: 123 },
      }, test.env)
      const binding = test.bindings.bind('conversation-1', video.id, test.env)!
      const get = test.definitions.get('publisher_get_current_draft')!
      const update = test.definitions.get('publisher_update_current_draft')!
      const list = test.definitions.get('publisher_list_video_works')!
      const select = test.definitions.get('publisher_select_current_video_work')!
      const common = { content_id: video.id, binding_token: binding.bindingToken }
      expect(await get.execute({}, test.exec)).toMatchObject({
        content_type: 'video', revision: initial.revision, description: '原简介',
        video_source: { kind: 'local', fileName: '已有本地素材.mp4' },
      })
      await expect(update.execute({ ...common, expected_revision: 2, body: '非法正文' }, test.exec))
        .rejects.toThrow('视频草稿不能修改正文')
      const copy = await update.execute({ ...common, expected_revision: 2,
        title: '新视频', description: '新简介', short_title: '新短标题',
        tags: ['AI', '发布'], creative_statement: 'ai_generated',
      }, test.exec) as { revision: number; video_source: unknown }
      expect(copy).toMatchObject({ revision: 3, description: '新简介', short_title: '新短标题' })
      expect(copy.video_source).toEqual(initial.videoSource)
      const listed = await list.execute({}, test.exec) as { total: number; works: Array<Record<string, unknown>> }
      expect(listed).toMatchObject({ total: 1, works: [{ id: workId, title: '已有成片' }] })
      expect(JSON.stringify(listed)).not.toContain(test.home)
      await expect(select.execute({ ...common, expected_revision: 3,
        work_id: '22222222-2222-4222-8222-222222222222' }, test.exec)).rejects.toThrow('作品成片不存在')
      expect(readContent(video.id, test.env).videoSource).toEqual(initial.videoSource)
      const selected = await select.execute({ ...common, expected_revision: 3,
        work_id: workId }, test.exec) as { revision: number; video_source: unknown }
      expect(selected).toMatchObject({ revision: 4, video_source: { kind: 'work', workId } })
      expect(readContent(video.id, test.env)).toMatchObject({
        title: '新视频', description: '新简介', shortTitle: '新短标题',
        tags: ['AI', '发布'], creativeStatement: 'ai_generated',
      })
      await expect(select.execute({ ...common, expected_revision: 3, work_id: workId }, test.exec))
        .rejects.toThrow('草稿已在其他页面更新')
      test.bindings.unbind('conversation-1', binding.bindingToken)
      await expect(list.execute({}, test.exec)).rejects.toThrow('没有绑定草稿')
    } finally { test.cleanup() }
  })
})
