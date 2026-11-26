import { useCallback, useEffect, useId, useState, type CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DsnTopUpHistory, DsnTopUpInfo, DsnTopUpOption, DsnTopUpRequest, PublicAccount } from '../protocol.ts'
import { formatQuotaBalance, formatTopUpAmount, formatTopUpCredit, formatUsdAmount } from '../quota-display.ts'
import { RefreshIcon, cardStyle, insetStyle, mutedTextStyle } from './account-details-card.tsx'
import { rpcCall } from './rpc.ts'

export const billingZh = {
  billingTab: '充值',
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
  paymentReturnHint: '支付完成后返回 e宝工坊，额度会自动刷新。',
  paymentRefresh: '我已完成支付，刷新额度',
  recentTopUps: '最近充值',
  historyLoading: '正在读取充值记录…',
  historyUnavailable: '暂时无法读取充值记录。',
  noTopUps: '暂无充值记录。',
  refreshBilling: '刷新充值信息',
  invalidAmount: '请输入不低于最低金额的整数。',
} as const

export type BillingKey = keyof typeof billingZh

export const billingEn: Record<BillingKey, string> = {
  billingTab: 'Add funds',
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
  paymentReturnHint: 'Return to e宝工坊 after payment and your balance will refresh automatically.',
  paymentRefresh: 'Payment complete, refresh balance',
  recentTopUps: 'Recent top-ups',
  historyLoading: 'Loading top-up records…',
  historyUnavailable: 'Could not load top-up records.',
  noTopUps: 'No top-up records yet.',
  refreshBilling: 'Refresh billing',
  invalidAmount: 'Enter a whole number at or above the minimum.',
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

function WalletIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h12" /><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" /></svg>
}

type HistoryState = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; value: DsnTopUpHistory }

export function BillingPanel({ ctx, t, account, refreshAccount, openPayment }: {
  readonly ctx: Context
  readonly t: (key: BillingKey) => string
  readonly account: PublicAccount
  readonly refreshAccount: () => Promise<void>
  readonly openPayment?: (request: DsnTopUpRequest) => Promise<void>
}) {
  const amountFeedback = useId()
  const [info, setInfo] = useState<DsnTopUpInfo>()
  const [history, setHistory] = useState<HistoryState>({ status: 'loading' })
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
    setHistory({ status: 'loading' })
    try {
      const nextInfo = await rpcCall<DsnTopUpInfo>(ctx, 'billing/topup/info', {})
      setInfo(nextInfo)
      try {
        const value = await rpcCall<DsnTopUpHistory>(ctx, 'billing/topups/list', { page: 1, pageSize: 5 })
        setHistory({ status: 'ready', value })
      } catch {
        setHistory({ status: 'unavailable' })
      }
    } catch (cause) {
      setHistory({ status: 'unavailable' })
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
      if (openPayment === undefined) await rpcCall<{ orderId?: string }>(ctx, 'billing/topups/launch', request)
      else await openPayment(request)
      setNotice(t('paymentOpened'))
      setPaymentPending(true)
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  const historyMessage = history.status === 'loading' ? t('historyLoading')
    : history.status === 'unavailable' ? t('historyUnavailable') : t('noTopUps')

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
        {loading && info === undefined ? <p role="status" style={{ ...mutedTextStyle, margin: 0 }}>{t('billingLoading')}</p> : info === undefined || info.paymentOptions.length === 0 ? <p role="status" style={{ ...mutedTextStyle, margin: 0 }}>{t('billingUnavailable')}</p> : (
          <>
            <div style={fieldLabelStyle}>
              <span>{t('paymentMethod')}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {info.paymentOptions.map(option => <Button key={option.id} variant={selectedOptionId === option.id ? 'primary' : 'outline'} aria-pressed={selectedOptionId === option.id} size="sm" disabled={creating} onClick={() => setSelectedOptionId(option.id)}>{option.name}</Button>)}
              </div>
            </div>
            {selectedOption?.kind === 'amount' ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={fieldLabelStyle}>
                  <span>{t('amount')}</span>
                  {info.amountOptions.length > 0 ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{info.amountOptions.map(optionAmount => <Button key={optionAmount} variant={amount === optionAmount ? 'primary' : 'outline'} aria-pressed={amount === optionAmount} size="sm" disabled={creating} onClick={() => setAmountInput(String(optionAmount))}>{formatTopUpAmount(optionAmount)}</Button>)}</div> : null}
                  <input aria-label={t('customAmount')} aria-describedby={amountFeedback} aria-invalid={!validAmount} type="number" min={minimumAmount} step="1" value={amountInput} disabled={creating} onChange={event => setAmountInput(event.target.value)} style={fieldControlStyle} />
                  <span id={amountFeedback} style={{ color: validAmount ? 'var(--dsw-alias-label-tertiary, #8993a1)' : 'var(--dsw-alias-state-error-primary, #b42318)', fontWeight: 400 }}>{validAmount ? `${t('minimumAmount')}: ${formatTopUpAmount(minimumAmount)}` : t('invalidAmount')}</span>
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
                    <button key={product.id} type="button" aria-pressed={selectedProductId === product.id} disabled={creating} onClick={() => setSelectedProductId(product.id)} style={{ ...insetStyle, padding: 14, border: selectedProductId === product.id ? '1px solid var(--dsw-alias-state-business-primary, #2f6fda)' : '1px solid transparent', color: 'inherit', cursor: creating ? 'default' : 'pointer', textAlign: 'left' }}>
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
        {history.status === 'ready' && history.value.items.length > 0 ? (
          <div style={{ display: 'grid', gap: 1, background: 'var(--dsw-alias-border-l1, #edf0f3)' }}>
            {history.value.items.map((record, index) => (
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
        ) : <span role="status" style={{ ...mutedTextStyle, fontSize: 12 }}>{historyMessage}</span>}
      </div>
    </div>
  )
}
