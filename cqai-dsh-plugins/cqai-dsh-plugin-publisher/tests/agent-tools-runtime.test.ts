import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SkillRegistry, { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import type { AgentPublications } from '../src/agent-publication.ts'
import { EDIT_DRAFT_SKILL, PUBLISHING_SKILL } from '../src/agent-skills.ts'
import { PublisherAgentTools } from '../src/agent-tools.ts'
import { createContent } from '../src/contents.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

interface ProgramRequest {
  bindings: { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[]
  signal: AbortSignal
}
interface ProgramResult {
  logs: string[]
  value?: unknown
  error?: { kind: 'exception'; message: string }
}

async function fixture(mode: 'native' | 'ptc' = 'native', mountLoader = true) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  // Exercise DSH's real run_code bridge and its nested execution pipeline.
  // The fake provider drives bindings directly; no program process or UI is started.
  const runtime = {
    language: 'typescript',
    resolve: (request: ProgramRequest) => request,
    run: vi.fn(async (request: ProgramRequest): Promise<ProgramResult> => ({
      logs: [], value: await request.bindings[0].functions.skill({ name: PUBLISHING_SKILL.name }),
    })),
  }
  if (mode === 'ptc') ctx.provide('ptcRuntime' as never, runtime as never)
  await ctx.plugin(ToolRuntime, { mode })
  await ctx.plugin(SkillRegistry)
  ctx.provide('attachments', {} as never)
  ctx.provide('sessions', {} as never)
  ctx.provide('llm', {} as never)
  ctx.provide('sessionProjections', {} as never)
  const agents = new Map<string, Agent>()
  ctx.provide('agents', { list: () => [...agents.values()], get: (id: string) => agents.get(id) } as never)
  if (mountLoader) await ctx.plugin(ToolSkill)
  ctx.tools.register(defineTool({
    name: 'ordinary_read', description: 'An unrelated read capability.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'ordinary',
  }))
  const bindings = new AgentDraftBindings()
  const publications = { prepare: vi.fn(), getStatus: vi.fn() }
  const permit = vi.fn(async () => true)
  let owner!: PublisherAgentTools
  let publisherCtx!: Context
  await ctx.plugin(Object.assign((inner: Context) => {
    publisherCtx = inner
    owner = new PublisherAgentTools(inner, bindings, publications as unknown as AgentPublications, permit)
  }, { inject: ['agents', 'tools', 'attachments', 'skills', 'systemPrompt'] }))
  cleanups.push(() => owner.dispose())
  let calls = 0

  async function mint(id: string, options: { parent?: Agent; forkOf?: Agent } = {}): Promise<Agent> {
    const session = Session.create(SessionId(id), [], {
      version: 4, id: SessionId(id), createdAt: 0, isSeeded: false,
      ...(options.parent ? { origin: 'subagent' as const, parentSession: options.parent.id } : {}),
      ...(options.forkOf ? { parentSession: options.forkOf.id } : {}),
    })
    const agent = { id: session.id, session, status: 'running', options: {} } as unknown as Agent
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent, options.parent ? { parent: options.parent } : undefined)
    // AgentLoop's scoped context has no skills/attachments dependency API;
    // Publisher must register through its own dependencies using this Agent key.
    }, { inject: ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections'] }))
    Object.assign(agent, { ctx: scope.ctx })
    agents.set(id, agent)
    await agentEvents(ctx, agent).serial('agent/created', { source: 'startup' })
    return agent
  }
  const claim = (agent: Agent, text = '请把文章发布到小红书', kind: 'user' | 'skill-invocation' = 'user') => {
    const message = createUserMessage({ content: [{ type: 'text', text }],
      source: kind === 'user' ? { kind } : { kind, name: PUBLISHING_SKILL.name, form: 'instructions' } })
    agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn: 1 })
    return message
  }
  const assembly = (agent: Agent, signal?: AbortSignal) => ctx.systemPrompt.assemble(assembleContextFor(agent, signal))
  const names = (agent: Agent) => ctx.tools.schemas(agent).map(tool => tool.name)
  const skillsFor = (agent: Agent) => createScope(publisherCtx, agent).ctx.skills
  const load = (agent: Agent, name = PUBLISHING_SKILL.name, signal = new AbortController().signal) =>
    ctx.tools.execute({ agent, name: 'skill', arguments: { name }, callId: ToolCallId(`skill-${++calls}`), signal })
  const run = (agent: Agent, signal = new AbortController().signal) => ctx.tools.execute({
    agent, name: 'run_code', arguments: { code: 'return await tools.skill({name:"multiplatform-publish"})', description: 'Load publishing instructions.' },
    callId: ToolCallId(`program-${++calls}`), signal,
  })
  const preStep = (agent: Agent, messages: UserMessage[], signal = new AbortController().signal) => agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages, turn: 1, step: 1, signal,
  }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages }))
  const bind = (agent: Agent) => {
    const home = mkdtempSync(join(tmpdir(), 'ebao-skill-runtime-'))
    cleanups.push(() => rmSync(home, { recursive: true, force: true }))
    const env = { DSH_HOME: home }
    const content = createContent('article', env)
    bindings.bind(agent.id, content.id, env)
    owner.refresh(agent.id)
    return { content, env }
  }
  return { ctx, owner, bindings, publications, permit, runtime, mint, claim, assembly, names, skillsFor, load, run, preStep, bind }
}

function publisherNames(names: string[]): string[] { return names.filter(name => name.startsWith('publisher_')) }
function textOf(messages: readonly UserMessage[]): string {
  return messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}
function admitted(decision: PreStepDecision): UserMessage[] {
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') throw new Error('unexpected rejected step')
  return decision.messages
}

describe('Publisher native Skills with real DSH scopes and assembly services', () => {
  it('keeps ordinary model assembly free of publishing tools and instructions while publishing a short native catalog', async () => {
    const test = await fixture()
    const agent = await test.mint('ordinary')
    const human = test.claim(agent, '帮我写一篇文章')
    const before = await test.assembly(agent)
    expect(publisherNames(before.tools.map(tool => tool.name))).toEqual([])
    expect(renderPrompt(before)).toBe('')
    const catalog = admitted(await test.preStep(agent, [human])).filter(message => message.source.kind === 'skill-catalog')
    expect(catalog).toHaveLength(1)
    expect(textOf(catalog)).toContain(PUBLISHING_SKILL.name)
    expect(textOf(catalog)).toContain(PUBLISHING_SKILL.description)
    expect(textOf(catalog)).not.toContain(PUBLISHING_SKILL.content)
    expect(textOf(catalog)).not.toContain('source-image://')
    expect(textOf(catalog)).not.toContain('binding_token')
    expect(textOf(catalog).length).toBeLessThan(PUBLISHING_SKILL.content.length)
    expect(test.ctx.tools.get('publisher_enable', agent)).toBeUndefined()
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('returns the full workflow only through the real native Skill result and adds next-step tools to that Agent', async () => {
    const test = await fixture()
    const agent = await test.mint('native')
    const sibling = await test.mint('sibling')
    test.claim(agent)
    const before = await test.assembly(agent)
    const result = await test.load(agent)
    expect(result).toMatchObject({ isError: false, value: {
      name: PUBLISHING_SKILL.name, provider: PUBLISHING_SKILL.provider, content: PUBLISHING_SKILL.content,
    } })
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'text', text: expect.stringContaining(PUBLISHING_SKILL.content),
    })]))
    const next = await test.assembly(agent)
    expect(publisherNames(next.tools.map(tool => tool.name))).toHaveLength(6)
    expect(next.tools.map(tool => tool.name)).toContain('publisher_prepare_preview')
    expect(next.tools.map(tool => tool.name)).toContain('publisher_request_publication')
    expect(renderPrompt(next)).toBe('')
    expect(publisherNames(before.tools.map(tool => tool.name))).toEqual([])
    expect(publisherNames(test.names(sibling))).toEqual([])
  })

  it('shadows Skills and denies inherited execution tools for subagents created before or after a load', async () => {
    const test = await fixture()
    const parent = await test.mint('parent')
    const child = await test.mint('child-before', { parent })
    test.claim(parent)
    await test.load(parent)
    const laterChild = await test.mint('child-after', { parent })
    const grandchild = await test.mint('grandchild', { parent: laterChild })
    for (const delegated of [child, laterChild, grandchild]) {
      expect(publisherNames(test.names(delegated))).toEqual([])
      expect(test.names(delegated)).toContain('ordinary_read')
      for (const name of [PUBLISHING_SKILL.name, EDIT_DRAFT_SKILL.name]) {
        const skill = await test.ctx.skills.get(name, { scope: delegated })
        expect(skill).toBeDefined()
        expect(isModelInvocable(skill!)).toBe(false)
        expect(isUserInvocable(skill!)).toBe(false)
      }
      const human = test.claim(delegated, '/multiplatform-publish 发布这篇文章')
      expect((await test.load(delegated)).isError).toBe(true)
      const messages = admitted(await test.preStep(delegated, [human]))
      expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(false)
      expect(textOf(messages)).not.toContain(PUBLISHING_SKILL.content)
      expect(renderPrompt(await test.assembly(delegated))).toBe('')
      const forbidden = await test.ctx.tools.execute({ agent: delegated, name: 'publisher_get_source', arguments: {},
        callId: ToolCallId(`forbidden-${delegated.id}`), signal: new AbortController().signal })
      expect(forbidden.isError).toBe(true)
    }
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('keeps a forked top-level Agent independent of the source conversation capabilities', async () => {
    const test = await fixture()
    const parent = await test.mint('fork-parent')
    test.claim(parent)
    await test.load(parent)
    const fork = await test.mint('fork', { forkOf: parent })
    expect(fork.session.header.parentSession).toBe(parent.id)
    expect(publisherNames(test.names(fork))).toEqual([])
    expect((await test.load(fork)).isError).toBe(true)
    test.claim(fork)
    expect((await test.load(fork)).isError).toBe(false)
    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    expect(publisherNames(test.names(parent))).toEqual([])
    expect(publisherNames(test.names(fork))).toHaveLength(6)
  })

  it('loads bound editor tools through its separate Skill and removes execution tools at idle', async () => {
    const test = await fixture()
    const parent = await test.mint('editor')
    const child = await test.mint('editor-child', { parent })
    test.bind(parent)
    const human = test.claim(parent, '修改当前草稿标题')
    const summaries = textOf(admitted(await test.preStep(parent, [human])))
    expect(summaries).toContain(EDIT_DRAFT_SKILL.description)
    expect(summaries).not.toContain(EDIT_DRAFT_SKILL.content)
    expect(publisherNames(test.names(parent))).toEqual([])
    expect((await test.load(parent, EDIT_DRAFT_SKILL.name)).isError).toBe(false)
    expect(publisherNames(test.names(parent))).toHaveLength(7)
    expect(test.names(parent)).toContain('publisher_update_current_draft')
    expect(test.names(parent)).not.toContain('publisher_request_publication')
    expect(publisherNames(test.names(child))).toEqual([])
    expect(renderPrompt(await test.assembly(parent))).toBe('')
    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    expect(publisherNames(test.names(parent))).toEqual([])
    expect((await test.ctx.skills.list({ scope: parent })).map(skill => skill.name)).toContain(EDIT_DRAFT_SKILL.name)
    test.bindings.bind(parent.id, null)
    test.owner.refresh(parent.id)
    expect((await test.ctx.skills.list({ scope: parent })).map(skill => skill.name)).not.toContain(EDIT_DRAFT_SKILL.name)
  })

  it('commits a PTC Skill load only after real run_code success and regenerates only that Agent SDK', async () => {
    const test = await fixture('ptc')
    const parent = await test.mint('ptc-parent')
    const sibling = await test.mint('ptc-sibling')
    const child = await test.mint('ptc-child', { parent })
    test.claim(parent)
    const before = await test.assembly(parent)
    expect(before.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(before)).toContain('skill')
    expect(renderPrompt(before)).not.toContain('publisher_prepare_preview')
    test.runtime.run.mockImplementationOnce(async request => {
      const value = await request.bindings[0].functions.skill({ name: PUBLISHING_SKILL.name })
      expect(value).toMatchObject({ content: PUBLISHING_SKILL.content })
      expect(publisherNames(test.names(parent))).toEqual([])
      return { logs: [], value }
    })
    expect((await test.run(parent)).isError).toBe(false)
    const next = await test.assembly(parent)
    expect(next.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(next)).toContain('publisher_prepare_preview')
    expect(renderPrompt(next)).toContain('publisher_request_publication')
    expect(renderPrompt(next)).not.toContain(PUBLISHING_SKILL.content)
    expect(renderPrompt(await test.assembly(sibling))).not.toContain('publisher_prepare_preview')
    expect(renderPrompt(await test.assembly(child))).not.toContain('publisher_prepare_preview')
    expect(renderPrompt(await test.assembly(child))).toContain('ordinary_read')
    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    expect(renderPrompt(await test.assembly(parent))).not.toContain('publisher_prepare_preview')
    expect((await test.ctx.skills.list({ scope: parent })).map(skill => skill.name)).toContain(PUBLISHING_SKILL.name)
  })

  it.each(['program-error', 'post-block', 'cancel', 'new-human'] as const)('does not grant PTC capabilities when the outer execution settles after %s', async outcome => {
    const test = await fixture('ptc')
    const agent = await test.mint(`ptc-${outcome}`)
    const controller = new AbortController()
    test.claim(agent)
    if (outcome === 'post-block') test.ctx.on('tools/post-execute', async (exec, _result, next) => {
      const decision = await next()
      return exec.name === 'run_code' ? { kind: 'block', feedback: [{ type: 'text', text: 'Outer execution rejected.' }] } : decision
    })
    test.runtime.run.mockImplementationOnce(async request => {
      const value = await request.bindings[0].functions.skill({ name: PUBLISHING_SKILL.name })
      expect(publisherNames(test.names(agent))).toEqual([])
      if (outcome === 'program-error') return { logs: [], error: { kind: 'exception', message: 'failed after skill read' } }
      if (outcome === 'cancel') controller.abort()
      if (outcome === 'new-human') test.claim(agent, '不用发布，先讨论文案')
      return { logs: [], value }
    })
    const result = await test.run(agent, controller.signal)
    expect(result.isError).toBe(outcome !== 'new-human')
    expect(publisherNames(test.names(agent))).toEqual([])
    expect(renderPrompt(await test.assembly(agent))).not.toContain('publisher_prepare_preview')
  })

  it.each([PUBLISHING_SKILL, EDIT_DRAFT_SKILL])('does not grant $name after PTC success discards its instruction body', async skill => {
    const test = await fixture('ptc')
    const agent = await test.mint(`ptc-hidden-body-${skill.name}`)
    if (skill === EDIT_DRAFT_SKILL) test.bind(agent)
    test.claim(agent)
    test.runtime.run.mockImplementationOnce(async request => {
      expect(await request.bindings[0].functions.skill({ name: skill.name })).toMatchObject({ content: skill.content })
      return { logs: [], value: 'Done' }
    })
    const result = await test.run(agent)
    expect(result.isError).toBe(false)
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('Done') })]))
    expect(publisherNames(test.names(agent))).toEqual([])
    expect(renderPrompt(await test.assembly(agent))).not.toContain('publisher_prepare_preview')
    expect(renderPrompt(await test.assembly(agent))).not.toContain('publisher_update_current_draft')
  })

  it.each([PUBLISHING_SKILL, EDIT_DRAFT_SKILL])('grants only $name when PTC reads both Skills but delivers only that body', async skill => {
    const test = await fixture('ptc')
    const agent = await test.mint(`ptc-selective-body-${skill.name}`)
    test.bind(agent)
    test.claim(agent)
    test.runtime.run.mockImplementationOnce(async request => {
      const values = await Promise.all([PUBLISHING_SKILL, EDIT_DRAFT_SKILL].map(owned => request.bindings[0].functions.skill({ name: owned.name })))
      expect(publisherNames(test.names(agent))).toEqual([])
      return { logs: [], value: values[skill === PUBLISHING_SKILL ? 0 : 1] }
    })
    expect((await test.run(agent)).isError).toBe(false)
    const names = publisherNames(test.names(agent))
    expect(names).toHaveLength(skill === PUBLISHING_SKILL ? 3 : 7)
    expect(names.includes('publisher_request_publication')).toBe(skill === PUBLISHING_SKILL)
    expect(names.includes('publisher_update_current_draft')).toBe(skill === EDIT_DRAFT_SKILL)
  })

  it('grants both PTC Skills when their instruction bodies are printed into the final output', async () => {
    const test = await fixture('ptc')
    const agent = await test.mint('ptc-printed-bodies')
    test.bind(agent)
    test.claim(agent)
    test.runtime.run.mockImplementationOnce(async request => {
      for (const skill of [PUBLISHING_SKILL, EDIT_DRAFT_SKILL]) await request.bindings[0].functions.skill({ name: skill.name })
      return { logs: [PUBLISHING_SKILL.content, EDIT_DRAFT_SKILL.content], value: 'Done' }
    })
    expect((await test.run(agent)).isError).toBe(false)
    expect(publisherNames(test.names(agent))).toHaveLength(9)
    expect(test.names(agent)).toContain('publisher_request_publication')
    expect(test.names(agent)).toContain('publisher_update_current_draft')
  })

  it.each(['native', 'ptc'] as const)('updates the exact first %s assembly only after native slash instructions are delivered', async mode => {
    const test = await fixture(mode)
    const agent = await test.mint(`slash-${mode}`)
    test.ctx.systemPrompt.section({ name: 'context-check', order: 1,
      text: context => context.agent === agent ? 'Agent context preserved.' : 'Agent context missing.' })
    const human = test.claim(agent, '请使用 /multiplatform-publish 发布这篇文章')
    const first = await test.assembly(agent)
    expect(publisherNames(test.names(agent))).toEqual([])
    expect(renderPrompt(first)).not.toContain('publisher_prepare_preview')
    const invocation = admitted(await test.preStep(agent, [human])).filter(message => message.source.kind === 'skill-invocation')
    expect(invocation).toHaveLength(1)
    expect(textOf(invocation)).toContain(PUBLISHING_SKILL.content)
    if (mode === 'native') {
      expect(first.tools.map(tool => tool.name)).toContain('publisher_prepare_preview')
      expect(first.tools.map(tool => tool.name)).toContain('publisher_request_publication')
    } else {
      expect(first.tools.map(tool => tool.name)).toEqual(['run_code'])
      expect(renderPrompt(first)).toContain('publisher_prepare_preview')
    }
    expect(renderPrompt(first)).toContain('Agent context preserved.')
    expect(renderPrompt(first)).not.toContain('Agent context missing.')
    expect(renderPrompt(first)).not.toContain(PUBLISHING_SKILL.content)
    expect(test.permit).toHaveBeenCalledTimes(1)
    expect(test.runtime.run).not.toHaveBeenCalled()
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('updates the editing slash assembly only after its current binding Skill instructions are delivered', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-edit')
    test.bind(agent)
    const human = test.claim(agent, '/publisher-edit-draft 修改当前标题')
    const first = await test.assembly(agent)
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
    const invocation = admitted(await test.preStep(agent, [human])).filter(message => message.source.kind === 'skill-invocation')
    expect(textOf(invocation)).toContain(EDIT_DRAFT_SKILL.content)
    expect(publisherNames(first.tools.map(tool => tool.name))).toHaveLength(7)
    expect(first.tools.map(tool => tool.name)).not.toContain('publisher_request_publication')
    expect(renderPrompt(first)).toBe('')
  })

  it.each(['native', 'ptc'] as const)('updates first-step capabilities without overriding a %s complete prompt profile', async mode => {
    const test = await fixture(mode)
    const complete = 'Follow this complete custom system prompt.'
    test.ctx.systemPrompt.section({ name: 'test:complete-profile', order: 1, text: complete, complete: true })
    const agent = await test.mint(`complete-${mode}`)
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const first = await test.assembly(agent)
    expect(renderPrompt(first)).toBe(complete)
    expect(publisherNames(test.names(agent))).toEqual([])
    const messages = admitted(await test.preStep(agent, [human]))
    expect(publisherNames(test.names(agent))).toHaveLength(6)
    if (mode === 'native') expect(publisherNames(first.tools.map(tool => tool.name))).toHaveLength(6)
    else expect(first.tools.map(tool => tool.name)).toEqual(['run_code'])
    // Upstream returns a shallow copy for complete profiles and owns its prompt policy.
    expect(renderPrompt(first)).toBe(complete)
    expect(first.sections).toEqual([{ name: 'test:complete-profile', text: complete }])
    expect(textOf(messages.filter(message => message.source.kind === 'skill-invocation'))).toContain(PUBLISHING_SKILL.content)
  })

  it('updates the first PTC SDK when runtime contexts are suppressed by the profile', async () => {
    const test = await fixture('ptc')
    test.ctx.systemPrompt.context({ name: 'test:runtime-fact', order: 1, text: 'This runtime fact is intentionally suppressed.' })
    test.ctx.systemPrompt.suppressRuntimeContext()
    const agent = await test.mint('suppressed-ptc')
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const first = await test.assembly(agent)
    expect(first.contexts).toEqual([])
    expect(renderPrompt(first)).not.toContain('publisher_prepare_preview')
    await test.preStep(agent, [human])
    expect(first.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(first)).toContain('publisher_prepare_preview')
    expect(renderPrompt(first)).toContain('publisher_request_publication')
    expect(renderPrompt(first)).not.toContain(PUBLISHING_SKILL.content)
    expect(first.contexts).toEqual([])
  })

  it('refreshes schemas, sections, contexts and variables with the original Agent context', async () => {
    const test = await fixture()
    const agent = await test.mint('context-preserved')
    test.ctx.systemPrompt.variable('publisher_owner', context => String(context.agent?.id ?? 'missing'))
    test.ctx.systemPrompt.variable('publisher_state', context => context.agent && publisherNames(test.names(context.agent)).length > 0 ? 'ready' : 'unloaded')
    test.ctx.systemPrompt.section({ name: 'test:agent-section', order: 1, text: 'Owner {{publisher_owner}}, tools {{publisher_state}}.' })
    test.ctx.systemPrompt.context({ name: 'test:agent-context', order: 1,
      text: context => `Context for ${String(context.agent?.id ?? 'missing')}: ${context.agent ? publisherNames(test.names(context.agent)).length : -1}.` })
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const first = await test.assembly(agent)
    expect(renderPrompt(first)).toContain('Owner context-preserved, tools unloaded.')
    await test.preStep(agent, [human])
    expect(renderPrompt(first)).toContain('Owner context-preserved, tools ready.')
    expect(first.variables).toMatchObject({ publisher_owner: agent.id, publisher_state: 'ready' })
    expect(first.contexts).toContainEqual({ name: 'test:agent-context', text: 'Context for context-preserved: 6.' })
    expect(publisherNames(first.tools.map(tool => tool.name))).toHaveLength(6)
  })

  it('keeps the original first-step assembly when another Skill listener reassembles during pre-step', async () => {
    const test = await fixture()
    const agent = await test.mint('parallel-skill-assembly')
    const controller = new AbortController()
    let intermediate: Awaited<ReturnType<typeof test.assembly>> | undefined
    test.ctx.on('agent/pre-step', async ({ agent: subject, signal }, next) => {
      const decision = await next()
      intermediate = await test.ctx.systemPrompt.assemble(assembleContextFor(subject, signal))
      return decision
    })
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const first = await test.assembly(agent, controller.signal)
    await test.preStep(agent, [human], controller.signal)
    expect(intermediate).toBeDefined()
    expect(publisherNames(first.tools.map(tool => tool.name))).toHaveLength(6)
    expect(publisherNames(test.names(agent))).toHaveLength(6)
  })

  it('delivers both slash Skills into the same first assembly without duplicate draft helpers', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-both')
    test.bind(agent)
    const human = test.claim(agent, '/multiplatform-publish /publisher-edit-draft 修改后发布文章')
    const first = await test.assembly(agent)
    const messages = admitted(await test.preStep(agent, [human]))
    expect(textOf(messages.filter(message => message.source.kind === 'skill-invocation'))).toContain(PUBLISHING_SKILL.content)
    expect(textOf(messages.filter(message => message.source.kind === 'skill-invocation'))).toContain(EDIT_DRAFT_SKILL.content)
    expect(publisherNames(first.tools.map(tool => tool.name))).toHaveLength(9)
    expect(publisherNames(test.names(agent))).toHaveLength(9)
    expect(first.tools.map(tool => tool.name)).toContain('publisher_update_current_draft')
    expect(first.tools.map(tool => tool.name)).toContain('publisher_request_publication')
  })

  it.each(['none', 'publication', 'edit'] as const)('rolls back a failed slash reassembly while preserving the previous %s grant', async existing => {
    const test = await fixture()
    const agent = await test.mint(`slash-failed-reassembly-${existing}`)
    test.bind(agent)
    const human = test.claim(agent, '/multiplatform-publish /publisher-edit-draft 修改后发布文章')
    if (existing !== 'none') await test.load(agent, existing === 'publication' ? PUBLISHING_SKILL.name : EDIT_DRAFT_SKILL.name)
    const previous = publisherNames(test.names(agent)).sort()
    const first = await test.assembly(agent)
    test.ctx.on('system-prompt/assemble', async () => { throw new Error('reassembly failed') })
    await expect(test.preStep(agent, [human])).rejects.toThrow('reassembly failed')
    expect(publisherNames(test.names(agent)).sort()).toEqual(previous)
    expect(publisherNames(first.tools.map(tool => tool.name)).sort()).toEqual(previous)
    if (existing === 'publication') {
      expect(previous).toHaveLength(3)
      expect(test.names(agent)).toContain('publisher_get_current_draft')
      expect(test.names(agent)).not.toContain('publisher_update_current_draft')
    }
    if (existing === 'edit') {
      expect(previous).toHaveLength(7)
      expect(test.names(agent)).not.toContain('publisher_request_publication')
    }
  })

  it('rolls back tools when the step is canceled during asynchronous slash reassembly', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-canceled-reassembly')
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const controller = new AbortController()
    const first = await test.assembly(agent, controller.signal)
    let resume!: () => void
    let entered!: () => void
    const waiting = new Promise<void>(done => { entered = done })
    test.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      entered()
      await new Promise<void>(done => { resume = done })
      return result
    })
    const pending = test.preStep(agent, [human], controller.signal)
    await waiting
    expect(publisherNames(test.names(agent))).toHaveLength(6)
    controller.abort()
    resume()
    await expect(pending).rejects.toThrow()
    expect(publisherNames(test.names(agent))).toEqual([])
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
  })

  it('keeps an earlier slash in one claimed batch without reusing it in the next step', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-batch')
    const first = test.claim(agent, '/multiplatform-publish')
    const second = test.claim(agent, '请用小红书')
    const assembly = await test.assembly(agent)
    expect(publisherNames(assembly.tools.map(tool => tool.name))).toEqual([])
    const invocation = admitted(await test.preStep(agent, [first, second]))
      .filter(message => message.source.kind === 'skill-invocation')
    expect(textOf(invocation)).toContain(PUBLISHING_SKILL.content)
    expect(assembly.tools.map(tool => tool.name)).toContain('publisher_prepare_preview')
    test.claim(agent, '先不要发布，帮我润色标题')
    expect(publisherNames((await test.assembly(agent)).tools.map(tool => tool.name))).toEqual([])
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it.each(['absent', 'restricted', 'same-name-without-native-loader'] as const)('does not activate slash capabilities when the native Skill loader is %s', async visibility => {
    const test = await fixture('native', visibility === 'restricted')
    const agent = await test.mint(`slash-loader-${visibility}`)
    if (visibility === 'restricted') agent.ctx.tools.restrict({ deny: ['skill'] })
    if (visibility === 'same-name-without-native-loader') test.ctx.tools.register(defineTool({
      name: 'skill', description: 'An unrelated same-name tool without native instruction injection.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'Done',
    }))
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const first = await test.assembly(agent)
    const messages = admitted(await test.preStep(agent, [human]))
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
    expect(publisherNames(test.names(agent))).toEqual([])
    expect(renderPrompt(first)).toBe('')
    if (visibility !== 'restricted') {
      expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(false)
      expect(textOf(messages)).not.toContain(PUBLISHING_SKILL.content)
    }
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it.each(['provider', 'user-disabled', 'synthetic'] as const)('does not activate from a %s slash gesture', async invalid => {
    const test = await fixture()
    const agent = await test.mint(`slash-invalid-${invalid}`)
    if (invalid !== 'synthetic') {
      const definition = { ...PUBLISHING_SKILL,
        ...(invalid === 'provider' ? { provider: 'unrelated-plugin' } : { invocation: { userInvocable: false, modelInvocable: true } }),
      }
      test.skillsFor(agent).registerProvider(() => ({
        name: definition.provider,
        list: async () => [{ ...definition, rank: -1, locator: definition }],
        get: async () => definition,
      }))
    }
    const human = test.claim(agent, '/multiplatform-publish 发布文章', invalid === 'synthetic' ? 'skill-invocation' : 'user')
    const first = await test.assembly(agent)
    await test.preStep(agent, [human])
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
    expect(publisherNames(test.names(agent))).toEqual([])
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('invalidates a pending slash activation if the user request changes during availability checking', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-pending')
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const first = await test.assembly(agent)
    let resolve!: (available: boolean) => void
    let entered!: () => void
    const waiting = new Promise<void>(done => { entered = done })
    test.permit.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; entered() }))
    const pending = test.preStep(agent, [human])
    await waiting
    test.claim(agent, '取消发布，讨论标题')
    resolve(true)
    await pending
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
    expect(publisherNames(test.names(agent))).toEqual([])
  })

  it('does not activate a slash Skill after its requesting step is canceled', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-canceled')
    const human = test.claim(agent, '/multiplatform-publish 发布文章')
    const controller = new AbortController()
    const first = await test.assembly(agent, controller.signal)
    let resolve!: (available: boolean) => void
    let entered!: () => void
    const waiting = new Promise<void>(done => { entered = done })
    test.permit.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; entered() }))
    const pending = test.preStep(agent, [human], controller.signal)
    await waiting
    controller.abort()
    resolve(true)
    await pending
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
    expect(publisherNames(test.names(agent))).toEqual([])
  })

  it('invalidates editing slash permissions if the bound draft changes while availability is pending', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-binding-changed')
    const before = test.bind(agent)
    const human = test.claim(agent, '/publisher-edit-draft 修改当前标题')
    const first = await test.assembly(agent)
    let resolve!: (available: boolean) => void
    let entered!: () => void
    const waiting = new Promise<void>(done => { entered = done })
    test.permit.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; entered() }))
    const pending = test.preStep(agent, [human])
    await waiting
    const after = test.bind(agent)
    expect(after.content.id).not.toBe(before.content.id)
    resolve(true)
    await pending
    expect(publisherNames(first.tools.map(tool => tool.name))).toEqual([])
    expect(publisherNames(test.names(agent))).toEqual([])
  })
})
