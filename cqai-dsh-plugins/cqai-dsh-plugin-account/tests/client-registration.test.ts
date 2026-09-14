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
import { CqaiModelsSettingsCard } from '../src/client/models-settings-card.tsx'

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

  it('stops showing an indefinite loading state when the account Host RPC fails', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    rpc.call.mockRejectedValue(new Error('account host unavailable'))
    const { ctx, registrations } = clientHarness()
    apply(ctx)
    const section = registrations.find(registration => registration.options.id === 'cqaiclub-dsn-account')
    if (section === undefined) throw new Error('CQAI settings registration is missing')
    const inject = section.options.inject as () => Record<string, unknown>
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(section.render, {
        ...inject(),
        t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('account host unavailable')
    expect(container.textContent).toContain('unavailable')
    expect(container.textContent).not.toContain('loading')
  })

  it('loads and saves the CQAI image default using only image-generation models', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { ctx } = clientHarness()
    rpc.call.mockImplementation(async (_ctx: ClientContext, endpoint: string) => {
      switch (endpoint) {
        case 'snapshot/get':
          return {
            state: 'signed-in',
            account: { userId: 1, platform: 'cqai' },
            remainingQuota: 10,
          }
        case 'models/list':
          return {
            fetchedAt: Date.now(),
            stale: false,
            models: [
              { id: 'chat', ownedBy: 'cqai', categories: ['text'], supportedEndpointTypes: ['openai'] },
              { id: 'image-a', ownedBy: 'cqai', categories: ['image'], supportedEndpointTypes: ['image-generation'] },
              { id: 'image-b', ownedBy: 'cqai', categories: ['image'], supportedEndpointTypes: ['image-generation'] },
              { id: 'image-category-only', ownedBy: 'cqai', categories: ['image'], supportedEndpointTypes: ['openai'] },
            ],
          }
        case 'models/default/get':
          return { provider: 'cqaiclub', model: 'chat' }
        case 'models/category-defaults/get':
          return {
            global: { provider: 'cqaiclub', model: 'chat' },
            categories: { image: { provider: 'cqaiclub', model: 'image-a' } },
          }
        case 'models/category-defaults/set':
          return {
            global: { provider: 'cqaiclub', model: 'chat' },
            categories: { image: { provider: 'cqaiclub', model: 'image-b' } },
          }
        default:
          throw new Error(`unexpected RPC: ${endpoint}`)
      }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(CqaiModelsSettingsCard, {
        ctx,
        t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const imageSelect = container.querySelector<HTMLSelectElement>('select[aria-label="modelsImageDefault"]')
    expect(imageSelect?.value).toBe('image-a')
    expect([...imageSelect!.options].map(option => option.value)).toEqual(['', 'image-a', 'image-b'])

    await act(async () => {
      imageSelect!.value = 'image-b'
      imageSelect!.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(rpc.call).toHaveBeenCalledWith(ctx, 'models/category-defaults/set', {
      category: 'image',
      model: 'image-b',
    })
    expect(imageSelect?.value).toBe('image-b')
  })
})
