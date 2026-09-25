/** Ephemeral editor-to-Agent bindings. A new binding invalidates in-flight tool calls. */
import { randomUUID } from 'node:crypto'
import { CONTENT_ID, readContent } from './contents.ts'

const MAX_SESSION_ID_BYTES = 512

export interface AgentDraftBinding {
  sessionId: string
  contentId: string
  bindingToken: string
}

export function validAgentSessionId(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_SESSION_ID_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Agent 会话 ID 无效')
  return value
}

export class AgentDraftBindings {
  private readonly bySession = new Map<string, AgentDraftBinding>()

  bind(sessionId: string, contentId: string | null, env: NodeJS.ProcessEnv = process.env): AgentDraftBinding | null {
    validAgentSessionId(sessionId)
    if (contentId === null) {
      this.bySession.delete(sessionId)
      return null
    }
    if (!CONTENT_ID.test(contentId)) throw new Error('草稿 ID 无效')
    const content = readContent(contentId, env)
    if (content.contentType !== 'article') throw new Error('当前 Agent 只支持编辑文章草稿')
    const binding = { sessionId, contentId: content.id, bindingToken: randomUUID() }
    this.bySession.set(sessionId, binding)
    return binding
  }

  current(sessionId: string): AgentDraftBinding | undefined {
    return this.bySession.get(validAgentSessionId(sessionId))
  }

  /** Ignore a delayed close request when a newer drawer binding has replaced it. */
  unbind(sessionId: string, bindingToken: string): boolean {
    const current = this.current(sessionId)
    if (!current || current.bindingToken !== bindingToken) return false
    this.bySession.delete(sessionId)
    return true
  }

  require(sessionId: string, contentId: string, bindingToken: string): AgentDraftBinding {
    const binding = this.current(sessionId)
    if (!binding || binding.contentId !== contentId || binding.bindingToken !== bindingToken) {
      throw new Error('当前文章已切换或 Agent 抽屉已关闭，请重新读取草稿')
    }
    return binding
  }

  clear(): void { this.bySession.clear() }
}
