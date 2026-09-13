import type { CatalogSnapshot } from './contracts/generated/catalog-snapshot.js'

type MarketCatalogItem = CatalogSnapshot['items'][number]

/** Optional product-level presentation supplied by a market policy. */
export interface CommunityMarketBranding {
  readonly title: string
  readonly subtitle: string
}

/** Optional product-owned standard source offered on first use. */
export interface CommunityMarketDefaultSource {
  readonly manifestUrl: string
}

/**
 * A small, provider-neutral extension point for products that want to add
 * presentation policy without copying the Market implementation.
 */
export interface CommunityMarketPolicy {
  readonly id: string
  readonly featuredCategories?: readonly string[]
  readonly featuredPackages?: readonly string[]
  readonly branding?: CommunityMarketBranding
  readonly defaultSource?: CommunityMarketDefaultSource
}

export interface CommunityMarketService {
  registerPolicy(policy: CommunityMarketPolicy): () => void
  listPolicies(): readonly CommunityMarketPolicy[]
  isFeatured(item: MarketCatalogItem): boolean
}

function validText(value: string): boolean {
  return value.length > 0 && value.length <= 120 && !value.includes('\0')
}

function normalizeList(values: readonly string[] | undefined): readonly string[] | undefined {
  if (values === undefined) return undefined
  const result = [...new Set(values)]
  if (result.some(value => !validText(value))) throw new TypeError('market policy values are invalid')
  return Object.freeze(result)
}

function normalizeBranding(value: CommunityMarketBranding | undefined): CommunityMarketBranding | undefined {
  if (value === undefined) return undefined
  if (!validText(value.title) || !validText(value.subtitle)) {
    throw new TypeError('market policy branding is invalid')
  }
  return Object.freeze({ title: value.title, subtitle: value.subtitle })
}

function normalizeDefaultSource(
  value: CommunityMarketDefaultSource | undefined,
): CommunityMarketDefaultSource | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'manifestUrl')
    || typeof value.manifestUrl !== 'string' || value.manifestUrl.length > 2_048) {
    throw new TypeError('market policy default source is invalid')
  }
  let url: URL
  try {
    url = new URL(value.manifestUrl)
  } catch {
    throw new TypeError('market policy default source is invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    throw new TypeError('market policy default source must use credential-free standard HTTPS port 443')
  }
  return Object.freeze({ manifestUrl: url.href })
}

function normalizePolicy(policy: CommunityMarketPolicy): CommunityMarketPolicy {
  if (!validText(policy.id)) throw new TypeError('market policy id is invalid')
  const featuredCategories = normalizeList(policy.featuredCategories)
  const featuredPackages = normalizeList(policy.featuredPackages)
  const branding = normalizeBranding(policy.branding)
  const defaultSource = normalizeDefaultSource(policy.defaultSource)
  if (featuredCategories === undefined && featuredPackages === undefined && defaultSource === undefined) {
    throw new TypeError('market policy must declare featured content or a default source')
  }
  return Object.freeze({
    id: policy.id,
    ...(featuredCategories === undefined ? {} : { featuredCategories }),
    ...(featuredPackages === undefined ? {} : { featuredPackages }),
    ...(branding === undefined ? {} : { branding }),
    ...(defaultSource === undefined ? {} : { defaultSource }),
  })
}

/** Generation-scoped policy registry provided to Market consumers. */
export class CommunityMarketPolicyRegistry implements CommunityMarketService {
  private readonly policies = new Map<string, CommunityMarketPolicy>()

  registerPolicy(input: CommunityMarketPolicy): () => void {
    const policy = normalizePolicy(input)
    if (this.policies.has(policy.id)) throw new Error(`market policy already registered: ${policy.id}`)
    this.policies.set(policy.id, policy)
    return () => {
      if (this.policies.get(policy.id) === policy) this.policies.delete(policy.id)
    }
  }

  listPolicies(): readonly CommunityMarketPolicy[] {
    return Object.freeze([...this.policies.values()])
  }

  isFeatured(item: MarketCatalogItem): boolean {
    const packageName = item.package?.name
    return [...this.policies.values()].some(policy =>
      (packageName !== undefined && policy.featuredPackages?.includes(packageName) === true)
      || (item.categories ?? []).some(category => policy.featuredCategories?.includes(category) === true),
    )
  }
}
