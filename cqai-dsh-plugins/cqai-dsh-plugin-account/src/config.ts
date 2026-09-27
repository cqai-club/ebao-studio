import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_ACCOUNT_SERVICE_URL,
  DEFAULT_ISSUER,
  DEFAULT_RESOURCE,
  DEFAULT_SCOPES,
  MODEL_CATALOG_CACHE_TTL_MS,
  type DsnAccountConfig,
  type DsnDefaultModelCategory,
} from './protocol.ts'

type CategoryDefaultModels = Partial<Record<DsnDefaultModelCategory, string>>
export type AccountPluginConfig = DsnAccountConfig & {
  categoryDefaultModels: { get(): Readonly<CategoryDefaultModels> }
}

export const Config = z.object({
  issuer: z.string().default(DEFAULT_ISSUER),
  clientId: z.string().default(''),
  resource: z.string().default(DEFAULT_RESOURCE),
  accountServiceUrl: z.string().default(DEFAULT_ACCOUNT_SERVICE_URL),
  scopes: z.array(String).role('table').default([...DEFAULT_SCOPES]),
  requestTimeoutMs: z.natural().min(1000).default(15_000),
  modelCatalogCacheTtlMs: z.natural().min(1000).default(MODEL_CATALOG_CACHE_TTL_MS),
  categoryDefaultModels: z.object({
    image: z.string(),
    'text-multimodal': z.string(),
    video: z.string(),
    audio: z.string(),
    other: z.string(),
  }).default({}).volatile(),
}) as unknown as z<AccountPluginConfig>

export function normalizeConfig(config: Partial<DsnAccountConfig> | undefined): DsnAccountConfig {
  const value: DsnAccountConfig = {
    issuer: config?.issuer ?? DEFAULT_ISSUER,
    clientId: config?.clientId ?? '',
    resource: config?.resource ?? DEFAULT_RESOURCE,
    accountServiceUrl: config?.accountServiceUrl ?? DEFAULT_ACCOUNT_SERVICE_URL,
    scopes: config?.scopes?.length ? [...config.scopes] : [...DEFAULT_SCOPES],
    requestTimeoutMs: config?.requestTimeoutMs ?? 15_000,
    modelCatalogCacheTtlMs: config?.modelCatalogCacheTtlMs ?? MODEL_CATALOG_CACHE_TTL_MS,
  }

  assertHttpUrl(value.issuer, 'issuer')
  assertHttpUrl(value.resource, 'resource')
  assertHttpUrl(value.accountServiceUrl, 'accountServiceUrl')
  if (!value.scopes.includes('openid')) throw new Error('CQAI Club scopes must include openid')
  if (!value.scopes.includes('offline_access')) throw new Error('CQAI Club scopes must include offline_access')
  if (!value.scopes.includes('ai:invoke')) throw new Error('CQAI Club scopes must include ai:invoke')
  return value
}

export function assertHttpUrl(value: string, name: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an HTTP(S) URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or hash`)
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`${name} may use HTTP only on localhost`)
  }
  return url
}
