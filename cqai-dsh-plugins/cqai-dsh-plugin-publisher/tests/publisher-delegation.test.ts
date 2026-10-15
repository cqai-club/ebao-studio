import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type TurnEndReason, type UserMessage } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import { createContent, patchContent } from '../src/contents.ts'
import { PublisherDelegations, type EnqueuePublisherDelegation } from '../src/publisher-delegation.ts'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture(maintenance = false) {
  const home = mkdtempSync(join(tmpdir(), 'publisher-delegation-'))
  const env = { DSH_HOME: home }
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const content = createContent('article', env)
  const session = ctx.sessions.create(SessionId('publisher-session'), { meta: { cwd: home } })
  const source = ctx.sessions.create(SessionId('source-session'), { meta: { cwd: home } })
  const inbox = { nextTurn: [] as UserMessage[], nextStep: [] as UserMessage[], remove(id: string) {
    for (const messages of [this.nextTurn, this.nextStep]) {
      const at = messages.findIndex(message => message.id === id)
      if (at >= 0) { messages.splice(at, 1); return true }
    }
    return false
  } }
  const agent = { id: session.id, session, inbox, status: 'idle', options: {}, ctx,
    send: vi.fn((message: UserMessage) => {
      inbox.nextTurn.push(message)
      if (!maintenance) Object.assign(agent, { status: 'running' })
      agentEvents(ctx, agent).emit('agent/inbox/inserted', { message })
    }) } as unknown as Agent
  const sourceAgent = { id: source.id, session: source, status: 'idle' } as Agent
  const agents = new Map<string, Agent>([[agent.id, agent], [sourceAgent.id, sourceAgent]])
  ctx.provide('agents', { get: (id: string) => agents.get(id), list: () => [...agents.values()] } as never)
  const owned = new Set([agent.id])
  const bindings = new AgentDraftBindings((id, contentId) => owned.has(SessionId(id)) && contentId === content.id)
  let binding = bindings.bind(agent.id, content.id, env)!
  const available = vi.fn(async () => true)
  const bindingReleased = vi.fn()
  const services = { owns: (id: string, contentId: string) => owned.has(SessionId(id)) && contentId === content.id, available, bindingReleased }
  let runtime = new PublisherDelegations(ctx, bindings, services, env)
  const input: EnqueuePublisherDelegation = { handoffId: randomUUID(), sourceSessionId: source.id,
    requestId: 'original-request', contentId: content.id, publisherSessionId: agent.id,
    requestText: '把刚才这篇游记改成小红书分享，保留图片', instructions: '不要编造徒步事实', platforms: ['xhs'],
    contentType: 'article', contentRevision: content.revision }
  const enqueue = (patch: Partial<EnqueuePublisherDelegation> = {}) => runtime.enqueue({ ...input, ...patch })
  const start = (taskId: string) => runtime.start({ taskId, sessionId: agent.id, bindingToken: binding.bindingToken })
  function claim(turn = 1) {
    const message = inbox.nextTurn.shift()!
    session.append('turn/start', { turn })
    agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn })
    session.append('user/message', message, { surfaceOp: 'append' })
    return message
  }
  function end(reason: TurnEndReason = { kind: 'completed' }, turn = 1) {
    session.append('turn/end', { turn, reason })
    Object.assign(agent, { status: 'idle' })
    agentEvents(ctx, agent).emit('agent/status', { status: 'idle' })
  }
  function answer(text: string, turn = 1) {
    session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({
      source: { provider: 'test', model: 'test' }, content: [
        { type: 'reasoning', text: '私有推理不应该出现在摘要' }, { type: 'text', text },
      ],
    }) }, { surfaceOp: 'append' })
  }
  cleanup.push(async () => { runtime.dispose(); await ctx.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  return { ctx, env, home, agent, sourceAgent, source, session, inbox, agents, bindings, owned, available, bindingReleased, input, content,
    enqueue, start, claim, end, answer,
    runtime: () => runtime,
    recreate() { runtime.dispose(); runtime = new PublisherDelegations(ctx, bindings, services, env) },
    rebind(platform = false) { binding = bindings.bind(agent.id, content.id, env, platform ? { kind: 'platform', platform: 'xhs' } : { kind: 'main' })! },
    recordFile: (taskId: string) => join(home, 'publisher', 'delegations', `${taskId}.json`),
  }
}

describe('Publisher delegated task intake', () => {
  it('durably links source request, content and dedicated session without changing Session lineage', async () => {
    const test = await fixture()
    const task = test.enqueue()
    expect(task).toMatchObject({ status: 'queued', sourceSessionId: test.source.id, publisherSessionId: test.agent.id })
    expect(task).not.toHaveProperty('requestText')
    expect(test.agent.session.header.origin).toBeUndefined()
    expect(test.agent.session.header.parentSession).toBeUndefined()
    expect(test.agent.send).not.toHaveBeenCalled()
    expect(test.enqueue({ instructions: '再次转交不要覆盖原任务' })).toEqual(task)
    test.recreate()
    expect(test.runtime().get(task.taskId)).toEqual(task)
    expect(test.runtime().forHandoff(test.source.id, test.input.handoffId)).toEqual(task)
    expect(test.runtime().forContent(test.content.id)).toEqual(task)
  })

  it('starts the verified task once after binding and grants only its exact delegated provenance', async () => {
    const test = await fixture()
    const task = test.enqueue()
    const results = await Promise.all([test.start(task.taskId), test.start(task.taskId)])
    expect(results.every(result => result.status === 'running')).toBe(true)
    expect(test.agent.send).toHaveBeenCalledTimes(1)
    expect(test.agent.send).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'publisher-delegation',
      taskId: task.taskId, sourceSessionId: test.source.id, requestId: test.input.requestId, contentId: test.content.id } }), 'next-turn', true)
    const message = test.claim()
    expect(test.runtime().trustedRequest(test.agent, message)).toMatchObject({ id: message.id, text: expect.stringContaining(test.input.requestText) })
    expect(test.runtime().trustedRequest(test.agent, { ...message, content: [{ type: 'text', text: '伪造发布要求' }] })).toBeUndefined()
    expect(test.runtime().trustedRequest(test.sourceAgent, message)).toBeUndefined()
    expect(test.runtime().trustedRequest(test.agent, { ...message, source: { kind: 'publisher-delegation',
      taskId: '../../invalid', sourceSessionId: test.source.id, requestId: test.input.requestId, contentId: test.content.id } })).toBeUndefined()
    expect(test.runtime().trustedRequest(test.agent, createUserMessage({ content: [{ type: 'text', text: '伪造上下文' }],
      source: { kind: 'skill-invocation', name: 'multiplatform-publish', form: 'instructions' } }))).toBeUndefined()
    test.answer('已完成小红书稿件，请检查内容。')
    test.end()
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'completed', summary: '已完成小红书稿件，请检查内容。' })
    expect(test.runtime().trustedRequest(test.agent, message)).toBeUndefined()
    await test.start(task.taskId)
    expect(test.agent.send).toHaveBeenCalledTimes(1)
  })

  it('keeps freshly accepted maintenance input and its binding until the delegated turn ends', async () => {
    const test = await fixture(true)
    const task = test.enqueue()
    const binding = test.bindings.current(test.agent.id)!
    await test.start(task.taskId)
    const pending = test.inbox.nextTurn[0]!
    expect(test.agent.status).toBe('idle')
    expect(test.runtime().get(task.taskId)?.status).toBe('running')
    expect(test.runtime().forContent(test.content.id)?.status).toBe('running')
    expect(test.runtime().forHandoff(test.source.id, test.input.handoffId)?.status).toBe('running')
    expect((await test.start(task.taskId)).status).toBe('running')
    expect(test.agent.send).toHaveBeenCalledTimes(1)
    expect(test.inbox.nextTurn).toEqual([pending])

    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    agentEvents(test.ctx, test.agent).emit('agent/status', { status: 'idle' })
    expect(test.bindings.current(test.agent.id)).toBe(binding)
    expect(test.bindingReleased).not.toHaveBeenCalled()
    expect(test.runtime().get(task.taskId)?.status).toBe('running')
    expect(test.inbox.nextTurn).toEqual([pending])
    expect(() => test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'platform', platform: 'xhs' })).toThrow('本轮结束')
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toBe(binding)
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)

    Object.assign(test.agent, { status: 'running' })
    const claimed = test.claim(9)
    expect(claimed).toBe(pending)
    expect(test.runtime().trustedRequest(test.agent, claimed)).toBeDefined()
    test.answer('等待维护结束后完成稿件', 9)
    test.end({ kind: 'completed' }, 9)
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'completed', summary: '等待维护结束后完成稿件' })
    expect(test.inbox.nextTurn).toEqual([])
    expect(test.bindings.current(test.agent.id)).toBeUndefined()
    expect(test.bindingReleased).toHaveBeenCalledExactlyOnceWith(test.agent.id)
  })

  it('keeps an exact claimed task during asynchronous preparation before user/message is recorded', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    const binding = test.bindings.current(test.agent.id)!
    const message = test.inbox.nextTurn.shift()!
    test.session.append('turn/start', { turn: 10 })
    agentEvents(test.ctx, test.agent).emit('agent/inbox/claimed', { message, turn: 10 })
    expect(test.session.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
    expect(test.runtime().get(task.taskId)?.status).toBe('running')
    expect(test.runtime().forContent(test.content.id)?.status).toBe('running')
    expect((await test.start(task.taskId)).status).toBe('running')
    expect(test.agent.send).toHaveBeenCalledTimes(1)
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toBe(binding)
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    expect(test.runtime().trustedRequest(test.agent, message)).toBeDefined()
    test.session.append('user/message', message, { surfaceOp: 'append' })
    test.answer('消息准备后正常完成', 10)
    test.end({ kind: 'completed' }, 10)
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'completed', summary: '消息准备后正常完成' })
    expect(test.bindings.current(test.agent.id)).toBeUndefined()
    expect(test.bindingReleased).toHaveBeenCalledExactlyOnceWith(test.agent.id)
  })

  it.each(['foreign', 'tampered'] as const)('does not keep fresh idle acceptance alive for %s pending input', async kind => {
    const test = await fixture(true)
    const task = test.enqueue()
    await test.start(task.taskId)
    const original = test.inbox.nextTurn[0]!
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    const pending = kind === 'foreign'
      ? createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '另一个待处理输入' }] })
      : { ...original, content: [{ type: 'text' as const, text: '未经核验的委派内容' }] }
    test.inbox.nextTurn.splice(0, 1, pending)
    agentEvents(test.ctx, test.agent).emit('agent/status', { status: 'idle' })
    expect(test.runtime().get(task.taskId)?.status).toBe('interrupted')
    expect(test.inbox.nextTurn).toEqual([pending])
    expect(test.runtime().trustedRequest(test.agent, pending)).toBeUndefined()
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(false)
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toBeUndefined()
    expect(test.bindings.current(test.agent.id)).toBeUndefined()
    expect(test.bindingReleased).toHaveBeenCalledExactlyOnceWith(test.agent.id)
    expect(test.agent.send).toHaveBeenCalledTimes(1)
  })

  it('does not infer maintenance acceptance after reload from an idle durable inbox', async () => {
    const test = await fixture(true)
    const task = test.enqueue()
    await test.start(task.taskId)
    const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '保留用户排队消息' }] })
    test.inbox.nextTurn.push(human)
    test.recreate()
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(false)
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toBeUndefined()
    expect(test.runtime().get(task.taskId)?.status).toBe('interrupted')
    expect(test.runtime().forContent(test.content.id)?.status).toBe('interrupted')
    expect(test.inbox.nextTurn).toEqual([human])
    expect(test.agent.send).toHaveBeenCalledTimes(1)
    expect(test.bindings.current(test.agent.id)).toBe(binding)
    expect(test.bindingReleased).not.toHaveBeenCalled()
  })

  it('adopts a running durable inbox during plugin reload without duplicate input', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.recreate()
    expect((await test.start(task.taskId)).status).toBe('running')
    expect(test.agent.send).toHaveBeenCalledTimes(1)
    test.claim(3)
    test.answer('续接完成', 3)
    test.end({ kind: 'completed' }, 3)
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'completed', summary: '续接完成' })
  })

  it('adopts an already scheduled task claim after reload even before its status is fetched', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.recreate()
    test.claim(4)
    test.answer('无需再次打开卡片也能记录结果', 4)
    test.end({ kind: 'completed' }, 4)
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'completed', summary: '无需再次打开卡片也能记录结果' })
  })

  it('removes only the uncertain delegated input on a cold resume and preserves human pending messages', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    const human = createUserMessage({ content: [{ type: 'text', text: '我自己的后续要求' }], source: { kind: 'user' } })
    test.inbox.nextTurn.push(human)
    Object.assign(test.agent, { status: 'idle' })
    test.recreate()
    await agentEvents(test.ctx, test.agent).serial('agent/created', { source: 'resume' })
    expect(test.inbox.nextTurn).toEqual([human])
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'interrupted' })
    expect(test.agent.send).toHaveBeenCalledTimes(1)
  })

  it('recovers an exact completed turn from history when the plugin missed its boundary', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim(2)
    test.runtime().dispose()
    test.answer('已经整理好公众号稿件', 2)
    test.end({ kind: 'completed' }, 2)
    test.recreate()
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'completed', summary: '已经整理好公众号稿件' })
    expect(test.agent.send).toHaveBeenCalledTimes(1)
  })

  it('marks an uncertain reserved or crash-orphaned delivery interrupted rather than auto-running it', async () => {
    const test = await fixture()
    const task = test.enqueue()
    const path = test.recordFile(task.taskId)
    const record = JSON.parse(readFileSync(path, 'utf8'))
    record.status = 'running'
    writeFileSync(path, JSON.stringify(record))
    test.recreate()
    expect((await test.start(task.taskId)).status).toBe('interrupted')
    expect(test.agent.send).not.toHaveBeenCalled()
    await test.start(task.taskId)
    expect(test.agent.send).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'aborted', reason: { kind: 'user' } }, 'interrupted'],
    [{ kind: 'interrupted' }, 'interrupted'],
    [{ kind: 'error', error: { message: 'provider failed', code: 'UNKNOWN' } }, 'failed'],
    [{ kind: 'max-tokens' }, 'failed'],
    [{ kind: 'blocked' }, 'failed'],
  ] as const)('reports terminal %j honestly', async (reason, status) => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim()
    test.answer('执行到一半的回复')
    test.end(reason as TurnEndReason)
    expect(test.runtime().get(task.taskId)).toMatchObject({ status })
    expect(test.runtime().get(task.taskId)).not.toHaveProperty('summary')
    await test.start(task.taskId)
    expect(test.agent.send).toHaveBeenCalledTimes(1)
  })

  it('does not report a later unrelated turn as completion or wake the original Agent', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim(1)
    const newInput = createUserMessage({ content: [{ type: 'text', text: '先停一下，我想换方向' }], source: { kind: 'user' } })
    agentEvents(test.ctx, test.agent).emit('agent/inbox/claimed', { message: newInput, turn: 1 })
    test.answer('响应新方向', 1)
    test.end({ kind: 'completed' }, 1)
    expect(test.runtime().get(task.taskId)).toMatchObject({ status: 'interrupted' })
    expect(test.source.snapshotEvents()).toEqual([])
  })

  it('preserves user-edited drafts by stopping a queued task whose revision changed', async () => {
    const test = await fixture()
    const task = test.enqueue()
    patchContent(test.content.id, { revision: test.content.revision, patch: { body: '用户手动改完的正文' } }, test.env)
    expect((await test.start(task.taskId)).status).toBe('interrupted')
    expect(test.agent.send).not.toHaveBeenCalled()
  })

  it('waits for the source turn and an empty idle Publisher inbox without merging work', async () => {
    const test = await fixture()
    const task = test.enqueue()
    Object.assign(test.sourceAgent, { status: 'running' })
    await expect(test.start(task.taskId)).rejects.toThrow('来源 Agent')
    Object.assign(test.sourceAgent, { status: 'idle' })
    test.inbox.nextTurn.push(createUserMessage({ content: [{ type: 'text', text: '用户排队输入' }], source: { kind: 'user' } }))
    await expect(test.start(task.taskId)).rejects.toThrow('正在处理其他输入')
    expect(test.runtime().get(task.taskId)?.status).toBe('queued')
    expect(test.agent.send).not.toHaveBeenCalled()
  })

  it('rejects platform binding, a changed binding during availability, and a disposed runtime', async () => {
    const test = await fixture()
    const task = test.enqueue()
    test.rebind(true)
    await expect(test.start(task.taskId)).rejects.toThrow('主稿')
    test.rebind()
    test.available.mockImplementationOnce(async () => { test.rebind(); return true })
    await expect(test.start(task.taskId)).rejects.toThrow('目标已变化')
    test.available.mockImplementationOnce(async () => { test.runtime().dispose(); return true })
    await expect(test.start(task.taskId)).rejects.toThrow('已变化')
    expect(test.agent.send).not.toHaveBeenCalled()
  })

  it('bounds long original requests and validates persisted task identity against tampering', async () => {
    const test = await fixture()
    const task = test.enqueue({ requestText: '长要求🙂'.repeat(6000) })
    const file = test.recordFile(task.taskId)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    expect(record.requestText.length).toBeLessThanOrEqual(16000)
    expect(record.requestText).toContain('节选')
    record.sourceSessionId = 'forged-source'
    writeFileSync(file, JSON.stringify(record))
    expect(() => test.runtime().get(task.taskId)).toThrow('数据无效')
    expect(test.agent.send).not.toHaveBeenCalled()
  })

  it('holds the exact main binding after closing a running task and releases it at its turn boundary', async () => {
    const test = await fixture()
    const task = test.enqueue()
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(false)
    await test.start(task.taskId)
    const message = test.claim(7)
    expect(test.runtime().deferBindingRelease(test.agent.id, randomUUID())).toBe(false)
    expect(test.runtime().deferBindingRelease(test.source.id, binding.bindingToken)).toBe(false)
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    expect(test.bindings.current(test.agent.id)).toEqual(binding)
    expect(test.runtime().trustedRequest(test.agent, message)).toBeDefined()
    test.answer('关闭面板后仍已保存稿件', 7)
    test.end({ kind: 'completed' }, 7)
    expect(test.runtime().get(task.taskId)?.status).toBe('completed')
    expect(test.bindings.current(test.agent.id)).toBeUndefined()
    expect(test.bindingReleased).toHaveBeenCalledExactlyOnceWith(test.agent.id)
  })

  it('reopens the same draft without rotating the running token and cancels only its pending release', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim()
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toBe(binding)
    test.answer('已完成')
    test.end()
    expect(test.bindings.current(test.agent.id)).toBe(binding)
    expect(test.bindingReleased).not.toHaveBeenCalled()
  })

  it('rejects changing the running task target and rejects a rotated token without clearing the newer binding', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    const message = test.claim()
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    expect(() => test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'platform', platform: 'xhs' })).toThrow('本轮结束')
    expect(() => test.runtime().reuseRunningBinding(test.agent.id, randomUUID(), { kind: 'main' })).toThrow('本轮结束')
    expect(test.bindings.current(test.agent.id)).toBe(binding)
    test.rebind()
    const newer = test.bindings.current(test.agent.id)!
    expect(test.runtime().trustedRequest(test.agent, message)).toBeUndefined()
    expect(test.runtime().deferBindingRelease(test.agent.id, newer.bindingToken)).toBe(false)
    expect(() => test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toThrow('绑定已变化')
    test.end({ kind: 'aborted', reason: { kind: 'user' } })
    expect(test.bindings.current(test.agent.id)).toBe(newer)
    expect(test.bindingReleased).not.toHaveBeenCalled()
  })

  it('keeps a deferred binding until the actual turn ends after human steering interrupts the delegated task', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim(5)
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    agentEvents(test.ctx, test.agent).emit('agent/inbox/claimed', { turn: 5,
      message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '换个标题后再完成' }] }) })
    expect(test.runtime().get(task.taskId)?.status).toBe('interrupted')
    expect(test.bindings.current(test.agent.id)).toBe(binding)
    expect(test.bindingReleased).not.toHaveBeenCalled()
    test.end({ kind: 'completed' }, 5)
    expect(test.bindings.current(test.agent.id)).toBeUndefined()
    expect(test.bindingReleased).toHaveBeenCalledExactlyOnceWith(test.agent.id)
  })

  it.each(['error', 'dispose'] as const)('releases only its own deferred binding after %s', async outcome => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim()
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    if (outcome === 'error') test.end({ kind: 'error', error: { message: '模型执行失败', code: 'UNKNOWN' } })
    else test.runtime().dispose()
    expect(test.bindings.current(test.agent.id)).toBeUndefined()
    expect(test.bindingReleased).toHaveBeenCalledExactlyOnceWith(test.agent.id)
    test.runtime().dispose()
    expect(test.bindingReleased).toHaveBeenCalledTimes(1)
  })

  it('adopts the exact started token across HMR and holds no binding for unrelated owned human work', async () => {
    const test = await fixture()
    const task = test.enqueue()
    await test.start(task.taskId)
    test.claim()
    test.recreate()
    const binding = test.bindings.current(test.agent.id)!
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(true)
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'main' })).toBe(binding)
    test.end()
    Object.assign(test.agent, { status: 'running' })
    expect(test.runtime().deferBindingRelease(test.agent.id, binding.bindingToken)).toBe(false)
    expect(test.runtime().reuseRunningBinding(test.agent.id, test.content.id, { kind: 'platform', platform: 'xhs' })).toBeUndefined()
    expect(test.bindings.current(test.agent.id)).toBe(binding)
  })
})
