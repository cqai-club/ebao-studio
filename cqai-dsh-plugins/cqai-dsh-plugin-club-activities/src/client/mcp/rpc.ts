import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RPC_CHANNEL, type ClubMcpAuthorizationResult, type ClubMcpStatus } from '../../mcp/protocol.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

type RpcResult<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}

async function request<T>(ctx: ClientContext, channel: string, endpoint: string, payload: unknown): Promise<T> {
  const result = await ctx.connection.rpc.call(channel, endpoint, payload) as RpcResult<T>
  if (!result.ok) {
    const error = new Error(result.error.message)
    Object.assign(error, { code: result.error.code })
    throw error
  }
  return result.value
}

/** Shared account authorization stays in the account plugin's RPC boundary. */
export function accountRpcCall<T>(ctx: ClientContext, endpoint: 'snapshot/get' | 'authorization/cancel', payload: unknown): Promise<T> {
  return request(ctx, '/cqaiclub-dsn-account', endpoint, payload)
}

export function getClubMcpStatus(ctx: ClientContext): Promise<ClubMcpStatus> {
  return request(ctx, RPC_CHANNEL, 'mcp/status', {})
}

export function configureClubMcp(ctx: ClientContext, enabled: boolean): Promise<ClubMcpStatus> {
  return request(ctx, RPC_CHANNEL, 'mcp/configure', { enabled })
}

export function connectClubMcp(ctx: ClientContext, reconnect = false): Promise<ClubMcpStatus> {
  return request(ctx, RPC_CHANNEL, 'mcp/connect', reconnect ? { reconnect: true } : {})
}

export function authorizeClubMcp(ctx: ClientContext): Promise<ClubMcpAuthorizationResult> {
  return request(ctx, RPC_CHANNEL, 'mcp/authorize', {})
}
