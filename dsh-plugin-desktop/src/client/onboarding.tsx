/** Sequence existing Desktop setup content inside the official onboarding surface. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { Button, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { RPC_CHANNEL, type DsnAccountSnapshot } from '@cqaiclub/dsn-account/protocol'
import type { DesktopOnboardingBridge, DesktopOnboardingSnapshot } from '../setup-onboarding-bridge.ts'

export type SetupNavigation = PropsRuntime<'onboarding.desktop.before'>['renderNavigation']
export type SetupContent = (snapshot: DesktopOnboardingSnapshot, locale: 'zh' | 'en', finish: DesktopOnboardingBridge['finish'], renderNavigation: SetupNavigation) => ReactNode

function pendingSnapshot(value: DesktopOnboardingSnapshot | null): DesktopOnboardingSnapshot | null {
  return value?.required || value?.accountPending || value?.restartPending ? value : null
}

export function registerDesktopOnboarding(ctx: Context, content: SetupContent): void {
  const bridge = (window as unknown as { dshDesktopSetup?: DesktopOnboardingBridge }).dshDesktopSetup
  if (!bridge) return
  ctx.slots.inject('onboarding.desktop.before', () => ctx.slots.register({
    name: 'onboarding.desktop.before', inject: () => ({ bridge, content, accountContext: ctx, zh: ctx.locale.getLocale().active.startsWith('zh') }),
  }, DesktopOnboarding))
}

type AccountRpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

async function accountRpc<T>(ctx: Context, endpoint: string, payload: unknown): Promise<T> {
  const connection = (ctx as Context & { connection: ConnectionHandle }).connection
  const result = await connection.rpc.call(RPC_CHANNEL, endpoint, payload) as AccountRpcResult<T>
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export function DesktopOnboarding({ bridge, content, accountContext, zh, renderSurface, renderLoading, renderNext, renderNavigation, accountStatus, openLogin }: PropsRuntime<'onboarding.desktop.before'> & {
  bridge: DesktopOnboardingBridge; content: SetupContent; accountContext: Context; zh: boolean
}) {
  const primaryCqai = (globalThis as typeof globalThis & { dshDesktop?: { cqaiPrimaryLogin?: unknown } })
    .dshDesktop?.cqaiPrimaryLogin === true
  const [snapshot, setSnapshot] = useState<DesktopOnboardingSnapshot | null>()
  const [error, setError] = useState('')
  const [account, setAccount] = useState<DsnAccountSnapshot>()
  const [accountError, setAccountError] = useState('')
  const [revision, refresh] = useState(0)
  const [accountRetry, retryAccount] = useState(0)
  const [busy, setBusy] = useState(false)
  const loginStarted = useRef(false)
  useEffect(() => {
    let disposed = false
    void bridge.read().then(value => {
      if (disposed) return
      setError('')
      setSnapshot(pendingSnapshot(value))
    }).catch(cause => { if (!disposed) setError(String(cause)) })
    return () => { disposed = true }
  }, [bridge, revision])
  useEffect(() => {
    if (primaryCqai || !snapshot?.accountPending || snapshot.required || accountStatus !== 'credential-stored') return
    let disposed = false
    void bridge.dismissAccount(snapshot.profile).then(async () => {
      const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null
      if (!disposed) setSnapshot(next)
    }).catch(cause => { if (!disposed) setError(String(cause)) })
    return () => { disposed = true }
  }, [accountStatus, bridge, primaryCqai, snapshot])
  useEffect(() => {
    if (!primaryCqai || !snapshot?.accountPending || snapshot.required) return
    let disposed = false
    const poll = () => {
      void accountRpc<DsnAccountSnapshot>(accountContext, 'snapshot/get', {}).then(next => {
        if (!disposed) setAccount(next)
      }).catch(cause => { if (!disposed) setAccountError(String(cause)) })
    }
    poll()
    const timer = window.setInterval(poll, 2_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [accountContext, primaryCqai, snapshot?.accountPending, snapshot?.required])
  useEffect(() => {
    if (!primaryCqai || !snapshot?.accountPending || snapshot.required || account?.state !== 'signed-in') return
    let disposed = false
    setBusy(true)
    void (async () => {
      if (loginStarted.current) await accountRpc(accountContext, 'models/default/adopt-onboarding', {})
      await bridge.dismissAccount(snapshot.profile)
      const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null
      if (!disposed) { setAccountError(''); setSnapshot(next) }
    })().catch(cause => { if (!disposed) setAccountError(String(cause)) })
      .finally(() => { if (!disposed) setBusy(false) })
    return () => { disposed = true }
  }, [account?.state, accountContext, accountRetry, bridge, primaryCqai, snapshot?.accountPending, snapshot?.profile, snapshot?.required, snapshot?.restartPending])
  if (error) return renderSurface(<div role="alert" style={{ padding: 48 }}>
    <p>{error}</p><Button onClick={() => { setError(''); setSnapshot(undefined); refresh(value => value + 1) }}>{zh ? '重试' : 'Retry'}</Button>
  </div>)
  if (snapshot === undefined) return renderLoading()
  if (snapshot === null) return renderNext()
  if (!snapshot.required && !snapshot.accountPending) {
    // Use the official transient portal; onboarding-only styles are inactive
    // once this continuation returns to the ordinary shell.
    const apply = async () => {
      if (busy || !bridge.applyPending) return
      setBusy(true)
      try { await bridge.applyPending(snapshot.profile); setSnapshot(null) }
      catch (cause) { setError(String(cause)) }
      finally { setBusy(false) }
    }
    return <>{renderNext()}<Toast tone="success" holdMs={8000}
      text={zh ? '桌面设置已保存，下次重启后生效。' : 'Desktop settings saved. They will take effect after restarting.'}
      actions={[{ label: zh ? '立即重启' : 'Restart now', onClick: () => { void apply() } }]}
      onDone={() => { setSnapshot(null) }} /></>
  }
  if (!snapshot.required) {
    if (!primaryCqai) {
      if (accountStatus === 'credential-stored') return renderLoading()
      const dismiss = async (login: boolean) => {
        if (busy) return
        setBusy(true)
        try {
          await bridge.dismissAccount(snapshot.profile)
          const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null
          setSnapshot(next)
          if (login) openLogin()
        } catch (cause) { setError(String(cause)) }
        finally { setBusy(false) }
      }
      return renderSurface(<section className="dshDesktopAccountSetup" aria-labelledby="desktop-account-title" aria-busy={busy}>
        <div>
          <h1 id="desktop-account-title">{zh ? '桌面设置已完成' : 'Desktop setup is complete'}</h1>
          <p>{zh ? `登录 DeepSeek，开始使用 Profile「${snapshot.profile}」。` : `Sign in to DeepSeek to get started with Profile “${snapshot.profile}”.`}</p>
          <p>{zh ? '登录后，如当前 Profile 尚未完成官方引导，将继续进行设置。你也可以在登录窗口中选择使用 API Key，或稍后登录。' : 'After sign-in, any unfinished official setup for this Profile will continue. You can also choose an API key in the sign-in dialog, or sign in later.'}</p>
          {accountStatus === 'error' && <p role="alert">{zh ? '暂时无法读取登录状态，可以稍后在账号菜单中登录。' : 'Account status is unavailable. You can sign in later from the account menu.'}</p>}
          <div className="dshDesktopAccountActions">
            <Button variant="primary" disabled={busy || accountStatus !== 'signed-out'} onClick={() => { void dismiss(true) }}>{zh ? '登录 DeepSeek' : 'Sign in to DeepSeek'}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { void dismiss(false) }}>{zh ? '暂时跳过' : 'Not now'}</Button>
          </div>
        </div>
      </section>)
    }
    const dismiss = async () => {
      if (busy) return
      setBusy(true)
      try {
        if (account?.state === 'authorizing') {
          await accountRpc(accountContext, 'authorization/cancel', { attemptId: account.attemptId })
        }
        await bridge.dismissAccount(snapshot.profile)
        const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null
        setSnapshot(next)
      } catch (cause) { setError(String(cause)) }
      finally { setBusy(false) }
    }
    const startLogin = async () => {
      if (busy) return
      setBusy(true)
      setAccountError('')
      loginStarted.current = true
      try {
        const next = await accountRpc<DsnAccountSnapshot>(accountContext, 'authorization/start', {})
        setAccount(next)
      } catch (cause) { setAccountError(String(cause)) }
      finally { setBusy(false) }
    }
    const authorizing = account?.state === 'authorizing'
    const signedIn = account?.state === 'signed-in'
    return renderSurface(<section className="dshDesktopAccountSetup" aria-labelledby="desktop-account-title" aria-busy={busy}>
      <div>
        <h1 id="desktop-account-title">{zh ? '桌面设置已完成' : 'Desktop setup is complete'}</h1>
        <p>{zh ? `登录 CQAI Club，开始使用 Profile「${snapshot.profile}」的会员模型与额度。` : `Sign in to CQAI Club to use membership models and quota in Profile “${snapshot.profile}”.`}</p>
        <p>{zh ? '登录将在系统浏览器中完成，凭据由桌面 Host 保存。你也可以稍后从账号菜单登录，继续使用其他已配置的模型。' : 'Sign-in opens in your system browser, and the desktop Host stores your credentials. You can sign in later from the account menu and continue using other configured models.'}</p>
        {authorizing && <p role="status">{zh ? '请在浏览器中完成登录，完成后将自动返回应用。' : 'Finish signing in in your browser. The app will continue automatically.'}</p>}
        {signedIn && !accountError && <p role="status">{zh ? '登录成功，正在准备模型…' : 'Signed in. Preparing models…'}</p>}
        {account?.state === 'error' && <p role="alert">{account.message}</p>}
        {account?.state === 'reauth-required' && <p role="alert">{zh ? '登录已过期，请重新登录。' : 'Your session expired. Please sign in again.'}</p>}
        {accountError && <p role="alert">{accountError}</p>}
        <div className="dshDesktopAccountActions">
          {signedIn && accountError
            ? <Button variant="primary" disabled={busy} onClick={() => { retryAccount(value => value + 1) }}>{zh ? '重试模型准备' : 'Retry model setup'}</Button>
            : authorizing
              ? <Button variant="primary" disabled={busy} onClick={() => { window.open(account.authorizationUrl, '_blank', 'noopener,noreferrer') }}>{zh ? '重新打开浏览器' : 'Reopen browser'}</Button>
              : <Button variant="primary" disabled={busy || signedIn} onClick={() => { void startLogin() }}>{zh ? '登录 CQAI Club' : 'Sign in to CQAI Club'}</Button>}
          {!signedIn && <Button variant="outline" disabled={busy} onClick={() => { void dismiss() }}>{zh ? '暂时跳过' : 'Not now'}</Button>}
        </div>
      </div>
    </section>)
  }
  return renderSurface(<div className="dshDesktopSetupContent" data-platform={snapshot.input.platform}>{content(snapshot, zh ? 'zh' : 'en', async (profile, selection) => {
    await bridge.finish(profile, selection)
    // Stable/Beta keep this renderer alive; Next still applies through its Host restart.
    if (snapshot.edition === 'desktop') {
      try { setSnapshot(pendingSnapshot(await bridge.read())) }
      catch (cause) { setError(String(cause)) }
    }
    else setSnapshot(selection === undefined ? null : undefined)
  }, renderNavigation)}</div>)
}
