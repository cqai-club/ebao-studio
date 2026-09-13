import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  type DsnAccountSnapshot,
  type DsnTopUpHistory,
  type DsnTopUpInfo,
  type DsnTopUpOption,
  type DsnTopUpRequest,
} from '../protocol.ts'
import {
  formatQuotaBalance,
  formatTopUpAmount,
  formatTopUpCredit,
  formatUsdAmount,
  quotaDisplayUnit,
} from '../quota-display.ts'
import {
  CqaiModelsSettingsCard,
  modelsSettingsEn,
  modelsSettingsZh,
} from './models-settings-card.tsx'
import { rpcCall } from './rpc.ts'

const NS = 'cqaiclub-dsn-account' as const

const zh = {
  tab: 'CQAI Club',
  eyebrow: '账户与云服务',
  title: 'CQAI Club',
  description: '连接会员账号，在桌面端共享模型、额度与服务。',
  login: '使用浏览器登录',
  openingBrowser: '正在打开浏览器…',
  signedOut: '未连接',
  authorizing: '等待浏览器',
  openLogin: '重新打开浏览器',
  cancel: '取消登录',
  signedIn: '已连接',
  loading: '正在读取账号状态…',
  connectTitle: '连接你的 CQAI Club 账号',
  connectDescription: '我们会打开系统默认浏览器完成安全登录。完成后，这里会自动更新。',
  browserStep: '在系统浏览器中验证身份',
  returnStep: '验证完成后自动返回桌面端',
  localSecurity: '登录凭据由桌面 Host 安全保存，不会发送到界面或业务插件。',
  waitingTitle: '请在浏览器中完成登录',
  waitingDescription: '此窗口可以保持打开，CQAI Club 会在授权完成后自动连接。',
  connectedAs: '当前账号',
  account: '账号',
  username: '用户名',
  email: '邮箱',
  quota: '剩余额度',
  quotaDescription: 'CQAI Club 可用额度',
  billing: '账户充值',
  billingDescription: '选择充值方式与金额，随后在系统浏览器中完成支付。',
  billingLoading: '正在读取充值方式…',
  billingUnavailable: '暂时没有可用的在线充值方式。',
  paymentMethod: '充值方式',
  paymentChoice: '支付渠道',
  amount: '充值金额',
  customAmount: '输入其他金额',
  minimumAmount: '最低充值金额',
  creditedEstimate: '预计到账',
  settlementHint: '实际付款金额以支付页面显示为准。',
  paidAmount: '实付',
  creditedAmount: '到账',
  product: '充值套餐',
  continuePayment: '前往支付',
  creatingPayment: '正在创建订单…',
  paymentOpened: '支付页面已在系统浏览器中打开。',
  paymentReturnHint: '支付完成后返回 易宝工坊，额度会自动刷新。',
  paymentRefresh: '我已完成支付，刷新额度',
  recentTopUps: '最近充值',
  noTopUps: '暂无充值记录。',
  refreshBilling: '刷新充值信息',
  invalidAmount: '请输入不低于最低金额的整数。',
  refresh: '刷新账号',
  refreshing: '刷新中…',
  logout: '退出登录',
  accountTab: '账户',
  billingTab: '充值',
  configurationError: '当前插件尚未完成管理员配置。',
  unavailable: '账号服务暂时不可用。',
  ...modelsSettingsZh,
} as const

const en: Record<keyof typeof zh, string> = {
  tab: 'CQAI Club',
  eyebrow: 'ACCOUNT & CLOUD',
  title: 'CQAI Club',
  description: 'Connect your membership to share models, quota, and services on desktop.',
  login: 'Continue in browser',
  openingBrowser: 'Opening browser…',
  signedOut: 'Not connected',
  authorizing: 'Waiting for browser',
  openLogin: 'Reopen browser',
  cancel: 'Cancel sign-in',
  signedIn: 'Connected',
  loading: 'Checking account status…',
  connectTitle: 'Connect your CQAI Club account',
  connectDescription: 'Your default browser will open for secure sign-in. This page updates automatically when you finish.',
  browserStep: 'Verify your identity in the system browser',
  returnStep: 'Return automatically after authorization',
  localSecurity: 'Credentials stay in the desktop Host and are never sent to the interface or business plugins.',
  waitingTitle: 'Finish signing in in your browser',
  waitingDescription: 'Keep this window open. CQAI Club connects automatically when authorization finishes.',
  connectedAs: 'Current account',
  account: 'Account',
  username: 'Username',
  email: 'Email',
  quota: 'Remaining quota',
  quotaDescription: 'Available CQAI Club quota',
  billing: 'Add funds',
  billingDescription: 'Choose a payment method and amount, then finish payment in your system browser.',
  billingLoading: 'Loading payment methods…',
  billingUnavailable: 'No online payment method is currently available.',
  paymentMethod: 'Payment method',
  paymentChoice: 'Payment channel',
  amount: 'Amount',
  customAmount: 'Enter another amount',
  minimumAmount: 'Minimum amount',
  creditedEstimate: 'Estimated credit',
  settlementHint: 'The payment page shows the final amount charged.',
  paidAmount: 'Paid',
  creditedAmount: 'Credited',
  product: 'Package',
  continuePayment: 'Continue to payment',
  creatingPayment: 'Creating order…',
  paymentOpened: 'The payment page opened in your system browser.',
  paymentReturnHint: 'Return to 易宝工坊 after payment and your balance will refresh automatically.',
  paymentRefresh: 'Payment complete, refresh balance',
  recentTopUps: 'Recent top-ups',
  noTopUps: 'No top-up records yet.',
  refreshBilling: 'Refresh billing',
  invalidAmount: 'Enter a whole number at or above the minimum.',
  refresh: 'Refresh account',
  refreshing: 'Refreshing…',
  logout: 'Sign out',
  accountTab: 'Account',
  billingTab: 'Add funds',
  configurationError: 'The administrator has not finished configuring this plugin.',
  unavailable: 'The account service is temporarily unavailable.',
  ...modelsSettingsEn,
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'cqaiclub-dsn-account': keyof typeof zh
  }
}

type AccountSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & {
  readonly accountContext: ClientContext
}
type AccountTranslator = AccountSettingsSectionProps['t']
type SignedInSnapshot = Extract<DsnAccountSnapshot, { state: 'signed-in' }>
const panelStyle: CSSProperties = {
  display: 'grid',
  gap: 20,
  maxWidth: 760,
  padding: '8px 0 36px',
  color: 'var(--dsw-alias-label-primary, #18202a)',
}

const cardStyle: CSSProperties = {
  overflow: 'hidden',
  border: '0.5px solid var(--dsw-alias-border-l2, #dfe3e8)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))',
  boxShadow: '0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary, #18202a) 7%, transparent)',
}

const mutedTextStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary, #667180)',
  fontSize: 14,
  lineHeight: 1.6,
}

const insetStyle: CSSProperties = {
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)',
}

function BrowserIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3.6 9h16.8M8 3.9 9.5 9m6.5-5.1L14.5 9M9 14.5l3 1.8 3-1.8" /></svg>
}

function RefreshIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7M17.9 15.5A7 7 0 0 1 5.2 17" /></svg>
}

function ShieldIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5.5 5.8v5.4c0 4.2 2.7 7.8 6.5 9.8 3.8-2 6.5-5.6 6.5-9.8V5.8L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
}

function WalletIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h12" /><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" /></svg>
}

function accountName(snapshot: SignedInSnapshot): string {
  return snapshot.account.displayName
    ?? snapshot.account.username
    ?? snapshot.account.email
    ?? String(snapshot.account.userId)
}

function snapshotMessage(snapshot: DsnAccountSnapshot | undefined, t: AccountSettingsSectionProps['t']): string | undefined {
  if (snapshot?.state === 'error') {
    if (snapshot.code === 'DSN_CONFIG_INVALID') return t('configurationError')
    return snapshot.message || t('unavailable')
  }
  if (snapshot?.state === 'reauth-required') return snapshot.reason
  return undefined
}

const fieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  color: 'var(--dsw-alias-label-secondary, #667180)',
  fontSize: 12,
  fontWeight: 600,
}

const fieldControlStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 40,
  padding: '8px 11px',
  border: '0.5px solid var(--dsw-alias-border-l2, #dfe3e8)',
  borderRadius: 9,
  outline: 'none',
  background: 'var(--dsw-alias-bg-layer-2, #fff)',
  color: 'var(--dsw-alias-label-primary, #18202a)',
  font: 'inherit',
}

function paymentProductPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price)
  } catch {
    return `${price} ${currency}`
  }
}

function topUpTime(value: number | undefined): string {
  if (value === undefined) return '—'
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

type SignedInSection = 'account' | 'billing'

function SignedInTabs({ active, setActive, t }: {
  readonly active: SignedInSection
  readonly setActive: (section: SignedInSection) => void
  readonly t: AccountTranslator
}) {
  const tabs: readonly { readonly id: SignedInSection; readonly label: keyof typeof zh }[] = [
    { id: 'account', label: 'accountTab' },
    { id: 'billing', label: 'billingTab' },
  ]
  return (
    <div role="tablist" aria-label={t('tab')} style={{ display: 'flex', gap: 5, width: 'fit-content', maxWidth: '100%', padding: 4, overflowX: 'auto', borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)' }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          aria-selected={active === tab.id}
          onClick={() => setActive(tab.id)}
          role="tab"
          style={{ minHeight: 34, padding: '7px 14px', border: 0, borderRadius: 9, background: active === tab.id ? 'var(--dsw-alias-bg-layer-2, #fff)' : 'transparent', boxShadow: active === tab.id ? '0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary, #18202a) 12%, transparent)' : 'none', color: active === tab.id ? 'var(--dsw-alias-label-primary, #18202a)' : 'var(--dsw-alias-label-secondary, #667180)', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: active === tab.id ? 650 : 500, whiteSpace: 'nowrap' }}
          type="button"
        >
          {t(tab.label)}
        </button>
      ))}
    </div>
  )
}

function BillingPanel({ ctx, t, account, refreshAccount }: {
  readonly ctx: ClientContext
  readonly t: AccountTranslator
  readonly account: SignedInSnapshot['account']
  readonly refreshAccount: () => Promise<void>
}) {
  const [info, setInfo] = useState<DsnTopUpInfo>()
  const [history, setHistory] = useState<DsnTopUpHistory>()
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedChoiceId, setSelectedChoiceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [paymentPending, setPaymentPending] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [billingError, setBillingError] = useState<string>()

  const reloadBilling = useCallback(async () => {
    setLoading(true)
    setBillingError(undefined)
    try {
      const nextInfo = await rpcCall<DsnTopUpInfo>(ctx, 'billing/topup/info', {})
      setInfo(nextInfo)
      try {
        setHistory(await rpcCall<DsnTopUpHistory>(ctx, 'billing/topups/list', { page: 1, pageSize: 5 }))
      } catch {
        setHistory(undefined)
      }
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [ctx])

  useEffect(() => { void reloadBilling() }, [reloadBilling])

  useEffect(() => {
    if (info === undefined || info.paymentOptions.length === 0) return
    if (!info.paymentOptions.some(option => option.id === selectedOptionId)) {
      setSelectedOptionId(info.paymentOptions[0]!.id)
    }
  }, [info, selectedOptionId])

  const selectedOption: DsnTopUpOption | undefined = info?.paymentOptions.find(option => option.id === selectedOptionId)
  const minimumAmount = selectedOption?.minTopUp ?? info?.minTopUp ?? 1

  useEffect(() => {
    if (selectedOption === undefined) return
    if (selectedOption.kind === 'amount') {
      setAmountInput(String(info?.amountOptions[0] ?? minimumAmount))
    }
    setSelectedProductId(selectedOption.products?.[0]?.id ?? '')
    setSelectedChoiceId(selectedOption.choices?.[0]?.id ?? '')
  }, [info?.amountOptions, minimumAmount, selectedOption])

  const amount = Number(amountInput)
  const validAmount = selectedOption?.kind !== 'amount'
    || (Number.isSafeInteger(amount) && amount >= minimumAmount)
  const validProduct = selectedOption?.kind !== 'product' || selectedProductId.length > 0
  const canCreate = selectedOption !== undefined && validAmount && validProduct && !creating

  const refreshAfterPayment = useCallback(async () => {
    setPaymentPending(false)
    const results = await Promise.allSettled([refreshAccount(), reloadBilling()])
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      setBillingError(failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
    }
  }, [refreshAccount, reloadBilling])

  useEffect(() => {
    if (!paymentPending) return
    const focus = () => { void refreshAfterPayment() }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [paymentPending, refreshAfterPayment])

  const createPayment = async () => {
    if (!canCreate || selectedOption === undefined) return
    const request: DsnTopUpRequest = selectedOption.kind === 'product'
      ? { paymentOptionId: selectedOption.id, productId: selectedProductId }
      : {
          paymentOptionId: selectedOption.id,
          amount,
          ...(selectedChoiceId ? { choiceId: selectedChoiceId } : {}),
        }
    setCreating(true)
    setBillingError(undefined)
    setNotice(undefined)
    try {
      await rpcCall<{ orderId?: string }>(ctx, 'billing/topups/launch', request)
      setNotice(t('paymentOpened'))
      setPaymentPending(true)
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', padding: '18px 20px', borderBottom: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)' }}>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><WalletIcon />{t('billing')}</strong>
          <p style={{ ...mutedTextStyle, margin: '4px 0 0', fontSize: 12 }}>{t('billingDescription')}</p>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon />} disabled={loading || creating} onClick={() => { void reloadBilling() }}>{t('refreshBilling')}</Button>
      </div>
      <div style={{ display: 'grid', gap: 18, padding: 20 }}>
        {billingError !== undefined ? <div role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13 }}>{billingError}</div> : null}
        {notice !== undefined ? (
          <div role="status" style={{ padding: '11px 13px', borderRadius: 10, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 8%, transparent)', color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13 }}>
            <strong style={{ display: 'block', color: 'var(--dsw-alias-label-primary, #18202a)' }}>{notice}</strong>
            <span>{t('paymentReturnHint')}</span>
          </div>
        ) : null}
        {loading && info === undefined ? <p style={{ ...mutedTextStyle, margin: 0 }}>{t('billingLoading')}</p> : info === undefined || info.paymentOptions.length === 0 ? <p style={{ ...mutedTextStyle, margin: 0 }}>{t('billingUnavailable')}</p> : (
          <>
            <div style={fieldLabelStyle}>
              <span>{t('paymentMethod')}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {info.paymentOptions.map(option => <Button key={option.id} variant={selectedOptionId === option.id ? 'primary' : 'outline'} size="sm" disabled={creating} onClick={() => setSelectedOptionId(option.id)}>{option.name}</Button>)}
              </div>
            </div>
            {selectedOption?.kind === 'amount' ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={fieldLabelStyle}>
                  <span>{t('amount')}</span>
                  {info.amountOptions.length > 0 ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{info.amountOptions.map(optionAmount => <Button key={optionAmount} variant={amount === optionAmount ? 'primary' : 'outline'} size="sm" disabled={creating} onClick={() => setAmountInput(String(optionAmount))}>{formatTopUpAmount(optionAmount)}</Button>)}</div> : null}
                  <input aria-label={t('customAmount')} type="number" min={minimumAmount} step="1" value={amountInput} disabled={creating} onChange={event => setAmountInput(event.target.value)} style={fieldControlStyle} />
                  <span style={{ color: validAmount ? 'var(--dsw-alias-label-tertiary, #8993a1)' : 'var(--dsw-alias-state-error-primary, #b42318)', fontWeight: 400 }}>{validAmount ? `${t('minimumAmount')}: ${formatTopUpAmount(minimumAmount)}` : t('invalidAmount')}</span>
                  {validAmount ? <strong style={{ color: 'var(--dsw-alias-label-primary, #18202a)', fontSize: 13 }}>{t('creditedEstimate')}: {formatTopUpCredit(amount, account)}</strong> : null}
                </div>
                {selectedOption.choices !== undefined && selectedOption.choices.length > 0 ? (
                  <label style={fieldLabelStyle}>{t('paymentChoice')}<select value={selectedChoiceId} disabled={creating} onChange={event => setSelectedChoiceId(event.target.value)} style={fieldControlStyle}>{selectedOption.choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
                ) : null}
              </div>
            ) : null}
            {selectedOption?.kind === 'product' ? (
              <div style={fieldLabelStyle}>
                <span>{t('product')}</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 9 }}>
                  {selectedOption.products?.map(product => (
                    <button key={product.id} type="button" disabled={creating} onClick={() => setSelectedProductId(product.id)} style={{ ...insetStyle, padding: 14, border: selectedProductId === product.id ? '1px solid var(--dsw-alias-state-business-primary, #2f6fda)' : '1px solid transparent', color: 'inherit', cursor: creating ? 'default' : 'pointer', textAlign: 'left' }}>
                      <strong style={{ display: 'block', marginBottom: 5 }}>{product.name}</strong>
                      <span style={{ color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 12 }}>{paymentProductPrice(product.price, product.currency)} · {formatQuotaBalance(product.quota, account)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedOption?.kind === 'amount' ? <span style={{ ...mutedTextStyle, fontSize: 12 }}>{t('settlementHint')}</span> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              {paymentPending ? <Button variant="outline" disabled={creating} onClick={() => { void refreshAfterPayment() }}>{t('paymentRefresh')}</Button> : null}
              <Button variant="primary" icon={<WalletIcon />} disabled={!canCreate} onClick={() => { void createPayment() }}>{creating ? t('creatingPayment') : t('continuePayment')}</Button>
            </div>
          </>
        )}
      </div>
      <div style={{ padding: '15px 20px 18px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)' }}>
        <strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>{t('recentTopUps')}</strong>
        {history === undefined || history.items.length === 0 ? <span style={{ ...mutedTextStyle, fontSize: 12 }}>{t('noTopUps')}</span> : (
          <div style={{ display: 'grid', gap: 1, background: 'var(--dsw-alias-border-l1, #edf0f3)' }}>
            {history.items.map((record, index) => (
              <div key={record.id ?? record.tradeNo ?? index} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '9px 0', background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))', color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 12 }}>
                <span>{record.paymentProvider ?? record.paymentMethod ?? record.tradeNo ?? '—'}</span>
                <strong style={{ display: 'grid', justifyItems: 'end', color: 'var(--dsw-alias-label-primary, #18202a)' }}>
                  {record.money === undefined ? null : <span>{t('paidAmount')}: {formatTopUpAmount(record.money)}</span>}
                  {record.amount === undefined ? null : <span>{t('creditedAmount')}: {formatUsdAmount(record.amount, account)}</span>}
                </strong>
                <span>{record.status ?? topUpTime(record.completeTime ?? record.createTime)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function statusPresentation(snapshot: DsnAccountSnapshot | undefined): {
  dot: 'done' | 'warning' | 'ongoing' | 'error' | 'idle'
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  key: 'signedIn' | 'authorizing' | 'signedOut'
} {
  if (snapshot?.state === 'signed-in') return { dot: 'done', tone: 'success', key: 'signedIn' }
  if (snapshot?.state === 'authorizing') return { dot: 'ongoing', tone: 'warning', key: 'authorizing' }
  if (snapshot?.state === 'error') return { dot: 'error', tone: 'danger', key: 'signedOut' }
  return { dot: 'idle', tone: 'neutral', key: 'signedOut' }
}

function AccountSettingsTab({ t, accountContext: ctx }: AccountSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<DsnAccountSnapshot>()
  const [activeSection, setActiveSection] = useState<SignedInSection>('account')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const call = useCallback(async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    return rpcCall<T>(ctx, endpoint, payload)
  }, [ctx])

  useEffect(() => {
    if (ctx === undefined) return
    let active = true
    const poll = async () => {
      try {
        const next = await rpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {})
        if (active) {
          setSnapshot(next)
          setError(undefined)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, snapshot?.state === 'authorizing' ? 500 : 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [ctx, snapshot?.state])

  const identity = snapshot?.state === 'signed-in'
    ? snapshot.account.platform + ':' + snapshot.account.userId
    : undefined

  useEffect(() => {
    if (identity !== undefined) {
      setActiveSection('account')
    }
  }, [identity])

  const startLogin = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await call<DsnAccountSnapshot>('authorization/start', {}))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancelLogin = async () => {
    if (snapshot?.state !== 'authorizing') return
    setBusy(true)
    try {
      setSnapshot(await call<DsnAccountSnapshot>('authorization/cancel', { attemptId: snapshot.attemptId }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const refreshAccount = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await call<DsnAccountSnapshot>('account/refresh', {}))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [call])

  const logout = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await call<{ snapshot: DsnAccountSnapshot }>('session/logout', {})
      setSnapshot(result.snapshot)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const message = snapshotMessage(snapshot, t)
  const signedIn = snapshot?.state === 'signed-in' ? snapshot : undefined
  const authorizationUrl = snapshot?.state === 'authorizing' ? snapshot.authorizationUrl : undefined
  const status = statusPresentation(snapshot)
  const openAuthorizationUrl = () => {
    if (authorizationUrl === undefined) return
    void window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 46, height: 46, flex: 'none', borderRadius: 14, background: 'linear-gradient(145deg, #1268dc, #6047c9)', color: '#fff', boxShadow: '0 8px 22px rgba(40, 91, 200, .24)', fontSize: 15, fontWeight: 750, letterSpacing: '-0.04em' }}>CQ</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ marginBottom: 4, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 11, fontWeight: 650, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t('eyebrow')}</div>
            <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{t('title')}</h2>
            <p style={{ ...mutedTextStyle, margin: '5px 0 0' }}>{t('description')}</p>
          </div>
        </div>
        <Tag tone={status.tone}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <StateDot state={status.dot} />
            {t(status.key)}
          </span>
        </Tag>
      </div>
      {error !== undefined ? (
        <div role="alert" style={{ padding: '11px 13px', border: '0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #c63131) 35%, transparent)', borderRadius: 10, background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #c63131) 8%, transparent)', color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13, lineHeight: 1.5 }}>{error}</div>
      ) : null}
      {message !== undefined ? (
        <div role="status" style={{ padding: '11px 13px', borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)', color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13, lineHeight: 1.5 }}>{message}</div>
      ) : null}
      {signedIn !== undefined ? <SignedInTabs active={activeSection} setActive={setActiveSection} t={t} /> : null}
      {snapshot?.state === 'authorizing' ? (
        <div style={cardStyle}>
          <div style={{ display: 'grid', justifyItems: 'center', padding: '38px 30px 26px', textAlign: 'center' }}>
            <div style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, marginBottom: 18, borderRadius: 18, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 11%, transparent)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)' }}><StateDot state="ongoing" size={22} /></div>
            <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.35 }}>{t('waitingTitle')}</h3>
            <p style={{ ...mutedTextStyle, maxWidth: 470, margin: '8px 0 0' }}>{t('waitingDescription')}</p>
            <p style={{ ...mutedTextStyle, maxWidth: 470, margin: '8px 0 0', fontSize: 12 }}>{snapshot.message}</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: '18px 24px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
            <Button variant="primary" icon={<BrowserIcon />} disabled={busy} onClick={openAuthorizationUrl}>{t('openLogin')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { void cancelLogin() }}>{t('cancel')}</Button>
          </div>
        </div>
      ) : signedIn !== undefined && activeSection === 'account' ? (
        <div style={cardStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(180px, .45fr)', gap: 20, alignItems: 'stretch', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 15, minWidth: 0 }}>
              <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, flex: 'none', borderRadius: '50%', background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 13%, var(--dsw-alias-bg-base, #fff))', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 19, fontWeight: 700 }}>{accountName(signedIn).slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ marginBottom: 4, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 12 }}>{t('connectedAs')}</div>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 17, whiteSpace: 'nowrap' }}>{accountName(signedIn)}</strong>
                <div style={{ ...mutedTextStyle, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, whiteSpace: 'nowrap' }}>{signedIn.account.email ?? signedIn.account.username ?? '—'}</div>
              </div>
            </div>
            <div style={{ ...insetStyle, display: 'grid', alignContent: 'center', padding: '16px 18px' }}>
              <span style={{ color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 12 }}>{t('quotaDescription')} · {quotaDisplayUnit(signedIn.account)}</span>
              <strong style={{ marginTop: 3, fontSize: 25, lineHeight: 1.2, letterSpacing: '-0.03em' }}>{formatQuotaBalance(signedIn.remainingQuota, signedIn.account)}</strong>
            </div>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1, margin: 0, borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', background: 'var(--dsw-alias-border-l1, #edf0f3)' }}>
            {[[t('account'), accountName(signedIn)], [t('username'), signedIn.account.username ?? '—'], [t('email'), signedIn.account.email ?? '—']].map(([label, value]) => (
              <div key={label} style={{ minWidth: 0, padding: '14px 18px', background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))' }}>
                <dt style={{ marginBottom: 5, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 11 }}>{label}</dt>
                <dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, whiteSpace: 'nowrap' }}>{value}</dd>
              </div>
            ))}
          </dl>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '16px 18px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)' }}>
            <Button variant="outline" icon={<RefreshIcon />} disabled={busy} onClick={() => { void refreshAccount() }}>{busy ? t('refreshing') : t('refresh')}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { void logout() }}>{t('logout')}</Button>
          </div>
        </div>
      ) : signedIn !== undefined && activeSection === 'billing' ? (
        <BillingPanel ctx={ctx} t={t} account={signedIn.account} refreshAccount={refreshAccount} />
      ) : snapshot === undefined ? (
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 150, padding: 28 }} role="status">
          <StateDot state="ongoing" size={14} />
          <span style={mutedTextStyle}>{t('loading')}</span>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ padding: '30px 30px 24px' }}>
            <h3 style={{ margin: 0, fontSize: 19, lineHeight: 1.35 }}>{t('connectTitle')}</h3>
            <p style={{ ...mutedTextStyle, maxWidth: 560, margin: '8px 0 22px' }}>{t('connectDescription')}</p>
            <div style={{ ...insetStyle, display: 'grid', gap: 12, padding: '15px 16px' }}>
              {[t('browserStep'), t('returnStep')].map((step, index) => (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13 }}>
                  <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, flex: 'none', borderRadius: '50%', background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 11, fontWeight: 700 }}>{index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', padding: '17px 22px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 12, lineHeight: 1.5 }}><ShieldIcon />{t('localSecurity')}</span>
            <Button variant="primary" icon={<BrowserIcon />} disabled={busy} onClick={() => { void startLogin() }}>{busy ? t('openingBrowser') : t('login')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cqaiclub-dsn-account: dictionaries')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 30,
    label: () => t('tab'),
    locale: NS,
    inject: () => ({ accountContext: ctx }),
  }, (props) => <AccountSettingsTab {...props} />))

  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'cqaiclub-models',
    order: 10,
  }, () => <CqaiModelsSettingsCard ctx={ctx} t={t} />))
}
