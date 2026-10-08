import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RPC_CHANNEL, type ClubMcpAuthorizationResult, type ClubMcpStatus } from '../protocol.ts'

// The RC client-connection package exposes the browser handle but does not
// merge it onto Cordis' Context type. Keep this local augmentation until the
// upstream declaration does so; the runtime service is already present.
declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly connection: ConnectionHandle
  }
}

type RpcResult<T> = {
  readonly ok: true
  readonly value: T
} | {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}

export async function rpcCall<T>(
  ctx: ClientContext,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const result = await ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload, signal) as RpcResult<T>
  if (!result.ok) {
    const error = new Error(result.error.message)
    Object.assign(error, { code: result.error.code })
    throw error
  }
  return result.value
}

export function getClubMcpStatus(ctx: ClientContext): Promise<ClubMcpStatus> {
  return rpcCall(ctx, 'mcp/status', {})
}

export function configureClubMcp(ctx: ClientContext, enabled: boolean): Promise<ClubMcpStatus> {
  return rpcCall(ctx, 'mcp/configure', { enabled })
}

export function connectClubMcp(ctx: ClientContext, reconnect = false): Promise<ClubMcpStatus> {
  return rpcCall(ctx, 'mcp/connect', reconnect ? { reconnect: true } : {})
}

export function authorizeClubMcp(ctx: ClientContext): Promise<ClubMcpAuthorizationResult> {
  return rpcCall(ctx, 'mcp/authorize', {})
}
