import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AgentPublications } from '../src/agent-publication.ts'
import { registerAgentPublicationTools, AGENT_PUBLICATION_GUIDANCE } from '../src/agent-publication-tools.ts'

function setup(available = true) {
  const definitions = new Map<string, ToolDefinition>()
  const sections: string[] = []
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } },
    systemPrompt: { section: ({ text }: { text: string }) => { sections.push(text); return () => {} } },
  } as unknown as Context
  const publications = {
    prepare: vi.fn(async () => ({ requestId: 'request-1', state: 'awaiting-confirmation', content: { title: '确认后发布' } })),
    getStatus: vi.fn(async () => ({ requestId: 'request-1', state: 'submitted', mode: 'draft', errors: [], warnings: [],
      submission: { id: 'submission-1', state: 'queued', mode: 'draft' } })),
    confirm: vi.fn(), cancel: vi.fn(),
  }
  const permit = vi.fn(async () => available)
  const dispose = registerAgentPublicationTools(ctx, publications as unknown as AgentPublications, permit)
  const exec = { agent: { id: 'conversation-1', session: { header: { origin: 'main' } } },
    callId: 'call-1', signal: new AbortController().signal } as unknown as ToolRunContext
  return { definitions, sections, publications, permit, dispose, exec }
}

describe('Agent publication tools', () => {
  it('only prepares an interactive card; has no model-callable confirm/submit tool', async () => {
    const test = setup()
    expect([...test.definitions.keys()]).toEqual(['publisher_request_publication', 'publisher_get_publication_status'])
    const result = await test.definitions.get('publisher_request_publication')!.execute({
      content_id: 'draft-1', binding_token: 'binding-1', expected_revision: 3, platforms: ['xhs'], mode: 'publish',
    }, test.exec)
    expect(test.publications.prepare).toHaveBeenCalledWith('conversation-1', 'call-1', {
      contentId: 'draft-1', bindingToken: 'binding-1', expectedRevision: 3, platforms: ['xhs'], mode: 'publish',
    })
    expect(result).toMatchObject({ request_id: 'request-1', requires_user_confirmation: true, state: 'awaiting-confirmation' })
    expect(result).not.toHaveProperty('binding_token')
    expect(test.publications.confirm).not.toHaveBeenCalled()
    expect(test.sections).toEqual([AGENT_PUBLICATION_GUIDANCE])
    test.dispose()
    expect(test.definitions.size).toBe(0)
  })

  it('scopes status to the live main conversation and reports queued as queued', async () => {
    const test = setup()
    const result = await test.definitions.get('publisher_get_publication_status')!.execute({ request_id: 'request-1' }, test.exec)
    expect(test.publications.getStatus).toHaveBeenCalledWith('conversation-1', 'request-1')
    expect(result).toMatchObject({ state: 'submitted', mode: 'draft', submission: { state: 'queued', mode: 'draft' } })
    expect(test.publications.confirm).not.toHaveBeenCalled()
  })

  it('rejects unavailable or delegated conversations before preparing any request', async () => {
    const test = setup(false)
    await expect(test.definitions.get('publisher_request_publication')!.execute({}, test.exec)).rejects.toThrow('不可用于发布确认')
    expect(test.publications.prepare).not.toHaveBeenCalled()
    const child = { ...test.exec, agent: { id: 'child-1', session: { header: { origin: 'subagent' } } } } as unknown as ToolRunContext
    await expect(test.definitions.get('publisher_request_publication')!.execute({}, child)).rejects.toThrow('主 Agent 对话')
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('does not prepare or query after cancellation', async () => {
    const test = setup()
    const abort = new AbortController()
    abort.abort()
    const exec = { ...test.exec, signal: abort.signal }
    await expect(test.definitions.get('publisher_request_publication')!.execute({}, exec)).rejects.toThrow()
    await expect(test.definitions.get('publisher_get_publication_status')!.execute({ request_id: 'request-1' }, exec)).rejects.toThrow()
    expect(test.publications.prepare).not.toHaveBeenCalled()
    expect(test.publications.getStatus).not.toHaveBeenCalled()
  })
})
