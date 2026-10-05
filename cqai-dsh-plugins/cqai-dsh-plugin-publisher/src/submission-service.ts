/** Shared Host-side validation and routing for page and Agent confirmations. */
import { resolveContent } from './contents.ts'
import { contentSubmissionError } from './submission-validation.ts'
import { resolveWork } from './works.ts'
import {
  PLATFORMS, PLATFORM_LABELS, type CreateSubmissionRequest, type CreateSubmissionResult,
  type CreateVideoSubmissionRequest, type PublisherAccount, type PublisherCapability,
  type PublisherContent, type PublisherMode, type PublisherPlatformCapability,
} from './protocol.ts'

export type PublisherSubmissionMethod =
  | 'accounts.list' | 'accounts.checkLogin' | 'system.capabilities'
  | 'submissions.create' | 'submissions.list'

export interface PublisherSubmissionRuntime {
  status(): PublisherCapability
  request<T = unknown>(method: PublisherSubmissionMethod, params?: unknown, signal?: AbortSignal): Promise<T>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function validateSubmissionChoices(accountIds: unknown, mode: unknown): asserts accountIds is string[] {
  if (mode !== 'publish' && mode !== 'draft') throw new Error('发布方式无效')
  if (!Array.isArray(accountIds) || accountIds.length === 0 || accountIds.length > PLATFORMS.length
    || accountIds.some(id => typeof id !== 'string' || !UUID.test(id))) throw new Error('请选择发布账号')
  if (new Set(accountIds).size !== accountIds.length) throw new Error('发布账号不能重复')
}

/** Shared video preflight; capability metadata is enforced in the Host, not only in the UI. */
export function videoSubmissionError(
  content: Pick<PublisherContent, 'title' | 'videoSource' | 'platformFields'> & Partial<PublisherContent>,
  accounts: PublisherAccount[], capabilities: PublisherPlatformCapability[], mode: PublisherMode,
): string | undefined {
  if (!content.videoSource || !content.title.trim()) return '请先选择视频素材并填写标题'
  if (!accounts.length) return '请选择发布账号'
  const labels: Record<string, string> = { category: '分类', topic: '话题', original: '原创声明' }
  for (const account of accounts) {
    const capability = capabilities.find(item => item.platform === account.platform)
    if (!capability?.modes.video?.includes(mode)) return `${PLATFORM_LABELS[account.platform]}暂不支持此内容类型和提交方式`
    const limit = capability.maxTitleLength?.video
    if (limit !== undefined && content.title.length > limit) return `${PLATFORM_LABELS[account.platform]}标题不能超过 ${limit} 字`
    for (const field of capability.requiredFields.video ?? []) {
      const value = content.platformFields[account.platform]?.[field]
        ?? (content as unknown as Record<string, unknown>)[field]
      if (typeof value !== 'string' || !value.trim()) return `请填写${PLATFORM_LABELS[account.platform]}的${labels[field] ?? field}`
    }
  }
  return undefined
}

/** The optional callback runs synchronously immediately before the only submission RPC. */
export async function createPublisherSubmission(
  runtime: PublisherSubmissionRuntime,
  input: CreateSubmissionRequest,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  beforeDispatch?: (context: { accounts: PublisherAccount[]; capabilities: PublisherPlatformCapability[] }) => void,
): Promise<CreateSubmissionResult> {
  validateSubmissionChoices(input.accountIds, input.mode)
  signal?.throwIfAborted()
  const accounts = await runtime.request<PublisherAccount[]>('accounts.list', undefined, signal)
  const selected = input.accountIds.map(id => accounts.find(account => account.id === id))
  if (selected.some(account => account === undefined)) throw new Error('所选账号不存在，请刷新后重试')
  const platforms = selected.map(account => account!.platform)
  if (new Set(platforms).size !== platforms.length) throw new Error('同一平台一次只能选择一个账号')
  const capabilities = await runtime.request<PublisherPlatformCapability[]>('system.capabilities', undefined, signal)
  for (const account of selected) {
    const capability = capabilities.find(item => item.platform === account!.platform)
    if (!capability?.modes[input.contentType ?? 'video']?.includes(input.mode)) {
      throw new Error(`${account!.displayName}暂不支持此内容类型和提交方式`)
    }
  }
  let params: unknown
  if ('contentId' in input) {
    const { content, directory } = resolveContent(input.contentId, input.revision, env)
    if (content.contentType !== input.contentType) throw new Error('草稿内容类型不匹配')
    if (content.contentType === 'video') {
      const error = videoSubmissionError(content, selected as PublisherAccount[], capabilities, input.mode)
      if (error) throw new Error(error)
      const video = {
        contentType: 'video' as const, title: content.title, description: content.description ?? '',
        shortTitle: content.shortTitle ?? '', tags: content.tags,
        creativeStatement: content.creativeStatement, mode: input.mode, accountIds: input.accountIds,
      }
      if (content.videoSource!.kind === 'local') params = { ...video, localVideoId: content.videoSource!.localVideoId }
      else {
        const work = resolveWork(content.videoSource!.workId, env)
        params = { ...video, workId: content.videoSource!.workId, file: work.file }
      }
    } else {
      const error = contentSubmissionError(content, selected as PublisherAccount[], capabilities, input.mode)
      if (error) throw new Error(error)
      params = { ...input, contentDirectory: directory }
    }
  } else {
    const video = input as CreateVideoSubmissionRequest
    const videoError = videoSubmissionError({ title: video.title, description: video.description,
      shortTitle: video.shortTitle, tags: video.tags, creativeStatement: video.creativeStatement,
      platformFields: {}, videoSource: video.localVideoId !== undefined
        ? { kind: 'local', localVideoId: video.localVideoId, fileName: 'video.mp4', bytes: 1 }
        : video.workId !== undefined ? { kind: 'work', workId: video.workId } : undefined,
    }, selected as PublisherAccount[], capabilities, input.mode)
    if (videoError) throw new Error(videoError)
    if (video.localVideoId !== undefined) params = video
    else {
      if (video.workId === undefined) throw new Error('视频来源无效')
      const work = resolveWork(video.workId, env)
      params = { ...video, file: work.file }
    }
  }
  signal?.throwIfAborted()
  beforeDispatch?.({ accounts: selected as PublisherAccount[], capabilities })
  return runtime.request<CreateSubmissionResult>('submissions.create', params, signal)
}
