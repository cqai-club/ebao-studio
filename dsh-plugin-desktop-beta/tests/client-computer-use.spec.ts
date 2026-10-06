// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Context, Service, type Fiber, type Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChangeResult, PluginEntryId, PluginInfo, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPUTER_USE_ITEM_ID, COMPUTER_USE_PROVIDER, ComputerUseActions, ComputerUseController, ComputerUseSettings,
  computerUseEn, computerUseZh, registerDesktopComputerUse,
  type ComputerUseActionsProps, type ComputerUseSettingsProps,
} from '../src/client/computer-use.tsx'
import type { DesktopClientPlatform } from '../src/client/environment.ts'

// The published Primitives CSS is loaded by Vite in the app; keep its documented control contract in jsdom.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Switch: ({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled: boolean; title?: string }) =>
    createElement('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, title, onClick: () => { onChange(!checked) } }),
  StateDot: () => createElement('span', { 'aria-hidden': true }),
  Button: ({ children, variant: _variant, size: _size, ...props }: Record<string, unknown>) => createElement('button', props, children as ReactNode),
}))

/** Match the real Gateway's traceable Service and independently provided namespace. */
class LifecycleRemote extends Service {
  readonly subscriptions = new Set<() => void>()
  constructor(ctx: Context) { super(ctx, 'remote') }
  $on(_event: string, callback: () => void): () => void {
    this.subscriptions.add(callback)
    return () => { this.subscriptions.delete(callback) }
  }
}
class LifecycleSlots extends Service {
  readonly registrations = new Map<string, { inject: () => { controller: ComputerUseController } }>()
  constructor(ctx: Context) { super(ctx, 'slots') }
  inject(_name: string, mount: () => (() => void)): () => Promise<void> {
    return this.ctx.effect(mount)
  }
  register(config: { id: string; inject: () => { controller: ComputerUseController } }): () => void {
    this.registrations.set(config.id, config)
    return () => { this.registrations.delete(config.id) }
  }
}

type Manager = Pick<ClientContext['remote']['pluginManager'], 'listPlugins' | 'setPluginEnabled'>
let root: Root | undefined
let container: HTMLDivElement | undefined

function row(enabled = false, phase: PluginInfo['fiberPhase'] = null): PluginInfo {
  return { entryId: 'native-provider-entry' as PluginEntryId, patchId: 'computer-use-cua-driver-native', moduleName: COMPUTER_USE_PROVIDER, enabled, fiberPhase: phase }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function fixture() {
  const listPlugins = vi.fn<Manager['listPlugins']>(async () => ({ ok: true, value: [row()] }))
  const setPluginEnabled = vi.fn<Manager['setPluginEnabled']>(async () => ({ ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'native-provider-entry' } }))
  const controller = new ComputerUseController({ listPlugins, setPluginEnabled })
  return { controller, listPlugins, setPluginEnabled }
}
async function render(controller: ComputerUseController, language: 'zh' | 'en' = 'zh', platform: DesktopClientPlatform = 'darwin', subject: ComputerUseActionsProps['subject'] = { kind: 'item', id: COMPUTER_USE_ITEM_ID }, view: ComputerUseSettingsProps['view'] = 'page') {
  if (!container) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const copy = language === 'zh' ? computerUseZh : computerUseEn
  const props = { controller, platform, t: (key: keyof typeof computerUseZh) => copy[key] }
  await act(async () => {
    root!.render(createElement('div', {},
      createElement(ComputerUseActions, { ...props, subject } as unknown as ComputerUseActionsProps),
      createElement(ComputerUseSettings, { ...props, view } as unknown as ComputerUseSettingsProps)))
  })
  return container
}
function toggle(): HTMLButtonElement | null { return container?.querySelector('[role="switch"]') ?? null }

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Desktop Computer Use official plugin entry', () => {
  it.each(['before', 'after'] as const)('keeps the real Cordis Desktop parent active with namespace mounting %s it, then rebuilds controls after namespace replacement', async timing => {
    const ctx = new Context()
    const slots = new LifecycleSlots(ctx)
    const remote = new LifecycleRemote(ctx)
    const { listPlugins, setPluginEnabled } = fixture()
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: keyof typeof computerUseZh) => computerUseZh[key] })
    let computerUseFiber: Fiber | undefined
    ctx.on('internal/plugin', fiber => {
      if ('remote.pluginManager' in fiber.inject) computerUseFiber = fiber
    })
    const mountNamespace = (): Fiber => ctx.plugin({ name: 'remote.pluginManager', apply: scope => {
      scope.provide('remote.pluginManager', { listPlugins, setPluginEnabled })
    } })
    let namespace: Fiber | undefined
    if (timing === 'before') { namespace = mountNamespace(); await namespace.await() }
    const workspace = ctx.plugin({ inject: ['layout'], apply: scope => { scope.provide('uiWorkspace', {}) } })
    const desktop = ctx.plugin({ inject: ['remote', 'slots', 'locale'], apply: scope => {
      registerDesktopComputerUse(scope, 'darwin')
      scope.provide('layout', {})
    } })
    try {
      await desktop.await()
      await workspace.await()
      expect(ctx.get('layout')).toBeDefined()
      expect(ctx.get('uiWorkspace')).toBeDefined()
      if (timing === 'after') {
        expect(slots.registrations.size).toBe(0)
        expect(listPlugins).not.toHaveBeenCalled()
        namespace = mountNamespace()
        await namespace.await()
      }
      await computerUseFiber!.await()
      expect(slots.registrations.size).toBe(2)
      expect(remote.subscriptions.size).toBe(1)
      expect(listPlugins).toHaveBeenCalledOnce()
      const first = slots.registrations.get(COMPUTER_USE_ITEM_ID)!.inject().controller
      expect(first.getSnapshot().row?.enabled).toBe(false)
      await namespace!.dispose()
      await desktop.await()
      await workspace.await()
      expect(ctx.get('layout')).toBeDefined()
      expect(ctx.get('uiWorkspace')).toBeDefined()
      namespace = undefined
      expect(slots.registrations.size).toBe(0)
      expect(remote.subscriptions.size).toBe(0)
      listPlugins.mockResolvedValueOnce({ ok: true, value: [row(true, 'active')] })
      namespace = mountNamespace()
      await namespace.await()
      await computerUseFiber!.await()
      const second = slots.registrations.get(COMPUTER_USE_ITEM_ID)!.inject().controller
      expect(second).not.toBe(first)
      expect(second.getSnapshot().row?.enabled).toBe(true)
      expect(listPlugins).toHaveBeenCalledTimes(2)
      expect(slots.registrations.size).toBe(2)
      expect(remote.subscriptions.size).toBe(1)
      expect(setPluginEnabled).not.toHaveBeenCalled()
    } finally {
      await desktop.dispose()
      await workspace.dispose()
      await namespace?.dispose()
      await ctx.fiber.dispose()
    }
  })
  it('uses the documented item and detail-actions slots, refreshes official state on Host events, and cleans up', async () => {
    const { listPlugins, setPluginEnabled } = fixture()
    const callbacks = new Map<string, () => void>()
    const off = vi.fn()
    const resetOff = vi.fn()
    const disposers: (() => void)[] = []
    const register = vi.fn(() => () => {})
    const localeRegister = vi.fn(() => () => {})
    const context: ClientContext = {
      inject: (_dependencies: string[], mount: (scope: ClientContext) => void) => { mount(context) },
      remote: { pluginManager: { listPlugins, setPluginEnabled }, $on: vi.fn((event: string, callback: () => void) => { callbacks.set(event, callback); return off }) },
      on: vi.fn((event: string, callback: () => void) => { callbacks.set(event, callback); return resetOff }),
      effect: (effect: () => (() => void)) => { disposers.push(effect()) },
      locale: { register: localeRegister, bind: () => (key: keyof typeof computerUseZh) => computerUseZh[key] },
      slots: { inject: (_name: string, effect: () => void) => { effect() }, register },
    } as unknown as ClientContext
    registerDesktopComputerUse(context, 'darwin')
    await Promise.resolve()
    expect(localeRegister).toHaveBeenCalledWith('desktop.computerUse', { zh: computerUseZh, en: computerUseEn })
    expect(register.mock.calls).toHaveLength(2)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'plugins.item', id: COMPUTER_USE_ITEM_ID }), ComputerUseSettings)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'plugins.detail.actions' }), ComputerUseActions)
    expect(setPluginEnabled).not.toHaveBeenCalled()
    callbacks.get('plugin-manager/changed')!()
    callbacks.get('connection/reset')!()
    window.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    expect(listPlugins).toHaveBeenCalledTimes(4)
    for (const dispose of disposers) dispose()
    window.dispatchEvent(new Event('focus'))
    expect(listPlugins).toHaveBeenCalledTimes(4)
    expect(off).toHaveBeenCalledOnce()
    expect(resetOff).toHaveBeenCalledOnce()
  })

  it('shows translated model and macOS prerequisites with a disabled switch until the default-off row arrives', async () => {
    const { controller, listPlugins, setPluginEnabled } = fixture()
    const read = deferred<RemoteResult<PluginInfo[]>>()
    listPlugins.mockReturnValueOnce(read.promise)
    const refresh = controller.refresh()
    await render(controller)
    expect(toggle()?.disabled).toBe(true)
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(container?.textContent).toContain(computerUseZh.loading)
    expect(container?.textContent).toContain(computerUseZh.description)
    expect(container?.textContent).toContain(computerUseZh.macPermissions)
    await act(async () => { read.resolve({ ok: true, value: [row()] }); await refresh })
    expect(toggle()?.disabled).toBe(false)
    expect(container?.textContent).toContain(computerUseZh.disabled)
    expect(setPluginEnabled).not.toHaveBeenCalled()
    await render(controller, 'en', 'win32')
    expect(toggle()?.getAttribute('aria-label')).toBe(computerUseEn.enable)
    expect(container?.textContent).toContain(computerUseEn.description)
    expect(container?.textContent).not.toContain(computerUseEn.macPermissions)
  })

  it('applies one exact provider-row mutation, blocks duplicate input, and reflects the authoritative loading and running states', async () => {
    const { controller, listPlugins, setPluginEnabled } = fixture()
    await controller.refresh()
    await render(controller)
    const change = deferred<RemoteResult<ChangeResult>>()
    setPluginEnabled.mockReturnValueOnce(change.promise)
    listPlugins.mockResolvedValueOnce({ ok: true, value: [row(true, 'loading')] })
    await act(async () => { toggle()!.click(); toggle()!.click() })
    expect(setPluginEnabled).toHaveBeenCalledOnce()
    expect(setPluginEnabled).toHaveBeenCalledWith('native-provider-entry', true)
    expect(toggle()?.disabled).toBe(true)
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(container?.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container?.textContent).toContain(computerUseZh.saving)
    await act(async () => { change.resolve({ ok: true, value: { changed: true, application: 'applied', stage: 'enable', target: 'native-provider-entry' } }) })
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(container?.textContent).toContain(computerUseZh.waiting)
    listPlugins.mockResolvedValueOnce({ ok: true, value: [row(true, 'active')] })
    await act(async () => { await controller.refresh() })
    expect(container?.textContent).toContain(computerUseZh.running)
    listPlugins.mockResolvedValueOnce({ ok: true, value: [row(false)] })
    await act(async () => { toggle()!.click() })
    expect(setPluginEnabled).toHaveBeenLastCalledWith('native-provider-entry', false)
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
  })

  it.each(['restart-required', 'overridden', 'cancelled'] as const)('retains the accepted %s outcome and the Host state', async application => {
    const { controller, setPluginEnabled } = fixture()
    await controller.refresh()
    await render(controller, 'en')
    setPluginEnabled.mockResolvedValueOnce({ ok: true, value: { changed: true, application, stage: 'enable', target: 'native-provider-entry' } })
    await act(async () => { toggle()!.click() })
    const key = application === 'restart-required' ? 'restart' : application
    expect(container?.textContent).toContain(computerUseEn[key])
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
  })

  it('reports a failed mutation, preserves the failure through a state read, and lets the user retry the switch', async () => {
    const { controller, setPluginEnabled } = fixture()
    await controller.refresh()
    await render(controller)
    setPluginEnabled.mockResolvedValueOnce({ ok: true, value: { changed: false, application: 'failed', stage: 'enable', target: 'native-provider-entry', error: { code: 'operation-error', diagnostic: 'Provider unavailable' } } })
    await act(async () => { toggle()!.click() })
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(`${computerUseZh.changeError} Provider unavailable`)
    expect(toggle()?.disabled).toBe(false)
    await act(async () => { toggle()!.click() })
    expect(setPluginEnabled).toHaveBeenCalledTimes(2)
    expect(container?.querySelector('[role="alert"]')).toBeNull()
  })

  it('offers recovery after a read failure and refuses missing, ambiguous, or read-only provider rows', async () => {
    const { controller, listPlugins, setPluginEnabled } = fixture()
    listPlugins.mockRejectedValueOnce(new Error('Host disconnected'))
    await controller.refresh()
    await render(controller)
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(computerUseZh.readError)
    expect(toggle()?.disabled).toBe(true)
    await act(async () => { container?.querySelector<HTMLButtonElement>('button:not([role="switch"])')?.click() })
    expect(container?.querySelector('[role="alert"]')).toBeNull()
    expect(toggle()?.disabled).toBe(false)
    const readOnly: PluginInfo = { entryId: 'locked-entry' as PluginEntryId, moduleName: COMPUTER_USE_PROVIDER, enabled: false, fiberPhase: null, readOnlyReason: 'unaddressable' }
    for (const rows of [[], [row(), row()], [readOnly]]) {
      listPlugins.mockResolvedValueOnce({ ok: true, value: rows })
      await act(async () => { await controller.refresh() })
      expect(toggle()?.disabled).toBe(true)
      await controller.setEnabled(true)
    }
    expect(setPluginEnabled).not.toHaveBeenCalled()
    expect(container?.textContent).toContain(computerUseZh.readOnly)
    expect(toggle()?.title).toBe(computerUseZh.readOnly)
  })

  it('renders no action on other plugin pages and keeps the ItemCard summary as a one-liner', async () => {
    const { controller } = fixture()
    await controller.refresh()
    await render(controller, 'en', 'darwin', { kind: 'item', id: 'other-plugin' }, 'summary')
    expect(toggle()).toBeNull()
    expect(container?.textContent).toBe(computerUseEn.description)
  })

  it('ignores obsolete reads and prevents updates after disposal', async () => {
    const { controller, listPlugins, setPluginEnabled } = fixture()
    const older = deferred<RemoteResult<PluginInfo[]>>()
    listPlugins.mockReturnValueOnce(older.promise)
    const refresh = controller.refresh()
    listPlugins.mockResolvedValueOnce({ ok: true, value: [row(true, 'active')] })
    await controller.refresh()
    older.resolve({ ok: true, value: [row()] })
    await refresh
    expect(controller.getSnapshot().row?.enabled).toBe(true)
    const pending = deferred<RemoteResult<PluginInfo[]>>()
    listPlugins.mockReturnValueOnce(pending.promise)
    const lastRead = controller.refresh()
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.dispose()
    pending.resolve({ ok: true, value: [row()] })
    await lastRead
    await controller.setEnabled(false)
    expect(listener).not.toHaveBeenCalled()
    expect(controller.getSnapshot().row?.enabled).toBe(true)
    expect(setPluginEnabled).not.toHaveBeenCalled()
  })
})
