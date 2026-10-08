import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { DsnAccountServiceRuntime } from '@cqaiclub/dsn-account'
import { ClubMcpService } from '../src/mcp/index.ts'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  DsnDefaultModelCategory,
  DsnDefaultModelSelection,
} from '@cqaiclub/dsn-account/protocol'
import { DEFAULT_CLUB_MCP_URL } from '@cqaiclub/dsn-account/protocol'

const mcpClients = vi.hoisted(() => [] as Array<{
  connect: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  publishStatus: (status: { state: 'connected' | 'error'; toolCount: number }) => void
}>)
vi.mock('../src/mcp/mcp-client.ts', () => ({
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
  runtime: DsnAccountServiceRuntime & Pick<ClubMcpService, 'getClubMcpStatus' | 'configureClubMcp' | 'connectClubMcp' | 'beginClubMcpAuthorization'> & { fetchClubMcp(init?: RequestInit, signal?: AbortSignal): Promise<Response> }
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
  extensionEnabled?: boolean
  beforeCredentialDelete?: () => Promise<void>
} = {}): RuntimeHarness {
  let flow: RuntimeHarness['flow'] | undefined
  let rpc: RuntimeHarness['rpc'] | undefined
  let mcpRpc: RuntimeHarness['rpc'] | undefined
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
      handle: (channel: string, handler: RuntimeHarness['rpc']) => {
        if (channel === '/cqaiclub-mcp') mcpRpc = handler
        else rpc = handler
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
    configure: () => () => undefined,
    mutate: vi.fn(async (_namespace: string, ops: Array<{ op: 'set'; path: string[]; value: string | boolean }>) => {
      for (const op of ops) {
        if (op.path[0] === 'mcpEnabled' && options.mcpSettingsStore) options.mcpSettingsStore.enabled = op.value === true
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
      if (label === 'cqaiclub-mcp: resource and tools') mcpCleanup = setup()
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
    clubMcpEnabled: options.clubMcpEnabled,
    scopes: ['openid', 'offline_access', 'profile', 'email', 'ai:invoke'],
    requestTimeoutMs: 1000,
    categoryDefaultModels: { get: () => ({ ...categoryDefaults }) },
  })
  Object.assign(root, { dsnAccount: runtime })
  const mcp = new ClubMcpService(root, { enabled: options.mcpSettingsStore ? { get: () => options.mcpSettingsStore?.enabled } : options.extensionEnabled })
  const resourceSession = runtime.useResource(root, { resource: DEFAULT_CLUB_MCP_URL, enabled: options.mcpSettingsStore?.enabled ?? options.extensionEnabled ?? (typeof options.clubMcpEnabled === 'object' ? options.clubMcpEnabled.get() : options.clubMcpEnabled ?? false) })
  const originalConfigure = mcp.configureClubMcp.bind(mcp)
  Object.assign(runtime, {
    getClubMcpStatus: mcp.getClubMcpStatus.bind(mcp),
    configureClubMcp: async (request: { enabled: boolean }) => { const status = await originalConfigure(request); resourceSession.setActive(request.enabled); return status },
    connectClubMcp: mcp.connectClubMcp.bind(mcp), beginClubMcpAuthorization: mcp.beginClubMcpAuthorization.bind(mcp),
    fetchClubMcp: resourceSession.fetch,
  })
  if (flow === undefined || rpc === undefined || mcpRpc === undefined) throw new Error('runtime test harness did not capture registrations')
  const accountRpc = rpc
  const extensionRpc = mcpRpc
  rpc = (endpoint, payload, signal) => endpoint.startsWith('mcp/') ? extensionRpc(endpoint, payload, signal) : accountRpc(endpoint, payload, signal)
  return {
    runtime: runtime as RuntimeHarness['runtime'], flow, rpc, records, emit, defaultModel, categorySettings, setDefaultSelection,
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

describe('MCP extension with shared Account resource lease', () => {
  it('inherits the deprecated account switch only before an extension setting exists and retains the authorized v3 grant', async () => {
    const inherited = makeRuntime({ clubMcpEnabled: true })
    const original = mcpGrant()
    inherited.records.set(credential, original)
    await expect(inherited.runtime.connectClubMcp()).resolves.toMatchObject({ enabled: true, state: 'connected', toolCount: 20 })
    expect(inherited.records.get(credential)).toBe(original)
    inherited.detachMcp()
    expect(inherited.records.get(credential)).toBe(original)
    await expect(inherited.runtime.getStatus()).resolves.toMatchObject({ state: 'signed-in' })

    const explicit = makeRuntime({ clubMcpEnabled: true, extensionEnabled: false })
    explicit.records.set(credential, original)
    await expect(explicit.runtime.getClubMcpStatus()).resolves.toMatchObject({ enabled: false, state: 'disabled' })
    const store = { enabled: false }
    const configured = makeRuntime({ clubMcpEnabled: true, mcpSettingsStore: store })
    configured.records.set(credential, original)
    await expect(configured.runtime.getClubMcpStatus()).resolves.toMatchObject({ enabled: false, state: 'disabled' })
    await configured.runtime.configureClubMcp({ enabled: true })
    expect(store.enabled).toBe(true)
    const restarted = makeRuntime({ clubMcpEnabled: true, mcpSettingsStore: store })
    restarted.records.set(credential, original)
    await expect(restarted.runtime.connectClubMcp()).resolves.toMatchObject({ state: 'connected' })
    expect(restarted.records.get(credential)).toBe(original)
  })

  it('keeps MCP off by default, persists only its switch, and rejects address overrides', async () => {
    const settingsStore = { enabled: false }
    const harness = makeRuntime({ mcpSettingsStore: settingsStore })
    await expect(harness.runtime.getClubMcpStatus()).resolves.toEqual({ enabled: false, url: DEFAULT_CLUB_MCP_URL, state: 'disabled', toolCount: 0 })
    const signal = new AbortController().signal
    await expect(harness.rpc('mcp/configure', { enabled: true, url: 'https://evil.test/mcp' }, signal)).resolves.toMatchObject({ ok: false, error: { code: 'DSN_PROTOCOL_ERROR' } })
    expect(settingsStore.enabled).toBe(false)
    await expect(harness.rpc('mcp/configure', { enabled: true }, signal)).resolves.toMatchObject({ ok: true, value: { enabled: true, state: 'signed-out', toolCount: 0 } })
    expect(settingsStore.enabled).toBe(true)
    expect(harness.categorySettings.mutate).toHaveBeenCalledWith('cqaiclub-extension', [{ op: 'set', path: ['mcpEnabled'], value: true }])
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
    expect(client.close.mock.calls.length).toBeGreaterThanOrEqual(2)
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
    expect(before).toMatchObject({ state: 'disabled', toolCount: 0 })
    client.publishStatus({ state: 'connected', toolCount: 99 })
    await expect(harness.runtime.getClubMcpStatus()).resolves.toEqual(before)
  })


})
