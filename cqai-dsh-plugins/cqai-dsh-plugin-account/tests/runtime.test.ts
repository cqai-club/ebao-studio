import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { DsnAccountServiceRuntime } from '../src/index.ts'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  DsnDefaultModelCategory,
  DsnDefaultModelSelection,
} from '../src/protocol.ts'
import { DEFAULT_CLUB_MCP_URL } from '../src/protocol.ts'

const mcpClients = vi.hoisted(() => [] as Array<{
  connect: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  publishStatus: (status: { state: 'connected' | 'error'; toolCount: number }) => void
}>)
vi.mock('../src/mcp-client.ts', () => ({
  ClubMcpClient: class {
    connect = vi.fn(async () => ({ toolCount: 20 }))
    close = vi.fn(async () => undefined)
    publishStatus: (status: { state: 'connected' | 'error'; toolCount: number }) => void
    constructor(options: { onStatusChange: (status: { state: 'connected' | 'error'; toolCount: number }) => void }) {
      this.publishStatus = options.onStatusChange
      mcpClients.push(this)
    }
  },
}))

const issuer = 'https://auth.example.test/oidc'
const resource = 'https://account.example.test'
const portalResource = 'https://club.example.test/'
const account = {
  userId: 7,
  platform: 'dsn',
  displayName: '王仔',
  username: 'wangzai',
  email: 'wangzai@example.com',
  quota: 100,
  quotaUsed: 12,
}
const credential = credentialKey('cqaiclub-dsn-account', 'primary')
const nativeFetch = globalThis.fetch.bind(globalThis)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function audienceToken(aud: string, marker = 'token'): string {
  return `header.${Buffer.from(JSON.stringify({ aud, marker })).toString('base64url')}.signature`
}

function mcpGrant(extra: Record<string, unknown> = {}): Extract<CredentialRecord, { kind: 'grant' }> {
  return { kind: 'grant', payload: {
    version: 3, issuer, clientId: 'client-123', resource,
    scope: ['openid', 'offline_access', 'ai:invoke', 'activity:publish'],
    accessToken: 'account-cached', accessTokenExpiresAt: Date.now() + 3600_000,
    refreshToken: 'refresh-initial', clubPortalResource: portalResource,
    clubMcpResource: DEFAULT_CLUB_MCP_URL, account, accountFetchedAt: Date.now(),
    ...extra,
  } }
}

function storedGrant(records: Map<string, CredentialRecord>): Record<string, unknown> {
  const record = records.get(credential)
  if (record?.kind !== 'grant') throw new Error('grant disappeared')
  return record.payload as Record<string, unknown>
}

type RuntimeHarness = {
  runtime: DsnAccountServiceRuntime
  flow: { run(session: { method: string; signal: AbortSignal; notify(notice: unknown): void }): Promise<void> }
  rpc: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
  records: Map<string, CredentialRecord>
  emit: ReturnType<typeof vi.fn>
  defaultModel: {
    currentSelection: ReturnType<typeof vi.fn>
    saveSelection: ReturnType<typeof vi.fn>
  }
  categorySettings: {
    mutate: ReturnType<typeof vi.fn>
  }
  setDefaultSelection: (selection: DsnDefaultModelSelection) => void
  detachMcp: () => void
  settleAuthorization: () => Promise<void>
}

function makeRuntime(options: {
  openExternal?: (target: string) => Promise<void>
  show?: () => void
  loginCompletionUrl?: string
  withSettings?: boolean
  categoryDefaults?: Partial<Record<DsnDefaultModelCategory, string>>
  clubMcpEnabled?: boolean | { get(): boolean }
  mcpSettingsStore?: { enabled: boolean }
  beforeCredentialDelete?: () => Promise<void>
} = {}): RuntimeHarness {
  let flow: RuntimeHarness['flow'] | undefined
  let rpc: RuntimeHarness['rpc'] | undefined
  let activeSessionController: AbortController | undefined
  let authorizationTask: Promise<void> | undefined
  const records = new Map<string, CredentialRecord>()
  let credentialQueue = Promise.resolve()
  const credentials = {
    readRecord: async (key: string) => records.get(key),
    modifyRecord: async (key: string, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const mutation = credentialQueue.then(async () => {
        const next = await mutate(records.get(key))
        if (next !== undefined) records.set(key, next)
        return next ?? records.get(key)
      })
      credentialQueue = mutation.then(() => undefined, () => undefined)
      return mutation
    },
    deleteRecord: async (key: string) => { await options.beforeCredentialDelete?.(); records.delete(key) },
  }
  const authorization = {
    registerFlow: (candidate: RuntimeHarness['flow']) => {
      flow = candidate
      return () => undefined
    },
    begin: async (options: { method: string; interaction: { notify(notice: unknown): void } }) => {
      activeSessionController = new AbortController()
      authorizationTask = flow?.run({ method: options.method, signal: activeSessionController.signal, notify: options.interaction.notify })
      await authorizationTask
      return { status: 'authorized' as const }
    },
    cancel: vi.fn(() => activeSessionController?.abort()),
  }
  const connection = {
    rpc: {
      handle: (_channel: string, handler: RuntimeHarness['rpc']) => {
        rpc = handler
        return async () => undefined
      },
    },
  }
  const webServer = {}
  let globalDefault: DsnDefaultModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  const defaultModel = {
    currentSelection: vi.fn((): DsnDefaultModelSelection => ({ ...globalDefault })),
    saveSelection: vi.fn(async (selection: DsnDefaultModelSelection) => {
      globalDefault = { ...selection }
    }),
  }
  let categoryDefaults = { ...options.categoryDefaults }
  const categorySettings = {
    mutate: vi.fn(async (_namespace: string, ops: Array<{ op: 'set'; path: string[]; value: string | boolean }>) => {
      for (const op of ops) {
        if (op.path[0] === 'clubMcpEnabled' && options.mcpSettingsStore) options.mcpSettingsStore.enabled = op.value === true
        if (op.path[0] === 'categoryDefaultModels' && op.path[1] !== undefined) {
          categoryDefaults = { ...categoryDefaults, [op.path[1]]: String(op.value) }
        }
      }
    }),
  }
  const setDefaultSelection = (selection: DsnDefaultModelSelection): void => {
    globalDefault = { ...selection }
  }
  const emit = vi.fn()
  let mcpCleanup: (() => void) | undefined
  const root = {
    root: undefined,
    credentials,
    authorization,
    connection,
    webServer,
    ...(options.openExternal === undefined && options.show === undefined && options.loginCompletionUrl === undefined ? {} : {
      desktopRuntime: {
        ...(options.openExternal === undefined ? {} : { openExternal: options.openExternal }),
        ...(options.show === undefined ? {} : { show: options.show }),
        ...(options.loginCompletionUrl === undefined ? {} : { loginCompletionUrl: options.loginCompletionUrl }),
      },
    }),
    agentDefaultModel: defaultModel,
    logger: { warn: vi.fn() },
    reflect: { provide: () => () => undefined },
    effect: (setup: () => () => void, label: string) => {
      if (label === 'cqaiclub-dsn-account: club mcp') mcpCleanup = setup()
    },
    emit,
  } as unknown as Context & { root: Context }
  root.root = root
  if (options.withSettings !== false) {
    Object.assign(root, {
      settings: categorySettings,
      get: (service: string) => (root as unknown as Record<string, unknown>)[service],
      inject: (_services: readonly string[], callback: (injected: Context) => void) => { callback(root) },
    })
  }

  const runtime = new DsnAccountServiceRuntime(root, {
    issuer,
    clientId: 'client-123',
    resource,
    accountServiceUrl: resource,
    clubPortalResource: portalResource,
    clubPortalUrl: 'https://club.example.test',
    clubMcpEnabled: options.mcpSettingsStore ? { get: () => options.mcpSettingsStore?.enabled ?? false } : options.clubMcpEnabled,
    scopes: ['openid', 'offline_access', 'profile', 'email', 'ai:invoke'],
    requestTimeoutMs: 1000,
    categoryDefaultModels: { get: () => ({ ...categoryDefaults }) },
  })
  if (flow === undefined || rpc === undefined) throw new Error('runtime test harness did not capture registrations')
  return {
    runtime, flow, rpc, records, emit, defaultModel, categorySettings, setDefaultSelection,
    detachMcp: () => mcpCleanup?.(), settleAuthorization: async () => { await authorizationTask?.catch(() => undefined) },
  }
}

async function waitForSignedIn(runtime: DsnAccountServiceRuntime): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await runtime.getStatus()).state === 'signed-in') return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('runtime did not finish browser authorization')
}

async function waitForAuthorizationError(runtime: DsnAccountServiceRuntime) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await runtime.getStatus()
    if (snapshot.state === 'error') return snapshot
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('runtime did not report browser authorization failure')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DsnAccountServiceRuntime', () => {
  it('keeps MCP off by default, persists only its switch, and rejects address overrides', async () => {
    const settingsStore = { enabled: false }
    const harness = makeRuntime({ mcpSettingsStore: settingsStore })
    await expect(harness.runtime.getClubMcpStatus()).resolves.toEqual({ enabled: false, url: DEFAULT_CLUB_MCP_URL, state: 'disabled', toolCount: 0 })
    const signal = new AbortController().signal
    await expect(harness.rpc('mcp/configure', { enabled: true, url: 'https://evil.test/mcp' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'DSN_PROTOCOL_ERROR' } })
    expect(settingsStore.enabled).toBe(false)
    await expect(harness.rpc('mcp/configure', { enabled: true }, signal)).resolves.toMatchObject({ ok: true, value: { enabled: true, state: 'signed-out', toolCount: 0 } })
    expect(settingsStore.enabled).toBe(true)
    expect(harness.categorySettings.mutate).toHaveBeenCalledWith('cqaiclub-dsn-account', [{ op: 'set', path: ['clubMcpEnabled'], value: true }])
    const restarted = makeRuntime({ mcpSettingsStore: settingsStore })
    await expect(restarted.runtime.getClubMcpStatus()).resolves.toMatchObject({ enabled: true, state: 'signed-out' })
    await expect(harness.rpc('mcp/configure', { enabled: false }, signal)).resolves.toMatchObject({ ok: true, value: { state: 'disabled' } })
    expect(settingsStore.enabled).toBe(false)
  })

  it('requires explicit MCP consent for an existing portal grant without requesting a new audience using its refresh token', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const harness = makeRuntime()
    const { clubMcpResource: _mcp, ...oldPayload } = mcpGrant().payload as Record<string, unknown>
    harness.records.set(credential, { kind: 'grant', payload: { ...oldPayload, version: 2 } })
    await harness.runtime.configureClubMcp({ enabled: true })
    await expect(harness.runtime.getStatus()).resolves.toMatchObject({ state: 'signed-in' })
    await expect(harness.runtime.getClubPortalAuthorization()).resolves.toBe('ready')
    await expect(harness.runtime.connectClubMcp()).resolves.toMatchObject({ state: 'reauth-required', toolCount: 0 })
    await expect(harness.runtime.fetchClubMcp()).rejects.toMatchObject({ code: 'DSN_REAUTH_REQUIRED' })
    expect(fetch).not.toHaveBeenCalled()
    const withoutSettings = makeRuntime({ withSettings: false })
    await expect(withoutSettings.runtime.configureClubMcp({ enabled: true })).rejects.toMatchObject({ code: 'DSN_CONFIG_INVALID' })
    await expect(withoutSettings.runtime.getClubMcpStatus()).resolves.toMatchObject({ enabled: false })
  })

  it('adds the third resource in plugin browser consent and keeps all tokens out of MCP RPC results', async () => {
    const mcpToken = audienceToken(DEFAULT_CLUB_MCP_URL)
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      if (url.endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body ?? ''))
        if (body.get('grant_type') === 'authorization_code') return json({ access_token: audienceToken(resource), refresh_token: 'fresh-browser-refresh', expires_in: 3600 })
        expect(body.get('resource')).toBe(DEFAULT_CLUB_MCP_URL)
        expect(body.get('refresh_token')).toBe('fresh-browser-refresh')
        return json({ access_token: mcpToken, refresh_token: 'mcp-rotated-refresh', expires_in: 3600 })
      }
      if (url.endsWith('/api/account')) return json({ success: true, data: account })
      if (url.endsWith('/v1/models')) return json({ success: true, data: [] })
      if (url === DEFAULT_CLUB_MCP_URL) {
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${mcpToken}`)
        expect(init?.redirect).toBe('error')
        expect(init?.credentials).toBe('omit')
        return json({ jsonrpc: '2.0', result: {}, id: 1 })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    const { clubMcpResource: _mcp, ...oldPayload } = mcpGrant().payload as Record<string, unknown>
    harness.records.set(credential, { kind: 'grant', payload: { ...oldPayload, version: 2 } })
    const oldStart = await harness.rpc('authorization/start', {}, new AbortController().signal) as {
      ok: boolean; value: { authorizationUrl: string }
    }
    expect(oldStart.ok).toBe(true)
    expect(new URL(oldStart.value.authorizationUrl).searchParams.getAll('resource')).toEqual([resource, portalResource])
    await harness.runtime.configureClubMcp({ enabled: true })
    const start = await harness.rpc('mcp/authorize', {}, new AbortController().signal) as {
      ok: boolean; value: { snapshot: { authorizationUrl: string }; mcp: { state: string } }
    }
    expect(start.ok).toBe(true)
    expect(start.value.mcp.state).toBe('reauth-required')
    const authorization = new URL(start.value.snapshot.authorizationUrl)
    expect(authorization.searchParams.getAll('resource')).toEqual([resource, portalResource, DEFAULT_CLUB_MCP_URL])
    expect(authorization.searchParams.get('prompt')).toBe('consent')
    const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
    expect((await nativeFetch(callback)).status).toBe(200)
    await waitForSignedIn(harness.runtime)
    expect(storedGrant(harness.records)).toMatchObject({ version: 3, clubMcpResource: DEFAULT_CLUB_MCP_URL, clubPortalResource: portalResource })
    await harness.runtime.fetchClubMcp({ method: 'POST', body: '{"id":1}' })
    const status = await harness.rpc('mcp/status', {}, new AbortController().signal)
    expect(status).toMatchObject({ ok: true, value: { enabled: true, state: 'connected', toolCount: 20 } })
    expect(JSON.stringify([start, status])).not.toContain(mcpToken)
    expect(JSON.stringify([start, status])).not.toContain('fresh-browser-refresh')
    expect(JSON.stringify([start, status])).not.toContain('mcp-rotated-refresh')
  })

  it('serializes Account, Portal, and MCP refresh-token rotation and caches each audience independently', async () => {
    const requested: Array<{ resource: string | null; refresh: string | null }> = []
    const mcpToken = audienceToken(DEFAULT_CLUB_MCP_URL)
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      if (url.endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body ?? ''))
        requested.push({ resource: body.get('resource'), refresh: body.get('refresh_token') })
        await new Promise(resolve => setTimeout(resolve, 5))
        return json({ access_token: audienceToken(body.get('resource') ?? ''), refresh_token: `rotated-${requested.length}`, expires_in: 3600 })
      }
      if (url.endsWith('/api/account')) return json({ success: true, data: account })
      if (url.endsWith('/api/v1/me/activity-registrations')) return json([])
      if (url === DEFAULT_CLUB_MCP_URL) {
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${mcpToken}`)
        return json({ result: {} })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime({ clubMcpEnabled: true })
    harness.records.set(credential, mcpGrant({ accessTokenExpiresAt: Date.now() - 1 }))
    await Promise.all([
      harness.runtime.getAccount(),
      harness.runtime.fetchClubPortal('/api/v1/me/activity-registrations'),
      harness.runtime.fetchClubMcp({ method: 'POST', body: '{"requestKey":"same-key"}' }),
    ])
    expect(requested.map(item => item.refresh)).toEqual(['refresh-initial', 'rotated-1', 'rotated-2'])
    expect(requested.map(item => item.resource).sort()).toEqual([resource, portalResource, DEFAULT_CLUB_MCP_URL].sort())
    expect(storedGrant(harness.records)).toMatchObject({ refreshToken: 'rotated-3', clubMcpAccessToken: mcpToken, clubPortalAccessToken: audienceToken(portalResource) })
    await harness.runtime.fetchClubMcp()
    expect(requested).toHaveLength(3)
  })

  it('retries only one explicit MCP 401 with the unchanged write payload, and does not retry ambiguous network failures', async () => {
    const oldToken = audienceToken(DEFAULT_CLUB_MCP_URL, 'old')
    const nextToken = audienceToken(DEFAULT_CLUB_MCP_URL, 'new')
    const wireCalls: Array<{ authorization: string | null; body: RequestInit['body'] }> = []
    let networkFailure = false
    let refreshCount = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      if (url.endsWith('/token')) {
        refreshCount += 1
        return json({ access_token: nextToken, refresh_token: 'refresh-next', expires_in: 3600 })
      }
      if (url === DEFAULT_CLUB_MCP_URL) {
        wireCalls.push({ authorization: new Headers(init?.headers).get('authorization'), body: init?.body })
        if (networkFailure) throw new TypeError('network failed')
        return json({ error: 'unauthorized' }, 401)
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime({ clubMcpEnabled: true })
    harness.records.set(credential, mcpGrant({ clubMcpAccessToken: oldToken, clubMcpAccessTokenExpiresAt: Date.now() + 3600_000 }))
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { requestKey: 'stable-write-key' } })
    expect((await harness.runtime.fetchClubMcp({ method: 'POST', body, headers: { Authorization: 'caller-supplied' } })).status).toBe(401)
    expect(wireCalls).toEqual([{ authorization: `Bearer ${oldToken}`, body }, { authorization: `Bearer ${nextToken}`, body }])
    expect(refreshCount).toBe(1)
    networkFailure = true
    await expect(harness.runtime.fetchClubMcp({ method: 'POST', body })).rejects.toThrow('network failed')
    expect(wireCalls).toHaveLength(3)
    expect(refreshCount).toBe(1)
    await harness.runtime.configureClubMcp({ enabled: false })
    await expect(harness.runtime.fetchClubMcp()).rejects.toMatchObject({ code: 'DSN_CONFIG_INVALID' })
    expect(wireCalls).toHaveLength(3)
    expect(mcpClients.at(-1)?.close).toHaveBeenCalled()
  })

  it('rejects wrong MCP audience without losing shared refresh rotation, and clears invalid grants without leaking secrets', async () => {
    let invalidGrant = false
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      if (url.endsWith('/token')) return invalidGrant ? json({ error: 'invalid_grant' }, 400) : json({ access_token: audienceToken(resource), refresh_token: 'retained-rotated-refresh', expires_in: 3600 })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime({ clubMcpEnabled: true })
    harness.records.set(credential, mcpGrant())
    await expect(harness.runtime.fetchClubMcp()).rejects.toMatchObject({ code: 'DSN_PROTOCOL_ERROR' })
    expect(storedGrant(harness.records)).toMatchObject({ refreshToken: 'retained-rotated-refresh' })
    expect(storedGrant(harness.records)).not.toHaveProperty('clubMcpAccessToken')
    invalidGrant = true
    await expect(harness.runtime.fetchClubMcp()).rejects.toMatchObject({ code: 'DSN_REAUTH_REQUIRED' })
    expect(storedGrant(harness.records)).not.toHaveProperty('refreshToken')
    const status = await harness.runtime.getClubMcpStatus()
    expect(status.state).toBe('reauth-required')
    expect(JSON.stringify(status)).not.toContain('retained-rotated-refresh')
  })

  it('keeps ordinary connect idempotent and reconnects only for an explicit boolean RPC request', async () => {
    const harness = makeRuntime({ clubMcpEnabled: true })
    harness.records.set(credential, mcpGrant())
    const client = mcpClients.at(-1)!
    const signal = new AbortController().signal
    await expect(harness.runtime.connectClubMcp()).resolves.toMatchObject({ state: 'connected', toolCount: 20 })
    const closeCount = client.close.mock.calls.length
    await expect(harness.rpc('mcp/connect', {}, signal)).resolves.toMatchObject({ ok: true, value: { state: 'connected' } })
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.close).toHaveBeenCalledTimes(closeCount)
    await expect(harness.rpc('mcp/connect', { reconnect: 'true' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'DSN_PROTOCOL_ERROR' } })
    await expect(harness.rpc('mcp/connect', { reconnect: true, url: DEFAULT_CLUB_MCP_URL }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'DSN_PROTOCOL_ERROR' } })
    await expect(harness.rpc('mcp/connect', { reconnect: true }, signal)).resolves.toMatchObject({ ok: true, value: { state: 'connected' } })
    expect(client.connect).toHaveBeenCalledTimes(2)
    expect(client.close).toHaveBeenCalledTimes(closeCount + 1)
  })

  it('cancels pending browser consent on sign-out and refuses the original callback', async () => {
    const fetch = vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      throw new Error('cancelled authorization must never exchange a token')
    })
    vi.stubGlobal('fetch', fetch)
    const harness = makeRuntime({ clubMcpEnabled: true })
    const signal = new AbortController().signal
    const start = await harness.rpc('mcp/authorize', {}, signal) as { value: { snapshot: { authorizationUrl: string } } }
    const authorization = new URL(start.value.snapshot.authorizationUrl)
    const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', 'stale-code')
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
    await expect(harness.rpc('session/logout', {}, signal)).resolves.toMatchObject({ ok: true, value: { snapshot: { state: 'signed-out' } } })
    const response = await nativeFetch(callback).catch(() => undefined)
    expect(response?.status).not.toBe(200)
    await harness.settleAuthorization()
    expect(harness.records.has(credential)).toBe(false)
    await expect(harness.runtime.getStatus()).resolves.toMatchObject({ state: 'signed-out' })
    expect(mcpClients.at(-1)?.connect).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['token', 'account'] as const)('does not commit a cancelled grant after a slow %s response ignores abort', async stage => {
    let completeResponse!: (response: Response) => void
    let requestStarted!: () => void
    const barrier = new Promise<Response>(resolve => { completeResponse = resolve })
    const requested = new Promise<void>(resolve => { requestStarted = resolve })
    const accountFetch = vi.fn(async () => json({ success: true, data: account }))
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      if (url.endsWith('/token')) {
        if (stage === 'token') { requestStarted(); return barrier }
        return json({ access_token: audienceToken(resource), refresh_token: 'stale-refresh', expires_in: 3600 })
      }
      if (url.endsWith('/api/account')) {
        if (stage === 'account') { requestStarted(); return barrier }
        return accountFetch()
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime({ clubMcpEnabled: true })
    const signal = new AbortController().signal
    const start = await harness.rpc('mcp/authorize', {}, signal) as { value: { snapshot: { authorizationUrl: string } } }
    const authorization = new URL(start.value.snapshot.authorizationUrl)
    const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', 'late-code')
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
    expect((await nativeFetch(callback)).status).toBe(200)
    await requested
    await expect(harness.rpc('session/logout', {}, signal)).resolves.toMatchObject({ ok: true, value: { snapshot: { state: 'signed-out' } } })
    completeResponse(stage === 'token'
      ? json({ access_token: audienceToken(resource), refresh_token: 'stale-refresh', expires_in: 3600 })
      : json({ success: true, data: account }))
    await harness.settleAuthorization()
    expect(harness.records.has(credential)).toBe(false)
    await expect(harness.runtime.getStatus()).resolves.toMatchObject({ state: 'signed-out' })
    await expect(harness.runtime.getClubMcpStatus()).resolves.toMatchObject({ state: 'signed-out', toolCount: 0 })
    expect(mcpClients.at(-1)?.connect).not.toHaveBeenCalled()
    if (stage === 'token') expect(accountFetch).not.toHaveBeenCalled()
  })

  it('blocks reconnect and bearer requests throughout credential deletion and slow remote sign-out', async () => {
    let allowDelete!: () => void
    let deletionStarted!: () => void
    let completeRevocation!: (response: Response) => void
    let revocationStarted!: () => void
    const deleteBarrier = new Promise<void>(resolve => { allowDelete = resolve })
    const deleting = new Promise<void>(resolve => { deletionStarted = resolve })
    const revokeBarrier = new Promise<Response>(resolve => { completeRevocation = resolve })
    const revoking = new Promise<void>(resolve => { revocationStarted = resolve })
    const fetch = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/revoke` })
      if (url.endsWith('/revoke')) { revocationStarted(); return revokeBarrier }
      throw new Error(`unexpected test URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const harness = makeRuntime({ clubMcpEnabled: true, beforeCredentialDelete: async () => { deletionStarted(); await deleteBarrier } })
    harness.records.set(credential, mcpGrant())
    await harness.runtime.connectClubMcp()
    const client = mcpClients.at(-1)!
    expect(client.connect).toHaveBeenCalledOnce()
    const logout = harness.rpc('session/logout', {}, new AbortController().signal)
    await deleting
    expect(harness.records.has(credential)).toBe(true)
    await expect(harness.runtime.connectClubMcp()).resolves.toMatchObject({ state: 'signed-out', toolCount: 0 })
    await expect(harness.runtime.fetchClubMcp()).rejects.toMatchObject({ code: 'DSN_AUTH_REQUIRED' })
    expect(fetch).not.toHaveBeenCalled()
    allowDelete()
    await revoking
    expect(harness.records.has(credential)).toBe(false)
    await expect(harness.runtime.connectClubMcp()).resolves.toMatchObject({ state: 'signed-out', toolCount: 0 })
    completeRevocation(new Response(null, { status: 200 }))
    await expect(logout).resolves.toMatchObject({ ok: true, value: { snapshot: { state: 'signed-out' }, remoteRevoked: true } })
    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.close.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it.each(['disable', 'detach'] as const)('does not revive a pending connection after %s and ignores detached adapter updates', async action => {
    const harness = makeRuntime({ clubMcpEnabled: true })
    harness.records.set(credential, mcpGrant())
    const client = mcpClients.at(-1)!
    let closed!: () => void
    let releaseClose!: () => void
    const closing = new Promise<void>(resolve => { closed = resolve })
    const closeBarrier = new Promise<void>(resolve => { releaseClose = resolve })
    client.close.mockImplementationOnce(async () => { closed(); await closeBarrier })
    const connecting = harness.runtime.connectClubMcp()
    await closing
    if (action === 'disable') await harness.runtime.configureClubMcp({ enabled: false })
    else harness.detachMcp()
    releaseClose()
    await connecting
    expect(client.connect).not.toHaveBeenCalled()
    const before = await harness.runtime.getClubMcpStatus()
    expect(before).toMatchObject({ state: action === 'disable' ? 'disabled' : 'disconnected', toolCount: 0 })
    client.publishStatus({ state: 'connected', toolCount: 99 })
    await expect(harness.runtime.getClubMcpStatus()).resolves.toEqual(before)
  })

  it('keeps legacy account grants active but requires one base-plugin re-login for portal actions', async () => {
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1, issuer, clientId: 'client-123', resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'legacy-account-token', refreshToken: 'legacy-refresh',
        accessTokenExpiresAt: Date.now() + 3600_000, account, accountFetchedAt: Date.now(),
      },
    })
    await expect(harness.runtime.getStatus()).resolves.toMatchObject({ state: 'signed-in' })
    await expect(harness.runtime.getClubPortalAuthorization()).resolves.toBe('reauth-required')
    await expect(harness.runtime.fetchClubPortal('/api/v1/me/activity-registrations')).rejects.toMatchObject({ code: 'DSN_REAUTH_REQUIRED' })
  })

  it('refreshes a portal-audience token and retains the rotated refresh token for account requests', async () => {
    const refreshTokens: string[] = []
    const portalJwt = `header.${Buffer.from(JSON.stringify({ aud: portalResource })).toString('base64url')}.signature`
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      if (url.endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body ?? ''))
        refreshTokens.push(body.get('refresh_token') ?? '')
        if (body.get('resource') === portalResource) return json({ access_token: portalJwt, refresh_token: 'refresh-rotated', expires_in: 3600 })
        return json({ access_token: 'account-renewed', refresh_token: 'refresh-final', expires_in: 3600 })
      }
      if (url.endsWith('/api/v1/me/activity-registrations')) {
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${portalJwt}`)
        return json([])
      }
      if (url.endsWith('/api/account')) return json({ success: true, data: account })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 2, issuer, clientId: 'client-123', resource,
        scope: ['openid', 'offline_access', 'ai:invoke', 'activity:publish'],
        accessToken: 'account-old', refreshToken: 'refresh-initial',
        accessTokenExpiresAt: Date.now() - 1000,
        clubPortalResource: portalResource,
        clubPortalAccessToken: 'portal-old', clubPortalAccessTokenExpiresAt: Date.now() - 1000,
        account, accountFetchedAt: Date.now(),
      },
    })
    await expect(harness.runtime.getClubPortalAuthorization()).resolves.toBe('ready')
    await expect(harness.runtime.fetchClubPortal('/api/v1/me/activity-registrations')).resolves.toMatchObject({ status: 200 })
    await harness.runtime.getAccount()
    expect(refreshTokens).toEqual(['refresh-initial', 'refresh-rotated'])
    const finalRecord = harness.records.get(credential)
    expect(finalRecord?.kind).toBe('grant')
    if (finalRecord?.kind !== 'grant') throw new Error('grant disappeared')
    expect((finalRecord.payload as { refreshToken: string }).refreshToken).toBe('refresh-final')
  })

  it('keeps a later login when an earlier portal refresh token is revoked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      }
      if (url.endsWith('/token')) return json({ error: 'invalid_grant' }, 400)
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    const oldGrant = {
      version: 2 as const, issuer, clientId: 'client-123', resource,
      scope: ['openid', 'offline_access', 'ai:invoke'],
      accessToken: 'account-old', refreshToken: 'refresh-revoked',
      accessTokenExpiresAt: Date.now() + 3600_000,
      clubPortalResource: portalResource,
      account, accountFetchedAt: Date.now(),
    }
    harness.records.set(credential, { kind: 'grant', payload: oldGrant })
    await expect(harness.runtime.fetchClubPortal('/api/v1/me/activity-registrations')).rejects.toMatchObject({ code: 'DSN_REAUTH_REQUIRED' })
    expect(await harness.runtime.getStatus()).toMatchObject({ state: 'reauth-required' })
    expect(harness.records.has(credential)).toBe(true)

    const newGrant = { ...oldGrant, refreshToken: 'refresh-new' }
    harness.records.set(credential, { kind: 'grant', payload: newGrant })
    expect(await harness.runtime.getStatus()).toMatchObject({ state: 'signed-in' })
    expect((harness.records.get(credential) as { kind: 'grant'; payload: { refreshToken: string } }).payload.refreshToken).toBe('refresh-new')
  })

  it('exposes the current account subject to a sibling plugin without exposing tokens', async () => {
    const harness = makeRuntime()
    await expect(harness.runtime.getIdentity()).resolves.toBeUndefined()
    const claims = Buffer.from(JSON.stringify({ sub: 'logto-user-1' })).toString('base64url')
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1, issuer, clientId: 'client-123', resource,
        scope: ['openid'], accessToken: `header.${claims}.signature`,
        accessTokenExpiresAt: Date.now() + 60_000, account, accountFetchedAt: Date.now(),
      },
    })
    await expect(harness.runtime.getIdentity()).resolves.toEqual({ issuer, sub: 'logto-user-1' })
  })
  it('does not publish duplicate account-change events for stable status reads', async () => {
    const harness = makeRuntime()

    await harness.runtime.getStatus()
    await harness.runtime.getStatus()

    expect(harness.emit).not.toHaveBeenCalledWith('dsn-account/changed', expect.anything())
  })

  it('opens browser authorization, validates the callback, then commits account data', async () => {
    const notifications: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          revocation_endpoint: `${issuer}/token/revocation`,
        })
      }
      if (url.endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body ?? ''))
        if (body.get('grant_type') === 'refresh_token') {
          expect(body.get('resource')).toBe(portalResource)
          expect(body.get('refresh_token')).toBe('refresh-secret')
          const claims = Buffer.from(JSON.stringify({ aud: portalResource, sub: 'logto-user-1' })).toString('base64url')
          return json({ access_token: `header.${claims}.signature`, refresh_token: 'refresh-portal', expires_in: 3600 })
        }
        expect(body.get('grant_type')).toBe('authorization_code')
        expect(body.get('code')).toBe('authorization-code')
        expect(body.get('resource')).toBe(resource)
        return json({ access_token: 'header.payload.signature', refresh_token: 'refresh-secret', expires_in: 3600 })
      }
      if (url.endsWith('/api/account')) return json({ success: true, data: account })
      if (url.endsWith('/v1/models')) return json({
        success: true,
        data: [{
          id: 'text-model',
          owned_by: 'relay',
          categories: ['text', 'text-multimodal'],
          supported_endpoint_types: ['openai'],
        }],
      })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const openExternal = vi.fn(async () => {})
    const show = vi.fn()
    const harness = makeRuntime({
      openExternal,
      show,
      loginCompletionUrl: 'dsh-desktop://oauth/complete',
    })

    const start = await harness.rpc('authorization/start', {}, new AbortController().signal) as {
      ok: boolean
      value: { state: 'authorizing'; authorizationUrl: string; attemptId: string }
    }
    expect(start).toMatchObject({ ok: true, value: { state: 'authorizing' } })
    const authorization = new URL(start.value.authorizationUrl)
    expect(authorization.searchParams.getAll('resource')).toEqual([resource, portalResource])
    const redirectUri = authorization.searchParams.get('redirect_uri')
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/cqaiclub-dsn-account\/oauth\/callback$/)
    expect(authorization.searchParams.get('prompt')).toBe('login consent')
    expect(openExternal).toHaveBeenCalledWith(start.value.authorizationUrl)
    const callback = new URL(redirectUri ?? '')
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
    const response = await nativeFetch(callback)
    expect(response.status).toBe(200)
    const callbackPage = await response.text()
    expect(callbackPage).toContain('已收到登录回调')
    expect(callbackPage).toContain('href="dsh-desktop://oauth/complete"')
    expect(callbackPage).not.toContain('authorization-code')
    expect(show).toHaveBeenCalledOnce()
    await waitForSignedIn(harness.runtime)

    const snapshot = await harness.runtime.getStatus()
    expect(snapshot).toMatchObject({ state: 'signed-in', account, remainingQuota: 100 })
    expect(harness.records.has(credential)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('header.payload.signature')
    expect(JSON.stringify(snapshot)).not.toContain('refresh-secret')
    expect(JSON.stringify(notifications)).not.toContain('header.payload.signature')
    expect(JSON.stringify(notifications)).not.toContain('refresh-secret')

    const rpcResult = await harness.rpc('snapshot/get', { refreshAccount: false }, new AbortController().signal)
    expect(JSON.stringify(rpcResult)).not.toContain('access-secret')
    expect(JSON.stringify(rpcResult)).not.toContain('refresh-secret')
  })

  it('rejects an authorization result without a refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
        })
      }
      if (url.endsWith('/token')) {
        return json({ access_token: 'header.payload.signature', expires_in: 3600 })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime({ openExternal: async () => undefined })

    const start = await harness.rpc('authorization/start', {}, new AbortController().signal) as {
      ok: boolean
      value: { state: 'authorizing'; authorizationUrl: string }
    }
    const authorization = new URL(start.value.authorizationUrl)
    const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '')
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
    await nativeFetch(callback)

    const snapshot = await waitForAuthorizationError(harness.runtime)
    expect(snapshot).toMatchObject({
      state: 'error',
      code: 'DSN_PROTOCOL_ERROR',
      message: 'CQAI Club 未返回刷新令牌，请重新授权。',
    })
    expect(harness.records.has(credential)).toBe(false)
  })

  it('fetches, caches, refreshes, and exposes the typed model catalog RPC', async () => {
    let modelRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) {
        modelRequests += 1
        return json({
          success: true,
          data: [{
            id: 'image-text-model',
            owned_by: 'relay',
            vendor: 'CQAI',
            categories: ['image', 'text-multimodal'],
            supported_endpoint_types: ['openai', 'image-generation'],
          }],
        })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-valid',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await expect(harness.runtime.listModels()).resolves.toMatchObject({
      stale: false,
      models: [{
        id: 'image-text-model',
        ownedBy: 'relay',
        categories: ['image', 'text-multimodal'],
      }],
    })
    await harness.runtime.listModels()
    expect(modelRequests).toBe(1)

    const rpcResult = await harness.rpc('models/list', { refresh: true }, new AbortController().signal) as {
      ok: boolean
      value?: { models: Array<{ id: string }> }
    }
    expect(rpcResult).toMatchObject({ ok: true, value: { models: [{ id: 'image-text-model' }] } })
    expect(modelRequests).toBe(2)
    expect(harness.emit).toHaveBeenCalledWith('dsn-account/models-updated')
  })

  it('reads and validates the CQAI Club default model through the DSH default-model service', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) return json({
        success: true,
        data: [
          { id: 'chat-model', owned_by: 'relay', categories: ['text'], supported_endpoint_types: ['openai'] },
          { id: 'image-model', owned_by: 'relay', categories: ['image'], supported_endpoint_types: ['openai', 'image-generation'] },
        ],
      })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-valid',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await expect(harness.rpc('models/default/get', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })

    await expect(harness.rpc('models/default/adopt-onboarding', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { provider: 'cqaiclub', model: 'chat-model' },
    })
    expect(harness.defaultModel.saveSelection).toHaveBeenCalledWith({ provider: 'cqaiclub', model: 'chat-model' })

    harness.defaultModel.saveSelection.mockClear()
    await expect(harness.rpc('models/default/set', { model: 'chat-model' }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { provider: 'cqaiclub', model: 'chat-model' },
    })
    expect(harness.defaultModel.saveSelection).toHaveBeenCalledWith({ provider: 'cqaiclub', model: 'chat-model' })

    await expect(harness.rpc('models/default/set', { model: 'image-model' }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DSN_MODEL_UNAVAILABLE' },
    })

    harness.setDefaultSelection({ provider: 'another-provider', model: 'custom-model' })
    harness.defaultModel.saveSelection.mockClear()
    await expect(harness.rpc('models/default/adopt-onboarding', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { provider: 'another-provider', model: 'custom-model' },
    })
    expect(harness.defaultModel.saveSelection).not.toHaveBeenCalled()
  })

  it('reads and persists category defaults with the DSH global-model API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) return json({
        success: true,
        data: [
          { id: 'vision-model', owned_by: 'relay', categories: ['text-multimodal'], supported_endpoint_types: ['openai'] },
          { id: 'image-model', owned_by: 'relay', categories: ['image'], supported_endpoint_types: ['image-generation'] },
          { id: 'image-category-only', owned_by: 'relay', categories: ['image'], supported_endpoint_types: ['openai'] },
          { id: 'shared-image-model', owned_by: 'relay', categories: ['image', 'text', 'text-multimodal'], supported_endpoint_types: ['openai', 'image-generation'] },
        ],
      })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-valid',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await expect(harness.rpc('models/category-defaults/get', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        global: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        categories: {},
      },
    })

    await expect(harness.rpc('models/category-defaults/set', {
      category: 'text-multimodal', model: 'vision-model',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        global: { provider: 'cqaiclub', model: 'vision-model' },
        categories: { 'text-multimodal': { provider: 'cqaiclub', model: 'vision-model' } },
      },
    })
    expect(harness.defaultModel.saveSelection).toHaveBeenCalledWith({
      provider: 'cqaiclub', model: 'vision-model',
    })
    expect(harness.categorySettings.mutate).toHaveBeenCalledWith(
      'cqaiclub-dsn-account',
      [{ op: 'set', path: ['categoryDefaultModels', 'text-multimodal'], value: 'vision-model' }],
    )

    harness.defaultModel.saveSelection.mockClear()
    await expect(harness.rpc('models/category-defaults/set', {
      category: 'image', model: 'shared-image-model',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        global: { provider: 'cqaiclub', model: 'vision-model' },
        categories: {
          image: { provider: 'cqaiclub', model: 'shared-image-model' },
          'text-multimodal': { provider: 'cqaiclub', model: 'vision-model' },
        },
      },
    })
    expect(harness.defaultModel.saveSelection).not.toHaveBeenCalled()
    expect(harness.categorySettings.mutate).toHaveBeenLastCalledWith(
      'cqaiclub-dsn-account',
      [{ op: 'set', path: ['categoryDefaultModels', 'image'], value: 'shared-image-model' }],
    )

    await expect(harness.rpc('models/category-defaults/set', {
      category: 'image', model: 'image-category-only',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DSN_MODEL_UNAVAILABLE' },
    })

    await expect(harness.rpc('models/category-defaults/set', {
      category: 'text-multimodal', model: 'image-model',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DSN_MODEL_UNAVAILABLE' },
    })
  })

  it('restores category defaults from settings and still works when settings is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) return json({
        success: true,
        data: [{
          id: 'image-model',
          owned_by: 'relay',
          categories: ['image'],
          supported_endpoint_types: ['image-generation'],
        }],
      })
      throw new Error(`unexpected test URL: ${url}`)
    }))

    const persisted = makeRuntime({ categoryDefaults: { image: 'image-model' } })
    await expect(persisted.runtime.getCategoryDefaultModels()).resolves.toMatchObject({
      categories: { image: { provider: 'cqaiclub', model: 'image-model' } },
    })

    const withoutSettings = makeRuntime({ withSettings: false })
    withoutSettings.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-valid',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })
    await expect(withoutSettings.runtime.setCategoryDefaultModel('image', 'image-model')).resolves.toMatchObject({
      categories: { image: { provider: 'cqaiclub', model: 'image-model' } },
    })
  })

  it('exposes authenticated billing RPCs without returning the access token', async () => {
    let createBody = ''
    const openExternal = vi.fn(async () => undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: string }) => {
      const request = new Request(String(input), init)
      expect(request.headers.get('authorization')).toBe('Bearer access-valid')
      if (request.url.endsWith('/api/billing/topup/info')) {
        return json({ success: true, data: { payment_options: [{ id: 'card', name: 'Stripe', kind: 'amount' }], amount_options: [10] } })
      }
      if (request.url.endsWith('/api/billing/topups')) {
        createBody = await request.text()
        return json({ success: true, data: { payment_url: 'https://pay.example/checkout', order_id: 'order-1' } })
      }
      throw new Error(`unexpected test URL: ${request.url}`)
    }))
    const harness = makeRuntime({ openExternal })
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-valid',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await expect(harness.rpc('billing/topup/info', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { paymentOptions: [{ id: 'card', kind: 'amount' }], amountOptions: [10] },
    })
    const created = await harness.rpc('billing/topups/create', {
      paymentOptionId: 'card',
      amount: 10,
    }, new AbortController().signal)
    expect(created).toMatchObject({
      ok: true,
      value: { paymentUrl: 'https://pay.example/checkout', orderId: 'order-1' },
    })
    expect(createBody).toBe(JSON.stringify({ payment_option_id: 'card', amount: 10 }))
    expect(JSON.stringify(created)).not.toContain('access-valid')

    const launched = await harness.rpc('billing/topups/launch', {
      paymentOptionId: 'card',
      amount: 10,
    }, new AbortController().signal)
    expect(launched).toEqual({ ok: true, value: { orderId: 'order-1' } })
    expect(openExternal).toHaveBeenCalledWith('https://pay.example/checkout')
    expect(JSON.stringify(launched)).not.toContain('https://pay.example')
  })

  it('refreshes the token once after a model-list 401', async () => {
    let modelRequests = 0
    let refreshRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      }
      if (url.endsWith('/token')) {
        refreshRequests += 1
        expect(new URLSearchParams(String(init?.body ?? '')).get('grant_type')).toBe('refresh_token')
        return json({ access_token: 'access-refreshed', refresh_token: 'refresh-refreshed', expires_in: 3600 })
      }
      if (url.endsWith('/v1/models')) {
        modelRequests += 1
        if (modelRequests === 1) return json({ code: 'AUTH_TOKEN_INVALID' }, 401)
        return json({ success: true, data: [] })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await expect(harness.runtime.listModels()).resolves.toMatchObject({ models: [] })
    expect(modelRequests).toBe(2)
    expect(refreshRequests).toBe(1)
  })

  it('keeps the signed-in account and serves stale models after a temporary failure', async () => {
    let unavailable = false
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) {
        if (unavailable) return json({ message: 'model service unavailable' }, 503)
        return json({ success: true, data: [{ id: 'cached-model', owned_by: 'relay' }] })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-valid',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await harness.runtime.listModels()
    unavailable = true
    const stale = await harness.runtime.listModels({ refresh: true })
    expect(stale).toMatchObject({ stale: true, models: [{ id: 'cached-model' }] })
    await expect(harness.runtime.getStatus()).resolves.toMatchObject({ state: 'signed-in' })
  })

  it('serializes concurrent refreshes and preserves rotated refresh tokens', async () => {
    let refreshRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })
      }
      if (url.endsWith('/token')) {
        refreshRequests += 1
        expect(new URLSearchParams(String(init?.body ?? '')).get('grant_type')).toBe('refresh_token')
        return json({ access_token: 'access-rotated', refresh_token: 'refresh-rotated', expires_in: 3600 })
      }
      if (url.endsWith('/api/account')) return json({ success: true, data: account })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() - 1,
        account,
        accountFetchedAt: Date.now() - 1000,
      },
    })

    await Promise.all([harness.runtime.getAccount(), harness.runtime.getAccount()])
    expect(refreshRequests).toBe(1)
    expect(harness.records.get(credential)).toMatchObject({ payload: { refreshToken: 'refresh-rotated', accessToken: 'access-rotated' } })
  })

  it('deletes the local record even when remote revocation is unsuccessful', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/token/revocation` })
      }
      if (url.endsWith('/token/revocation')) return new Response(null, { status: 503 })
      if (url.endsWith('/v1/models')) return json({
        success: true,
        data: [{ id: 'logout-cache-model', owned_by: 'relay' }],
      })
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    await harness.runtime.listModels()
    const result = await harness.rpc('session/logout', {}, new AbortController().signal) as { ok: boolean; value?: { snapshot: { state: string }; remoteRevoked: boolean; warning?: string } }
    expect(result).toMatchObject({ ok: true, value: { remoteRevoked: false } })
    expect(result.value?.snapshot).toEqual({ state: 'signed-out' })
    expect(result.value?.warning).toContain('本地已退出')
    expect(harness.records.has(credential)).toBe(false)
    await expect(harness.runtime.getAccount()).rejects.toMatchObject({ code: 'DSN_AUTH_REQUIRED' })
    await expect(harness.runtime.listModels()).rejects.toMatchObject({ code: 'DSN_AUTH_REQUIRED' })
  })

  it('marks the local session signed-out before a slow remote revocation finishes', async () => {
    let resolveRevocationStarted: (() => void) | undefined
    let releaseRevocation: (() => void) | undefined
    const revocationStarted = new Promise<void>((resolve) => { resolveRevocationStarted = resolve })
    const revocationFinished = new Promise<void>((resolve) => { releaseRevocation = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, revocation_endpoint: `${issuer}/token/revocation` })
      }
      if (url.endsWith('/token/revocation')) {
        resolveRevocationStarted?.()
        await revocationFinished
        return new Response(null, { status: 200 })
      }
      throw new Error(`unexpected test URL: ${url}`)
    }))
    const harness = makeRuntime()
    harness.records.set(credential, {
      kind: 'grant',
      payload: {
        version: 1,
        issuer,
        clientId: 'client-123',
        resource,
        scope: ['openid', 'offline_access', 'ai:invoke'],
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        accessTokenExpiresAt: Date.now() + 3600_000,
        account,
        accountFetchedAt: Date.now(),
      },
    })

    const pendingLogout = harness.rpc('session/logout', {}, new AbortController().signal)
    await revocationStarted
    await expect(harness.runtime.getStatus()).resolves.toEqual({ state: 'signed-out' })
    expect(harness.records.has(credential)).toBe(false)

    releaseRevocation?.()
    const result = await pendingLogout as { ok: boolean; value?: { snapshot: { state: string }; remoteRevoked: boolean } }
    expect(result).toMatchObject({ ok: true, value: { snapshot: { state: 'signed-out' }, remoteRevoked: true } })
  })
})
