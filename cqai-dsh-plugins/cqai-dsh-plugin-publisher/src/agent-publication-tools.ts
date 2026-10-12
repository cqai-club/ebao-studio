/** Publication requests can propose a card; only the user's UI click can submit. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { validAgentSessionId } from './agent-draft-binding.ts'
import type { AgentPublications, AgentPublicationRequest } from './agent-publication.ts'
import { PLATFORMS, type Platform } from './protocol.ts'

const resultSchema = { type: 'object', additionalProperties: true, properties: {} } as const
const render = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
const json = (value: object) => value as unknown as Record<string, JsonValue>

type PublicationSource = 'current-draft' | 'prepared-preview'
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function publicationSource(args: {
  source?: string; content_id?: string; binding_token?: string; expected_revision?: number; candidate_id?: string
}): PublicationSource | undefined {
  const draft = args.content_id !== undefined || args.binding_token !== undefined || args.expected_revision !== undefined
  const preview = args.candidate_id !== undefined
  if (draft && preview) throw new Error('发布来源不能混用：当前草稿使用 content_id、binding_token、expected_revision；候选预览仅使用 candidate_id')
  if (args.source !== undefined && args.source !== 'current-draft' && args.source !== 'prepared-preview') {
    throw new Error('发布来源无效，请选择 current-draft 或 prepared-preview')
  }
  const source = args.source ?? (draft ? 'current-draft' : preview ? 'prepared-preview' : undefined)
  if (source === 'current-draft') {
    if (preview || !nonempty(args.content_id) || !nonempty(args.binding_token)
      || !Number.isSafeInteger(args.expected_revision) || args.expected_revision! < 1) {
      throw new Error('当前草稿发布需要完整的 content_id、binding_token 和 expected_revision；请先调用 publisher_get_current_draft 读取最新草稿')
    }
  } else if (source === 'prepared-preview' && (draft || !nonempty(args.candidate_id))) {
    throw new Error('候选预览发布仅使用 candidate_id；请先调用 publisher_prepare_preview，并使用其最新 candidate_id')
  }
  // Older callers may omit every source field: the backend safely selects the
  // current binding or this conversation's latest candidate. New skills name it explicitly.
  return source
}

function publicationResult(request: AgentPublicationRequest, source?: PublicationSource) {
  const state = request.state
  const submissionState = request.submission?.state
  const nextAction = state === 'awaiting-confirmation' ? 'confirm_in_card'
    : state === 'stale' ? 'prepare_again'
    : state === 'uncertain' || submissionState === 'unknown' ? 'check_platform'
    : state === 'submitting' || state === 'submitted' && (!submissionState || submissionState === 'queued' || submissionState === 'running')
      ? 'query_status' : 'none'
  const message = state === 'awaiting-confirmation' ? '请在对话卡片中选择账号和方式，并点击确认提交；尚未提交到平台。'
    : state === 'stale' ? '内容或来源已变化，请重新准备确认卡片。'
    : state === 'cancelled' ? '发布确认已取消。'
    : nextAction === 'check_platform' ? '平台结果待核对，请到平台后台确认；不要自动重发。'
    : submissionState === 'completed' ? request.mode === 'draft' ? '已存入平台草稿。' : '平台执行已完成。'
    : submissionState === 'failed' ? '本次平台执行失败，请查看错误后处理。'
    : state === 'submitting' ? '确认提交正在处理，请查询状态，不要重复提交。'
    : '已进入本机发布队列；排队受理不代表平台发布成功。'
  return {
    request_id: request.requestId, ...(source ? { source } : {}), state, title: request.content.title, mode: request.mode,
    requires_user_confirmation: state === 'awaiting-confirmation', next_action: nextAction,
    message: request.message ?? message, errors: request.errors ?? [], warnings: request.warnings ?? [],
    submission: request.submission ?? null,
  }
}



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
      description: 'Prepare this conversation’s publication confirmation card for an explicit publishing request. The user selects accounts and mode and confirms in the card; this tool never submits.',
      parameters: {
        source: { type: 'string', enum: ['current-draft', 'prepared-preview'], description: 'Choose one source; never mix draft fields and candidate_id.' },
        content_id: { type: 'string', description: 'current-draft: ID returned by publisher_get_current_draft.' },
        binding_token: { type: 'string', description: 'current-draft: token returned with that draft.' },
        expected_revision: { type: 'integer', description: 'current-draft: latest revision returned with that draft.' },
        candidate_id: { type: 'string', description: 'prepared-preview: latest candidate_id returned by publisher_prepare_preview.' },
        platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORMS] } },
        account_ids: { type: 'array', items: { type: 'string' }, description: 'Suggested existing account IDs; omit when unknown. Final selection is in the card.' },
        mode: { type: 'string', enum: ['publish', 'draft'], description: 'Suggested mode; the user confirms the final choice in the card.' },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const sessionId = await sessionOf(exec.agent)
        exec.signal.throwIfAborted()
        const source = publicationSource(args)
        const request = await publications.prepare(sessionId, String(exec.callId), {
          signal: exec.signal,
          ...(args.content_id === undefined ? {} : { contentId: args.content_id }),
          ...(args.binding_token === undefined ? {} : { bindingToken: args.binding_token }),
          ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }),
          ...(args.candidate_id === undefined ? {} : { candidateId: args.candidate_id }),
          ...(args.platforms === undefined ? {} : { platforms: args.platforms as Platform[] }),
          ...(args.account_ids === undefined ? {} : { accountIds: args.account_ids }),
          ...(args.mode === undefined ? {} : { mode: args.mode }),
        })
        exec.signal.throwIfAborted()
        return json(publicationResult(request, source))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_get_publication_status',
      description: 'Read this conversation’s publication status. Queued is not platform success; unknown results need manual checking, never automatic resubmission.',
      parameters: { request_id: { type: 'string', required: true } },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const sessionId = await sessionOf(exec.agent)
        const request = await publications.getStatus(sessionId, args.request_id)
        exec.signal.throwIfAborted()
        return json(publicationResult(request))
      },
    })),
  ]
  return () => { for (const close of dispose.reverse()) close() }
}
