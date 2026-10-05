/** Publication requests can propose a card; only the user's UI click can submit. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { validAgentSessionId } from './agent-draft-binding.ts'
import type { AgentPublications } from './agent-publication.ts'
import { PLATFORMS, type Platform } from './protocol.ts'

const resultSchema = { type: 'object', additionalProperties: true, properties: {} } as const
const render = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
const json = (value: object) => value as unknown as Record<string, JsonValue>

export const AGENT_PUBLICATION_GUIDANCE = [
  '只有用户明确要求发布或存入平台草稿时，才调用 publisher_request_publication。此工具只创建对话中的发布确认卡片，不会发布。用户可以在卡片中选择平台账号与立即发布/存平台草稿，并点击确认提交或取消；不要要求用户重复跳到发布页操作。',
  '编辑页 Agent 抽屉中先调用 publisher_get_current_draft，使用返回的 content_id、binding_token 和 revision 申请确认卡片。普通对话先读取已登记原稿并准备 publisher_prepare_preview，再使用当前候选创建卡片；不要传入其他对话的草稿或原稿。',
  '账号与发布方式是待用户确认的建议，不能把未确认卡片描述为已提交。不能通过终端、浏览器脚本或其他接口绕过卡片确认。只有用户实际点击确认提交，Host 才提交卡片中展示的那个版本；内容改变后需重新申请确认卡片。',
  '用户确认后，可调用 publisher_get_publication_status 查询同一 request_id。submitted 或 queued 只表示已入队，running 表示执行中；按返回的实际 mode 和状态报告存草稿、完成、失败或结果待核对。uncertain/unknown 时不要自动重发，应请用户到平台后台核对。',
].join('\n')

export function registerAgentPublicationTools(
  ctx: Context,
  publications: AgentPublications,
  available: (sessionId: string) => Promise<boolean>,
): () => void {
  const sessionOf = async (agent: { id: string; session?: { header?: { origin?: string } } } | undefined) => {
    if (!agent || agent.session?.header?.origin === 'subagent') throw new Error('发布确认需要当前主 Agent 对话')
    const sessionId = validAgentSessionId(agent.id)
    if (!await available(sessionId)) throw new Error('当前 Agent 对话不可用于发布确认')
    return sessionId
  }
  const dispose = [
    ctx.tools.register(defineTool({
      name: 'publisher_request_publication',
      description: 'Only after an explicit user request to publish or save a platform draft: show an interactive publication card in this conversation. The human chooses accounts and mode and clicks Confirm; this tool NEVER submits. For an editor draft pass the exact content ID, binding token and revision returned by publisher_get_current_draft. For a file-first conversation prepare the current source preview first. Returns a request_id for status queries.',
      parameters: {
        content_id: { type: 'string' },
        binding_token: { type: 'string' },
        expected_revision: { type: 'integer' },
        candidate_id: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORMS] } },
        account_ids: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['publish', 'draft'] },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const sessionId = await sessionOf(exec.agent)
        exec.signal.throwIfAborted()
        const request = await publications.prepare(sessionId, String(exec.callId), {
          ...(args.content_id === undefined ? {} : { contentId: args.content_id }),
          ...(args.binding_token === undefined ? {} : { bindingToken: args.binding_token }),
          ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }),
          ...(args.candidate_id === undefined ? {} : { candidateId: args.candidate_id }),
          ...(args.platforms === undefined ? {} : { platforms: args.platforms as Platform[] }),
          ...(args.account_ids === undefined ? {} : { accountIds: args.account_ids }),
          ...(args.mode === undefined ? {} : { mode: args.mode }),
        })
        exec.signal.throwIfAborted()
        return json({ request_id: request.requestId, state: request.state, title: request.content.title,
          requires_user_confirmation: request.state === 'awaiting-confirmation',
          message: request.message ?? '请用户在对话卡片中选择账号、方式并点击确认提交；尚未提交到平台。' })
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_get_publication_status',
      description: 'Read the latest status of this conversation’s publication request. Queued/accepted is not platform publication success. For unknown/uncertain results do not submit again automatically; report that the platform result needs checking.',
      parameters: { request_id: { type: 'string', required: true } },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const sessionId = await sessionOf(exec.agent)
        const request = await publications.getStatus(sessionId, args.request_id)
        exec.signal.throwIfAborted()
        return json({ request_id: request.requestId, state: request.state, mode: request.mode,
          message: request.message ?? null, errors: request.errors, warnings: request.warnings,
          submission: request.submission ?? null })
      },
    })),
    ctx.systemPrompt.section({ name: 'plugin:cqai-publisher:publication', order: 72, text: AGENT_PUBLICATION_GUIDANCE }),
  ]
  return () => { for (const close of dispose.reverse()) close() }
}
