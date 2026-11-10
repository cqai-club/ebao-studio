import { describe, expect, it, vi } from 'vitest'
import type { MarketInstallationView, MarketInstallationUpdateCheck } from '../src/api-types.js'
import { readPluginUpdates } from '../src/install/updates.js'

const installation = (packageName: string, updatable = true): MarketInstallationView => ({
  kind: 'profile', packageName, version: '1.0.0', enabled: true, installed: true,
  removable: true, toggleable: true, updatable,
})

describe('batch update inventory through the official manager', () => {
  it('checks only updatable bundles and keeps available, current, blocked and failed checks distinct', async () => {
    const results: Record<string, MarketInstallationUpdateCheck> = {
      available: { status: 'available', installed: '1.0.0', version: '1.1.0' },
      current: { status: 'latest', installed: '1.0.0' },
      blocked: { status: 'blocked', installed: '1.0.0', version: '2.0.0', requirements: { 'engines.dsh': '>=1' }, runtimeVersion: '0.2.2-alpha.3' },
      failed: { status: 'failed', problem: 'network', reason: 'offline' },
    }
    const checkUpdate = vi.fn(async (name: string) => results[name]!)
    const response = await readPluginUpdates({
      listInstallations: vi.fn(async () => [...Object.keys(results).map(name => installation(name)), installation('read-only', false)]),
      checkUpdate,
    }, new AbortController().signal)
    expect(checkUpdate).toHaveBeenCalledTimes(4)
    expect(response.updates).toEqual([
      expect.objectContaining({ packageName: 'available', currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true }),
      expect.objectContaining({ packageName: 'current', updateAvailable: false }),
      expect.objectContaining({ packageName: 'blocked', updateAvailable: false, error: 'incompatible-runtime' }),
      expect.objectContaining({ packageName: 'failed', updateAvailable: false, error: 'network' }),
    ])
    expect(Number.isNaN(Date.parse(response.checkedAt))).toBe(false)
  })

  it('bounds registry checks to four concurrent lookups while preserving inventory order', async () => {
    let active = 0
    let maximum = 0
    const checkUpdate = vi.fn(async (): Promise<MarketInstallationUpdateCheck> => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active--
      return { status: 'latest', installed: '1.0.0' }
    })
    const items = Array.from({ length: 11 }, (_, index) => installation(`plugin-${index}`))
    const result = await readPluginUpdates({ listInstallations: async () => items, checkUpdate }, new AbortController().signal)
    expect(maximum).toBe(4)
    expect(result.updates.map(item => item.packageName)).toEqual(items.map(item => item.packageName))
  })

  it('retains one item failure without hiding successful checks', async () => {
    const result = await readPluginUpdates({
      listInstallations: async () => [installation('bad'), installation('good')],
      checkUpdate: async name => {
        if (name === 'bad') throw new Error('registry unavailable')
        return { status: 'available', installed: '1.0.0', version: '1.2.0' }
      },
    }, new AbortController().signal)
    expect(result.updates[0]).toMatchObject({ updateAvailable: false, error: 'registry unavailable' })
    expect(result.updates[1]).toMatchObject({ updateAvailable: true, latestVersion: '1.2.0' })
  })

  it('propagates cancellation instead of publishing a false failed or up-to-date result', async () => {
    const controller = new AbortController()
    await expect(readPluginUpdates({
      listInstallations: async () => [installation('one')],
      checkUpdate: async () => {
        controller.abort(new DOMException('closed', 'AbortError'))
        throw controller.signal.reason
      },
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
