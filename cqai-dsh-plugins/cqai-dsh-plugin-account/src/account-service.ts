import { DsnAccountError } from './errors.ts'
import {
  type DsnTopUpHistory,
  type DsnTopUpInfo,
  type DsnTopUpListOptions,
  type DsnTopUpOption,
  type DsnTopUpRecord,
  type DsnTopUpRequest,
  type DsnTopUpResult,
  isPublicAccount,
  parseDsnModelList,
  type DsnModel,
  type PublicAccount,
} from './protocol.ts'

export class AccountServiceError extends DsnAccountError {
  readonly name = 'AccountServiceError'

  constructor(
    code: ConstructorParameters<typeof DsnAccountError>[0],
    message: string,
    readonly status: number,
    retryable = false,
  ) {
    super(code, message, retryable)
  }
}

export class AccountServiceClient {
  private readonly baseUrl: URL
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000) {
    const parsed = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('accountServiceUrl must be an HTTP(S) URL without credentials, query, or hash')
    }
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('accountServiceUrl may use HTTP only on localhost')
    }
    this.baseUrl = parsed
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async getAccount(accessToken: string, signal?: AbortSignal): Promise<PublicAccount> {
    const response = await this.request('/api/account', accessToken, { method: 'GET' }, signal)
    let data: Record<string, unknown>
    try {
      data = await this.readJson(response)
    } catch (error) {
      if (!response.ok && (response.status === 401 || isRetryableStatus(response.status))) {
        throw this.errorFor(response.status, {}, '读取 CQAI Club 账号失败')
      }
      throw error
    }
    if (!response.ok) throw this.errorFor(response.status, data, '读取 CQAI Club 账号失败')
    if (data.success !== true || !isPublicAccount(data.data)) {
      throw new AccountServiceError('DSN_PROTOCOL_ERROR', 'Account Service 返回了无效账号', response.status)
    }
    return data.data
  }

  async getModels(accessToken: string, signal?: AbortSignal): Promise<readonly DsnModel[]> {
    const response = await this.request('/v1/models', accessToken, { method: 'GET' }, signal)
    let data: Record<string, unknown>
    try {
      data = await this.readJson(response)
    } catch (error) {
      if (!response.ok && (response.status === 401 || isRetryableStatus(response.status))) {
        throw this.errorFor(response.status, {}, '读取 CQAI Club 模型失败')
      }
      throw error
    }
    if (!response.ok) throw this.errorFor(response.status, data, '读取 CQAI Club 模型失败')
    if (data.success !== true) {
      throw new AccountServiceError('DSN_PROTOCOL_ERROR', 'Account Service 返回了无效模型响应', response.status)
    }
    try {
      return parseDsnModelList(data.data)
    } catch (error) {
      throw new AccountServiceError(
        'DSN_PROTOCOL_ERROR',
        error instanceof Error ? error.message : 'Account Service 返回了无效模型列表',
        response.status,
      )
    }
  }

  async getTopUpInfo(accessToken: string, signal?: AbortSignal): Promise<DsnTopUpInfo> {
    const data = await this.requestJson('/api/billing/topup/info', accessToken, { method: 'GET' }, signal, '读取 CQAI Club 充值配置失败')
    if (data.success !== true) throw this.protocolError('Account Service 返回了无效充值配置')
    return parseDsnTopUpInfo(data.data)
  }

  async listTopUps(
    accessToken: string,
    options: DsnTopUpListOptions = {},
    signal?: AbortSignal,
  ): Promise<DsnTopUpHistory> {
    const query = new URLSearchParams()
    if (isPositiveInteger(options.page)) query.set('page', String(options.page))
    if (isPositiveInteger(options.pageSize)) query.set('page_size', String(options.pageSize))
    const keyword = typeof options.keyword === 'string' ? options.keyword.trim().slice(0, 128) : ''
    if (keyword) query.set('keyword', keyword)
    const path = `/api/billing/topups${query.toString() ? `?${query.toString()}` : ''}`
    const data = await this.requestJson(path, accessToken, { method: 'GET' }, signal, '读取 CQAI Club 充值记录失败')
    if (data.success !== true) throw this.protocolError('Account Service 返回了无效充值记录')
    return parseDsnTopUpHistory(data.data)
  }

  async createTopUp(accessToken: string, request: DsnTopUpRequest, signal?: AbortSignal): Promise<DsnTopUpResult> {
    const body: Record<string, unknown> = {
      payment_option_id: request.paymentOptionId,
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      ...(request.productId === undefined ? {} : { product_id: request.productId }),
      ...(request.choiceId === undefined ? {} : { choice_id: request.choiceId }),
    }
    const data = await this.requestJson('/api/billing/topups', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, signal, '创建 CQAI Club 充值订单失败')
    if (data.success !== true) throw this.protocolError('Account Service 返回了无效充值订单')
    return parseDsnTopUpResult(data.data)
  }

  async fetchAi(accessToken: string, path: `/v1/${string}`, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const url = this.resolvePath(path)
    const headers = new Headers(init.headers)
    headers.delete('authorization')
    headers.delete('origin')
    headers.delete('cookie')
    headers.set('Authorization', `Bearer ${accessToken}`)
    return this.fetchImpl(url, {
      ...init,
      headers,
      credentials: 'omit',
      signal,
    })
  }

  private async request(path: string, accessToken: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeout = createTimeoutSignal(signal, this.timeoutMs)
    try {
      return await this.fetchImpl(this.resolvePath(path), {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'omit',
        signal: timeout.signal,
      })
    } catch (error) {
      if (timeout.signal.aborted && !signal?.aborted) {
        throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', 'Account Service 请求超时', true, { cause: error })
      }
      if (signal?.aborted) throw error
      throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', '无法连接 Account Service', true, { cause: error })
    } finally {
      timeout.dispose()
    }
  }

  private async requestJson(
    path: string,
    accessToken: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    fallback: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(path, accessToken, init, signal)
    let data: Record<string, unknown>
    try {
      data = await this.readJson(response)
    } catch (error) {
      if (!response.ok && (response.status === 401 || isRetryableStatus(response.status))) {
        throw this.errorFor(response.status, {}, fallback)
      }
      throw error
    }
    if (!response.ok) throw this.errorFor(response.status, data, fallback)
    return data
  }

  private resolvePath(path: string): string {
    const isAiPath = path.startsWith('/v1/')
    const isBillingPath = path.startsWith('/api/billing/')
    if (!isAiPath && !isBillingPath && path !== '/api/account') throw new Error('Account Service path is not allowed')
    const url = new URL(path, this.baseUrl)
    if (url.origin !== this.baseUrl.origin) throw new Error('Account Service path escaped configured origin')
    if (isAiPath && !url.pathname.startsWith('/v1/')) throw new Error('Account Service path is not allowed')
    if (isBillingPath && !url.pathname.startsWith('/api/billing/')) throw new Error('Account Service path is not allowed')
    if (path === '/api/account' && url.pathname !== '/api/account') throw new Error('Account Service path is not allowed')
    return url.toString()
  }

  private protocolError(message: string): AccountServiceError {
    return new AccountServiceError('DSN_PROTOCOL_ERROR', message, 200)
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text()
    if (text.length > 1_048_576) throw new AccountServiceError('DSN_PROTOCOL_ERROR', 'Account Service 响应过大', response.status)
    try {
      const value: unknown = JSON.parse(text)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      // Convert all malformed upstream responses into a stable error below.
    }
    throw new AccountServiceError('DSN_PROTOCOL_ERROR', 'Account Service 返回了无效响应', response.status)
  }

  private errorFor(status: number, data: Record<string, unknown>, fallback: string): AccountServiceError {
    const upstreamCode = typeof data.code === 'string' ? data.code : undefined
    if (status === 401 || upstreamCode === 'AUTH_TOKEN_INVALID' || upstreamCode === 'AUTH_TOKEN_REQUIRED') {
      return new AccountServiceError('DSN_REAUTH_REQUIRED', 'CQAI Club 登录已失效', status)
    }
    if (status === 403 && upstreamCode === 'AUTH_CLIENT_FORBIDDEN') {
      return new AccountServiceError('DSN_CLIENT_FORBIDDEN', 'CQAI Club 尚未允许此 DSH 客户端', status)
    }
    if (status === 403 && upstreamCode === 'AUTH_SCOPE_FORBIDDEN') {
      return new AccountServiceError('DSN_SCOPE_FORBIDDEN', '当前账号没有 CQAI Club AI 使用权限', status)
    }
    return new AccountServiceError(
      isRetryableStatus(status) ? 'DSN_ACCOUNT_UNAVAILABLE' : 'DSN_PROTOCOL_ERROR',
      typeof data.message === 'string' ? data.message : fallback,
      status,
      isRetryableStatus(status),
    )
  }
}

function parseDsnTopUpInfo(value: unknown): DsnTopUpInfo {
  const record = asRecord(value)
  if (record === undefined || !Array.isArray(record.payment_options) || !Array.isArray(record.amount_options)) {
    throw new AccountServiceError('DSN_PROTOCOL_ERROR', 'Account Service 返回了无效充值配置', 200)
  }
  const paymentOptions = record.payment_options.map((item, index) => parseDsnTopUpOption(item, index))
  const amountOptions = record.amount_options.map((item, index) => requiredNumber(item, `充值金额档位 ${index}`))
  const minTopUp = optionalNumber(record.min_top_up)
  return {
    paymentOptions,
    amountOptions,
    ...(minTopUp === undefined ? {} : { minTopUp }),
  }
}

function parseDsnTopUpOption(value: unknown, index: number) {
  const record = asRecord(value)
  const id = requiredText(record?.id, `充值方式 ${index} 缺少 id`)
  const name = requiredText(record?.name, `充值方式 ${id} 缺少名称`)
  if (record?.kind !== 'amount' && record?.kind !== 'product') {
    throw new AccountServiceError('DSN_PROTOCOL_ERROR', `充值方式 ${id} 的类型无效`, 200)
  }
  const kind: DsnTopUpOption['kind'] = record.kind
  const choices = parseChoiceList(record.choices, id)
  const products = parseProductList(record.products, id)
  const minTopUp = optionalNumber(record.min_top_up)
  return {
    id,
    name,
    kind,
    ...(minTopUp === undefined ? {} : { minTopUp }),
    ...(choices === undefined ? {} : { choices }),
    ...(products === undefined ? {} : { products }),
  }
}

function parseDsnTopUpHistory(value: unknown): DsnTopUpHistory {
  const record = asRecord(value)
  if (record === undefined || !Array.isArray(record.items)) {
    throw new AccountServiceError('DSN_PROTOCOL_ERROR', 'Account Service 返回了无效充值记录', 200)
  }
  return {
    page: positiveOrDefault(record.page, 1),
    pageSize: positiveOrDefault(record.page_size, 10),
    total: nonNegativeOrDefault(record.total, 0),
    items: record.items.map((item, index) => parseDsnTopUpRecord(item, index)),
  }
}

function parseDsnTopUpRecord(value: unknown, index: number): DsnTopUpRecord {
  const record = asRecord(value)
  if (record === undefined) throw new AccountServiceError('DSN_PROTOCOL_ERROR', `充值记录 ${index} 无效`, 200)
  return {
    ...(optionalInteger(record.id) === undefined ? {} : { id: optionalInteger(record.id) }),
    ...(optionalNumber(record.amount) === undefined ? {} : { amount: optionalNumber(record.amount) }),
    ...(optionalNumber(record.money) === undefined ? {} : { money: optionalNumber(record.money) }),
    ...(optionalText(record.trade_no) === undefined ? {} : { tradeNo: optionalText(record.trade_no) }),
    ...(optionalText(record.payment_method) === undefined ? {} : { paymentMethod: optionalText(record.payment_method) }),
    ...(optionalText(record.payment_provider) === undefined ? {} : { paymentProvider: optionalText(record.payment_provider) }),
    ...(optionalNumber(record.create_time) === undefined ? {} : { createTime: optionalNumber(record.create_time) }),
    ...(optionalNumber(record.complete_time) === undefined ? {} : { completeTime: optionalNumber(record.complete_time) }),
    ...(optionalText(record.status) === undefined ? {} : { status: optionalText(record.status) }),
  }
}

function parseDsnTopUpResult(value: unknown): DsnTopUpResult {
  const record = asRecord(value)
  if (record === undefined) return {}
  const paymentUrl = optionalText(record.payment_url)
  const orderId = optionalText(record.order_id)
  const paymentFields = parsePaymentFields(record.payment_fields)
  return {
    ...(paymentUrl === undefined ? {} : { paymentUrl }),
    ...(paymentFields === undefined ? {} : { paymentFields }),
    ...(orderId === undefined ? {} : { orderId }),
  }
}

function parseChoiceList(value: unknown, optionId: string): readonly { id: string; name: string }[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new AccountServiceError('DSN_PROTOCOL_ERROR', `充值方式 ${optionId} 的选项无效`, 200)
  return value.map((item, index) => {
    const record = asRecord(item)
    return {
      id: requiredText(record?.id, `充值方式 ${optionId} 的选项 ${index} 无效`),
      name: requiredText(record?.name, `充值方式 ${optionId} 的选项 ${index} 无效`),
    }
  })
}

function parseProductList(value: unknown, optionId: string) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new AccountServiceError('DSN_PROTOCOL_ERROR', `充值方式 ${optionId} 的套餐无效`, 200)
  return value.map((item, index) => {
    const record = asRecord(item)
    return {
      id: requiredText(record?.id, `充值方式 ${optionId} 的套餐 ${index} 无效`),
      name: requiredText(record?.name, `充值方式 ${optionId} 的套餐 ${index} 无效`),
      price: requiredNumber(record?.price, `充值方式 ${optionId} 的套餐 ${index} 无效`),
      currency: requiredText(record?.currency, `充值方式 ${optionId} 的套餐 ${index} 无效`),
      quota: requiredNumber(record?.quota, `充值方式 ${optionId} 的套餐 ${index} 无效`),
    }
  })
}

function parsePaymentFields(value: unknown): Readonly<Record<string, string>> | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const fields: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') fields[key] = item
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function requiredText(value: unknown, message: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new AccountServiceError('DSN_PROTOCOL_ERROR', message, 200)
  return text
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function requiredNumber(value: unknown, message: string): number {
  const number = optionalNumber(value)
  if (number === undefined) throw new AccountServiceError('DSN_PROTOCOL_ERROR', message, 200)
  return number
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function optionalInteger(value: unknown): number | undefined {
  const number = optionalNumber(value)
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined
}

function positiveOrDefault(value: unknown, fallback: number): number {
  const number = optionalInteger(value)
  return number !== undefined && number > 0 ? number : fallback
}

function nonNegativeOrDefault(value: unknown, fallback: number): number {
  const number = optionalInteger(value)
  return number !== undefined && number >= 0 ? number : fallback
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
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
