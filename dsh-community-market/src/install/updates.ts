import type { MarketPluginUpdate, MarketUpdatesResponse } from '../api-types.js'
import type { MarketInstallService } from './service.js'

/** Read the official manager without installing code; keep each failed check visible. */
export async function readPluginUpdates(
  install: Pick<MarketInstallService, 'listInstallations' | 'checkUpdate'>,
  signal: AbortSignal,
): Promise<MarketUpdatesResponse> {
  const installations = (await install.listInstallations(signal)).filter(item => item.updatable)
  const updates: MarketPluginUpdate[] = new Array(installations.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, installations.length) }, async () => {
    while (next < installations.length) {
      signal.throwIfAborted()
      const index = next++
      const item = installations[index]!
      const base = { bundleId: item.packageName, packageName: item.packageName, currentVersion: item.version ?? '', updateAvailable: false }
      try {
        const check = await install.checkUpdate(item.packageName, signal)
        signal.throwIfAborted()
        updates[index] = check.status === 'available'
          ? { ...base, currentVersion: check.installed, latestVersion: check.version, updateAvailable: true }
          : check.status === 'failed'
            ? { ...base, error: check.problem }
            : check.status === 'blocked'
              ? { ...base, currentVersion: check.installed, latestVersion: check.version, error: 'incompatible-runtime' }
              : { ...base, currentVersion: check.installed }
      } catch (cause) {
        signal.throwIfAborted()
        updates[index] = { ...base, error: cause instanceof Error ? cause.message : 'update-check-failed' }
      }
    }
  }))
  return { updates, checkedAt: new Date().toISOString() }
}
