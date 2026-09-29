import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Use the market workspace's React for both the plugin and its DOM renderer.
const peerRequire = createRequire(new URL('../../../dsh-community-market/package.json', import.meta.url))
vi.mock('react', async () => {
  const { createRequire: requireFrom } = await import('node:module')
  return requireFrom(new URL('../../../dsh-community-market/package.json', import.meta.url))('react')
})

import { apply } from '../src/client/index.js'
import { requestDesktopRestart } from '../src/client/management-api.js'

type Registered = {
  options: { name: string; key?: string; id?: string; children?: Record<string, unknown> }
  component: ComponentType<Record<string, unknown>>
}

function makeDom() {
  const { JSDOM } = peerRequire('jsdom') as {
    JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
  }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:43120' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
  dom.window.confirm = vi.fn(() => true)
  return dom
}

function testContext() {
  const registrations: Registered[] = []
  const selectPanel = vi.fn()
  const listBundles = vi.fn(async () => ({ ok: true as const, value: [] }))
  const ctx = {
    inject: (_names: readonly string[], callback: (scope: Context) => void) => { callback(ctx as unknown as Context) },
    locale: {
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
      resolveText: (value: string | Record<string, string>) => typeof value === 'string' ? value : value.zh ?? value.en,
    },
    layout: { selectPanel, panelInfo: { getSnapshot: () => ({ activePanelId: 'plugins' }), subscribe: () => () => {} } },
    remote: { pluginManager: { listBundles }, $on: () => () => {} },
    slots: {
      inject: (_name: string, factory: () => unknown) => { factory() },
      register: (options: Registered['options'], component: Registered['component']) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  } as unknown as Context
  return { ctx, registrations, selectPanel, listBundles }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CQAI plugin management Client', () => {
  it('embeds the native page in its shell and routes account navigation to the native panel', async () => {
    const dom = makeDom()
    const { act, createElement } = peerRequire('react') as typeof import('react')
    const { createRoot } = peerRequire('react-dom/client') as {
      createRoot: (container: Element) => { render: (content: ReactNode) => void; unmount: () => void }
    }
    const ctx = new Context()
    const registrations: Registered[] = []
    const selectPanel = vi.fn()
    const remote = { pluginManager: { listBundles: vi.fn(async () => ({ ok: true as const, value: [] })) }, $on: () => () => {} }
    ctx.provide('slots', {
      inject: (_name: string, factory: () => unknown) => { factory() },
      register: (options: Registered['options'], component: Registered['component']) => {
        registrations.push({ options, component })
        return () => {}
      },
    })
    ctx.provide('locale', {
      getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {},
      resolveText: (value: string | Record<string, string>) => typeof value === 'string' ? value : value.zh ?? value.en,
    })
    ctx.provide('layout', { selectPanel, panelInfo: { getSnapshot: () => ({ activePanelId: 'plugins' }), subscribe: () => () => {} } })
    await ctx.plugin({ apply: provider => {
      provider.provide('remote', remote)
      provider.provide('remote.pluginManager', remote.pluginManager)
    } }).await()
    await ctx.plugin({ inject: ['slots', 'locale'], apply }).await()

    const shell = registrations.find(entry => entry.options.name === 'plugins.shell')
    const account = registrations.find(entry => entry.options.name === 'cqaiclub.account.menu.action')
    const cards = registrations.find(entry => entry.options.name === 'plugins.installed.cards')
    expect(shell).toBeDefined()
    expect(shell?.options.children).toHaveProperty('cqai.pluginManagement.market')
    expect(account).toBeDefined()
    expect(cards).toBeDefined()
    expect(registrations.some(entry => entry.options.name === 'plugins.bundle.hidden'
      && entry.options.key === '@cqaiclub/dsh-plugin-activities')).toBe(false)
    expect(registrations.some(entry => entry.options.name === 'main')).toBe(false)

    const container = dom.window.document.querySelector<HTMLDivElement>('#root')!
    const root = createRoot(container)
    const showList = vi.fn()
    let action: { id: string; label: () => string; onSelect: () => void } | undefined
    const nativeContent = createElement('div', { 'data-native-manager': true }, '原生插件页面 · 添加插件')
    const market = (_name: string, owner: { onOpenInstalled: () => void }) =>
      createElement('button', { onClick: owner.onOpenInstalled }, '市场返回已安装')
    const render = (nativeView: { kind: string }) => createElement('div', null,
      createElement(account!.component, {
        registerAction: (next: typeof action) => { action = next; return () => { action = undefined } },
      }),
      createElement(shell!.component, { content: nativeContent, nativeView, showList, renderSlot: market }),
    )

    try {
      await act(async () => { root.render(render({ kind: 'list' })) })
      expect(container.querySelector('[data-native-manager]')?.textContent).toContain('原生插件页面')
      expect(container.querySelector('.cqpm-native')?.hasAttribute('hidden')).toBe(false)
      expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('已安装插件')
      expect(action?.label()).toBe('插件管理')
      action?.onSelect()
      expect(selectPanel).toHaveBeenCalledWith('plugins')
      expect(container.querySelector('.cqpm-back')?.textContent).toBe('返回')
      await act(async () => { container.querySelector<HTMLButtonElement>('.cqpm-back')!.click() })
      expect(selectPanel).toHaveBeenLastCalledWith(null)

      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>('nav button')]
          .find(button => button.textContent === '插件市场')?.click()
      })
      expect(container.querySelector('.cqpm-native')?.hasAttribute('hidden')).toBe(true)
      expect(container.textContent).toContain('市场返回已安装')
      await act(async () => { container.querySelector<HTMLButtonElement>('.cqpm-back')!.click() })
      expect(selectPanel).toHaveBeenLastCalledWith(null)

      await act(async () => { root.render(render({ kind: 'package' })) })
      expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('已安装插件')
      expect(container.querySelector('.cqpm-native')?.hasAttribute('hidden')).toBe(false)

      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>('nav button')]
          .find(button => button.textContent === '插件市场')?.click()
      })
      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find(button => button.textContent === '市场返回已安装')?.click()
      })
      expect(showList).toHaveBeenCalled()
      expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('已安装插件')
    } finally {
      await act(async () => { root.unmount() })
      await ctx.fiber.dispose()
      dom.window.close()
    }
  })

  it('inserts product cards, reports their count, and uses the restart-based toggle flow', async () => {
    const dom = makeDom()
    const { act, createElement } = peerRequire('react') as typeof import('react')
    const { createRoot } = peerRequire('react-dom/client') as {
      createRoot: (container: Element) => { render: (content: ReactNode) => void; unmount: () => void }
    }
    let status: 'active' | 'disabled' = 'active'
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/bundles')) return new Response(JSON.stringify({
        bundles: [
          { bundleId: 'imagegen', packageName: 'cqai-dsh-plugin-imagegen', status, mutable: true, uninstallable: false },
          { bundleId: 'ppt', packageName: 'dsh-ppt-composer', status: 'disabled', mutable: true, uninstallable: false },
        ],
        loadedPackageNames: ['cqai-dsh-plugin-imagegen'],
      }), { headers: { 'content-type': 'application/json' } })
      if (path.endsWith('/preview')) {
        expect(JSON.parse(String(init?.body))).toEqual({ action: 'disable', bundleId: 'imagegen' })
        return new Response(JSON.stringify({
          previewId: 'preview-1', packageName: 'cqai-dsh-plugin-imagegen',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (path.endsWith('/execute')) {
        expect(JSON.parse(String(init?.body))).toEqual({ action: 'disable', previewId: 'preview-1' })
        status = 'disabled'
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const invoke = vi.fn(async (_action: 'restart') => {})
    vi.stubGlobal('dshDesktopActions', { invoke })
    const test = testContext()
    apply(test.ctx)
    const cards = test.registrations.find(entry => entry.options.name === 'plugins.installed.cards')
    expect(cards).toBeDefined()
    const reportCount = vi.fn()
    const container = dom.window.document.querySelector<HTMLDivElement>('#root')!
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement('ul', null, createElement(cards!.component, { reportCount }))) })
      expect(container.querySelectorAll('[data-product-bundle]')).toHaveLength(2)
      expect(reportCount).toHaveBeenCalledWith(2)
      expect(container.querySelector('[data-product-bundle="@cqaiclub/dsh-plugin-activities"]')).toBeNull()
      const image = container.querySelector('[data-product-bundle="cqai-dsh-plugin-imagegen"]')
      expect(image?.querySelector('.cqpm-product-title')?.textContent).toBe('e图宝')
      expect(image?.querySelector('.cqpm-product-description')?.textContent).toBe('生成、编辑和管理图片素材。')
      expect(image?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')

      await act(async () => { image?.querySelector<HTMLButtonElement>('[role="switch"]')?.click() })
      expect(fetcher.mock.calls.some(([input]) => String(input).endsWith('/preview'))).toBe(true)
      expect(fetcher.mock.calls.some(([input]) => String(input).endsWith('/execute'))).toBe(true)
      expect(container.querySelector('[data-product-bundle="cqai-dsh-plugin-imagegen"] [role="switch"]')?.getAttribute('aria-checked')).toBe('false')
      expect(container.textContent).toContain('更改将在重启后生效')

      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find(button => button.textContent === '立即重启')?.click()
      })
      expect(invoke).toHaveBeenCalledExactlyOnceWith('restart')
    } finally {
      await act(async () => { root.unmount() })
      expect(reportCount).toHaveBeenLastCalledWith(0)
      dom.window.close()
    }
  })

  it('uses the Electron restart bridge while the Host is shutting down', async () => {
    const invoke = vi.fn(async (_action: 'restart') => {})
    const fetcher = vi.fn()
    vi.stubGlobal('dshDesktopActions', { invoke })
    vi.stubGlobal('fetch', fetcher)
    await requestDesktopRestart()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('restart')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not contribute CQAI controls outside primary Desktop mode', () => {
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: false })
    const test = testContext()
    apply(test.ctx)
    expect(test.registrations).toEqual([])
  })

  it('registers shell, cards and menu when the relevant owners appear after the plugin', () => {
    vi.stubGlobal('dshDesktop', { cqaiPrimaryLogin: true })
    const pendingSlots = new Map<string, () => unknown>()
    const registrations: string[] = []
    let activateServices: (() => void) | undefined
    const ctx = {
      inject: (_names: readonly string[], callback: (scope: Context) => void) => {
        activateServices = () => { callback(ctx as unknown as Context) }
      },
      slots: {
        inject: (name: string, factory: () => unknown) => { pendingSlots.set(name, factory) },
        register: (options: { name: string }) => { registrations.push(options.name); return () => {} },
      },
    } as unknown as Context

    apply(ctx)
    expect(registrations).toEqual([])
    activateServices?.()
    expect(registrations).toEqual([])
    pendingSlots.get('plugins.shell')?.()
    pendingSlots.get('plugins.installed.cards')?.()
    pendingSlots.get('cqaiclub.account.menu.action')?.()
    expect(registrations).toEqual(expect.arrayContaining([
      'plugins.shell', 'plugins.installed.cards', 'cqaiclub.account.menu.action',
    ]))
  })
})
