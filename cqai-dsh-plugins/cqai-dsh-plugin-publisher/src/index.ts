import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  API,
  CREATIVE_STATEMENTS,
  DESCRIPTION_MAX,
  MAX_TAGS,
  TITLE_MAX,
  VIDEO_PLATFORMS,
  type CreateSubmissionRequest,
  type Platform,
  type PublisherAccount,
  type PublisherCapability,
} from './protocol.ts'
import { listWorks, resolveWork } from './works.ts'

export const name = 'cqai-publisher'
export const inject = ['webServer', 'desktopRuntime']

const MAX_BODY_BYTES = 64 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type WorkerMethod =
  | 'accounts.list' | 'accounts.create' | 'accounts.update' | 'accounts.delete'
  | 'accounts.openLogin' | 'accounts.checkLogin' | 'accounts.openDashboard'
  | 'accounts.importPreview' | 'accounts.importApply'
  | 'submissions.create' | 'submissions.list'

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
  if (typeof value !== 'string' || !(VIDEO_PLATFORMS as readonly string[]).includes(value)) throw new Error('平台无效')
  return value as Platform
}

function idBody(value: unknown): { id: string } {
  const body = exact(value, ['id'])
  return { id: uuid(body.id, '账号 ID') }
}

function submissionBody(value: unknown): CreateSubmissionRequest {
  const body = exact(value, [
    'workId', 'title', 'description', 'shortTitle', 'tags', 'creativeStatement', 'mode', 'accountIds',
  ])
  if (body.mode !== 'publish' && body.mode !== 'draft') throw new Error('发布方式无效')
  if (!Array.isArray(body.accountIds) || body.accountIds.length === 0 || body.accountIds.length > VIDEO_PLATFORMS.length) {
    throw new Error('请选择 1–8 个发布账号')
  }
  const accountIds = [...new Set(body.accountIds.map(item => uuid(item, '账号 ID')))]
  if (accountIds.length !== body.accountIds.length) throw new Error('发布账号不能重复')
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
    workId: uuid(body.workId, '作品 ID'),
    title: text(body.title, '标题', TITLE_MAX),
    description: optionalText(body.description, '简介', DESCRIPTION_MAX),
    shortTitle: optionalText(body.shortTitle, '视频号短标题', 32),
    tags,
    creativeStatement: creativeStatement as CreateSubmissionRequest['creativeStatement'],
    mode: body.mode,
    accountIds,
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('请求过大')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('请求过大')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new Error('请求 JSON 无效') }
}

async function dispatch(runtime: PublisherRuntime, action: string, req: IncomingMessage): Promise<{ code: number; data: unknown }> {
  if (req.method === 'GET') {
    if (action === 'capability') return { code: 200, data: runtime.status() }
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
  const body = await readJson(req)
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
    const work = resolveWork(input.workId)
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
