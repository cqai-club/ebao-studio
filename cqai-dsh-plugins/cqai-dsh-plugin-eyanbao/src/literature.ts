import type { Language, LiteratureScope, LiteratureSource } from './protocol.ts'

export interface LiteratureSearchOptions {
  limit: number
  yearFrom?: number
  scope: LiteratureScope
  signal?: AbortSignal
  fetcher?: typeof fetch
}

export interface LiteratureSearchResult {
  sources: LiteratureSource[]
  warning?: string
}

interface OpenAlexWork {
  id?: string
  doi?: string
  title?: string
  display_name?: string
  publication_year?: number
  language?: string
  cited_by_count?: number
  abstract_inverted_index?: Record<string, number[]>
  authorships?: Array<{ author?: { display_name?: string } }>
  primary_location?: { landing_page_url?: string; source?: { display_name?: string } }
}

interface CrossrefItem {
  DOI?: string
  title?: string[]
  author?: Array<{ given?: string; family?: string; name?: string }>
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  abstract?: string
  URL?: string
  language?: string
  'is-referenced-by-count'?: number
}

function normalizeDoi(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const doi = value.replace(/^https?:\/\/doi\.org\//iu, '').trim()
  return doi === '' ? undefined : doi
}

function reconstructAbstract(index: Record<string, number[]> | undefined): string | undefined {
  if (index === undefined) return undefined
  const words: Array<[number, string]> = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word])
  }
  words.sort((left, right) => left[0] - right[0])
  const text = words.map(([, word]) => word).join(' ').replace(/\s+/gu, ' ').trim()
  return text === '' ? undefined : text
}

function cleanAbstract(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = value
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .trim()
  return text === '' ? undefined : text
}

function uniqueSources(sources: LiteratureSource[], limit: number): LiteratureSource[] {
  const seen = new Set<string>()
  const unique: LiteratureSource[] = []
  for (const source of sources) {
    const key = (source.doi ?? source.title).toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(source)
    if (unique.length >= limit) break
  }
  return unique
}

function normalizedLanguage(value: string | undefined): string | undefined {
  const language = value?.trim().toLocaleLowerCase()
  return language === undefined || language === '' ? undefined : language
}

function hasHanText(value: string): boolean {
  return /\p{Script=Han}/u.test(value)
}

function isChineseSource(source: LiteratureSource): boolean {
  const language = normalizedLanguage(source.language)
  if (language !== undefined && language !== 'und') return language.startsWith('zh')
  return hasHanText(source.title)
}

function matchesScope(source: LiteratureSource, scope: LiteratureScope): boolean {
  if (scope === 'mixed') return true
  return scope === 'zh' ? isChineseSource(source) : !isChineseSource(source)
}

async function fetchJson(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'eYanBao/0.2 (DeepSeek Harness academic workspace)',
    },
    signal,
  })
  if (!response.ok) throw new Error(`文献服务返回 HTTP ${response.status}`)
  return await response.json()
}

export async function searchOpenAlex(
  query: string,
  options: LiteratureSearchOptions,
): Promise<LiteratureSource[]> {
  const fetcher = options.fetcher ?? fetch
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('search', query)
  url.searchParams.set('per-page', String(Math.min(30, Math.max(options.limit * 2, 10))))
  url.searchParams.set('sort', 'relevance_score:desc')
  url.searchParams.set('select', 'id,doi,title,display_name,publication_year,language,cited_by_count,abstract_inverted_index,authorships,primary_location')
  const filters = ['is_retracted:false']
  if (options.yearFrom !== undefined) filters.push(`from_publication_date:${options.yearFrom}-01-01`)
  url.searchParams.set('filter', filters.join(','))
  const payload = await fetchJson(url.toString(), fetcher, options.signal ?? new AbortController().signal) as {
    results?: OpenAlexWork[]
  }
  return (payload.results ?? [])
    .filter(work => typeof work.title === 'string' || typeof work.display_name === 'string')
    .map((work, index): LiteratureSource => {
      const doi = normalizeDoi(work.doi)
      const title = (work.title ?? work.display_name ?? '').replace(/\s+/gu, ' ').trim()
      const authors = (work.authorships ?? [])
        .map(authorship => authorship.author?.display_name?.trim() ?? '')
        .filter(Boolean)
      return {
        id: work.id ?? doi ?? `openalex-${index}`,
        title,
        authors,
        ...normalizedLanguage(work.language) === undefined ? {} : { language: normalizedLanguage(work.language) },
        ...work.publication_year === undefined ? {} : { year: work.publication_year },
        ...work.primary_location?.source?.display_name === undefined
          ? {}
          : { venue: work.primary_location.source.display_name },
        ...doi === undefined ? {} : { doi },
        ...work.primary_location?.landing_page_url === undefined
          ? doi === undefined ? {} : { url: `https://doi.org/${doi}` }
          : { url: work.primary_location.landing_page_url },
        ...reconstructAbstract(work.abstract_inverted_index) === undefined
          ? {}
          : { abstract: reconstructAbstract(work.abstract_inverted_index) },
        ...work.cited_by_count === undefined ? {} : { citedBy: work.cited_by_count },
        source: 'openalex',
      }
    })
    .filter(source => matchesScope(source, options.scope))
}

export async function searchCrossref(
  query: string,
  options: LiteratureSearchOptions,
): Promise<LiteratureSource[]> {
  const fetcher = options.fetcher ?? fetch
  const url = new URL('https://api.crossref.org/works')
  url.searchParams.set('query.bibliographic', query)
  url.searchParams.set('rows', String(Math.min(30, Math.max(options.limit * 2, 10))))
  if (options.yearFrom !== undefined) {
    url.searchParams.set('filter', `from-pub-date:${options.yearFrom}-01-01,type:journal-article`)
  }
  const payload = await fetchJson(url.toString(), fetcher, options.signal ?? new AbortController().signal) as {
    message?: { items?: CrossrefItem[] }
  }
  return (payload.message?.items ?? [])
    .filter(item => Array.isArray(item.title) && item.title[0] !== undefined)
    .map((item, index): LiteratureSource => {
      const doi = normalizeDoi(item.DOI)
      const authors = (item.author ?? []).map(author => {
        if (author.name !== undefined) return author.name
        return [author.given, author.family].filter(Boolean).join(' ')
      }).filter(Boolean)
      const year = item.issued?.['date-parts']?.[0]?.[0]
      return {
        id: doi ?? `crossref-${index}`,
        title: item.title?.[0]?.replace(/\s+/gu, ' ').trim() ?? '',
        authors,
        ...normalizedLanguage(item.language) === undefined ? {} : { language: normalizedLanguage(item.language) },
        ...year === undefined ? {} : { year },
        ...item['container-title']?.[0] === undefined ? {} : { venue: item['container-title'][0] },
        ...doi === undefined ? {} : { doi },
        ...item.URL === undefined ? {} : { url: item.URL },
        ...cleanAbstract(item.abstract) === undefined ? {} : { abstract: cleanAbstract(item.abstract) },
        ...item['is-referenced-by-count'] === undefined
          ? {}
          : { citedBy: item['is-referenced-by-count'] },
        source: 'crossref',
      }
    })
    .filter(source => matchesScope(source, options.scope))
}

export async function searchLiterature(
  query: string | string[],
  options: LiteratureSearchOptions,
): Promise<LiteratureSearchResult> {
  const queries = [...new Set((Array.isArray(query) ? query : [query])
    .map(item => item.trim())
    .filter(Boolean))]
  if (queries.length === 0) throw new Error('文献检索主题不能为空')
  const collected: LiteratureSource[] = []
  let partialFailure = false
  for (const normalized of queries) {
    try {
      collected.push(...await searchOpenAlex(normalized, options))
    } catch {
      partialFailure = true
    }
  }
  const openAlexSources = uniqueSources(collected, options.limit)
  if (openAlexSources.length > 0) {
    return {
      sources: openAlexSources,
      ...partialFailure ? { warning: '部分检索请求失败，结果可能不完整。' } : {},
    }
  }

  const crossref: LiteratureSource[] = []
  let crossrefFailed = false
  for (const normalized of queries) {
    try {
      crossref.push(...await searchCrossref(normalized, options))
    } catch {
      crossrefFailed = true
    }
  }
  const crossrefSources = uniqueSources(crossref, options.limit)
  if (crossrefSources.length > 0) {
    return {
      sources: crossrefSources,
      warning: partialFailure
        ? 'OpenAlex 暂不可用，本次文献结果来自 Crossref。'
        : crossrefFailed
          ? 'Crossref 部分请求失败，本次结果可能不完整。'
          : '本次文献结果来自 Crossref。',
    }
  }
  if (crossrefFailed && partialFailure) {
    throw new Error('文献检索服务暂时不可用，请稍后重试。')
  }
  return {
    sources: [],
    warning: options.scope === 'foreign'
      ? '没有检索到外文文献，请改用更明确的英文关键词或扩大年份范围。'
      : options.scope === 'zh'
        ? '没有检索到中文文献，请尝试更具体的中文研究主题。'
        : '两个文献服务都没有返回匹配结果，请尝试更具体的研究主题。',
  }
}

export function formatAuthorsForCitation(authors: string[], language: Language): string {
  if (authors.length === 0) return language === 'zh' ? '佚名' : 'Anon.'
  if (authors.length > 3) return `${authors.slice(0, 3).join(language === 'zh' ? '、' : ', ')}${
    language === 'zh' ? '等' : ' et al.'
  }`
  return authors.join(language === 'zh' ? '、' : ', ')
}
