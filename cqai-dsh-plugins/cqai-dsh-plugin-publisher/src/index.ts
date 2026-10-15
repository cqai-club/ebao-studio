import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import {
  API,
  ARTICLE_THEMES,
  CREATIVE_STATEMENTS,
  DESCRIPTION_MAX,
  MAX_TAGS,
  PLATFORMS,
  TITLE_MAX,
  VIDEO_PLATFORMS,
  type CreateSubmissionRequest,
  type CreateVideoSubmissionRequest,
  type Platform,
  type PublisherCapability,
  type PublisherContent,
  type PublisherContentPatch,
  type PublisherLocalVideo,
  type PublisherOpenTargetResult,
  type PublisherSubmission,
  type PublisherVideoSource,
} from './protocol.ts'
import {
  MAX_ASSET_BYTES, MAX_BODY_BYTES as MAX_CONTENT_BODY_BYTES, addAsset, createContent, duplicateContent,
  listContents, patchContent, queryContents, readAsset, readContent, removeAsset, saveContent,
  type SaveContentInput,
} from './contents.ts'
import { createPublisherSubmission } from './submission-service.ts'
import { AgentPublications } from './agent-publication.ts'
import { PublisherAgentTools } from './agent-tools.ts'
import { registerPublisherHandoffTools } from './agent-handoff-tools.ts'
import { PublisherArticleHandoffs } from './article-handoff.ts'
import type { PublisherArticleHandoff } from './article-handoff-protocol.ts'
import { PublisherDelegations } from './publisher-delegation.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import { AgentDraftBindings, normalizeAgentDraftTarget, validAgentSessionId } from './agent-draft-binding.ts'
import { isCurrentPublisherSession, readAgentDraftSession, readPublisherSessionOwnership, retireAgentDraftSession } from './agent-draft-session.ts'
import { PublisherDraftSessionController, type PublisherSessionSummary } from './agent-draft-controller.ts'
import { trashContent, restoreContent, shouldRetireArchivedPublisherSession } from './content-lifecycle.ts'
import { annotateContentOverview } from './content-overview.ts'
import { readPublisherWorkspaceVisibility, type PublisherWorkspaceVisibilityRegistry } from './internal-workspace-visibility.ts'
import { ensureAgentWorkspace } from './agent-workspace.ts'
import { ensureProjectWorkspace, readProjectSettings, saveProjectSettings } from './project-workspace.ts'
import { readWritingProfile, updateWritingProfile, WritingProfileConflictError, type WritingProfileUpdate } from './writing-profile.ts'
import { readSessionContent } from './session-contents.ts'
import { readSessionSourceDocument, readSourceImage } from './source-documents.ts'
import { readPublicationCandidate, validPublicationCandidate } from './publication-candidates.ts'
import { openPublicationFromSource } from './publication-preparation.ts'
import { listWorks } from './works.ts'
import { serveVideoPreview, VideoPreviewError, type LocalVideoReader } from './video-preview.ts'
import { compressDouyinSummary, summaryCompressionRequest, type SummaryCompressionRequest, type SummaryCompressionServices } from './summary-compression.ts'

export const name = 'cqai-publisher'
export const inject = ['webServer', 'desktopRuntime']

const MAX_BODY_BYTES = 64 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type WorkerMethod =
  | 'accounts.list' | 'accounts.create' | 'accounts.update' | 'accounts.delete'
  | 'accounts.openLogin' | 'accounts.checkLogin' | 'accounts.openDashboard'
  | 'accounts.importPreview' | 'accounts.importApply'
  | 'submissions.create' | 'submissions.list' | 'submissions.delete' | 'submissions.openTarget' | 'system.capabilities'

interface PublisherRuntime extends LocalVideoReader {
  status(): PublisherCapability
  selectLocalVideo(): Promise<PublisherLocalVideo | null>
  request<T = unknown>(method: WorkerMethod, params?: unknown, signal?: AbortSignal): Promise<T>
}

interface PublisherContext extends Context {
  desktopRuntime: { publisher: PublisherRuntime }
}

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(data))
}

/** Loopback + same-origin + explicit mutation-header protection. */
export function permitted(req: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return req.method === 'GET' || (req.method === 'POST' && req.headers['x-ejianbao'] === '1')
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求结构无效')
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const body = object(value)
  if (Object.keys(body).some(key => !keys.includes(key))) throw new Error('请求包含不支持的字段')
  return body
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  const normalized = value.trim()
  if (normalized === '' || normalized.length > max) throw new Error(`${label}不能为空且不能超过 ${String(max)} 个字符`)
  return normalized
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}不能超过 ${String(max)} 个字符`)
  return value.trim()
}

function uuid(value: unknown, label: string): string {
  const id = text(value, label, 64)
  if (!UUID.test(id)) throw new Error(`${label}无效`)
  return id
}

function platform(value: unknown): Platform {
  if (typeof value !== 'string' || !(PLATFORMS as readonly string[]).includes(value)) throw new Error('平台无效')
  return value as Platform
}

function idBody(value: unknown, label = '账号 ID'): { id: string } {
  const body = exact(value, ['id'])
  return { id: uuid(body.id, label) }
}

function submissionDeleteBody(value: unknown): { id: string; acknowledgeUnknown?: boolean } {
  const body = exact(value, ['id', 'acknowledgeUnknown'])
  const hasAcknowledgement = Object.prototype.hasOwnProperty.call(body, 'acknowledgeUnknown')
  if (hasAcknowledgement && typeof body.acknowledgeUnknown !== 'boolean') {
    throw new Error('待确认结果标记无效')
  }
  return {
    id: uuid(body.id, '提交 ID'),
    ...(hasAcknowledgement ? { acknowledgeUnknown: body.acknowledgeUnknown as boolean } : {}),
  }
}

function submissionOpenTargetBody(value: unknown): { submissionId: string; accountId: string; listOnly?: boolean } {
  const body = exact(value, ['submissionId', 'accountId', 'listOnly'])
  if (body.listOnly !== undefined && typeof body.listOnly !== 'boolean') throw new Error('列表打开方式无效')
  return {
    submissionId: uuid(body.submissionId, '提交 ID'),
    accountId: uuid(body.accountId, '账号 ID'),
    ...(body.listOnly === undefined ? {} : { listOnly: body.listOnly as boolean }),
  }
}

function accountIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > PLATFORMS.length) throw new Error('请选择发布账号')
  const ids = value.map(item => uuid(item, '账号 ID'))
  if (new Set(ids).size !== ids.length) throw new Error('发布账号不能重复')
  return ids
}

function submissionBody(value: unknown): CreateSubmissionRequest {
  const raw = object(value)
  if (raw.contentType === 'article' || raw.contentType === 'image-note'
    || raw.contentType === 'video' && ('contentId' in raw || 'revision' in raw)) {
    const body = exact(value, ['contentType', 'contentId', 'revision', 'mode', 'accountIds'])
    if (body.mode !== 'publish' && body.mode !== 'draft') throw new Error('发布方式无效')
    if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new Error('草稿修订号无效')
    return {
      contentType: raw.contentType,
      contentId: uuid(body.contentId, '草稿 ID'),
      revision: body.revision as number,
      mode: body.mode,
      accountIds: accountIds(body.accountIds),
    }
  }
  const body = exact(value, [
    'contentType', 'workId', 'localVideoId', 'title', 'description', 'shortTitle', 'tags', 'creativeStatement', 'mode', 'accountIds',
  ])
  if (body.contentType !== undefined && body.contentType !== 'video') throw new Error('内容类型无效')
  if (body.mode !== 'publish' && body.mode !== 'draft') throw new Error('发布方式无效')
  const ids = accountIds(body.accountIds)
  if (ids.length > VIDEO_PLATFORMS.length) throw new Error('视频发布最多选择 8 个平台账号')
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > MAX_TAGS)) throw new Error(`话题不能超过 ${String(MAX_TAGS)} 个`)
  const tags = (body.tags ?? []).map((item) => {
    if (typeof item !== 'string') throw new Error('话题格式无效')
    const tag = item.replace(/^#+/u, '').trim()
    if (tag === '' || tag.length > 100) throw new Error('单个话题不能为空且不能超过 100 个字符')
    return tag
  })
  const creativeStatement = body.creativeStatement ?? 'none'
  if (typeof creativeStatement !== 'string' || !(CREATIVE_STATEMENTS as readonly string[]).includes(creativeStatement)) {
    throw new Error('AI 内容声明无效')
  }
  const hasWork = body.workId !== undefined
  const hasLocalVideo = body.localVideoId !== undefined
  if (hasWork === hasLocalVideo) throw new Error('请选择一条 e剪宝成片或一个本地视频')
  return {
    contentType: 'video',
    ...(hasWork ? { workId: uuid(body.workId, '作品 ID') } : { localVideoId: uuid(body.localVideoId, '本地视频 ID') }),
    title: text(body.title, '标题', TITLE_MAX),
    description: optionalText(body.description, '简介', DESCRIPTION_MAX),
    shortTitle: optionalText(body.shortTitle, '视频号短标题', 32),
    tags,
    creativeStatement: creativeStatement as CreateVideoSubmissionRequest['creativeStatement'],
    mode: body.mode,
    accountIds: ids,
  }
}

function videoSource(value: unknown): PublisherVideoSource | undefined {
  if (value === undefined) return undefined
  const raw = object(value)
  if (raw.kind === 'work') {
    const source = exact(value, ['kind', 'workId'])
    return { kind: 'work', workId: uuid(source.workId, '作品 ID') }
  }
  if (raw.kind === 'local') {
    const source = exact(value, ['kind', 'localVideoId', 'fileName', 'bytes'])
    const fileName = text(source.fileName, '视频名称', 255)
    if (/[/\\]/u.test(fileName) || !fileName.toLowerCase().endsWith('.mp4')) throw new Error('视频名称无效')
    if (!Number.isSafeInteger(source.bytes) || (source.bytes as number) < 1) throw new Error('视频大小无效')
    return { kind: 'local', localVideoId: uuid(source.localVideoId, '本地视频 ID'), fileName, bytes: source.bytes as number }
  }
  throw new Error('视频来源无效')
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit) throw new Error('请求过大')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error('请求过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const bytes = await readBytes(req, limit)
  const chunks = bytes.length > 0 ? [bytes] : []
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new Error('请求 JSON 无效') }
}

function contentSaveBody(value: unknown): { id: string; input: SaveContentInput } {
  const body = exact(value, [
    'id', 'revision', 'title', 'body', 'summary', 'tags', 'creativeStatement',
    'articleTheme', 'coverAssetId', 'assetOrder', 'platformFields', 'platformVariants', 'description', 'shortTitle', 'videoSource',
  ])
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new Error('草稿修订号无效')
  if (typeof body.title !== 'string' || typeof body.body !== 'string' || typeof body.summary !== 'string') throw new Error('草稿字段无效')
  if (!Array.isArray(body.tags) || body.tags.some(item => typeof item !== 'string')) throw new Error('标签格式无效')
  if (typeof body.creativeStatement !== 'string' || !(CREATIVE_STATEMENTS as readonly string[]).includes(body.creativeStatement)) throw new Error('内容声明无效')
  if (body.articleTheme !== undefined && !(ARTICLE_THEMES as readonly string[]).includes(body.articleTheme as string)) throw new Error('文章排版主题无效')
  if (body.coverAssetId !== undefined) uuid(body.coverAssetId, '封面 ID')
  if (body.assetOrder !== undefined && (!Array.isArray(body.assetOrder) || body.assetOrder.some(item => typeof item !== 'string'))) throw new Error('素材顺序无效')
  return {
    id: uuid(body.id, '草稿 ID'),
    input: {
      revision: body.revision as number, title: body.title, body: body.body,
      summary: body.summary, tags: body.tags as string[],
      creativeStatement: body.creativeStatement as PublisherContent['creativeStatement'],
      ...(body.articleTheme === undefined ? {} : { articleTheme: body.articleTheme as PublisherContent['articleTheme'] }),
      ...(body.coverAssetId ? { coverAssetId: body.coverAssetId as string } : {}),
      ...(body.assetOrder ? { assetOrder: body.assetOrder as string[] } : {}),
      ...(body.platformFields ? { platformFields: body.platformFields as PublisherContent['platformFields'] } : {}),
      ...(body.platformVariants === undefined ? {} : { platformVariants: body.platformVariants as PublisherContent['platformVariants'] }),
      ...(body.description !== undefined ? { description: body.description as string } : {}),
      ...(body.shortTitle !== undefined ? { shortTitle: body.shortTitle as string } : {}),
      ...(body.videoSource !== undefined ? { videoSource: videoSource(body.videoSource) } : {}),
    },
  }
}

async function dispatch(runtime: PublisherRuntime, action: string, req: IncomingMessage): Promise<{ code: number; data: unknown }> {
  if (req.method === 'GET') {
    if (action === 'capability') return { code: 200, data: runtime.status() }
    if (action === 'platform-capabilities') return { code: 200, data: await runtime.request('system.capabilities') }
    if (action === 'contents') return { code: 200, data: listContents() }
    if (action.startsWith('session-preview/')) {
      const encoded = action.slice('session-preview/'.length)
      if (!encoded || encoded.includes('/')) throw new Error('会话 ID 无效')
      let sessionId: string
      try { sessionId = decodeURIComponent(encoded) } catch { throw new Error('会话 ID 无效') }
      const source = readSessionSourceDocument(sessionId)
      const candidate = readPublicationCandidate(sessionId)
      return { code: 200, data: { sessionId, source, candidate } }
    }
    if (action.startsWith('session-content/')) {
      const encoded = action.slice('session-content/'.length)
      if (encoded === '' || encoded.includes('/')) throw new Error('会话 ID 无效')
      let sessionId: string
      try { sessionId = decodeURIComponent(encoded) } catch { throw new Error('会话 ID 无效') }
      return { code: 200, data: readSessionContent(sessionId) }
    }
    if (action.startsWith('content/')) return { code: 200, data: readContent(uuid(action.slice('content/'.length), '草稿 ID')) }
    if (action === 'project-settings') return { code: 200, data: readProjectSettings() }
    if (action === 'writing-profile') return { code: 200, data: readWritingProfile() }
    if (action === 'works') return { code: 200, data: listWorks() }
    if (action === 'accounts') return { code: 200, data: await runtime.request('accounts.list') }
    if (action === 'submissions') return { code: 200, data: await runtime.request('submissions.list') }
    if (action === 'import-preview') {
      const preview = object(await runtime.request('accounts.importPreview'))
      const rows = Array.isArray(preview.accounts) ? preview.accounts : []
      return { code: 200, data: {
        running: preview.running === true,
        accounts: rows.flatMap((item) => {
          try {
            const row = object(item)
            return [{
              displayName: text(row.displayName, '账号名称', 100),
              platform: platform(row.platform),
              platformName: typeof row.platformName === 'string' ? row.platformName.slice(0, 40) : '',
            }]
          } catch { return [] }
        }),
      } }
    }
    return { code: 404, data: { error: '接口不存在' } }
  }
  if (req.method !== 'POST') return { code: 405, data: { error: '请求方法不支持' } }
  const body = await readJson(req, action === 'content-save' || action === 'content-patch' ? 2 * MAX_CONTENT_BODY_BYTES
    : action === 'writing-profile' ? 2 * MAX_BODY_BYTES : MAX_BODY_BYTES)
  if (action === 'writing-profile') return { code: 200, data: updateWritingProfile(body as WritingProfileUpdate) }
  if (action === 'publication-open-source') {
    const value = exact(body, ['sessionId', 'sourceRevision'])
    const sessionId = text(value.sessionId, '会话 ID', 512)
    const sourceRevision = text(value.sourceRevision, '内容源修订号', 64)
    const source = readSessionSourceDocument(sessionId)
    if (!source) throw new Error('当前会话没有原稿')
    if (source.revision !== sourceRevision) throw new Error('内容源已更新，请重新预览后发布')
    return { code: 201, data: openPublicationFromSource(source.id, sourceRevision, 'article') }
  }
  if (action === 'publication-open') {
    const value = exact(body, ['sessionId', 'candidateId'])
    const sessionId = text(value.sessionId, '会话 ID', 512)
    const candidate = validPublicationCandidate(sessionId, uuid(value.candidateId, '候选预览 ID'))
    return { code: 201, data: openPublicationFromSource(
      candidate.sourceId, candidate.sourceRevision, candidate.contentType, process.env, candidate,
    ) }
  }
  if (action === 'contents') {
    const value = exact(body, ['contentType', 'title'])
    if (value.contentType !== 'article' && value.contentType !== 'image-note' && value.contentType !== 'video') throw new Error('内容类型无效')
    if (value.title !== undefined && typeof value.title !== 'string') throw new Error('标题格式无效')
    return { code: 201, data: createContent(value.contentType, process.env, value.title) }
  }
  if (action === 'contents-query') {
    const value = exact(body, ['contentType', 'query', 'cursor', 'trash'])
    if (value.contentType !== 'article' && value.contentType !== 'image-note' && value.contentType !== 'video') throw new Error('内容类型无效')
    if (typeof value.query !== 'string') throw new Error('搜索关键词无效')
    if (value.cursor !== undefined && typeof value.cursor !== 'string') throw new Error('草稿查询游标无效')
    if (value.trash !== undefined && typeof value.trash !== 'boolean') throw new Error('回收站查询方式无效')
    const result = queryContents({
      contentType: value.contentType, query: value.query,
      ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
      ...(value.trash === undefined ? {} : { trash: value.trash }),
    })
    let submissions: PublisherSubmission[] | null = null
    try {
      const history = await runtime.request('submissions.list')
      if (Array.isArray(history)) submissions = history as PublisherSubmission[]
    } catch { /* Content remains accessible when the publishing Worker is unavailable. */ }
    return { code: 200, data: annotateContentOverview(result, submissions) }
  }
  if (action === 'project-settings') {
    const value = exact(body, ['defaultRoot'])
    if (typeof value.defaultRoot !== 'string') throw new Error('项目根目录必须是现存的绝对目录')
    return { code: 200, data: saveProjectSettings(value.defaultRoot) }
  }
  if (action === 'project-workspace') {
    const value = exact(body, ['contentId'])
    return { code: 200, data: ensureProjectWorkspace(uuid(value.contentId, '草稿 ID')) }
  }
  if (action === 'content-save') {
    const { id, input } = contentSaveBody(body)
    return { code: 200, data: saveContent(id, input) }
  }
  if (action === 'content-patch') {
    const value = exact(body, ['id', 'revision', 'patch'])
    if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) throw new Error('草稿修订号无效')
    return { code: 200, data: patchContent(uuid(value.id, '草稿 ID'), {
      revision: value.revision as number, patch: object(value.patch) as PublisherContentPatch,
    }) }
  }
  if (action === 'content-copy') return { code: 201, data: duplicateContent(idBody(body).id) }
  if (action === 'content-asset-delete') {
    const value = exact(body, ['id', 'assetId'])
    return { code: 200, data: removeAsset(uuid(value.id, '草稿 ID'), uuid(value.assetId, '素材 ID')) }
  }
  if (action === 'accounts') {
    const value = exact(body, ['displayName', 'platform', 'appId', 'appSecret'])
    const target = platform(value.platform)
    if (target === 'wxmp') {
      if (typeof value.appId !== 'string' || !/^wx[a-z0-9]{16}$/iu.test(value.appId.trim())) throw new Error('公众号 AppID 格式无效')
      if (typeof value.appSecret !== 'string' || !/^[a-z0-9]{32}$/iu.test(value.appSecret.trim())) throw new Error('公众号 AppSecret 格式无效')
    } else if (value.appId !== undefined || value.appSecret !== undefined) throw new Error('此平台不接受公众号密钥')
    return { code: 201, data: await runtime.request('accounts.create', {
      displayName: target === 'wxmp'
        ? text(value.displayName, '账号名称', 100)
        : optionalText(value.displayName, '账号名称', 100), platform: target,
      ...(target === 'wxmp' ? { appId: (value.appId as string).trim(), appSecret: (value.appSecret as string).trim() } : {}),
    }) }
  }
  if (action === 'account-update') {
    const value = exact(body, ['id', 'displayName'])
    return { code: 200, data: await runtime.request('accounts.update', {
      id: uuid(value.id, '账号 ID'), displayName: text(value.displayName, '账号名称', 100),
    }) }
  }
  if (action === 'account-delete') return { code: 200, data: await runtime.request('accounts.delete', idBody(body)) }
  if (action === 'account-open-login') return { code: 200, data: await runtime.request('accounts.openLogin', idBody(body)) }
  if (action === 'account-check-login') return { code: 200, data: await runtime.request('accounts.checkLogin', idBody(body)) }
  if (action === 'account-open-dashboard') return { code: 200, data: await runtime.request('accounts.openDashboard', idBody(body)) }
  if (action === 'import-apply') {
    exact(body, [])
    return { code: 200, data: await runtime.request('accounts.importApply') }
  }
  if (action === 'local-video-select') {
    exact(body, [])
    return { code: 200, data: await runtime.selectLocalVideo() }
  }
  if (action === 'submission-delete') return { code: 200, data: await runtime.request('submissions.delete', submissionDeleteBody(body)) }
  if (action === 'submission-open-target') {
    const result = object(await runtime.request('submissions.openTarget', submissionOpenTargetBody(body)))
    const kind = result.kind
    if (kind !== 'draft' && kind !== 'draft-list' && kind !== 'content-list' && kind !== 'backend' && kind !== 'review-window') {
      throw new Error('平台打开结果无效')
    }
    return { code: 200, data: { kind } satisfies PublisherOpenTargetResult }
  }
  if (action === 'submissions') {
    return { code: 202, data: await createPublisherSubmission(runtime, submissionBody(body)) }
  }
  return { code: 404, data: { error: '接口不存在' } }
}

export function apply(ctx: Context): void {
  const runtime = (ctx as PublisherContext).desktopRuntime.publisher
  let summaryServices: SummaryCompressionServices = {}
  const summaryAborts = new Set<AbortController>()
  ctx.inject(['llm', 'agentDefaultModel'], (modelCtx) => {
    summaryServices = {
      llm: modelCtx.get('llm') as SummaryCompressionServices['llm'],
      defaultModel: modelCtx.get('agentDefaultModel') as SummaryCompressionServices['defaultModel'],
    }
    return () => {
      summaryServices = {}
      for (const controller of summaryAborts) controller.abort()
    }
  })
  ctx.effect(() => () => { for (const controller of summaryAborts) controller.abort() }, '多平台摘要压缩取消')
  const compressSummary = async (input: SummaryCompressionRequest, signal?: AbortSignal, beforeSave?: () => void) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    summaryAborts.add(controller)
    try {
      const result = await compressDouyinSummary(input, summaryServices, { signal: controller.signal, beforeSave })
      controller.signal.throwIfAborted()
      return result
    } finally {
      summaryAborts.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }
  const draftBindings = new AgentDraftBindings()
  const articleHandoffs = new PublisherArticleHandoffs({
    session: id => (ctx.get('sessions') as { get(id: string): Session | undefined } | undefined)?.get(SessionId(id)),
    owns: id => Boolean(readPublisherSessionOwnership(id)),
  })
  let agentTools: PublisherAgentTools | undefined
  let delegations: PublisherDelegations | undefined
  const withDelegation = (handoff: PublisherArticleHandoff): PublisherArticleHandoff => {
    const task = delegations?.forHandoff(handoff.source.sessionId, handoff.handoffId)
    return task ? { ...handoff, delegation: task } : handoff
  }
  const publications = new AgentPublications(runtime, draftBindings, {
    compressSummary: async (content, signal, beforeSave) => (await compressSummary({
      id: content.id, revision: content.revision, platform: 'dy',
    }, signal, beforeSave)).content,
  })
  let liveSession: (id: string) => boolean = () => false
  const listedSession = async (id: string): Promise<boolean> => {
    // The Session Store only contains activated conversations. The Session
    // Controller list also contains persisted, cold conversations after restart.
    const controller = ctx.get('sessionController') as {
      list: (request: Record<string, never>, signal: AbortSignal) => Promise<{
        items: readonly { sessionId: string; origin?: string }[]
      }>
    } | undefined
    if (!controller) return liveSession(id)
    const result = await controller.list({}, new AbortController().signal)
    return result.items.some(item => item.sessionId === id && item.origin !== 'subagent')
  }
  const archivedSession = (id: string): boolean => {
    // Workspace Registry is present in Desktop, but the Publisher may also be
    // mounted without it by a smaller Host composition. The client checks the
    // authoritative archive snapshot before reusing a returned association.
    const registry = ctx.get('workspaceRegistry') as { archivedSessionIds?: readonly string[] } | undefined
    return registry?.archivedSessionIds?.includes(id) ?? false
  }
  const revokeDraft = (sessionId: string): void => {
    draftBindings.bind(sessionId, null)
    agentTools?.refresh(sessionId)
  }
  const sessionController = () => {
    const controller = ctx.get('sessionController') as {
      list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: readonly PublisherSessionSummary[] }>
      create(request: { sessionId: string; workspaceId: string }): Promise<unknown>
      rename?(request: { sessionId: string; title: string }): Promise<unknown>
    } | undefined
    if (!controller) throw new Error('Agent 对话服务尚未就绪，请重试')
    return controller
  }
  const workspaceRegistry = () => {
    const registry = ctx.get('workspaceRegistry') as {
      create(path: string, title: string): Promise<{ id: string; path: string }>
      archiveSession(sessionId: string, options: { stopActivity: boolean }): Promise<void>
      unarchiveSession(sessionId: string): Promise<void>
    } | undefined
    if (!registry) throw new Error('工作区服务尚未就绪，请重试')
    return registry
  }
  const findSession = async (sessionId: string): Promise<PublisherSessionSummary | undefined> => {
    const controller = ctx.get('sessionController') as ReturnType<typeof sessionController> | undefined
    if (!controller) return liveSession(sessionId) ? { sessionId } : undefined
    return (await controller.list({}, new AbortController().signal)).items.find(item => item.sessionId === sessionId)
  }
  const draftSessions = new PublisherDraftSessionController({
    workspace: path => workspaceRegistry().create(path, '多平台发布'),
    find: findSession,
    create: async (sessionId, workspaceId) => { await sessionController().create({ sessionId, workspaceId }) },
    rename: async (sessionId, title) => { await sessionController().rename?.({ sessionId, title }) },
    isArchived: archivedSession,
    archive: sessionId => workspaceRegistry().archiveSession(sessionId, { stopActivity: true }),
    revoke: revokeDraft,
  })
  const lifecycle = (contentId: string) => ({
    isArchived: archivedSession,
    isAvailable: listedSession,
    archiveSession: (sessionId: string) => workspaceRegistry().archiveSession(sessionId, { stopActivity: true }),
    restoreSession: (sessionId: string) => workspaceRegistry().unarchiveSession(sessionId),
    beforeTrash: (_id: string, sessionId: string | null) => {
      if (sessionId) revokeDraft(sessionId)
    },
  })
  // Native sidebar archival must also retire the content association. The
  // global domain event contains the committed archive set, even before the
  // registry's synchronous projection has caught up with the write.
  const domainEvents = ctx as unknown as {
    on(name: 'domain/changed', listener: (change: { domain: string; table: string; operation: string; value: unknown }) => void): () => void
  }
  domainEvents.on('domain/changed', change => {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const state = change.value as { archivedSessionIds?: unknown }
    if (!Array.isArray(state?.archivedSessionIds)) return
    for (const id of state.archivedSessionIds) {
      if (typeof id !== 'string') continue
      try {
        const owner = readPublisherSessionOwnership(id)
        if (!owner || owner.status !== 'current') continue
        revokeDraft(id)
        if (shouldRetireArchivedPublisherSession(id)) retireAgentDraftSession(id)
      } catch (cause) { ctx.logger.warn('无法解除已回收对话的发布关联：%s', String(cause)) }
    }
  })
  ctx.inject(['sessions'], (sessionCtx) => {
    liveSession = id => {
      const session = sessionCtx.sessions.get(SessionId(id))
      return session !== undefined && session.header.origin !== 'subagent'
    }
    const disposeSession = sessionCtx.on('session/disposed', session => {
      draftBindings.bind(session.id, null)
      agentTools?.refresh(session.id)
    })
    return () => { disposeSession(); liveSession = () => false; draftBindings.clear() }
  })
  ctx.inject(['agents', 'tools', 'attachments', 'skills', 'systemPrompt'], (agentCtx) => {
    const tasks = new PublisherDelegations(agentCtx, draftBindings, {
      owns: (id, contentId) => isCurrentPublisherSession(id, contentId),
      available: async id => await listedSession(id) && !archivedSession(id),
      bindingReleased: id => agentTools?.refresh(id),
      sourceIdle: id => {
        const source = agentCtx.agents.get(SessionId(id))
        return !source || source.status === 'idle'
      },
    })
    delegations = tasks
    const disposeHandoff = registerPublisherHandoffTools(agentCtx, articleHandoffs, id => Boolean(readPublisherSessionOwnership(id)), {
      delegate: async (handoff, source) => {
        source.assertCurrent()
        if (!await listedSession(source.agent.id) || archivedSession(source.agent.id)) throw new Error('来源对话已删除或归档')
        source.assertCurrent()
        const result = articleHandoffs.open(source.agent.id, handoff.handoffId)
        const linked = await draftSessions.ensure(result.content.id)
        source.assertCurrent()
        const delegation = tasks.enqueue({ handoffId: handoff.handoffId, sourceSessionId: source.agent.id,
          requestId: source.request.id, requestText: source.request.text.trim()
            || '用户本次没有附加文字，请根据本次交接整理的创作任务和发布要求继续处理。', contentId: result.content.id,
          publisherSessionId: linked.sessionId, contentType: result.content.contentType, contentRevision: result.content.revision,
          platforms: handoff.platforms, instructions: handoff.instructions, creationBrief: handoff.creationBrief })
        return { ...result.handoff, delegation }
      },
    })
    const tools = new PublisherAgentTools(agentCtx, draftBindings, publications,
      async id => await listedSession(id) && !archivedSession(id),
      id => isCurrentPublisherSession(id), (agent, message) => tasks.trustedRequest(agent, message))
    agentTools = tools
    return () => {
      disposeHandoff(); tools.dispose(); tasks.dispose()
      if (agentTools === tools) agentTools = undefined
      if (delegations === tasks) delegations = undefined
    }
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      if (!permitted(req)) { json(res, 403, { error: '仅允许 e宝工坊本机页面访问' }); return }
      try {
        const url = new URL(req.url ?? '', 'http://localhost')
        const prefix = `${API}/`
        if (!url.pathname.startsWith(prefix) || url.search !== '') { json(res, 404, { error: '接口不存在' }); return }
        const action = url.pathname.slice(prefix.length)
        if (req.method === 'GET' && action.startsWith('article-handoff/')) {
          const parts = action.slice('article-handoff/'.length).split('/')
          if (parts.length !== 2) throw new Error('文章转交路径无效')
          json(res, 200, withDelegation(articleHandoffs.get(validAgentSessionId(decodeURIComponent(parts[0]!)), uuid(parts[1], '转交 ID'))))
          return
        }
        if (req.method === 'GET' && action.startsWith('article-origin/')) {
          const origin = articleHandoffs.origin(uuid(action.slice('article-origin/'.length), '草稿 ID'))
          json(res, 200, origin ? { ...withDelegation(origin), sourceSessionAvailable: await listedSession(origin.source.sessionId) && !archivedSession(origin.source.sessionId) } : null)
          return
        }
        if (req.method === 'GET' && action.startsWith('publisher-delegation-for-content/')) {
          const contentId = uuid(action.slice('publisher-delegation-for-content/'.length), '草稿 ID')
          readContent(contentId)
          json(res, 200, delegations?.forContent(contentId) ?? null)
          return
        }
        if (req.method === 'POST' && action === 'publisher-delegation-start') {
          const value = exact(await readJson(req), ['taskId', 'sessionId', 'bindingToken', 'expectedContentRevision'])
          if (!delegations) throw new Error('发布 Agent 服务尚未就绪，请重试')
          if (value.expectedContentRevision !== undefined && (!Number.isSafeInteger(value.expectedContentRevision)
            || (value.expectedContentRevision as number) < 1)) throw new Error('草稿版本无效')
          json(res, 200, await delegations.start({ taskId: uuid(value.taskId, '发布任务 ID'),
            sessionId: validAgentSessionId(value.sessionId), bindingToken: uuid(value.bindingToken, '草稿绑定 ID'),
            ...(value.expectedContentRevision === undefined ? {} : { expectedContentRevision: value.expectedContentRevision as number }) }))
          return
        }
        if (req.method === 'POST' && action === 'article-handoff-prepare') {
          const value = exact(await readJson(req), ['sessionId', 'messageId'])
          const sessionId = validAgentSessionId(value.sessionId)
          if (!await listedSession(sessionId) || archivedSession(sessionId)) throw new Error('来源对话已删除或归档，请重新选择文章')
          json(res, 200, articleHandoffs.prepare({ sessionId, messageId: text(value.messageId, '文章回复 ID', 512) }))
          return
        }
        if (req.method === 'POST' && (action === 'article-handoff-open' || action === 'article-handoff-update')) {
          const value = exact(await readJson(req), action === 'article-handoff-update'
            ? ['sessionId', 'handoffId', 'expectedContentRevision'] : ['sessionId', 'handoffId'])
          const sessionId = validAgentSessionId(value.sessionId), handoffId = uuid(value.handoffId, '转交 ID')
          const pending = articleHandoffs.get(sessionId, handoffId)
          if ((!pending.contentId || action === 'article-handoff-update') && (!await listedSession(sessionId) || archivedSession(sessionId))) {
            throw new Error('来源对话已删除或归档，已有发布稿可以继续编辑')
          }
          if (action === 'article-handoff-update') {
            if (!Number.isSafeInteger(value.expectedContentRevision) || (value.expectedContentRevision as number) < 1) throw new Error('草稿版本无效')
            const result = articleHandoffs.update(sessionId, handoffId, value.expectedContentRevision as number)
            json(res, 200, result)
          } else {
            const result = articleHandoffs.open(sessionId, handoffId)
            if (delegations && !delegations.forHandoff(sessionId, handoffId) && await listedSession(sessionId) && !archivedSession(sessionId)) {
              const linked = await draftSessions.ensure(result.content.id)
              delegations.enqueue({ handoffId, sourceSessionId: sessionId,
                requestId: result.handoff.source.requestId ?? `manual-${handoffId}`,
                requestText: result.handoff.creationBrief ?? result.handoff.instructions
                  ?? '用户通过交接入口打开了这份内容，请检查当前草稿，并在没有具体修改要求时简短说明可以继续写作、编辑或准备发布。',
                contentId: result.content.id, publisherSessionId: linked.sessionId,
                contentType: result.content.contentType, contentRevision: result.content.revision,
                instructions: result.handoff.instructions, creationBrief: result.handoff.creationBrief, platforms: result.handoff.platforms })
            }
            json(res, 200, { ...result, handoff: withDelegation(result.handoff) })
          }
          return
        }
        if (req.method === 'GET' && action === 'internal-workspace-visibility') {
          const registry = ctx.get('workspaceRegistry') as PublisherWorkspaceVisibilityRegistry | undefined
          const controller = ctx.get('sessionController') as ReturnType<typeof sessionController> | undefined
          const summaries = controller ? (await controller.list({}, new AbortController().signal)).items : undefined
          json(res, 200, readPublisherWorkspaceVisibility(typeof registry?.list === 'function' ? registry : undefined, summaries))
          return
        }
        if (req.method === 'POST' && (action === 'content-delete' || action === 'content-restore')) {
          const contentId = idBody(await readJson(req), '草稿 ID').id
          const content = await draftSessions.run(contentId, () => action === 'content-delete'
            ? trashContent(contentId, lifecycle(contentId)) : restoreContent(contentId, lifecycle(contentId)))
          json(res, 200, action === 'content-delete' ? { ok: true } : content)
          return
        }
        if (req.method === 'POST' && action === 'agent-draft-session') {
          const value = exact(await readJson(req), ['contentId'])
          json(res, 200, await draftSessions.ensure(uuid(value.contentId, '草稿 ID')))
          return
        }
        if (req.method === 'POST' && action === 'agent-draft-session-delete') {
          const value = exact(await readJson(req), ['contentId'])
          await draftSessions.removeConversation(uuid(value.contentId, '草稿 ID'))
          json(res, 200, { ok: true })
          return
        }
        if (req.method === 'POST' && action === 'summary-compress') {
          const input = summaryCompressionRequest(await readJson(req))
          const controller = new AbortController()
          const disconnected = () => controller.abort()
          req.once('aborted', disconnected)
          res.once('close', disconnected)
          if (req.aborted || res.destroyed) controller.abort()
          try {
            const result = await compressSummary(input, controller.signal)
            controller.signal.throwIfAborted()
            json(res, 200, result)
          } finally {
            req.off('aborted', disconnected)
            res.off('close', disconnected)
          }
          return
        }
        if (req.method === 'GET' && action.startsWith('agent-publication/')) {
          const segments = action.split('/')
          if (segments.length !== 3) throw new Error('发布确认请求地址无效')
          let decoded: string
          try { decoded = decodeURIComponent(segments[1]!) } catch { throw new Error('会话 ID 无效') }
          const sessionId = validAgentSessionId(decoded)
          if (!await listedSession(sessionId) || archivedSession(sessionId)) throw new Error('当前 Agent 对话不可用于发布确认')
          json(res, 200, await publications.getStatus(sessionId, uuid(segments[2], '发布确认请求 ID')))
          return
        }
        if (req.method === 'POST' && (action === 'agent-publication-confirm' || action === 'agent-publication-cancel')) {
          const value = exact(await readJson(req), action === 'agent-publication-confirm'
            ? ['sessionId', 'requestId', 'accountIds', 'mode'] : ['sessionId', 'requestId'])
          const sessionId = validAgentSessionId(value.sessionId)
          const requestId = uuid(value.requestId, '发布确认请求 ID')
          if (!await listedSession(sessionId) || archivedSession(sessionId)) throw new Error('当前 Agent 对话不可用于发布确认')
          if (action === 'agent-publication-cancel') {
            json(res, 200, await publications.cancel(sessionId, requestId))
          } else {
            if (value.mode !== 'publish' && value.mode !== 'draft') throw new Error('发布方式无效')
            json(res, 200, await publications.confirm(sessionId, requestId, {
              accountIds: accountIds(value.accountIds), mode: value.mode,
            }))
          }
          return
        }
        if (req.method === 'POST' && action === 'agent-workspace') {
          const value = exact(await readJson(req), ['contentId'])
          json(res, 200, { path: ensureAgentWorkspace(uuid(value.contentId, '草稿 ID')) })
          return
        }
        if (req.method === 'GET' && action.startsWith('agent-draft-session/')) {
          const segments = action.split('/')
          if (segments.length !== 2) throw new Error('草稿 ID 无效')
          const contentId = uuid(segments[1], '草稿 ID')
          const storedSessionId = readAgentDraftSession(contentId)
          const sessionId = storedSessionId && await listedSession(storedSessionId) && !archivedSession(storedSessionId)
            ? storedSessionId : null
          json(res, 200, { contentId, sessionId })
          return
        }
        if (req.method === 'GET' && action.startsWith('agent-draft-content/')) {
          const segments = action.split('/')
          if (segments.length !== 2) throw new Error('Agent 会话地址无效')
          let decoded: string
          try { decoded = decodeURIComponent(segments[1]!) } catch { throw new Error('Agent 会话 ID 无效') }
          const sessionId = validAgentSessionId(decoded)
          const empty = { sessionId, contentId: null, contentType: null }
          const summary = await findSession(sessionId)
          if (!summary || summary.origin === 'subagent' || archivedSession(sessionId)
            || !isCurrentPublisherSession(sessionId)) { json(res, 200, empty); return }
          const owner = readPublisherSessionOwnership(sessionId)
          const registry = ctx.get('workspaceRegistry') as {
            get?(id: string): { path: string } | undefined
          } | undefined
          const workspace = owner?.workspaceId ? registry?.get?.(owner.workspaceId) : undefined
          if (!owner || !workspace || !summary.cwd || resolve(summary.cwd) !== resolve(workspace.path)) {
            json(res, 200, empty)
            return
          }
          const content = readContent(owner.contentId)
          json(res, 200, { sessionId, contentId: content.id, contentType: content.contentType })
          return
        }
        if (req.method === 'POST' && action === 'agent-draft-bind') {
          const value = exact(await readJson(req), ['sessionId', 'contentId', 'bindingToken', 'target'])
          const sessionId = validAgentSessionId(value.sessionId)
          const contentId = value.contentId === null ? null : uuid(value.contentId, '草稿 ID')
          if (contentId === null) {
            const token = uuid(value.bindingToken, '绑定令牌')
            if (!delegations?.deferBindingRelease(sessionId, token)
              && draftBindings.unbind(sessionId, token)) agentTools?.refresh(sessionId)
            json(res, 200, { sessionId, contentId: null, bindingToken: null })
            return
          }
          if (!await listedSession(sessionId) || archivedSession(sessionId)) throw new Error('当前 Agent 会话不存在或不可用于编辑')
          if (!isCurrentPublisherSession(sessionId, contentId)) throw new Error('当前对话不是这份内容的发布专属对话')
          if (value.bindingToken !== undefined) throw new Error('绑定草稿时不应提供令牌')
          const target = normalizeAgentDraftTarget(value.target)
          const binding = delegations?.reuseRunningBinding(sessionId, contentId, target)
            ?? draftBindings.bind(sessionId, contentId, process.env, target)
          agentTools?.refresh(sessionId)
          json(res, 200, { sessionId, contentId: binding?.contentId ?? null,
            bindingToken: binding?.bindingToken ?? null })
          return
        }
        if (req.method === 'GET' && action.startsWith('source-image/')) {
          const segments = action.split('/')
          if (segments.length !== 3 || url.search) throw new Error('原稿图片地址无效')
          const image = readSourceImage(uuid(segments[1], '原稿 ID'), uuid(segments[2], '图片 ID'))
          res.writeHead(200, {
            'content-type': image.mime, 'content-length': image.data.length,
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
          })
          res.end(image.data)
          return
        }
        if (req.method === 'GET' && action.startsWith('video-preview/')) {
          const segments = action.split('/')
          if (segments.length !== 3 || (segments[1] !== 'work' && segments[1] !== 'local')) {
            throw new VideoPreviewError(404, '视频预览地址无效')
          }
          await serveVideoPreview(req, res, segments[1], uuid(segments[2], '视频 ID'), runtime)
          return
        }
        if (req.method === 'GET' && action.startsWith('content-asset/')) {
          const segments = action.split('/')
          if (segments.length !== 3 || url.search) throw new Error('素材地址无效')
          const asset = readAsset(uuid(segments[1], '草稿 ID'), uuid(segments[2], '素材 ID'), process.env, { includeTrash: true })
          res.writeHead(200, {
            'content-type': asset.mime, 'content-length': asset.data.length,
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
          })
          res.end(asset.data)
          return
        }
        if (req.method === 'POST' && action.startsWith('content-asset-upload/')) {
          if (url.search) throw new Error('素材地址无效')
          const id = uuid(action.slice('content-asset-upload/'.length), '草稿 ID')
          const encodedName = req.headers['x-publisher-file-name']
          if (typeof encodedName !== 'string' || encodedName.length > 600) throw new Error('素材名称无效')
          let fileName: string
          try { fileName = decodeURIComponent(encodedName) } catch { throw new Error('素材名称无效') }
          const data = await readBytes(req, MAX_ASSET_BYTES)
          json(res, 201, addAsset(id, fileName, data))
          return
        }
        const response = await dispatch(runtime, action, req)
        json(res, response.code, response.data)
      } catch (cause) {
        if (!res.headersSent && !res.destroyed) {
          const error = cause instanceof Error ? cause : new Error('操作失败')
          const code = (error as Error & { code?: string }).code
          json(res, error instanceof WritingProfileConflictError ? 409 : error instanceof VideoPreviewError ? error.status
            : code === 'publisher-not-supported' || code === 'publisher-worker-missing' ? 501 : 400,
          { error: error.message, code })
        } else if (!res.destroyed) res.destroy()
      }
    },
  }), '多平台账号与发布路由')
}
