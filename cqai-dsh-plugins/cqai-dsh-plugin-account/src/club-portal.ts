import { assertHttpUrl } from './config.ts'
import { DsnAccountError } from './errors.ts'

const activityId = '[A-Za-z0-9_-]{1,128}'
const routes: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/v1\/activities$/u },
  { method: 'GET', path: new RegExp(`^/api/v1/activities/${activityId}$`, 'u') },
  { method: 'GET', path: new RegExp(`^/api/v1/activities/${activityId}/registrations$`, 'u') },
  { method: 'GET', path: /^\/api\/v1\/me\/activity-registrations$/u },
  { method: 'GET', path: /^\/api\/v1\/manage\/activities$/u },
  { method: 'POST', path: /^\/api\/v1\/activities$/u },
  { method: 'PATCH', path: new RegExp(`^/api/v1/activities/${activityId}$`, 'u') },
  { method: 'DELETE', path: new RegExp(`^/api/v1/activities/${activityId}$`, 'u') },
  { method: 'POST', path: new RegExp(`^/api/v1/activities/${activityId}/publish$`, 'u') },
  { method: 'POST', path: new RegExp(`^/api/v1/activities/${activityId}/cancel$`, 'u') },
  { method: 'POST', path: new RegExp(`^/api/v1/activities/${activityId}/registration$`, 'u') },
  { method: 'DELETE', path: new RegExp(`^/api/v1/activities/${activityId}/registration$`, 'u') },
  { method: 'POST', path: /^\/api\/v1\/plugin-submissions$/u },
  { method: 'GET', path: /^\/api\/v1\/me\/plugin-submissions$/u },
]

export class ClubPortalClient {
  private readonly origin: string

  constructor(baseUrl: string, private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 15_000) {
    const parsed = assertHttpUrl(baseUrl, 'clubPortalUrl')
    if (parsed.pathname !== '/') throw new Error('clubPortalUrl must use the origin root')
    this.origin = parsed.origin
  }

  async request(path: `/api/v1/${string}`, accessToken: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    const limitedActivityList = method === 'GET' && /^\/api\/v1\/activities\?limit=(?:[1-9][0-9]?|100)$/u.test(path)
    const pagedManagedActivities = method === 'GET'
      && /^\/api\/v1\/manage\/activities\?page=(?:[1-9][0-9]{0,5}|1000000)&limit=20$/u.test(path)
    if (!limitedActivityList && !pagedManagedActivities && !routes.some(route => route.method === method && route.path.test(path))) {
      throw new DsnAccountError('DSN_CLIENT_FORBIDDEN', '该俱乐部接口不允许由插件调用。')
    }

    let body: string | undefined
    if (init.body !== undefined && init.body !== null) {
      if (!['POST', 'PATCH'].includes(method) || typeof init.body !== 'string' || init.body.length > 65_536) {
        throw new DsnAccountError('DSN_CLIENT_FORBIDDEN', '俱乐部请求内容不符合要求。')
      }
      try {
        const parsed: unknown = JSON.parse(init.body)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      } catch {
        throw new DsnAccountError('DSN_CLIENT_FORBIDDEN', '俱乐部请求必须是 JSON 对象。')
      }
      body = init.body
    }
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    try {
      return await this.fetchImpl(`${this.origin}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
        credentials: 'omit',
        redirect: 'error',
        signal: requestSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', '俱乐部服务暂时不可用。', true, { cause: error })
    }
  }
}

export function tokenHasAudience(accessToken: string, resource: string): boolean {
  const encoded = accessToken.split('.')[1]
  if (!encoded) return false
  try {
    const claims: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (claims === null || typeof claims !== 'object' || !('aud' in claims)) return false
    const audience = claims.aud
    return audience === resource || Array.isArray(audience) && audience.includes(resource)
  } catch {
    return false
  }
}
