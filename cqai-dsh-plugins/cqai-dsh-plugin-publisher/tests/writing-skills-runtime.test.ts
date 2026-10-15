import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SkillRegistry, { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import type { AgentPublications } from '../src/agent-publication.ts'
import {
  ADAPT_PLATFORM_SKILL, EDIT_DRAFT_SKILL, ILLUSTRATE_ARTICLE_SKILL, LEARN_VOICE_SKILL, POLISH_COPY_SKILL, PUBLISHER_SKILL_CATALOG,
  WRITE_ARTICLE_SKILL, WRITING_SKILLS,
} from '../src/agent-skills.ts'
import { PublisherAgentTools } from '../src/agent-tools.ts'
import { createContent, readAsset, readContent, saveContent } from '../src/contents.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})

// Use the real native loader, registry, runtime and scoped tool registrations.
// AgentLoop and the model are unnecessary: claimed input and pre-step are the
// public lifecycle events through which those services grant these capabilities.
async function fixture(mountLoader = true, attachments: object = {}) {
  const home = mkdtempSync(join(tmpdir(), 'publisher-writing-runtime-'))
  cleanups.push(() => rmSync(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const env = { DSH_HOME: home }
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide('attachments', attachments as never)
  for (const service of ['sessions', 'llm', 'sessionProjections']) {
    ctx.provide(service as never, {} as never)
  }
  const agents = new Map<string, Agent>()
  const owned = new Set<string>()
  ctx.provide('agents', { list: () => [...agents.values()], get: (id: string) => agents.get(id) } as never)
  if (mountLoader) await ctx.plugin(ToolSkill)
  const bindings = new AgentDraftBindings(() => true)
  const publications = { prepare: vi.fn(), getStatus: vi.fn() }
  let owner!: PublisherAgentTools
  await ctx.plugin(Object.assign((inner: Context) => {
    owner = new PublisherAgentTools(inner, bindings, publications as unknown as AgentPublications,
      async () => true, id => owned.has(id))
  }, { inject: ['agents', 'tools', 'attachments', 'skills', 'systemPrompt'] }))
  cleanups.push(() => owner.dispose())
  let calls = 0

  const bind = (agent: Agent) => {
    const content = createContent('article', env)
    const binding = bindings.bind(agent.id, content.id, env)!
    owner.refresh(agent.id)
    return { content, binding }
  }
  async function mint(id: string, options: { parent?: Agent; scopeParent?: object; publisherOwned?: boolean; cwd?: string } = {}) {
    const session = Session.create(SessionId(id), [], {
      version: 4, id: SessionId(id), createdAt: 0, isSeeded: false,
      cwd: options.cwd ?? 'C:/publisher-shared',
      ...(options.parent ? { origin: 'subagent' as const, parentSession: options.parent.id } : {}),
    })
    const agent = { id: session.id, session, status: 'running', options: {} } as unknown as Agent
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      const parent = options.parent ?? options.scopeParent
      scope = createScope(inner, agent, parent ? { parent } : undefined)
    }, { inject: ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections'] }))
    Object.assign(agent, { ctx: scope.ctx })
    agents.set(id, agent)
    if (!options.parent && options.publisherOwned !== false) {
      owned.add(id)
      bind(agent)
    }
    await agentEvents(ctx, agent).serial('agent/created', { source: 'startup' })
    return agent
  }
  const mountPresetLoader = async () => {
    const preset = {}
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, preset)
      ToolSkill.apply(scope.ctx)
    }, { inject: ['agents', 'tools', 'skills', 'systemPrompt'] }))
    cleanups.push(() => scope.dispose())
    return preset
  }
  const remove = (agent: Agent) => {
    agents.delete(agent.id)
    agentEvents(ctx, agent).emit('agent/disposed', {})
  }
  const claim = (agent: Agent, text = '根据我的资料修改当前文章') => {
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn: 1 })
    return message
  }
  const execute = (agent: Agent, name: string, args: unknown = {}) => ctx.tools.execute({
    agent, name, arguments: args, callId: ToolCallId(`writing-${++calls}`), signal: new AbortController().signal,
  })
  const load = (agent: Agent, name: string) => execute(agent, 'skill', { name })
  const names = (agent: Agent) => ctx.tools.schemas(agent).map(tool => tool.name)
    .filter(name => name.startsWith('publisher_')).sort()
  const catalog = async (agent: Agent) => (await ctx.skills.list({ scope: agent }))
    .filter(skill => isModelInvocable(skill) || isUserInvocable(skill))
  const assembly = (agent: Agent, signal?: AbortSignal) => ctx.systemPrompt.assemble(assembleContextFor(agent, signal))
  const preStep = (agent: Agent, messages: UserMessage[], signal = new AbortController().signal) =>
    agentEvents(ctx, agent).waterfall('agent/pre-step', { messages, turn: 1, step: 1, signal },
      async (): Promise<PreStepDecision> => ({ kind: 'enter', messages }))
  return { ctx, owner, owned, bindings, publications, env, bind, mint, remove, mountPresetLoader, claim, execute, load, names, catalog, assembly, preStep }
}

const READ_ONLY_WRITING = [WRITE_ARTICLE_SKILL, POLISH_COPY_SKILL, ADAPT_PLATFORM_SKILL]
const PROFILE_READ = 'publisher_get_writing_profile'
const PROFILE_WRITE = 'publisher_update_writing_profile'
const EDIT_TOOLS = [
  'publisher_get_current_draft', 'publisher_update_current_draft',
  'publisher_insert_current_draft_image', 'publisher_add_current_draft_image',
  'publisher_remove_current_draft_image', 'publisher_list_video_works', 'publisher_select_current_video_work',
]
const READ_TOOLS = [...EDIT_TOOLS, PROFILE_READ].sort()
const WRITE_TOOLS = [...READ_TOOLS, PROFILE_WRITE].sort()

function admitted(decision: PreStepDecision): UserMessage[] {
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') throw new Error('unexpected rejected step')
  return decision.messages
}
function textOf(messages: readonly UserMessage[]): string {
  return messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

function generatedImageFixture() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  const image = {
    attachment_id: `sha256:${createHash('sha256').update(png).digest('hex')}`,
    media_type: 'image/png', bytes: png.length, width: 1, height: 1, name: '文章配图.png',
  }
  let afterRead: (() => void) | undefined
  // This is the attachment-service boundary, not a provider/model simulation.
  // Native Skill loading, Publisher tool execution and draft storage remain real.
  const readImage = vi.fn(async (_ref: ImageAttachmentRef, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    afterRead?.()
    return { data: png, ref: {
      attachmentId: image.attachment_id, mediaType: image.media_type,
      bytes: image.bytes, width: image.width, height: image.height, name: image.name,
    } }
  })
  return { png, image, attachments: { readImage }, duringRead: (callback: () => void) => { afterRead = callback } }
}

interface DraftSnapshot {
  content_id: string
  content_type: string
  binding_token: string
  revision: number
  target: { kind: 'main' } | { kind: 'platform'; platform: string }
  body: string
}

function insertion(snapshot: DraftSnapshot, sourceImage: ReturnType<typeof generatedImageFixture>['image'], body: string) {
  return {
    content_id: snapshot.content_id, binding_token: snapshot.binding_token, expected_revision: snapshot.revision,
    source_image: sourceImage, body_with_image_marker: body, alt: '流程示意图',
  }
}

describe('Publisher article illustration through the real native runtime', () => {
  it.each([true, false])('loads the illustration Skill with draft tools and no profile or publication grants (composed loader: %s)', async loader => {
    const test = await fixture(loader)
    const agent = await test.mint(`illustration-loader-${loader}`)
    expect((await test.catalog(agent)).map(skill => skill.name)).toContain(ILLUSTRATE_ARTICLE_SKILL.name)
    expect(test.names(agent)).toEqual([])
    test.claim(agent, '请给这篇文章生成并插入一张配图')
    expect(await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)).toMatchObject({
      isError: false, value: { name: ILLUSTRATE_ARTICLE_SKILL.name },
    })
    expect(test.names(agent)).toEqual([...EDIT_TOOLS].sort())
    for (const name of [PROFILE_READ, PROFILE_WRITE, 'publisher_request_publication']) {
      expect((await test.execute(agent, name)).isError).toBe(true)
    }
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('keeps illustration unavailable to ordinary, unowned, unbound and delegated conversations', async () => {
    const test = await fixture()
    const parent = await test.mint('illustration-owner')
    const ordinary = await test.mint('illustration-ordinary', { publisherOwned: false, cwd: 'C:/ordinary' })
    const unowned = await test.mint('illustration-unowned', { publisherOwned: false })
    test.bind(unowned)
    const unbound = await test.mint('illustration-unbound')
    const binding = test.bindings.current(unbound.id)!
    test.bindings.unbind(unbound.id, binding.bindingToken)
    test.owner.refresh(unbound.id)
    const earlyChild = await test.mint('illustration-child-before', { parent })
    test.claim(parent)
    await test.load(parent, ILLUSTRATE_ARTICLE_SKILL.name)
    const lateChild = await test.mint('illustration-child-after', { parent })
    for (const agent of [ordinary, unowned, unbound, earlyChild, lateChild]) {
      expect((await test.catalog(agent)).map(skill => skill.name)).not.toContain(ILLUSTRATE_ARTICLE_SKILL.name)
      test.claim(agent, '给当前文章配图')
      expect((await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)).isError).toBe(true)
      expect(test.names(agent)).toEqual([])
    }
  })

  it('imports a generated attachment after rereading manual edits and saves a managed article image', async () => {
    const generated = generatedImageFixture()
    const test = await fixture(true, generated.attachments)
    const agent = await test.mint('illustration-managed-image')
    const binding = test.bindings.current(agent.id)!
    const article = readContent(binding.contentId, test.env)
    saveContent(article.id, { ...article, body: '开头段落\n\n结尾段落' }, test.env)
    test.claim(agent, '在两段之间配一张图')
    await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)
    const stale = (await test.execute(agent, 'publisher_get_current_draft')).value as unknown as DraftSnapshot
    const current = readContent(article.id, test.env)
    saveContent(article.id, { ...current, title: '用户手改标题', summary: '保留手写摘要',
      body: '开头段落\n\n用户刚补充的事实\n\n结尾段落' }, test.env)

    expect((await test.execute(agent, 'publisher_insert_current_draft_image',
      insertion(stale, generated.image, '开头段落\n\n{{PUBLISHER_IMAGE}}\n\n结尾段落'))).isError).toBe(true)
    expect(readContent(article.id, test.env).assets).toEqual([])
    const latest = (await test.execute(agent, 'publisher_get_current_draft')).value as unknown as DraftSnapshot
    const result = await test.execute(agent, 'publisher_insert_current_draft_image',
      insertion(latest, generated.image, latest.body.replace('结尾段落', '{{PUBLISHER_IMAGE}}\n\n结尾段落')))
    expect(result.isError).toBe(false)
    const saved = readContent(article.id, test.env)
    expect(saved.assets).toHaveLength(1)
    expect(saved).toMatchObject({ revision: latest.revision + 1, title: '用户手改标题', summary: '保留手写摘要' })
    expect(saved.body).toBe(`开头段落\n\n用户刚补充的事实\n\n![流程示意图](ebao-asset://${saved.assets[0]!.id})\n\n结尾段落`)
    expect(readAsset(article.id, saved.assets[0]!.id, test.env).data).toEqual(generated.png)
    expect(saved.coverAssetId).toBe(saved.assets[0]!.id)
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('rejects another draft and platform insertion, then revokes editing when the drawer closes', async () => {
    const generated = generatedImageFixture()
    const test = await fixture(true, generated.attachments)
    const agent = await test.mint('illustration-scope-checks')
    test.claim(agent)
    await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)
    const main = (await test.execute(agent, 'publisher_get_current_draft')).value as unknown as DraftSnapshot
    const other = createContent('article', test.env)
    expect((await test.execute(agent, 'publisher_insert_current_draft_image', {
      ...insertion(main, generated.image, '{{PUBLISHER_IMAGE}}'), content_id: other.id,
    })).isError).toBe(true)
    expect(readContent(other.id, test.env).assets).toEqual([])
    const platform = test.bindings.bind(agent.id, main.content_id, test.env, { kind: 'platform', platform: 'xhs' })!
    test.owner.refresh(agent.id)
    test.claim(agent, '为这个平台版本添加图片')
    await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)
    const selected = (await test.execute(agent, 'publisher_get_current_draft')).value as unknown as DraftSnapshot
    expect(selected.target).toEqual({ kind: 'platform', platform: 'xhs' })
    expect((await test.execute(agent, 'publisher_insert_current_draft_image',
      insertion(selected, generated.image, '{{PUBLISHER_IMAGE}}'))).isError).toBe(true)
    expect(readContent(main.content_id, test.env)).toMatchObject({ revision: main.revision, body: '', assets: [] })
    expect(generated.attachments.readImage).not.toHaveBeenCalled()
    test.bindings.unbind(agent.id, platform.bindingToken)
    test.owner.refresh(agent.id)
    expect(test.names(agent)).toEqual([])
    expect((await test.catalog(agent)).map(skill => skill.name)).not.toContain(ILLUSTRATE_ARTICLE_SKILL.name)
    expect((await test.execute(agent, 'publisher_insert_current_draft_image',
      insertion(selected, generated.image, '{{PUBLISHER_IMAGE}}'))).isError).toBe(true)
    expect(readContent(main.content_id, test.env).assets).toEqual([])
  })

  it.each(['image-note', 'video'] as const)('does not insert article images into a bound %s', async contentType => {
    const generated = generatedImageFixture()
    const test = await fixture(true, generated.attachments)
    const agent = await test.mint(`illustration-type-${contentType}`)
    const content = createContent(contentType, test.env)
    test.bindings.bind(agent.id, content.id, test.env)
    test.owner.refresh(agent.id)
    test.claim(agent)
    expect((await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)).isError).toBe(false)
    const selected = (await test.execute(agent, 'publisher_get_current_draft')).value as unknown as DraftSnapshot
    expect(selected.content_type).toBe(contentType)
    expect((await test.execute(agent, 'publisher_insert_current_draft_image',
      insertion(selected, generated.image, '{{PUBLISHER_IMAGE}}'))).isError).toBe(true)
    expect(readContent(content.id, test.env)).toMatchObject({ revision: 1, assets: [] })
    expect(generated.attachments.readImage).not.toHaveBeenCalled()
  })

  it('rejects a delayed attachment after the drawer switches to another article', async () => {
    const generated = generatedImageFixture()
    const test = await fixture(true, generated.attachments)
    const agent = await test.mint('illustration-delayed-import')
    test.claim(agent)
    await test.load(agent, ILLUSTRATE_ARTICLE_SKILL.name)
    const before = (await test.execute(agent, 'publisher_get_current_draft')).value as unknown as DraftSnapshot
    const other = createContent('article', test.env)
    generated.duringRead(() => { test.bindings.bind(agent.id, other.id, test.env) })
    expect((await test.execute(agent, 'publisher_insert_current_draft_image',
      insertion(before, generated.image, '{{PUBLISHER_IMAGE}}'))).isError).toBe(true)
    for (const id of [before.content_id, other.id]) {
      expect(readContent(id, test.env)).toMatchObject({ revision: 1, body: '', assets: [] })
    }
  })
})

describe('Publisher writing Skills through the real native runtime', () => {
  it('declares four distinct editing Skills with explicit profile access', () => {
    expect(WRITING_SKILLS.map(skill => skill.name)).toEqual([
      'publisher-write-article', 'publisher-polish-copy', 'publisher-learn-voice', 'publisher-adapt-platform',
    ])
    for (const skill of WRITING_SKILLS) {
      expect(PUBLISHER_SKILL_CATALOG.find(entry => entry.skill.name === skill.name)).toMatchObject({
        skill, capability: 'edit', writingProfile: skill === LEARN_VOICE_SKILL ? 'write' : 'read',
      })
    }
  })

  it.each(READ_ONLY_WRITING)('loads $name with working draft editing and profile read, without profile write or publication', async skill => {
    const test = await fixture()
    const agent = await test.mint(`reader-${skill.name}`)
    test.claim(agent)
    expect(test.names(agent)).toEqual([])
    expect((await test.load(agent, skill.name))).toMatchObject({ isError: false, value: { name: skill.name, content: skill.content } })
    expect(test.names(agent)).toEqual(READ_TOOLS)
    expect(await test.execute(agent, PROFILE_READ)).toMatchObject({ isError: false, value: { revision: 0, instructions: null } })
    const draft = await test.execute(agent, 'publisher_get_current_draft')
    const snapshot = draft.value as { content_id: string; binding_token: string; revision: number }
    expect(await test.execute(agent, 'publisher_update_current_draft', {
      content_id: snapshot.content_id, binding_token: snapshot.binding_token,
      expected_revision: snapshot.revision, title: '保留事实的中文标题',
    })).toMatchObject({ isError: false, value: { title: '保留事实的中文标题' } })
    expect(readContent(snapshot.content_id, test.env).title).toBe('保留事实的中文标题')
    expect((await test.execute(agent, PROFILE_WRITE, {
      content_id: snapshot.content_id, binding_token: snapshot.binding_token,
      expected_revision: 0, instructions: '未经学习授权的规则',
    })).isError).toBe(true)
    expect((await test.execute(agent, 'publisher_request_publication', {})).isError).toBe(true)
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('lets only the loaded voice-learning Skill save profile instructions with a separate optimistic revision', async () => {
    const test = await fixture()
    const agent = await test.mint('learn-voice')
    test.claim(agent, '请从这些样稿学习我的写作风格并保存')
    expect((await test.load(agent, LEARN_VOICE_SKILL.name)).isError).toBe(false)
    expect(test.names(agent)).toEqual(WRITE_TOOLS)
    const binding = test.bindings.current(agent.id)!
    const save = { content_id: binding.contentId, binding_token: binding.bindingToken,
      expected_revision: 0, instructions: '写给初学者；保留口语化短句，不虚构亲身经历。' }
    expect(await test.execute(agent, PROFILE_WRITE, save)).toMatchObject({
      isError: false, value: { revision: 1, instructions: save.instructions },
    })
    expect((await test.execute(agent, PROFILE_WRITE, { ...save, instructions: '过期的覆盖' })).isError).toBe(true)
    expect(await test.execute(agent, PROFILE_READ)).toMatchObject({
      isError: false, value: { revision: 1, instructions: save.instructions },
    })
    test.claim(agent, '按刚才保存的风格写文章')
    expect((await test.load(agent, WRITE_ARTICLE_SKILL.name)).isError).toBe(false)
    expect(test.names(agent)).toEqual(READ_TOOLS)
    expect(await test.execute(agent, PROFILE_READ)).toMatchObject({
      isError: false, value: { revision: 1, instructions: save.instructions },
    })
    expect(test.names(agent)).not.toContain('publisher_request_publication')
  })

  it('keeps ordinary, same-directory unowned and delegated conversations outside the writing catalog and tools', async () => {
    const test = await fixture()
    const parent = await test.mint('catalog-owner')
    const ordinary = await test.mint('ordinary', { publisherOwned: false, cwd: 'C:/ordinary' })
    const manual = await test.mint('same-directory', { publisherOwned: false })
    const earlyChild = await test.mint('early-child', { parent })
    expect(manual.session.header.cwd).toBe(parent.session.header.cwd)
    test.bind(manual) // A matching cwd and even a synthetic binding do not confer ownership.
    expect((await test.catalog(parent)).map(skill => skill.name)).toEqual(expect.arrayContaining(WRITING_SKILLS.map(skill => skill.name)))
    test.claim(parent)
    await test.load(parent, LEARN_VOICE_SKILL.name)
    const lateChild = await test.mint('late-child', { parent })
    for (const agent of [ordinary, manual, earlyChild, lateChild]) {
      expect((await test.catalog(agent)).map(skill => skill.name).filter(name => WRITING_SKILLS.some(skill => skill.name === name))).toEqual([])
      expect(test.names(agent)).toEqual([])
      const human = test.claim(agent, '/publisher-learn-voice 学习样稿')
      for (const skill of WRITING_SKILLS) expect((await test.load(agent, skill.name)).isError).toBe(true)
      await test.assembly(agent)
      const messages = admitted(await test.preStep(agent, [human]))
      expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(false)
      expect((await test.execute(agent, PROFILE_READ)).isError).toBe(true)
      expect((await test.execute(agent, PROFILE_WRITE, {})).isError).toBe(true)
      expect(test.names(agent)).toEqual([])
    }
  })

  it.each(['closed-binding', 'idle', 'new-human', 'new-draft', 'lost-ownership'] as const)('revokes profile grants after %s', async reason => {
    const test = await fixture()
    const agent = await test.mint(`revoke-${reason}`)
    test.claim(agent)
    await test.load(agent, LEARN_VOICE_SKILL.name)
    const binding = test.bindings.current(agent.id)!
    if (reason === 'closed-binding') test.bindings.unbind(agent.id, binding.bindingToken)
    if (reason === 'idle') agentEvents(test.ctx, agent).emit('agent/status', { status: 'idle' })
    if (reason === 'new-human') test.claim(agent, '先讨论别的，不要修改规则')
    if (reason === 'new-draft') test.bind(agent)
    if (reason === 'lost-ownership') test.owned.delete(agent.id)
    test.owner.refresh(agent.id)
    expect(test.names(agent)).toEqual([])
    expect((await test.execute(agent, PROFILE_READ)).isError).toBe(true)
    expect((await test.execute(agent, PROFILE_WRITE, {
      content_id: binding.contentId, binding_token: binding.bindingToken, expected_revision: 0, instructions: '过期请求',
    })).isError).toBe(true)
  })

  it('deduplicates repeated and combined loads and adds write access only after voice learning is actually loaded', async () => {
    const test = await fixture()
    const agent = await test.mint('combined-writing-skills')
    const sibling = await test.mint('writing-sibling')
    test.claim(agent)
    for (const skill of [...READ_ONLY_WRITING, ...READ_ONLY_WRITING]) {
      expect((await test.load(agent, skill.name)).isError).toBe(false)
      expect(test.names(agent)).toEqual(READ_TOOLS)
      expect(new Set(test.names(agent)).size).toBe(test.names(agent).length)
    }
    expect(test.names(sibling)).toEqual([])
    for (const skill of [LEARN_VOICE_SKILL, WRITE_ARTICLE_SKILL, LEARN_VOICE_SKILL]) {
      expect((await test.load(agent, skill.name)).isError).toBe(false)
      expect(test.names(agent)).toEqual(WRITE_TOOLS)
      expect(new Set(test.names(agent)).size).toBe(test.names(agent).length)
    }
    expect(test.names(agent)).not.toContain('publisher_request_publication')
    expect(test.names(sibling)).toEqual([])
  })

  it.each(['none', 'read-first', 'edit-first'] as const)('grants native slash voice tools in the exact first assembly after instructions are delivered (%s)', async existing => {
    const test = await fixture()
    const agent = await test.mint(`slash-voice-${existing}`)
    const human = test.claim(agent, '/publisher-learn-voice 根据我的样稿保存风格')
    if (existing === 'read-first') await test.load(agent, WRITE_ARTICLE_SKILL.name)
    if (existing === 'edit-first') await test.load(agent, EDIT_DRAFT_SKILL.name)
    const first = await test.assembly(agent)
    expect(first.tools.map(tool => tool.name)).not.toContain(PROFILE_WRITE)
    const messages = admitted(await test.preStep(agent, [human]))
    expect(textOf(messages.filter(message => message.source.kind === 'skill-invocation'))).toContain(LEARN_VOICE_SKILL.content)
    expect(first.tools.map(tool => tool.name).filter(name => name.startsWith('publisher_')).sort()).toEqual(WRITE_TOOLS)
    expect(test.names(agent)).toEqual(WRITE_TOOLS)
    const binding = test.bindings.current(agent.id)!
    expect(await test.execute(agent, PROFILE_WRITE, {
      content_id: binding.contentId, binding_token: binding.bindingToken, expected_revision: 0, instructions: '自然，克制，讲清楚实操步骤。',
    })).toMatchObject({ isError: false, value: { revision: 1 } })
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('rolls back a failed slash write upgrade while preserving an earlier read-only grant', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-profile-upgrade-rollback')
    const human = test.claim(agent, '/publisher-learn-voice 学习风格')
    await test.load(agent, WRITE_ARTICLE_SKILL.name)
    const first = await test.assembly(agent)
    test.ctx.on('system-prompt/assemble', async () => { throw new Error('profile reassembly failed') })
    await expect(test.preStep(agent, [human])).rejects.toThrow('profile reassembly failed')
    expect(test.names(agent)).toEqual(READ_TOOLS)
    expect(first.tools.map(tool => tool.name).filter(name => name.startsWith('publisher_')).sort()).toEqual(READ_TOOLS)
    expect((await test.execute(agent, PROFILE_WRITE, {})).isError).toBe(true)
    expect((await test.execute(agent, PROFILE_READ)).isError).toBe(false)
  })

  it('supplies the official loader to a bound minimal-preset Agent without adding it to ordinary same-directory Agents', async () => {
    const test = await fixture(false)
    const manual = await test.mint('minimal-manual', { publisherOwned: false })
    expect(test.ctx.tools.get('skill')).toBeUndefined()
    expect(test.ctx.tools.get('skill', manual)).toBeUndefined()
    const owner = await test.mint('minimal-owner')
    expect(manual.session.header.cwd).toBe(owner.session.header.cwd)
    test.bind(manual)
    expect(test.ctx.tools.get('skill', owner)).toBeDefined()
    expect(test.ctx.tools.get('skill', manual)).toBeUndefined()
    expect(test.ctx.tools.get('skill')).toBeUndefined()
    test.claim(owner)
    for (const skill of READ_ONLY_WRITING) {
      expect(await test.load(owner, skill.name)).toMatchObject({
        isError: false, value: { name: skill.name, content: skill.content },
      })
      expect(test.names(owner)).toEqual(READ_TOOLS)
    }
    expect(await test.execute(owner, PROFILE_READ)).toMatchObject({ isError: false, value: { revision: 0, instructions: null } })
    expect((await test.load(manual, LEARN_VOICE_SKILL.name)).isError).toBe(true)
    expect(test.names(manual)).toEqual([])
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('delivers minimal-preset native slash instructions before adding profile tools to the first assembly', async () => {
    const test = await fixture(false)
    const agent = await test.mint('minimal-slash')
    const human = test.claim(agent, '/publisher-learn-voice 从样稿学习并保存表达规则')
    const first = await test.assembly(agent)
    expect(first.tools.map(tool => tool.name)).toContain('skill')
    expect(test.names(agent)).toEqual([])
    const messages = admitted(await test.preStep(agent, [human]))
    expect(textOf(messages.filter(message => message.source.kind === 'skill-invocation'))).toContain(LEARN_VOICE_SKILL.content)
    expect(first.tools.map(tool => tool.name).filter(name => name.startsWith('publisher_')).sort()).toEqual(WRITE_TOOLS)
    const binding = test.bindings.current(agent.id)!
    expect(await test.execute(agent, PROFILE_WRITE, {
      content_id: binding.contentId, binding_token: binding.bindingToken,
      expected_revision: 0, instructions: '用真实经历说明问题，不添加虚构细节。',
    })).toMatchObject({ isError: false, value: { revision: 1 } })
  })

  it('disposes a minimal-preset loader with its binding and recreates it only for a newly bound owned Agent', async () => {
    const test = await fixture(false)
    const agent = await test.mint('minimal-loader-lifecycle')
    const firstLoader = test.ctx.tools.get('skill', agent)
    expect(firstLoader).toBeDefined()
    const binding = test.bindings.current(agent.id)!
    test.bindings.unbind(agent.id, binding.bindingToken)
    test.owner.refresh(agent.id)
    await expect.poll(() => test.ctx.tools.get('skill', agent)).toBeUndefined()
    expect((await test.catalog(agent)).map(skill => skill.name)).not.toContain(LEARN_VOICE_SKILL.name)
    expect((await test.load(agent, LEARN_VOICE_SKILL.name)).isError).toBe(true)
    test.bind(agent)
    expect(test.ctx.tools.get('skill', agent)).toBeDefined()
    expect(test.ctx.tools.get('skill', agent)).not.toBe(firstLoader)
    test.claim(agent)
    expect((await test.load(agent, LEARN_VOICE_SKILL.name)).isError).toBe(false)
    expect(test.names(agent)).toEqual(WRITE_TOOLS)
    test.owner.dispose()
    await expect.poll(() => test.ctx.tools.get('skill', agent)).toBeUndefined()
    expect(test.names(agent)).toEqual([])
  })

  it('keeps all four writing Skills executable after an unbind and rebind in the same tick finishes tearing down the old loader', async () => {
    const test = await fixture(false)
    const agent = await test.mint('minimal-same-tick-rebind')
    const oldLoader = test.ctx.tools.get('skill', agent)
    expect(oldLoader).toBeDefined()
    const binding = test.bindings.current(agent.id)!
    // Do not yield between closing and reopening the same editor. The old
    // native loader remains in the registry while its scope disposes.
    test.bindings.unbind(agent.id, binding.bindingToken)
    test.owner.refresh(agent.id)
    test.bindings.bind(agent.id, binding.contentId, test.env)
    test.owner.refresh(agent.id)
    await expect.poll(() => {
      const current = test.ctx.tools.get('skill', agent)
      return !!current && current !== oldLoader
    }).toBe(true)
    expect((await test.catalog(agent)).map(skill => skill.name)).toEqual(expect.arrayContaining(WRITING_SKILLS.map(skill => skill.name)))
    test.claim(agent, '继续当前稿件的写作与风格学习')
    for (const skill of WRITING_SKILLS) {
      expect(await test.load(agent, skill.name)).toMatchObject({
        isError: false, value: { name: skill.name, content: skill.content },
      })
    }
    expect(test.names(agent)).toEqual(WRITE_TOOLS)
    expect((await test.execute(agent, PROFILE_READ)).isError).toBe(false)
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it.each(['agent-removed', 'publisher-disposed'] as const)('does not revive a queued minimal loader after %s during teardown', async ending => {
    const test = await fixture(false)
    const agent = await test.mint(`minimal-pending-${ending}`)
    const binding = test.bindings.current(agent.id)!
    test.bindings.unbind(agent.id, binding.bindingToken)
    test.owner.refresh(agent.id)
    test.bindings.bind(agent.id, binding.contentId, test.env)
    test.owner.refresh(agent.id)
    if (ending === 'agent-removed') test.remove(agent)
    else test.owner.dispose()
    await expect.poll(() => test.ctx.tools.get('skill', agent)).toBeUndefined()
    // Let disposal continuations and any queued refresh run before checking
    // that a removed Agent or unloaded Publisher cannot regain the loader.
    await new Promise<void>(resolve => setImmediate(resolve))
    test.owner.refresh(agent.id)
    expect(test.ctx.tools.get('skill', agent)).toBeUndefined()
    expect(test.names(agent)).toEqual([])
    expect((await test.catalog(agent)).map(skill => skill.name)).not.toContain(LEARN_VOICE_SKILL.name)
    expect((await test.load(agent, LEARN_VOICE_SKILL.name)).isError).toBe(true)
    expect((await test.execute(agent, PROFILE_WRITE, {})).isError).toBe(true)
  })

  it('preserves an existing native loader through binding refreshes and unbinding', async () => {
    const test = await fixture()
    const original = test.ctx.tools.get('skill')
    expect(original).toBeDefined()
    const agent = await test.mint('standard-loader')
    expect(test.ctx.tools.get('skill', agent)).toBe(original)
    test.owner.refresh(agent.id)
    expect(test.ctx.tools.get('skill', agent)).toBe(original)
    const binding = test.bindings.current(agent.id)!
    test.bindings.unbind(agent.id, binding.bindingToken)
    test.owner.refresh(agent.id)
    expect(test.ctx.tools.get('skill', agent)).toBe(original)
    test.owner.dispose()
    expect(test.ctx.tools.get('skill', agent)).toBe(original)
  })

  it.each(['global', 'preset'] as const)('does not bypass an Agent restriction on the inherited %s skill loader', async inherited => {
    const test = await fixture(inherited === 'global')
    const scopeParent = inherited === 'preset' ? await test.mountPresetLoader() : undefined
    const agent = await test.mint(`restricted-loader-${inherited}`, { publisherOwned: false, scopeParent })
    expect(test.ctx.tools.get('skill', agent)).toBeDefined()
    // DSH restrictions filter inherited tools, so the preset is an ancestor
    // scope rather than an Agent-local registration or a delegated subagent.
    agent.ctx.tools.restrict({ deny: ['skill'] })
    test.owned.add(agent.id)
    test.bind(agent)
    const human = test.claim(agent, '/publisher-learn-voice 保存样稿风格')
    // Registry visibility alone is not authorization: exercise the execution
    // boundary as well as slash delivery and the resulting first-step tools.
    expect((await test.load(agent, LEARN_VOICE_SKILL.name)).isError).toBe(true)
    const first = await test.assembly(agent)
    await test.preStep(agent, [human])
    expect(first.tools.map(tool => tool.name).filter(name => name.startsWith('publisher_'))).toEqual([])
    expect(test.names(agent)).toEqual([])
    expect((await test.execute(agent, PROFILE_WRITE, {})).isError).toBe(true)
  })

  it('keeps minimal-preset child Agents outside Publisher Skills and profile changes before and after their parent receives a loader', async () => {
    const test = await fixture(false)
    const parent = await test.mint('minimal-parent', { publisherOwned: false })
    const before = await test.mint('minimal-child-before', { parent })
    test.owned.add(parent.id)
    test.bind(parent)
    test.claim(parent)
    expect((await test.load(parent, LEARN_VOICE_SKILL.name)).isError).toBe(false)
    const after = await test.mint('minimal-child-after', { parent })
    for (const child of [before, after]) {
      const human = test.claim(child, '/publisher-learn-voice 改变风格')
      expect((await test.catalog(child)).map(skill => skill.name).filter(name => WRITING_SKILLS.some(skill => skill.name === name))).toEqual([])
      expect((await test.load(child, LEARN_VOICE_SKILL.name)).isError).toBe(true)
      const first = await test.assembly(child)
      const messages = admitted(await test.preStep(child, [human]))
      expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(false)
      expect(first.tools.map(tool => tool.name)).not.toContain(PROFILE_WRITE)
      expect(test.names(child)).toEqual([])
      expect((await test.execute(child, PROFILE_WRITE, {})).isError).toBe(true)
    }
    expect(test.names(parent)).toEqual(WRITE_TOOLS)
  })
})
