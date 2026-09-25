import { createHash, randomBytes } from 'node:crypto'

import { assertHttpUrl } from './config.ts'
import { DsnAccountError } from './errors.ts'

export type OidcDiscovery = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  revocationEndpoint?: string
}

export type TokenResponse = {
  accessToken: string
  expiresIn: number
  refreshToken?: string
  scope?: string
}

export type AuthorizationRequest = {
  authorizationUrl: string
  state: string
  codeVerifier: string
  expiresAt: number
}

export const Prompt = {
  Login: 'login',
  LoginConsent: 'login consent',
} as const

export type AuthorizationRequestOptions = {
  prompt?: (typeof Prompt)[keyof typeof Prompt]
}

type OidcClientOptions = {
  issuer: string
  clientId: string
  resource: string
  scopes: readonly string[]
  timeoutMs: number
  fetchImpl?: typeof fetch
}

type JsonObject = Record<string, unknown>

export class OidcClient {
  private readonly issuer: URL
  private readonly clientId: string
  private readonly resource: string
  private readonly scopes: readonly string[]
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private discoveryPromise?: Promise<OidcDiscovery>

  constructor(options: OidcClientOptions) {
    this.issuer = assertHttpUrl(options.issuer, 'issuer')
    this.clientId = options.clientId
    this.resource = options.resource
    this.scopes = options.scopes
    this.timeoutMs = options.timeoutMs
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async discovery(signal?: AbortSignal): Promise<OidcDiscovery> {
    if (this.discoveryPromise === undefined) {
      this.discoveryPromise = this.fetchDiscovery(signal).catch((error: unknown) => {
        this.discoveryPromise = undefined
        throw error
      })
    }
    return this.discoveryPromise
  }

  async createAuthorizationRequest(
    redirectUri: string,
    options: AuthorizationRequestOptions = {},
    signal?: AbortSignal,
  ): Promise<AuthorizationRequest> {
    const discovery = await this.discovery(signal)
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const authorizationUrl = new URL(discovery.authorizationEndpoint)
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: this.scopes.join(' '),
      resource: this.resource,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    }).toString()
    return {
      authorizationUrl: authorizationUrl.toString(),
      state,
      codeVerifier,
      expiresAt: Date.now() + 600_000,
    }
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string, codeVerifier: string, signal?: AbortSignal): Promise<TokenResponse> {
    const discovery = await this.discovery(signal)
    const response = await this.request(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        code_verifier: codeVerifier,
        resource: this.resource,
      }),
    }, signal)
    const data = await this.readJson(response)
    if (!response.ok) throw oauthHttpError(response.status, data, '无法完成 CQAI Club 登录')
    return parseTokenResponse(data)
  }

  async refreshAccessToken(refreshToken: string, signal?: AbortSignal): Promise<TokenResponse> {
    const discovery = await this.discovery(signal)
    const response = await this.request(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        resource: this.resource,
      }),
    }, signal)
    const data = await this.readJson(response)
    if (!response.ok) throw oauthHttpError(response.status, data, 'CQAI Club 登录已失效', true)
    return parseTokenResponse(data)
  }

  async revoke(token: string, tokenTypeHint: 'refresh_token' | 'access_token', signal?: AbortSignal): Promise<boolean> {
    const discovery = await this.discovery(signal)
    if (discovery.revocationEndpoint === undefined) return false
    const response = await this.request(discovery.revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token,
        token_type_hint: tokenTypeHint,
        client_id: this.clientId,
      }),
    }, signal)
    return response.ok
  }

  private async fetchDiscovery(signal?: AbortSignal): Promise<OidcDiscovery> {
    const discoveryUrl = new URL(`${this.issuer.toString().replace(/\/$/u, '')}/.well-known/openid-configuration`)
    const response = await this.request(discoveryUrl.toString(), { method: 'GET' }, signal)
    const data = await this.readJson(response)
    if (!response.ok) throw oauthHttpError(response.status, data, '无法读取 CQAI Club 登录配置')

    const issuer = stringValue(data.issuer)
    const authorizationEndpoint = stringValue(data.authorization_endpoint)
    const tokenEndpoint = stringValue(data.token_endpoint)
    const revocationEndpoint = stringValue(data.revocation_endpoint)
    if (issuer === undefined || normalizeUrl(issuer) !== normalizeUrl(this.issuer.toString())) {
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club issuer 校验失败')
    }
    if (authorizationEndpoint === undefined || tokenEndpoint === undefined) {
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 未提供浏览器登录端点')
    }

    const validatedAuthorizationEndpoint = this.validateEndpoint(authorizationEndpoint)
    const validatedTokenEndpoint = this.validateEndpoint(tokenEndpoint)
    const validatedRevocationEndpoint = revocationEndpoint === undefined
      ? undefined
      : this.validateEndpoint(revocationEndpoint)
    return {
      issuer,
      authorizationEndpoint: validatedAuthorizationEndpoint,
      tokenEndpoint: validatedTokenEndpoint,
      ...(validatedRevocationEndpoint === undefined ? {} : { revocationEndpoint: validatedRevocationEndpoint }),
    }
  }

  private validateEndpoint(value: string): string {
    const endpoint = assertHttpUrl(value, 'OIDC endpoint')
    if (endpoint.origin !== this.issuer.origin) {
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'OIDC endpoint 不属于配置的 issuer')
    }
    return endpoint.toString()
  }

  private async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeout = createTimeoutSignal(signal, this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, signal: timeout.signal })
    } catch (error) {
      if (timeout.signal.aborted && !signal?.aborted) {
        throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', 'CQAI Club 请求超时', true, { cause: error })
      }
      if (signal?.aborted) throw error
      throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', '无法连接 CQAI Club', true, { cause: error })
    } finally {
      timeout.dispose()
    }
  }

  private async readJson(response: Response): Promise<JsonObject> {
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', 'CQAI Club 响应读取失败', true, { cause: error })
    }
    if (text.length > 1_048_576) {
      if (isRetryableStatus(response.status)) throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', 'CQAI Club 服务暂时不可用', true)
      throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 响应过大')
    }
    try {
      const value: unknown = JSON.parse(text)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject
    } catch {
      // The caller receives a stable protocol error instead of upstream text.
    }
    if (isRetryableStatus(response.status)) throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', 'CQAI Club 服务暂时不可用', true)
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club 返回了无效响应')
  }
}

function parseTokenResponse(value: JsonObject): TokenResponse {
  const accessToken = stringValue(value.access_token)
  const expiresIn = positiveInteger(value.expires_in)
  const refreshToken = stringValue(value.refresh_token)
  const scope = stringValue(value.scope)
  if (accessToken === undefined || expiresIn === undefined) {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', 'CQAI Club Token 响应不完整')
  }
  return {
    accessToken,
    expiresIn,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(scope === undefined ? {} : { scope }),
  }
}

function oauthHttpError(status: number, data: JsonObject, fallback: string, reauthOnInvalidGrant = false): DsnAccountError {
  const oauthCode = stringValue(data.error)
  if (reauthOnInvalidGrant && (oauthCode === 'invalid_grant' || oauthCode === 'invalid_token' || status === 401)) {
    return new DsnAccountError('DSN_REAUTH_REQUIRED', fallback, false)
  }
  const upstream = [oauthCode, stringValue(data.error_description)].filter(Boolean).join(': ')
  const message = upstream.length > 0 ? `${fallback}（${upstream}）` : fallback
  return new DsnAccountError(
    isRetryableStatus(status) ? 'DSN_ACCOUNT_UNAVAILABLE' : 'DSN_PROTOCOL_ERROR',
    message,
    isRetryableStatus(status),
  )
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/u, '')
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) controller.abort(parent.reason)
  else parent?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    },
  }
}
