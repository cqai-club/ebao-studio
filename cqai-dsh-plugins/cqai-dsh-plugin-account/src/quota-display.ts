import type { PublicAccount } from './protocol.ts'

const DEFAULT_QUOTA_PER_UNIT = 500_000

type DisplayType = 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM'

type DisplayConfig = {
  readonly type: DisplayType
  readonly quotaPerUnit: number
  readonly exchangeRate: number
  readonly symbol: string
}

/** Format a raw NewAPI quota value using the account's current display settings. */
export function formatQuotaBalance(value: number | undefined, account: PublicAccount): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const config = displayConfig(account)
  if (config.type === 'TOKENS') return formatNumber(value, 0)
  return formatDisplayValue(value / config.quotaPerUnit * config.exchangeRate, config)
}

/** Format a USD-denominated history amount using the account's display settings. */
export function formatUsdAmount(value: number | undefined, account: PublicAccount): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const config = displayConfig(account)
  if (config.type === 'TOKENS') return formatNumber(value * config.quotaPerUnit, 0)
  return formatDisplayValue(value * config.exchangeRate, config)
}

/** Format a payment input already expressed in the configured local unit. */
export function formatPaymentAmount(value: number | undefined, account: PublicAccount): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const config = displayConfig(account)
  return config.type === 'TOKENS' ? formatNumber(value, 0) : formatDisplayValue(value, { ...config, exchangeRate: 1 })
}

/** Format a top-up input without borrowing the account balance's display symbol. */
export function formatTopUpAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return formatNumber(value, Math.abs(value) >= 1 ? 2 : 4)
}

/** Format the quota credited by an amount-based top-up. */
export function formatTopUpCredit(value: number | undefined, account: PublicAccount): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (readDisplayType(account.quotaDisplayType) === 'TOKENS') return formatQuotaBalance(value, account)
  return formatQuotaBalance(value * positive(account.quotaPerUnit, DEFAULT_QUOTA_PER_UNIT), account)
}

export function quotaDisplayUnit(account: PublicAccount): string {
  const config = displayConfig(account)
  return config.type === 'TOKENS' ? 'Tokens' : config.symbol
}

function displayConfig(account: PublicAccount): DisplayConfig {
  const type = readDisplayType(account.quotaDisplayType)
  const quotaPerUnit = positive(account.quotaPerUnit, DEFAULT_QUOTA_PER_UNIT)
  if (type === 'CNY') {
    return { type, quotaPerUnit, exchangeRate: positive(account.usdExchangeRate, 1), symbol: '¥' }
  }
  if (type === 'CUSTOM') {
    return {
      type,
      quotaPerUnit,
      exchangeRate: positive(account.customCurrencyExchangeRate, 1),
      symbol: account.customCurrencySymbol?.trim() || '¤',
    }
  }
  if (type === 'TOKENS') return { type, quotaPerUnit, exchangeRate: 1, symbol: '' }
  return { type: 'USD', quotaPerUnit, exchangeRate: 1, symbol: '$' }
}

function readDisplayType(value: string | undefined): DisplayType {
  return value === 'CNY' || value === 'TOKENS' || value === 'CUSTOM' ? value : 'USD'
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function formatDisplayValue(value: number, config: DisplayConfig): string {
  const number = formatNumber(value, Math.abs(value) >= 1 ? 2 : 4)
  return config.type === 'CUSTOM' ? `${config.symbol} ${number}` : `${config.symbol}${number}`
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}
