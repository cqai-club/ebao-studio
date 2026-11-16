/** Product-owned account Provider for the unmodified official Desktop shell. */
import type { Context } from '@deepseek-ai/cordis'
import { release } from 'node:os'
import { DeepSeekAccount, type AccountClientMetadata, type AccountBonusOrderId, type AccountUserId, type SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account'
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
  static inject = ['dsnAccount']
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
  }

  getState() { return this.adapter.getState() }
  getProfile(_client: AccountClientMetadata) { return this.adapter.getProfile() }
  getBalance(_client: AccountClientMetadata) { return this.adapter.getBalance() }
  async getUnnotifiedBonuses(_client: AccountClientMetadata) { return null }
  async ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId, _client: AccountClientMetadata) { return false }
  startSignIn(_client: AccountClientMetadata, _callbackOrigin: string, _loginSource: 'web' | 'desktop') { return this.adapter.startSignIn() }
  cancelSignIn(id: SignInAttemptId) { return this.adapter.cancelSignIn(id) }
  signOut(_client: AccountClientMetadata) { return this.adapter.signOut() }
  watch(signal: AbortSignal, _includeIdentityChanges = false) { return this.adapter.watch(signal) }
  // CQAI's own route resolves credentials. Official model and embedded-Platform
  // consumers must never obtain a CQAI token through these service operations.
  async resolveToken(_url: string) { return undefined }
  async rejectToken(_token: string) {}
  async getPlatformSession() { return null }
  async getDeviceIdentity() { return { osVersion: release() } }
}

export default CqaiDesktopAccount
