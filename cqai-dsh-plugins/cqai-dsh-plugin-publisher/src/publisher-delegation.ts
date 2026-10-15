/** Persistent, at-most-once intake of verified tasks into dedicated Publisher conversations. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { AgentDraftBinding, AgentDraftBindings, AgentDraftTarget } from './agent-draft-binding.ts'
import { validAgentSessionId } from './agent-draft-binding.ts'
import { CONTENT_ID, contentsRoot, readContent } from './contents.ts'
import { PLATFORMS, type Platform, type PublisherContentType } from './protocol.ts'
import type { PublisherDelegation, PublisherDelegationSource, PublisherDelegationStatus } from './publisher-delegation-protocol.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'publisher-delegation': PublisherDelegationSource }
}

export interface EnqueuePublisherDelegation {
  handoffId: string
  sourceSessionId: string
  requestId: string
  contentId: string
  publisherSessionId: string
  /** Verified original human input, supplied by the Host tool boundary. */
  requestText: string
  instructions?: string
  creationBrief?: string
  platforms?: readonly Platform[]
  contentType: PublisherContentType
  contentRevision: number
}

export interface PublisherDelegationServices {
  owns(sessionId: string, contentId: string): boolean
  available(sessionId: string): Promise<boolean>
  content?(contentId: string): { revision: number; contentType: PublisherContentType }
  sourceIdle?(sessionId: string): boolean
  bindingReleased?(sessionId: string): void
}

interface StoredDelegation extends PublisherDelegation {
  version: 1
  requestText: string
  instructions?: string
  creationBrief?: string
  platforms: Platform[]
  contentType: PublisherContentType
  contentRevision: number
  messageId: string
  turn?: number
  startBindingToken?: string
}

interface DeferredBindingRelease { taskId: string; sessionId: string; bindingToken: string }

const TERMINAL = new Set<PublisherDelegationStatus>(['completed', 'failed', 'interrupted'])
const STATUS = new Set<PublisherDelegationStatus>(['queued', 'running', ...TERMINAL])
const MAX_RECORD_BYTES = 128 * 1024
const MAX_REQUEST = 16000

function bounded(value: string, max: number): string {
  if (value.length <= max) return value
  let text = value.slice(0, max - 1)
  if (/^[\uD800-\uDBFF]$/u.test(text.slice(-1))) text = text.slice(0, -1)
  return text + '…'
}

function originalRequest(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('发布委派缺少原始用户要求')
  const text = value.trim()
  const prefix = '原始用户要求较长，以下为节选：\n'
  return text.length <= MAX_REQUEST ? text : prefix + bounded(text, MAX_REQUEST - prefix.length)
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !CONTENT_ID.test(value)) throw new Error('发布委派标识无效')
  return value
}

function taskIdentity(input: Pick<EnqueuePublisherDelegation, 'sourceSessionId' | 'requestId' | 'contentId'>): string {
  const hex = createHash('sha256').update(JSON.stringify([input.sourceSessionId, input.requestId, input.contentId])).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function dto(record: StoredDelegation): PublisherDelegation {
  const { taskId, handoffId, sourceSessionId, requestId, contentId, publisherSessionId, status, createdAt, updatedAt, summary, error } = record
  return { taskId, handoffId, sourceSessionId, requestId, contentId, publisherSessionId, status, createdAt, updatedAt,
    ...(summary === undefined ? {} : { summary }), ...(error === undefined ? {} : { error }) }
}

function messageFor(record: StoredDelegation): UserMessage {
  return Object.freeze({ id: MessageId(record.messageId), role: 'user' as const,
    source: Object.freeze({ kind: 'publisher-delegation' as const, taskId: record.taskId,
      sourceSessionId: record.sourceSessionId, requestId: record.requestId, contentId: record.contentId }),
    content: Object.freeze([{ type: 'text' as const, text: [
      '这是由来源对话转交的发布任务。继续处理下面经过核验的用户要求，无需让用户重复输入。',
      `当前内容 ID：${record.contentId}；内容类型：${record.contentType}。先读取当前草稿，保留用户后续手动修改。`,
      `原始用户要求：\n${record.requestText}`,
      ...(record.creationBrief ? [`创作任务：\n${record.creationBrief}`] : []),
      ...(record.instructions ? [`发布要求：\n${record.instructions}`] : []),
      ...(record.platforms.length ? [`目标平台：${record.platforms.join('、')}`] : []),
      '根据任务读取本会话中的写作、编辑或发布 Skill 后执行。实际提交发布仍须遵循发布确认流程。',
    ].join('\n\n') }]) })
}

/** No parent Session mutation, model classification call, or source-Agent wakeup. */
export class PublisherDelegations {
  private readonly cleanup: (() => void)[] = []
  private readonly active = new Map<Agent, string>()
  private readonly deferredBindings = new Map<string, DeferredBindingRelease>()
  private disposed = false

  constructor(private readonly ctx: Context, private readonly bindings: Pick<AgentDraftBindings, 'current' | 'unbind'>,
    private readonly services: PublisherDelegationServices, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.cleanup.push(
      ctx.on('agent/created', ({ agent, source }) => {
        // A cold inbox is durable evidence of an accepted input, not permission
        // to automatically repeat a task whose execution was interrupted.
        if (source === 'resume') {
          for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
            if (message.source.kind !== 'publisher-delegation') continue
            let record: StoredDelegation | null
            try { record = this.load(message.source.taskId) } catch { continue }
            if (record && this.matches(record, agent, message)) this.reconcile(record, agent)
          }
        }
        return undefined
      }),
      ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
        if (this.disposed) return
        let record = this.forAgent(agent)
        if (!record && message.source.kind === 'publisher-delegation') {
          try { record = this.load(message.source.taskId) } catch { return }
          if (!record || record.status !== 'running' || !this.matches(record, agent, message)) return
          this.active.set(agent, record.taskId)
        }
        if (!record) return
        if (this.matches(record, agent, message)) {
          record.turn = turn
          this.save(record)
        } else if (message.source.kind === 'user' && record.turn === turn) {
          this.finish(record, 'interrupted', '用户在任务执行中补充了新的要求，请在当前对话继续处理')
          this.active.delete(agent)
        }
      }),
      ctx.on('agent/inbox/discarded', ({ agent, message }) => {
        const record = this.forAgent(agent)
        if (record && message.id === record.messageId) this.finish(record, 'interrupted', '发布任务输入已取消')
      }),
      ctx.on('session/event', (session, event) => {
        if (this.disposed || event.type !== 'turn/end') return
        const agent = ctx.agents.get(session.id)
        const record = agent && this.forAgent(agent)
        if (record && record.turn === event.data.turn) {
          this.settle(record, session, event)
          this.active.delete(agent!)
        }
        const deferred = this.deferredBindings.get(session.id)
        if (deferred && this.load(deferred.taskId)?.turn === event.data.turn) this.releaseDeferred(deferred)
      }),
      ctx.on('agent/status', ({ agent, status }) => {
        if (status !== 'idle') return
        const record = this.forAgent(agent)
        if (record) this.reconcile(record, agent)
        const deferred = this.deferredBindings.get(agent.id)
        if (deferred) {
          const owner = this.load(deferred.taskId)
          if (!owner || !this.liveAcceptance(owner, agent)) this.releaseDeferred(deferred)
        }
      }),
      ctx.on('agent/disposed', ({ agent }) => {
        const record = this.forAgent(agent)
        if (record && !TERMINAL.has(record.status)) this.finish(record, 'interrupted', '发布会话已关闭，任务未确认完成')
        const deferred = this.deferredBindings.get(agent.id)
        if (deferred) this.releaseDeferred(deferred)
        this.active.delete(agent)
      }),
    )
  }

  private root(create = false): string {
    const path = join(dirname(contentsRoot(this.env)), 'delegations')
    if (create) mkdirSync(path, { recursive: true })
    if (existsSync(path)) {
      const stat = lstatSync(path)
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new Error('发布委派存储路径无效')
    }
    return path
  }

  private file(taskId: string): string { return join(this.root(), `${uuid(taskId)}.json`) }

  private load(taskId: string): StoredDelegation | null {
    const file = this.file(taskId)
    const stat = lstatSync(file, { throwIfNoEntry: false })
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) throw new Error('发布委派数据无效')
    const record = JSON.parse(readFileSync(file, 'utf8')) as StoredDelegation
    if (!record || record.version !== 1 || record.taskId !== taskId || !STATUS.has(record.status)
      || !CONTENT_ID.test(record.handoffId) || !CONTENT_ID.test(record.contentId)
      || taskIdentity(record) !== taskId || record.messageId !== `publisher-delegation-${taskId}`
      || !['article', 'image-note', 'video'].includes(record.contentType)
      || !Number.isSafeInteger(record.contentRevision) || record.contentRevision < 1
      || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))
      || typeof record.requestText !== 'string' || !record.requestText || record.requestText.length > MAX_REQUEST
      || (record.instructions !== undefined && (typeof record.instructions !== 'string' || record.instructions.length > MAX_REQUEST))
      || (record.creationBrief !== undefined && (typeof record.creationBrief !== 'string' || record.creationBrief.length > MAX_REQUEST))
      || !Array.isArray(record.platforms) || record.platforms.some(platform => !(PLATFORMS as readonly string[]).includes(platform))
      || (record.turn !== undefined && (!Number.isSafeInteger(record.turn) || record.turn < 1))
      || (record.startBindingToken !== undefined && (typeof record.startBindingToken !== 'string' || !CONTENT_ID.test(record.startBindingToken)))
      || (record.summary !== undefined && (typeof record.summary !== 'string' || record.summary.length > 2000))
      || (record.error !== undefined && (typeof record.error !== 'string' || record.error.length > 1000))) throw new Error('发布委派数据无效')
    validAgentSessionId(record.sourceSessionId); validAgentSessionId(record.requestId); validAgentSessionId(record.publisherSessionId)
    return record
  }

  private save(record: StoredDelegation): void {
    this.root(true)
    const file = this.file(record.taskId)
    const current = lstatSync(file, { throwIfNoEntry: false })
    if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error('发布委派数据无效')
    record.updatedAt = new Date().toISOString()
    const temp = join(dirname(file), `.${randomUUID()}.tmp`)
    try { writeFileSync(temp, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); renameSync(temp, file) }
    finally { if (existsSync(temp)) rmSync(temp) }
  }

  private records(): StoredDelegation[] {
    const root = this.root()
    if (!existsSync(root)) return []
    return readdirSync(root).filter(file => file.endsWith('.json') && CONTENT_ID.test(file.slice(0, -5)))
      .map(file => this.load(file.slice(0, -5))!).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.taskId.localeCompare(a.taskId))
  }

  enqueue(input: EnqueuePublisherDelegation): PublisherDelegation {
    if (this.disposed) throw new Error('发布委派服务已停止')
    uuid(input.handoffId); uuid(input.contentId)
    validAgentSessionId(input.sourceSessionId); validAgentSessionId(input.requestId); validAgentSessionId(input.publisherSessionId)
    if (!['article', 'image-note', 'video'].includes(input.contentType)
      || !Number.isSafeInteger(input.contentRevision) || input.contentRevision < 1) throw new Error('发布委派草稿无效')
    if (!this.services.owns(input.publisherSessionId, input.contentId)) throw new Error('发布任务会话不是当前草稿的专属会话')
    const taskId = taskIdentity(input)
    const existing = this.load(taskId)
    if (existing) return dto(existing)
    const platforms = [...new Set(input.platforms ?? [])]
    if (platforms.some(platform => !(PLATFORMS as readonly string[]).includes(platform))) throw new Error('发布委派平台无效')
    const now = new Date().toISOString()
    const record: StoredDelegation = { version: 1, taskId, handoffId: input.handoffId, sourceSessionId: input.sourceSessionId,
      requestId: input.requestId, contentId: input.contentId, publisherSessionId: input.publisherSessionId,
      status: 'queued', createdAt: now, updatedAt: now, contentRevision: input.contentRevision, contentType: input.contentType,
      requestText: originalRequest(input.requestText), platforms, messageId: `publisher-delegation-${taskId}`,
      ...(input.instructions?.trim() ? { instructions: bounded(input.instructions.trim(), MAX_REQUEST) } : {}),
      ...(input.creationBrief?.trim() ? { creationBrief: bounded(input.creationBrief.trim(), MAX_REQUEST) } : {}) }
    this.save(record)
    return dto(record)
  }

  get(taskId: string): PublisherDelegation | null {
    const record = this.load(taskId)
    if (!record) return null
    if (record.status === 'running' && !this.disposed) {
      const agent = this.ctx.agents.get(record.publisherSessionId as Agent['id'])
      if (agent) this.reconcile(record, agent)
    }
    return dto(record)
  }

  forHandoff(sourceSessionId: string, handoffId: string): PublisherDelegation | null {
    validAgentSessionId(sourceSessionId); uuid(handoffId)
    const record = this.records().find(row => row.sourceSessionId === sourceSessionId && row.handoffId === handoffId)
    return record ? this.get(record.taskId) : null
  }

  forContent(contentId: string): PublisherDelegation | null {
    uuid(contentId)
    const record = this.records().find(row => row.contentId === contentId)
    return record ? this.get(record.taskId) : null
  }

  private matches(record: StoredDelegation, agent: Agent, message: UserMessage): boolean {
    const source = message.source
    return source.kind === 'publisher-delegation' && source.taskId === record.taskId && source.requestId === record.requestId
      && source.sourceSessionId === record.sourceSessionId && source.contentId === record.contentId
      && agent.id === record.publisherSessionId && message.id === record.messageId
      && JSON.stringify(message.content) === JSON.stringify(messageFor(record).content)
  }

  /** Only an exact durable delegated input can authorize native scoped Skill loads. */
  trustedRequest(agent: Agent, message: UserMessage): { id: string; text: string } | undefined {
    if (this.disposed || message.source.kind !== 'publisher-delegation' || this.ctx.agents.get(agent.id) !== agent
      || agent.session.header.origin === 'subagent') return
    let record: StoredDelegation | null
    try { record = this.load(message.source.taskId) } catch { return }
    const binding = this.bindings.current(agent.id)
    if (!record || record.status !== 'running' || !this.matches(record, agent, message)
      || !this.services.owns(agent.id, record.contentId) || binding?.contentId !== record.contentId || binding.target.kind !== 'main') return
    if (record.startBindingToken !== undefined && binding.bindingToken !== record.startBindingToken) return
    return { id: record.messageId, text: [record.requestText, record.instructions, record.creationBrief].filter(Boolean).join('\n\n') }
  }

  private forAgent(agent: Agent): StoredDelegation | null {
    const id = this.active.get(agent)
    return id ? this.load(id) : null
  }

  private runningForSession(sessionId: string): StoredDelegation | null {
    if (this.disposed) return null
    const agent = this.ctx.agents.get(sessionId as Agent['id'])
    if (!agent || agent.session.header.origin === 'subagent') return null
    const record = this.forAgent(agent) ?? this.records().find(row => row.publisherSessionId === sessionId && row.status === 'running')
    if (!record || record.status !== 'running' || !this.services.owns(sessionId, record.contentId)) return null
    this.reconcile(record, agent)
    return record.status === 'running' ? record : null
  }

  /** Closing a view does not revoke the exact main binding owned by an active delegated turn. */
  deferBindingRelease(sessionId: string, bindingToken: string): boolean {
    const record = this.runningForSession(sessionId)
    const binding = this.bindings.current(sessionId)
    if (!record || record.startBindingToken !== bindingToken || binding?.bindingToken !== bindingToken
      || binding.contentId !== record.contentId || binding.target.kind !== 'main') return false
    this.deferredBindings.set(sessionId, { taskId: record.taskId, sessionId, bindingToken })
    return true
  }

  /** Reopening the same main draft retains the running task's tool CAS token. */
  reuseRunningBinding(sessionId: string, contentId: string, target: AgentDraftTarget): AgentDraftBinding | undefined {
    const record = this.runningForSession(sessionId)
    if (!record) return
    if (record.contentId !== contentId || target.kind !== 'main') throw new Error('发布 Agent 正在执行本轮任务，请等本轮结束后切换编辑目标')
    const binding = this.bindings.current(sessionId)
    if (!record.startBindingToken || binding?.bindingToken !== record.startBindingToken
      || binding.contentId !== contentId || binding.target.kind !== 'main') throw new Error('发布任务的草稿绑定已变化，请等本轮结束后重新打开')
    const deferred = this.deferredBindings.get(sessionId)
    if (deferred?.taskId === record.taskId && deferred.bindingToken === binding.bindingToken) this.deferredBindings.delete(sessionId)
    return binding
  }

  private releaseDeferred(deferred: DeferredBindingRelease): void {
    if (this.deferredBindings.get(deferred.sessionId) !== deferred) return
    this.deferredBindings.delete(deferred.sessionId)
    if (this.bindings.unbind(deferred.sessionId, deferred.bindingToken)) this.services.bindingReleased?.(deferred.sessionId)
  }

  private releaseAfterTaskBoundary(record: StoredDelegation): void {
    const deferred = this.deferredBindings.get(record.publisherSessionId)
    if (!deferred || deferred.taskId !== record.taskId) return
    const agent = this.ctx.agents.get(record.publisherSessionId as Agent['id'])
    if (agent?.status === 'running' && !agent.session.snapshotEvents().some(event => event.type === 'turn/end' && event.data.turn === record.turn)) return
    this.releaseDeferred(deferred)
  }

  private finish(record: StoredDelegation, status: PublisherDelegationStatus, error?: string): void {
    record.status = status
    if (error) record.error = bounded(error, 1000)
    else delete record.error
    this.save(record)
    this.releaseAfterTaskBoundary(record)
  }

  private settle(record: StoredDelegation, session: Session, event: SessionEvent<'turn/end'>): void {
    const reason = event.data.reason
    if (reason.kind === 'completed') {
      const visible = new Set(session.surface.nodes)
      const answer = session.snapshotEvents().filter(item => item.type === 'assistant/message' && item.data.turn === event.data.turn
        && !item.data.interrupted && visible.has(item.seq)).reverse().find(item => item.type === 'assistant/message'
          && item.data.message.content.some(block => block.type === 'text' && block.text.trim()))
      if (answer?.type === 'assistant/message') {
        record.summary = bounded(answer.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim(), 2000)
      }
      this.finish(record, 'completed')
    } else if (['aborted', 'interrupted', 'forked'].includes(reason.kind)) this.finish(record, 'interrupted', '发布任务已中断，请在当前发布对话继续处理')
    else this.finish(record, 'failed', reason.kind === 'error' ? reason.error.message : `发布任务未完成：${reason.kind}`)
  }

  private liveAcceptance(record: StoredDelegation, agent: Agent, pending?: boolean): boolean {
    if (this.disposed || record.status !== 'running' || this.active.get(agent) !== record.taskId
      || this.ctx.agents.get(agent.id) !== agent) return false
    // Public idle also covers maintenance: waking input waits in its inbox.
    // Once claimed, pre-step and route preparation may await before the input
    // reaches user/message. This runtime's exact acceptance owns both gaps.
    return agent.status === 'running' && record.turn !== undefined
      || (pending ?? [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
        .some(message => this.matches(record, agent, message)))
  }

  private reconcile(record: StoredDelegation, agent: Agent): boolean {
    if (TERMINAL.has(record.status)) {
      if ([...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => this.matches(record, agent, message))) {
        agent.inbox.remove(MessageId(record.messageId))
      }
      return true
    }
    let turn = record.turn
    let currentTurn: number | undefined
    let found = false
    for (const event of agent.session.snapshotEvents()) {
      if (event.type === 'turn/start') currentTurn = event.data.turn
      if (event.type === 'user/message' && this.matches(record, agent, event.data)) { found = true; turn = currentTurn }
      if (event.type === 'turn/end' && turn !== undefined && event.data.turn === turn) {
        record.turn = turn; this.settle(record, agent.session, event); return true
      }
    }
    const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => this.matches(record, agent, message))
    if (this.liveAcceptance(record, agent, pending)) return true
    if ((found || pending) && agent.status === 'running') {
      this.active.set(agent, record.taskId)
      if (record.status !== 'running' || record.turn !== turn) {
        record.status = 'running'; record.turn = turn; this.save(record)
      }
      return true
    }
    if (record.status === 'running' || found || pending) {
      this.finish(record, 'interrupted', '上次发布任务未确认完成，为避免重复操作请在发布对话继续处理')
      this.active.delete(agent)
      if (pending) agent.inbox.remove(MessageId(record.messageId))
      return true
    }
    return false
  }

  async start(input: { taskId: string; sessionId: string; bindingToken: string; expectedContentRevision?: number }): Promise<PublisherDelegation> {
    if (this.disposed) throw new Error('发布委派服务已停止')
    const record = this.load(input.taskId)
    if (!record) throw new Error('发布委派任务不存在')
    if (record.publisherSessionId !== input.sessionId) throw new Error('发布委派会话不匹配')
    if (TERMINAL.has(record.status)) return dto(record)
    const agent = this.ctx.agents.get(input.sessionId as Agent['id'])
    if (!agent || agent.session.header.origin === 'subagent') throw new Error('发布 Agent 尚未就绪')
    if (this.reconcile(record, agent)) return dto(record)
    if (!await this.services.available(input.sessionId)) throw new Error('发布会话当前不可用')
    if (this.disposed || this.ctx.agents.get(agent.id) !== agent) throw new Error('发布 Agent 已变化')
    const latest = this.load(record.taskId)!
    if (this.reconcile(latest, agent) || TERMINAL.has(latest.status)) return dto(latest)
    const binding = this.bindings.current(input.sessionId)
    if (!this.services.owns(input.sessionId, latest.contentId) || binding?.contentId !== latest.contentId
      || binding.bindingToken !== input.bindingToken || binding.target.kind !== 'main') throw new Error('当前发布编辑目标已变化，请重新打开主稿')
    const content = this.services.content?.(latest.contentId) ?? readContent(latest.contentId, this.env)
    if (content.contentType !== latest.contentType || content.revision !== latest.contentRevision
      || (input.expectedContentRevision !== undefined && input.expectedContentRevision !== content.revision)) {
      this.finish(latest, 'interrupted', '草稿已修改，已保留当前内容，请在发布对话继续处理')
      return dto(latest)
    }
    if (!(this.services.sourceIdle?.(latest.sourceSessionId)
      ?? this.ctx.agents.get(latest.sourceSessionId as Agent['id'])?.status !== 'running')) throw new Error('来源 Agent 尚未结束当前任务')
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) throw new Error('发布 Agent 正在处理其他输入，请稍后再继续')
    latest.status = 'running'
    latest.startBindingToken = binding.bindingToken
    this.save(latest) // Reserve before delivery; an uncertain crash is never retried automatically.
    this.active.set(agent, latest.taskId)
    try { agent.send(messageFor(latest), 'next-turn', true) }
    catch (error) { this.active.delete(agent); this.finish(latest, 'failed', error instanceof Error ? error.message : '发布任务输入失败'); throw error }
    return dto(this.load(latest.taskId)!)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const close of this.cleanup.reverse()) close()
    for (const deferred of [...this.deferredBindings.values()]) this.releaseDeferred(deferred)
    this.active.clear()
  }
}
