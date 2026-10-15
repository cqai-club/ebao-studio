/** Ordinary Agents read the global routing Skill, then delegate to a persistent Publisher Agent. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolExecution, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PublisherArticleHandoffs } from './article-handoff.ts'
import { readPublisherSessionOwnership } from './agent-draft-session.ts'
import { isAgentWorkspacePath } from './agent-source-tools.ts'
import { PLATFORMS, type Platform } from './protocol.ts'
import type { PublisherArticleHandoff } from './article-handoff-protocol.ts'
import { PUBLISHER_ROUTING_SKILL } from './publisher-routing-skill.ts'

const ARGUMENTS = new Set(['markdown_path', 'message_id', 'creation_brief', 'content_type', 'title', 'platforms', 'instructions'])
const MAX_INSTRUCTIONS = 2000
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
interface HumanRequest { id: string; text: string; images?: readonly ImageAttachmentRef[] }
export interface PublisherHandoffOptions {
  delegate(handoff: PublisherArticleHandoff, source: { agent: Agent; request: HumanRequest; signal: AbortSignal; assertCurrent(): void }): Promise<PublisherArticleHandoff>
}
function requestOf(message: UserMessage): HumanRequest {
  const images = message.content.flatMap(block => block.type === 'image' ? [block.attachment] : [])
  return { id: message.id, text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
    ...(images.length ? { images } : {}) }
}
function requestExcerpt(text: string): string | undefined {
  const normalized = text.trim()
  if (!normalized) return undefined
  if (normalized.length <= MAX_INSTRUCTIONS) return normalized
  const prefix = '用户原要求较长，以下为开头节选：\n'
  let excerpt = normalized.slice(0, MAX_INSTRUCTIONS - prefix.length)
  const last = excerpt.charCodeAt(excerpt.length - 1)
  if (last >= 0xD800 && last <= 0xDBFF) excerpt = excerpt.slice(0, -1)
  return prefix + excerpt
}

/** Global lightweight tool, with the source taken only from its exact live executing Agent. */
export function registerPublisherHandoffTools(
  ctx: Context,
  handoffs: Pick<PublisherArticleHandoffs, 'prepare'>,
  owns: (sessionId: string) => boolean = sessionId => readPublisherSessionOwnership(sessionId) !== null,
  options?: PublisherHandoffOptions,
): () => void {
  const requests = new Map<Agent, HumanRequest>()
  const routes = new Map<Agent, HumanRequest>()
  const loads = new Map<ToolExecutionToken, { agent: Agent; request: HumanRequest }>()
  const pending = new Map<ToolExecutionToken, { agent: Agent; request: HumanRequest }[]>()
  const cleanup: (() => void)[] = []
  let disposed = false
  const assertCaller = (exec: Readonly<ToolExecution>, request?: HumanRequest) => {
    exec.signal.throwIfAborted()
    const agent = exec.agent
    if (disposed || !agent || ctx.agents.get(agent.id) !== agent) throw new Error('转交需要当前仍在运行的主 Agent 实例')
    if (agent.session.header.origin === 'subagent' || owns(agent.id)) throw new Error('只有普通主对话可以转交文章到多平台发布')
    const current = requests.get(agent)
    if (!current || request !== undefined && current !== request) throw new Error('请根据当前真人用户需求准备文章转交')
    if (!isAgentWorkspacePath(agent.session.header.cwd)) throw new Error('无法确认当前 Agent 的工作目录')
    return { agent, request: current, cwd: agent.session.header.cwd }
  }
  if (options) cleanup.push(
    ctx.skills.register(PUBLISHER_ROUTING_SKILL),
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || exec.name !== 'skill'
        || (exec.arguments as { name?: unknown } | null)?.name !== PUBLISHER_ROUTING_SKILL.name) return decision
      try {
        const { agent, request } = assertCaller(exec)
        loads.set(exec.token, { agent, request })
      } catch (cause) { return { kind: 'deny', reason: String(cause) } }
      return decision
    }),
    ctx.on('tools/result', (exec, result) => {
      const load = loads.get(exec.token)
      loads.delete(exec.token)
      const ready = pending.get(exec.token) ?? []
      pending.delete(exec.token)
      if (result.isError || exec.signal.aborted) return
      if (load) {
        const value = result.value as Partial<typeof PUBLISHER_ROUTING_SKILL> | undefined
        if (value?.name === PUBLISHER_ROUTING_SKILL.name && value.provider === PUBLISHER_ROUTING_SKILL.provider
          && value.content === PUBLISHER_ROUTING_SKILL.content) ready.push(load)
      }
      if (exec.parent) {
        if (ready.length) pending.set(exec.parent, [...pending.get(exec.parent) ?? [], ...ready])
      } else if (result.content.some(block => block.type === 'text'
        && (block.text.includes(renderSkillContent(PUBLISHER_ROUTING_SKILL))
          || block.text.includes(JSON.stringify(PUBLISHER_ROUTING_SKILL.content))))) {
        for (const { agent, request } of ready) if (requests.get(agent) === request) routes.set(agent, request)
      }
    }),
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      const request = requests.get(agent)
      if (decision.kind === 'reject' || signal.aborted || !request || owns(agent.id)
        || agent.session.header.origin === 'subagent' || ctx.agents.get(agent.id) !== agent) return decision
      if (decision.messages.some(message => message.source.kind === 'skill-invocation'
        && message.source.name === PUBLISHER_ROUTING_SKILL.name && message.source.form === 'instructions'
        && message.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(PUBLISHER_ROUTING_SKILL))))) {
        routes.set(agent, request)
      }
      return decision
    }, { prepend: true }),
  )
  cleanup.push(
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (message.source.kind === 'user') { requests.delete(agent); routes.delete(agent) }
    }),
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      if (message.source.kind === 'user') { requests.set(agent, requestOf(message)); routes.delete(agent) }
      else if (options && message.source.kind === 'skill-invocation' && message.source.name === PUBLISHER_ROUTING_SKILL.name
        && message.source.form === 'instructions' && !owns(agent.id) && agent.session.header.origin !== 'subagent'
        && message.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(PUBLISHER_ROUTING_SKILL)))) {
        const request = requests.get(agent)
        if (request) routes.set(agent, request)
      }
    }),
    ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') { requests.delete(agent); routes.delete(agent) } }),
    ctx.on('agent/disposed', ({ agent }) => { requests.delete(agent); routes.delete(agent) }),
    ctx.tools.register(defineTool({
      name: 'handoff_to_publisher',
      description: options
        ? 'After reading publisher-route, delegate the current human content creation or publishing request to the dedicated Publisher Agent. Use an existing workspace Markdown article, a saved assistant article reply, or a creation brief. Creates or reuses the draft and persistent task, concludes this handoff turn, and continues in Publisher after its editor is ready. Does not submit to any platform.'
        : 'Prepare a Publisher handoff card for a human request to transfer an existing workspace Markdown article or saved assistant reply. Uses this conversation only. Opening the card imports; preparation creates no draft or publication.',
      parameters: {
        markdown_path: { type: 'string', description: 'Existing Markdown file inside this Agent workspace. Supply this or message_id, exactly one.' },
        message_id: { type: 'string', description: 'ID of an already persisted assistant article reply in this exact conversation. Supply this or markdown_path, exactly one.' },
        creation_brief: { type: 'string', description: 'A content creation brief, at most 8000 characters, when there is no existing article. Supply exactly one of creation_brief, markdown_path, message_id.' },
        content_type: { type: 'string', enum: ['article', 'image-note'], description: 'New creation brief only: article or image-note. Defaults to article; use image-note for Xiaohongshu image/text sharing.' },
        title: { type: 'string', description: 'Optional article title; defaults to the source title.' },
        platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORMS] }, description: 'Optional requested publishing platforms.' },
        instructions: { type: 'string', description: 'Optional explicit publishing requirements from the current human, at most 2000 characters. Omission preserves earlier requirements; the original current request is carried to the delegated task separately.' },
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: {
        handoff_id: { type: 'string', required: true },
        title: { type: 'string', required: true },
      } } as const, render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const source = assertCaller(exec)
        if (options && routes.get(source.agent) !== source.request) throw new Error('请先读取 publisher-route 入口 Skill，根据当前用户需求判断是否交接')
        if (Object.keys(exec.arguments as object).some(key => !ARGUMENTS.has(key))) {
          throw new Error('转交工具不接受额外来源身份或正文参数，请使用当前对话的文件或回复 ID')
        }
        if ([args.markdown_path, args.message_id, args.creation_brief].filter(value => value !== undefined).length !== 1) {
          throw new Error('请只选择一个 Markdown 文件路径、已保存的助手回复 ID 或创作要求')
        }
        if (args.creation_brief !== undefined && (!args.creation_brief.trim() || args.creation_brief.length > 8000)) throw new Error('创作要求必须为不超过 8000 字符的非空内容')
        if (args.content_type !== undefined && args.creation_brief === undefined) throw new Error('内容类型只用于新的创作任务')
        if (args.instructions !== undefined && (!args.instructions.trim() || args.instructions.length > MAX_INSTRUCTIONS)) {
          throw new Error('发布要求必须为不超过 2000 字符的非空内容')
        }
        let sourceImages: { ref: ImageAttachmentRef; data: Uint8Array }[] | undefined
        if (args.creation_brief !== undefined && source.request.images?.length) {
          if (source.request.images.length > 20) throw new Error('创作素材最多支持 20 张图片')
          sourceImages = await Promise.all(source.request.images.map(async ref => {
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(ref.mediaType)) throw new Error('创作素材只支持 JPEG、PNG 和 WebP 图片，请先转换图片格式')
            const image = await ctx.attachments.readImage(ref, exec.signal)
            return { ref, data: image.data }
          }))
          const active = assertCaller(exec, source.request)
          if (active.cwd !== source.cwd || options && routes.get(active.agent) !== source.request) throw new Error('图片读取期间交接需求已变化')
        }
        const handoff = handoffs.prepare({
          sessionId: source.agent.id,
          ...(args.markdown_path === undefined ? {} : { markdownPath: args.markdown_path }),
          ...(args.message_id === undefined ? {} : { messageId: args.message_id }),
          ...(args.creation_brief === undefined ? {} : { creationBrief: args.creation_brief.trim(), requestId: source.request.id,
            ...(args.content_type === undefined ? {} : { contentType: args.content_type }),
            ...(sourceImages === undefined ? {} : { sourceImages }) }),
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.platforms === undefined ? {} : { platforms: args.platforms as Platform[] }),
          ...(options ? { defaultInstructions: requestExcerpt(source.request.text),
            ...(args.instructions === undefined ? {} : { instructions: args.instructions.trim() }) }
            : { instructions: args.instructions?.trim() ?? requestExcerpt(source.request.text) }),
        })
        const current = assertCaller(exec, source.request)
        if (current.cwd !== source.cwd) throw new Error('当前 Agent 工作目录已变化，请重新准备转交')
        let result = handoff
        if (options) {
          result = await options.delegate(handoff, { ...source, signal: exec.signal,
            assertCurrent: () => {
              const active = assertCaller(exec, source.request)
              if (active.cwd !== source.cwd || routes.get(active.agent) !== source.request) throw new Error('当前交接需求已变化')
            } })
          assertCaller(exec, source.request)
          exec.concludeTurn()
        }
        return { handoff_id: handoff.handoffId, ...result,
          ...(options && result.delegation ? { task_id: result.delegation.taskId, auto_open: true } : {}) } as unknown as {
          handoff_id: string; title: string; [key: string]: JsonValue
        }
      },
    })),
  )
  return () => {
    if (disposed) return
    disposed = true
    requests.clear()
    routes.clear(); loads.clear(); pending.clear()
    cleanup.reverse().forEach(dispose => dispose())
  }
}
