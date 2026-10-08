import type { Context } from '@deepseek-ai/cordis'
import type { PluginSubmissionInput } from './protocol.ts'

type ToolExecution = { signal: AbortSignal }
type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }
  execute(args: unknown, exec: ToolExecution): Promise<unknown>
}
type ToolRegistry = { register(definition: ToolDefinition): () => void }
type SkillRegistry = { register(definition: { name: string; description: string; source: 'runtime'; content: string }): () => void }
type PreToolDecision = { kind: 'allow' | 'deny' | 'cancel'; reason?: string } | {
  kind: 'ask'; reason: string; displayReason: { en: string; 'zh-CN': string }
}
type PreToolExecution = { name: string; arguments: unknown }
type PreToolEvents = {
  on(event: 'tools/pre-execute', listener: (exec: PreToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>): () => void
}
export type ClubDispatch = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

const resultSchema = { type: 'object', additionalProperties: true, properties: {} }
const render = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
const noArgs = { type: 'object', additionalProperties: false, properties: {} }
const idArgs = {
  type: 'object', additionalProperties: false,
  properties: { activity_id: { type: 'string' } }, required: ['activity_id'],
}

function service<T>(ctx: Context, name: string): T {
  const value = (ctx as unknown as { get(key: string): unknown }).get(name)
  if (!value) throw new Error(`缺少 ${name} 服务`)
  return value as T
}

function activityId(args: unknown): string {
  const id = (args as { activity_id?: unknown } | null)?.activity_id
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) throw new Error('活动编号无效')
  return id
}

function submissionInput(args: unknown): PluginSubmissionInput {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('插件资料无效')
  const value = args as Record<string, unknown>
  const packageName = value.package_name
  const displayName = value.display_name
  const summary = value.summary
  if (typeof packageName !== 'string' || typeof displayName !== 'string' || typeof summary !== 'string') {
    throw new Error('请填写 npm 包名、展示名称和简介')
  }
  const input: PluginSubmissionInput = {
    packageName: packageName.trim(), displayName: displayName.trim(), summary: summary.trim(),
  }
  for (const [source, target] of [
    ['description', 'description'], ['repository_url', 'repositoryUrl'], ['homepage_url', 'homepageUrl'],
  ] as const) {
    const item = value[source]
    if (item !== undefined) {
      if (typeof item !== 'string') throw new Error(`${source} 必须是文本`)
      input[target] = item.trim()
    }
  }
  return input
}

export function registerClubAgentTools(ctx: Context, dispatch: ClubDispatch): () => void {
  const registry = service<ToolRegistry>(ctx, 'tools')
  const disposeApprovalGate = (ctx as unknown as PreToolEvents).on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'cqai_club_submit_plugin') return next()
    const input = submissionInput(exec.arguments)
    const packageName = input.packageName.slice(0, 214)
    const displayName = input.displayName.slice(0, 120)
    return {
      kind: 'ask',
      reason: `提交 npm 插件 ${packageName} 到 CQAI Club 市场待审`,
      displayReason: {
        en: `Submit npm plugin ${packageName} (${displayName}) to CQAI Club for review?`,
        'zh-CN': `确认将 npm 插件 ${displayName}（${packageName}）提交到 CQAI Club 市场待审核？`,
      },
    }
  })
  const tools: ToolDefinition[] = [
    {
      name: 'cqai_club_list_activities',
      description: '查询 CQAI Club 公开活动列表。返回门户当前发布的活动信息；报名人数和时间以实时接口为准。',
      parameters: noArgs, output: { schema: resultSchema, render },
      execute(_args, exec) { return dispatch('public/list', {}, exec.signal) },
    },
    {
      name: 'cqai_club_get_activity',
      description: '按准确的活动编号查询 CQAI Club 活动详情。报名之前先核对标题、时间、地点、状态和剩余名额。',
      parameters: idArgs, output: { schema: resultSchema, render },
      execute(args, exec) { return dispatch('public/get', { id: activityId(args) }, exec.signal) },
    },
    {
      name: 'cqai_club_register_activity',
      description: '为当前已登录的 CQAI Club 用户报名一个指定活动。只有用户明确要求报名且活动编号已确认时调用；不会代替其他用户报名。',
      parameters: idArgs, output: { schema: resultSchema, render },
      execute(args, exec) { return dispatch('registration/create', { id: activityId(args) }, exec.signal) },
    },
    {
      name: 'cqai_club_submit_plugin',
      description: '将 npm 插件资料提交到 CQAI Club 市场待审。仅在用户明确要求提交、已经展示待提交资料后调用；执行前 DSH 会另行请求用户批准，无批准通道时拒绝。此操作不上传二进制包或直接上架市场。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          package_name: { type: 'string' }, display_name: { type: 'string' },
          summary: { type: 'string' }, description: { type: 'string' },
          repository_url: { type: 'string' }, homepage_url: { type: 'string' },
          confirmed: { type: 'boolean', const: true },
        },
        required: ['package_name', 'display_name', 'summary', 'confirmed'],
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        if ((args as { confirmed?: unknown } | null)?.confirmed !== true) throw new Error('提交前需要用户确认插件资料')
        return dispatch('submissions/create', { input: submissionInput(args) }, exec.signal)
      },
    },
  ]
  const disposers: (() => void)[] = []
  try { for (const tool of tools) disposers.push(registry.register(tool)) }
  catch (error) {
    disposeApprovalGate()
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { disposeApprovalGate(); for (const dispose of disposers.reverse()) dispose() }
}

export const CLUB_SKILL_CONTENT = `# CQAI Club 活动与插件投稿

用 cqai_club_list_activities 查询公开活动；用户指定活动后，使用 cqai_club_get_activity 核对详情。回答时显示活动标题、开始时间、地点、报名状态，数据只以工具返回为准。

用户明确要求报名时，先确认唯一的活动编号，再调用 cqai_club_register_activity。如果有同名活动或活动信息不完整，先向用户确认。报名使用易宝工坊内已登录的 CQAI Club 账号；旧登录缺少门户授权时，引导用户在基础 CQAI Club 插件中重新登录一次，不要求活动插件再次授权。

插件投稿是提交 npm 包的市场资料，不上传安装包，也不会自动上架。可以参考用户提供的 package.json、插件清单和 README 整理包名、展示名称、简介及仓库地址；先把完整待提交资料展示给用户。只有用户明确要求提交后，才调用 cqai_club_submit_plugin 并将 confirmed 设为 true。DSH 在工具执行前还会弹出一次针对这笔投稿的批准请求；没有可用批准通道或用户拒绝时，投稿不会发送。提交成功后说明资料处于待审核状态，不要声称已经发布。

不要索取或显示访问令牌、刷新令牌；不要代替用户推断权限或报名结果。`

export function registerClubSkill(ctx: Context): () => void {
  return service<SkillRegistry>(ctx, 'skills').register({
    name: 'cqai-club',
    description: '查询 CQAI Club 活动、为当前登录用户报名，并提交 npm 插件资料到俱乐部市场待审核。',
    source: 'runtime',
    content: CLUB_SKILL_CONTENT,
  })
}
