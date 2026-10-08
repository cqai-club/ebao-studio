import type { DsnAccountSnapshot } from '@cqaiclub/dsn-account/protocol'

export const DEFAULT_CLUB_MCP_URL = 'https://cqaiclub.asia/mcp'
export type { DsnAccountSnapshot } from '@cqaiclub/dsn-account/protocol'
export const RPC_CHANNEL = '/cqaiclub-mcp'

export type ClubMcpState = 'disabled' | 'signed-out' | 'reauth-required' | 'disconnected' | 'connecting' | 'connected' | 'error'
export type ClubMcpStatus = {
  enabled: boolean
  url: string
  state: ClubMcpState
  toolCount: number
  message?: string
  code?: string
}
export type ClubMcpConfigureRequest = { enabled: boolean }
export type ClubMcpConnectRequest = { reconnect?: boolean }
export type ClubMcpAuthorizationResult = { snapshot: DsnAccountSnapshot; mcp: ClubMcpStatus }
