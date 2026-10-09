import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import type { AgentPublications } from '../src/agent-publication.ts'
import { PublisherAgentTools } from '../src/agent-tools.ts'
import { createContent } from '../src/contents.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

async function fixture(mode: 'native' | 'ptc' = 'native') {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  if (mode === 'ptc') {
    // Only SDK/prompt generation is exercised: no model program or subprocess is executed.
    ctx.provide('ptcRuntime' as never, { language: 'typescript' } as never)
  }
  await ctx.plugin(ToolRuntime, { mode })
  ctx.provide('attachments', {} as never)
  const agents = new Map<string, Agent>()
  ctx.provide('agents', { list: () => [...agents.values()], get: (id: string) => agents.get(id) } as never)
  ctx.tools.register(defineTool({
    name: 'ordinary_read', description: 'An unrelated read capability.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'ordinary',
  }))
  const bindings = new AgentDraftBindings()
  const publications = { prepare: vi.fn(), getStatus: vi.fn() }
  const owner = new PublisherAgentTools(ctx, bindings, publications as unknown as AgentPublications, async () => true)
  cleanups.push(() => owner.dispose())

  async function mint(id: string, parent?: Agent): Promise<Agent> {
    const session = Session.create(SessionId(id), [], {
      version: 4, id: SessionId(id), createdAt: 0, isSeeded: false,
      ...(parent ? { origin: 'subagent' as const } : {}),
    })
    const agent = { id: session.id, session, status: 'running', options: {} } as unknown as Agent
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent, parent ? { parent } : undefined)
    }, { inject: ['tools', 'systemPrompt', 'attachments'] }))
    Object.assign(agent, { ctx: scope.ctx })
    agents.set(id, agent)
    await agentEvents(ctx, agent).serial('agent/created', { source: 'startup' })
    return agent
  }
  const assembly = (agent: Agent) => ctx.systemPrompt.assemble(assembleContextFor(agent))
  const names = (agent: Agent) => ctx.tools.schemas(agent).map(tool => tool.name)
  async function enable(agent: Agent) {
    const request = '帮我把这篇文章发布到小红书'
    agentEvents(ctx, agent).emit('agent/inbox/claimed', {
      message: createUserMessage({ content: [{ type: 'text', text: request }], source: { kind: 'user' } }), turn: 1,
    })
    if (mode === 'native') {
      return ctx.tools.execute({ agent, name: 'publisher_enable', arguments: { user_request: request },
        callId: ToolCallId('enable-runtime'), signal: new AbortController().signal })
    }
    // The PTC test checks real SDK assembly rather than running a guest program.
    const definition = ctx.tools.get('publisher_enable', agent)!
    return definition.execute({ user_request: request }, {
      agent, callId: ToolCallId('enable-runtime'), signal: new AbortController().signal,
    } as never)
  }
  return { ctx, owner, bindings, publications, mint, assembly, names, enable }
}

function publisherNames(names: string[]): string[] { return names.filter(name => name.startsWith('publisher_')) }

describe('Publisher tools with the real DSH scope and assembly services', () => {
  it('exposes native workflow tools at the next assembly only for the enabled root and clears them on idle', async () => {
    const test = await fixture()
    const parent = await test.mint('parent')
    const other = await test.mint('other')
    const child = await test.mint('child-before-enable', parent)
    const before = await test.assembly(parent)
    expect(publisherNames(before.tools.map(tool => tool.name))).toEqual(['publisher_enable'])
    expect(renderPrompt(before)).not.toContain('source-image://')
    expect(renderPrompt(before)).not.toContain('binding_token')
    expect(publisherNames(test.names(child))).toEqual([])
    expect(test.names(child)).toContain('ordinary_read')
    expect(renderPrompt(await test.assembly(child))).not.toContain('publisher_enable')

    expect(await test.enable(parent)).toMatchObject({ isError: false })
    const next = await test.assembly(parent)
    expect(next.tools.some(tool => tool.name === 'publisher_prepare_preview')).toBe(true)
    expect(next.tools.some(tool => tool.name === 'publisher_request_publication')).toBe(true)
    expect(renderPrompt(next)).toContain('source-image://')
    expect(publisherNames(before.tools.map(tool => tool.name))).toEqual(['publisher_enable'])
    expect(publisherNames(test.names(other))).toEqual(['publisher_enable'])
    expect(renderPrompt(await test.assembly(other))).not.toContain('source-image://')
    expect(publisherNames(test.names(child))).toEqual([])
    expect(renderPrompt(await test.assembly(child))).not.toContain('source-image://')

    const laterChild = await test.mint('child-after-enable', parent)
    expect(publisherNames(test.names(laterChild))).toEqual([])
    expect(renderPrompt(await test.assembly(laterChild))).not.toContain('source-image://')
    const denied = await test.ctx.tools.execute({ agent: child, name: 'publisher_get_source', arguments: {},
      callId: ToolCallId('child-source'), signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(test.publications.prepare).not.toHaveBeenCalled()

    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    const after = await test.assembly(parent)
    expect(publisherNames(after.tools.map(tool => tool.name))).toEqual(['publisher_enable'])
    expect(renderPrompt(after)).not.toContain('source-image://')
    expect(publisherNames(test.names(child))).toEqual([])
  })

  it('keeps bound editor tools out of descendant scopes before and after publication activation', async () => {
    const test = await fixture()
    const parent = await test.mint('bound-parent')
    const child = await test.mint('bound-child', parent)
    const home = mkdtempSync(join(tmpdir(), 'ebao-agent-runtime-'))
    cleanups.push(() => rmSync(home, { recursive: true, force: true }))
    const env = { DSH_HOME: home }
    const content = createContent('article', env)
    test.bindings.bind(parent.id, content.id, env)
    test.owner.refresh(parent.id)
    expect(test.names(parent)).toContain('publisher_update_current_draft')
    expect(renderPrompt(await test.assembly(parent))).toContain('binding_token')
    expect(publisherNames(test.names(child))).toEqual([])
    expect(renderPrompt(await test.assembly(child))).not.toContain('binding_token')
    await test.enable(parent)
    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    expect(test.names(parent)).toContain('publisher_update_current_draft')
    expect(test.names(parent)).not.toContain('publisher_request_publication')
    expect(publisherNames(test.names(child))).toEqual([])
    test.bindings.bind(parent.id, null)
    test.owner.refresh(parent.id)
    expect(publisherNames(test.names(parent))).toEqual(['publisher_enable'])
    expect(renderPrompt(await test.assembly(parent))).not.toContain('binding_token')
  })

  it('regenerates the PTC SDK for the enabled root without leaking workflow methods to siblings or descendants', async () => {
    const test = await fixture('ptc')
    const parent = await test.mint('ptc-parent')
    const other = await test.mint('ptc-other')
    const child = await test.mint('ptc-child', parent)
    const before = await test.assembly(parent)
    expect(before.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(before)).toContain('publisher_enable')
    expect(renderPrompt(before)).not.toContain('publisher_prepare_preview')
    expect(renderPrompt(await test.assembly(child))).not.toContain('publisher_enable')
    await test.enable(parent)
    const next = renderPrompt(await test.assembly(parent))
    expect(next).toContain('publisher_prepare_preview')
    expect(next).toContain('publisher_request_publication')
    expect(renderPrompt(await test.assembly(other))).not.toContain('publisher_prepare_preview')
    expect(renderPrompt(await test.assembly(child))).not.toContain('publisher_prepare_preview')
    expect(renderPrompt(await test.assembly(child))).not.toContain('publisher_request_publication')
    expect(renderPrompt(await test.assembly(child))).toContain('ordinary_read')
    agentEvents(test.ctx, parent).emit('agent/status', { status: 'idle' })
    expect(renderPrompt(await test.assembly(parent))).not.toContain('publisher_prepare_preview')
  })
})
