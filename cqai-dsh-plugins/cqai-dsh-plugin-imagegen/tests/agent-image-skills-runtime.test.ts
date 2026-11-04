import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import SkillRegistry, { isModelInvocable, isUserInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type ResolvedToolSet, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as PtcExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import type { AgentImageToolConfig } from '../src/agent-image-tools.ts'
import { AGENT_IMAGE_SKILL } from '../src/agent-image-skill.ts'
import { AgentImageSkills } from '../src/agent-image-skills.ts'
import type { ImageGenerationRuntime } from '../src/generation-runtime.ts'

const IMAGE_TOOLS = [
  'cancel_image_generation_task', 'edit_image', 'generate_image',
  'get_image_generation_task', 'list_image_generation_models',
]
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
  const programs = {
    language: 'typescript',
    resolve: (request: ProgramRequest) => request,
    run: vi.fn(async (request: ProgramRequest): Promise<ProgramResult> => ({
      logs: [], value: await request.bindings[0].functions.skill({ name: AGENT_IMAGE_SKILL.name }),
    })),
  }
  if (mode === 'ptc') ctx.provide('ptcRuntime' as never, programs as never)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(mode === 'native' ? NativeExecutor : PtcExecutor)
  await ctx.plugin(SkillRegistry)
  const attachments = { readImage: vi.fn(), saveImages: vi.fn() }
  ctx.provide('attachments', attachments as never)
  ctx.provide('sessions', {} as never)
  ctx.provide('llm', {} as never)
  ctx.provide('sessionProjections', {} as never)
  const agents = new Map<string, Agent>()
  ctx.provide('agents', { list: () => [...agents.values()], get: (id: string) => agents.get(id) } as never)
  ctx.provide('workingDirectory', { ensure: async (agent: Agent) => agent.session.header.cwd ?? process.cwd() } as never)
  if (mountLoader) await ctx.plugin(ToolSkill)
  ctx.tools.register(defineTool({
    name: 'ordinary_read', description: 'An unrelated read capability.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'ordinary',
  }))
  const config: AgentImageToolConfig = {
    enabled: true, allowAgentImageGeneration: true, announceToAgent: true, defaultChannelId: 'custom:test',
    channels: [{ id: 'custom:test', preset: '', name: 'Test channel', apiUrl: 'https://image.example.test/v1',
      apiKey: 'unit-test-secret', models: [{ alias: 'test-image', id: 'upstream-image' }] }],
  }
  const queue = { submit: vi.fn(), list: vi.fn(() => []), get: vi.fn(), cancel: vi.fn(), subscribe: vi.fn(() => () => {}) }
  const runtime = { queue } as unknown as ImageGenerationRuntime
  let owner!: AgentImageSkills
  let imageCtx!: Context
  let mounted!: () => void
  const ready = new Promise<void>(done => { mounted = done })
  ctx.inject(['agents', 'skills', 'tools', 'attachments', 'systemPrompt'], inner => {
    imageCtx = inner
    owner = new AgentImageSkills(inner, runtime, () => config)
    mounted()
  })
  await ready
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
    // Match AgentLoop's dependency API: no skills or attachments injected here.
    }, { inject: ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections'] }))
    Object.assign(agent, { ctx: scope.ctx })
    agents.set(id, agent)
    await agentEvents(ctx, agent).serial('agent/created', { source: 'startup' })
    return agent
  }
  const claim = (agent: Agent, text = '请生成一张橘猫图片', kind: 'user' | 'skill-invocation' = 'user') => {
    const message = createUserMessage({ content: [{ type: 'text', text }],
      source: kind === 'user' ? { kind } : { kind, name: AGENT_IMAGE_SKILL.name, form: 'instructions' } })
    agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn: 1 })
    return message
  }
  const modelSelection = { provider: 'fixture', model: 'fixture-model' }
  const admission = (agent: Agent, signal = new AbortController().signal) => ctx.tools.resolve({ agent, modelSelection, signal })
  const names = async (agent: Agent) => {
    const toolSet = await admission(agent)
    try { return ctx.tools.schemas(agent, toolSet).map(tool => tool.name).filter(name => IMAGE_TOOLS.includes(name)).sort() }
    finally { toolSet.dispose() }
  }
  const assembly = async (agent: Agent, signal = new AbortController().signal) => {
    const toolSet = await admission(agent, signal)
    cleanups.push(() => toolSet.dispose())
    return ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection, toolSet })
  }
  const execute = async (agent: Agent, name: string, args: unknown, signal = new AbortController().signal, toolSet?: ResolvedToolSet): Promise<ToolExecutionResult> => {
    const selected = toolSet ?? await admission(agent, signal)
    const id = ToolCallId(`call-${++calls}`)
    try {
      const result = await ctx.tools.execute({ agent, calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }], toolSet: selected, signal })
      expect(result.results).toHaveLength(1)
      expect(result.results[0]?.callId).toBe(id)
      return result.results[0]!.result
    } finally { if (toolSet === undefined) selected.dispose() }
  }
  const load = (agent: Agent, signal = new AbortController().signal) => execute(agent, 'skill', { name: AGENT_IMAGE_SKILL.name }, signal)
  const run = (agent: Agent, signal = new AbortController().signal) => execute(agent, 'run_code', {
    code: 'return await tools.skill({name:"ebao-imagegen"})', description: 'Load image workflow instructions.',
  }, signal)
  const preStep = (agent: Agent, messages: UserMessage[], signal = new AbortController().signal) => agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages, turn: 1, step: 1, signal, modelSelection,
  }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages }))
  const skillView = (agent: Agent) => createScope(imageCtx, agent).ctx.skills
  const overrideSkill = (agent: Agent, definition: SkillDefinition, get = async () => definition) => {
    skillView(agent).registerProvider(() => ({
      name: definition.provider,
      list: async () => [{ ...definition, rank: -1, locator: definition }],
      get,
    }))
  }
  return { ctx, owner, agents, config, queue, attachments, programs, mint, claim, names, assembly, admission, execute, load, run, preStep, overrideSkill }
}

function textOf(messages: readonly UserMessage[]): string {
  return messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}
function admitted(decision: PreStepDecision): UserMessage[] {
  expect(decision.kind).toBe('enter')
  if (decision.kind !== 'enter') throw new Error('unexpected rejected step')
  return decision.messages
}

describe('e图宝 native Skill lifecycle with real DSH services', () => {
  it('keeps ordinary conversation free of image tools and full instructions while publishing the native Skill summary', async () => {
    const test = await fixture()
    const agent = await test.mint('ordinary')
    const human = test.claim(agent, '讨论图片设计方案，不生成图片')
    const before = await test.assembly(agent)
    expect(await test.names(agent)).toEqual([])
    expect(renderPrompt(before)).toBe('')
    const catalog = admitted(await test.preStep(agent, [human])).filter(message => message.source.kind === 'skill-catalog')
    expect(catalog).toHaveLength(1)
    expect(textOf(catalog)).toContain(AGENT_IMAGE_SKILL.name)
    expect(textOf(catalog)).toContain(AGENT_IMAGE_SKILL.description)
    expect(textOf(catalog)).not.toContain(AGENT_IMAGE_SKILL.content)
    expect(test.queue.submit).not.toHaveBeenCalled()
  })

  it('unlocks five scoped tools only after native Skill success and returns instructions through that result', async () => {
    const test = await fixture()
    const agent = await test.mint('native')
    const sibling = await test.mint('native-sibling')
    expect((await test.load(agent)).isError).toBe(true)
    test.claim(agent, '这张图的背景改成蓝色')
    const result = await test.load(agent)
    expect(result).toMatchObject({ isError: false, value: {
      name: AGENT_IMAGE_SKILL.name, provider: AGENT_IMAGE_SKILL.provider, content: AGENT_IMAGE_SKILL.content,
    } })
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining(AGENT_IMAGE_SKILL.content) })]))
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
    expect(await test.names(sibling)).toEqual([])
    expect(renderPrompt(await test.assembly(agent))).toBe('')
    const models = await test.execute(agent, 'list_image_generation_models', {})
    expect(models).toMatchObject({ isError: false, value: { default_provider: 'custom:test', providers: [
      { id: 'custom:test', models: [{ alias: 'test-image', id: 'upstream-image' }], selection: 'single' },
    ] } })
    expect(JSON.stringify(models)).not.toContain('unit-test-secret')
    expect(test.queue.submit).not.toHaveBeenCalled()
  })

  it('does not treat synthetic instructions or removed Agent identity as a current human request', async () => {
    const test = await fixture()
    const agent = await test.mint('real-human-required')
    test.claim(agent, '/ebao-imagegen 生图', 'skill-invocation')
    expect((await test.load(agent)).isError).toBe(true)
    expect(await test.names(agent)).toEqual([])
    test.claim(agent)
    test.agents.delete(agent.id)
    expect((await test.load(agent)).isError).toBe(true)
    expect(await test.names(agent)).toEqual([])
  })

  it('does not activate an unrelated provider publishing the same Skill name', async () => {
    const test = await fixture()
    const agent = await test.mint('forged-provider')
    test.overrideSkill(agent, { ...AGENT_IMAGE_SKILL, provider: 'unrelated-image-plugin' })
    test.claim(agent)
    expect((await test.load(agent)).isError).toBe(false)
    expect(await test.names(agent)).toEqual([])
  })

  it('does not activate when a shadow loader returns official identity without delivering the Skill body', async () => {
    const test = await fixture()
    const agent = await test.mint('hidden-body')
    test.claim(agent)
    agent.ctx.tools.register(defineTool({
      name: 'skill', description: 'Loader that hides instructions.', parameters: { name: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: () => [{ type: 'text', text: 'Loaded.' }] },
      execute: async () => ({ name: AGENT_IMAGE_SKILL.name, provider: AGENT_IMAGE_SKILL.provider, content: AGENT_IMAGE_SKILL.content }),
    }))
    expect((await test.load(agent)).isError).toBe(false)
    expect(await test.names(agent)).toEqual([])
  })

  it('does not activate when the native Skill loader fails', async () => {
    const test = await fixture()
    const agent = await test.mint('failed-native-loader')
    test.claim(agent)
    agent.ctx.tools.register(defineTool({
      name: 'skill', description: 'Unavailable instruction loader.', parameters: { name: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { throw new Error('Skill body is unavailable') },
    }))
    expect((await test.load(agent)).isError).toBe(true)
    expect(await test.names(agent)).toEqual([])
  })

  it('expires execution tools at idle or new human input while retaining the Skill catalog', async () => {
    const test = await fixture()
    const agent = await test.mint('turn-cleanup')
    test.claim(agent)
    await test.load(agent)
    test.claim(agent, 'Skill正文', 'skill-invocation')
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
    agentEvents(test.ctx, agent).emit('agent/status', { status: 'idle' })
    expect(await test.names(agent)).toEqual([])
    expect((await test.ctx.skills.list({ scope: agent })).map(skill => skill.name)).toContain(AGENT_IMAGE_SKILL.name)
    expect((await test.load(agent)).isError).toBe(true)
    test.claim(agent)
    await test.load(agent)
    test.claim(agent, '先讨论文字')
    expect(await test.names(agent)).toEqual([])
  })

  it.each(['enabled', 'allowAgentImageGeneration', 'announceToAgent'] as const)('revokes loaded image tools when %s is disabled', async field => {
    const test = await fixture()
    const agent = await test.mint(`settings-${field}`)
    test.claim(agent)
    await test.load(agent)
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
    test.config[field] = false
    test.owner.sync()
    expect(await test.names(agent)).toEqual([])
    expect((await test.load(agent)).isError).toBe(true)
    test.config[field] = true
    test.owner.sync()
    expect(await test.names(agent)).toEqual([])
    test.claim(agent)
    expect((await test.load(agent)).isError).toBe(false)
  })

  it.each(['human', 'settings', 'dispose'] as const)('invalidates a pending native Skill body when %s changes', async invalidation => {
    const test = await fixture()
    const agent = await test.mint(`pending-${invalidation}`)
    test.claim(agent)
    let entered!: () => void
    let resolve!: (definition: SkillDefinition) => void
    const waiting = new Promise<void>(done => { entered = done })
    test.overrideSkill(agent, AGENT_IMAGE_SKILL, () => new Promise<SkillDefinition>(done => { resolve = done; entered() }))
    const pending = test.load(agent)
    await waiting
    if (invalidation === 'human') test.claim(agent, '取消图片任务')
    else if (invalidation === 'settings') { test.config.enabled = false; test.owner.sync() }
    else test.owner.dispose()
    resolve(AGENT_IMAGE_SKILL)
    await pending
    expect(await test.names(agent)).toEqual([])
  })

  it('does not install image tools for a canceled native Skill read', async () => {
    const test = await fixture()
    const agent = await test.mint('canceled-native')
    test.claim(agent)
    const controller = new AbortController()
    controller.abort()
    await expect(test.load(agent, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await test.names(agent)).toEqual([])
  })

  it('isolates ordinary subagents and forked conversations before and after primary activation', async () => {
    const test = await fixture()
    const parent = await test.mint('parent')
    const child = await test.mint('child-before', { parent })
    test.claim(parent)
    await test.load(parent)
    const laterChild = await test.mint('child-after', { parent })
    const fork = await test.mint('fork', { forkOf: parent })
    expect(await test.names(fork)).toEqual([])
    for (const delegated of [child, laterChild]) {
      expect(await test.names(delegated)).toEqual([])
      expect(test.ctx.tools.get('ordinary_read', delegated)).toBeDefined()
      const skill = await test.ctx.skills.get(AGENT_IMAGE_SKILL.name, { scope: delegated })
      expect(skill).toBeDefined()
      expect(isModelInvocable(skill!)).toBe(false)
      expect(isUserInvocable(skill!)).toBe(false)
      test.claim(delegated)
      expect((await test.load(delegated)).isError).toBe(true)
      const denied = await test.execute(delegated, 'generate_image', { prompt: 'cat' })
      expect(denied.isError).toBe(true)
    }
    expect(test.queue.submit).not.toHaveBeenCalled()
  })

  it('allows an explicitly authorized canvas subagent to use its own tools and revokes them on close', async () => {
    const test = await fixture()
    const parent = await test.mint('canvas-parent')
    test.claim(parent)
    await test.load(parent)
    const canvas = await test.mint('canvas', { parent })
    const ordinary = await test.mint('ordinary-child', { parent })
    expect(await test.names(canvas)).toEqual([])
    const close = test.owner.authorizeCanvas(canvas)
    expect(await test.names(canvas)).toEqual(IMAGE_TOOLS)
    expect(await test.names(ordinary)).toEqual([])
    const models = await test.execute(canvas, 'list_image_generation_models', {})
    expect(models.isError).toBe(false)
    close()
    expect(await test.names(canvas)).toEqual([])
    expect(await test.names(parent)).toEqual(IMAGE_TOOLS)
    expect(test.queue.submit).not.toHaveBeenCalled()
  })

  it('retains canvas authorization across idle and announcement changes but still honors generation settings', async () => {
    const test = await fixture()
    const parent = await test.mint('trusted-parent')
    const canvas = await test.mint('trusted-canvas', { parent })
    const close = test.owner.authorizeCanvas(canvas)
    agentEvents(test.ctx, canvas).emit('agent/status', { status: 'idle' })
    test.config.announceToAgent = false
    test.owner.sync()
    expect(await test.names(canvas)).toEqual(IMAGE_TOOLS)
    test.config.allowAgentImageGeneration = false
    test.owner.sync()
    expect(await test.names(canvas)).toEqual([])
    test.config.allowAgentImageGeneration = true
    test.owner.sync()
    expect(await test.names(canvas)).toEqual(IMAGE_TOOLS)
    const newClose = test.owner.authorizeCanvas(canvas)
    close()
    expect(await test.names(canvas)).toEqual(IMAGE_TOOLS)
    newClose()
    expect(await test.names(canvas)).toEqual([])
  })

  it('removes summaries and all active scoped tools when the plugin is disposed', async () => {
    const test = await fixture()
    const parent = await test.mint('dispose-parent')
    test.claim(parent)
    await test.load(parent)
    const canvas = await test.mint('dispose-canvas', { parent })
    const close = test.owner.authorizeCanvas(canvas)
    test.owner.dispose()
    close()
    expect(await test.names(parent)).toEqual([])
    expect(await test.names(canvas)).toEqual([])
    expect((await test.ctx.skills.list({ scope: parent })).map(skill => skill.name)).not.toContain(AGENT_IMAGE_SKILL.name)
    test.owner.sync()
    expect(await test.names(parent)).toEqual([])
  })

  it('releases a canvas grant when its Agent fails to publish into the live registry', async () => {
    const test = await fixture()
    const parent = await test.mint('unpublished-parent')
    const canvas = await test.mint('unpublished-canvas', { parent })
    const close = test.owner.authorizeCanvas(canvas)
    expect(await test.names(canvas)).toEqual(IMAGE_TOOLS)
    // The factory may run setup and then fail before publishing this identity.
    test.agents.delete(canvas.id)
    close()
    expect(await test.names(canvas)).toEqual([])
    test.owner.sync()
    expect(await test.names(canvas)).toEqual([])
    expect((await test.load(canvas)).isError).toBe(true)
  })

  it('waits for real PTC outer success before activating and updates only the calling Agent SDK', async () => {
    const test = await fixture('ptc')
    const parent = await test.mint('ptc-parent')
    const sibling = await test.mint('ptc-sibling')
    const child = await test.mint('ptc-child', { parent })
    test.claim(parent)
    const before = await test.assembly(parent)
    expect(before.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(before)).not.toContain('generate_image')
    test.programs.run.mockImplementationOnce(async request => {
      const value = await request.bindings[0].functions.skill({ name: AGENT_IMAGE_SKILL.name })
      expect(value).toMatchObject({ content: AGENT_IMAGE_SKILL.content })
      expect(await test.names(parent)).toEqual([])
      return { logs: [], value }
    })
    expect((await test.run(parent)).isError).toBe(false)
    const next = await test.assembly(parent)
    expect(next.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(next)).toContain('generate_image')
    expect(renderPrompt(next)).toContain('list_image_generation_models')
    expect(renderPrompt(next)).not.toContain(AGENT_IMAGE_SKILL.content)
    expect(renderPrompt(await test.assembly(sibling))).not.toContain('generate_image')
    expect(renderPrompt(await test.assembly(child))).not.toContain('generate_image')
    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    expect(renderPrompt(await test.assembly(parent))).not.toContain('generate_image')
  })

  it.each(['program-error', 'post-block', 'cancel', 'new-human'] as const)('does not activate a PTC inner Skill read after outer %s', async outcome => {
    const test = await fixture('ptc')
    const agent = await test.mint(`ptc-${outcome}`)
    test.claim(agent)
    const controller = new AbortController()
    if (outcome === 'post-block') test.ctx.on('tools/post-execute', async (exec, _result, next) => {
      const decision = await next()
      return exec.name === 'run_code' ? { kind: 'block', feedback: [{ type: 'text', text: 'Outer execution rejected.' }] } : decision
    })
    test.programs.run.mockImplementationOnce(async request => {
      const value = await request.bindings[0].functions.skill({ name: AGENT_IMAGE_SKILL.name })
      expect(await test.names(agent)).toEqual([])
      if (outcome === 'program-error') return { logs: [], error: { kind: 'exception', message: 'failed after skill read' } }
      if (outcome === 'cancel') controller.abort()
      if (outcome === 'new-human') test.claim(agent, '不生成图片了')
      return { logs: [], value }
    })
    const result = await test.run(agent, controller.signal)
    expect(result.isError).toBe(outcome !== 'new-human')
    expect(await test.names(agent)).toEqual([])
  })

  it('does not activate after PTC success that discards the loaded instruction body', async () => {
    const test = await fixture('ptc')
    const agent = await test.mint('ptc-hidden-body')
    test.claim(agent)
    test.programs.run.mockImplementationOnce(async request => {
      const skill = await request.bindings[0].functions.skill({ name: AGENT_IMAGE_SKILL.name })
      expect(skill).toMatchObject({ content: AGENT_IMAGE_SKILL.content })
      return { logs: [], value: 'Done' }
    })
    const result = await test.run(agent)
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).not.toContain(AGENT_IMAGE_SKILL.content)
    expect(await test.names(agent)).toEqual([])
    expect(renderPrompt(await test.assembly(agent))).not.toContain('generate_image')
  })

  it.each(['native', 'ptc'] as const)('admits the first %s slash step but blocks execution until native instructions arrive', async mode => {
    const test = await fixture(mode)
    const agent = await test.mint(`slash-${mode}`)
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    const toolSet = await test.admission(agent)
    cleanups.push(() => toolSet.dispose())
    const first = await test.assembly(agent)
    if (mode === 'native') expect(first.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(IMAGE_TOOLS))
    else {
      expect(first.tools.map(tool => tool.name)).toEqual(['run_code'])
      expect(renderPrompt(first)).toContain('generate_image')
      test.programs.run.mockImplementation(async request => ({ logs: [], value: await request.bindings[0].functions.list_image_generation_models({}) }))
    }
    const dispatch = () => test.execute(agent, mode === 'native' ? 'list_image_generation_models' : 'run_code',
      mode === 'native' ? {} : { code: 'return await tools.list_image_generation_models({})', description: 'Read image model choices.' }, new AbortController().signal, toolSet)
    expect((await dispatch()).isError).toBe(true)
    expect(test.queue.submit).not.toHaveBeenCalled()
    const invocation = admitted(await test.preStep(agent, [human])).filter(message => message.source.kind === 'skill-invocation')
    expect(invocation).toHaveLength(1)
    expect(textOf(invocation)).toContain(AGENT_IMAGE_SKILL.content)
    // The original admitted definitions stay live; no prompt or admission object is patched.
    expect((await dispatch()).isError).toBe(false)
    expect(renderPrompt(first)).not.toContain(AGENT_IMAGE_SKILL.content)
    expect(test.queue.submit).not.toHaveBeenCalled()
  })

  it.each(['native', 'ptc'] as const)('keeps a %s complete prompt profile while admitting verified slash capabilities', async mode => {
    const test = await fixture(mode)
    const complete = 'Follow this complete custom system prompt.'
    test.ctx.systemPrompt.section({ name: 'test:complete-profile', order: 1, text: complete, complete: true })
    const agent = await test.mint(`complete-${mode}`)
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    // Upstream enforces complete sections by returning a shallow assembly copy.
    const first = await test.assembly(agent)
    expect(renderPrompt(first)).toBe(complete)
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
    const messages = admitted(await test.preStep(agent, [human]))
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
    if (mode === 'native') expect(first.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(IMAGE_TOOLS))
    else expect(first.tools.map(tool => tool.name)).toEqual(['run_code'])
    // A complete PTC profile owns its instructions; SDK text must not be forced into it.
    expect(renderPrompt(first)).toBe(complete)
    expect(renderPrompt(first)).not.toContain('generate_image')
    expect(first.sections).toEqual([{ name: 'test:complete-profile', text: complete }])
    expect(textOf(messages.filter(message => message.source.kind === 'skill-invocation'))).toContain(AGENT_IMAGE_SKILL.content)
  })

  it('admits the first PTC SDK while respecting suppressed runtime contexts', async () => {
    const test = await fixture('ptc')
    test.ctx.systemPrompt.context({ name: 'test:runtime-fact', order: 1, text: 'This runtime fact is intentionally suppressed.' })
    test.ctx.systemPrompt.suppressRuntimeContext()
    const agent = await test.mint('suppressed-ptc')
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    const first = await test.assembly(agent)
    expect(first.contexts).toEqual([])
    expect(renderPrompt(first)).toContain('generate_image')
    await test.preStep(agent, [human])
    expect(first.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(first)).toContain('generate_image')
    expect(renderPrompt(first)).toContain('list_image_generation_models')
    expect(renderPrompt(first)).not.toContain(AGENT_IMAGE_SKILL.content)
    expect(first.contexts).toEqual([])
  })

  it('preserves the admitted Agent context and leaves provider snapshots under upstream ownership', async () => {
    const test = await fixture()
    const agent = await test.mint('context-preserved')
    test.ctx.systemPrompt.variable('image_owner', context => String(context.agent?.id ?? 'missing'))
    test.ctx.systemPrompt.variable('image_state', context => context.agent && test.ctx.tools.schemas(context.agent).filter(tool => IMAGE_TOOLS.includes(tool.name)).length > 0 ? 'ready' : 'unloaded')
    test.ctx.systemPrompt.section({ name: 'test:agent-section', order: 1, text: 'Owner {{image_owner}}, image tools {{image_state}}.' })
    test.ctx.systemPrompt.context({ name: 'test:agent-context', order: 1,
      text: context => `Context for ${String(context.agent?.id ?? 'missing')}: ${context.agent ? test.ctx.tools.schemas(context.agent).filter(tool => IMAGE_TOOLS.includes(tool.name)).length : -1}.` })
    test.ctx.systemPrompt.tools(context => ({ schemas: [{
      name: 'profile_read', description: `Read for ${String(context.agent?.id ?? 'missing')}.`,
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    }] }))
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    const first = await test.assembly(agent)
    expect(renderPrompt(first)).toContain('Owner context-preserved, image tools ready.')
    await test.preStep(agent, [human])
    expect(renderPrompt(first)).toContain('Owner context-preserved, image tools ready.')
    expect(first.variables).toMatchObject({ image_owner: agent.id, image_state: 'ready' })
    expect(first.contexts).toContainEqual({ name: 'test:agent-context', text: 'Context for context-preserved: 5.' })
    expect(first.tools.find(tool => tool.name === 'profile_read')?.description).toBe('Read for context-preserved.')
    expect(first.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(IMAGE_TOOLS))
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
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    const first = await test.assembly(agent, controller.signal)
    await test.preStep(agent, [human], controller.signal)
    expect(intermediate).toBeDefined()
    expect(first.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(IMAGE_TOOLS))
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
  })

  it.each(['absent', 'forged-provider'] as const)('does not activate slash tools when native instruction delivery is %s', async invalid => {
    const test = await fixture('native', invalid !== 'absent')
    const agent = await test.mint(`slash-invalid-${invalid}`)
    if (invalid === 'forged-provider') test.overrideSkill(agent, { ...AGENT_IMAGE_SKILL, provider: 'unrelated-image-plugin' })
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    expect(await test.names(agent)).toEqual([])
    const first = await test.assembly(agent)
    await test.preStep(agent, [human])
    expect(renderPrompt(first)).toBe('')
    expect(await test.names(agent)).toEqual([])
  })

  it('does not grant slash execution tools when the native skill loader is restricted', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-model-restricted')
    agent.ctx.tools.restrict({ deny: ['skill'] })
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    const first = await test.assembly(agent)
    expect(await test.names(agent)).toEqual([])
    const messages = admitted(await test.preStep(agent, [human]))
    // Native slash may supply context, but restrictions still withhold execution capabilities.
    expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(true)
    expect(await test.names(agent)).toEqual([])
    expect(first.tools.map(tool => tool.name).filter(name => IMAGE_TOOLS.includes(name))).toEqual([])
  })

  it('does not trust a same-name skill tool when no native pre-step loader delivered instructions', async () => {
    const test = await fixture('native', false)
    const agent = await test.mint('slash-fake-loader')
    agent.ctx.tools.register(defineTool({
      name: 'skill', description: 'Unrelated tool sharing the native loader name.',
      parameters: { name: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'Done',
    }))
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    const first = await test.assembly(agent)
    const messages = admitted(await test.preStep(agent, [human]))
    expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(false)
    expect(await test.names(agent)).toEqual([])
    expect(first.tools.map(tool => tool.name).filter(name => IMAGE_TOOLS.includes(name))).toEqual([])
  })

  it('does not activate a Skill that disables user invocation from a slash gesture', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-user-disabled')
    test.overrideSkill(agent, { ...AGENT_IMAGE_SKILL, invocation: { modelInvocable: true, userInvocable: false } })
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    expect(renderPrompt(await test.assembly(agent))).toBe('')
    expect(await test.names(agent)).toEqual([])
    expect(admitted(await test.preStep(agent, [human])).some(message => message.source.kind === 'skill-invocation')).toBe(false)
  })

  it('does not install slash tools if cancellation arrives while the native Skill body is loading', async () => {
    const test = await fixture()
    const agent = await test.mint('slash-canceled')
    const human = test.claim(agent, '/ebao-imagegen 生成橘猫图片')
    let entered!: () => void
    let resolve!: (definition: SkillDefinition) => void
    const waiting = new Promise<void>(done => { entered = done })
    const controller = new AbortController()
    const first = await test.assembly(agent, controller.signal)
    expect(await test.names(agent)).toEqual(IMAGE_TOOLS)
    test.overrideSkill(agent, AGENT_IMAGE_SKILL, () => new Promise<SkillDefinition>(done => { resolve = done; entered() }))
    const pending = test.preStep(agent, [human], controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    await waiting
    controller.abort()
    resolve(AGENT_IMAGE_SKILL)
    await rejected
    expect(await test.names(agent)).toEqual([])
    expect(first.tools.map(tool => tool.name).filter(name => IMAGE_TOOLS.includes(name))).toEqual(IMAGE_TOOLS)
  })
})
