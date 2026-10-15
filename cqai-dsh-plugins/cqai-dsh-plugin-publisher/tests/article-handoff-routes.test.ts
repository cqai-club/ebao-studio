import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as publisher from '../src/index.ts'
import { listContents, readContent } from '../src/contents.ts'
import { readPublisherSessionOwnership } from '../src/agent-draft-session.ts'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close() })
async function fixture(withAgent = false) {
  const home = mkdtempSync(join(tmpdir(), 'ebao-handoff-route-')), cwd = join(home, 'ordinary')
  mkdirSync(cwd)
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context(), sourceId = randomUUID()
  const agents = new Map<string, Agent>(), sends: { sessionId: string; message: import('@deepseek-ai/dsh-session').UserMessage }[] = []
  disposers.push(async () => { await ctx.fiber.dispose(); if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before; rmSync(home, { recursive: true, force: true }) })
  const source = Session.create(SessionId(sourceId), [], { version: 4, id: SessionId(sourceId), cwd, createdAt: Date.now(), isSeeded: false })
  const message = createAssistantMessage({ content: [{ type: 'text', text: '# 转交文章\n\n已写好的原文，无需再次生成。' }], source: { provider: 'fixture', model: 'fixture' } })
  source.append('turn/start', { turn: 1 })
  source.append('step/start', { turn: 1, step: 1 })
  source.append('assistant/message', { turn: 1, step: 1, stream: [], message }, { surfaceOp: 'append' })
  source.append('step/end', { turn: 1, step: 1 })
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const stored = new Map<string, Session>([[sourceId, source]])
  const summaries = new Map<string, { sessionId: string; cwd: string }>([[sourceId, { sessionId: sourceId, cwd }]])
  const workspaces = new Map<string, { id: string; path: string }>()
  const archivedSessionIds: string[] = [], workerCalls: string[] = []
  ctx.provide('sessions', { get: (id: string) => stored.get(id) } as never)
  ctx.provide('sessionController', {
    list: async () => ({ items: [...summaries.values()] }),
    create: async ({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) => {
      const workspace = [...workspaces.values()].find(item => item.id === workspaceId)!
      summaries.set(sessionId, { sessionId, cwd: workspace.path })
      if (withAgent && !agents.has(sessionId)) {
        const session = Session.create(SessionId(sessionId), [], { version: 4, id: SessionId(sessionId), cwd: workspace.path, createdAt: Date.now(), isSeeded: false })
        stored.set(sessionId, session)
        const inbox = { nextTurn: [] as import('@deepseek-ai/dsh-session').UserMessage[], nextStep: [] as import('@deepseek-ai/dsh-session').UserMessage[] }
        const agent = { id: session.id, session, inbox, status: 'idle', options: {},
          send: (message: import('@deepseek-ai/dsh-session').UserMessage) => { sends.push({ sessionId, message }); inbox.nextTurn.push(message); Object.assign(agent, { status: 'running' }) },
        } as unknown as Agent
        Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
        agents.set(sessionId, agent)
        await agentEvents(ctx, agent).serial('agent/created', { source: 'startup' })
      }
      return { sessionId }
    },
    rename: async () => {},
  } as never)
  ctx.provide('workspaceRegistry', {
    archivedSessionIds,
    list: () => [...workspaces.values()].map(workspace => ({ ...workspace, sessionIds: [...summaries.values()].filter(session => session.cwd === workspace.path).map(session => session.sessionId) })),
    create: async (path: string) => { if (!workspaces.has(path)) workspaces.set(path, { id: randomUUID(), path }); return workspaces.get(path) },
    archiveSession: async (id: string) => { archivedSessionIds.push(id) }, unarchiveSession: async () => {},
  } as never)
  ctx.provide('desktopRuntime', { publisher: { request: async (method: string) => { workerCalls.push(method); return [] } } } as never)
  if (withAgent) {
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(SkillRegistry)
    ctx.provide('attachments', {} as never)
    ctx.provide('agents', { get: (id: string) => agents.get(id), list: () => [...agents.values()] } as never)
    const agent = { id: source.id, session: source, status: 'running', options: {}, inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
    Object.assign(agent, { ctx: createScope(ctx, agent).ctx }); agents.set(source.id, agent)
    await ctx.plugin(ToolSkill)
  }
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(publisher)
  const base = `http://127.0.0.1:${ctx.webServer.port}/api/cqai-publisher/`
  const request = async (path: string, body?: unknown, mutationHeader = true) => {
    const response = await fetch(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', ...(mutationHeader ? { 'x-ejianbao': '1' } : {}) }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  return { ctx, agents, sends, sourceId, messageId: message.id, source, stored, summaries, workspaces, archivedSessionIds, workerCalls, request }
}

describe('ordinary conversation article handoff Host routes', () => {
  it('copies the exact reply only after opening and reuses a separate hidden editing session', async () => {
    const host = await fixture()
    const prepared = await host.request('article-handoff-prepare', { sessionId: host.sourceId, messageId: host.messageId })
    expect(prepared.status).toBe(200)
    expect(listContents()).toHaveLength(0)
    expect(JSON.stringify(prepared.body)).not.toContain('ordinary\\')
    const open = () => host.request('article-handoff-open', { sessionId: host.sourceId, handoffId: prepared.body.handoffId })
    const [first, duplicate] = await Promise.all([open(), open()])
    expect(first.status).toBe(200)
    expect(duplicate.body.content.id).toBe(first.body.content.id)
    expect(listContents()).toHaveLength(1)
    expect(first.body.content).toMatchObject({ contentType: 'article', workflowVersion: 2, body: '# 转交文章\n\n已写好的原文，无需再次生成。' })
    const linked = await host.request('agent-draft-session', { contentId: first.body.content.id })
    expect(linked.status).toBe(200)
    expect(linked.body.sessionId).not.toBe(host.sourceId)
    expect((await host.request('agent-draft-session', { contentId: first.body.content.id })).body.sessionId).toBe(linked.body.sessionId)
    expect(readPublisherSessionOwnership(host.sourceId)).toBeNull()
    expect(host.source.header.cwd).toContain('ordinary')
    const visibility = await host.request('internal-workspace-visibility')
    expect(visibility.body.sessionIds).toContain(linked.body.sessionId)
    expect(visibility.body.sessionIds).not.toContain(host.sourceId)
    expect(host.workerCalls).toEqual([])
  })
  it('retains publication content after the source disappears and never archives the ordinary source when recycling', async () => {
    const host = await fixture()
    const prepared = await host.request('article-handoff-prepare', { sessionId: host.sourceId, messageId: host.messageId })
    const opened = await host.request('article-handoff-open', { sessionId: host.sourceId, handoffId: prepared.body.handoffId })
    const contentId = opened.body.content.id
    const origin = await host.request(`article-origin/${contentId}`)
    expect(origin.body).toMatchObject({ contentId, sourceSessionAvailable: true, source: { sessionId: host.sourceId } })
    host.archivedSessionIds.push(host.sourceId)
    expect((await host.request(`article-origin/${contentId}`)).body.sourceSessionAvailable).toBe(false)
    host.archivedSessionIds.splice(host.archivedSessionIds.indexOf(host.sourceId), 1)
    host.stored.delete(host.sourceId); host.summaries.delete(host.sourceId)
    expect((await host.request(`article-origin/${contentId}`)).body.sourceSessionAvailable).toBe(false)
    expect((await host.request('article-handoff-open', { sessionId: host.sourceId, handoffId: prepared.body.handoffId })).body.content.id).toBe(contentId)
    expect(readContent(contentId).body).toContain('无需再次生成')
    const own = await host.request('agent-draft-session', { contentId })
    expect((await host.request('content-delete', { id: contentId })).status).toBe(200)
    expect(host.archivedSessionIds).toContain(own.body.sessionId)
    expect(host.archivedSessionIds).not.toContain(host.sourceId)
  })
  it('requires the normal mutation header and rejects foreign replies and extra content before creating a draft', async () => {
    const host = await fixture()
    expect((await host.request('article-handoff-prepare', { sessionId: host.sourceId, messageId: host.messageId }, false)).status).toBe(403)
    expect((await host.request('article-handoff-prepare', { sessionId: host.sourceId, messageId: randomUUID() })).status).toBe(400)
    expect((await host.request('article-handoff-prepare', { sessionId: host.sourceId, messageId: host.messageId, body: '伪造原文' })).status).toBe(400)
    expect(listContents()).toHaveLength(0)
    expect(host.workerCalls).toEqual([])
  })
  it('routes a new image-note task through global Skill, binds its dedicated Agent and starts once', async () => {
    const host = await fixture(true), agent = host.agents.get(host.sourceId)!
    const human = createUserMessage({ content: [{ type: 'text', text: '帮我写一篇小红书分享，介绍重庆生活，不编造经历' }], source: { kind: 'user' } })
    host.source.append('turn/start', { turn: 2 })
    host.source.append('user/message', human, { surfaceOp: 'append' })
    agentEvents(host.ctx, agent).emit('agent/inbox/claimed', { message: human, turn: 2 })
    const signal = new AbortController().signal
    const loaded = await host.ctx.tools.execute({ agent, name: 'skill', arguments: { name: 'publisher-route' }, callId: ToolCallId('route-entrance'), signal })
    expect(loaded.isError).toBe(false)
    const transferred = await host.ctx.tools.execute({ agent, name: 'handoff_to_publisher', arguments: {
      creation_brief: '重庆生活的小红书图文分享，遵循用户提供的真实材料', content_type: 'image-note', platforms: ['xhs'], title: '重庆生活分享',
    }, callId: ToolCallId('delegate-task'), signal })
    expect(transferred.isError).toBe(false)
    expect(transferred.concludesTurn).toBe(true)
    const result = transferred.value as { handoffId: string; contentId: string; task_id: string; delegation: { publisherSessionId: string } }
    expect(readContent(result.contentId)).toMatchObject({ contentType: 'image-note', body: '', workflowVersion: 2 })
    expect(host.sends).toHaveLength(0)
    const sessionId = result.delegation.publisherSessionId
    const bound = await host.request('agent-draft-bind', { sessionId, contentId: result.contentId, target: { kind: 'main' } })
    expect(bound.status).toBe(200)
    const start = () => host.request('publisher-delegation-start', { taskId: result.task_id, sessionId, bindingToken: bound.body.bindingToken })
    expect((await start()).status).toBe(400)
    expect(host.sends).toHaveLength(0)
    host.source.append('turn/end', { turn: 2, reason: { kind: 'completed' } }); Object.assign(agent, { status: 'idle' })
    agentEvents(host.ctx, agent).emit('agent/status', { status: 'idle' })
    const [first, duplicate] = await Promise.all([start(), start()])
    expect(first.status).toBe(200); expect(duplicate.status).toBe(200)
    expect(first.body.status).toBe('running'); expect(host.sends).toHaveLength(1)
    expect(host.sends[0].message.source).toMatchObject({ kind: 'publisher-delegation', sourceSessionId: host.sourceId, requestId: human.id })
    const summary = await host.request(`publisher-delegation-for-content/${result.contentId}`)
    expect(summary.body).toMatchObject({ status: 'running', taskId: result.task_id })
    const saved = await host.request(`article-handoff/${host.sourceId}/${result.handoffId}`)
    expect(saved.body.delegation).toMatchObject({ status: 'running', taskId: result.task_id })
    const publisherAgent = host.agents.get(sessionId)!, delegated = host.sends[0].message
    publisherAgent.session.append('turn/start', { turn: 1 })
    publisherAgent.session.append('user/message', delegated, { surfaceOp: 'append' })
    agentEvents(host.ctx, publisherAgent).emit('agent/inbox/claimed', { message: delegated, turn: 1 })
    const close = () => host.request('agent-draft-bind', { sessionId, contentId: null, bindingToken: bound.body.bindingToken })
    expect((await close()).status).toBe(200)
    const editSkill = await host.ctx.tools.execute({ agent: publisherAgent, name: 'skill',
      arguments: { name: 'publisher-edit-draft' }, callId: ToolCallId('background-edit-skill'), signal })
    expect(editSkill.isError).toBe(false)
    const draft = await host.ctx.tools.execute({ agent: publisherAgent, name: 'publisher_get_current_draft',
      arguments: {}, callId: ToolCallId('background-draft-read'), signal })
    expect(draft.isError).toBe(false)
    const reopened = await host.request('agent-draft-bind', { sessionId, contentId: result.contentId })
    expect(reopened.status).toBe(200)
    expect(reopened.body.bindingToken).toBe(bound.body.bindingToken)
    expect((await host.request('agent-draft-bind', { sessionId, contentId: result.contentId,
      target: { kind: 'platform', platform: 'xhs' } })).status).toBe(400)
    expect((await close()).status).toBe(200)
    publisherAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    Object.assign(publisherAgent, { status: 'idle' })
    agentEvents(host.ctx, publisherAgent).emit('agent/status', { status: 'idle' })
    const afterFinish = await host.ctx.tools.execute({ agent: publisherAgent, name: 'publisher_get_current_draft',
      arguments: {}, callId: ToolCallId('closed-draft-after-finish'), signal })
    expect(afterFinish.isError).toBe(true)
    expect(host.workerCalls).toEqual([])
    expect(readPublisherSessionOwnership(host.sourceId)).toBeNull()
  })
  it('requires a bound matching task and preserves manual draft edits before task intake', async () => {
    const host = await fixture(true), agent = host.agents.get(host.sourceId)!
    Object.assign(agent, { status: 'idle' })
    const prepared = await host.request('article-handoff-prepare', { sessionId: host.sourceId, messageId: host.messageId })
    const opened = await host.request('article-handoff-open', { sessionId: host.sourceId, handoffId: prepared.body.handoffId })
    expect(opened.status).toBe(200)
    const task = opened.body.handoff.delegation
    expect(task.status).toBe('queued')
    const body = { taskId: task.taskId, sessionId: task.publisherSessionId, bindingToken: randomUUID() }
    expect((await host.request('publisher-delegation-start', body, false)).status).toBe(403)
    expect((await host.request('publisher-delegation-start', body)).status).toBe(400)
    const bound = await host.request('agent-draft-bind', { sessionId: task.publisherSessionId, contentId: opened.body.content.id })
    const changed = await host.request('content-patch', { id: opened.body.content.id, revision: opened.body.content.revision, patch: { title: '手工修改', body: '保留手工正文' } })
    expect(changed.status).toBe(200)
    const started = await host.request('publisher-delegation-start', { ...body, bindingToken: bound.body.bindingToken })
    expect(started.body.status).toBe('interrupted')
    expect(host.sends).toHaveLength(0)
    expect(readContent(opened.body.content.id).body).toBe('保留手工正文')
  })
})
