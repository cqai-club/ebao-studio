import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { DsnAccountSnapshot } from '@cqaiclub/dsn-account/protocol'
import { CqaiDesktopAccountAdapter, type CqaiAccountOperations } from '../src/adapter.ts'
import { CqaiDesktopAccount } from '../src/index.ts'

const client = { version: '0.2.2-rc.5', locale: 'zh-CN', timezoneOffsetSeconds: 28800 }
const signedIn: DsnAccountSnapshot = { state: 'signed-in', account: { userId: 42, platform: 'cqai', displayName: 'CQAI member', quota: 500000 }, refreshedAt: 1, stale: false }
const authorizing = (attemptId = 'cqai-attempt', authorizationUrl = 'https://auth.cqaiclub.asia/oidc/authorize?state=oauth-state&code_challenge=pkce') => ({
  state: 'authorizing' as const, attemptId, authorizationUrl, expiresAt: Date.now() + 60_000, message: 'Continue in browser',
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  let snapshot: DsnAccountSnapshot = { state: 'signed-out' }
  const account: CqaiAccountOperations = {
    getStatus: vi.fn(async () => snapshot),
    getAccount: vi.fn(async () => signedIn.state === 'signed-in' ? signedIn.account : Promise.reject()),
    startAuthorization: vi.fn(async () => { snapshot = authorizing(); return snapshot }),
    cancelAuthorization: vi.fn(async () => { snapshot = { state: 'signed-out' } }),
    logout: vi.fn(async () => { snapshot = { state: 'signed-out' }; return { remoteRevoked: false } }),
    adoptOnboardingDefaultModel: vi.fn(async () => ({ provider: 'cqai-club', model: 'deepseek-chat' })),
  }
  const removed = vi.fn()
  const selectionFailed = vi.fn()
  const adapter = new CqaiDesktopAccountAdapter(account, {}, removed, selectionFailed)
  return { account, adapter, removed, selectionFailed, set(value: DsnAccountSnapshot) { snapshot = value } }
}

describe('CQAI adapter for the official Desktop account contract', () => {
  it('publishes real signed-out state and independent token-free snapshots', async () => {
    const f = fixture()
    const first = await f.adapter.getState()
    expect(first).toEqual({ status: 'signed-out', links: { usageUrl: 'https://cqaiclub.asia/', topUpUrl: 'https://cqaiclub.asia/' }, attempt: null })
    Reflect.set(first.links, 'usageUrl', 'https://unrelated.invalid/')
    expect((await f.adapter.getState()).links.usageUrl).toBe('https://cqaiclub.asia/')
  })

  it('routes native login to CQAI and adopts the real CQAI default before reporting success', async () => {
    const f = fixture()
    const waiting = await f.adapter.startSignIn()
    expect(waiting.status).toBe('signed-out')
    expect(waiting.attempt?.phase).toBe('waiting-browser')
    expect(new URL(waiting.attempt!.authorizeUrl!).origin).toBe('https://auth.cqaiclub.asia')
    const adoption = deferred<{ provider: string; model: string }>()
    vi.mocked(f.account.adoptOnboardingDefaultModel).mockReturnValue(adoption.promise)
    f.set(signedIn)
    const finishing = f.adapter.observe(signedIn)
    const abort = new AbortController()
    const stream = f.adapter.watch(abort.signal)[Symbol.asyncIterator]()
    const committing = stream.next()
    adoption.resolve({ provider: 'cqai-club', model: 'deepseek-chat' })
    await finishing
    const current = await f.adapter.getState()
    expect(current.status).toBe('credential-stored')
    expect(current.attempt?.id).toBe(waiting.attempt?.id)
    expect(current.attempt?.phase).toBe('succeeded')
    expect(f.account.adoptOnboardingDefaultModel).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(current)).not.toContain('accessToken')
    await committing
    abort.abort()
    await stream.return?.()
  })

  it('does not cancel another attempt and rejects late success notifications after cancellation', async () => {
    const f = fixture()
    const waiting = await f.adapter.startSignIn()
    await f.adapter.cancelSignIn('stale-attempt' as SignInAttemptId)
    expect(f.account.cancelAuthorization).not.toHaveBeenCalled()
    const cancelled = await f.adapter.cancelSignIn(waiting.attempt!.id)
    expect(f.account.cancelAuthorization).toHaveBeenCalledWith('cqai-attempt')
    expect(cancelled.attempt?.phase).toBe('cancelled')
    // The real credential owner still reports signed out; a delayed observation
    // must not manufacture an official authenticated state.
    await f.adapter.observe(signedIn)
    expect((await f.adapter.getState()).status).toBe('signed-out')
    expect(f.account.adoptOnboardingDefaultModel).not.toHaveBeenCalled()
  })

  it('cancels during initialization without publishing a late authorization URL', async () => {
    const f = fixture()
    const pending = deferred<DsnAccountSnapshot>()
    vi.mocked(f.account.startAuthorization).mockImplementation(() => pending.promise)
    const abort = new AbortController()
    const stream = f.adapter.watch(abort.signal)[Symbol.asyncIterator]()
    await stream.next()
    const started = f.adapter.startSignIn()
    const initializing = await stream.next()
    expect(initializing.value?.attempt?.phase).toBe('initializing')
    await f.adapter.cancelSignIn(initializing.value!.attempt!.id)
    await f.adapter.observe(authorizing())
    pending.resolve(authorizing())
    expect((await started).attempt?.phase).toBe('cancelled')
    expect((await f.adapter.getState()).attempt?.authorizeUrl).toBeUndefined()
    abort.abort()
    await stream.return?.()
  })

  it('allows a fresh login after cancellation without reusing the cancelled native attempt', async () => {
    const f = fixture()
    const first = await f.adapter.startSignIn()
    await f.adapter.cancelSignIn(first.attempt!.id)
    vi.mocked(f.account.startAuthorization).mockImplementation(async () => authorizing('new-source-attempt'))
    const second = await f.adapter.startSignIn()
    expect(second.attempt?.phase).toBe('waiting-browser')
    expect(second.attempt?.id).not.toBe(first.attempt!.id)
    expect(f.account.startAuthorization).toHaveBeenCalledTimes(2)
    await f.adapter.cancelSignIn(first.attempt!.id)
    expect(f.account.cancelAuthorization).toHaveBeenCalledTimes(1)
  })

  it('fails closed for foreign or credential-bearing authorization destinations', async () => {
    for (const url of ['https://foreign.invalid/authorize', 'http://auth.cqaiclub.asia/authorize', 'https://user:password@auth.cqaiclub.asia/authorize', 'https://auth.cqaiclub.asia/authorize?access_token=secret']) {
      const f = fixture()
      vi.mocked(f.account.startAuthorization).mockImplementation(async () => authorizing('bad-attempt', url))
      const state = await f.adapter.startSignIn()
      expect(state.attempt?.phase).toBe('failed')
      expect(state.attempt?.errorCode).toBe('protocol')
      expect(state.attempt?.authorizeUrl).toBeUndefined()
      expect(JSON.stringify(state)).not.toContain('secret')
      expect(f.account.cancelAuthorization).toHaveBeenCalledWith('bad-attempt')
    }
    const f = fixture()
    expect(() => new CqaiDesktopAccountAdapter(f.account, { usageUrl: 'http://untrusted.invalid/' })).toThrow(/HTTPS/)
  })

  it('projects terminal errors without exposing raw protocol messages and emits expiry only after real loss', async () => {
    const f = fixture()
    await f.adapter.startSignIn()
    await f.adapter.observe({ state: 'error', code: 'DSN_LOGIN_EXPIRED', message: 'private token secret', retryable: true })
    f.set({ state: 'error', code: 'DSN_LOGIN_EXPIRED', message: 'private token secret', retryable: true })
    const state = await f.adapter.getState()
    expect(state.attempt?.phase).toBe('expired')
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(f.removed).not.toHaveBeenCalled()
    f.set(signedIn)
    await f.adapter.observe(signedIn)
    f.set({ state: 'reauth-required', reason: 'expired grant' })
    await f.adapter.observe({ state: 'reauth-required', reason: 'expired grant' })
    expect(f.removed).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('streams an initial state and changes, and releases pending readers on abort or disposal', async () => {
    for (const ending of ['abort', 'dispose']) {
      const f = fixture()
      const abort = new AbortController()
      const stream = f.adapter.watch(abort.signal)[Symbol.asyncIterator]()
      expect((await stream.next()).value?.status).toBe('signed-out')
      const next = stream.next()
      f.set(signedIn)
      await f.adapter.observe(signedIn)
      expect((await next).value?.status).toBe('credential-stored')
      const pending = stream.next()
      if (ending === 'abort') abort.abort()
      else f.adapter.dispose()
      expect((await pending).done).toBe(true)
    }
  })

  it('keeps valid authentication if model selection fails and does not invent money from quota', async () => {
    const f = fixture()
    await f.adapter.startSignIn()
    vi.mocked(f.account.adoptOnboardingDefaultModel).mockRejectedValue(new Error('catalog unavailable'))
    f.set(signedIn)
    await f.adapter.observe(signedIn)
    expect((await f.adapter.getState()).attempt?.phase).toBe('succeeded')
    expect(f.selectionFailed).toHaveBeenCalledOnce()
    expect(await f.adapter.getBalance()).toEqual({ status: 'failed' })
    expect(await f.adapter.getProfile()).toEqual({ status: 'ready', value: { id: 'cqai:42', name: 'CQAI member', contact: null } })
    expect((await f.adapter.signOut()).status).toBe('signed-out')
    expect(f.removed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('delegates default selection without overriding a customized provider, model or reasoning choice', async () => {
    const f = fixture()
    const selection = { provider: 'custom-provider', model: 'chosen-model', reasoningEffort: 'high' }
    const original = { ...selection }
    vi.mocked(f.account.adoptOnboardingDefaultModel).mockImplementation(async () => selection)
    await f.adapter.startSignIn()
    f.set(signedIn)
    await f.adapter.observe(signedIn)
    expect(f.account.adoptOnboardingDefaultModel).toHaveBeenCalledOnce()
    expect(selection).toEqual(original)
    expect((await f.adapter.getState()).status).toBe('credential-stored')
  })

  it('registers the actual official service and never exports CQAI tokens to official consumers', async () => {
    const f = fixture()
    const home = mkdtempSync(join(tmpdir(), 'cqai-desktop-account-'))
    const ctx = new Context()
    const remove = ctx.provide('dsnAccount', f.account)
    const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
    await credentials
    const legacyKey = credentialKey('deepseek-account-platform', 'default')
    await ctx.credentials.modifyRecord(legacyKey, async () => ({ kind: 'grant', payload: { old: 'legacy record' } }))
    const authorization = ctx.plugin(AuthorizationService)
    await authorization
    const plugin = ctx.plugin(CqaiDesktopAccount)
    await plugin
    try {
      const service = ctx.deepseekAccount
      expect(await service.resolveToken('https://api.deepseek.com')).toBeUndefined()
      expect(await service.resolveToken('https://account.cqaiclub.asia')).toBeUndefined()
      expect(await service.getPlatformSession()).toBeNull()
      expect(await service.getNotifications(client)).toBeNull()
      expect(await service.getNotificationContent('notice' as never, client)).toBeNull()
      expect(await service.reportNotificationEvent('notice' as never, 'dismiss' as never, client)).toBe(false)
      expect(await ctx.credentials.readRecord(legacyKey)).toMatchObject({ kind: 'grant', payload: { old: 'legacy record' } })
      await service.rejectToken('unrelated-token')
      expect(f.account.logout).not.toHaveBeenCalled()
      expect(await service.getUnnotifiedBonuses(client)).toBeNull()
      expect(await service.ackBonusNotified('u' as never, 'b' as never, client)).toBe(false)
      expect(Object.keys(await service.getDeviceIdentity())).toEqual(['osVersion'])
    } finally {
      await plugin.dispose()
      await authorization.dispose()
      await credentials.dispose()
      remove()
      rmSync(home, { recursive: true, force: true })
    }
  })
})
