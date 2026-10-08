import { Service, type Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

import { registerClubAgentTools, registerClubSkill } from './agent-tools.ts'
import { ClubMcpService } from './mcp/index.ts'
import { RPC_CHANNEL, type ActivityConfig, type ActivitySnapshot, type PluginSubmissionInput } from './protocol.ts'

export { Config } from './config.ts'

export const name = 'cqaiclub-extension'
export const inject = ['connection', 'dsnAccount']

type AccountSnapshot = {
  state: 'signed-out' | 'reauth-required' | 'authorizing' | 'signed-in' | 'error'
  account?: { displayName?: string; username?: string }
  authorizationUrl?: string
  message?: string
}
type AccountService = {
  readonly extensionApiVersion: 1
  getStatus(): Promise<AccountSnapshot>
  getClubPortalAuthorization(): Promise<'signed-out' | 'reauth-required' | 'ready'>
  beginClubPortalAuthorization(signal?: AbortSignal): Promise<AccountSnapshot>
  fetchClubPortal(path: `/api/v1/${string}`, init?: RequestInit, signal?: AbortSignal): Promise<Response>
}
type OwnerConnection = HostConnectionHandle & {
  register(owner: Context, channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>): unknown
}

function service<T>(ctx: Context, key: string): T {
  const value = (ctx as unknown as { get(name: string): unknown }).get(key)
  if (!value) throw new Error(`缺少 ${key} 服务`)
  return value as T
}

function configOf(input?: Partial<ActivityConfig>): ActivityConfig {
  const config: ActivityConfig = { portalUrl: input?.portalUrl ?? 'https://cqaiclub.asia' }
  const portal = new URL(config.portalUrl)
  if (portal.username || portal.password || portal.search || portal.hash || portal.pathname !== '/' ||
    (portal.protocol !== 'https:' && !(portal.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(portal.hostname)))) {
    throw new Error('活动服务地址无效')
  }
  return config
}

function pathId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(value)) throw new Error('活动编号无效')
  return value
}

function managePage(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1 || value > 1_000_000) {
    throw new Error('活动管理页码无效')
  }
  return value
}

function rpcOk(value: unknown): ConnectionRpcResult<unknown> { return { ok: true, value } }
function rpcFail(error: unknown): ConnectionRpcResult<unknown> {
  return { ok: false, error: { code: 'ACTIVITY_ERROR', message: error instanceof Error ? error.message : '活动操作失败', details: {} } }
}

export class ActivitiesService extends Service {
  static inject = inject

  private readonly root: Context
  private readonly config: ActivityConfig
  private readonly account: AccountService

  constructor(ctx: Context, input?: Partial<ActivityConfig>) {
    super(ctx, 'clubActivities')
    this.root = ctx
    this.config = configOf(input)
    this.account = service<AccountService>(ctx, 'dsnAccount')
    this.registerRpc()
    ctx.inject(['tools'], scope => registerClubAgentTools(scope, (endpoint, payload, signal) => this.dispatch(endpoint, payload, signal)))
    ctx.inject(['skills'], scope => registerClubSkill(scope))
  }

  private requireAccountIntegration(): void {
    if (this.account.extensionApiVersion !== 1 ||
      typeof this.account.getStatus !== 'function' ||
      typeof this.account.getClubPortalAuthorization !== 'function' ||
      typeof this.account.beginClubPortalAuthorization !== 'function' ||
      typeof this.account.fetchClubPortal !== 'function') {
      throw new Error('请先更新 e宝工坊内的 CQAI Club 基础插件，当前版本尚不支持俱乐部扩展。')
    }
  }

  async snapshot(): Promise<ActivitySnapshot> {
    try { this.requireAccountIntegration() }
    catch (error) { return { state: 'error', message: error instanceof Error ? error.message : 'CQAI Club 基础插件需要更新' } }
    const status = await this.account.getStatus()
    if (status.state === 'authorizing') {
      return { state: 'authorizing', authorizationUrl: status.authorizationUrl, message: '请在浏览器中完成 CQAI Club 登录。' }
    }
    if (status.state === 'reauth-required') {
      return { state: 'reauth-required', message: 'CQAI Club 登录已失效，请重新登录。' }
    }
    const authorization = await this.account.getClubPortalAuthorization()
    if (authorization === 'signed-out') return { state: 'signed-out', message: '请先登录 CQAI Club。' }
    if (authorization === 'reauth-required') {
      return { state: 'reauth-required', message: '当前登录需要更新门户授权，请重新登录一次 CQAI Club。' }
    }
    const displayName = status.account?.displayName ?? status.account?.username
    try {
      const response = await this.account.fetchClubPortal('/api/v1/manage/activities', { method: 'GET' })
      await response.body?.cancel()
      if (response.status === 401) return { state: 'reauth-required', message: '门户登录已失效，请重新登录 CQAI Club。' }
      return { state: 'signed-in', displayName, canManage: response.ok }
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'DSN_REAUTH_REQUIRED') {
        return { state: 'reauth-required', message: 'CQAI Club 登录已失效，请重新登录。' }
      }
      const current = await this.account.getClubPortalAuthorization().catch(() => undefined)
      if (current === 'signed-out') return { state: 'signed-out', message: '请先登录 CQAI Club。' }
      if (current === 'reauth-required') return { state: 'reauth-required', message: '当前登录需要更新门户授权，请重新登录一次 CQAI Club。' }
      return { state: 'signed-in', displayName, canManage: false, message: '暂时无法验证活动管理权限。' }
    }
  }

  private async startAuthorization(): Promise<ActivitySnapshot> {
    this.requireAccountIntegration()
    const result = await this.account.beginClubPortalAuthorization()
    if (result.state === 'authorizing') {
      return { state: 'authorizing', authorizationUrl: result.authorizationUrl, message: '请在浏览器中完成 CQAI Club 登录。' }
    }
    return this.snapshot()
  }

  private async fetchPublic(path: `/api/v1/${string}`, signal?: AbortSignal): Promise<Response> {
    const url = new URL(path, this.config.portalUrl)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: signal ?? AbortSignal.timeout(15_000),
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('连接活动服务超时，请检查门户地址或网络连接。')
      throw new Error('无法连接活动服务，请检查门户地址或网络连接。')
    }
    return response
  }

  private async api(path: `/api/v1/${string}`, method = 'GET', body?: unknown, auth = true, signal?: AbortSignal): Promise<unknown> {
    if (auth) this.requireAccountIntegration()
    const init: RequestInit = { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) }
    const response = auth
      ? await this.account.fetchClubPortal(path, init, signal)
      : await this.fetchPublic(path, signal)
    if (!response.ok) {
      let message = response.status === 404
        ? '当前门户尚未提供所需的俱乐部接口，请检查服务地址或部署版本。'
        : `俱乐部服务暂时不可用（HTTP ${response.status}）`
      try {
        const data: unknown = await response.json()
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') message = data.error
      } catch { /* Keep the HTTP status-specific error. */ }
      throw Object.assign(new Error(message), { status: response.status })
    }
    if (response.status === 204) return null
    return response.json()
  }

  private async dispatch(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    switch (endpoint) {
      case 'auth/snapshot': return this.snapshot()
      case 'auth/start': return this.startAuthorization()
      case 'public/list': return this.api('/api/v1/activities?limit=100', 'GET', undefined, false, signal)
      case 'public/get': return this.api(`/api/v1/activities/${pathId(data.id)}`, 'GET', undefined, false, signal)
      case 'me/list': return this.api('/api/v1/me/activity-registrations', 'GET', undefined, true, signal)
      case 'manage/list': return this.api(`/api/v1/manage/activities?page=${managePage(data.page ?? 1)}&limit=20`, 'GET', undefined, true, signal)
      case 'manage/registrations': return this.api(`/api/v1/activities/${pathId(data.id)}/registrations`, 'GET', undefined, true, signal)
      case 'activity/create': return this.api('/api/v1/activities', 'POST', data.input, true, signal)
      case 'activity/update': return this.api(`/api/v1/activities/${pathId(data.id)}`, 'PATCH', data.input, true, signal)
      case 'activity/publish': return this.api(`/api/v1/activities/${pathId(data.id)}/publish`, 'POST', undefined, true, signal)
      case 'activity/cancel': return this.api(`/api/v1/activities/${pathId(data.id)}/cancel`, 'POST', undefined, true, signal)
      case 'activity/delete': return this.api(`/api/v1/activities/${pathId(data.id)}`, 'DELETE', undefined, true, signal)
      case 'registration/create': return this.api(`/api/v1/activities/${pathId(data.id)}/registration`, 'POST', undefined, true, signal)
      case 'registration/delete': return this.api(`/api/v1/activities/${pathId(data.id)}/registration`, 'DELETE', undefined, true, signal)
      case 'submissions/list': return this.api('/api/v1/me/plugin-submissions', 'GET', undefined, true, signal)
      case 'submissions/create': return this.api('/api/v1/plugin-submissions', 'POST', data.input as PluginSubmissionInput, true, signal)
      default: throw new Error('未知的活动操作')
    }
  }

  private registerRpc(): void {
    const handler = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> => {
      try { return rpcOk(await this.dispatch(endpoint, payload, signal)) } catch (error) { return rpcFail(error) }
    }
    // In rc.2 Connection owns the public RPC route from the webServer scope.
    this.root.inject(['webServer'], scope => {
      const connection = this.root.connection as OwnerConnection
      if (typeof connection.register === 'function') { connection.register(scope, RPC_CHANNEL, handler); return }
      const dispose = this.root.connection.rpc.handle(RPC_CHANNEL, handler)
      scope.effect(() => () => { void dispose() }, 'cqaiclub-extension: rpc')
    })
  }
}

export function apply(ctx: Context, config?: Partial<ActivityConfig>): void {
  new ActivitiesService(ctx, config)
  ctx.plugin(ClubMcpService, { enabled: config?.mcpEnabled })
}
