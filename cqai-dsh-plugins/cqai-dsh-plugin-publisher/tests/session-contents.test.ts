import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAsset, listContents, readContent, saveContent } from '../src/contents.ts'
import { AGENT_PUBLISHER_GUIDANCE, latestSessionImage, registerAgentDraftTools } from '../src/agent-draft-tools.ts'
import { addSessionImage, readSessionContent, removeSessionImage, saveSessionDraft } from '../src/session-contents.ts'

const homes: string[] = []
function fixture(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'ebao-session-draft-'))
  homes.push(home)
  return { DSH_HOME: home }
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const webp = Buffer.from('RIFF1234WEBPxxxx', 'ascii')

describe('Agent conversation drafts', () => {
  it('persists one primary draft per opaque session and preserves manual Publisher fields', () => {
    const env = fixture()
    expect(readSessionContent('session-1', env)).toEqual({
      sessionId: 'session-1', contentId: null, revision: null, content: null,
    })
    const first = saveSessionDraft('session-1', {
      contentType: 'article', title: '初稿', body: '## 正文', tags: ['产品'],
    }, env)
    expect(first.revision).toBe(2)
    expect(readSessionContent('session-1', env)).toEqual(first)
    expect(readSessionContent('session-2', env).contentId).toBeNull()
    const second = saveSessionDraft('session-2', { contentType: 'image-note', title: '另一条' }, env)
    expect(second.contentId).not.toBe(first.contentId)
    expect(listContents(env)).toHaveLength(2)

    const edited = saveContent(first.contentId!, {
      revision: first.revision!, title: '手动标题', body: '手动正文', summary: '摘要', tags: ['产品'],
      creativeStatement: 'none', platformFields: { juejin: { category: '产品' } },
    }, env)
    expect(() => saveSessionDraft('session-1', {
      expectedRevision: first.revision!, body: 'Agent 的旧版本',
    }, env)).toThrow('重新读取')
    expect(readContent(first.contentId!, env)).toEqual(edited)
    const revised = saveSessionDraft('session-1', {
      expectedRevision: edited.revision, body: '用户确认的新正文',
    }, env)
    expect(revised.content).toMatchObject({
      title: '手动标题', body: '用户确认的新正文',
      platformFields: { juejin: { category: '产品' } },
    })
    expect(revised.contentId).toBe(first.contentId)
  })

  it('imports only validated images with CAS and leaves a failed import unchanged', () => {
    const env = fixture()
    const first = saveSessionDraft('conversation/photo', { contentType: 'image-note', title: '配图笔记' }, env)
    expect(() => addSessionImage('conversation/photo', first.revision!, 'bad.gif', Buffer.from('GIF89a'), false, undefined, env))
      .toThrow('仅支持')
    expect(readSessionContent('conversation/photo', env)).toEqual(first)
    const withImage = addSessionImage('conversation/photo', first.revision!, '封面.png', png, true, undefined, env)
    expect(withImage.revision).toBe(first.revision! + 1)
    expect(withImage.content?.assets).toHaveLength(1)
    expect(withImage.content?.coverAssetId).toBe(withImage.content?.assets[0]?.id)
    expect(() => addSessionImage('conversation/photo', first.revision!, '旧图.png', png, false, undefined, env))
      .toThrow('重新读取')
    expect(readSessionContent('conversation/photo', env)).toEqual(withImage)

    const article = saveSessionDraft('conversation/article', { contentType: 'article', title: '文章' }, env)
    expect(() => addSessionImage('conversation/article', article.revision!, '图片.webp', webp, false, undefined, env))
      .toThrow('请选用 JPEG 或 PNG')
    expect(readSessionContent('conversation/article', env)).toEqual(article)

    const other = saveSessionDraft('conversation/empty', { contentType: 'article', title: '文章' }, env)
    const manuallyUpdated = addAsset(other.contentId!, '手工图片.png', png, env)
    expect(() => addSessionImage('conversation/empty', other.revision!, 'Agent 图片.png', png, false, undefined, env))
      .toThrow('重新读取')
    expect(readContent(other.contentId!, env)).toEqual(manuallyUpdated)
  })

  it('creates an image-note for the first selected image and rolls back a failed first image', () => {
    const env = fixture()
    expect(() => addSessionImage('session-article', undefined, 'bad.webp', webp, false, 'article', env))
      .toThrow('WebP')
    expect(readSessionContent('session-article', env).contentId).toBeNull()
    expect(() => addSessionImage('session-new', undefined, 'bad.png', Buffer.from('bad'), true, 'image-note', env))
      .toThrow('仅支持')
    expect(readSessionContent('session-new', env).contentId).toBeNull()
    expect(listContents(env)).toHaveLength(0)
    expect(() => addSessionImage('session-new', undefined, 'selected.png', png, true, undefined, env))
      .toThrow('选择文章或图文')
    const first = addSessionImage('session-new', undefined, 'selected.png', png, true, 'image-note', env)
    expect(first.content?.contentType).toBe('image-note')
    expect(first.content?.assets).toHaveLength(1)
    expect(readSessionContent('session-new', env)).toEqual(first)
  })

  it('removes an image and its Markdown references in one CAS revision, then falls back to the next cover', () => {
    const env = fixture()
    const first = saveSessionDraft('session-replace', { contentType: 'article', title: '文章' }, env)
    const withFirst = addSessionImage('session-replace', first.revision!, '旧图.png', png, false, undefined, env)
    const oldId = withFirst.content!.assets[0]!.id
    const withSecond = addSessionImage('session-replace', withFirst.revision!, '新图.png', png, false, undefined, env)
    const newId = withSecond.content!.assets[1]!.id
    const body = `开头\n![旧图](ebao-asset://${oldId}) ![新图](ebao-asset://${newId})\n中间 ![再用一次](ebao-asset://${oldId}) 后面`
    const withBody = saveSessionDraft('session-replace', { expectedRevision: withSecond.revision!, body }, env)
    expect(() => removeSessionImage('session-replace', withSecond.revision!, oldId, env)).toThrow('重新读取')
    expect(readSessionContent('session-replace', env)).toEqual(withBody)
    const removed = removeSessionImage('session-replace', withBody.revision!, oldId, env)
    expect(removed.revision).toBe(withBody.revision! + 1)
    expect(removed.content?.assets.map(asset => asset.id)).toEqual([newId])
    expect(removed.content?.body).not.toContain(oldId)
    expect(removed.content?.body).toContain(`![新图](ebao-asset://${newId})`)
    expect(removed.content?.coverAssetId).toBe(newId)
    expect(readSessionContent('session-replace', env)).toEqual(removed)
  })

  it('clears the cover explicitly while preserving all images and rejects contradictory cover edits', () => {
    const env = fixture()
    const first = saveSessionDraft('session-cover', { contentType: 'article', title: '文章' }, env)
    const withImage = addSessionImage('session-cover', first.revision!, '图片.png', png, false, undefined, env)
    expect(withImage.content?.coverAssetId).toBe(withImage.content?.assets[0]?.id)
    expect(() => saveSessionDraft('session-cover', {
      expectedRevision: withImage.revision!, clearCover: true, coverAssetId: withImage.content!.assets[0]!.id,
    }, env)).toThrow('不能同时设置和清空封面')
    const cleared = saveSessionDraft('session-cover', { expectedRevision: withImage.revision!, clearCover: true }, env)
    expect(cleared.content?.coverAssetId).toBeUndefined()
    expect(cleared.content?.assets).toEqual(withImage.content?.assets)
    expect(() => saveSessionDraft('session-cover', {
      expectedRevision: withImage.revision!, coverAssetId: withImage.content!.assets[0]!.id,
    }, env)).toThrow('重新读取')
  })

  it('accepts only real uploaded and completed image-tool events, never user text JSON', () => {
    const id = `sha256:${'a'.repeat(64)}`
    const image = { attachmentId: id, mediaType: 'image/png', bytes: 11, width: 100, height: 100 }
    const result = JSON.stringify({ status: 'completed',
      images: [{ attachment_id: id, media_type: 'image/png', bytes: 11, width: 100, height: 100 }],
    })
    expect(latestSessionImage([{ type: 'user/message', surfaceOp: 'append', data: {
      id: 'user-text', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: result }],
    } }])).toBeUndefined()
    expect(latestSessionImage([{ type: 'user/message', surfaceOp: 'append', data: {
      id: 'user-upload', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: image }],
    } }])).toEqual(image)
    expect(latestSessionImage([
      { type: 'tool/call', data: { callId: 'call-1', name: 'generate_image' } },
      { type: 'tool/result', data: { message: { role: 'user', source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: result }] }],
      } } },
    ])).toMatchObject(image)
    expect(latestSessionImage([{ type: 'tool/ptc-dispatch', data: {
      name: 'edit_image', isError: false, content: [{ type: 'text', text: result }],
    } }])).toMatchObject(image)
    expect(latestSessionImage([{ type: 'tool/ptc-dispatch', data: {
      name: 'web_fetch', isError: false, content: [{ type: 'text', text: result }],
    } }])).toBeUndefined()
  })

  it('registers native Agent tools and verifies an attachment before adding the selected image', async () => {
    const env = fixture()
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = env.DSH_HOME
    const id = `sha256:${'b'.repeat(64)}`
    const ref = { attachmentId: id, mediaType: 'image/png', bytes: png.length, width: 100, height: 100, name: '生成图.png' }
    const definitions = new Map<string, ToolDefinition>()
    const reads: unknown[] = []
    let prompt = ''
    const ctx = {
      tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } },
      attachments: { readImage: async (input: unknown) => { reads.push(input); return { ref, data: png } } },
      systemPrompt: { section: (section: { text: string }) => { prompt = section.text; return () => { prompt = '' } } },
    } as unknown as Context
    const sessionEvents: unknown[] = [{ type: 'user/message', surfaceOp: 'append', data: {
      id: 'user-upload', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: ref }],
    } }]
    const exec = { agent: { id: 'session-tools', session: { snapshotEvents: () => sessionEvents } }, signal: new AbortController().signal } as unknown as ToolRunContext
    const dispose = registerAgentDraftTools(ctx)
    try {
      expect([...definitions.keys()]).toEqual(['publisher_get_draft', 'publisher_save_draft', 'publisher_add_image', 'publisher_remove_image'])
      expect(prompt).toBe(AGENT_PUBLISHER_GUIDANCE)
      const first = await definitions.get('publisher_save_draft')!.execute({
        content_type: 'article', title: '对话标题', body: '对话正文',
      }, exec) as { contentId: string; revision: number }
      expect(first.revision).toBe(2)
      const withImage = await definitions.get('publisher_add_image')!.execute({
        expected_revision: first.revision, set_as_cover: true,
        source_image: { attachment_id: id, media_type: 'image/png', bytes: png.length, width: 100, height: 100, name: '生成图.png' },
      }, exec) as { contentId: string; revision: number }
      expect(reads).toMatchObject([{ attachmentId: id }])
      expect(withImage.contentId).toBe(first.contentId)
      expect(withImage.revision).toBe(3)
      expect(readContent(first.contentId, env).assets).toHaveLength(1)
      await expect(definitions.get('publisher_add_image')!.execute({
        expected_revision: withImage.revision,
        source_image: { attachment_id: `sha256:${'c'.repeat(64)}`, media_type: 'image/png', bytes: png.length, width: 100, height: 100 },
      }, exec)).rejects.toThrow('不在当前会话')
      expect(reads).toHaveLength(1)
      expect(readContent(first.contentId, env).revision).toBe(3)
      const cleared = await definitions.get('publisher_save_draft')!.execute({
        expected_revision: withImage.revision, clear_cover: true,
      }, exec) as { revision: number }
      expect(cleared.revision).toBe(4)
      expect(readContent(first.contentId, env).coverAssetId).toBeUndefined()
      const assetId = readContent(first.contentId, env).assets[0]!.id
      const removed = await definitions.get('publisher_remove_image')!.execute({
        expected_revision: cleared.revision, asset_id: assetId,
      }, exec) as { revision: number }
      expect(removed.revision).toBe(5)
      expect(readContent(first.contentId, env).assets).toEqual([])
      expect(await definitions.get('publisher_get_draft')!.execute({}, exec)).toMatchObject({
        contentId: first.contentId, revision: 5,
      })
    } finally {
      dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
    expect(definitions.size).toBe(0)
    expect(prompt).toBe('')
  })
})
