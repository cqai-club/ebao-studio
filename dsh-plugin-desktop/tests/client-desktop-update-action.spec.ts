// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopUpdateAction, type DesktopUpdateActionProps } from '../src/client/DesktopUpdateAction.tsx'
import type { DesktopSettingsApi, DesktopUpdateStatus } from '../src/client/desktop-settings-api.ts'
import { en, zh } from '../src/client/desktop-settings-locales.ts'

type UpdateApi = Pick<DesktopSettingsApi, 'readUpdateStatus' | 'checkForUpdates'>
const available: DesktopUpdateStatus = {
  supported: true, currentVersion: '0.0.9', availableVersion: '0.0.10', checking: false, downloading: false,
}
let root: Root | undefined
let container: HTMLDivElement | undefined

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function render(api: UpdateApi, wide = false, locale: 'zh' | 'en' = 'zh'): Promise<HTMLDivElement> {
  if (!container) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const copy = locale === 'en' ? en : zh
  const props = { api, wide, t: (key: keyof typeof zh) => copy[key] } as unknown as DesktopUpdateActionProps
  await act(async () => { root!.render(createElement(DesktopUpdateAction, props)) })
  return container
}

function button(): HTMLButtonElement | null {
  return container?.querySelector('button') ?? null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Desktop sidebar update shortcut', () => {
  it('appears only after a known update and disappears when the Host clears it, without checking remotely', async () => {
    const read = vi.fn(async () => ({ ...available, availableVersion: null } as DesktopUpdateStatus))
    const check = vi.fn(async () => {})
    await render({ readUpdateStatus: read, checkForUpdates: check })
    expect(button()).toBeNull()

    read.mockResolvedValueOnce(available)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(button()?.getAttribute('aria-label')).toBe('更新到 v0.0.10')
    expect(button()?.title).toBe('更新到 v0.0.10')
    expect(button()?.querySelector('svg')).not.toBeNull()
    expect(button()?.textContent).toBe('')

    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(button()).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('hides unsupported installations even if a version is present', async () => {
    await render({ readUpdateStatus: async () => ({ ...available, supported: false }), checkForUpdates: async () => {} })
    expect(button()).toBeNull()
  })

  it('shows a translated label in the expanded sidebar with the target version as its accessible name', async () => {
    await render({ readUpdateStatus: async () => available, checkForUpdates: async () => {} }, true, 'en')
    expect(button()?.textContent).toBe(en.desktopUpdateAvailable)
    expect(button()?.getAttribute('aria-label')).toBe('Update to v0.0.10')
    expect(container?.querySelector('[data-wide="true"]')).not.toBeNull()
  })

  it('runs the existing action once and retains the shortcut after the native dialog is dismissed', async () => {
    const flow = deferred<void>()
    const read = vi.fn(async () => available)
    const check = vi.fn(() => flow.promise)
    await render({ readUpdateStatus: read, checkForUpdates: check })
    await act(async () => { button()!.click(); button()!.click() })
    expect(check).toHaveBeenCalledOnce()
    expect(button()?.disabled).toBe(true)
    expect(button()?.getAttribute('aria-busy')).toBe('true')

    await act(async () => { flow.resolve() })
    expect(read).toHaveBeenCalledTimes(2)
    expect(button()?.disabled).toBe(false)
    expect(button()?.getAttribute('aria-label')).toBe('更新到 v0.0.10')
  })

  it.each(['checking', 'downloading'] as const)('prevents activation while the Host is %s', async state => {
    const check = vi.fn(async () => {})
    await render({ readUpdateStatus: async () => ({ ...available, [state]: true }), checkForUpdates: check })
    expect(button()?.disabled).toBe(true)
    expect(button()?.getAttribute('aria-busy')).toBe('true')
    expect(button()?.getAttribute('aria-label')).toBe(state === 'downloading' ? zh.downloadingDesktopUpdate : zh.preparingDesktopUpdate)
    await act(async () => { button()!.click() })
    expect(check).not.toHaveBeenCalled()
  })

  it('reports an action failure and allows a retry without exposing its raw error', async () => {
    const check = vi.fn(async () => {})
    check.mockRejectedValueOnce(new Error('private updater details'))
    await render({ readUpdateStatus: async () => available, checkForUpdates: check }, true)
    await act(async () => { button()!.click() })
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(zh.desktopUpdateActionError)
    expect(button()?.title).toContain(zh.desktopUpdateActionError)
    expect(container?.textContent).not.toContain('private updater details')
    expect(button()?.disabled).toBe(false)
    await act(async () => { button()!.click() })
    expect(check).toHaveBeenCalledTimes(2)
    expect(container?.querySelector('[role="alert"]')).toBeNull()
  })

  it('preserves a known update through transient status errors', async () => {
    const read = vi.fn(async () => available)
    await render({ readUpdateStatus: read, checkForUpdates: async () => {} })
    read.mockRejectedValueOnce(new Error('Host reconnecting'))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(button()?.getAttribute('aria-label')).toBe('更新到 v0.0.10')
    expect(container?.querySelector('[role="alert"]')).toBeNull()
  })

  it('pauses hidden-window reads and deduplicates focus, visibility and timer refreshes', async () => {
    const read = vi.fn(async () => available)
    await render({ readUpdateStatus: read, checkForUpdates: async () => {} })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      window.dispatchEvent(new Event('focus'))
    })
    expect(read).toHaveBeenCalledOnce()

    const refresh = deferred<DesktopUpdateStatus>()
    read.mockReturnValueOnce(refresh.promise)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => { refresh.resolve({ ...available, availableVersion: null }) })
    expect(button()).toBeNull()
  })

  it('cleans up timers and event listeners and ignores reads completing after unmount', async () => {
    const status = deferred<DesktopUpdateStatus>()
    const read = vi.fn(() => status.promise)
    await render({ readUpdateStatus: read, checkForUpdates: async () => {} })
    await act(async () => { root!.unmount() })
    root = undefined
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => {
      status.resolve(available)
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(read).toHaveBeenCalledOnce()
    expect(container?.textContent).toBe('')
  })

  it('ignores a late snapshot from a replaced API generation', async () => {
    const previous = deferred<DesktopUpdateStatus>()
    await render({ readUpdateStatus: () => previous.promise, checkForUpdates: async () => {} })
    await render({ readUpdateStatus: async () => ({ ...available, availableVersion: null }), checkForUpdates: async () => {} })
    await act(async () => { previous.resolve(available) })
    expect(button()).toBeNull()
  })
})
