import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { DsnAccountServiceRuntime } from '../src/index.ts'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { DsnDefaultModelSelection } from '../src/protocol.ts'

const issuer = 'https://auth.example.test/oidc'
const resource = 'https://account.example.test'
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

type RuntimeHarness = {
  runtime: DsnAccountServiceRuntime
  flow: { run(session: { method: string; signal: AbortSignal; notify(notice: unknown): void }): Promise<void> }
  rpc: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
  records: Map<string, CredentialRecord>
  emit: ReturnType<typeof vi.fn>
  defaultModel: {
    currentSelection: ReturnType<typeof vi.fn>
    currentCategorySelections: ReturnType<typeof vi.fn>
    saveSelection: ReturnType<typeof vi.fn>
    saveCategorySelections: ReturnType<typeof vi.fn>
  }
}

function makeRuntime(options: {
  openExternal?: (target: string) => Promise<void>
  show?: () => void
  loginCompletionUrl?: string
} = {}): RuntimeHarness {
  let flow: RuntimeHarness['flow'] | undefined
  let rpc: RuntimeHarness['rpc'] | undefined
  let activeSessionController: AbortController | undefined
  const records = new Map<string, CredentialRecord>()
  const credentials = {
    readRecord: async (key: string) => records.get(key),
    modifyRecord: async (key: string, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return next ?? records.get(key)
    },
    deleteRecord: async (key: string) => { records.delete(key) },
  }
  const authorization = {
    registerFlow: (candidate: RuntimeHarness['flow']) => {
      flow = candidate
      return () => undefined
    },
    begin: async (options: { method: string; interaction: { notify(notice: unknown): void } }) => {
      activeSessionController = new AbortController()
      await flow?.run({ method: options.method, signal: activeSessionController.signal, notify: options.interaction.notify })
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
  const categoryDefaults = new Map<string, DsnDefaultModelSelection>()
  const defaultModel = {
    currentSelection: vi.fn((category?: string): DsnDefaultModelSelection => ({
      ...(category === undefined ? globalDefault : categoryDefaults.get(category) ?? globalDefault),
    })),
    currentCategorySelections: vi.fn(() => Object.fromEntries(
      [...categoryDefaults.entries()].map(([category, selection]) => [category, { ...selection }]),
    )),
    saveSelection: vi.fn(async (selection: DsnDefaultModelSelection) => {
      globalDefault = { ...selection }
    }),
    saveCategorySelections: vi.fn(async (
      categories: readonly string[],
      selection: DsnDefaultModelSelection,
      options: { updateGlobal?: boolean } = {},
    ) => {
      for (const category of categories) categoryDefaults.set(category, { ...selection })
      if (options.updateGlobal === true) globalDefault = { ...selection }
    }),
  }
  const emit = vi.fn()
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
    reflect: { provide: () => () => undefined },
    effect: () => undefined,
    emit,
  } as unknown as Context & { root: Context }
  root.root = root

  const runtime = new DsnAccountServiceRuntime(root, {
    issuer,
    clientId: 'client-123',
    resource,
    accountServiceUrl: resource,
    scopes: ['openid', 'offline_access', 'profile', 'email', 'ai:invoke'],
    requestTimeoutMs: 1000,
  })
  if (flow === undefined || rpc === undefined) throw new Error('runtime test harness did not capture registrations')
  return { runtime, flow, rpc, records, emit, defaultModel }
}

async function waitForSignedIn(runtime: DsnAccountServiceRuntime): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await runtime.getStatus()).state === 'signed-in') return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('runtime did not finish browser authorization')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DsnAccountServiceRuntime', () => {
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
    const redirectUri = authorization.searchParams.get('redirect_uri')
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/cqaiclub-dsn-account\/oauth\/callback$/)
    expect(authorization.searchParams.get('prompt')).toBe('login')
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
    await expect(harness.rpc('models/default/set', { model: 'chat-model' }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { provider: 'cqaiclub', model: 'chat-model' },
    })
    expect(harness.defaultModel.saveSelection).toHaveBeenCalledWith({ provider: 'cqaiclub', model: 'chat-model' })

    await expect(harness.rpc('models/default/set', { model: 'image-model' }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DSN_MODEL_UNAVAILABLE' },
    })
  })

  it('reads and saves category defaults, merging text with multimodal and only updating global for text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) return json({
        success: true,
        data: [
          { id: 'vision-model', owned_by: 'relay', categories: ['text', 'text-multimodal'], supported_endpoint_types: ['openai'] },
          { id: 'image-model', owned_by: 'relay', categories: ['image'], supported_endpoint_types: ['image-generation'] },
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
    expect(harness.defaultModel.saveCategorySelections).toHaveBeenCalledWith(
      ['text', 'text-multimodal'],
      { provider: 'cqaiclub', model: 'vision-model' },
      { updateGlobal: true },
    )

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
    expect(harness.defaultModel.saveCategorySelections).toHaveBeenLastCalledWith(
      ['image'],
      { provider: 'cqaiclub', model: 'shared-image-model' },
      { updateGlobal: false },
    )

    await expect(harness.rpc('models/category-defaults/set', {
      category: 'text-multimodal', model: 'image-model',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DSN_MODEL_UNAVAILABLE' },
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
