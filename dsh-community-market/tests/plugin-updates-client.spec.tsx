// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketOperationPreviewRequest, MarketOperationPreviewResponse, MarketPluginUpdate, MarketUpdatesResponse } from '../src/api-types.js'
import { PluginUpdatesPanel } from '../src/client/PluginUpdatesPanel.js'
import { PluginUpdatesSummary, type PluginUpdatesSummaryProps } from '../src/client/PluginUpdatesSummary.js'
import { MarketUpdateNotice, type MarketUpdateNoticeProps } from '../src/client/MarketUpdateNotice.js'
import { MarketSurface, type MarketSettingsTabProps } from '../src/client/MarketSettingsTab.js'
import { previewMarketOperation, readMarketState, requestMarketRestart } from '../src/client/api.js'
import { createPluginUpdatesStore, UPDATE_RESTART_TOKEN_TTL_MS } from '../src/client/plugin-updates-store.js'
import { en, type MarketLocaleKey } from '../src/client/locales.js'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  previewMarketOperation: vi.fn(),
  readMarketState: vi.fn(),
  requestMarketRestart: vi.fn(),
}))

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers() })

const t = ((key: MarketLocaleKey): string => en[key]) as MarketSettingsTabProps['t']
const updates: MarketPluginUpdate[] = [
  { bundleId: 'one', packageName: 'dsh-plugin-one', currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true },
  { bundleId: 'two', packageName: 'dsh-plugin-two', currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true },
  { bundleId: 'three', packageName: 'dsh-plugin-three', currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true },
]
const response = (items = updates): MarketUpdatesResponse => ({ updates: items, checkedAt: '2026-10-14T00:00:00.000Z' })
function preview(update: MarketPluginUpdate): MarketOperationPreviewResponse {
  return {
    action: 'update', packageName: update.packageName, displayName: update.packageName, currentVersion: update.currentVersion,
    version: update.latestVersion!, profileName: 'web', previewId: update.bundleId, expiresAt: '2026-10-14T00:05:00.000Z',
  }
}

describe('plugin update UI', () => {
  it('reviews exact versions before a single update, then offers the returned restart grant', async () => {
    const read = vi.fn().mockResolvedValue(response([updates[0]!]))
    const execute = vi.fn(async () => {
      read.mockResolvedValue(response([{ ...updates[0]!, currentVersion: '2.0.0', updateAvailable: false }]))
      return { action: 'update' as const, packageName: 'dsh-plugin-one', version: '2.0.0', restartToken: 'restart-one' }
    })
    const store = createPluginUpdatesStore({ read, execute })
    vi.mocked(previewMarketOperation).mockResolvedValue(preview(updates[0]!))
    vi.mocked(requestMarketRestart).mockResolvedValue({ ok: true })
    render(<PluginUpdatesPanel store={store} t={t} canRestart />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update: dsh-plugin-one' }))
    const dialog = await screen.findByRole('dialog', { name: en.confirmUpdateTitle })
    expect(within(dialog).getByText('1.0.0 → 2.0.0')).toBeTruthy()
    expect(execute).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmUpdate }))
    await waitFor(() => expect(store.getSnapshot().completed).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: en.restartNow }))
    await waitFor(() => expect(requestMarketRestart).toHaveBeenCalledWith('restart-one', expect.any(AbortSignal)))
    store.dispose()
  })

  it('reviews the whole batch once, stops on failure, and retains completed changes and skipped items', async () => {
    const read = vi.fn().mockResolvedValue(response())
    const execute = vi.fn()
      .mockImplementationOnce(async () => {
        read.mockResolvedValue(response([{ ...updates[0]!, currentVersion: '2.0.0', updateAvailable: false }, ...updates.slice(1)]))
        return { action: 'update', packageName: 'dsh-plugin-one', version: '2.0.0', restartToken: 'restart-one' }
      }).mockRejectedValueOnce(new Error('installation failed'))
    const store = createPluginUpdatesStore({ read, execute })
    vi.mocked(previewMarketOperation).mockImplementation(async (request: MarketOperationPreviewRequest) => {
      if (request.action !== 'update') throw new Error('unexpected request')
      return preview(updates.find(update => update.bundleId === request.bundleId)!)
    })
    const panel = render(<PluginUpdatesPanel store={store} t={t} canRestart />)
    fireEvent.click(await screen.findByRole('button', { name: en.updateAll }))
    const dialog = await screen.findByRole('dialog', { name: en.confirmUpdateTitle })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)
    expect(execute).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmUpdate }))
    await screen.findByText('Plugin update failed: dsh-plugin-two')
    expect(execute.mock.calls.map(call => call[0])).toEqual(['one', 'two'])
    expect(screen.getByText('Not updated: dsh-plugin-three')).toBeTruthy()
    expect(screen.getByText('dsh-plugin-one · 2.0.0')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.restartNow })).toBeTruthy()
    // Navigating away and returning preserves successful updates and retry controls.
    panel.unmount()
    render(<PluginUpdatesPanel store={store} t={t} canRestart />)
    expect(screen.getByText('dsh-plugin-one · 2.0.0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update: dsh-plugin-three' }))
    expect(await screen.findByRole('dialog', { name: en.confirmUpdateTitle })).toBeTruthy()
    expect(previewMarketOperation).toHaveBeenLastCalledWith({ action: 'update', bundleId: 'three' }, expect.any(AbortSignal))
    store.dispose()
  })

  it('shows a verification failure without applying any update', async () => {
    const execute = vi.fn()
    const store = createPluginUpdatesStore({ read: vi.fn().mockResolvedValue(response()), execute })
    vi.mocked(previewMarketOperation).mockRejectedValue(new Error('offline'))
    render(<PluginUpdatesPanel store={store} t={t} canRestart={false} />)
    fireEvent.click(await screen.findByRole('button', { name: en.updateAll }))
    expect(await screen.findByText(en.updatePreviewFailed)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(execute).not.toHaveBeenCalled()
    store.dispose()
  })

  it('keeps failed checks distinct from up-to-date results and allows a forced retry', async () => {
    const read = vi.fn().mockResolvedValue(response([{ ...updates[0]!, updateAvailable: false, error: 'offline' }]))
    const store = createPluginUpdatesStore({ read })
    render(<PluginUpdatesPanel store={store} t={t} canRestart={false} />)
    await screen.findAllByText(en.updateCheckItemFailed)
    expect(screen.queryByText(en.pluginsUpToDate)).toBeNull()
    expect(screen.queryByText(en.pluginUpToDate)).toBeNull()
    read.mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    expect(await screen.findByText(en.updateCheckFailed)).toBeTruthy()
    expect(read.mock.calls.at(-1)?.[1]).toBe(true)
    store.dispose()
  })

  it('opens a dedicated update view from the native installed-plugin summary without returning to native', async () => {
    const store = createPluginUpdatesStore({ read: vi.fn().mockResolvedValue(response([updates[0]!])) })
    await store.check()
    const open = vi.fn()
    const nativeInstalled = vi.fn()
    render(<PluginUpdatesSummary {...{ updatesStore: store, onOpenUpdates: open, t } as PluginUpdatesSummaryProps} />)
    fireEvent.click(screen.getByRole('button', { name: en.viewUpdates }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().requestedUpdatesView).toBe(true)
    vi.mocked(readMarketState).mockResolvedValue({ sources: [], builtIns: [], desktopActions: { openTerminal: true, requestRestart: true } })
    render(<MarketSurface t={t} readLocale={() => 'en'} onOpenInstalled={nativeInstalled} updatesStore={store} />)
    expect(await screen.findByRole('button', { name: 'Update: dsh-plugin-one' })).toBeTruthy()
    expect(nativeInstalled).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Plugin updates (1)' }).getAttribute('aria-pressed')).toBe('true')
    store.dispose()
  })

  it('dismisses global reminders for the same set and exposes the actionable update entry', async () => {
    const read = vi.fn().mockResolvedValue(response())
    const store = createPluginUpdatesStore({ read })
    await store.check()
    const onOpen = vi.fn(() => store.requestOpen())
    render(<MarketUpdateNotice {...{ updatesStore: store, onOpenUpdates: onOpen, t } as MarketUpdateNoticeProps} />)
    expect(screen.getByRole('status').textContent).toContain('(3)')
    fireEvent.click(screen.getByRole('button', { name: en.dismissUpdateNotice }))
    await act(async () => { await store.check() })
    expect(screen.queryByRole('button', { name: en.viewUpdates })).toBeNull()
    read.mockResolvedValue(response([{ ...updates[0]!, latestVersion: '2.1.0' }]))
    await act(async () => { await store.check() })
    fireEvent.click(screen.getByRole('button', { name: en.viewUpdates }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().requestedUpdatesView).toBe(true)
    store.dispose()
  })

  it('replaces expired quick-restart controls with a menu restart instruction', async () => {
    const read = vi.fn().mockResolvedValue(response([{ ...updates[0]!, currentVersion: '2.0.0', updateAvailable: false }]))
    const execute = vi.fn().mockResolvedValue({ action: 'update', packageName: 'dsh-plugin-one', version: '2.0.0', restartToken: 'restart-one' })
    const store = createPluginUpdatesStore({ read, execute })
    vi.useFakeTimers()
    await store.executeReviewed([preview(updates[0]!)])
    render(<PluginUpdatesPanel store={store} t={t} canRestart />)
    expect(screen.getByRole('button', { name: en.restartNow })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_RESTART_TOKEN_TTL_MS) })
    expect(screen.queryByRole('button', { name: en.restartNow })).toBeNull()
    expect(screen.getByText(en.updateRestartExpired)).toBeTruthy()
    expect(requestMarketRestart).not.toHaveBeenCalled()
    store.dispose()
  })
})
