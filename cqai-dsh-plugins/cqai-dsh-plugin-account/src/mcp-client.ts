import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Client, InsufficientScopeError, ProtocolError, SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError, type Tool } from '@modelcontextprotocol/client'
import { DEFAULT_CLUB_MCP_URL } from './protocol.ts'

export interface ClubMcpClientUpdate {
  state: 'connected' | 'error'
  toolCount: number
  message?: string
  code?: string
}

export interface ClubMcpClientOptions {
  ctx: Context
  /** The product owns this endpoint; arbitrary MCP URLs are not accepted. */
  url?: string
  /** Host-only account proxy; owns bearer tokens and the single 401 refresh. */
  fetchImpl: typeof fetch
  timeoutMs: number
  onStatusChange?: (update: ClubMcpClientUpdate) => void
}

interface Connection {
  client: Client
  transport: StreamableHTTPClientTransport
  controller: AbortController
  ready: Promise<{ toolCount: number }>
  sync: Promise<void>
  disposers: Map<string, () => void>
  closing: boolean
  connected: boolean
}

/** Connect the first-party MCP service to the real Host tool registry. */
export class ClubMcpClient {
  private current?: Connection
  private readonly options: ClubMcpClientOptions

  constructor(options: ClubMcpClientOptions) {
    if ((options.url ?? DEFAULT_CLUB_MCP_URL) !== DEFAULT_CLUB_MCP_URL) {
      throw new Error('CQAI Club MCP 仅支持连接官网')
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('CQAI Club MCP 请求超时配置无效')
    }
    this.options = options
  }

  async connect(signal?: AbortSignal): Promise<{ toolCount: number }> {
    signal?.throwIfAborted()
    if (this.current !== undefined) return this.current.ready
    const controller = new AbortController()
    const sessionSignal = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    const cancelConnect = () => { controller.abort(signal?.reason) }
    signal?.addEventListener('abort', cancelConnect, { once: true })
    let connection: Connection
    const client = new Client({ name: 'ebao-cqai-club', version: '0.1.0' }, {
      capabilities: {},
      versionNegotiation: { mode: 'auto' },
      listChanged: {
        tools: {
          autoRefresh: false,
          debounceMs: 0,
          onChanged: () => {
            if (!this.isCurrent(connection)) return
            void this.queueSync(connection).catch((error: unknown) => this.fail(connection, error))
          },
        },
      },
    })
    const transport = new StreamableHTTPClientTransport(new URL(DEFAULT_CLUB_MCP_URL), {
      // Authentication is performed only inside the account proxy. The SDK has
      // no OAuth provider, so it cannot create a second refresh/retry loop.
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url !== DEFAULT_CLUB_MCP_URL) throw new Error('CQAI Club MCP 请求地址无效')
        const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        const combinedSignal = requestSignal == null
          ? controller.signal
          : AbortSignal.any([controller.signal, requestSignal])
        const response = await this.options.fetchImpl(input, { ...init, signal: combinedSignal, redirect: 'error', credentials: 'omit' })
        if (response.redirected || (response.status >= 300 && response.status < 400)
          || (response.url !== '' && response.url !== DEFAULT_CLUB_MCP_URL)) {
          throw new Error('CQAI Club MCP 拒绝重定向响应')
        }
        return response
      },
      // Explicit reconnection belongs to the account/UI lifecycle. Do not replay
      // an operation after a network failure whose remote outcome is unknown.
      reconnectionOptions: {
        maxRetries: 0, maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1,
      },
    })
    connection = {
      client, transport, controller,
      ready: Promise.resolve({ toolCount: 0 }),
      sync: Promise.resolve(), disposers: new Map(), closing: false, connected: false,
    }
    this.current = connection
    client.onclose = () => {
      if (this.isCurrent(connection)) void this.fail(connection, new Error('MCP connection closed'))
    }
    client.onerror = (error) => {
      // During initialization the SDK may reject a modern discovery probe and
      // negotiate the legacy protocol. The awaited handshake owns those errors.
      if (connection.connected && this.isCurrent(connection) && disconnectsConnection(error)) void this.fail(connection, error)
    }
    connection.ready = this.start(connection, sessionSignal).finally(() => signal?.removeEventListener('abort', cancelConnect))
    return connection.ready
  }

  /** Logout/disable removes tools synchronously, before awaiting socket cleanup. */
  async close(): Promise<void> {
    const connection = this.current
    if (connection === undefined) return
    this.current = undefined
    await this.release(connection)
  }

  private isCurrent(connection: Connection): boolean {
    return this.current === connection && !connection.closing
  }

  private async start(connection: Connection, signal: AbortSignal): Promise<{ toolCount: number }> {
    try {
      await connection.client.connect(connection.transport, { signal, timeout: this.options.timeoutMs })
      signal.throwIfAborted()
      if (!this.isCurrent(connection)) throw new Error('CQAI Club MCP 连接已取消')
      await this.queueSync(connection)
      if (!this.isCurrent(connection)) throw new Error('CQAI Club MCP 连接已取消')
      connection.connected = true
      return { toolCount: connection.disposers.size }
    } catch (error) {
      await this.fail(connection, error)
      throw error
    }
  }

  private queueSync(connection: Connection): Promise<void> {
    const pending = connection.sync.then(() => this.syncTools(connection))
    connection.sync = pending.catch(() => undefined)
    return pending
  }

  private async syncTools(connection: Connection): Promise<void> {
    if (!this.isCurrent(connection)) return
    const definitions = new Map<string, ToolDefinition>()
    if (connection.client.getServerCapabilities()?.tools !== undefined) {
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await connection.client.listTools(cursor === undefined ? undefined : { cursor }, {
          signal: connection.controller.signal,
          timeout: this.options.timeoutMs,
          cacheMode: 'refresh',
        })
        for (const tool of page.tools) {
          const name = toolName(tool.name)
          if (definitions.has(name)) throw new Error('CQAI Club MCP 返回重复工具')
          definitions.set(name, this.definition(connection, tool, name))
        }
        cursor = page.nextCursor
        if (cursor !== undefined) {
          if (cursors.has(cursor) || cursors.size >= 1000) throw new Error('CQAI Club MCP 工具分页无效')
          cursors.add(cursor)
        }
      } while (cursor !== undefined)
    }
    if (!this.isCurrent(connection)) return
    this.unregister(connection)
    try {
      for (const [name, definition] of definitions) {
        connection.disposers.set(name, this.options.ctx.tools.register(definition))
      }
    } catch (error) {
      this.unregister(connection)
      throw error
    }
    this.notify({ state: 'connected', toolCount: connection.disposers.size })
  }

  private definition(connection: Connection, tool: Tool, name: string): ToolDefinition {
    return createMcpToolDefinition(this.options.ctx, {
      name,
      rawName: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      taskRequired: tool.execution?.taskSupport === 'required',
      call: async (args, execution) => {
        if (!this.isCurrent(connection)) throw new Error('CQAI Club MCP 已断开，请重新连接')
        execution.signal.throwIfAborted()
        try {
          return await connection.client.callTool({ name: tool.name, arguments: args }, {
            signal: AbortSignal.any([connection.controller.signal, execution.signal]),
            timeout: this.options.timeoutMs,
            toolDefinition: tool,
          })
        } catch (error) {
          if (!execution.signal.aborted && disconnectsConnection(error)) await this.fail(connection, error)
          throw error
        }
      },
    })
  }

  private unregister(connection: Connection): void {
    for (const dispose of connection.disposers.values()) dispose()
    connection.disposers.clear()
  }

  private async release(connection: Connection): Promise<void> {
    connection.closing = true
    connection.controller.abort()
    this.unregister(connection)
    try {
      await (connection.client.transport === undefined ? connection.transport.close() : connection.client.close())
    } catch {
      // The generation is already invalidated and its tools are gone.
    }
  }

  private async fail(connection: Connection, error: unknown): Promise<void> {
    if (!this.isCurrent(connection)) return
    this.current = undefined
    const record = error !== null && typeof error === 'object' ? error as { code?: unknown } : undefined
    const code = error instanceof UnauthorizedError || (error instanceof SdkHttpError && error.data?.status === 401)
      ? 'CLUB_MCP_UNAUTHORIZED'
      : typeof record?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(record.code)
        ? record.code
        : 'CLUB_MCP_CONNECTION_FAILED'
    this.notify({ state: 'error', toolCount: 0, code, message: 'CQAI Club MCP 连接失败，请重试连接' })
    await this.release(connection)
  }

  private notify(update: ClubMcpClientUpdate): void {
    try {
      this.options.onStatusChange?.(update)
    } catch {
      // A UI observer cannot keep a failed generation or its tools alive.
    }
  }
}

function toolName(rawName: string): string {
  const normalized = rawName.replace(/[^A-Za-z0-9_-]/g, '_')
  const suffix = normalized === rawName && rawName.length <= 46
    ? rawName
    : `${normalized.slice(0, 35)}_${createHash('sha256').update(rawName).digest('hex').slice(0, 10)}`
  return `mcp__cqai_club__${suffix}`
}

function disconnectsConnection(error: unknown): boolean {
  // Invalid arguments and insufficient per-tool permissions are call failures,
  // not a lost account/transport. Preserve their original error for the Agent.
  if (error instanceof InsufficientScopeError || error instanceof ProtocolError) return false
  if (error instanceof SdkHttpError && [400, 403].includes(error.data?.status ?? 0)) return false
  return true
}
