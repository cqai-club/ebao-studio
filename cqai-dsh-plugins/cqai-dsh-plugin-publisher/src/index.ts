import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  API,
  CREATIVE_STATEMENTS,
  DESCRIPTION_MAX,
  MAX_TAGS,
  PLATFORMS,
  TITLE_MAX,
  VIDEO_PLATFORMS,
  type CreateSubmissionRequest,
  type CreateVideoSubmissionRequest,
  type Platform,
  type PublisherAccount,
  type PublisherCapability,
  type PublisherContent,
  type PublisherPlatformCapability,
} from './protocol.ts'
import {
  MAX_ASSET_BYTES, MAX_BODY_BYTES as MAX_CONTENT_BODY_BYTES, addAsset, createContent, deleteContent, duplicateContent,
  listContents, readAsset, readContent, removeAsset, resolveContent, saveContent,
  type SaveContentInput,
} from './contents.ts'
import { listWorks, resolveWork } from './works.ts'

export const name = 'cqai-publisher'
export const inject = ['webServer', 'desktopRuntime']

const MAX_BODY_BYTES = 64 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type WorkerMethod =
  | 'accounts.list' | 'accounts.create' | 'accounts.update' | 'accounts.delete'
  | 'accounts.openLogin' | 'accounts.checkLogin' | 'accounts.openDashboard'
  | 'accounts.importPreview' | 'accounts.importApply'
  | 'submissions.create' | 'submissions.list' | 'system.capabilities'

interface PublisherRuntime {
  status(): PublisherCapability
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

function idBody(value: unknown): { id: string } {
  const body = exact(value, ['id'])
  return { id: uuid(body.id, '账号 ID') }
}

function accountIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > PLATFORMS.length) throw new Error('请选择发布账号')
  const ids = value.map(item => uuid(item, '账号 ID'))
  if (new Set(ids).size !== ids.length) throw new Error('发布账号不能重复')
  return ids
}

function submissionBody(value: unknown): CreateSubmissionRequest {
  const raw = object(value)
  if (raw.contentType === 'article' || raw.contentType === 'image-note') {
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
    'contentType', 'workId', 'title', 'description', 'shortTitle', 'tags', 'creativeStatement', 'mode', 'accountIds',
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
  return {
    contentType: 'video',
    workId: uuid(body.workId, '作品 ID'),
    title: text(body.title, '标题', TITLE_MAX),
    description: optionalText(body.description, '简介', DESCRIPTION_MAX),
    shortTitle: optionalText(body.shortTitle, '视频号短标题', 32),
    tags,
    creativeStatement: creativeStatement as CreateVideoSubmissionRequest['creativeStatement'],
    mode: body.mode,
    accountIds: ids,
  }
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
    'coverAssetId', 'assetOrder', 'platformFields',
  ])
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new Error('草稿修订号无效')
  if (typeof body.title !== 'string' || typeof body.body !== 'string' || typeof body.summary !== 'string') throw new Error('草稿字段无效')
  if (!Array.isArray(body.tags) || body.tags.some(item => typeof item !== 'string')) throw new Error('标签格式无效')
  if (typeof body.creativeStatement !== 'string' || !(CREATIVE_STATEMENTS as readonly string[]).includes(body.creativeStatement)) throw new Error('内容声明无效')
  if (body.coverAssetId !== undefined) uuid(body.coverAssetId, '封面 ID')
  if (body.assetOrder !== undefined && (!Array.isArray(body.assetOrder) || body.assetOrder.some(item => typeof item !== 'string'))) throw new Error('素材顺序无效')
  return {
    id: uuid(body.id, '草稿 ID'),
    input: {
      revision: body.revision as number, title: body.title, body: body.body,
      summary: body.summary, tags: body.tags as string[],
      creativeStatement: body.creativeStatement as PublisherContent['creativeStatement'],
      ...(body.coverAssetId ? { coverAssetId: body.coverAssetId as string } : {}),
      ...(body.assetOrder ? { assetOrder: body.assetOrder as string[] } : {}),
      ...(body.platformFields ? { platformFields: body.platformFields as PublisherContent['platformFields'] } : {}),
    },
  }
}

async function dispatch(runtime: PublisherRuntime, action: string, req: IncomingMessage): Promise<{ code: number; data: unknown }> {
  if (req.method === 'GET') {
    if (action === 'capability') return { code: 200, data: runtime.status() }
    if (action === 'platform-capabilities') return { code: 200, data: await runtime.request('system.capabilities') }
    if (action === 'contents') return { code: 200, data: listContents() }
    if (action.startsWith('content/')) return { code: 200, data: readContent(uuid(action.slice('content/'.length), '草稿 ID')) }
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
  const body = await readJson(req, action === 'content-save' ? 2 * MAX_CONTENT_BODY_BYTES : MAX_BODY_BYTES)
  if (action === 'contents') {
    const value = exact(body, ['contentType'])
    if (value.contentType !== 'article' && value.contentType !== 'image-note') throw new Error('内容类型无效')
    return { code: 201, data: createContent(value.contentType) }
  }
  if (action === 'content-save') {
    const { id, input } = contentSaveBody(body)
    return { code: 200, data: saveContent(id, input) }
  }
  if (action === 'content-copy') return { code: 201, data: duplicateContent(idBody(body).id) }
  if (action === 'content-delete') { deleteContent(idBody(body).id); return { code: 200, data: { ok: true } } }
  if (action === 'content-asset-delete') {
    const value = exact(body, ['id', 'assetId'])
    return { code: 200, data: removeAsset(uuid(value.id, '草稿 ID'), uuid(value.assetId, '素材 ID')) }
  }
  if (action === 'accounts') {
    const value = exact(body, ['displayName', 'platform'])
    return { code: 201, data: await runtime.request('accounts.create', {
      displayName: text(value.displayName, '账号名称', 100), platform: platform(value.platform),
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
  if (action === 'submissions') {
    const input = submissionBody(body)
    const accounts = await runtime.request<PublisherAccount[]>('accounts.list')
    const selected = input.accountIds.map(id => accounts.find(account => account.id === id))
    if (selected.some(account => account === undefined)) throw new Error('所选账号不存在，请刷新后重试')
    const platforms = selected.map(account => account!.platform)
    if (new Set(platforms).size !== platforms.length) throw new Error('同一平台一次只能选择一个账号')
    const capabilities = await runtime.request<PublisherPlatformCapability[]>('system.capabilities')
    for (const account of selected) {
      const platformCapability = capabilities.find(item => item.platform === account!.platform)
      if (!platformCapability?.modes[input.contentType ?? 'video']?.includes(input.mode)) {
        throw new Error(`${account!.displayName}暂不支持此内容类型和提交方式`)
      }
    }
    if (input.contentType === 'article' || input.contentType === 'image-note') {
      const { content, directory } = resolveContent(input.contentId, input.revision)
      if (content.contentType !== input.contentType) throw new Error('草稿内容类型不匹配')
      if (!content.title || !content.body.trim() && content.contentType === 'article') throw new Error('请填写标题和正文')
      if (content.contentType === 'image-note' && content.assets.length === 0) throw new Error('图文至少需要一张图片')
      return { code: 202, data: await runtime.request('submissions.create', {
        ...input, contentDirectory: directory,
      }) }
    }
    const work = resolveWork((input as CreateVideoSubmissionRequest).workId)
    return { code: 202, data: await runtime.request('submissions.create', { ...input, file: work.file }) }
  }
  return { code: 404, data: { error: '接口不存在' } }
}

export function apply(ctx: Context): void {
  const runtime = (ctx as PublisherContext).desktopRuntime.publisher
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
        if (req.method === 'GET' && action.startsWith('content-asset/')) {
          const segments = action.split('/')
          if (segments.length !== 3 || url.search) throw new Error('素材地址无效')
          const asset = readAsset(uuid(segments[1], '草稿 ID'), uuid(segments[2], '素材 ID'))
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
          json(res, code === 'publisher-not-supported' || code === 'publisher-worker-missing' ? 501 : 400, { error: error.message, code })
        }
      }
    },
  }), '多平台账号与发布路由')
}
