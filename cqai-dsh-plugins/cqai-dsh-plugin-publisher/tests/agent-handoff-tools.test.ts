import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { PublisherArticleHandoffs } from '../src/article-handoff.ts'
import { registerPublisherHandoffTools } from '../src/agent-handoff-tools.ts'
import type { PreparePublisherArticleHandoff, PublisherArticleHandoff } from '../src/article-handoff-protocol.ts'
import { listContents } from '../src/contents.ts'
import { PUBLISHER_ROUTING_SKILL } from '../src/publisher-routing-skill.ts'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
const HANDOFF_ID = '11111111-1111-4111-8111-111111111111'
function dto(request: PreparePublisherArticleHandoff): PublisherArticleHandoff {
  return {
    handoffId: HANDOFF_ID, title: request.title ?? '文章', excerpt: '现有正文',
    platforms: request.platforms ?? [], instructions: request.instructions ?? request.defaultInstructions,
    ...(request.creationBrief ? { creationBrief: request.creationBrief, contentType: request.contentType ?? 'article' } : {}),
    source: { kind: request.creationBrief ? 'creation-brief' : request.messageId ? 'assistant-message' : 'markdown', sessionId: request.sessionId,
      sourceId: 'source-identity', revision: 'source-revision',
      ...(request.creationBrief ? { requestId: request.requestId } : request.messageId ? { messageId: request.messageId } : { fileName: 'article.md' }) },
    sourceChanged: false, sourceAvailable: true,
  }
}
async function fixture(delegating = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'publisher-handoff-tool-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'profile')
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const markdown = join(workspace, 'article.md')
  writeFileSync(markdown, '# 已写文章\n\n原文')
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  if (delegating) await ctx.plugin(SkillRegistry)
  const agents = new Map<string, Agent>()
  ctx.provide('agents', { get: (id: string) => agents.get(id), list: () => [...agents.values()] } as never)
  const readImage = vi.fn(async (_ref: unknown, _signal?: AbortSignal) => ({ data: new Uint8Array() }))
  ctx.provide('attachments', { readImage } as never)
  if (delegating) await ctx.plugin(ToolSkill)
  const owned = new Set<string>()
  const handoffs = { prepare: vi.fn((request: PreparePublisherArticleHandoff) => dto(request)), open: vi.fn(), update: vi.fn() }
  const delegate = vi.fn(async (handoff: PublisherArticleHandoff, source: { agent: Agent; request: { id: string; text: string }; assertCurrent(): void }) => {
    source.assertCurrent()
    return { ...handoff, contentId: '33333333-3333-4333-8333-333333333333', delegation: {
      taskId: '22222222-2222-4222-8222-222222222222', handoffId: handoff.handoffId,
      sourceSessionId: source.agent.id, requestId: source.request.id,
      contentId: '33333333-3333-4333-8333-333333333333', publisherSessionId: 'publisher-session',
      status: 'queued' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } }
  })
  const owner = await ctx.plugin({
    name: 'publisher-handoff-tools-fixture', inject: ['tools', 'agents', 'attachments', ...(delegating ? ['skills'] : [])],
    apply(inner: Context) { inner.effect(() => registerPublisherHandoffTools(inner, handoffs, id => owned.has(id), delegating ? { delegate } : undefined)) },
  })
  let calls = 0
  const mint = (id: string, options: { subagent?: boolean; cwd?: string } = {}) => {
    const session = Session.create(SessionId(id), [], {
      version: 4, id: SessionId(id), createdAt: 0, isSeeded: false, cwd: options.cwd ?? workspace,
      ...(options.subagent ? { origin: 'subagent' as const, parentSession: SessionId('parent') } : {}),
    })
    const agent = { id: session.id, session, status: 'running', options: {} } as unknown as Agent
    Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
    agents.set(id, agent)
    return agent
  }
  const claim = (agent: Agent, text = '请把这篇文章转到多平台发布', synthetic = false) => {
    const message = createUserMessage({ content: [{ type: 'text', text }],
      source: synthetic ? { kind: 'skill-invocation', name: 'unrelated', form: 'instructions' } : { kind: 'user' } })
    agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn: 1 })
    return message
  }
  const execute = (agent: Agent | undefined, args: Record<string, unknown> = { markdown_path: markdown }, signal = new AbortController().signal) =>
    ctx.tools.execute({ agent, name: 'handoff_to_publisher', arguments: args, callId: ToolCallId('handoff-' + ++calls), signal })
  const errorText = (result: Awaited<ReturnType<typeof execute>>) =>
    result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const loadRoute = (agent: Agent) => ctx.tools.execute({ agent, name: 'skill', arguments: { name: PUBLISHER_ROUTING_SKILL.name },
    callId: ToolCallId('route-' + ++calls), signal: new AbortController().signal })
  return { ctx, owner, root, home, workspace, markdown, agents, owned, handoffs, delegate, readImage, mint, claim, execute, errorText, loadRoute }
}

describe('ordinary Agent article handoff using the actual Cordis tool pipeline', () => {
  it('prepares real workspace Markdown through the tool pipeline while preserving the original and creating no draft', async () => {
    const test = await fixture()
    const agent = test.mint('real-markdown')
    test.claim(agent)
    const backend = new PublisherArticleHandoffs({
      session: id => test.agents.get(id)?.session,
      owns: id => test.owned.has(id),
    }, { DSH_HOME: test.home })
    test.handoffs.prepare.mockImplementation(request => backend.prepare(request))
    const before = readFileSync(test.markdown, 'utf8')
    const result = await test.execute(agent, { markdown_path: test.markdown, platforms: ['wxmp'] })
    expect(result.isError).toBe(false)
    const record = result.value as Record<string, unknown>
    expect(record.handoff_id).toMatch(/^[0-9a-f-]{36}$/u)
    expect(record.source).toMatchObject({ sessionId: agent.id, kind: 'markdown', fileName: 'article.md' })
    expect(record.contentId).toBeUndefined()
    expect(readFileSync(test.markdown, 'utf8')).toBe(before)
    expect(listContents({ DSH_HOME: test.home })).toEqual([])
    expect(JSON.stringify(record)).not.toContain(test.workspace)
    const outside = join(test.root, 'outside.md')
    writeFileSync(outside, '# 不属于当前工作目录')
    const denied = await test.execute(agent, { markdown_path: outside })
    expect(denied.isError).toBe(true)
    expect(listContents({ DSH_HOME: test.home })).toEqual([])
  })

  it('prepares a committed assistant article by exact ID and refuses a reply from another session', async () => {
    const test = await fixture()
    const agent = test.mint('real-reply')
    const other = test.mint('foreign-reply')
    test.claim(agent)
    const backend = new PublisherArticleHandoffs({
      session: id => test.agents.get(id)?.session,
      owns: id => test.owned.has(id),
    }, { DSH_HOME: test.home })
    test.handoffs.prepare.mockImplementation(request => backend.prepare(request))
    const assistant = createAssistantMessage({
      content: [{ type: 'text', text: '# 已保存的文章\n\n保持这段原文' }],
      source: { provider: 'fixture', model: 'fixture' },
    })
    agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: assistant }, { surfaceOp: 'append' })
    const result = await test.execute(agent, { message_id: assistant.id })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ source: { kind: 'assistant-message', sessionId: agent.id, messageId: assistant.id } })
    const foreign = createAssistantMessage({
      content: [{ type: 'text', text: '# 别人的文章' }], source: { provider: 'fixture', model: 'fixture' },
    })
    other.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: foreign }, { surfaceOp: 'append' })
    const denied = await test.execute(agent, { message_id: foreign.id })
    expect(denied.isError).toBe(true)
    expect(listContents({ DSH_HOME: test.home })).toEqual([])
  })

  it('adds only one lightweight tool and prepares a source card without importing or publishing', async () => {
    const test = await fixture()
    const agent = test.mint('ordinary')
    test.claim(agent, 'Transfiere este artículo al editor de publicación.')
    expect(test.ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['handoff_to_publisher'])
    const result = await test.execute(agent, { markdown_path: test.markdown, title: '新标题', platforms: ['wxmp', 'juejin'] })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ handoff_id: HANDOFF_ID, handoffId: HANDOFF_ID, title: '新标题',
      instructions: 'Transfiere este artículo al editor de publicación.', source: { sessionId: agent.id, kind: 'markdown' } })
    expect(test.handoffs.prepare).toHaveBeenCalledExactlyOnceWith({
      sessionId: agent.id, markdownPath: test.markdown, title: '新标题', platforms: ['wxmp', 'juejin'],
      instructions: 'Transfiere este artículo al editor de publicación.',
    })
    expect(test.handoffs.open).not.toHaveBeenCalled()
    expect(test.handoffs.update).not.toHaveBeenCalled()
    expect(listContents({ DSH_HOME: test.home })).toEqual([])
    expect(existsSync(join(test.home, 'publisher', 'contents'))).toBe(false)
    expect(JSON.stringify(result.value)).not.toContain(test.workspace)
    expect(test.ctx.get('skills')).toBeUndefined()
  })

  it('forwards only the saved assistant message identity and current human publishing instructions', async () => {
    const test = await fixture()
    const agent = test.mint('reply-source')
    test.claim(agent, 'この返信を投稿エディターに渡してください。')
    const result = await test.execute(agent, { message_id: 'saved-reply-id', instructions: '改成公众号排版，保留原文观点' })
    expect(result.isError).toBe(false)
    expect(test.handoffs.prepare).toHaveBeenCalledExactlyOnceWith({
      sessionId: agent.id, messageId: 'saved-reply-id', instructions: '改成公众号排版，保留原文观点',
    })
    expect(result.value).toMatchObject({ source: { kind: 'assistant-message', messageId: 'saved-reply-id' } })
  })

  it.each([{}, { markdown_path: 'a.md', message_id: 'reply' }])('requires exactly one existing source selector: %j', async args => {
    const test = await fixture()
    const agent = test.mint('exclusive-source')
    test.claim(agent)
    const result = await test.execute(agent, args)
    expect(result.isError).toBe(true)
    expect(test.errorText(result)).toContain('只选择一个')
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })

  it('does not grant handoff from model/Skill context or another conversation human request', async () => {
    const test = await fixture()
    const ordinary = test.mint('no-human')
    const other = test.mint('other-human')
    test.claim(ordinary, 'synthetic instructions', true)
    test.claim(other)
    expect((await test.execute(ordinary)).isError).toBe(true)
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
    test.claim(ordinary)
    expect((await test.execute(ordinary)).isError).toBe(false)
  })

  it('rejects Publisher-owned and subagent executions even with a claimed human request', async () => {
    const test = await fixture()
    const publisher = test.mint('owned')
    test.owned.add(publisher.id)
    const child = test.mint('child', { subagent: true })
    for (const agent of [publisher, child]) {
      test.claim(agent)
      const result = await test.execute(agent)
      expect(result.isError).toBe(true)
      expect(test.errorText(result)).toContain('普通主对话')
    }
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })

  it('rejects absent and replaced live Agent instances', async () => {
    const test = await fixture()
    const old = test.mint('replaced')
    test.claim(old)
    expect((await test.execute(undefined)).isError).toBe(true)
    test.agents.set(old.id, { ...old } as Agent)
    const result = await test.execute(old)
    expect(result.isError).toBe(true)
    expect(test.errorText(result)).toContain('当前仍在运行')
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })

  it('rejects source session/body spoofing and unknown request fields before preparation', async () => {
    const test = await fixture()
    const agent = test.mint('identity-boundary')
    test.claim(agent)
    for (const extra of [{ source_session_id: 'somebody-else' }, { body: 'invented article' }, { cwd: test.root }]) {
      const result = await test.execute(agent, { message_id: 'reply-id', ...extra })
      expect(result.isError).toBe(true)
      expect(test.errorText(result)).toContain('额外来源身份或正文')
    }
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })

  it('requires an absolute current Agent cwd rather than a process directory fallback', async () => {
    const test = await fixture()
    const agent = test.mint('missing-cwd')
    // The SDK rejects relative headers; defend against an invalid external Agent adapter too.
    Object.assign(agent, { session: { header: { cwd: 'relative-directory' } } })
    test.claim(agent)
    const result = await test.execute(agent)
    expect(result.isError).toBe(true)
    expect(test.errorText(result)).toContain('工作目录')
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })

  it('rejects caller cancellation and rechecks cancellation before delivering the prepared handle', async () => {
    const test = await fixture()
    const agent = test.mint('cancelled')
    test.claim(agent)
    const already = new AbortController()
    already.abort()
    expect((await test.execute(agent, undefined, already.signal)).isError).toBe(true)
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
    const during = new AbortController()
    test.handoffs.prepare.mockImplementation(request => { during.abort(); return dto(request) })
    const result = await test.execute(agent, undefined, during.signal)
    expect(result.isError).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('expires a request on new human steering, idle and disposal, and rejects a change during prepare', async () => {
    const test = await fixture()
    const agent = test.mint('request-lifetime')
    test.claim(agent)
    const next = createUserMessage({ content: [{ type: 'text', text: '先不要转交' }], source: { kind: 'user' } })
    agentEvents(test.ctx, agent).emit('agent/inbox/inserted', { message: next })
    expect((await test.execute(agent)).isError).toBe(true)
    test.claim(agent)
    agentEvents(test.ctx, agent).emit('agent/status', { status: 'idle' })
    expect((await test.execute(agent)).isError).toBe(true)
    test.claim(agent)
    agentEvents(test.ctx, agent).emit('agent/disposed', {})
    expect((await test.execute(agent)).isError).toBe(true)
    test.claim(agent)
    test.handoffs.prepare.mockImplementation(request => { test.claim(agent, '新的真人要求'); return dto(request) })
    expect((await test.execute(agent)).isError).toBe(true)
  })

  it('bounds default requirements with an explicit excerpt label, rejects long overrides, and accepts a concise override', async () => {
    const test = await fixture()
    const agent = test.mint('requirements')
    test.claim(agent, '😀'.repeat(1500))
    expect((await test.execute(agent)).isError).toBe(false)
    const request = test.handoffs.prepare.mock.calls[0][0]
    expect(request.instructions).toContain('开头节选')
    expect(request.instructions!.length).toBeLessThanOrEqual(2000)
    expect(request.instructions).not.toMatch(/[\uD800-\uDBFF]$/u)
    const long = await test.execute(agent, { message_id: 'saved', instructions: 'a'.repeat(2001) })
    expect(long.isError).toBe(true)
    expect(test.errorText(long)).toContain('2000')
    const concise = await test.execute(agent, { message_id: 'saved', instructions: '  保持文章观点  ' })
    expect(concise.isError).toBe(false)
    expect(test.handoffs.prepare.mock.lastCall?.[0].instructions).toBe('保持文章观点')
  })

  it('unregisters the tool and event observers when its actual Cordis plugin unloads', async () => {
    const test = await fixture()
    const agent = test.mint('unload')
    test.claim(agent)
    expect((await test.execute(agent)).isError).toBe(false)
    await test.owner.dispose()
    expect(test.ctx.tools.schemas(agent)).toEqual([])
    expect(test.ctx.tools.get('handoff_to_publisher', agent)).toBeUndefined()
    test.claim(agent, '插件卸载后的新输入')
    const count = test.handoffs.prepare.mock.calls.length
    expect((await test.execute(agent)).isError).toBe(true)
    expect(test.handoffs.prepare).toHaveBeenCalledTimes(count)
  })
})

describe('global routing Skill and automatic Publisher delegation', () => {
  it('exposes only the entrance Skill globally and requires a real load before handing off', async () => {
    const test = await fixture(true), agent = test.mint('routing')
    test.claim(agent, '帮我写一篇小红书分享')
    expect((await test.ctx.skills.list({ scope: agent })).map(skill => skill.name)).toEqual(['publisher-route'])
    const blocked = await test.execute(agent, { creation_brief: '分享重庆生活，轻松自然', content_type: 'image-note' })
    expect(blocked.isError).toBe(true)
    expect(test.errorText(blocked)).toContain('先读取 publisher-route')
    expect(test.delegate).not.toHaveBeenCalled()
    const loaded = await test.loadRoute(agent)
    expect(loaded.isError).toBe(false)
    expect(loaded.value).toMatchObject({ name: 'publisher-route', provider: 'cqai-publisher-route' })
    expect(test.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => name.startsWith('publisher_'))).toEqual([])
  })

  it('delegates a creation brief with the current real request identity and concludes only after success', async () => {
    const test = await fixture(true), agent = test.mint('creative')
    const request = test.claim(agent, '帮我写一篇小红书分享，保持真实，不编造经历')
    await test.loadRoute(agent)
    const result = await test.execute(agent, { creation_brief: '重庆生活分享，素材来自当前对话，不编造经历', content_type: 'image-note', platforms: ['xhs'] })
    expect(result.isError).toBe(false)
    expect(result.concludesTurn).toBe(true)
    expect(result.value).toMatchObject({ auto_open: true, task_id: '22222222-2222-4222-8222-222222222222',
      source: { kind: 'creation-brief', requestId: request.id }, delegation: { status: 'queued', sourceSessionId: agent.id } })
    expect(test.handoffs.prepare).toHaveBeenCalledExactlyOnceWith({ sessionId: agent.id, requestId: request.id,
      creationBrief: '重庆生活分享，素材来自当前对话，不编造经历', contentType: 'image-note', platforms: ['xhs'], defaultInstructions: request.content[0].type === 'text' ? request.content[0].text : undefined })
    expect(test.delegate).toHaveBeenCalledOnce()
  })

  it('carries an existing reply and all original requirements without requiring platform keywords', async () => {
    const test = await fixture(true), agent = test.mint('foreign-language')
    const request = test.claim(agent, 'Pasa este texto al especialista y conserva mis requisitos.')
    await test.loadRoute(agent)
    const result = await test.execute(agent, { message_id: 'committed-reply', platforms: ['wxmp'] })
    expect(result.isError).toBe(false)
    expect(test.delegate.mock.calls[0][1].request).toEqual({ id: request.id, text: 'Pasa este texto al especialista y conserva mis requisitos.' })
    expect(result.value).toMatchObject({ source: { messageId: 'committed-reply' }, auto_open: true })
  })

  it('does not reuse an entrance Skill grant after new user steering or another Agent request', async () => {
    const test = await fixture(true), agent = test.mint('old-route'), other = test.mint('other-route')
    test.claim(agent); await test.loadRoute(agent)
    test.claim(other)
    expect((await test.execute(other)).isError).toBe(true)
    test.claim(agent, '现在换一个任务')
    expect((await test.execute(agent)).isError).toBe(true)
    await test.loadRoute(agent)
    expect((await test.execute(agent)).isError).toBe(false)
  })
  it('accepts the native slash Skill instructions delivered in pre-step for the current human request', async () => {
    const test = await fixture(true), agent = test.mint('slash-route')
    const human = test.claim(agent, '/publisher-route 帮我写一篇小红书分享')
    const signal = new AbortController().signal
    const decision = await agentEvents(test.ctx, agent).waterfall('agent/pre-step', {
      messages: [human], turn: 1, step: 1, signal,
    }, async () => ({ kind: 'enter' as const, messages: [human] }))
    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') expect(decision.messages.some(message => message.source.kind === 'skill-invocation'
      && message.source.name === 'publisher-route')).toBe(true)
    const transferred = await test.execute(agent, { creation_brief: '小红书分享，保留用户素材', content_type: 'image-note' })
    expect(transferred.isError).toBe(false)
    expect(transferred.concludesTurn).toBe(true)
    expect(test.delegate).toHaveBeenCalledOnce()
  })

  it('rejects source/brief combinations and content-type changes for existing prose', async () => {
    const test = await fixture(true), agent = test.mint('source-choice')
    test.claim(agent); await test.loadRoute(agent)
    for (const args of [{ creation_brief: 'create', message_id: 'reply' }, { creation_brief: ' ' },
      { creation_brief: 'a'.repeat(8001) }, { message_id: 'reply', content_type: 'image-note' }]) {
      const result = await test.execute(agent, args)
      expect(result.isError).toBe(true)
      expect(result.concludesTurn).not.toBe(true)
    }
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })

  it('preserves source ownership checks when loading the global entrance Skill', async () => {
    const test = await fixture(true)
    for (const agent of [test.mint('publisher'), test.mint('worker', { subagent: true })]) {
      if (agent.id === 'publisher') test.owned.add(agent.id)
      test.claim(agent)
      expect((await test.loadRoute(agent)).isError).toBe(true)
      expect((await test.execute(agent, { creation_brief: '任务' })).isError).toBe(true)
    }
    expect(test.delegate).not.toHaveBeenCalled()
  })

  it('does not conclude the source turn after failed or superseded delegation', async () => {
    const test = await fixture(true), agent = test.mint('handoff-failed')
    test.claim(agent); await test.loadRoute(agent)
    test.delegate.mockRejectedValueOnce(new Error('发布服务未就绪'))
    const failed = await test.execute(agent)
    expect(failed.isError).toBe(true)
    expect(failed.concludesTurn).not.toBe(true)
    test.delegate.mockImplementationOnce(async (handoff, source) => {
      test.claim(agent, '先不要交接')
      source.assertCurrent()
      return handoff as never
    })
    const superseded = await test.execute(agent)
    expect(superseded.isError).toBe(true)
    expect(superseded.concludesTurn).not.toBe(true)
  })

  it('unregisters global routing Skill and execution capability on plugin unload', async () => {
    const test = await fixture(true), agent = test.mint('routing-unload')
    expect((await test.ctx.skills.list({ scope: agent })).map(skill => skill.name)).toContain('publisher-route')
    await test.owner.dispose()
    expect((await test.ctx.skills.list({ scope: agent })).map(skill => skill.name)).not.toContain('publisher-route')
    expect(test.ctx.tools.get('handoff_to_publisher', agent)).toBeUndefined()
  })
  it('reads only current genuine user image references before preparing a creative task', async () => {
    const test = await fixture(true), agent = test.mint('creative-images')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4XcAAAAASUVORK5CYII=', 'base64')
    const ref = { attachmentId: AttachmentId(`sha256:${createHash('sha256').update(png).digest('hex')}`), mediaType: 'image/png' as const,
      bytes: png.length, width: 1, height: 1, name: '真实素材.png' }
    const human = createUserMessage({ content: [{ type: 'text', text: '用这张图片写一篇小红书分享' }, { type: 'image', attachment: ref }], source: { kind: 'user' } })
    agent.session.append('user/message', human, { surfaceOp: 'append' })
    agentEvents(test.ctx, agent).emit('agent/inbox/claimed', { message: human, turn: 1 })
    test.readImage.mockResolvedValue({ data: png })
    await test.loadRoute(agent)
    const backend = new PublisherArticleHandoffs({ session: id => test.agents.get(id)?.session, owns: () => false }, { DSH_HOME: test.home })
    test.handoffs.prepare.mockImplementation(request => backend.prepare(request))
    const transferred = await test.execute(agent, { creation_brief: '根据这张真实图片整理分享，保留图片', content_type: 'image-note' })
    expect(transferred.isError).toBe(false)
    expect(test.readImage).toHaveBeenCalledExactlyOnceWith(ref, expect.any(AbortSignal))
    expect(test.handoffs.prepare.mock.calls[0][0].sourceImages).toEqual([{ ref, data: png }])
    expect(transferred.value).toMatchObject({ source: { kind: 'creation-brief', requestId: human.id } })
    expect(listContents({ DSH_HOME: test.home })).toEqual([])
  })
  it('does not prepare or delegate after an image read fails or new human input supersedes it', async () => {
    const test = await fixture(true), agent = test.mint('image-read-superseded')
    const ref = { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png' as const, bytes: 12, width: 1, height: 1 }
    const claimImage = () => agentEvents(test.ctx, agent).emit('agent/inbox/claimed', { message: createUserMessage({
      content: [{ type: 'text', text: '根据图片创作' }, { type: 'image', attachment: ref }], source: { kind: 'user' } }), turn: 1 })
    claimImage(); await test.loadRoute(agent)
    test.readImage.mockRejectedValueOnce(new Error('图片已经不可读'))
    expect((await test.execute(agent, { creation_brief: '图片分享' })).isError).toBe(true)
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
    test.readImage.mockImplementationOnce(async () => { test.claim(agent, '先不要交接'); return { data: new Uint8Array(12) } })
    expect((await test.execute(agent, { creation_brief: '图片分享' })).isError).toBe(true)
    expect(test.delegate).not.toHaveBeenCalled()
    expect(test.handoffs.prepare).not.toHaveBeenCalled()
  })
})
