// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RPC_CHANNEL } from '@cqaiclub/dsn-account/protocol'
import { DesktopOnboarding } from '../src/client/onboarding.tsx'
import type { DesktopOnboardingBridge, DesktopOnboardingSnapshot } from '../src/setup-onboarding-bridge.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: ({ children, variant: _variant, icon: _icon, ...props }: Record<string, unknown>) => createElement('button', props, children as ReactNode),
    Toast: () => null,
  }
})

let root: Root | undefined
let container: HTMLDivElement | undefined

const pending: DesktopOnboardingSnapshot = {
  required: false,
  accountPending: true,
  profile: 'main',
  edition: 'desktop',
  input: {} as DesktopOnboardingSnapshot['input'],
}

async function mount(call: (channel: string, endpoint: string, payload: unknown) => Promise<unknown>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
  const bridge: DesktopOnboardingBridge = {
    read: vi.fn(async () => pending),
    finish: vi.fn(async () => {}),
    dismissAccount: vi.fn(async () => {}),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const props = {
    bridge,
    content: () => null,
    accountContext: { connection: { rpc: { call } } },
    zh: true,
    renderSurface: (children: ReactNode) => children,
    renderLoading: () => createElement('span', null, '正在加载'),
    renderNext: () => null,
    renderNavigation: () => null,
  } as unknown as Parameters<typeof DesktopOnboarding>[0]
  await act(async () => { root!.render(createElement(DesktopOnboarding, props)) })
  return { bridge, node: container }
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.unstubAllGlobals()
})

describe('Desktop CQAI Club login continuation', () => {
  it('uses the CQAI Host authorization and prepares the default model before completing', async () => {
    const calls: string[] = []
    const { bridge, node } = await mount(async (channel, endpoint) => {
      expect(channel).toBe(RPC_CHANNEL)
      calls.push(endpoint)
      if (endpoint === 'snapshot/get') return { ok: true, value: { state: 'signed-out' } }
      if (endpoint === 'authorization/start') return { ok: true, value: { state: 'signed-in',
        account: { platform: 'logto', userId: 'user' }, refreshedAt: 1, stale: false } }
      if (endpoint === 'models/default/adopt-onboarding') return { ok: true, value: {} }
      throw new Error(`Unexpected endpoint: ${endpoint}`)
    })

    expect(node.textContent).toContain('登录 CQAI Club')
    expect(node.textContent).not.toContain('DeepSeek')
    const login = [...node.querySelectorAll('button')].find(button => button.textContent === '登录 CQAI Club')!
    await act(async () => { login.click() })

    expect(calls).toContain('authorization/start')
    expect(calls).toContain('models/default/adopt-onboarding')
    expect(bridge.dismissAccount).toHaveBeenCalledWith('main')
    expect(node.querySelector('.dshDesktopAccountSetup')).toBeNull()
  })

  it('lets a user skip CQAI login without starting authorization', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint !== 'snapshot/get') throw new Error(`Unexpected endpoint: ${endpoint}`)
      return { ok: true, value: { state: 'signed-out' } }
    })
    const { bridge, node } = await mount(call)
    const skip = [...node.querySelectorAll('button')].find(button => button.textContent === '暂时跳过')!
    await act(async () => { skip.click() })

    expect(bridge.dismissAccount).toHaveBeenCalledWith('main')
    expect(call.mock.calls.map(([_channel, endpoint]) => endpoint)).toEqual(['snapshot/get'])
  })
})
