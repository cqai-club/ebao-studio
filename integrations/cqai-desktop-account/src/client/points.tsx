import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountUi, AccountUiState } from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  AccountConnectCard, accountConnectEn, accountConnectZh,
} from '../../../../cqai-dsh-plugins/cqai-dsh-plugin-account/src/client/account-connect-card.tsx'
import {
  AccountDetailsCard, accountDetailsEn, accountDetailsZh, cardStyle, mutedTextStyle,
} from '../../../../cqai-dsh-plugins/cqai-dsh-plugin-account/src/client/account-details-card.tsx'
import { BillingPanel, billingEn, billingZh, safePaymentPageUrl } from '../../../../cqai-dsh-plugins/cqai-dsh-plugin-account/src/client/billing-panel.tsx'
import { rpcCall } from '../../../../cqai-dsh-plugins/cqai-dsh-plugin-account/src/client/rpc.ts'
import type { DsnAccountSnapshot, DsnTopUpRequest } from '../../../../cqai-dsh-plugins/cqai-dsh-plugin-account/src/protocol.ts'

const en = {
  ...accountConnectEn,
  ...accountDetailsEn,
  ...billingEn,
  paymentOpened: 'Requested to open the payment page in your system browser.',
  title: 'Account points',
  connectTitle: 'Connect your e宝工坊 account',
  connectDescription: 'Complete sign-in in your browser to use your points and models in e宝工坊.',
  quotaDescription: 'Available balance',
  loading: 'Loading points…',
  signingIn: 'Complete sign-in in your browser to view your points.',
  reauthorize: 'Your session has expired. Sign in again to view your points.',
  unavailable: 'Your points balance is unavailable.',
  stale: 'Refresh failed. Showing the last available balance.',
  failed: 'Could not load your points. Try refreshing.',
  disconnected: 'Cannot read your account right now. Check your connection.',
}

type PointsKey = keyof typeof en

export const pointsLocales = {
  en,
  zh: {
    ...accountConnectZh,
    ...accountDetailsZh,
    ...billingZh,
    paymentOpened: '已请求在系统浏览器打开支付页面。',
    title: '账号积分',
    connectTitle: '连接你的 e宝工坊账号',
    connectDescription: '在浏览器中完成登录，即可在 e宝工坊使用账号积分和模型。',
    quotaDescription: '可用额度',
    loading: '正在读取积分…',
    signingIn: '请在浏览器中完成登录，登录后即可查看积分。',
    reauthorize: '登录已过期，请重新登录后查看积分。',
    unavailable: '暂未获取到积分余额。',
    stale: '刷新失败，当前显示上次获取的余额。',
    failed: '读取积分失败，请重试。',
    disconnected: '暂时无法读取账号状态，请检查连接。',
  } satisfies Record<PointsKey, string>,
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'ebao.points': PointsKey }
}

type PointsRead = {
  snapshot?: DsnAccountSnapshot
  refreshing: boolean
  failed?: 'rpc' | 'connection'
}

const loading: PointsRead = { refreshing: true }

function usePoints(accountContext: Context) {
  const [points, setPoints] = useState<PointsRead>(loading)
  const refresh = useRef<(() => Promise<void>) | undefined>(undefined)
  const refreshPoints = useCallback(async () => { await refresh.current?.() }, [])

  useEffect(() => {
    let pending: AbortController | undefined

    const stopRead = () => {
      pending?.abort()
      pending = undefined
    }

    const read = async (live: boolean) => {
      if (pending !== undefined) return
      const request = new AbortController()
      pending = request
      setPoints(previous => previous.snapshot === undefined ? loading : { snapshot: previous.snapshot, refreshing: true })
      try {
        const snapshot = await rpcCall<DsnAccountSnapshot>(
          accountContext, live ? 'account/refresh' : 'snapshot/get', {}, request.signal,
        )
        if (!request.signal.aborted) setPoints({ snapshot, refreshing: false })
      } catch {
        if (!request.signal.aborted) setPoints(previous => ({ ...previous, refreshing: false, failed: 'rpc' }))
      } finally {
        if (pending === request) pending = undefined
      }
    }

    const accountChanged = ({ view, failed }: AccountUiState, reset: boolean) => {
      if (failed || view === undefined) {
        stopRead()
        setPoints(failed ? { refreshing: false, failed: 'connection' } : loading)
        return
      }
      const signedIn = view.status === 'credential-stored'
      if (signedIn && !reset) return
      stopRead()
      setPoints(loading)
      void read(signedIn)
    }

    refresh.current = async () => {
      const { view, failed } = accountContext.accountUi.getSnapshot()
      if (!failed && view !== undefined) await read(view.status === 'credential-stored')
    }
    const unsubscribe = accountContext.on('account-ui/change', accountChanged)
    accountChanged(accountContext.accountUi.getSnapshot(), true)
    return () => {
      unsubscribe()
      stopRead()
      refresh.current = undefined
    }
  }, [accountContext])

  return { points, refresh: refreshPoints }
}

function pointsStatus({ snapshot, refreshing, failed }: PointsRead): PointsKey | undefined {
  if (failed === 'connection') return 'disconnected'
  if (refreshing) return snapshot === undefined ? 'loading' : undefined
  if (failed === 'rpc') return snapshot?.state === 'signed-in' && Number.isFinite(snapshot.remainingQuota) ? 'stale' : 'failed'
  switch (snapshot?.state) {
    case 'signed-out': return undefined
    case 'authorizing': return 'signingIn'
    case 'reauth-required': return 'reauthorize'
    case 'error': return 'failed'
    case 'signed-in':
      if (!Number.isFinite(snapshot.remainingQuota)) return 'unavailable'
      return snapshot.stale ? 'stale' : undefined
    default: return 'loading'
  }
}

type PointsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'ebao.points'> & { accountContext: Context }
type DesktopAccountUi = AccountUi & { startSignIn: () => Promise<void> }

function SignedInPoints({ ctx, snapshot, refreshing, refresh, message, t }: {
  ctx: Context
  snapshot: Extract<DsnAccountSnapshot, { state: 'signed-in' }>
  refreshing: boolean
  refresh: () => Promise<void>
  message?: string
  t: (key: PointsKey) => string
}) {
  const billingRegion = useRef<HTMLElement>(null)
  const { userId, platform } = snapshot.account
  const openPayment = async (request: DsnTopUpRequest) => {
    const payment = await rpcCall<{ paymentUrl: string }>(
      ctx, 'billing/topups/prepare-payment', { ...request, account: { userId, platform } },
    )
    const paymentUrl = safePaymentPageUrl(payment.paymentUrl)
    if (paymentUrl !== undefined) {
      try {
        // Official Desktop forwards this request to the system browser without a result.
        window.open(paymentUrl, '_blank', 'noopener,noreferrer')
      } catch {
        // The payment link remains available in the billing panel.
      }
    }
    return payment
  }
  const focusBilling = () => {
    billingRegion.current?.focus({ preventScroll: true })
    billingRegion.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <>
      <AccountDetailsCard
        t={t} snapshot={snapshot} responsive busy={refreshing} refreshAccount={refresh} statusMessage={message}
        actions={<Button variant="primary" onClick={focusBilling}>{t('billingTab')}</Button>}
      />
      <section ref={billingRegion} aria-label={t('billing')} tabIndex={-1}>
        <BillingPanel ctx={ctx} t={t} account={snapshot.account} refreshAccount={refresh} openPayment={openPayment} />
      </section>
    </>
  )
}

export function PointsSection({ accountContext, close, t }: PointsSectionProps) {
  const heading = useId()
  const { points, refresh } = usePoints(accountContext)
  const { snapshot, refreshing, failed } = points
  const status = pointsStatus(points)
  const message = status === undefined ? undefined : t(status)
  const canSignIn = snapshot?.state === 'signed-out' || snapshot?.state === 'reauth-required'
    || (snapshot?.state === 'error' && accountContext.accountUi.getSnapshot().view?.status === 'signed-out')
  const canRefresh = failed === 'rpc' || snapshot?.state === 'error'
  const startSignIn = () => {
    // The official account menu owns the same sign-in dialog and browser handoff.
    close()
    return (accountContext.accountUi as DesktopAccountUi).startSignIn().catch(() => undefined)
  }

  return (
    <section aria-labelledby={heading} style={{ display: 'grid', gap: 12, color: 'var(--dsw-alias-label-primary)' }}>
      <h2 id={heading} style={{ margin: 0, fontSize: 22, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{t('pointsInfo')}</h2>
      {snapshot?.state === 'signed-in' ? (
        <SignedInPoints key={`${snapshot.account.platform}:${snapshot.account.userId}`}
          ctx={accountContext} snapshot={snapshot} refreshing={refreshing} refresh={refresh} message={message} t={t} />
      ) : canSignIn ? (
        <>
          {message !== undefined && <p role="status" style={{ ...mutedTextStyle, margin: 0 }}>{message}</p>}
          <AccountConnectCard t={t} busy={refreshing} startSignIn={startSignIn} />
        </>
      ) : (
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, minHeight: 150, padding: 28 }}>
          {message !== undefined && <span role="status" style={{ ...mutedTextStyle, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <StateDot state={failed === undefined && snapshot?.state !== 'error' ? 'ongoing' : 'error'} size={14} />
            {message}
          </span>}
          {canRefresh && <Button variant="outline" disabled={refreshing} onClick={refresh}>{t('refresh')}</Button>}
        </div>
      )}
    </section>
  )
}
