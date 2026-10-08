// @vitest-environment jsdom

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClubMcpStatus, DsnAccountSnapshot } from '../src/mcp/protocol.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Button: ({ variant, size: _size, icon: _icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; icon?: ReactNode }) => createElement('button', { type: 'button', 'data-variant': variant, ...props }),
    Tag: ({ children }: { children: ReactNode }) => createElement('span', null, children),
    StateDot: () => null,
  }
})

import { CqaiMcpSettingsPanel, mcpSettingsEn, mcpSettingsZh } from '../src/client/mcp/mcp-settings.tsx'

const officialUrl = 'https://cqaiclub.asia/mcp'
const disabled: ClubMcpStatus = { enabled: false, url: officialUrl, state: 'disabled', toolCount: 0 }
const connected: ClubMcpStatus = { enabled: true, url: officialUrl, state: 'connected', toolCount: 12 }
const signedIn: DsnAccountSnapshot = {
  state: 'signed-in', account: { userId: 1, platform: 'cqai', displayName: 'Alice' },
  remainingQuota: 10, refreshedAt: Date.now(), stale: false,
}
let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(call: (channel: string, endpoint: string, payload: unknown) => unknown, language: 'zh' | 'en' = 'zh', on?: (event: string, callback: () => void) => () => void) {
  const ctx = { connection: { rpc: { call: (channel: string, endpoint: string, payload: unknown) => {
    expect(channel).toBe(endpoint.startsWith('mcp/') ? '/cqaiclub-mcp' : '/cqaiclub-dsn-account')
    return call(channel, endpoint, payload)
  } } }, ...(on === undefined ? {} : { on }) } as unknown as ClientContext
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const dictionary = language === 'zh' ? mcpSettingsZh : mcpSettingsEn
  await act(async () => {
    root!.render(createElement(CqaiMcpSettingsPanel, { ctx, t: key => dictionary[key] }))
  })
}

function button(text: string) {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)
  if (found === undefined) throw new Error(`Missing button: ${text}`)
  return found
}

function toggle() { return container!.querySelector<HTMLInputElement>('input[role="switch"]')! }

describe('CQAI official MCP settings mounted UI', () => {
  it.each([
    { state: 'disabled', enabled: false, actions: ['刷新状态'], primary: undefined },
    { state: 'signed-out', enabled: true, actions: ['刷新状态', '登录并授权'], primary: '登录并授权' },
    { state: 'reauth-required', enabled: true, actions: ['刷新状态', '补充授权'], primary: '补充授权' },
    { state: 'disconnected', enabled: true, actions: ['刷新状态', '补充授权', '连接服务'], primary: '连接服务' },
    { state: 'connecting', enabled: true, actions: ['刷新状态', '补充授权', '正在连接…'], primary: '正在连接…' },
    { state: 'connected', enabled: true, actions: ['刷新状态', '补充授权', '重新连接'], primary: '重新连接' },
    { state: 'error', enabled: true, actions: ['刷新状态', '补充授权', '连接服务'], primary: '连接服务' },
  ] as const)('offers the appropriate authorization or connection action for $state', async ({ state, enabled, actions, primary }) => {
    const status: ClubMcpStatus = { enabled, url: officialUrl, state, toolCount: state === 'connected' ? 12 : 0 }
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      expect(endpoint).toBe('mcp/status')
      return { ok: true, value: status }
    })
    await mount(call)
    expect([...container!.querySelectorAll('button')].map(item => item.textContent)).toEqual(actions)
    const primaryButtons = [...container!.querySelectorAll<HTMLButtonElement>('button[data-variant="primary"]')]
    expect(primaryButtons.map(item => item.textContent)).toEqual(primary === undefined ? [] : [primary])
    if (primary !== undefined) expect(button(primary).disabled).toBe(state === 'connecting')
    if (['disconnected', 'connecting', 'connected', 'error'].includes(state)) expect(button('补充授权').getAttribute('data-variant')).toBe('outline')
  })

  it('starts disabled without opening a browser or connecting and exposes no address or credentials form', async () => {
    const call = vi.fn(async (_channel: string, _endpoint: string) => ({ ok: true, value: disabled }))
    const open = vi.fn()
    vi.stubGlobal('open', open)
    await mount(call)

    expect(call.mock.calls.map(([, endpoint]) => endpoint)).toEqual(['mcp/status'])
    expect(toggle().checked).toBe(false)
    expect(toggle().getAttribute('aria-label')).toBe('启用官网 MCP 服务')
    expect(container!.textContent).toContain('未启用')
    expect(container!.querySelectorAll('input')).toHaveLength(1)
    expect(container!.querySelector('input[type="text"], input[type="password"], textarea')).toBeNull()
    expect(container!.textContent).not.toContain(officialUrl)
    expect(open).not.toHaveBeenCalled()
  })

  it('saves only enabled, connects once, shows tool count, and reconnects using the existing account', async () => {
    let status = disabled
    const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'mcp/status') return { ok: true, value: status }
      if (endpoint === 'mcp/configure') {
        expect(payload).toEqual({ enabled: true })
        status = { ...disabled, enabled: true, state: 'disconnected' }
        return { ok: true, value: status }
      }
      if (endpoint === 'mcp/connect') {
        expect(payload).toEqual(status.state === 'connected' ? { reconnect: true } : {})
        status = connected
        return { ok: true, value: status }
      }
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    await mount(call)
    await act(async () => { toggle().click() })

    expect(toggle().checked).toBe(true)
    expect(container!.textContent).toContain('MCP 服务设置已保存。')
    expect(container!.textContent).toContain('已连接')
    expect(container!.textContent).toContain('可用工具: 12')
    expect(call.mock.calls.map(([, endpoint]) => endpoint)).toEqual(['mcp/status', 'mcp/configure', 'mcp/connect'])
    await act(async () => { button('重新连接').click() })
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'mcp/connect')).toHaveLength(2)
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'mcp/connect').map(([, , payload]) => payload)).toEqual([{}, { reconnect: true }])
    expect(call.mock.calls.some(([, endpoint]) => endpoint === 'authorization/start' || endpoint === 'mcp/authorize')).toBe(false)
  })

  it('disables an existing connection without another connect or authorization request', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'mcp/status') return { ok: true, value: connected }
      expect(endpoint).toBe('mcp/configure')
      expect(payload).toEqual({ enabled: false })
      return { ok: true, value: disabled }
    })
    await mount(call, 'en')
    await act(async () => { toggle().click() })
    expect(toggle().checked).toBe(false)
    expect(container!.textContent).toContain('Disabled')
    expect(container!.textContent).toContain('Available tools: 0')
    expect(call.mock.calls.map(([, endpoint]) => endpoint)).toEqual(['mcp/status', 'mcp/configure'])
  })

  it('shows loading, blocks duplicate connection requests, and keeps a failed connection recoverable', async () => {
    let finish!: (value: unknown) => void
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'mcp/status') return { ok: true, value: { ...connected, state: 'disconnected', toolCount: 0 } }
      if (endpoint === 'mcp/connect') return new Promise(resolve => { finish = resolve })
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    await mount(call)
    await act(async () => { button('连接服务').click() })
    expect(button('正在连接…').disabled).toBe(true)
    expect(toggle().disabled).toBe(true)
    await act(async () => { button('正在连接…').click() })
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'mcp/connect')).toHaveLength(1)
    await act(async () => { finish({ ok: false, error: { code: 'MCP_UNAVAILABLE', message: '服务暂时不可用，请重试。' } }) })
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain('服务暂时不可用，请重试。')
    expect(button('连接服务').disabled).toBe(false)
    expect(toggle().checked).toBe(true)
  })

  it('retains the saved disabled state when saving fails and allows retry', async () => {
    let attempts = 0
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'mcp/status') return { ok: true, value: disabled }
      if (endpoint === 'mcp/configure' && attempts++ === 0) return { ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: '无法保存设置。' } }
      if (endpoint === 'mcp/configure') return { ok: true, value: { ...disabled, enabled: true, state: 'disconnected' } }
      if (endpoint === 'mcp/connect') return { ok: true, value: connected }
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    await mount(call)
    await act(async () => { toggle().click() })
    expect(toggle().checked).toBe(false)
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain('无法保存设置。')
    await act(async () => { toggle().click() })
    expect(toggle().checked).toBe(true)
    expect(container!.querySelector('[role="alert"]')).toBeNull()
  })

  it('opens authorization only on request and uses an idempotent connect after the Host completes it', async () => {
    vi.useFakeTimers()
    let account: DsnAccountSnapshot = {
      state: 'authorizing', attemptId: 'mcp-login', authorizationUrl: 'https://auth.example/oidc/auth',
      expiresAt: Date.now() + 60_000, message: 'Finish authorization',
    }
    let status: ClubMcpStatus = { ...connected, state: 'reauth-required', toolCount: 0 }
    const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'mcp/status') return { ok: true, value: status }
      if (endpoint === 'mcp/authorize') return { ok: true, value: { snapshot: account, mcp: status } }
      if (endpoint === 'snapshot/get') return { ok: true, value: account }
      if (endpoint === 'mcp/connect') { expect(payload).toEqual({}); return { ok: true, value: status } }
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    await mount(call)
    expect(call.mock.calls.some(([, endpoint]) => endpoint === 'mcp/authorize')).toBe(false)
    await act(async () => { button('补充授权').click() })
    expect(container!.textContent).toContain('请在浏览器中完成授权')
    expect(button('取消授权')).toBeDefined()
    account = signedIn
    status = connected
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'mcp/connect')).toHaveLength(1)
    expect(container!.textContent).toContain('可用工具: 12')
    expect(container!.textContent).not.toContain('请在浏览器中完成授权')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'mcp/connect')).toHaveLength(1)
  })

  it('recovers from an initial status read failure without changing existing account state', async () => {
    let attempts = 0
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      expect(endpoint).toBe('mcp/status')
      if (attempts++ === 0) return { ok: false, error: { code: 'MCP_UNAVAILABLE', message: '服务状态暂时不可用。' } }
      return { ok: true, value: disabled }
    })
    await mount(call)
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain('服务状态暂时不可用。')
    expect(toggle().disabled).toBe(true)
    await act(async () => { button('重试').click() })
    expect(toggle().disabled).toBe(false)
    expect(container!.querySelector('[role="alert"]')).toBeNull()
  })

  it('cancels the shared account authorization through the account channel and refreshes MCP status through its own channel', async () => {
    const pending: DsnAccountSnapshot = {
      state: 'authorizing', attemptId: 'cancel-mcp-login', authorizationUrl: 'https://auth.example/oidc/auth',
      expiresAt: Date.now() + 60_000, message: 'Finish authorization',
    }
    const status: ClubMcpStatus = { ...connected, state: 'signed-out', toolCount: 0 }
    const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'mcp/status') return { ok: true, value: status }
      if (endpoint === 'mcp/authorize') return { ok: true, value: { snapshot: pending, mcp: status } }
      if (endpoint === 'authorization/cancel') {
        expect(payload).toEqual({ attemptId: 'cancel-mcp-login' })
        return { ok: true, value: { state: 'signed-out' } }
      }
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    await mount(call)
    await act(async () => { button('登录并授权').click() })
    await act(async () => { button('取消授权').click() })
    expect(call.mock.calls.map(([channel, endpoint]) => [channel, endpoint])).toEqual([
      ['/cqaiclub-mcp', 'mcp/status'], ['/cqaiclub-mcp', 'mcp/authorize'],
      ['/cqaiclub-dsn-account', 'authorization/cancel'], ['/cqaiclub-mcp', 'mcp/status'],
    ])
    expect(container!.textContent).not.toContain('请在浏览器中完成授权')
    expect(button('登录并授权').disabled).toBe(false)
  })

  it('refreshes changed tool counts and signed-out status without reconnecting or starting authorization', async () => {
    vi.useFakeTimers()
    let status = connected
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      expect(endpoint).toBe('mcp/status')
      return { ok: true, value: status }
    })
    await mount(call)
    status = { ...connected, toolCount: 7 }
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(container!.textContent).toContain('可用工具: 7')
    status = { ...connected, state: 'signed-out', toolCount: 0 }
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(container!.textContent).toContain('需要登录')
    expect(container!.textContent).toContain('可用工具: 0')
    expect(button('登录并授权').disabled).toBe(false)
    expect(call.mock.calls.every(([, endpoint]) => endpoint === 'mcp/status')).toBe(true)
  })

  it('ignores an older status read after a newer authorization state arrives', async () => {
    vi.useFakeTimers()
    let finishOld!: (value: unknown) => void
    let reads = 0
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      expect(endpoint).toBe('mcp/status')
      if (++reads === 2) return new Promise(resolve => { finishOld = resolve })
      return { ok: true, value: reads === 1 ? connected : { ...connected, state: 'reauth-required', toolCount: 0 } }
    })
    await mount(call)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(container!.textContent).toContain('需要补充授权')
    await act(async () => { finishOld({ ok: true, value: connected }) })
    expect(container!.textContent).toContain('需要补充授权')
    expect(container!.textContent).toContain('可用工具: 0')
  })

  it('refreshes on a connection reset and removes its reset listener when unmounted', async () => {
    let reset!: () => void
    const dispose = vi.fn()
    const on = vi.fn((event: string, callback: () => void) => {
      expect(event).toBe('connection/reset')
      reset = callback
      return dispose
    })
    let status = connected
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      expect(endpoint).toBe('mcp/status')
      return { ok: true, value: status }
    })
    await mount(call, 'en', on)
    status = { ...connected, state: 'reauth-required', toolCount: 0 }
    await act(async () => { reset() })
    expect(container!.textContent).toContain('Authorization required')
    await act(async () => { root!.unmount() })
    root = undefined
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('disables cancellation and duplicate toggles while a service setting is being saved', async () => {
    let finish!: (value: unknown) => void
    const pending: DsnAccountSnapshot = {
      state: 'authorizing', attemptId: 'pending-login', authorizationUrl: 'https://auth.example/oidc/auth',
      expiresAt: Date.now() + 60_000, message: 'Finish authorization',
    }
    const status: ClubMcpStatus = { ...connected, state: 'reauth-required', toolCount: 0 }
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'mcp/status') return { ok: true, value: status }
      if (endpoint === 'mcp/authorize') return { ok: true, value: { snapshot: pending, mcp: status } }
      if (endpoint === 'mcp/configure') return new Promise(resolve => { finish = resolve })
      if (endpoint === 'snapshot/get') return { ok: true, value: pending }
      throw new Error(`Unexpected RPC: ${endpoint}`)
    })
    await mount(call)
    await act(async () => { button('补充授权').click() })
    await act(async () => { toggle().click() })
    expect(toggle().disabled).toBe(true)
    expect(button('取消授权').disabled).toBe(true)
    await act(async () => { button('取消授权').click(); toggle().click() })
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'mcp/configure')).toHaveLength(1)
    expect(call.mock.calls.some(([, endpoint]) => endpoint === 'authorization/cancel')).toBe(false)
    await act(async () => { finish({ ok: true, value: disabled }) })
    expect(toggle().checked).toBe(false)
    expect(button('取消授权').disabled).toBe(false)
  })
})
