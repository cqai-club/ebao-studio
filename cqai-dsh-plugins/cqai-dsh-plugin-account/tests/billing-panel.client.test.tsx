// @vitest-environment jsdom

import type { Context } from '@deepseek-ai/cordis'
import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingPanel, billingZh } from '../src/client/billing-panel.tsx'
import type { DsnTopUpHistory, DsnTopUpInfo, DsnTopUpRequest } from '../src/protocol.ts'

const rpcCall = vi.hoisted(() => vi.fn())
vi.mock('../src/client/rpc.ts', () => ({ rpcCall }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, size: _size, icon: _icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string
    size?: string
    icon?: ReactNode
  }) => createElement('button', { type: 'button', ...props }),
}))

const ctx = {} as Context
const account = { platform: 'relay', userId: 1 }
const topUpInfo: DsnTopUpInfo = {
  paymentOptions: [{ id: 'qr', name: '扫码充值', kind: 'amount', choices: [{ id: 'wallet', name: '扫码钱包' }] }],
  minTopUp: 10,
  amountOptions: [10, 20],
}
const emptyHistory: DsnTopUpHistory = { page: 1, pageSize: 5, total: 0, items: [] }
let container: HTMLDivElement
let root: Root | undefined

async function mount(openPayment?: (request: DsnTopUpRequest) => Promise<void>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(BillingPanel, {
      ctx, account, t: key => billingZh[key], openPayment, refreshAccount: async () => {},
    }))
  })
}

function button(label: string) {
  const element = [...container.querySelectorAll('button')].find(item => item.textContent === label)
  if (!element) throw new Error(`Button not found: ${label}`)
  return element
}

function statuses() {
  return [...container.querySelectorAll('[role="status"]')].map(element => element.textContent)
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('shared account recharge panel', () => {
  it('announces history loading, failure, and a successful empty retry separately', async () => {
    let rejectHistory!: (reason: Error) => void
    rpcCall.mockResolvedValueOnce(topUpInfo).mockReturnValueOnce(new Promise((_, reject) => {
      rejectHistory = reject
    })).mockResolvedValueOnce(topUpInfo).mockResolvedValueOnce(emptyHistory)

    await mount()
    expect(statuses()).toContain(billingZh.historyLoading)
    expect(statuses()).not.toContain(billingZh.noTopUps)
    await act(async () => rejectHistory(new Error('history unavailable')))
    expect(statuses()).toContain(billingZh.historyUnavailable)
    expect(statuses()).not.toContain(billingZh.noTopUps)
    await act(async () => button(billingZh.refreshBilling).click())
    expect(statuses()).toContain(billingZh.noTopUps)
    expect(statuses()).not.toContain(billingZh.historyUnavailable)
  })

  it('exposes amount validity and lets the desktop opener own the payment submission', async () => {
    rpcCall.mockResolvedValueOnce(topUpInfo).mockResolvedValueOnce(emptyHistory)
    let opened!: () => void
    const openPayment = vi.fn(() => new Promise<void>(resolve => { opened = resolve }))
    await mount(openPayment)
    const amount = container.querySelector('input')!
    expect(amount.style.outline).toBe('')
    expect(amount.getAttribute('aria-invalid')).toBe('false')
    expect(document.getElementById(amount.getAttribute('aria-describedby')!)?.textContent).toContain(billingZh.minimumAmount)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '9')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(button(billingZh.continuePayment).disabled).toBe(true)
    await act(async () => button('20').click())
    await act(async () => button(billingZh.continuePayment).click())
    expect(openPayment).toHaveBeenCalledWith({ paymentOptionId: 'qr', amount: 20, choiceId: 'wallet' })
    expect(rpcCall).toHaveBeenCalledTimes(2)
    expect(button(billingZh.creatingPayment).disabled).toBe(true)
    expect(statuses().join('')).not.toContain(billingZh.paymentOpened)
    await act(async () => opened())
    expect(statuses().join('')).toContain(billingZh.paymentOpened)
  })

  it('uses the original host launch RPC when no opener is supplied', async () => {
    rpcCall.mockResolvedValueOnce(topUpInfo).mockResolvedValueOnce(emptyHistory).mockResolvedValueOnce({})
    await mount()
    await act(async () => button(billingZh.continuePayment).click())
    expect(rpcCall).toHaveBeenLastCalledWith(ctx, 'billing/topups/launch', {
      paymentOptionId: 'qr', amount: 10, choiceId: 'wallet',
    })
    expect(statuses().join('')).toContain(billingZh.paymentOpened)
  })
})
