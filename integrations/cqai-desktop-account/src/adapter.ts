/** Translate CQAI's real account lifecycle into the official Desktop account contract. */
import { randomUUID } from 'node:crypto'
import type {
  AccountDetails, AccountLinks, AccountView, SignInAttemptId, SignInAttemptView, SignInErrorCode,
} from '@deepseek-ai/dsh-deepseek-account/types'
import type { DsnAccountService, DsnAccountSnapshot } from '@cqaiclub/dsn-account/protocol'

export interface Config {
  issuer?: string
  usageUrl?: string
  topUpUrl?: string
}

export type CqaiAccountOperations = Pick<DsnAccountService,
  'getStatus' | 'getAccount' | 'startAuthorization' | 'cancelAuthorization' | 'logout' | 'adoptOnboardingDefaultModel'>

function httpsUrl(value: string, subject: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`CQAI Desktop: ${subject} must be an HTTPS URL without credentials or fragment`)
  }
  return url
}

function failureCode(error: unknown): SignInErrorCode {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 'DSN_LOGIN_EXPIRED') return 'expired'
  if (code === 'DSN_CONFIG_INVALID' || code === 'DSN_PROTOCOL_ERROR' || code === 'DSN_CLIENT_FORBIDDEN') return 'protocol'
  return 'network'
}

const terminal = (phase: SignInAttemptView['phase']) => ['succeeded', 'cancelled', 'expired', 'failed'].includes(phase)

interface Attempt {
  id: SignInAttemptId
  sourceId?: string
  controller: AbortController
  cancelled: boolean
}

/** No credentials or raw protocol errors enter the public AccountView. */
export class CqaiDesktopAccountAdapter {
  private readonly issuer: URL
  private readonly links: AccountLinks
  private loggedIn = false
  private identity: string | undefined
  private attempt: SignInAttemptView | null = null
  private active: Attempt | undefined
  private revision = 0
  private closed = false
  private readonly listeners = new Set<() => void>()
  private adoption: Promise<void> | undefined

  constructor(
    private readonly account: CqaiAccountOperations,
    config: Config = {},
    private readonly signedOut: (expired: boolean) => void = () => {},
    private readonly selectionFailure: () => void = () => {},
  ) {
    this.issuer = httpsUrl(config.issuer ?? 'https://auth.cqaiclub.asia/oidc', 'issuer')
    if (this.issuer.search) throw new Error('CQAI Desktop: issuer must not contain a query')
    this.links = {
      usageUrl: httpsUrl(config.usageUrl ?? 'https://cqaiclub.asia/', 'usage URL').href,
      topUpUrl: httpsUrl(config.topUpUrl ?? 'https://cqaiclub.asia/', 'top-up URL').href,
    }
  }

  private view(): AccountView {
    return {
      status: this.loggedIn ? 'credential-stored' : 'signed-out',
      links: { ...this.links },
      attempt: this.attempt === null ? null : { ...this.attempt },
    }
  }

  private publish(): void { for (const listener of this.listeners) listener() }

  private authorizationUrl(value: string): string {
    const url = httpsUrl(value, 'authorization URL')
    if (url.origin !== this.issuer.origin || ['access_token', 'refresh_token', 'id_token', 'client_secret'].some(key => url.searchParams.has(key))) {
      throw new Error('CQAI Desktop: rejected authorization destination')
    }
    return url.href
  }

  async observe(snapshot: DsnAccountSnapshot): Promise<void> {
    if (this.closed) return
    const revision = ++this.revision
    if (snapshot.state === 'authorizing') {
      if (this.active?.cancelled && (this.active.sourceId === undefined || this.active.sourceId === snapshot.attemptId)) {
        this.active.sourceId = snapshot.attemptId
        await this.account.cancelAuthorization(snapshot.attemptId)
        return
      }
      if (this.active === undefined || (this.active.sourceId !== undefined && this.active.sourceId !== snapshot.attemptId)) {
        this.active = { id: randomUUID() as SignInAttemptId, controller: new AbortController(), cancelled: false }
      }
      this.active.sourceId = snapshot.attemptId
      try {
        if (!Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= Date.now()) throw { code: 'DSN_LOGIN_EXPIRED' }
        this.attempt = { id: this.active.id, phase: 'waiting-browser', authorizeUrl: this.authorizationUrl(snapshot.authorizationUrl), expiresAt: snapshot.expiresAt }
      } catch (error) {
        this.active.cancelled = true
        this.active.controller.abort()
        this.attempt = { id: this.active.id, phase: failureCode(error) === 'expired' ? 'expired' : 'failed', errorCode: failureCode(error) === 'expired' ? 'expired' : 'protocol' }
        await this.account.cancelAuthorization(snapshot.attemptId)
      }
      this.publish()
      return
    }
    if (snapshot.state === 'signed-in') {
      // Cancellation belongs to the CQAI credential owner. A late notification alone
      // cannot turn the official UI into an authenticated session.
      if (this.active?.cancelled) {
        const authoritative = await this.account.getStatus()
        if (this.closed || revision !== this.revision || authoritative.state !== 'signed-in') return
      }
      this.loggedIn = true
      this.identity = `${snapshot.account.platform}:${snapshot.account.userId}`
      const active = this.active
      if (active !== undefined && this.attempt !== null && !terminal(this.attempt.phase)) {
        this.attempt = { id: active.id, phase: 'committing' }
        this.publish()
        const adoption = this.adoption ?? this.account.adoptOnboardingDefaultModel(active.controller.signal)
          .then(() => {}, () => { this.selectionFailure() })
        this.adoption = adoption
        await adoption
        if (this.adoption === adoption) this.adoption = undefined
        if (this.closed || revision !== this.revision || this.active !== active) return
        this.attempt = { id: active.id, phase: 'succeeded' }
      }
      this.publish()
      return
    }
    if (snapshot.state === 'signed-out' || snapshot.state === 'reauth-required') {
      const wasLoggedIn = this.loggedIn
      this.loggedIn = false
      this.identity = undefined
      if (this.attempt !== null && !terminal(this.attempt.phase)) this.attempt = { id: this.attempt.id, phase: 'cancelled' }
      this.publish()
      if (wasLoggedIn) this.signedOut(snapshot.state === 'reauth-required')
      return
    }
    if (snapshot.state === 'error') {
      if (this.attempt === null) this.attempt = { id: randomUUID() as SignInAttemptId, phase: 'failed' }
      const cancelled = snapshot.code === 'DSN_LOGIN_CANCELLED' || this.active?.cancelled === true
      this.attempt = {
        id: this.attempt.id,
        phase: cancelled ? 'cancelled' : snapshot.code === 'DSN_LOGIN_EXPIRED' ? 'expired' : 'failed',
        ...cancelled ? {} : { errorCode: failureCode(snapshot) },
      }
      this.publish()
    }
  }

  private async refresh(): Promise<void> {
    const revision = this.revision
    const snapshot = await this.account.getStatus()
    if (!this.closed && revision === this.revision) await this.observe(snapshot)
  }

  async getState(): Promise<AccountView> { await this.refresh(); return this.view() }

  async startSignIn(): Promise<AccountView> {
    if (this.closed) throw new Error('CQAI Desktop account is closed')
    if (this.active !== undefined && this.attempt !== null && !terminal(this.attempt.phase)) return this.view()
    const active: Attempt = { id: randomUUID() as SignInAttemptId, controller: new AbortController(), cancelled: false }
    this.active = active
    this.attempt = { id: active.id, phase: 'initializing' }
    this.publish()
    try {
      const snapshot = await this.account.startAuthorization(active.controller.signal)
      if (!this.closed && this.active === active && !active.cancelled) await this.observe(snapshot)
    } catch (error) {
      if (this.closed || this.active !== active || active.cancelled) return this.view()
      this.attempt = { id: active.id, phase: failureCode(error) === 'expired' ? 'expired' : 'failed', errorCode: failureCode(error) }
      this.publish()
    }
    return this.view()
  }

  async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const active = this.active
    if (active === undefined || active.id !== id || this.attempt === null || terminal(this.attempt.phase)) return this.view()
    // Authentication has already committed; cancellation cannot revoke its grant.
    if (this.attempt.phase === 'committing') { await this.adoption; return this.view() }
    active.cancelled = true
    active.controller.abort()
    await this.account.cancelAuthorization(active.sourceId)
    if (this.active === active) {
      ++this.revision
      this.attempt = { id, phase: 'cancelled' }
      this.publish()
    }
    return this.view()
  }

  async signOut(): Promise<AccountView> {
    this.active?.controller.abort()
    if (this.active !== undefined) this.active.cancelled = true
    await this.account.logout()
    await this.refresh()
    this.active = undefined
    this.attempt = null
    this.publish()
    return this.view()
  }

  async getProfile(): Promise<AccountDetails['profile'] | null> {
    await this.refresh()
    if (!this.loggedIn) return null
    const identity = this.identity
    try {
      const account = await this.account.getAccount()
      if (!this.loggedIn || identity !== this.identity || `${account.platform}:${account.userId}` !== identity) return null
      return { status: 'ready', value: { id: `${account.platform}:${account.userId}` as never, name: account.displayName ?? account.username ?? null, contact: null } }
    } catch { return { status: 'failed' } }
  }

  async getBalance(): Promise<AccountDetails['balance'] | null> {
    return (await this.getState()).status === 'credential-stored' ? { status: 'failed' } : null
  }

  async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let wake: (() => void) | undefined
    let pending = true
    const changed = () => { pending = true; wake?.() }
    this.listeners.add(changed)
    const abort = () => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    let previous: string | undefined
    try {
      await this.refresh()
      while (!signal.aborted && !this.closed) {
        if (pending) {
          pending = false
          const value = this.view()
          const serialized = JSON.stringify(value)
          if (serialized !== previous) { previous = serialized; yield value; continue }
        }
        await new Promise<void>(resolve => { wake = resolve; if (signal.aborted || this.closed || pending) resolve() })
        wake = undefined
      }
    } finally { this.listeners.delete(changed); signal.removeEventListener('abort', abort) }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.active?.controller.abort()
    if (this.active?.sourceId !== undefined && this.attempt !== null && !terminal(this.attempt.phase)) {
      const sourceId = this.active.sourceId
      void Promise.resolve().then(() => this.account.cancelAuthorization(sourceId)).catch(() => {})
    }
    this.publish()
    this.listeners.clear()
  }
}
