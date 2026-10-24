import type {
  DatabaseId,
  DatabaseStatus,
  JournalQuality,
  LiteratureScope,
  LiteratureSource,
} from './protocol.ts'
import { isTopForeignJournal } from './top-journals.ts'

export interface DatabaseSearchOptions {
  limit: number
  scope: LiteratureScope
  journalQuality?: JournalQuality
  signal?: AbortSignal
  fetcher?: typeof fetch
  env?: NodeJS.ProcessEnv
}

const LABELS: Record<DatabaseId, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed',
  'web-of-science': 'Web of Science',
  scopus: 'Scopus',
  'google-scholar': 'Google Scholar',
  cnki: 'CNKI 中国知网',
  wanfang: '万方数据',
}

function configured(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === 'string' && env[key]!.trim() !== ''
}

export function databaseStatuses(env: NodeJS.ProcessEnv = process.env): DatabaseStatus[] {
  return [
    { id: 'openalex', label: LABELS.openalex, available: true, requiresConfiguration: false },
    { id: 'crossref', label: LABELS.crossref, available: true, requiresConfiguration: false },
    { id: 'pubmed', label: LABELS.pubmed, available: true, requiresConfiguration: false },
    {
      id: 'web-of-science',
      label: LABELS['web-of-science'],
      available: configured(env, 'WOS_API_KEY'),
      requiresConfiguration: true,
      ...configured(env, 'WOS_API_KEY') ? {} : { reason: '需要 Clarivate WOS_API_KEY' },
    },
    {
      id: 'scopus',
      label: LABELS.scopus,
      available: configured(env, 'SCOPUS_API_KEY'),
      requiresConfiguration: true,
      ...configured(env, 'SCOPUS_API_KEY') ? {} : { reason: '需要 Elsevier SCOPUS_API_KEY' },
    },
    {
      id: 'google-scholar',
      label: LABELS['google-scholar'],
      available: configured(env, 'SERPAPI_API_KEY'),
      requiresConfiguration: true,
      ...configured(env, 'SERPAPI_API_KEY') ? {} : { reason: '需要 SerpAPI Google Scholar 密钥' },
    },
    {
      id: 'cnki',
      label: LABELS.cnki,
      available: configured(env, 'EYANBAO_CNKI_API_URL'),
      requiresConfiguration: true,
      ...configured(env, 'EYANBAO_CNKI_API_URL') ? {} : { reason: '需要 CNKI 企业 API 网关地址' },
    },
    {
      id: 'wanfang',
      label: LABELS.wanfang,
      available: configured(env, 'EYANBAO_WANFANG_API_URL'),
      requiresConfiguration: true,
      ...configured(env, 'EYANBAO_WANFANG_API_URL') ? {} : { reason: '需要万方数据 API 网关地址' },
    },
  ]
}

export function databaseLabel(id: DatabaseId): string {
  return LABELS[id]
}

function normalizeDoi(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const doi = value.replace(/^https?:\/\/doi\.org\//iu, '').trim()
  return doi === '' ? undefined : doi
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function fetchJson(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    signal,
    headers: {
      accept: 'application/json',
      'user-agent': 'eYanBao/0.5 (DeepSeek Harness academic workspace)',
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`数据库返回 HTTP ${response.status}`)
  return await response.json()
}

async function searchPubMed(query: string, options: DatabaseSearchOptions): Promise<LiteratureSource[]> {
  const env = options.env ?? process.env
  const fetcher = options.fetcher ?? fetch
  const signal = options.signal ?? new AbortController().signal
  const apiKey = env.NCBI_API_KEY?.trim()
  const common = apiKey === undefined || apiKey === '' ? {} : { api_key: apiKey }
  const search = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi')
  search.searchParams.set('db', 'pubmed')
  search.searchParams.set('term', query)
  search.searchParams.set('retmax', String(Math.min(30, Math.max(options.limit * 2, 10))))
  search.searchParams.set('retmode', 'json')
  search.searchParams.set('sort', 'relevance')
  for (const [key, value] of Object.entries(common)) search.searchParams.set(key, value)
  const searchPayload = record(await fetchJson(search.toString(), fetcher, signal))
  const result = record(searchPayload?.esearchresult)
  const ids = Array.isArray(result?.idlist)
    ? result.idlist.filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length === 0) return []
  const summary = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi')
  summary.searchParams.set('db', 'pubmed')
  summary.searchParams.set('id', ids.join(','))
  summary.searchParams.set('retmode', 'json')
  for (const [key, value] of Object.entries(common)) summary.searchParams.set(key, value)
  const summaryPayload = record(await fetchJson(summary.toString(), fetcher, signal))
  const summaryResult = record(summaryPayload?.result)
  const order = Array.isArray(summaryResult?.uids)
    ? summaryResult.uids.filter((id): id is string => typeof id === 'string')
    : ids
  return order.map(id => ({ id, item: record(summaryResult?.[id]) }))
    .filter((entry): entry is { id: string; item: Record<string, unknown> } => entry.item !== undefined)
    .map(({ id, item }): LiteratureSource => {
      const articleIds = Array.isArray(item.articleids) ? item.articleids : []
      const doi = normalizeDoi(articleIds.map(record).find(entry => entry?.idtype === 'doi')?.value)
      const authors = (Array.isArray(item.authors) ? item.authors : [])
        .map(record)
        .map(author => text(author?.name))
        .filter((name): name is string => name !== undefined)
      const pubdate = text(item.pubdate)
      const yearMatch = pubdate?.match(/\b(19|20)\d{2}\b/u)
      return {
        id: `pubmed-${id}`,
        title: text(item.title) ?? `PubMed ${id}`,
        authors,
        language: 'en',
        ...yearMatch == null ? {} : { year: Number(yearMatch[0]) },
        ...text(item.source) === undefined ? {} : { venue: text(item.source) },
        ...doi === undefined ? {} : { doi, url: `https://doi.org/${doi}` },
        source: 'pubmed',
      }
    })
    .slice(0, options.limit)
}

async function searchWebOfScience(query: string, options: DatabaseSearchOptions): Promise<LiteratureSource[]> {
  const env = options.env ?? process.env
  const apiKey = env.WOS_API_KEY?.trim()
  if (apiKey === undefined || apiKey === '') throw new Error('Web of Science 未配置 WOS_API_KEY')
  const url = new URL('https://api.clarivate.com/apis/wos-starter/v1/documents')
  url.searchParams.set('q', `TS=(${query.replace(/[()]/gu, ' ')})`)
  url.searchParams.set('db', 'WOS')
  url.searchParams.set('limit', String(Math.min(50, Math.max(options.limit, 10))))
  url.searchParams.set('page', '1')
  const payload = record(await fetchJson(url.toString(), options.fetcher ?? fetch, options.signal ?? new AbortController().signal, {
    headers: { 'X-ApiKey': apiKey },
  }))
  const hits = Array.isArray(payload?.hits) ? payload.hits : []
  return hits.map(record).filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item, index): LiteratureSource => {
      const names = record(item.names)
      const info = record(item.publicationInfo)
      const identifiers = record(item.identifiers)
      const links = record(item.links)
      const authors = (Array.isArray(names?.authors) ? names.authors : [])
        .map(record)
        .map(author => text(author?.displayName) ?? text(author?.wosStandard))
        .filter((name): name is string => name !== undefined)
      const doi = normalizeDoi(identifiers?.doi)
      return {
        id: text(item.uid) ?? `wos-${index}`,
        title: text(item.title) ?? `Web of Science ${index + 1}`,
        authors,
        ...numberValue(info?.year) === undefined ? {} : { year: numberValue(info?.year) },
        ...text(info?.sourceTitle) === undefined ? {} : { venue: text(info?.sourceTitle) },
        ...doi === undefined ? {} : { doi, url: `https://doi.org/${doi}` },
        ...text(links?.record) === undefined ? {} : { url: text(links?.record) },
        topJournal: isTopForeignJournal(text(info?.sourceTitle)),
        source: 'web-of-science',
      }
    })
    .slice(0, options.limit)
}

async function searchScopus(query: string, options: DatabaseSearchOptions): Promise<LiteratureSource[]> {
  const env = options.env ?? process.env
  const apiKey = env.SCOPUS_API_KEY?.trim()
  if (apiKey === undefined || apiKey === '') throw new Error('Scopus 未配置 SCOPUS_API_KEY')
  const url = new URL('https://api.elsevier.com/content/search/scopus')
  url.searchParams.set('query', `TITLE-ABS-KEY(${query.replace(/[()]/gu, ' ')})`)
  url.searchParams.set('count', String(Math.min(25, Math.max(options.limit, 10))))
  url.searchParams.set('sort', '-relevance')
  const headers: Record<string, string> = { 'X-ELS-APIKey': apiKey }
  const instToken = env.SCOPUS_INST_TOKEN?.trim()
  if (instToken !== undefined && instToken !== '') headers['X-ELS-Insttoken'] = instToken
  const payload = record(await fetchJson(url.toString(), options.fetcher ?? fetch, options.signal ?? new AbortController().signal, { headers }))
  const results = record(payload?.['search-results'])
  const entries = Array.isArray(results?.entry) ? results.entry : []
  return entries.map(record).filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item, index): LiteratureSource => {
      const doi = normalizeDoi(item['prism:doi'])
      const yearMatch = text(item['prism:coverDate'])?.match(/\b(19|20)\d{2}\b/u)
      return {
        id: text(item.eid) ?? text(item['dc:identifier']) ?? `scopus-${index}`,
        title: text(item['dc:title']) ?? `Scopus ${index + 1}`,
        authors: text(item['dc:creator']) === undefined ? [] : text(item['dc:creator'])!.split(/[;,]/u).map(name => name.trim()).filter(Boolean),
        ...yearMatch == null ? {} : { year: Number(yearMatch[0]) },
        ...text(item['prism:publicationName']) === undefined ? {} : { venue: text(item['prism:publicationName']) },
        ...doi === undefined ? {} : { doi, url: `https://doi.org/${doi}` },
        ...numberValue(item['citedby-count']) === undefined ? {} : { citedBy: numberValue(item['citedby-count']) },
        topJournal: isTopForeignJournal(text(item['prism:publicationName'])),
        source: 'scopus',
      }
    })
    .slice(0, options.limit)
}

async function searchGoogleScholar(query: string, options: DatabaseSearchOptions): Promise<LiteratureSource[]> {
  const env = options.env ?? process.env
  const apiKey = env.SERPAPI_API_KEY?.trim()
  if (apiKey === undefined || apiKey === '') throw new Error('Google Scholar 未配置 SERPAPI_API_KEY')
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_scholar')
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(Math.min(20, Math.max(options.limit, 10))))
  url.searchParams.set('api_key', apiKey)
  const payload = record(await fetchJson(url.toString(), options.fetcher ?? fetch, options.signal ?? new AbortController().signal))
  const results = Array.isArray(payload?.organic_results) ? payload.organic_results : []
  return results.map(record).filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item, index): LiteratureSource => {
      const info = record(item.publication_info)
      const summary = text(info?.summary) ?? ''
      const yearMatch = summary.match(/\b(19|20)\d{2}\b/u)
      const authors = summary.includes(' - ') ? summary.split(' - ')[0]!.split(',').map(name => name.trim()).filter(Boolean) : []
      const cited = record(record(item.inline_links)?.cited_by)
      return {
        id: text(item.result_id) ?? text(item.link) ?? `google-scholar-${index}`,
        title: text(item.title) ?? `Google Scholar ${index + 1}`,
        authors,
        ...yearMatch == null ? {} : { year: Number(yearMatch[0]) },
        ...summary === '' ? {} : { venue: summary },
        ...text(item.link) === undefined ? {} : { url: text(item.link) },
        ...text(item.snippet) === undefined ? {} : { abstract: text(item.snippet) },
        ...numberValue(cited?.total) === undefined ? {} : { citedBy: numberValue(cited?.total) },
        source: 'google-scholar',
      }
    })
    .slice(0, options.limit)
}

function gatewayEndpoint(envValue: string): string {
  return /\/search(?:\?|$)/u.test(envValue) ? envValue : `${envValue.replace(/\/$/u, '')}/search`
}

async function searchSubscriptionGateway(
  database: 'cnki' | 'wanfang',
  query: string,
  options: DatabaseSearchOptions,
): Promise<LiteratureSource[]> {
  const env = options.env ?? process.env
  const prefix = database === 'cnki' ? 'EYANBAO_CNKI' : 'EYANBAO_WANFANG'
  const endpoint = env[`${prefix}_API_URL`]?.trim()
  if (endpoint === undefined || endpoint === '') throw new Error(`${database === 'cnki' ? 'CNKI' : '万方'} API 网关未配置`)
  const apiKey = env[`${prefix}_API_KEY`]?.trim()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const payload = await fetchJson(gatewayEndpoint(endpoint), options.fetcher ?? fetch, options.signal ?? new AbortController().signal, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, limit: options.limit, database }),
  })
  const root = record(payload)
  const items = Array.isArray(payload) ? payload : Array.isArray(root?.items) ? root.items : []
  return items.map(record).filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item, index): LiteratureSource => {
      const doi = normalizeDoi(item.doi)
      const authors = Array.isArray(item.authors)
        ? item.authors.map(author => typeof author === 'string' ? author : text(record(author)?.name)).filter((name): name is string => name !== undefined)
        : []
      return {
        id: text(item.id) ?? `${database}-${index}`,
        title: text(item.title) ?? `${database.toLocaleUpperCase()} ${index + 1}`,
        authors,
        language: text(item.language) ?? 'zh',
        ...numberValue(item.year) === undefined ? {} : { year: numberValue(item.year) },
        ...text(item.venue) === undefined ? {} : { venue: text(item.venue) },
        ...doi === undefined ? {} : { doi, url: `https://doi.org/${doi}` },
        ...text(item.url) === undefined ? {} : { url: text(item.url) },
        ...text(item.abstract) === undefined ? {} : { abstract: text(item.abstract) },
        ...numberValue(item.citedBy) === undefined ? {} : { citedBy: numberValue(item.citedBy) },
        source: database,
      }
    })
    .slice(0, options.limit)
}

export async function searchExternalDatabase(
  database: Exclude<DatabaseId, 'openalex' | 'crossref'>,
  query: string,
  options: DatabaseSearchOptions,
): Promise<LiteratureSource[]> {
  switch (database) {
    case 'pubmed': return await searchPubMed(query, options)
    case 'web-of-science': return await searchWebOfScience(query, options)
    case 'scopus': return await searchScopus(query, options)
    case 'google-scholar': return await searchGoogleScholar(query, options)
    case 'cnki': return await searchSubscriptionGateway('cnki', query, options)
    case 'wanfang': return await searchSubscriptionGateway('wanfang', query, options)
  }
}
