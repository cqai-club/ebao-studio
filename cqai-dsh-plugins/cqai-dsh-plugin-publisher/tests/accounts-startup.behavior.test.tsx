// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountsPage } from '../src/client/accounts.tsx'
import type { PublisherAccount } from '../src/protocol.ts'

const mocks = vi.hoisted(() => ({ api: vi.fn(), showError: vi.fn(), showSuccess: vi.fn(), clearTip: vi.fn() }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: mocks.api,
  CONTENT_LABELS: { article: '文章', 'image-note': '图文', video: '视频' },
  capabilityMessage: (value: { supported: boolean; message?: string } | undefined) => value === undefined
    ? '正在检查发布能力…' : value.supported ? '' : value.message || '发布能力不可用',
  PublisherModal: () => null,
}))
vi.mock('../src/client/tips.tsx', () => ({ usePublisherTips: () => mocks }))
vi.mock('../src/client/platform-icon.tsx', () => ({ PlatformIcon: () => <span/> }))

let container: HTMLDivElement
let root: Root | undefined
const account: PublisherAccount = { id: 'created-account', platform: 'dy', displayName: '待识别的抖音账号', loginState: 'logged-out' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function render(active = true) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => { root!.render(<AccountsPage active={active}/>) })
}

function button(label: string) {
  const result = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

function ready(rows: PublisherAccount[] = []) {
  mocks.api.mockImplementation(async (route: string, data?: unknown) => {
    if (route === 'capability') return { supported: true, running: false, legacyAccountImportSupported: false }
    if (route === 'accounts' && data === undefined) return [...rows]
    if (route === 'platform-capabilities') return [{ platform: 'dy', contentTypes: ['video'], modes: { video: ['publish'] } }]
    throw new Error(`Unexpected request: ${route}`)
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  mocks.api.mockReset()
  ready()
})
afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  container?.remove()
  root = undefined
  vi.unstubAllGlobals()
})

describe('Publisher account service startup', () => {
  it('keeps adding disabled until both account and capability requests finish', async () => {
    const accounts = deferred<PublisherAccount[]>()
    const platforms = deferred<unknown[]>()
    mocks.api.mockImplementation((route: string) => route === 'capability'
      ? Promise.resolve({ supported: true, legacyAccountImportSupported: false })
      : route === 'accounts' ? accounts.promise : platforms.promise)
    await render()
    expect(container.textContent).toContain('正在启动 MatrixMedia 发布服务')
    expect(container.textContent).not.toContain('还没有发布账号')
    const add = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('添加并打开登录页'))
    if (add) expect(add.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll('button')).filter(item => !item.disabled)).toHaveLength(0)
    await act(async () => { accounts.resolve([]) })
    expect(container.textContent).toContain('正在启动 MatrixMedia 发布服务')
    await act(async () => { platforms.resolve([]) })
    expect(button('添加并打开登录页').disabled).toBe(false)
    expect(container.textContent).toContain('还没有发布账号')
  })

  it('exposes a persistent startup retry even when no accounts have loaded', async () => {
    mocks.api.mockImplementation(async (route: string) => {
      if (route === 'capability') return { supported: true, legacyAccountImportSupported: false }
      throw new Error('Publisher Worker 未建立本地通信连接')
    })
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('未建立本地通信连接')
    expect(button('添加并打开登录页').disabled).toBe(true)
    ready([account])
    await click('重试启动服务')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain(account.displayName)
    expect(button('添加并打开登录页').disabled).toBe(false)
  })

  it('shows a created account before login navigation finishes and retains it after failure', async () => {
    const login = deferred<unknown>()
    const rows: PublisherAccount[] = []
    ready(rows)
    const initial = mocks.api.getMockImplementation()!
    mocks.api.mockImplementation((route: string, data?: unknown) => {
      if (route === 'accounts' && data !== undefined) { rows.push(account); return Promise.resolve(account) }
      if (route === 'account-open-login') return login.promise
      return initial(route, data)
    })
    await render()
    await click('添加并打开登录页')
    expect(container.textContent).toContain(account.displayName)
    expect(container.textContent).toContain('正在打开登录页')
    expect(button('登录').disabled).toBe(true)
    await act(async () => { login.reject(new Error('打开登录页超时')) })
    expect(container.textContent).toContain(account.displayName)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('账号已添加')
    expect(button('登录').disabled).toBe(false)
    mocks.api.mockImplementation((route: string, data?: unknown) => route === 'account-open-login'
      ? Promise.resolve({ ok: true }) : initial(route, data))
    await click('登录')
    expect(mocks.api.mock.calls.filter(([route, data]) => route === 'accounts' && data !== undefined)).toHaveLength(1)
    expect(mocks.api.mock.calls.filter(([route]) => route === 'account-open-login')).toHaveLength(2)
  })

  it('does not report successful navigation when the worker returns navigationFailed', async () => {
    ready([account])
    const initial = mocks.api.getMockImplementation()!
    mocks.api.mockImplementation((route: string, data?: unknown) => route === 'account-open-login'
      ? Promise.resolve({ ok: true, navigationFailed: true }) : initial(route, data))
    await render()
    await click('登录')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('clears an earlier login-window warning after a successful login check', async () => {
    ready([account])
    const initial = mocks.api.getMockImplementation()!
    mocks.api.mockImplementation((route: string, data?: unknown) => {
      if (route === 'account-open-login') return Promise.resolve({ ok: true, navigationFailed: true })
      if (route === 'account-check-login') return Promise.resolve({ ...account, loginState: 'logged-in' })
      return initial(route, data)
    })
    await render()
    await click('登录')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    await click('检查状态')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('已登录')
  })

  it('discards an earlier startup result after leaving and reopening the page', async () => {
    const oldRows = deferred<PublisherAccount[]>()
    ready()
    const initial = mocks.api.getMockImplementation()!
    mocks.api.mockImplementation((route: string, data?: unknown) => route === 'accounts' && data === undefined
      ? oldRows.promise : initial(route, data))
    await render()
    await render(false)
    const current = { ...account, id: 'current', displayName: '当前账号' }
    ready([current])
    await render(true)
    await act(async () => { oldRows.resolve([{ ...account, displayName: '过期账号' }]) })
    expect(container.textContent).toContain('当前账号')
    expect(container.textContent).not.toContain('过期账号')
    expect(button('添加并打开登录页').disabled).toBe(false)
  })
})
