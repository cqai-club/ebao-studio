import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DsnAccountServiceRuntime } from '../src/index.ts'
import { DEFAULT_CLUB_MCP_URL } from '../src/protocol.ts'

const issuer = 'https://auth.integration.test/oidc'
const accountResource = 'https://account.integration.test'
const portalOrigin = 'https://club.integration.test'
const portalResource = `${portalOrigin}/`
const clientId = 'native-integration-client'
const credential = credentialKey('cqaiclub-dsn-account', 'primary')
const account = {
  userId: 7, platform: 'dsn', displayName: '王仔', username: 'wangzai',
  email: 'wangzai@example.com', quota: 100, quotaUsed: 12,
}
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  } finally {
    vi.unstubAllGlobals()
  }
})

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  })
}

// These are fixture tokens only. Resource servers below check their audience;
// the production servers own JWT signature validation.
function token(aud: string, sequence = 0): string {
  return `header.${Buffer.from(JSON.stringify({ aud, iss: issuer, sub: 'user-7', sequence })).toString('base64url')}.signature`
}

function claims(accessToken: string): { aud: string; sequence: number } {
  return JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString()) as { aud: string; sequence: number }
}

type Rpc = { jsonrpc: '2.0'; id?: string | number; method: string; params?: Record<string, unknown> }
type McpRequest = { method: string; source?: string; rpc?: Rpc; authorization: string | null }
type RefreshRequest = { resource: string; refreshToken: string; nextRefreshToken: string; accessToken: string }

/** Intercept only fixture URLs, leaving the SDK and both Host modules real. */
function wireFixture() {
  const mcpRequests: McpRequest[] = []
  const refreshRequests: RefreshRequest[] = []
  const revocations: string[] = []
  const resourceRequests: Array<{ url: string; audience: string }> = []
  let currentRefreshToken = 'refresh-0'
  let rejectCalls = 0
  let failCallNetwork = false
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    init?.signal?.throwIfAborted()
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json({
        issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/token/revocation`,
      })
    }
    if (url === `${issuer}/token`) {
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('grant_type')).toBe('refresh_token')
      expect(form.get('client_id')).toBe(clientId)
      const requestedResource = form.get('resource')!
      expect([accountResource, portalResource, DEFAULT_CLUB_MCP_URL]).toContain(requestedResource)
      const refreshToken = form.get('refresh_token')!
      if (refreshToken !== currentRefreshToken) return json({ error: 'invalid_grant' }, 400)
      const nextRefreshToken = `refresh-${refreshRequests.length + 1}`
      const accessToken = token(requestedResource, refreshRequests.length + 1)
      currentRefreshToken = nextRefreshToken
      refreshRequests.push({ resource: requestedResource, refreshToken, nextRefreshToken, accessToken })
      return json({ access_token: accessToken, refresh_token: nextRefreshToken, expires_in: 3600, token_type: 'Bearer' })
    }
    if (url === `${issuer}/token/revocation`) {
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('client_id')).toBe(clientId)
      expect(form.get('token_type_hint')).toBe('refresh_token')
      revocations.push(form.get('token')!)
      return new Response(null, { status: 200 })
    }
    const headers = new Headers(init?.headers)
    const authorization = headers.get('authorization')
    if (url === DEFAULT_CLUB_MCP_URL) {
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
      expect(authorization?.startsWith('Bearer ')).toBe(true)
      expect(claims(authorization!.slice(7)).aud).toBe(DEFAULT_CLUB_MCP_URL)
      const source = typeof init?.body === 'string' ? init.body : undefined
      const rpc = source === undefined ? undefined : JSON.parse(source) as Rpc
      const method = init?.method ?? 'GET'
      mcpRequests.push({ method, source, rpc, authorization })
      if (method === 'GET') return new Response(null, { status: 405 })
      if (method === 'DELETE') return new Response(null, { status: 200 })
      const result = (value: unknown) => json({ jsonrpc: '2.0', id: rpc?.id, result: value })
      switch (rpc?.method) {
        case 'server/discover':
          return json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } }, 400)
        case 'initialize':
          return result({ protocolVersion: '2025-11-25', serverInfo: { name: 'cqai-club-integration', version: '1' }, capabilities: { tools: {} } })
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return new Response(null, { status: 202 })
        case 'tools/list':
          return result({ tools: [{
            name: 'club_create_activity', description: 'Create an activity draft',
            inputSchema: { type: 'object', properties: { title: { type: 'string' }, requestKey: { type: 'string' } }, required: ['title', 'requestKey'] },
          }] })
        case 'tools/call':
          if (failCallNetwork) throw new TypeError('unknown remote write outcome')
          if (rejectCalls > 0) {
            rejectCalls -= 1
            return json({ error: 'invalid_token' }, 401, { 'www-authenticate': 'Bearer' })
          }
          return result({ content: [{ type: 'text', text: '活动草稿已创建' }], structuredContent: { id: 'activity-44', status: 'DRAFT' } })
      }
      throw new Error(`Unexpected MCP method: ${rpc?.method}`)
    }
    if (url === `${accountResource}/api/account` || url === `${portalOrigin}/api/v1/activities`) {
      expect(authorization?.startsWith('Bearer ')).toBe(true)
      const audience = claims(authorization!.slice(7)).aud
      expect(audience).toBe(url.startsWith(accountResource) ? accountResource : portalResource)
      resourceRequests.push({ url, audience })
      return json(url.startsWith(accountResource) ? { success: true, data: account } : { items: [] })
    }
    throw new Error(`Unexpected network request: ${url}`)
  }
  vi.stubGlobal('fetch', fetchImpl)
  return {
    mcpRequests, refreshRequests, revocations, resourceRequests,
    rejectNextCalls: (count = 1) => { rejectCalls = count },
    failNextCallNetwork: () => { failCallNetwork = true },
    currentRefreshToken: () => currentRefreshToken,
  }
}

function host(options: { expiredAccount?: boolean } = {}) {
  const tools = new Map<string, ToolDefinition>()
  const records = new Map<string, CredentialRecord>([[credential, { kind: 'grant', payload: {
    version: 3, issuer, clientId, resource: accountResource,
    scope: ['openid', 'offline_access', 'ai:invoke', 'activity:publish'],
    accessToken: token(accountResource), accessTokenExpiresAt: options.expiredAccount ? 0 : Date.now() + 3600_000,
    refreshToken: 'refresh-0', account, accountFetchedAt: Date.now(),
    clubPortalResource: portalResource, clubMcpResource: DEFAULT_CLUB_MCP_URL,
  } }]])
  let credentialQueue: Promise<unknown> = Promise.resolve()
  const serialize = <T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = credentialQueue.then(operation)
    credentialQueue = pending.then(() => undefined, () => undefined)
    return pending
  }
  let rpc: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const disposers: Array<() => void> = []
  const store = { enabled: false }
  const root = {
    root: undefined,
    credentials: {
      readRecord: async (key: string) => records.get(key),
      modifyRecord: (key: string, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => serialize(async () => {
        const next = await mutate(records.get(key))
        if (next !== undefined) records.set(key, next)
        return next ?? records.get(key)
      }),
      deleteRecord: (key: string) => serialize(async () => { records.delete(key) }),
    },
    authorization: {
      registerFlow: () => () => undefined,
      begin: async () => { throw new Error('This integration must reuse the authorized account') },
      cancel: vi.fn(),
    },
    connection: { rpc: { handle: (_channel: string, handler: typeof rpc) => { rpc = handler; return async () => undefined } } },
    tools: { register: (definition: ToolDefinition) => {
      if (tools.has(definition.name)) throw new Error('duplicate tool')
      tools.set(definition.name, definition)
      return () => { tools.delete(definition.name) }
    } },
    settings: {
      configure: () => () => undefined,
      mutate: async (_namespace: string, operations: Array<{ path: string[]; value: unknown }>) => {
        for (const operation of operations) if (operation.path[0] === 'clubMcpEnabled') store.enabled = operation.value === true
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }), saveSelection: async () => undefined },
    logger: { warn: vi.fn() }, reflect: { provide: () => () => undefined }, emit: vi.fn(),
    effect: (setup: () => (() => void)) => { disposers.push(setup()) },
  } as unknown as Context & { root: Context }
  root.root = root
  Object.assign(root, {
    get: (service: string) => (root as unknown as Record<string, unknown>)[service],
    inject: (_services: readonly string[], callback: (context: Context) => void) => callback(root),
  })
  const runtime = new DsnAccountServiceRuntime(root, {
    issuer, clientId, resource: accountResource, accountServiceUrl: accountResource,
    clubPortalUrl: portalOrigin, clubPortalResource: portalResource,
    clubMcpEnabled: { get: () => store.enabled },
    scopes: ['openid', 'offline_access', 'ai:invoke', 'activity:publish'],
    requestTimeoutMs: 2000,
    categoryDefaultModels: { get: () => ({}) },
  })
  cleanups.push(async () => {
    await runtime.configureClubMcp({ enabled: false })
    for (const dispose of disposers.reverse()) dispose()
  })
  return {
    runtime, tools, records,
    rpc: (endpoint: string) => {
      if (rpc === undefined) throw new Error('Runtime RPC was not registered')
      return rpc(endpoint, {}, new AbortController().signal)
    },
    grant: () => {
      const record = records.get(credential)
      if (record?.kind !== 'grant') throw new Error('grant disappeared')
      return record.payload as Record<string, unknown>
    },
  }
}

async function connect(runtime: DsnAccountServiceRuntime) {
  await runtime.configureClubMcp({ enabled: true })
  await expect(runtime.connectClubMcp()).resolves.toMatchObject({ state: 'connected', toolCount: 1 })
}

function definition(tools: Map<string, ToolDefinition>): ToolDefinition {
  const result = tools.get('mcp__cqai_club__club_create_activity')
  if (result === undefined) throw new Error('Real SDK did not register the tool')
  return result
}

function execute(tool: ToolDefinition, requestKey = 'create-activity-44') {
  const args = { title: 'CQAI Club integration draft', requestKey }
  return tool.execute(args, {
    callId: 'call-44', rootCallId: 'call-44', name: tool.name, arguments: args,
    signal: new AbortController().signal, token: Symbol('execution'),
    deferContext: () => undefined, concludeTurn: () => undefined,
  } as unknown as ToolRunContext)
}

describe('real account Runtime → Host tool → MCP SDK integration', () => {
  it('obtains a separate MCP audience token and retries an explicit 401 once with the exact original write', async () => {
    const wire = wireFixture()
    const app = host()
    await connect(app.runtime)
    expect(wire.refreshRequests.map((request) => request.resource)).toEqual([DEFAULT_CLUB_MCP_URL])
    expect(wire.mcpRequests.some((request) => request.rpc?.method === 'initialize')).toBe(true)
    expect(wire.mcpRequests.some((request) => request.rpc?.method === 'tools/list')).toBe(true)
    wire.rejectNextCalls()
    await expect(execute(definition(app.tools))).resolves.toMatchObject({ structuredContent: { id: 'activity-44', status: 'DRAFT' } })
    const calls = wire.mcpRequests.filter((request) => request.rpc?.method === 'tools/call')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.source).toBe(calls[0]?.source)
    expect(calls[0]?.rpc?.params).toEqual({ name: 'club_create_activity', arguments: { title: 'CQAI Club integration draft', requestKey: 'create-activity-44' } })
    expect(calls[1]?.authorization).not.toBe(calls[0]?.authorization)
    expect(wire.refreshRequests.map((request) => request.refreshToken)).toEqual(['refresh-0', 'refresh-1'])
    expect(app.grant().refreshToken).toBe('refresh-2')
    expect(app.grant().accessToken).toBe(token(accountResource))
    expect(claims(String(app.grant().clubMcpAccessToken)).aud).toBe(DEFAULT_CLUB_MCP_URL)
  })

  it('serializes concurrent Account, Portal and MCP refreshes against one rotating refresh token', async () => {
    const wire = wireFixture()
    const app = host({ expiredAccount: true })
    await app.runtime.configureClubMcp({ enabled: true })
    const [accountResult, portalResult, status] = await Promise.all([
      app.runtime.getAccount(), app.runtime.fetchClubPortal('/api/v1/activities'), app.runtime.connectClubMcp(),
    ])
    expect(accountResult).toEqual(account)
    expect(portalResult.status).toBe(200)
    expect(status).toMatchObject({ state: 'connected', toolCount: 1 })
    expect(wire.refreshRequests.map((request) => request.resource).sort()).toEqual([accountResource, portalResource, DEFAULT_CLUB_MCP_URL].sort())
    expect(wire.refreshRequests.map((request) => request.refreshToken)).toEqual(['refresh-0', 'refresh-1', 'refresh-2'])
    const grant = app.grant()
    expect(grant.refreshToken).toBe('refresh-3')
    expect(claims(String(grant.accessToken)).aud).toBe(accountResource)
    expect(claims(String(grant.clubPortalAccessToken)).aud).toBe(portalResource)
    expect(claims(String(grant.clubMcpAccessToken)).aud).toBe(DEFAULT_CLUB_MCP_URL)
    await expect(execute(definition(app.tools))).resolves.toMatchObject({ structuredContent: { id: 'activity-44' } })
    expect(wire.refreshRequests).toHaveLength(3)
    expect(wire.resourceRequests.map((request) => request.audience).sort()).toEqual([accountResource, portalResource].sort())
  })

  it('keeps the existing tool generation for default connect and replaces it only for an explicit reconnect', async () => {
    const wire = wireFixture()
    const app = host()
    await connect(app.runtime)
    const original = definition(app.tools)
    await Promise.all([app.runtime.connectClubMcp(), app.runtime.connectClubMcp()])
    expect(definition(app.tools)).toBe(original)
    expect(wire.mcpRequests.filter((request) => request.rpc?.method === 'initialize')).toHaveLength(1)
    await expect(execute(original)).resolves.toMatchObject({ structuredContent: { id: 'activity-44' } })
    await expect(app.runtime.connectClubMcp(undefined, { reconnect: true })).resolves.toMatchObject({ state: 'connected', toolCount: 1 })
    expect(definition(app.tools)).not.toBe(original)
    expect(wire.mcpRequests.filter((request) => request.rpc?.method === 'initialize')).toHaveLength(2)
    await expect(execute(original)).rejects.toThrow('已断开')
    await expect(execute(definition(app.tools))).resolves.toBeDefined()
    expect(wire.refreshRequests).toHaveLength(1)
  })

  it('unregisters real tools on disable and logout and revokes the latest shared refresh token', async () => {
    const wire = wireFixture()
    const app = host()
    await connect(app.runtime)
    const disabledTool = definition(app.tools)
    await expect(app.runtime.configureClubMcp({ enabled: false })).resolves.toMatchObject({ state: 'disabled', toolCount: 0 })
    expect(app.tools.size).toBe(0)
    await expect(execute(disabledTool)).rejects.toThrow('已断开')
    await connect(app.runtime)
    const signedOutTool = definition(app.tools)
    wire.rejectNextCalls()
    await execute(signedOutTool)
    const refreshToken = wire.currentRefreshToken()
    await expect(app.rpc('session/logout')).resolves.toMatchObject({ ok: true, value: { snapshot: { state: 'signed-out' }, remoteRevoked: true } })
    expect(app.tools.size).toBe(0)
    expect(app.records.has(credential)).toBe(false)
    expect(wire.revocations).toEqual([refreshToken])
    await expect(app.runtime.getClubMcpStatus()).resolves.toMatchObject({ state: 'signed-out', toolCount: 0 })
    const count = wire.mcpRequests.length
    await expect(execute(signedOutTool)).rejects.toThrow('已断开')
    expect(wire.mcpRequests).toHaveLength(count)
  })

  it('surfaces a second 401 without an SDK retry and removes the unusable tools', async () => {
    const wire = wireFixture()
    const app = host()
    await connect(app.runtime)
    wire.rejectNextCalls(2)
    await expect(execute(definition(app.tools), 'exhausted-401')).rejects.toThrow()
    expect(wire.mcpRequests.filter((request) => request.rpc?.method === 'tools/call')).toHaveLength(2)
    expect(wire.refreshRequests).toHaveLength(2)
    expect(app.tools.size).toBe(0)
    await expect(app.runtime.getClubMcpStatus()).resolves.toMatchObject({ state: 'error', toolCount: 0 })
  })

  it('does not replay a write when its network outcome is unknown', async () => {
    const wire = wireFixture()
    const app = host()
    await connect(app.runtime)
    wire.failNextCallNetwork()
    await expect(execute(definition(app.tools), 'unknown-network-outcome')).rejects.toThrow()
    expect(wire.mcpRequests.filter((request) => request.rpc?.method === 'tools/call')).toHaveLength(1)
    expect(wire.refreshRequests).toHaveLength(1)
    expect(app.tools.size).toBe(0)
  })
})
