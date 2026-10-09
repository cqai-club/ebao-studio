import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { PUBLISHING_SKILL } from '../src/agent-skills.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../src/index.ts'
import { createContent, saveContent } from '../src/contents.ts'
import type { PublisherAccount, PublisherPlatformCapability, PublisherSubmission } from '../src/protocol.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

async function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ebao-agent-publication-routes-')))
  homes.push(home)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  const sessionId = 'publication-session'
  const otherSessionId = 'other-publication-session'
  const archivedSessionIds: string[] = []
  const dispatched: Record<string, unknown>[] = []
  const submissions: PublisherSubmission[] = []
  const account: PublisherAccount = {
    id: '11111111-1111-4111-8111-111111111111', displayName: '模拟百家号账号',
    platform: 'bjh', loginState: 'logged-in',
  }
  const accounts = [account]
  const capabilities: PublisherPlatformCapability[] = [{
    platform: 'bjh', contentTypes: ['article'], modes: { article: ['draft', 'publish'] },
    requiredFields: { article: [] }, maxTitleLength: { article: 120 }, maxAssets: { article: 20 },
  }]
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
  const runtime = {
    status: () => ({ supported: true, running: true }),
    request: async (method: string, params?: unknown) => {
      if (method === 'accounts.list') return accounts
      if (method === 'accounts.checkLogin') return account
      if (method === 'system.capabilities') return capabilities
      if (method === 'submissions.list') return submissions
      if (method !== 'submissions.create') throw new Error(`Unexpected simulated Worker method: ${method}`)
      const input = params as Record<string, unknown>
      dispatched.push(input)
      const submission: PublisherSubmission = {
        id: '22222222-2222-4222-8222-222222222222', createdAt: new Date().toISOString(),
        contentId: String(input.contentId), contentType: 'article', title: '对话内发布测试',
        mode: input.mode as 'draft' | 'publish', state: 'queued',
        targets: [{ accountId: account.id, platform: account.platform, accountName: account.displayName }],
      }
      submissions.push(submission)
      return { accepted: true, submission }
    },
  }
  const dispose = async () => {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  try {
    ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => { handler = undefined }
    } } as never)
    ctx.provide('desktopRuntime', { publisher: runtime } as never)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(SkillRegistry)
    ctx.provide('attachments', {} as never)
    ctx.provide('sessionController', { list: async () => ({
      items: [{ sessionId }, { sessionId: otherSessionId }],
    }) } as never)
    ctx.provide('workspaceRegistry', { archivedSessionIds } as never)
    await ctx.plugin(SessionStore)
    const agent = {
      id: SessionId(sessionId), status: 'running',
      session: ctx.sessions.create(SessionId(sessionId)),
    } as unknown as Agent
    ctx.provide('agents', {
      get: (id: SessionId) => id === agent.id ? agent : undefined,
      list: () => [agent],
    } as never)
    await ctx.plugin(Object.assign((scopeCtx: Context) => {
      Object.assign(agent, { ctx: createScope(scopeCtx, agent).ctx })
    }, { inject: ['tools', 'systemPrompt', 'attachments', 'skills'] }))
    await ctx.plugin(ToolSkill)
    await ctx.plugin(plugin)
    expect(ctx.tools.schemas(agent).some(tool => tool.name.startsWith('publisher_'))).toBe(false)

    const request = async (
      method: 'GET' | 'POST', action: string, body: unknown = {},
      headers: Record<string, string> = {}, remoteAddress = '127.0.0.1',
    ) => {
      const req = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []) as IncomingMessage
      Object.assign(req, {
        method, url: `/api/cqai-publisher/${action}`,
        headers: { host: '127.0.0.1:43120', ...headers }, socket: { remoteAddress },
      })
      let status = 0
      let payload = ''
      const res = { headersSent: false, destroyed: false,
        writeHead: (code: number) => { status = code }, end: (value: string) => { payload = value },
      } as unknown as ServerResponse
      if (!handler) throw new Error('Publisher route was not registered')
      await handler(req, res)
      return { status, body: JSON.parse(payload) as Record<string, unknown> }
    }
    const created = createContent('article', { DSH_HOME: home }, '对话内发布测试')
    const content = saveContent(created.id, {
      revision: created.revision, title: created.title, body: '正文内容', summary: '',
      tags: [], creativeStatement: 'none',
    }, { DSH_HOME: home })
    const bound = await request('POST', 'agent-draft-bind', { sessionId, contentId: content.id }, { 'x-ejianbao': '1' })
    expect(bound.status).toBe(200)
    const prepare = async (callId = 'request-publication-call') => {
      const userRequest = '请把当前文章存入百家号平台草稿箱'
      const message = createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: userRequest }],
      })
      ctx.emit('agent/inbox/claimed', { agent, message, turn: 1 })
      const loaded = await ctx.tools.execute({ agent, name: 'skill', arguments: { name: PUBLISHING_SKILL.name },
        callId: ToolCallId('load-publish-skill'), signal: new AbortController().signal })
      expect(loaded.isError).toBe(false)
      const result = await ctx.tools.execute({ agent, name: 'publisher_request_publication', arguments: {
        source: 'current-draft', content_id: content.id, binding_token: bound.body.bindingToken,
        expected_revision: content.revision, platforms: ['bjh'], account_ids: [account.id], mode: 'draft',
      }, callId: ToolCallId(callId), signal: new AbortController().signal })
      if (result.isError) throw new Error(JSON.stringify(result.content))
      return result.value as unknown as {
        request_id: string; state: string; requires_user_confirmation: boolean
      }
    }
    const confirmBody = (requestId: string, selectedSession = sessionId) => ({
      sessionId: selectedSession, requestId, accountIds: [account.id], mode: 'draft',
    })
    return { request, prepare, confirmBody, sessionId, otherSessionId, account, accounts, content,
      archivedSessionIds, dispatched, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}

describe('Agent publication confirmation routes', () => {
  it('registers the Agent proposal tool and submits once only after a protected user confirmation', async () => {
    const test = await fixture()
    try {
      const proposed = await test.prepare()
      expect(proposed).toMatchObject({ state: 'awaiting-confirmation', requires_user_confirmation: true })
      expect(test.dispatched).toEqual([])
      const action = `agent-publication/${test.sessionId}/${proposed.request_id}`
      expect(await test.request('GET', action)).toMatchObject({ status: 200,
        body: { requestId: proposed.request_id, state: 'awaiting-confirmation' } })
      const confirmation = test.confirmBody(proposed.request_id)
      expect((await test.request('POST', 'agent-publication-confirm', confirmation)).status).toBe(403)
      expect((await test.request('POST', 'agent-publication-confirm', confirmation,
        { 'x-ejianbao': '1', origin: 'https://evil.example' })).status).toBe(403)
      expect((await test.request('POST', 'agent-publication-confirm', confirmation,
        { 'x-ejianbao': '1', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
      expect((await test.request('POST', 'agent-publication-confirm', confirmation,
        { 'x-ejianbao': '1' }, '192.0.2.1')).status).toBe(403)
      expect(test.dispatched).toEqual([])

      const [first, second] = await Promise.all([
        test.request('POST', 'agent-publication-confirm', confirmation, { 'x-ejianbao': '1' }),
        test.request('POST', 'agent-publication-confirm', confirmation, { 'x-ejianbao': '1' }),
      ])
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(test.dispatched).toHaveLength(1)
      expect(test.dispatched[0]).toMatchObject({ contentId: test.content.id,
        revision: test.content.revision, accountIds: [test.account.id], mode: 'draft' })
      expect(first.body).toMatchObject({ state: 'submitted', submission: { state: 'queued', mode: 'draft' } })
      expect(await test.request('GET', action)).toMatchObject({ status: 200,
        body: { state: 'submitted', submission: { state: 'queued' } } })
      expect((await test.request('POST', 'agent-publication-confirm', confirmation, { 'x-ejianbao': '1' })).status).toBe(200)
      expect(test.dispatched).toHaveLength(1)
    } finally { await test.dispose() }
  })

  it('rejects cross-session, archived-session and unsupported confirmation fields before Worker dispatch', async () => {
    const test = await fixture()
    try {
      const proposed = await test.prepare()
      expect((await test.request('GET', `agent-publication/${test.otherSessionId}/${proposed.request_id}`)).status).toBe(400)
      expect((await test.request('POST', 'agent-publication-confirm',
        test.confirmBody(proposed.request_id, test.otherSessionId), { 'x-ejianbao': '1' })).status).toBe(400)
      expect((await test.request('POST', 'agent-publication-confirm', {
        ...test.confirmBody(proposed.request_id), confirmed: true,
      }, { 'x-ejianbao': '1' })).status).toBe(400)
      test.archivedSessionIds.push(test.sessionId)
      expect((await test.request('POST', 'agent-publication-confirm', test.confirmBody(proposed.request_id),
        { 'x-ejianbao': '1' })).status).toBe(400)
      expect((await test.request('GET', `agent-publication/${test.sessionId}/${proposed.request_id}`)).status).toBe(400)
      expect(test.dispatched).toEqual([])
    } finally { await test.dispose() }
  })

  it('submits the chosen account while other available accounts remain unselected', async () => {
    const test = await fixture()
    try {
      test.accounts.push({ id: '33333333-3333-4333-8333-333333333333',
        displayName: '未选择的小红书账号', platform: 'xhs', loginState: 'logged-in' })
      const proposed = await test.prepare()
      const confirmed = await test.request('POST', 'agent-publication-confirm', test.confirmBody(proposed.request_id),
        { 'x-ejianbao': '1' })
      expect(confirmed).toMatchObject({ status: 200, body: { state: 'submitted' } })
      expect(test.dispatched).toHaveLength(1)
      expect(test.dispatched[0]?.accountIds).toEqual([test.account.id])
    } finally { await test.dispose() }
  })

  it('cancels a pending card without dispatch and refuses to submit it later', async () => {
    const test = await fixture()
    try {
      const proposed = await test.prepare()
      const body = { sessionId: test.sessionId, requestId: proposed.request_id }
      expect((await test.request('POST', 'agent-publication-cancel', body)).status).toBe(403)
      expect((await test.request('POST', 'agent-publication-cancel', {
        sessionId: test.otherSessionId, requestId: proposed.request_id,
      }, { 'x-ejianbao': '1' })).status).toBe(400)
      expect(await test.request('POST', 'agent-publication-cancel', body, { 'x-ejianbao': '1' }))
        .toMatchObject({ status: 200, body: { state: 'cancelled' } })
      const later = await test.request('POST', 'agent-publication-confirm', test.confirmBody(proposed.request_id),
        { 'x-ejianbao': '1' })
      expect(later.body).toMatchObject({ state: 'cancelled' })
      expect(await test.request('GET', `agent-publication/${test.sessionId}/${proposed.request_id}`))
        .toMatchObject({ status: 200, body: { state: 'cancelled' } })
      expect(test.dispatched).toEqual([])
    } finally { await test.dispose() }
  })
})
