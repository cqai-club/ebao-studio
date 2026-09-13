import { randomUUID } from 'node:crypto'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { CatalogSourceManifest, LocalSourceRecord } from '../contracts/index.js'
import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { CommunityMarketService } from '../policy.js'
import { SettingsCatalogSourceStore, type MarketSettingsDocument } from './source-store.js'

export type MarketDefaultSourceInitialization =
  | 'not-configured'
  | 'already-applied'
  | 'preserved-existing'
  | 'seeded'

export type MarketDefaultSourceManifestReader = (
  manifestUrl: string,
  signal: AbortSignal,
) => Promise<CatalogSourceManifest>

function configuredManifestUrl(
  marketPolicies: Pick<CommunityMarketService, 'listPolicies'>,
): string | undefined {
  const manifestUrls = [...new Set(marketPolicies.listPolicies()
    .flatMap(policy => policy.defaultSource === undefined ? [] : [policy.defaultSource.manifestUrl]))]
  if (manifestUrls.length > 1) throw new Error('multiple product default catalog sources are configured')
  return manifestUrls[0]
}

/**
 * Apply a product source once without ever replacing an existing user choice.
 * A failed manifest fetch leaves the marker unset so a later generation can retry.
 */
export async function initializeMarketDefaultSource(
  scope: SettingsScope<MarketSettingsDocument>,
  marketPolicies: Pick<CommunityMarketService, 'listPolicies'>,
  signal: AbortSignal,
  readManifest: MarketDefaultSourceManifestReader,
): Promise<MarketDefaultSourceInitialization> {
  signal.throwIfAborted()
  const current = scope.get()
  if (current.defaultSourceApplied === true) return 'already-applied'

  const currentRecords = [...current.sources]
  validateLocalSourceRecords(currentRecords)
  if (currentRecords.length > 0) {
    signal.throwIfAborted()
    await scope.update({ defaultSourceApplied: true })
    return 'preserved-existing'
  }

  const manifestUrl = configuredManifestUrl(marketPolicies)
  if (manifestUrl === undefined) return 'not-configured'
  const manifest = await readManifest(manifestUrl, signal)
  signal.throwIfAborted()

  // Re-read immediately before persistence so settings changed outside this
  // scheduler still win over the product default.
  const latest = scope.get()
  if (latest.defaultSourceApplied === true) return 'already-applied'
  const latestRecords = [...latest.sources]
  validateLocalSourceRecords(latestRecords)
  if (latestRecords.length > 0) {
    await scope.update({ defaultSourceApplied: true })
    return 'preserved-existing'
  }

  const source: LocalSourceRecord = {
    sourceRecordId: randomUUID(),
    registrationKind: 'user-added',
    adapterId: 'market.standard-http-v1',
    providerId: manifest.providerId,
    manifestUrl,
    manifest,
    enabled: true,
    order: 0,
  }
  validateLocalSourceRecords([source])
  await new SettingsCatalogSourceStore(scope).save([source], { markDefaultSourceApplied: true })
  return 'seeded'
}
