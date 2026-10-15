import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublisherArticleHandoffs, readPublisherArticleOrigin } from '../src/article-handoff.ts'
import { listContents, patchContent, readAsset, readContent } from '../src/contents.ts'
import { readPublisherSessionOwnership } from '../src/agent-draft-session.ts'
import { readSessionSourceDocument, registerSourceDocument } from '../src/source-documents.ts'

const failure = vi.hoisted(() => ({ target: '' }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: (from: Parameters<typeof actual.renameSync>[0], to: Parameters<typeof actual.renameSync>[1]) => {
    if (failure.target && String(to) === failure.target) { failure.target = ''; throw new Error('Simulated handoff persistence failure') }
    return actual.renameSync(from, to)
  } }
})

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { failure.target = ''; for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'publisher-article-handoff-'))
  const cwd = join(home, 'ordinary-workspace')
  mkdirSync(cwd)
  const env = { DSH_HOME: home }
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('ordinary-conversation'), { meta: { cwd } })
  const owned = new Set<string>()
  let cold = false
  const handoffs = new PublisherArticleHandoffs({
    session: id => cold ? undefined : ctx.sessions.get(SessionId(id)), owns: id => owned.has(id),
  }, env)
  function assistant(body = '# 外部文章\n\n文章正文') {
    const message = createAssistantMessage({ content: [{ type: 'text', text: body }], source: { provider: 'fixture', model: 'fixture' } })
    session.append('assistant/message', { turn: 1, step: 1, stream: [], message }, { surfaceOp: 'append' })
    return message
  }
  function human(body = '请帮我写一篇城市散步文章，交给发布 Agent 完成', images: readonly ImageAttachmentRef[] = []) {
    const message = createUserMessage({ content: [{ type: 'text', text: body }, ...images.map(attachment => ({ type: 'image' as const, attachment }))], source: { kind: 'user' } })
    session.append('user/message', message, { surfaceOp: 'append' })
    return message
  }
  function markdown(name = 'article.md', body = '# 外部文章\n\n文章正文') {
    const path = join(cwd, name)
    writeFileSync(path, body)
    return path
  }
  cleanup.push(async () => { await ctx.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  return { home, cwd, env, ctx, session, owned, handoffs, assistant, human, markdown,
    cold: () => { cold = true },
    recordFile: (id: string) => join(home, 'publisher', 'article-handoffs', `${id}.json`),
  }
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
function sourceImage(data = validPng, mediaType: ImageAttachmentRef['mediaType'] = 'image/png') {
  const ref: ImageAttachmentRef = { attachmentId: AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`),
    mediaType, bytes: data.length, width: 1, height: 1, name: '来源照片.png' }
  return { ref, data }
}

describe('ordinary-conversation article transfer', () => {
  it('prepares a reviewed creative task without a draft and opens an independent blank article', async () => {
    const test = await fixture()
    const request = test.human('写一篇面向游客的重庆城市散步文章，准备公众号版本')
    const brief = '面向首次到访重庆的游客，写一篇城市散步文章，说明路线与停留建议；不要编造地点开放时间。'
    const card = test.handoffs.prepare({ sessionId: test.session.id, requestId: request.id, creationBrief: brief,
      title: '重庆城市散步', platforms: ['wxmp'] })
    expect(card).toMatchObject({ title: '重庆城市散步', contentType: 'article', creationBrief: brief,
      source: { kind: 'creation-brief', requestId: request.id, sessionId: test.session.id },
      instructions: '写一篇面向游客的重庆城市散步文章，准备公众号版本', sourceChanged: false, updateReady: false })
    expect(listContents(test.env)).toEqual([])
    expect(existsSync(join(test.home, 'publisher', 'publishing-workspace.json'))).toBe(false)
    const opened = test.handoffs.open(test.session.id, card.handoffId)
    expect(opened.content).toMatchObject({ contentType: 'article', workflowVersion: 2, title: '重庆城市散步', body: '', assets: [] })
    expect(opened.content.body).not.toContain(brief)
    expect(readPublisherSessionOwnership(test.session.id, test.env)).toBeNull()
    expect(test.handoffs.origin(opened.content.id)).toMatchObject({ creationBrief: brief, contentType: 'article', contentId: opened.content.id })
  })

  it('creates article and image-note tasks separately while reusing one immutable brief per request and content type', async () => {
    const test = await fixture()
    const request = test.human('准备一篇文章和一组小红书图文')
    const input = { sessionId: test.session.id, requestId: request.id, creationBrief: '先创作城市旅行内容',
      title: '城市旅行', platforms: ['xhs'] as const, instructions: '不要编造经历；提供可编辑稿' }
    const article = test.handoffs.prepare({ ...input, platforms: [...input.platforms] })
    const initial = test.handoffs.open(test.session.id, article.handoffId)
    const edited = patchContent(initial.content.id, { revision: initial.content.revision, patch: { body: 'Publisher Agent 已完成的正文' } }, test.env)
    const repeated = test.handoffs.prepare({ sessionId: test.session.id, requestId: request.id,
      creationBrief: '同一请求的第二次工具调用不能替换已审阅任务', defaultInstructions: '再次打开即可，不要覆盖原要求' })
    expect(repeated).toMatchObject({ handoffId: article.handoffId, creationBrief: input.creationBrief,
      title: input.title, platforms: ['xhs'], instructions: input.instructions, sourceChanged: false, updateReady: false })
    expect(test.handoffs.open(test.session.id, article.handoffId).content).toEqual(edited)
    const imageNote = test.handoffs.prepare({ ...input, platforms: [...input.platforms], contentType: 'image-note' })
    expect(imageNote.handoffId).not.toBe(article.handoffId)
    const imageOpened = test.handoffs.open(test.session.id, imageNote.handoffId)
    expect(imageOpened.content).toMatchObject({ contentType: 'image-note', workflowVersion: 2, body: '', assets: [] })
    expect(imageOpened.content.id).not.toBe(edited.id)
    expect(test.handoffs.open(test.session.id, imageNote.handoffId).content.id).toBe(imageOpened.content.id)
    expect(listContents(test.env)).toHaveLength(2)
  })

  it('requires exactly one source and a genuine request owned by the current ordinary conversation', async () => {
    const test = await fixture()
    const request = test.human()
    const reply = test.assistant()
    const skill = createUserMessage({ content: [{ type: 'text', text: 'Skill 的创作指引' }],
      source: { kind: 'skill-invocation', name: 'routing', form: 'instructions' } })
    test.session.append('user/message', skill, { surfaceOp: 'append' })
    const input = { sessionId: test.session.id, requestId: request.id, creationBrief: '帮我创作内容' }
    expect(() => test.handoffs.prepare({ ...input, messageId: reply.id })).toThrow('请选择一个')
    expect(() => test.handoffs.prepare({ ...input, markdownPath: test.markdown() })).toThrow('请选择一个')
    expect(() => test.handoffs.prepare({ ...input, requestId: reply.id })).toThrow('真实用户请求')
    expect(() => test.handoffs.prepare({ ...input, requestId: skill.id })).toThrow('真实用户请求')
    expect(() => test.handoffs.prepare({ ...input, requestId: 'foreign-request' })).toThrow('真实用户请求')
    expect(() => test.handoffs.prepare({ ...input, creationBrief: '' })).toThrow('必须有内容')
    expect(() => test.handoffs.prepare({ ...input, creationBrief: 'x'.repeat(8001) })).toThrow('8000')
    expect(() => test.handoffs.prepare({ ...input, contentType: 'video' as never })).toThrow('内容类型无效')
    test.owned.add(test.session.id)
    expect(() => test.handoffs.prepare(input)).toThrow('普通主对话')
    expect(listContents(test.env)).toEqual([])
  })

  it('snapshots the genuine request image and imports it once while keeping a creative brief separate from prose', async () => {
    const test = await fixture()
    const image = sourceImage()
    const request = test.human('请用我上传的照片做一组小红书分享', [image.ref, image.ref])
    const input = { sessionId: test.session.id, requestId: request.id, creationBrief: '根据上传照片写小红书图文',
      contentType: 'image-note' as const, sourceImages: [image, image] }
    const card = test.handoffs.prepare(input)
    expect(card).not.toHaveProperty('sourceImages')
    expect(JSON.stringify(card)).not.toContain(image.ref.attachmentId)
    expect(listContents(test.env)).toEqual([])
    const stored = JSON.parse(readFileSync(test.recordFile(card.handoffId), 'utf8'))
    expect(stored.assets).toHaveLength(1)
    const directory = join(test.home, 'publisher', 'article-handoffs', 'assets', card.handoffId, card.source.revision)
    expect(readdirSync(directory)).toEqual([stored.assets[0].id])
    const repeated = test.handoffs.prepare({ ...input, creationBrief: '重复摘要不能替换首次审阅的创作需求' })
    expect(repeated.source.revision).toBe(card.source.revision)
    expect(repeated.creationBrief).toBe(input.creationBrief)
    expect(readdirSync(directory)).toEqual([stored.assets[0].id])
    const opened = test.handoffs.open(test.session.id, card.handoffId)
    expect(opened.content).toMatchObject({ contentType: 'image-note', body: '', workflowVersion: 2 })
    expect(opened.content.assets).toHaveLength(1)
    expect(opened.content.assets[0]).toMatchObject({ name: image.ref.name, mime: image.ref.mediaType, bytes: image.data.length })
    expect(readAsset(opened.content.id, opened.content.assets[0].id, test.env).data).toEqual(validPng)
    const edited = patchContent(opened.content.id, { revision: opened.content.revision, patch: { body: '在发布页面完成的文案' } }, test.env)
    test.handoffs.prepare(input)
    test.cold()
    expect(test.handoffs.open(test.session.id, card.handoffId).content).toEqual(edited)
    expect(listContents(test.env)).toHaveLength(1)
    expect(readAsset(edited.id, edited.assets[0].id, test.env).data).toEqual(validPng)
  })

  it('refuses omitted, foreign or unreadable request pictures before persisting a handoff or creating a draft', async () => {
    const test = await fixture()
    const image = sourceImage()
    const request = test.human('使用这张真实照片写文章', [image.ref])
    const input = { sessionId: test.session.id, requestId: request.id, creationBrief: '基于照片写文章' }
    expect(() => test.handoffs.prepare(input)).toThrow('图片素材未完整转交')
    expect(() => test.handoffs.prepare({ ...input, sourceImages: [] })).toThrow('图片素材未完整转交')
    expect(() => test.handoffs.prepare({ ...input, sourceImages: [{ ...image, ref: { ...image.ref, width: 2 } }] })).toThrow('不属于当前真实用户请求')
    expect(() => test.handoffs.prepare({ ...input, sourceImages: [{ ...image, ref: { ...image.ref, name: '其它图片.png' } }] })).toThrow('不属于当前真实用户请求')
    expect(() => test.handoffs.prepare({ ...input, sourceImages: [{ ...image, ref: { ...image.ref, attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`) } }] })).toThrow('不属于当前真实用户请求')
    expect(() => test.handoffs.prepare({ ...input, sourceImages: [{ ...image, data: Buffer.alloc(image.data.length) }] })).toThrow('字节与引用不一致')
    expect(() => test.handoffs.prepare({ ...input, sourceImages: [{ ...image, data: undefined as never }] })).toThrow('不属于当前真实用户请求')
    const withoutImages = test.human('纯文字任务')
    expect(() => test.handoffs.prepare({ ...input, requestId: withoutImages.id, sourceImages: [image] })).toThrow('图片素材未完整转交')
    expect(existsSync(join(test.home, 'publisher', 'article-handoffs'))).toBe(false)
    expect(listContents(test.env)).toEqual([])
  })

  it('refuses unsupported, oversized and incorrectly labelled request images without dropping any material', async () => {
    const test = await fixture()
    const gif = sourceImage(Buffer.from('GIF89a'), 'image/gif')
    const unsupported = test.human('使用这张 GIF 写分享', [gif.ref])
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, requestId: unsupported.id,
      creationBrief: '照片分享', sourceImages: [gif] })).toThrow('只支持 JPEG、PNG、WebP')
    const mislabeled = sourceImage(Buffer.from('GIF89a'), 'image/png')
    const mismatched = test.human('附件格式必须正确', [mislabeled.ref])
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, requestId: mismatched.id,
      creationBrief: '照片分享', sourceImages: [mislabeled] })).toThrow('字节与引用不一致')
    const image = sourceImage()
    const tooLarge = { ...image, ref: { ...image.ref, bytes: 20 * 1024 * 1024 + 1 } }
    const oversized = test.human('素材太大', [tooLarge.ref])
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, requestId: oversized.id,
      creationBrief: '照片分享', sourceImages: [tooLarge] })).toThrow('20MB')
    const tooMany = test.human('素材太多', Array.from({ length: 21 }, () => image.ref))
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, requestId: tooMany.id,
      creationBrief: '照片分享', sourceImages: Array.from({ length: 21 }, () => image) })).toThrow('最多 20 张图片')
    const reply = test.assistant()
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: reply.id, sourceImages: [image] })).toThrow('只用于创作任务')
    expect(existsSync(join(test.home, 'publisher', 'article-handoffs'))).toBe(false)
    expect(listContents(test.env)).toEqual([])
  })

  it('rolls back newly copied creation images after a failed record write and retries safely', async () => {
    const test = await fixture()
    const image = sourceImage()
    const request = test.human('请使用照片写公众号文章', [image.ref])
    const input = { sessionId: test.session.id, requestId: request.id, creationBrief: '公众号照片文章', sourceImages: [image] }
    const card = test.handoffs.prepare(input)
    const directory = join(test.home, 'publisher', 'article-handoffs', 'assets', card.handoffId, card.source.revision)
    rmSync(test.recordFile(card.handoffId))
    rmSync(directory, { recursive: true })
    failure.target = test.recordFile(card.handoffId)
    expect(() => test.handoffs.prepare(input)).toThrow('Simulated handoff persistence failure')
    expect(existsSync(test.recordFile(card.handoffId))).toBe(false)
    expect(readdirSync(directory)).toEqual([])
    expect(listContents(test.env)).toEqual([])
    const retried = test.handoffs.prepare(input)
    expect(retried.handoffId).toBe(card.handoffId)
    expect(retried.source.revision).toBe(card.source.revision)
    const opened = test.handoffs.open(test.session.id, retried.handoffId)
    expect(opened.content).toMatchObject({ contentType: 'article', body: '' })
    expect(opened.content.assets).toHaveLength(1)
    expect(readAsset(opened.content.id, opened.content.assets[0].id, test.env).data).toEqual(validPng)
  })

  it('keeps the complete reviewed brief and created content after the source becomes cold and prevents prose replacement by a brief', async () => {
    const test = await fixture()
    const request = test.human()
    const brief = '完整创作要求：' + '照片风格、受众及事实约束。'.repeat(300)
    const card = test.handoffs.prepare({ sessionId: test.session.id, requestId: request.id,
      creationBrief: brief, contentType: 'image-note', title: '新的图文创作任务' })
    test.cold()
    expect(test.handoffs.get(test.session.id, card.handoffId).creationBrief).toBe(brief)
    const opened = test.handoffs.open(test.session.id, card.handoffId)
    const edited = patchContent(opened.content.id, { revision: opened.content.revision, patch: { body: '已经完成的图文文案' } }, test.env)
    expect(() => test.handoffs.update(test.session.id, card.handoffId, edited.revision)).toThrow('创作要求不能覆盖')
    expect(test.handoffs.open(test.session.id, card.handoffId).content).toEqual(edited)
    expect(readPublisherArticleOrigin(edited.id, test.env)).toMatchObject({ creationBrief: brief, contentType: 'image-note', updateReady: false })
    expect(readContent(edited.id, test.env).body).toBe('已经完成的图文文案')
  })

  it('prepares a bounded card and instructions without creating a draft, workspace or owned conversation', async () => {
    const test = await fixture()
    const message = test.assistant()
    const card = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id,
      title: '已选文章', platforms: ['xhs', 'wxmp'], instructions: '发布小红书和公众号，保留原文图片' })
    expect(card).toMatchObject({ title: '已选文章', platforms: ['xhs', 'wxmp'], sourceChanged: false, sourceAvailable: true,
      source: { kind: 'assistant-message', sessionId: test.session.id, messageId: message.id },
      instructions: '发布小红书和公众号，保留原文图片' })
    expect(card).not.toHaveProperty('contentId')
    expect(JSON.stringify(card)).not.toContain(test.cwd)
    expect(listContents(test.env)).toEqual([])
    expect(readPublisherSessionOwnership(test.session.id, test.env)).toBeNull()
    expect(existsSync(join(test.home, 'publisher', 'publishing-workspace.json'))).toBe(false)
    card.platforms.push('dy')
    expect(test.handoffs.get(test.session.id, card.handoffId).platforms).toEqual(['xhs', 'wxmp'])
  })

  it('reuses one independent article and preserves manual edits across repeated cards and cold-source openings', async () => {
    const test = await fixture()
    const message = test.assistant()
    const input = { sessionId: test.session.id, messageId: message.id }
    const card = test.handoffs.prepare(input)
    const first = test.handoffs.open(test.session.id, card.handoffId)
    const edited = patchContent(first.content.id, { revision: first.content.revision, patch: { title: '我改的标题', body: '我改的正文' } }, test.env)
    expect(test.handoffs.prepare(input).handoffId).toBe(card.handoffId)
    test.cold()
    const again = test.handoffs.open(test.session.id, card.handoffId)
    expect(again.content).toEqual(edited)
    expect(again.sourceChanged).toBe(false)
    expect(listContents(test.env)).toHaveLength(1)
    expect(readPublisherSessionOwnership(test.session.id, test.env)).toBeNull()
    expect(readPublisherArticleOrigin(first.content.id, test.env)).toMatchObject({
      handoffId: card.handoffId, contentId: first.content.id, source: { messageId: message.id, sessionId: test.session.id },
    })
  })

  it('preserves an Agent handoff title, platforms and instructions when a manual reply action prepares the same source', async () => {
    const test = await fixture()
    const message = test.assistant()
    const first = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id,
      title: 'Agent指定的发布标题', platforms: ['xhs', 'wxmp'], instructions: '分别发布到小红书和公众号，保留完整正文' })
    const manual = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })
    expect(manual).toMatchObject({ handoffId: first.handoffId, title: first.title,
      platforms: first.platforms, instructions: first.instructions })
    const cleared = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, platforms: [], instructions: '' })
    expect(cleared.platforms).toEqual([])
    expect(cleared.instructions).toBeUndefined()
  })

  it('carries only the nearest human instructions before the selected reply and excludes Skills, reasoning and later requests', async () => {
    const test = await fixture()
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '旧请求中的无关上下文' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'reasoning', text: '不携带的内部推理' }, { type: 'text', text: '写一篇公众号文章' },
        { type: 'text', text: '再给小红书准备一个版本' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '不携带的 Skill 内部规范' }],
      source: { kind: 'skill-invocation', name: 'ordinary-writing', form: 'instructions' },
    }), { surfaceOp: 'append' })
    const message = test.assistant()
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '在该回复之后发出的其它请求' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const card = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })
    expect(card.instructions).toBe('写一篇公众号文章\n再给小红书准备一个版本')
    expect(listContents(test.env)).toEqual([])
    const explicit = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, instructions: '显式发布要求优先' })
    expect(explicit.instructions).toBe('显式发布要求优先')
    expect(test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id }).instructions).toBe('显式发布要求优先')
  })

  it('remembers an initial Host default and preserves it when the same source is transferred again', async () => {
    const test = await fixture()
    const path = test.markdown()
    const input = { sessionId: test.session.id, markdownPath: path }
    const first = test.handoffs.prepare({ ...input, defaultInstructions: '发布公众号，保留事实和所有配图' })
    expect(first.instructions).toBe('发布公众号，保留事实和所有配图')
    expect(first).not.toHaveProperty('defaultInstructions')
    const opened = test.handoffs.open(test.session.id, first.handoffId)
    const edited = patchContent(opened.content.id, { revision: opened.content.revision, patch: { body: '已经手动修改的正文' } }, test.env)
    writeFileSync(path, '# 原文新版本\n\n最新原文正文')
    const repeated = test.handoffs.prepare({ ...input, defaultInstructions: '再次打开这篇文章' })
    expect(repeated.instructions).toBe(first.instructions)
    expect(repeated.handoffId).toBe(first.handoffId)
    expect(test.handoffs.origin(opened.content.id)?.instructions).toBe(first.instructions)
    expect(test.handoffs.open(test.session.id, first.handoffId).content).toEqual(edited)
    const explicit = test.handoffs.prepare({ ...input, instructions: '这次明确改为小红书分享', defaultInstructions: '再次打开' })
    expect(explicit.instructions).toBe('这次明确改为小红书分享')
    expect(test.handoffs.prepare({ ...input, defaultInstructions: '以后还要打开' }).instructions).toBe(explicit.instructions)
    expect(test.handoffs.prepare({ ...input, instructions: '', defaultInstructions: '不应补回已明确清除的要求' }).instructions).toBeUndefined()
  })

  it('prefers the genuine source request over a Host default for new replies and creation briefs', async () => {
    const test = await fixture()
    const request = test.human('请写公众号文章，保留我给出的事实')
    const message = test.assistant()
    const reply = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, defaultInstructions: '再次打开文章' })
    expect(reply.instructions).toBe('请写公众号文章，保留我给出的事实')
    const brief = test.handoffs.prepare({ sessionId: test.session.id, requestId: request.id,
      creationBrief: '围绕用户提供的事实写文章', defaultInstructions: '当前请求的简短默认值' })
    expect(brief.instructions).toBe(reply.instructions)
    expect(test.handoffs.prepare({ sessionId: test.session.id, requestId: request.id,
      creationBrief: '新的摘要不能改变已审阅任务', defaultInstructions: '再次转交' }).instructions).toBe(brief.instructions)
  })

  it('does not derive source instructions from Skill messages or from a human request after the selected reply', async () => {
    const test = await fixture()
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '只有 Skill 内容，不能当作用户要求' }],
      source: { kind: 'skill-invocation', name: 'ordinary-writing', form: 'instructions' },
    }), { surfaceOp: 'append' })
    const message = test.assistant()
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '后来才出现的真人请求' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id }).instructions).toBeUndefined()
  })

  it('bounds long human source requirements at 2000 characters and marks the text as an excerpt', async () => {
    const test = await fixture()
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '开头的具体要求。' + '照片📷'.repeat(800) + '完整要求结尾的独特信息' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const message = test.assistant()
    const card = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })
    expect(card.instructions?.length).toBeLessThanOrEqual(2000)
    expect(card.instructions).toContain('来源要求节选')
    expect(card.instructions).toContain('开头的具体要求')
    expect(card.instructions).not.toContain('完整要求结尾的独特信息')
    expect(card.instructions).not.toMatch(/[\uD800-\uDBFF]$/u)
  })

  it('opens a prepared Markdown and its photos after the original file, photos and live source are unavailable', async () => {
    const test = await fixture()
    const image = join(test.cwd, 'photo.png')
    writeFileSync(image, png)
    const path = test.markdown('photo-article.md', '# 图文原稿\n\n文章开头。\n\n![山路](photo.png)\n\n结尾。')
    const card = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path })
    expect(JSON.stringify(card)).not.toContain(test.cwd)
    expect(listContents(test.env)).toEqual([])
    rmSync(path)
    rmSync(image)
    test.cold()
    expect(test.handoffs.get(test.session.id, card.handoffId).sourceAvailable).toBe(false)
    const opened = test.handoffs.open(test.session.id, card.handoffId)
    expect(opened.content.title).toBe('图文原稿')
    expect(opened.content.body).toContain('![山路](ebao-asset://')
    expect(opened.content.body).toContain('文章开头。')
    expect(opened.content.assets).toHaveLength(1)
    expect(readAsset(opened.content.id, opened.content.assets[0].id, test.env).data).toEqual(png)
    expect(opened.handoff.sourceAvailable).toBe(false)
  })

  it('reports changed originals without overwriting and applies an explicit revision-checked update while preserving publication edits', async () => {
    const test = await fixture()
    const image = join(test.cwd, 'photo.png')
    writeFileSync(image, png)
    const path = test.markdown('versioned.md', '# 第一版\n\n第一版正文\n\n![图](photo.png)')
    const card = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path, platforms: ['xhs'] })
    const initial = test.handoffs.open(test.session.id, card.handoffId)
    const edited = patchContent(initial.content.id, { revision: initial.content.revision, patch: {
      body: '手动正文', summary: '保留摘要', tags: ['手动标签'], creativeStatement: 'ai_generated',
      platformFields: { xhs: { location: '重庆' } }, platformVariants: { xhs: { title: '保留平台标题', coverAssetId: initial.content.assets[0].id } },
    } }, test.env)
    writeFileSync(path, '# 第二版\n\n第二版正文\n\n![新图](photo.png)')
    writeFileSync(image, Buffer.concat([png, Buffer.from('new-image')]))
    expect(test.handoffs.get(test.session.id, card.handoffId).sourceChanged).toBe(true)
    expect(test.handoffs.get(test.session.id, card.handoffId).updateReady).toBe(false)
    expect(test.handoffs.open(test.session.id, card.handoffId).content).toEqual(edited)
    const latest = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path, platforms: ['wxmp'], instructions: '新增公众号要求' })
    expect(latest.handoffId).toBe(card.handoffId)
    expect(latest.contentId).toBe(initial.content.id)
    expect(latest.sourceChanged).toBe(true)
    expect(latest.updateReady).toBe(true)
    expect(() => test.handoffs.update(test.session.id, card.handoffId, edited.revision - 1)).toThrow('发布稿已修改')
    expect(readContent(initial.content.id, test.env)).toEqual(edited)
    const updated = test.handoffs.update(test.session.id, card.handoffId, edited.revision)
    expect(updated.content).toMatchObject({ title: '第二版', summary: '保留摘要', tags: ['手动标签'], creativeStatement: 'ai_generated',
      coverAssetId: initial.content.coverAssetId, platformFields: edited.platformFields, platformVariants: edited.platformVariants })
    expect(updated.content.body).toContain('第二版正文')
    expect(updated.content.body).not.toContain('手动正文')
    expect(updated.content.assets).toHaveLength(2)
    expect(updated.sourceChanged).toBe(false)
    expect(updated.handoff.updateReady).toBe(false)
    expect(test.handoffs.open(test.session.id, card.handoffId).content.id).toBe(initial.content.id)
    expect(readFileSync(path, 'utf8')).toContain('第二版正文')
    expect(listContents(test.env)).toHaveLength(1)
  })

  it('keeps multiple Markdown identities separate without replacing the source conversation preview registration', async () => {
    const test = await fixture()
    const first = test.markdown('one.md', '# 第一篇\n\n第一篇正文')
    const second = test.markdown('two.md', '# 第二篇\n\n第二篇正文')
    registerSourceDocument(test.session.id, first, test.env, { allowedRoot: test.cwd })
    const one = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: first })
    const two = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: second })
    expect(one.handoffId).not.toBe(two.handoffId)
    expect(readSessionSourceDocument(test.session.id, test.env)?.title).toBe('第一篇')
    const openedOne = test.handoffs.open(test.session.id, one.handoffId)
    const openedTwo = test.handoffs.open(test.session.id, two.handoffId)
    expect(openedOne.content.id).not.toBe(openedTwo.content.id)
    expect(openedOne.content.body).toBe('第一篇正文')
    expect(openedTwo.content.body).toBe('第二篇正文')
  })

  it('rejects user messages, foreign messages, arbitrary text, missing conversations, owned sessions and subagents', async () => {
    const test = await fixture()
    const assistant = test.assistant()
    const user = createUserMessage({ content: [{ type: 'text', text: '我的要求' }], source: { kind: 'user' } })
    test.session.append('user/message', user, { surfaceOp: 'append' })
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: user.id })).toThrow('不属于当前对话')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: 'foreign-message' })).toThrow('不属于当前对话')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id })).toThrow('请选择一个')
    expect(() => test.handoffs.prepare({ sessionId: 'missing', messageId: assistant.id })).toThrow('普通主对话')
    test.owned.add(test.session.id)
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: assistant.id })).toThrow('普通主对话')
    const subagent = test.ctx.sessions.create(SessionId('child'), { meta: { cwd: test.cwd, origin: 'subagent', parentSession: test.session.id } })
    expect(() => test.handoffs.prepare({ sessionId: subagent.id, messageId: assistant.id })).toThrow('普通主对话')
    expect(listContents(test.env)).toEqual([])
  })

  it('rejects files outside the current cwd, linked files and invalid options without creating drafts', async () => {
    const test = await fixture()
    const outside = join(test.home, 'outside.md')
    writeFileSync(outside, '# 其它项目文章\n\n正文')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, markdownPath: outside })).toThrow('当前 Agent 工作目录')
    const linked = join(test.cwd, 'linked.md')
    symlinkSync(test.cwd, linked, 'junction')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, markdownPath: linked })).toThrow('符号链接')
    const message = test.assistant()
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, markdownPath: outside })).toThrow('请选择一个')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, instructions: 'x'.repeat(2001) })).toThrow('2000')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, defaultInstructions: 'x'.repeat(2001) })).toThrow('2000')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id, platforms: ['xhs', 'xhs'] })).toThrow('转交平台')
    expect(listContents(test.env)).toEqual([])
  })

  it('keeps an opened article when its Markdown is deleted and blocks unsafe source updates', async () => {
    const test = await fixture()
    const path = test.markdown()
    const card = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path })
    const initial = test.handoffs.open(test.session.id, card.handoffId)
    rmSync(path)
    expect(test.handoffs.open(test.session.id, card.handoffId).content).toEqual(initial.content)
    expect(test.handoffs.origin(initial.content.id)?.sourceAvailable).toBe(false)
    expect(() => test.handoffs.update(test.session.id, card.handoffId, initial.content.revision)).toThrow()
    expect(readContent(initial.content.id, test.env)).toEqual(initial.content)
  })

  it('rejects a prepared photo that was changed on disk before any draft is created', async () => {
    const test = await fixture()
    writeFileSync(join(test.cwd, 'photo.png'), png)
    const path = test.markdown('photos.md', '# 文章\n\n![图](photo.png)')
    const card = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path })
    const record = JSON.parse(readFileSync(test.recordFile(card.handoffId), 'utf8'))
    const file = join(test.home, 'publisher', 'article-handoffs', 'assets', card.handoffId, card.source.revision, record.assets[0].id)
    writeFileSync(file, Buffer.alloc(png.length))
    expect(() => test.handoffs.open(test.session.id, card.handoffId)).toThrow('配图快照已变化')
    expect(listContents(test.env)).toEqual([])
  })

  it('rolls back the newly imported article when its handoff link cannot be committed', async () => {
    const test = await fixture()
    const message = test.assistant()
    const card = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })
    const before = readFileSync(test.recordFile(card.handoffId))
    failure.target = test.recordFile(card.handoffId)
    expect(() => test.handoffs.open(test.session.id, card.handoffId)).toThrow('Simulated handoff persistence failure')
    expect(listContents(test.env)).toEqual([])
    expect(readFileSync(test.recordFile(card.handoffId))).toEqual(before)
    expect(readdirSync(join(test.home, 'publisher', 'article-handoffs'))).toEqual([`${card.handoffId}.json`])
    expect(test.handoffs.open(test.session.id, card.handoffId).content.body).toContain('文章正文')
  })

  it('rolls back body and added photos when committing the updated source revision fails', async () => {
    const test = await fixture()
    const photo = join(test.cwd, 'photo.png')
    writeFileSync(photo, png)
    const path = test.markdown('update.md', '# 原文章\n\n原正文\n\n![图](photo.png)')
    const card = test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path })
    const first = test.handoffs.open(test.session.id, card.handoffId)
    writeFileSync(path, '# 新文章\n\n新正文\n\n![图](photo.png)')
    writeFileSync(photo, Buffer.concat([png, Buffer.from('changed')]))
    test.handoffs.prepare({ sessionId: test.session.id, markdownPath: path })
    failure.target = test.recordFile(card.handoffId)
    expect(() => test.handoffs.update(test.session.id, card.handoffId, first.content.revision)).toThrow('Simulated handoff persistence failure')
    expect(readContent(first.content.id, test.env)).toEqual(first.content)
    expect(readdirSync(join(test.home, 'publisher', 'contents', first.content.id, 'assets'))).toEqual([first.content.assets[0].id])
    expect(test.handoffs.get(test.session.id, card.handoffId).sourceChanged).toBe(true)
  })

  it('validates handoff ownership and persisted record bounds and avoids leaking injected private fields', async () => {
    const test = await fixture()
    const message = test.assistant()
    const card = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })
    expect(() => test.handoffs.get('foreign-session', card.handoffId)).toThrow('不属于当前')
    expect(() => test.handoffs.get(test.session.id, '../outside')).toThrow('ID 无效')
    const file = test.recordFile(card.handoffId)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    record.source.secretPath = test.cwd
    writeFileSync(file, JSON.stringify(record))
    expect(JSON.stringify(test.handoffs.get(test.session.id, card.handoffId))).not.toContain(test.cwd)
    writeFileSync(file, Buffer.alloc(8 * 1024 * 1024 + 1))
    expect(() => test.handoffs.get(test.session.id, card.handoffId)).toThrow('记录无效')
    rmSync(file)
    symlinkSync(test.cwd, file, 'junction')
    expect(() => test.handoffs.get(test.session.id, card.handoffId)).toThrow('记录无效')
  })

  it('copies local photos from a recorded assistant article while preserving image titles and code examples', async () => {
    const test = await fixture()
    const photo = join(test.cwd, '照片 (一).png')
    writeFileSync(photo, png)
    const message = test.assistant('# 消息文章\n\n代码示例 `![示例](missing.png)` 保留。\n\n![山路](<照片 (一).png> "图片说明")\n\n```md\n![不读取](outside.png)\n```')
    const before = test.session.snapshotEvents()
    const card = test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })
    expect(listContents(test.env)).toEqual([])
    expect(readFileSync(photo)).toEqual(png)
    expect(test.session.snapshotEvents()).toEqual(before)
    expect(readdirSync(test.cwd)).toEqual(['照片 (一).png'])
    expect(JSON.stringify(card)).not.toContain(test.cwd)
    expect(card.source.kind).toBe('assistant-message')
    rmSync(photo)
    test.cold()
    const opened = test.handoffs.open(test.session.id, card.handoffId)
    expect(opened.content.assets).toHaveLength(1)
    expect(opened.content.assets[0].name).toBe('照片 (一).png')
    expect(opened.content.body).toContain('![山路](<ebao-asset://')
    expect(opened.content.body).toContain('"图片说明"')
    expect(opened.content.body).toContain('`![示例](missing.png)`')
    expect(opened.content.body).toContain('![不读取](outside.png)')
    expect(readAsset(opened.content.id, opened.content.assets[0].id, test.env).data).toEqual(png)
  })

  it('binds repeated message-photo transfers to the same identity while detecting changed image bytes', async () => {
    const test = await fixture()
    const photo = join(test.cwd, 'photo.png')
    writeFileSync(photo, png)
    const message = test.assistant('# 配图文章\n\n![一](photo.png)\n\n![二](photo.png)')
    const input = { sessionId: test.session.id, messageId: message.id }
    const card = test.handoffs.prepare(input)
    const first = test.handoffs.open(test.session.id, card.handoffId)
    expect(first.content.assets).toHaveLength(1)
    expect(test.handoffs.prepare(input).source.revision).toBe(card.source.revision)
    const edited = patchContent(first.content.id, { revision: first.content.revision, patch: { body: '手动改过的正文' } }, test.env)
    writeFileSync(photo, Buffer.concat([png, Buffer.from('updated')]))
    const changed = test.handoffs.prepare(input)
    expect(changed.handoffId).toBe(card.handoffId)
    expect(changed.source.revision).not.toBe(card.source.revision)
    expect(changed.sourceChanged).toBe(true)
    expect(changed.updateReady).toBe(true)
    expect(test.handoffs.open(test.session.id, card.handoffId).content).toEqual(edited)
    const updated = test.handoffs.update(test.session.id, card.handoffId, edited.revision)
    expect(updated.content.body).toContain('![一](ebao-asset://')
    expect(updated.content.body).not.toContain('手动改过的正文')
    expect(updated.sourceChanged).toBe(false)
  })

  it('rejects cloud, opaque attachment, outside-cwd and linked message image references without making a draft', async () => {
    const test = await fixture()
    writeFileSync(join(test.home, 'outside.png'), png)
    const linked = join(test.cwd, 'linked.png')
    symlinkSync(test.cwd, linked, 'junction')
    for (const source of ['https://example.test/photo.png', 'source-image://fake', 'dsh-attachment://image', '../outside.png', 'linked.png']) {
      const message = test.assistant(`# 文章\n\n![图](${source})`)
      expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: message.id })).toThrow(/本地配图|Markdown/u)
    }
    expect(listContents(test.env)).toEqual([])
    expect(readFileSync(join(test.home, 'outside.png'))).toEqual(png)
  })

  it('rejects a malformed local image and unsupported reference syntax instead of dropping article photos', async () => {
    const test = await fixture()
    writeFileSync(join(test.cwd, 'invalid.png'), 'not an image')
    const invalid = test.assistant('# 文章\n\n![图](invalid.png)')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: invalid.id })).toThrow('JPEG、PNG、WebP')
    writeFileSync(join(test.cwd, 'valid.png'), png)
    const reference = test.assistant('# 文章\n\n![图][photo]\n\n[photo]: valid.png')
    expect(() => test.handoffs.prepare({ sessionId: test.session.id, messageId: reference.id })).toThrow('引用暂不支持')
    expect(listContents(test.env)).toEqual([])
  })
})
