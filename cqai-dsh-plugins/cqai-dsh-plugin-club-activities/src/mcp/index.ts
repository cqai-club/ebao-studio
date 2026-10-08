import { Service, type Context } from '@deepseek-ai/cordis'
import type { DsnAccountService, DsnResourceSession } from '@cqaiclub/dsn-account'
import type {} from '@deepseek-ai/dsh-settings'
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { ClubMcpClient } from './mcp-client.ts'
import { Config, configuredEnabled, type ClubMcpConfigInput } from './config.ts'
import { DEFAULT_CLUB_MCP_URL, RPC_CHANNEL, type ClubMcpStatus, type ClubMcpConnectRequest, type ClubMcpConfigureRequest, type ClubMcpAuthorizationResult } from './protocol.ts'

export { Config }
export type { ClubMcpStatus, ClubMcpState, ClubMcpConnectRequest, ClubMcpConfigureRequest, ClubMcpAuthorizationResult } from './protocol.ts'
export const name = 'cqaiclub-mcp'
export const inject = ['dsnAccount', 'connection', 'webServer', 'tools']
export const SETTINGS_NAMESPACE = 'cqaiclub-extension'

declare module '@deepseek-ai/cordis' {
  interface Context { clubMcp: ClubMcpService }
}

type InternalConnection = HostConnectionHandle & {
  register(owner: Context, channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>): unknown
}

export class ClubMcpService extends Service {
  static inject = inject
  private readonly root: Context
  private readonly resource: DsnResourceSession
  private readonly client: ClubMcpClient
  private enabled: boolean
  private disposed = false
  private generation = 0
  private connecting?: Promise<ClubMcpStatus>
  private connectionStatus: Pick<ClubMcpStatus, 'state' | 'toolCount' | 'message' | 'code'> = { state: 'disconnected', toolCount: 0 }

  constructor(ctx: Context, config?: ClubMcpConfigInput) {
    super(ctx, 'clubMcp')
    this.root = ctx
    const account = ctx.dsnAccount as DsnAccountService | undefined
    if (account?.extensionApiVersion !== 1 || typeof account.useResource !== 'function') {
      throw new Error('CQAI Club MCP 需要新版共享账号接口，请更新 e宝工坊后重新启用扩展。')
    }
    this.resource = account.useResource(ctx, { resource: DEFAULT_CLUB_MCP_URL, enabled: false })
    this.enabled = configuredEnabled(config) ?? this.resource.legacyEnabled
    this.resource.setActive(this.enabled)
    const client = new ClubMcpClient({
      ctx, timeoutMs: config?.requestTimeoutMs ?? 15_000,
      fetchImpl: (input, init) => {
        const target = input instanceof Request ? input.url : String(input)
        if (target !== DEFAULT_CLUB_MCP_URL || input instanceof Request) throw new ClubMcpError('DSN_CLIENT_FORBIDDEN', 'MCP 只能连接 CQAI Club 官网。')
        return this.resource.fetch(init, init?.signal ?? undefined)
      },
      onStatusChange: status => {
        if (!this.disposed && this.enabled && this.client === client) this.connectionStatus = status
      },
    })
    this.client = client
    const unsubscribe = this.resource.subscribe(event => {
      if (event.type === 'invalidated') void this.close()
      else if (this.enabled && !this.disposed) void this.connectClubMcp().catch(() => undefined)
    })
    ctx.effect(() => () => {
      this.disposed = true
      unsubscribe()
      this.resource.dispose()
      void this.close()
    }, 'cqaiclub-mcp: resource and tools')
    if (typeof ctx.inject === 'function') ctx.inject(['settings'], settingsCtx => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
    this.registerRpc()
    if (this.enabled) void this.connectClubMcp().catch(() => undefined)
  }

  async getClubMcpStatus(): Promise<ClubMcpStatus> {
    const generation = this.generation
    const base = { enabled: this.enabled, url: DEFAULT_CLUB_MCP_URL, toolCount: 0 }
    if (!this.enabled || this.disposed) return { ...base, state: 'disabled' }
    const auth = await this.resource.authorization()
    if (generation !== this.generation) return this.getClubMcpStatus()
    if (auth.state === 'signed-out') return { ...base, state: 'signed-out', message: '请先登录 CQAI Club。' }
    if (auth.state === 'reauth-required') return { ...base, state: 'reauth-required', message: '请补充授权，以连接官网 MCP。' }
    return { ...base, ...this.connectionStatus }
  }

  async configureClubMcp(request: ClubMcpConfigureRequest): Promise<ClubMcpStatus> {
    if (typeof request.enabled !== 'boolean') throw new ClubMcpError('DSN_PROTOCOL_ERROR', '官网 MCP 开关必须是布尔值。')
    const settings = typeof this.root.get === 'function' ? this.root.get('settings') : undefined
    if (settings === undefined) throw new ClubMcpError('DSN_CONFIG_INVALID', '当前配置服务不可用，无法保存官网 MCP 开关。')
    await settings.mutate(SETTINGS_NAMESPACE, [{ op: 'set', path: ['mcpEnabled'], value: request.enabled }])
    if (this.disposed) return this.getClubMcpStatus()
    this.enabled = request.enabled
    this.resource.setActive(request.enabled)
    await this.close()
    return this.getClubMcpStatus()
  }

  async connectClubMcp(signal?: AbortSignal, options: ClubMcpConnectRequest = {}): Promise<ClubMcpStatus> {
    if (this.connecting !== undefined && !this.disposed && this.enabled) return this.connecting
    const generation = this.generation
    const status = await this.getClubMcpStatus()
    if (this.connecting !== undefined && !this.disposed && this.enabled) return this.connecting
    if (generation !== this.generation || this.disposed) return this.getClubMcpStatus()
    if (['disabled', 'signed-out', 'reauth-required'].includes(status.state)) return status
    if (this.connecting !== undefined) return this.connecting
    if (!options.reconnect && status.state === 'connected') return status
    const connecting = (async () => {
      const auth = await this.resource.authorization()
      if (generation !== this.generation || this.disposed || !this.enabled || auth.state !== 'ready') return this.getClubMcpStatus()
      const connectionGeneration = generation + 1
      await this.close(true)
      if (connectionGeneration !== this.generation || this.disposed || !this.enabled) return this.getClubMcpStatus()
      const currentAuth = await this.resource.authorization()
      if (connectionGeneration !== this.generation || this.disposed || !this.enabled || currentAuth.state !== 'ready' || currentAuth.generation !== auth.generation) return this.getClubMcpStatus()
      this.connectionStatus = { state: 'connecting', toolCount: 0 }
      try {
        const { toolCount } = await this.client.connect(signal)
        if (connectionGeneration === this.generation && !this.disposed && this.enabled) this.connectionStatus = { state: 'connected', toolCount }
      } catch (error) {
        if (connectionGeneration === this.generation && !this.disposed && this.enabled && (this.connectionStatus.state !== 'error' || this.connectionStatus.code === undefined)) {
          this.connectionStatus = { state: 'error', toolCount: 0, code: errorDetails(error).code, message: errorDetails(error, '官网 MCP 连接失败，请重试。').message }
        }
      }
      return this.getClubMcpStatus()
    })()
    this.connecting = connecting
    try { return await connecting } finally { if (this.connecting === connecting) this.connecting = undefined }
  }

  async beginClubMcpAuthorization(signal?: AbortSignal): Promise<ClubMcpAuthorizationResult> {
    if (!this.enabled || this.disposed) throw new ClubMcpError('DSN_CONFIG_INVALID', '请先启用官网 MCP。')
    const snapshot = await this.resource.authorize(signal)
    return { snapshot, mcp: await this.getClubMcpStatus() }
  }

  private async close(keepConnecting = false): Promise<void> {
    this.generation += 1
    this.connectionStatus = { state: 'disconnected', toolCount: 0 }
    if (!keepConnecting) this.connecting = undefined
    await this.client.close()
  }

  private registerRpc(): void {
    const handler = (endpoint: string, payload: unknown, signal: AbortSignal) => this.handleRpc(endpoint, payload, signal)
    const register = (owner: Context) => {
      const connection = this.root.connection as unknown as InternalConnection
      if (typeof connection.register === 'function') { connection.register(owner, RPC_CHANNEL, handler); return }
      const dispose = connection.rpc.handle(RPC_CHANNEL, handler)
      owner.effect(() => () => { void dispose() }, 'cqaiclub-mcp: rpc')
    }
    if (typeof this.root.inject === 'function') this.root.inject(['webServer'], register)
    else register(this.root)
  }

  private async handleRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    try {
      switch (endpoint) {
        case 'mcp/status': return { ok: true, value: await this.getClubMcpStatus() }
        case 'mcp/configure': {
          if (!isObject(payload) || Object.keys(payload).some(key => key !== 'enabled') || typeof payload.enabled !== 'boolean') throw new ClubMcpError('DSN_PROTOCOL_ERROR', '官网 MCP 配置只接受启用开关。')
          return { ok: true, value: await this.configureClubMcp({ enabled: payload.enabled }) }
        }
        case 'mcp/connect': {
          if (payload !== undefined && (!isObject(payload) || Object.keys(payload).some(key => key !== 'reconnect') || (payload.reconnect !== undefined && typeof payload.reconnect !== 'boolean'))) throw new ClubMcpError('DSN_PROTOCOL_ERROR', '官网 MCP 重连参数无效。')
          return { ok: true, value: await this.connectClubMcp(signal, (payload ?? {}) as ClubMcpConnectRequest) }
        }
        case 'mcp/authorize': return { ok: true, value: await this.beginClubMcpAuthorization(signal) }
        default: throw new ClubMcpError('DSN_PROTOCOL_ERROR', '未知的 CQAI Club MCP RPC 操作。')
      }
    } catch (error) {
      return { ok: false, error: { code: errorDetails(error).code, message: errorDetails(error).message, details: { retryable: errorDetails(error).retryable } } }
    }
  }
}
class ClubMcpError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message) }
}
function errorDetails(error: unknown, fallback = '官网 MCP 请求失败，请重试。'): { code: string; message: string; retryable: boolean } {
  // Account errors cross a Host service boundary; no Account runtime is bundled.
  if (isObject(error) && typeof error.code === 'string' && /^DSN_[A-Z_]+$/u.test(error.code) && typeof error.message === 'string') {
    return { code: error.code, message: error.message, retryable: error.retryable === true }
  }
  return { code: 'DSN_ACCOUNT_UNAVAILABLE', message: fallback, retryable: false }
}
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export default ClubMcpService
