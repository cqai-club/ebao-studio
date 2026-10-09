import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import type { AgentPublications } from '../src/agent-publication.ts'
import { PublisherAgentTools } from '../src/agent-tools.ts'
import { createContent } from '../src/contents.ts'

type Message = { id: string; role: 'user'; source: { kind: string }; content: { type: 'text'; text: string }[] }
type Listener = (payload: unknown) => unknown
function message(text: string, kind = 'user', id = 'message-1'): Message {
  return { id, role: 'user', source: { kind }, content: [{ type: 'text', text }] }
}
function surface() {
  const tools = new Map<string, ToolDefinition>()
  const sections = new Map<string, string>()
  return {
    tools, sections,
    services: {
      tools: {
        register: (tool: ToolDefinition) => {
          tools.set(tool.name, tool)
          return () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) }
        },
        schemas: () => [...tools.values()],
        restrict: () => () => {},
      },
      attachments: { readImage: vi.fn() },
      systemPrompt: { section: ({ name, text }: { name: string; text: string }) => {
        sections.set(name, text)
        return () => { if (sections.get(name) === text) sections.delete(name) }
      } },
    },
  }
}
function agent(id: string, messages: Message[] = [], origin?: string) {
  const scope = surface()
  const ctx = scope.services as unknown as Context
  return { id, ctx, scope, messages, status: 'running', session: {
    header: { origin }, deriveMessages: () => messages,
  } }
}
type FakeAgent = ReturnType<typeof agent>
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function setup(initialAgents: FakeAgent[] = [], available = true) {
  const global = surface()
  const agents = new Map(initialAgents.map(item => [item.id, item]))
  const listeners = new Map<string, Set<Listener>>()
  const ctx = {
    ...global.services,
    agents: { get: (id: string) => agents.get(id), list: () => [...agents.values()] },
    on: (name: string, listener: Listener) => {
      const set = listeners.get(name) ?? new Set<Listener>()
      listeners.set(name, set)
      set.add(listener)
      return () => { set.delete(listener) }
    },
  } as unknown as Context
  const bindings = new AgentDraftBindings()
  const publications = { prepare: vi.fn(), getStatus: vi.fn() }
  const permit = vi.fn(async () => available)
  const owner = new PublisherAgentTools(ctx, bindings, publications as unknown as AgentPublications, permit)
  cleanups.push(() => owner.dispose())
  const exec = (item: FakeAgent, signal = new AbortController().signal) => ({
    agent: item, callId: 'enable-1', signal,
  }) as unknown as ToolRunContext
  const enable = (item: FakeAgent, quote: string, signal?: AbortSignal) =>
    global.tools.get('publisher_enable')!.execute({ user_request: quote }, exec(item, signal))
  const emit = async (name: string, payload: unknown) => {
    await Promise.all([...(listeners.get(name) ?? [])].map(listener => listener(payload)))
  }
  const claim = (item: FakeAgent, input = item.messages.findLast(value => value.source.kind === 'user') ?? item.messages.at(-1)) =>
    emit('agent/inbox/claimed', { agent: item, message: input, turn: 1 })
  const draft = () => {
    const home = mkdtempSync(join(tmpdir(), 'ebao-agent-tools-'))
    cleanups.push(() => rmSync(home, { recursive: true, force: true }))
    const env = { DSH_HOME: home }
    return { env, content: createContent('article', env) }
  }
  return { global, agents, bindings, owner, permit, publications, enable, emit, claim, draft }
}

describe('Publisher Agent capability scopes', () => {
  it('keeps conversations on a short activation hint until the activation tool is called', async () => {
    const a = agent('conversation-a', [message('帮我写一篇文章')])
    const test = setup([a])
    expect([...test.global.tools.keys()]).toEqual(['publisher_enable'])
    const prompt = [...test.global.sections.values()].join('\n')
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt.length).toBeLessThan(400)
    expect(prompt).not.toContain('source-image://')
    expect(prompt).not.toContain('binding_token')
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
    await test.claim(a)
    await test.claim(a, message('帮我发布到小红书'))
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
  })

  it('loads publishing guidance only into the requesting conversation', async () => {
    const request = '帮我把这篇文章发布到小红书'
    const a = agent('conversation-a', [message(request)])
    const b = agent('conversation-b', [message('预览这篇文章')])
    const test = setup([a, b])
    await test.claim(a)
    await test.enable(a, request)
    expect([...a.scope.tools.keys()].sort()).toEqual([
      'publisher_export_image', 'publisher_get_publication_status', 'publisher_get_source',
      'publisher_prepare_preview', 'publisher_register_source', 'publisher_request_publication',
    ])
    expect(a.scope.sections.size).toBeGreaterThan(0)
    expect(b.scope.tools.size).toBe(0)
    expect(b.scope.sections.size).toBe(0)
    expect([...test.global.tools.keys()]).toEqual(['publisher_enable'])
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('rejects invented, stale, and non-human activation quotations', async () => {
    const old = message('发布到小红书', 'user', 'old')
    const a = agent('conversation-a', [old, message('先帮我修改标题', 'user', 'new'),
      message('存到微信公众号草稿箱', 'runtime-context', 'injected')])
    const test = setup([a])
    await test.claim(a)
    for (const quote of ['帮我发布到抖音', old.content[0].text, '存到微信公众号草稿箱']) {
      await expect(test.enable(a, quote)).rejects.toThrow()
    }
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
    const onlyInjected = agent('conversation-b', [message('发布到小红书', 'skill-invocation')])
    test.agents.set(onlyInjected.id, onlyInjected)
    await test.claim(onlyInjected)
    await expect(test.enable(onlyInjected, '发布到小红书')).rejects.toThrow()
    expect(onlyInjected.scope.tools.size).toBe(0)
  })

  it('allows the latest human request despite later synthetic context', async () => {
    const request = '请存到微信公众号草稿箱'
    const a = agent('conversation-a', [message(request), message('技能内容', 'skill-invocation')])
    const test = setup([a])
    await test.claim(a)
    await test.enable(a, request)
    expect(a.scope.tools.has('publisher_request_publication')).toBe(true)
  })

  it('refuses delegated, unavailable, or canceled activations without loading tools', async () => {
    const request = '发布到小红书'
    const child = agent('child', [message(request)], 'subagent')
    const childTest = setup([child])
    await childTest.claim(child)
    await expect(childTest.enable(child, request)).rejects.toThrow()
    expect(child.scope.tools.size).toBe(0)
    const a = agent('conversation-a', [message(request)])
    const unavailable = setup([a], false)
    await unavailable.claim(a)
    await expect(unavailable.enable(a, request)).rejects.toThrow()
    expect(a.scope.tools.size).toBe(0)
    const available = setup([a])
    await available.claim(a)
    const abort = new AbortController()
    abort.abort()
    await expect(available.enable(a, request, abort.signal)).rejects.toThrow()
    expect(a.scope.tools.size).toBe(0)
  })

  it('unloads the workflow when the agent becomes idle or a new human request arrives', async () => {
    const request = '发布到小红书'
    const a = agent('conversation-a', [message(request)])
    const test = setup([a])
    await test.claim(a)
    await test.enable(a, request)
    await test.emit('agent/inbox/claimed', { agent: a, message: message('补充上下文', 'runtime-context'), turn: 1 })
    expect(a.scope.tools.has('publisher_prepare_preview')).toBe(true)
    await test.emit('agent/status', { agent: a, status: 'idle' })
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
    await expect(test.enable(a, request)).rejects.toThrow()
    await test.claim(a)
    await test.enable(a, request)
    await test.emit('agent/inbox/claimed', { agent: a, message: message('先不要发布'), turn: 2 })
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
  })

  it('cannot revive a historical request or an activation invalidated while availability is pending', async () => {
    const request = '发布到小红书'
    const a = agent('conversation-a', [message(request)])
    const test = setup([a])
    await expect(test.enable(a, request)).rejects.toThrow()
    for (const invalidate of [
      () => test.claim(a, message('先不要发布', 'user', 'cancel-request')),
      () => test.emit('agent/status', { agent: a, status: 'idle' }),
    ]) {
      await test.claim(a)
      let resolve!: (available: boolean) => void
      test.permit.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
      const pending = test.enable(a, request)
      const rejected = expect(pending).rejects.toThrow()
      await invalidate()
      resolve(true)
      await rejected
      expect(a.scope.tools.size).toBe(0)
      expect(a.scope.sections.size).toBe(0)
    }
  })

  it('adds editor tools for a cold bound agent when it is created and removes them on unbind', async () => {
    const test = setup()
    const { content, env } = test.draft()
    test.bindings.bind('cold-agent', content.id, env)
    test.owner.refresh('cold-agent')
    expect([...test.global.tools.keys()]).toEqual(['publisher_enable'])
    const a = agent('cold-agent')
    test.agents.set(a.id, a)
    await test.emit('agent/created', { agent: a })
    expect(a.scope.tools.size).toBe(7)
    expect(a.scope.tools.has('publisher_update_current_draft')).toBe(true)
    expect(a.scope.tools.has('publisher_request_publication')).toBe(false)
    test.bindings.bind(a.id, null)
    test.owner.refresh(a.id)
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
  })

  it('preserves a newer editor binding when a delayed old close is refreshed', () => {
    const a = agent('conversation-a')
    const test = setup([a])
    const { content, env } = test.draft()
    const first = test.bindings.bind(a.id, content.id, env)!
    test.owner.refresh(a.id)
    const second = test.bindings.bind(a.id, content.id, env)!
    test.owner.refresh(a.id)
    expect(test.bindings.unbind(a.id, first.bindingToken)).toBe(false)
    test.owner.refresh(a.id)
    expect(test.bindings.current(a.id)).toEqual(second)
    expect(a.scope.tools.has('publisher_update_current_draft')).toBe(true)
    expect(a.scope.tools.size).toBe(7)
  })

  it('keeps local editor tools when turn cleanup unloads the publishing workflow', async () => {
    const request = '发布到小红书'
    const a = agent('conversation-a', [message(request)])
    const test = setup([a])
    const { content, env } = test.draft()
    test.bindings.bind(a.id, content.id, env)
    test.owner.refresh(a.id)
    await test.claim(a)
    await test.enable(a, request)
    await test.emit('agent/status', { agent: a, status: 'idle' })
    expect(a.scope.tools.size).toBe(7)
    expect(a.scope.tools.has('publisher_update_current_draft')).toBe(true)
    expect(a.scope.tools.has('publisher_request_publication')).toBe(false)
    expect(a.scope.sections.size).toBe(1)
  })

  it('disposes all scoped capabilities and cannot reinstall them after later events', async () => {
    const request = '发布到小红书'
    const a = agent('conversation-a', [message(request)])
    const test = setup([a])
    const { content, env } = test.draft()
    test.bindings.bind(a.id, content.id, env)
    test.owner.refresh(a.id)
    await test.claim(a)
    await test.enable(a, request)
    expect(a.scope.tools.size).toBeGreaterThan(7)
    test.owner.dispose()
    expect(test.global.tools.size).toBe(0)
    expect(test.global.sections.size).toBe(0)
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
    test.owner.refresh(a.id)
    await test.emit('agent/created', { agent: a })
    await test.emit('agent/inbox/claimed', { agent: a, message: message(request), turn: 3 })
    expect(a.scope.tools.size).toBe(0)
    expect(a.scope.sections.size).toBe(0)
  })
})
