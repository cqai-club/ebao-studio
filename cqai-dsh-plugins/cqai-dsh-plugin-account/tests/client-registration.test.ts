// @vitest-environment jsdom

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { act, createElement, useEffect, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: () => null,
    IconSettingsOutlineMedium: () => null,
    IconUserOutlineMedium: () => null,
    Menu: ({ open, anchor, items, onSelect }: {
      open: boolean
      anchor: ReactNode
      items: readonly ({ id: string; label: ReactNode } | { type: 'label'; id: string; text: string })[]
      onSelect: (id: string) => void
    }) => createElement('div', null, anchor, open ? items.map(item => 'type' in item
      ? createElement('span', { key: item.id }, item.text)
      : createElement('button', {
        key: item.id,
        type: 'button',
        'data-menu-id': item.id,
        onClick: () => { onSelect(item.id) },
      }, item.label)) : null),
    Modal: () => null,
    StateDot: () => null,
    Tag: () => null,
  }
})
vi.mock('../src/client/rpc.ts', () => ({
  rpcCall: rpc.call,
  getClubMcpStatus: (ctx: ClientContext) => rpc.call(ctx, 'mcp/status', {}),
  configureClubMcp: (ctx: ClientContext, enabled: boolean) => rpc.call(ctx, 'mcp/configure', { enabled }),
  connectClubMcp: (ctx: ClientContext) => rpc.call(ctx, 'mcp/connect', {}),
  authorizeClubMcp: (ctx: ClientContext) => rpc.call(ctx, 'mcp/authorize', {}),
}))

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
  readonly selectPanel: ReturnType<typeof vi.fn>
} {
  const registrations: SlotRegistration[] = []
  const selectPanel = vi.fn()
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
  const layoutScope = Object.create(ctx) as ClientContext
  Object.defineProperty(layoutScope, 'layout', { value: { selectPanel } })
  Object.assign(ctx, {
    inject: (services: readonly string[], setup: (scope: ClientContext) => unknown) => {
      expect(services).toEqual(['layout'])
      return setup(layoutScope)
    },
  })
  return { ctx, registrations, selectPanel }
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

  it('uses the account launcher for sign-in, settings, and sign-out', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
    const { ctx, registrations } = clientHarness()
    const signedOut = { state: 'signed-out' }
    const signedIn = {
      state: 'signed-in',
      account: { userId: 1, platform: 'cqai', displayName: 'Alice' },
      refreshedAt: Date.now(),
      stale: false,
    }
    let current: object = signedOut
    rpc.call.mockImplementation(async (_ctx: ClientContext, endpoint: string) => {
      if (endpoint === 'snapshot/get') return current
      if (endpoint === 'authorization/start') {
        current = signedIn
        return current
      }
      if (endpoint === 'session/logout') {
        current = signedOut
        return { snapshot: signedOut, remoteRevoked: true }
      }
      throw new Error(`unexpected RPC: ${endpoint}`)
    })
    apply(ctx)
    const launcher = registrations.find(registration => registration.options.name === 'settings.launcher')
    if (launcher === undefined) throw new Error('CQAI launcher registration is missing')
    expect(registrations.some(registration => registration.options.name === 'settings.section' && registration.options.id === 'cqaiclub-dsn-account')).toBe(false)
    const inject = launcher.options.inject as () => Record<string, unknown>
    const openSettings = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(launcher.render, {
        ...inject(), wide: true, settingsOpen: false, openSettings,
        openOnboarding: vi.fn(), renderSlot: () => null, t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const trigger = () => container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await act(async () => { trigger().click() })
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="login"]')!.click() })
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'authorization/start', {})
    expect(trigger().textContent).toContain('Alice')

    await act(async () => { trigger().click() })
    expect(container!.textContent).toContain('launcherOpenSettings')
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="open-settings"]')!.click() })
    expect(openSettings).toHaveBeenCalledOnce()

    await act(async () => { trigger().click() })
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="logout"]')!.click() })
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'session/logout', {})
    expect(trigger().textContent).toContain('launcherSignIn')
  })

  it('keeps cancel and retry available during an interrupted browser sign-in', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
    const { ctx, registrations } = clientHarness()
    let current: object = { state: 'signed-out' }
    const authorizing = {
      state: 'authorizing', attemptId: 'attempt-1',
      authorizationUrl: 'https://auth.example.test/authorize', expiresAt: Date.now() + 60_000,
      message: 'Finish login',
    }
    rpc.call.mockImplementation(async (_ctx: ClientContext, endpoint: string) => {
      if (endpoint === 'snapshot/get') return current
      if (endpoint === 'authorization/start') {
        current = authorizing
        return current
      }
      if (endpoint === 'authorization/cancel') {
        current = { state: 'signed-out' }
        return current
      }
      throw new Error(`unexpected RPC: ${endpoint}`)
    })
    apply(ctx)
    const launcher = registrations.find(registration => registration.options.name === 'settings.launcher')!
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(launcher.render, {
        ...(launcher.options.inject as () => Record<string, unknown>)(),
        wide: true, settingsOpen: false, openSettings: vi.fn(), openOnboarding: vi.fn(),
        renderSlot: () => null,
        t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const trigger = () => container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await act(async () => { trigger().click() })
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="login"]')!.click() })
    expect(trigger().textContent).toContain('authorizing')

    await act(async () => { trigger().click() })
    expect(container!.querySelector('[data-menu-id="open-login"]')).not.toBeNull()
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="cancel-login"]')!.click() })
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'authorization/cancel', { attemptId: 'attempt-1' })

    current = { state: 'error', code: 'DSN_LOGIN_EXPIRED', message: 'Login expired', retryable: true }
    await act(async () => { trigger().click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(trigger().textContent).toContain('launcherNeedsAttention')
    expect(container!.textContent).toContain('Login expired')
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="login"]')!.click() })
    expect(rpc.call.mock.calls.filter(([, endpoint]) => endpoint === 'authorization/start')).toHaveLength(2)
    expect(trigger().textContent).toContain('authorizing')
  })

  it('shows a loaded market action in the account menu and opens it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
    rpc.call.mockResolvedValue({ state: 'signed-out' })
    const { ctx, registrations, selectPanel } = clientHarness()
    apply(ctx)
    const launcher = registrations.find(registration => registration.options.name === 'settings.launcher')!
    expect(launcher.options.children).toEqual({
      'cqaiclub.account.menu.action': { kind: 'list', scope: 'root' },
    })
    const openMarket = vi.fn()
    const MarketAction = ({ registerAction }: {
      registerAction: (action: { id: string; label: () => string; onSelect: () => void }) => () => void
    }) => {
      useEffect(() => registerAction({
        id: 'community-market', label: () => 'CQAI 插件市场', onSelect: openMarket,
      }), [registerAction])
      return null
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(launcher.render, {
        ...(launcher.options.inject as () => Record<string, unknown>)(),
        wide: true, settingsOpen: false, openSettings: vi.fn(), openOnboarding: vi.fn(),
        renderSlot: (_name: string, props: Record<string, unknown>) => createElement(MarketAction, props as Parameters<typeof MarketAction>[0]),
        t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    expect([...container!.querySelectorAll<HTMLButtonElement>('[data-menu-id]')].map(button => button.dataset.menuId)).toEqual([
      'login', 'cqaiclub-open-page', 'community-market', 'open-settings',
    ])
    await act(async () => { container!.querySelector<HTMLButtonElement>('[data-menu-id="cqaiclub-open-page"]')!.click() })
    expect(selectPanel).toHaveBeenCalledWith('cqai-club')

    await act(async () => { container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click() })
    const market = container!.querySelector<HTMLButtonElement>('[data-menu-id="community-market"]')
    expect(market?.textContent).toBe('CQAI 插件市场')
    await act(async () => { market!.click() })
    expect(openMarket).toHaveBeenCalledOnce()
  })

  it('shows points by default and reserves the activities slot', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
    rpc.call.mockResolvedValue({
      state: 'signed-in',
      account: {
        userId: 1, platform: 'cqai', displayName: 'Alice', quotaDisplayType: 'CUSTOM',
        quotaPerUnit: 500_000, customCurrencySymbol: '积分', customCurrencyExchangeRate: 10,
      },
      remainingQuota: 500_000, refreshedAt: Date.now(), stale: false,
    })
    const { ctx, registrations, selectPanel } = clientHarness()
    apply(ctx)
    const page = registrations.find(registration => registration.options.name === 'main' && registration.options.key === 'cqai-club')
    const launcher = registrations.find(registration => registration.options.name === 'settings.launcher')
    if (page === undefined || launcher === undefined) throw new Error('CQAI Club page or launcher is missing')
    expect(page.options.children).toEqual({ 'cqaiclub.club.activities': { kind: 'list', scope: 'root' } })
    const labels: Record<string, string> = {
      title: 'CQAI Club', back: '返回', pointsInfo: '积分信息', membershipInfo: '会员信息', clubActivities: '俱乐部活动',
      mcpTitle: 'MCP 服务',
      activityPluginDisabled: '活动插件未启用。',
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(page.render, {
        ...(page.options.inject as () => Record<string, unknown>)(),
        t: (key: string) => labels[key] ?? key,
        renderSlot: (_name: string, _owner: unknown, options: { fallback: ReactNode }) => options.fallback,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const nav = () => container!.querySelector<HTMLElement>('nav[aria-label="CQAI Club"]')!
    const selected = () => nav().querySelector<HTMLButtonElement>('button[aria-current="page"]')!
    const sections = () => nav().querySelectorAll<HTMLButtonElement>('.cqai-club-section')
    expect(nav().querySelector('.cqai-club-back')?.textContent).toBe('返回')
    expect([...sections()].map(button => button.textContent)).toEqual(['积分信息', '会员信息', '俱乐部活动', 'MCP 服务'])
    expect(selected().textContent).toBe('积分信息')
    expect(container!.querySelector('.cqai-club-content')?.textContent).toContain('积分 10')
    expect(container!.querySelector('.cqai-club-content')?.textContent).toContain('Alice')

    await act(async () => { sections()[1]!.click() })
    expect(selected().textContent).toBe('会员信息')
    expect(container!.querySelector('.cqai-club-content')?.textContent).toBe('会员信息')
    await act(async () => { sections()[2]!.click() })
    expect(container!.querySelector('.cqai-club-content')?.textContent).toContain('活动插件未启用。')

    rpc.call.mockImplementation(async (_ctx: ClientContext, endpoint: string) => {
      expect(endpoint).toBe('mcp/status')
      return { enabled: false, url: 'https://cqaiclub.asia/mcp', state: 'disabled', toolCount: 0 }
    })
    await act(async () => { sections()[3]!.click() })
    expect(selected().textContent).toBe('MCP 服务')
    expect(container!.querySelector('.cqai-club-content h1')?.textContent).toBe('MCP 服务')
    expect(container!.querySelector<HTMLInputElement>('input[role="switch"]')?.checked).toBe(false)
    expect(container!.querySelector('.cqai-club-content input[type="text"]')).toBeNull()
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'mcp/status', {})

    rpc.call.mockResolvedValue({ state: 'signed-out' })

    const openClub = (launcher.options.inject as () => { openClub: () => void })().openClub
    await act(async () => { openClub() })
    expect(selectPanel).toHaveBeenCalledWith('cqai-club')
    expect(selected().textContent).toBe('积分信息')
    await act(async () => { nav().querySelector<HTMLButtonElement>('.cqai-club-back')!.click() })
    expect(selectPanel).toHaveBeenLastCalledWith(null)
  })

  it('lets Stable/Beta native setup own automatic first-run login but keeps explicit entry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
    rpc.call.mockResolvedValue({ state: 'signed-out' })
    const { ctx, registrations } = clientHarness()
    apply(ctx)
    const onboarding = registrations.find(registration => registration.options.id === 'cqaiclub-account')
    if (onboarding === undefined) throw new Error('CQAI onboarding registration is missing')
    const inject = onboarding.options.inject as () => Record<string, unknown>
    const complete = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(onboarding.render, {
        ...inject(), complete, explicit: false, openSection: vi.fn(),
        stepId: 'cqaiclub-account', t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(complete).toHaveBeenCalledOnce()
    expect(rpc.call).not.toHaveBeenCalled()

    await act(async () => {
      root!.render(createElement(onboarding.render, {
        ...inject(), complete, explicit: true, openSection: vi.fn(),
        stepId: 'cqaiclub-account', t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'snapshot/get', {}, expect.any(AbortSignal))
  })

  it('preserves automatic account onboarding on Next', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('dshDesktopSetup', {})
    vi.stubGlobal('desktopNext', {})
    rpc.call.mockResolvedValue({ state: 'signed-out' })
    const { ctx, registrations } = clientHarness()
    apply(ctx)
    expect(registrations.some(registration => registration.options.name === 'settings.launcher')).toBe(false)
    expect(registrations.some(registration => registration.options.name === 'main' && registration.options.key === 'cqai-club')).toBe(false)
    expect(registrations.find(registration => registration.options.name === 'settings.section' && registration.options.id === 'cqaiclub-dsn-account')?.options.order).toBe(30)
    const onboarding = registrations.find(registration => registration.options.id === 'cqaiclub-account')
    if (onboarding === undefined) throw new Error('CQAI onboarding registration is missing')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const complete = vi.fn()
    await act(async () => {
      root!.render(createElement(onboarding.render, {
        ...(onboarding.options.inject as () => Record<string, unknown>)(),
        complete, explicit: false, openSection: vi.fn(),
        stepId: 'cqaiclub-account', t: (key: string) => key,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(complete).not.toHaveBeenCalled()
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'snapshot/get', {}, expect.any(AbortSignal))
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

  it('opens the same official MCP settings from the shared Next account section while signed out', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('desktopNext', {})
    const { ctx, registrations } = clientHarness()
    rpc.call.mockImplementation(async (_ctx: ClientContext, endpoint: string) => {
      if (endpoint === 'snapshot/get') return { state: 'signed-out' }
      if (endpoint === 'mcp/status') return { enabled: false, url: 'https://cqaiclub.asia/mcp', state: 'disabled', toolCount: 0 }
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    apply(ctx)
    const section = registrations.find(registration => registration.options.name === 'settings.section' && registration.options.id === 'cqaiclub-dsn-account')!
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(section.render, {
        ...(section.options.inject as () => Record<string, unknown>)(),
        t: (key: string) => key,
      }))
    })
    const tabs = [...container!.querySelectorAll<HTMLButtonElement>('button[role="tab"]')]
    expect(tabs.map(tab => tab.textContent)).toEqual(['accountTab', 'mcpTitle'])
    await act(async () => { tabs[1]!.click() })
    expect(container!.querySelector<HTMLInputElement>('input[role="switch"]')?.checked).toBe(false)
    expect(container!.querySelector<HTMLInputElement>('input[role="switch"]')?.disabled).toBe(false)
    expect(rpc.call).toHaveBeenCalledWith(ctx, 'mcp/status', {})
    expect(rpc.call.mock.calls.some(([, endpoint]) => endpoint === 'mcp/connect' || endpoint === 'mcp/authorize')).toBe(false)
  })

  it('stops showing an indefinite loading state when the account Host RPC fails', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('desktopNext', {})
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
