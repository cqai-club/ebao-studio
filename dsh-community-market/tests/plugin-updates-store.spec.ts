import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketOperationPreviewResponse, MarketPluginUpdate, MarketUpdatesResponse } from '../src/api-types.js'
import { createPluginUpdatesStore, UPDATE_CHECK_INTERVAL_MS, UPDATE_STARTUP_RETRY_MS } from '../src/client/plugin-updates-store.js'

const updates: MarketPluginUpdate[] = [
  { bundleId: 'one', packageName: 'dsh-plugin-one', currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true },
  { bundleId: 'two', packageName: 'dsh-plugin-two', currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true },
  { bundleId: 'three', packageName: 'dsh-plugin-three', currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true },
]
const response = (items = updates): MarketUpdatesResponse => ({ updates: items, checkedAt: '2026-10-14T00:00:00.000Z' })
const previews: MarketOperationPreviewResponse[] = updates.map(update => ({
  action: 'update', profileName: 'web', packageName: update.packageName, displayName: update.packageName,
  currentVersion: update.currentVersion, version: update.latestVersion!, expiresAt: '2026-10-14T00:05:00.000Z', previewId: update.bundleId,
}))

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('shared plugin update checks', () => {
  it('checks on startup and every 30 minutes without installing; disposal stops and aborts checks', async () => {
    vi.useFakeTimers()
    let activeSignal: AbortSignal | undefined
    const read = vi.fn(async (signal: AbortSignal) => { activeSignal = signal; return response() })
    const execute = vi.fn()
    const store = createPluginUpdatesStore({ read, execute })
    store.start()
    await store.check()
    expect(read).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    read.mockImplementation(signal => { activeSignal = signal; return new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    store.dispose()
    expect(activeSignal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(read).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot().updates).toEqual([])
  })

  it('retries an unavailable startup Host before the regular interval', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(response())
    const store = createPluginUpdatesStore({ read })
    store.start()
    await store.check()
    expect(store.getSnapshot().checkFailed).toBe(true)
    await vi.advanceTimersByTimeAsync(UPDATE_STARTUP_RETRY_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().noticeVisible).toBe(true)
    store.dispose()
  })

  it('does not repeat a dismissed version set, but notifies when a newer set appears', async () => {
    const read = vi.fn().mockResolvedValue(response())
    const store = createPluginUpdatesStore({ read })
    await store.check()
    expect(store.getSnapshot().noticeVisible).toBe(true)
    store.dismiss()
    await store.check()
    expect(store.getSnapshot().noticeVisible).toBe(false)
    read.mockResolvedValue(response([{ ...updates[0]!, latestVersion: '2.1.0' }]))
    await store.check()
    expect(store.getSnapshot().noticeVisible).toBe(true)
    store.dispose()
  })

  it('reports a failed refresh separately while retaining last known results', async () => {
    const read = vi.fn().mockResolvedValue(response())
    const store = createPluginUpdatesStore({ read })
    await store.check()
    read.mockRejectedValue(new Error('offline'))
    await store.check(true)
    expect(store.getSnapshot().checkFailed).toBe(true)
    expect(store.getSnapshot().updates).toEqual(updates)
    expect(store.getSnapshot().noticeVisible).toBe(false)
    store.dispose()
  })

  it('preserves completed updates and their restart grants when a batch stops at the first failure', async () => {
    const read = vi.fn().mockResolvedValue(response())
    const execute = vi.fn()
      .mockResolvedValueOnce({ action: 'update', packageName: 'dsh-plugin-one', version: '2.0.0', restartToken: 'restart-one' })
      .mockRejectedValueOnce(new Error('installation failed'))
    const store = createPluginUpdatesStore({ read, execute })
    await store.check()
    read.mockResolvedValue(response([{ ...updates[0]!, currentVersion: '2.0.0', updateAvailable: false }, ...updates.slice(1)]))
    await store.executeReviewed(previews)
    expect(execute.mock.calls.map(call => call[0])).toEqual(['one', 'two'])
    expect(store.getSnapshot().completed).toEqual([expect.objectContaining({ packageName: 'dsh-plugin-one', version: '2.0.0', restartToken: 'restart-one' })])
    expect(store.getSnapshot().operationFailure).toEqual({ packageName: 'dsh-plugin-two', message: 'installation failed', notStarted: ['dsh-plugin-three'] })
    expect(store.getSnapshot().operationPending).toBe(false)
    expect(read.mock.calls.at(-1)?.[1]).toBe(true)
    store.requestOpen()
    store.dispose()
    read.mockResolvedValue(response([]))
    store.start()
    await store.check()
    expect(store.getSnapshot().completed).toEqual([])
    expect(store.getSnapshot().operationFailure).toBeUndefined()
    expect(store.getSnapshot().requestedUpdatesView).toBe(false)
    expect(store.getSnapshot().updates).toEqual([])
    store.dispose()
  })

  it('shares one in-flight check and prevents duplicate batch execution', async () => {
    let finishRead!: (value: MarketUpdatesResponse) => void
    let finishExecute!: (value: { action: 'update'; packageName: string; version: string; restartToken: string }) => void
    const read = vi.fn(() => new Promise<MarketUpdatesResponse>(resolve => { finishRead = resolve }))
    const execute = vi.fn(() => new Promise<{ action: 'update'; packageName: string; version: string; restartToken: string }>(resolve => { finishExecute = resolve }))
    const store = createPluginUpdatesStore({ read, execute })
    const first = store.check()
    const second = store.check()
    expect(first).toBe(second)
    await Promise.resolve()
    finishRead(response())
    await first
    read.mockImplementation(async () => response())
    const running = store.executeReviewed([previews[0]!])
    await store.executeReviewed([previews[0]!])
    expect(execute).toHaveBeenCalledTimes(1)
    finishExecute({ action: 'update', packageName: 'dsh-plugin-one', version: '2.0.0', restartToken: 'restart' })
    await running
    store.dispose()
  })

  it('ignores a late response from a disposed generation after a fresh startup', async () => {
    let finishOld!: (value: MarketUpdatesResponse) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise<MarketUpdatesResponse>(resolve => { finishOld = resolve }))
      .mockResolvedValue(response([]))
    const store = createPluginUpdatesStore({ read })
    const old = store.check()
    await Promise.resolve()
    store.dispose()
    store.start()
    await store.check()
    finishOld(response())
    await old
    expect(store.getSnapshot().updates).toEqual([])
    expect(store.getSnapshot().noticeVisible).toBe(false)
    store.dispose()
  })
})
