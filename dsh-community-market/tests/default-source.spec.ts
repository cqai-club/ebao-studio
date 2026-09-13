import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_KEY, DSH_1024STORE_PROVIDER_ID } from '../src/adapters/dsh-1024store.js'
import { initializeMarketDefaultSource } from '../src/catalog/default-source.js'
import type { MarketSettingsDocument } from '../src/catalog/source-store.js'
import type { CatalogSourceManifest, LocalSourceRecord } from '../src/contracts/index.js'
import { createMarketSourceMutator } from '../src/host/routes.js'
import { CommunityMarketPolicyRegistry } from '../src/policy.js'

const CQAI_MANIFEST_URL = 'https://cqaiclub.asia/catalog-source.json'

const manifest: CatalogSourceManifest = {
  manifestVersion: '1.0.0',
  providerId: 'org.cqai.club-portal',
  name: 'CQAI Club Plugin Market',
  attribution: {
    name: '重庆AI创享俱乐部',
    url: 'https://cqaiclub.asia/',
    notice: '插件由各自发布者维护。',
  },
  transport: {
    kind: 'https-json',
    endpoint: 'https://cqaiclub.asia/v1/plugins',
    method: 'GET',
  },
  query: {
    supported: ['q', 'category', 'cursor', 'limit'],
    defaultLimit: 50,
    maxLimit: 50,
    sorts: [],
  },
}

const existingSource: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: DSH_1024STORE_KEY,
  enabled: true,
  order: 0,
}

function marketPolicies(): CommunityMarketPolicyRegistry {
  const policies = new CommunityMarketPolicyRegistry()
  policies.registerPolicy({
    id: 'cqai-curated',
    defaultSource: { manifestUrl: CQAI_MANIFEST_URL },
  })
  return policies
}

function memoryScope(initial: MarketSettingsDocument) {
  let document = initial
  const update = vi.fn(async (patch: Partial<MarketSettingsDocument>) => {
    document = { ...document, ...patch }
  })
  return {
    scope: { get: () => document, update } as unknown as SettingsScope<MarketSettingsDocument>,
    update,
    document: () => document,
  }
}

describe('product default catalog source', () => {
  it('normalizes one credential-free HTTPS manifest URL and freezes it', () => {
    const policies = marketPolicies()
    const policy = policies.listPolicies()[0]

    expect(policy?.defaultSource).toEqual({ manifestUrl: CQAI_MANIFEST_URL })
    expect(Object.isFrozen(policy?.defaultSource)).toBe(true)
  })

  it.each([
    'http://cqaiclub.asia/catalog-source.json',
    'https://user:password@cqaiclub.asia/catalog-source.json',
    'https://cqaiclub.asia:8443/catalog-source.json',
    'https://cqaiclub.asia/catalog-source.json?channel=default',
    'https://cqaiclub.asia/catalog-source.json#default',
  ])('rejects unsafe default manifest URL %s', manifestUrl => {
    const policies = new CommunityMarketPolicyRegistry()
    expect(() => policies.registerPolicy({
      id: 'unsafe-default',
      defaultSource: { manifestUrl },
    })).toThrow()
  })

  it('validates, stores, and selects the product source for a fresh empty configuration', async () => {
    const settings = memoryScope({ sources: [] })
    const readManifest = vi.fn(async () => manifest)
    const signal = new AbortController().signal

    await expect(initializeMarketDefaultSource(
      settings.scope,
      marketPolicies(),
      signal,
      readManifest,
    )).resolves.toBe('seeded')

    expect(readManifest).toHaveBeenCalledOnce()
    expect(readManifest).toHaveBeenCalledWith(CQAI_MANIFEST_URL, signal)
    expect(settings.document().defaultSourceApplied).toBe(true)
    expect(settings.document().sources).toEqual([expect.objectContaining({
      sourceRecordId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      registrationKind: 'user-added',
      adapterId: 'market.standard-http-v1',
      providerId: manifest.providerId,
      manifestUrl: CQAI_MANIFEST_URL,
      manifest,
      enabled: true,
      order: 0,
    })])
  })

  it('preserves an existing source and records that the product default was considered', async () => {
    const settings = memoryScope({ sources: [existingSource] })
    const readManifest = vi.fn(async () => manifest)

    await expect(initializeMarketDefaultSource(
      settings.scope,
      marketPolicies(),
      new AbortController().signal,
      readManifest,
    )).resolves.toBe('preserved-existing')

    expect(readManifest).not.toHaveBeenCalled()
    expect(settings.document()).toEqual({ sources: [existingSource], defaultSourceApplied: true })
  })

  it('does not seed again after an explicit source removal', async () => {
    const settings = memoryScope({ sources: [existingSource] })
    const mutate = createMarketSourceMutator(settings.scope)
    await mutate({ action: 'remove', sourceRecordId: existingSource.sourceRecordId }, new AbortController().signal)
    const readManifest = vi.fn(async () => manifest)

    await expect(initializeMarketDefaultSource(
      settings.scope,
      marketPolicies(),
      new AbortController().signal,
      readManifest,
    )).resolves.toBe('already-applied')

    expect(readManifest).not.toHaveBeenCalled()
    expect(settings.document()).toEqual({ sources: [], defaultSourceApplied: true })
  })

  it('waits for a product policy instead of marking an empty configuration', async () => {
    const settings = memoryScope({ sources: [] })
    const readManifest = vi.fn(async () => manifest)

    await expect(initializeMarketDefaultSource(
      settings.scope,
      new CommunityMarketPolicyRegistry(),
      new AbortController().signal,
      readManifest,
    )).resolves.toBe('not-configured')

    expect(readManifest).not.toHaveBeenCalled()
    expect(settings.update).not.toHaveBeenCalled()
  })

  it('leaves the one-time marker unset when manifest validation fails', async () => {
    const settings = memoryScope({ sources: [] })
    const readManifest = vi.fn(async () => { throw new Error('manifest unavailable') })

    await expect(initializeMarketDefaultSource(
      settings.scope,
      marketPolicies(),
      new AbortController().signal,
      readManifest,
    )).rejects.toThrow('manifest unavailable')

    expect(settings.document()).toEqual({ sources: [] })
    expect(settings.update).not.toHaveBeenCalled()
  })
})
