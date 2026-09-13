import { describe, expect, it } from 'vitest'

import {
  formatPaymentAmount,
  formatQuotaBalance,
  formatTopUpAmount,
  formatTopUpCredit,
  formatUsdAmount,
  quotaDisplayUnit,
} from '../src/quota-display.ts'
import type { PublicAccount } from '../src/protocol.ts'

const account = (overrides: Partial<PublicAccount>): PublicAccount => ({
  userId: 1,
  platform: 'dsn',
  quotaPerUnit: 500_000,
  ...overrides,
})

describe('configured quota display', () => {
  it('uses the production-style custom points symbol and exchange rate', () => {
    const points = account({
      quotaDisplayType: 'CUSTOM',
      customCurrencySymbol: '积分',
      customCurrencyExchangeRate: 10,
    })
    expect(formatQuotaBalance(500_000, points)).toBe('积分 10')
    expect(formatUsdAmount(2, points)).toBe('积分 20')
    expect(formatPaymentAmount(10, points)).toBe('积分 10')
    expect(formatTopUpAmount(10)).toBe('10')
    expect(formatTopUpCredit(10, points)).toBe('积分 100')
    expect(quotaDisplayUnit(points)).toBe('积分')
  })

  it('supports CNY, USD, and token-only display modes', () => {
    expect(formatQuotaBalance(500_000, account({ quotaDisplayType: 'USD' }))).toBe('$1')
    expect(formatQuotaBalance(500_000, account({ quotaDisplayType: 'CNY', usdExchangeRate: 7 }))).toBe('¥7')
    expect(formatQuotaBalance(500_000, account({ quotaDisplayType: 'TOKENS' }))).toBe('500,000')
    expect(formatUsdAmount(2, account({ quotaDisplayType: 'TOKENS' }))).toBe('1,000,000')
  })

  it('falls back safely when upstream display settings are incomplete', () => {
    expect(formatQuotaBalance(undefined, account({}))).toBe('—')
    expect(formatQuotaBalance(500_000, account({ quotaPerUnit: 0 }))).toBe('$1')
  })
})
