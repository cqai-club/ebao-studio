/** Ephemeral editor-to-Agent bindings. A new binding invalidates in-flight tool calls. */
import { randomUUID } from 'node:crypto'
import { CONTENT_ID, readContent } from './contents.ts'
import { PLATFORMS, type Platform } from './protocol.ts'
import { isCurrentPublisherSession } from './agent-draft-session.ts'

const MAX_SESSION_ID_BYTES = 512

export interface AgentDraftBinding {
  sessionId: string
  contentId: string
  bindingToken: string
  target: AgentDraftTarget
}

export type AgentDraftTarget = { kind: 'main' } | { kind: 'platform'; platform: Platform }

export function normalizeAgentDraftTarget(value: unknown = { kind: 'main' }): AgentDraftTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('草稿编辑目标无效')
  const target = value as Record<string, unknown>
  if (target.kind === 'main' && Object.keys(target).length === 1) return { kind: 'main' }
  if (target.kind === 'platform' && Object.keys(target).length === 2
    && typeof target.platform === 'string' && (PLATFORMS as readonly string[]).includes(target.platform)) {
    return { kind: 'platform', platform: target.platform as Platform }
  }
  throw new Error('草稿编辑目标无效')
}

export function sameAgentDraftTarget(left: AgentDraftTarget, right: AgentDraftTarget): boolean {
  return left.kind === right.kind && (left.kind === 'main' || (right.kind === 'platform' && left.platform === right.platform))
}

export function validAgentSessionId(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_SESSION_ID_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Agent 会话 ID 无效')
  return value
}

export class AgentDraftBindings {
  private readonly bySession = new Map<string, AgentDraftBinding>()
  private readonly environments = new Map<string, NodeJS.ProcessEnv>()

  constructor(private readonly authorize: (sessionId: string, contentId: string, env: NodeJS.ProcessEnv) => boolean
    = isCurrentPublisherSession) {}

  bind(sessionId: string, contentId: string | null, env: NodeJS.ProcessEnv = process.env,
    target: AgentDraftTarget = { kind: 'main' }): AgentDraftBinding | null {
    validAgentSessionId(sessionId)
    if (contentId === null) {
      this.bySession.delete(sessionId)
      this.environments.delete(sessionId)
      return null
    }
    if (!CONTENT_ID.test(contentId)) throw new Error('草稿 ID 无效')
    const content = readContent(contentId, env)
    if (!this.authorize(sessionId, contentId, env)) throw new Error('当前对话不是这份内容的专属 Agent 对话')
    const checkedTarget = normalizeAgentDraftTarget(target)
    if (content.contentType === 'video' && checkedTarget.kind !== 'main') throw new Error('视频草稿不支持平台编辑版本')
    const binding = { sessionId, contentId: content.id, bindingToken: randomUUID(), target: checkedTarget }
    this.bySession.set(sessionId, binding)
    this.environments.set(sessionId, env)
    return binding
  }

  current(sessionId: string): AgentDraftBinding | undefined {
    const binding = this.bySession.get(validAgentSessionId(sessionId))
    if (!binding) return
    try {
      if (this.authorize(sessionId, binding.contentId, this.environments.get(sessionId) ?? process.env)) return binding
    } catch { /* A missing, retired, or recycled draft is no longer editable. */ }
    return undefined
  }

  /** Ignore a delayed close request when a newer drawer binding has replaced it. */
  unbind(sessionId: string, bindingToken: string): boolean {
    const current = this.bySession.get(validAgentSessionId(sessionId))
    if (!current || current.bindingToken !== bindingToken) return false
    this.bySession.delete(sessionId)
    this.environments.delete(sessionId)
    return true
  }

  require(sessionId: string, contentId: string, bindingToken: string): AgentDraftBinding {
    const binding = this.current(sessionId)
    if (!binding || binding.contentId !== contentId || binding.bindingToken !== bindingToken) {
      throw new Error('当前草稿已切换或 Agent 抽屉已关闭，请重新读取草稿')
    }
    return binding
  }

  clear(): void { this.bySession.clear(); this.environments.clear() }
}
