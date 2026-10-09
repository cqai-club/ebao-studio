import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AgentPublications } from '../src/agent-publication.ts'
import { registerAgentPublicationTools } from '../src/agent-publication-tools.ts'

function setup(available = true) {
  const definitions = new Map<string, ToolDefinition>()
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { definitions.set(tool.name, tool); return () => definitions.delete(tool.name) } },
  } as unknown as Context
  const publications = {
    prepare: vi.fn(async () => ({ requestId: 'request-1', state: 'awaiting-confirmation', mode: 'publish',
      content: { title: '确认后发布' }, errors: [], warnings: [], submission: undefined as object | undefined })),
    getStatus: vi.fn(async () => ({ requestId: 'request-1', state: 'submitted', mode: 'draft', errors: [], warnings: [], content: { title: '平台草稿' },
      submission: { id: 'submission-1', state: 'queued', mode: 'draft' } })),
    confirm: vi.fn(), cancel: vi.fn(),
  }
  const permit = vi.fn(async () => available)
  const dispose = registerAgentPublicationTools(ctx, publications as unknown as AgentPublications, permit)
  const exec = { agent: { id: 'conversation-1', session: { header: { origin: 'main' } } },
    callId: 'call-1', signal: new AbortController().signal } as unknown as ToolRunContext
  return { definitions, publications, permit, dispose, exec }
}

describe('Agent publication tools', () => {
  it('only prepares an interactive card; has no model-callable confirm/submit tool', async () => {
    const test = setup()
    expect([...test.definitions.keys()]).toEqual(['publisher_request_publication', 'publisher_get_publication_status'])
    const result = await test.definitions.get('publisher_request_publication')!.execute({
      source: 'current-draft', content_id: 'draft-1', binding_token: 'binding-1', expected_revision: 3, platforms: ['xhs'], mode: 'publish',
    }, test.exec)
    expect(test.publications.prepare).toHaveBeenCalledWith('conversation-1', 'call-1', {
      contentId: 'draft-1', bindingToken: 'binding-1', expectedRevision: 3, platforms: ['xhs'], mode: 'publish', signal: test.exec.signal,
    })
    expect(result).toMatchObject({ request_id: 'request-1', source: 'current-draft', requires_user_confirmation: true,
      state: 'awaiting-confirmation', next_action: 'confirm_in_card', submission: null })
    expect(result).not.toHaveProperty('binding_token')
    expect(test.publications.confirm).not.toHaveBeenCalled()
    for (const tool of test.definitions.values()) expect(tool.description.length).toBeLessThan(240)
    test.dispose()
    expect(test.definitions.size).toBe(0)
  })

  it('scopes status to the live main conversation and reports queued as queued', async () => {
    const test = setup()
    const result = await test.definitions.get('publisher_get_publication_status')!.execute({ request_id: 'request-1' }, test.exec)
    expect(test.publications.getStatus).toHaveBeenCalledWith('conversation-1', 'request-1')
    expect(result).toMatchObject({ state: 'submitted', mode: 'draft', requires_user_confirmation: false,
      next_action: 'query_status', submission: { state: 'queued', mode: 'draft' } })
    expect((result as { message: string }).message).toContain('排队受理不代表平台发布成功')
    expect(test.publications.confirm).not.toHaveBeenCalled()
  })

  it('accepts an explicit prepared preview without forwarding the tool-only source selector', async () => {
    const test = setup()
    const result = await test.definitions.get('publisher_request_publication')!.execute({
      source: 'prepared-preview', candidate_id: 'candidate-1', mode: 'draft',
    }, test.exec)
    expect(test.publications.prepare).toHaveBeenCalledWith('conversation-1', 'call-1', {
      candidateId: 'candidate-1', mode: 'draft', signal: test.exec.signal,
    })
    expect(result).toMatchObject({ source: 'prepared-preview', next_action: 'confirm_in_card' })
  })

  it('preserves legacy current-context fallback while rejecting incomplete or mixed source fields', async () => {
    const test = setup()
    const tool = test.definitions.get('publisher_request_publication')!
    await tool.execute({}, test.exec)
    expect(test.publications.prepare).toHaveBeenLastCalledWith('conversation-1', 'call-1', { signal: test.exec.signal })
    await tool.execute({ content_id: 'draft-1', binding_token: 'binding-1', expected_revision: 3 }, test.exec)
    await tool.execute({ candidate_id: 'candidate-1' }, test.exec)
    test.publications.prepare.mockClear()
    for (const args of [
      { source: 'current-draft' }, { source: 'prepared-preview' }, { content_id: 'draft-1' },
      { source: 'unknown' },
      { content_id: 'draft-1', binding_token: 'binding-1', expected_revision: 0 },
      { source: 'prepared-preview', candidate_id: '' },
      { source: 'prepared-preview', candidate_id: 'candidate-1', content_id: 'draft-1' },
      { source: 'current-draft', candidate_id: 'candidate-1' },
    ]) await expect(tool.execute(args, test.exec)).rejects.toThrow(/来源|草稿|candidate_id|source/u)
    expect(test.publications.prepare).not.toHaveBeenCalled()
  })

  it('reports a replayed accepted request as queued rather than creating another confirmation', async () => {
    const test = setup()
    test.publications.prepare.mockResolvedValueOnce({ requestId: 'request-1', state: 'submitted', mode: 'draft',
      content: { title: '已确认草稿' }, errors: [], warnings: [], submission: { state: 'queued', mode: 'draft' } })
    const result = await test.definitions.get('publisher_request_publication')!.execute({ candidate_id: 'candidate-1' }, test.exec)
    expect(result).toMatchObject({ request_id: 'request-1', requires_user_confirmation: false, next_action: 'query_status',
      state: 'submitted', mode: 'draft', submission: { state: 'queued' } })
    expect((result as { message: string }).message).not.toContain('尚未提交')
    expect(test.publications.confirm).not.toHaveBeenCalled()
  })

  it('propagates preparation failure instead of returning a confirmation-ready result', async () => {
    const test = setup()
    test.publications.prepare.mockRejectedValueOnce(new Error('发布候选已失效，请重新准备'))
    await expect(test.definitions.get('publisher_request_publication')!.execute({
      source: 'prepared-preview', candidate_id: 'stale-candidate',
    }, test.exec)).rejects.toThrow('发布候选已失效')
    expect(test.publications.confirm).not.toHaveBeenCalled()
  })

  it('keeps uncertain results on manual verification rather than another submission', async () => {
    const test = setup()
    test.publications.getStatus.mockResolvedValueOnce({ requestId: 'request-1', state: 'uncertain', mode: 'draft',
      content: { title: '结果待核对' }, errors: [], warnings: [],
      submission: { id: 'submission-1', state: 'unknown', mode: 'draft' } })
    const result = await test.definitions.get('publisher_get_publication_status')!.execute({ request_id: 'request-1' }, test.exec)
    expect(result).toMatchObject({ state: 'uncertain', requires_user_confirmation: false, next_action: 'check_platform' })
    expect((result as { message: string }).message).toContain('不要自动重发')
    expect(test.publications.prepare).not.toHaveBeenCalled()
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
