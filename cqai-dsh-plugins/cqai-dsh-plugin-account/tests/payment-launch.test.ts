import { afterEach, describe, expect, it, vi } from 'vitest'

import { launchTopUpPayment } from '../src/payment-launch.ts'

describe('native payment launch', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens a direct HTTPS checkout without exposing it through another URL', async () => {
    const openExternal = vi.fn(async () => undefined)
    await launchTopUpPayment({ paymentUrl: 'https://pay.example/checkout?order=public-id' }, openExternal)
    expect(openExternal).toHaveBeenCalledWith('https://pay.example/checkout?order=public-id')
  })

  it('uses a one-time loopback form for POST fields', async () => {
    let bridgeUrl = ''
    const openExternal = vi.fn(async (target: string) => { bridgeUrl = target })
    await launchTopUpPayment({
      paymentUrl: 'https://pay.example/submit',
      paymentFields: { token: 'secret-value', description: '<CQAI>' },
    }, openExternal)

    expect(bridgeUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/cqaiclub-dsn-account\/payment\/[A-Za-z0-9_-]+$/)
    expect(bridgeUrl).not.toContain('secret-value')
    const response = await fetch(bridgeUrl)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('action="https://pay.example/submit"')
    expect(html).toContain('name="token" value="secret-value"')
    expect(html).toContain('value="&lt;CQAI&gt;"')
    await expect(fetch(bridgeUrl)).rejects.toThrow()
  })

  it('rejects remote plaintext payment targets', async () => {
    await expect(launchTopUpPayment(
      { paymentUrl: 'http://pay.example/checkout' },
      async () => undefined,
    )).rejects.toMatchObject({ code: 'DSN_PROTOCOL_ERROR' })
  })
})
