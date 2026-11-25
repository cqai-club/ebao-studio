/** Product-owned account Provider for the unmodified official Desktop shell. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { release } from 'node:os'
import { DeepSeekAccount, type AccountClientMetadata, type AccountNotificationEvent, type AccountNotificationId,
  type AccountUpdate, type SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account'
import type { DsnAccountService, DsnAccountSnapshot } from '@cqaiclub/dsn-account/protocol'
import { CqaiDesktopAccountAdapter, type Config } from './adapter.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dsn-account/changed'(snapshot: DsnAccountSnapshot): void
  }
}

export type { Config } from './adapter.ts'
export { CqaiDesktopAccountAdapter } from './adapter.ts'

export class CqaiDesktopAccount extends DeepSeekAccount {
  // Keep the official RC5 account dependencies alongside the CQAI service.
  // Static injection replaces the parent declaration, so omitting these
  // services makes the inherited DeepSeekAccount constructor fail at startup.
  static inject = ['dsnAccount', 'credentials', 'authorization']
  private readonly adapter: CqaiDesktopAccountAdapter

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    const account = (ctx as Context & { dsnAccount: DsnAccountService }).dsnAccount
    this.adapter = new CqaiDesktopAccountAdapter(account, config, expired => {
      ctx.emit('deepseek-account/signed-out')
      if (expired) ctx.emit('deepseek-account/session-expired')
    }, () => { console.warn('[cqai-desktop-account] Default model selection is unavailable; the CQAI login remains valid.') })
    const stop = ctx.on('dsn-account/changed', (snapshot: DsnAccountSnapshot) => {
      void this.adapter.observe(snapshot).catch(() => { console.warn('[cqai-desktop-account] Account state update failed.') })
    })
    ctx.effect(() => () => { stop(); this.adapter.dispose() }, 'cqai-desktop-account: account lifecycle')
    // Keep the official Remote method metadata on DeepSeekAccount's prototype.
    // Instance overrides preserve RC5 argument descriptors while routing the
    // implementation through the CQAI adapter.
    Object.assign(this, {
      getState: () => this.adapter.getState(),
      getProfile: (_client: AccountClientMetadata) => this.adapter.getProfile(),
      getBalance: (_client: AccountClientMetadata) => this.adapter.getBalance(),
      getNotifications: async (_client: AccountClientMetadata) => null,
      getNotificationContent: async (_id: AccountNotificationId, _client: AccountClientMetadata) => null,
      reportNotificationEvent: async (_id: AccountNotificationId, _event: AccountNotificationEvent, _client: AccountClientMetadata) => false,
      startSignIn: (_client: AccountClientMetadata, _callbackOrigin: string, _loginSource: 'web' | 'desktop') => this.adapter.startSignIn(),
      cancelSignIn: (id: SignInAttemptId) => this.adapter.cancelSignIn(id),
      signOut: (_client: AccountClientMetadata) => this.adapter.signOut(),
      watchState: (signal: AbortSignal) => this.watchAdapter(signal),
    })
  }

  /** CQAI owns its grant lifecycle. Leave any legacy Platform record untouched. */
  async [Service.init](): Promise<void> {}

  private async *watchAdapter(signal: AbortSignal): AsyncIterable<AccountUpdate> {
    for await (const state of this.adapter.watch(signal)) yield { type: 'snapshot', state }
  }

  /** Compatibility no-ops for callers built against older account contracts. */
  async getUnnotifiedBonuses(_client: AccountClientMetadata) { return null }
  async ackBonusNotified(_accountId: string, _orderId: string, _client: AccountClientMetadata) { return false }
  // CQAI's own route resolves credentials. Official model and embedded-Platform
  // consumers must never obtain a CQAI token through these service operations.
  async resolveToken(_url: string) { return undefined }
  async rejectToken(_token: string) {}
  async getPlatformSession() { return null }
  async getDeviceIdentity() { return { osVersion: release() } }
}

export default CqaiDesktopAccount
