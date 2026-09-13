// @vitest-environment jsdom

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null,
  Modal: () => null,
  StateDot: () => null,
  Tag: () => null,
}))
vi.mock('../src/client/rpc.ts', () => ({ rpcCall: rpc.call }))

import { apply } from '../src/client/index.tsx'

type SlotRegistration = {
  readonly options: Record<string, unknown>
  readonly render: (props: Record<string, unknown>) => ReactElement
}

let root: Root | undefined
let container: HTMLDivElement | undefined

function clientHarness(): {
  readonly ctx: ClientContext
  readonly registrations: SlotRegistration[]
} {
  const registrations: SlotRegistration[] = []
  const ctx = {
    locale: {
      bind: () => (key: string) => key,
      register: vi.fn(() => () => undefined),
    },
    effect: (setup: () => unknown) => setup(),
    slots: {
      inject: (_name: string, setup: () => unknown) => setup(),
      register: (
        options: Record<string, unknown>,
        render: (props: Record<string, unknown>) => ReactElement,
      ) => {
        registrations.push({ options, render })
        return () => undefined
      },
    },
  } as unknown as ClientContext
  return { ctx, registrations }
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('CQAI account client registration', () => {
  it('places CQAI login between the welcome notice and DeepSeek onboarding', () => {
    const { ctx, registrations } = clientHarness()

    apply(ctx)

    expect(registrations.map(registration => registration.options)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'settings.onboarding',
        id: 'cqaiclub-account',
        order: -50,
      }),
    ]))
  })

  it('continues to DeepSeek onboarding when the account Host RPC is unavailable', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    rpc.call.mockRejectedValueOnce(new Error('account host unavailable'))
    const { ctx, registrations } = clientHarness()
    apply(ctx)
    const onboarding = registrations.find(registration => registration.options.id === 'cqaiclub-account')
    if (onboarding === undefined) throw new Error('CQAI onboarding registration is missing')
    const complete = vi.fn()
    const inject = onboarding.options.inject as () => Record<string, unknown>
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(onboarding.render, {
        ...inject(),
        complete,
        openSection: vi.fn(),
        stepId: 'cqaiclub-account',
        t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(rpc.call).toHaveBeenCalledWith(ctx, 'snapshot/get', {}, expect.any(AbortSignal))
    expect(complete).toHaveBeenCalledOnce()
    expect(container.childElementCount).toBe(0)
  })
})
