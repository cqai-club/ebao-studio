import { describe, expect, it, vi } from 'vitest'
import { databaseStatuses, searchExternalDatabase } from '../src/database-connectors.ts'

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

const options = (env: NodeJS.ProcessEnv, fetcher: typeof fetch) => ({
  limit: 5,
  scope: 'mixed' as const,
  signal: new AbortController().signal,
  env,
  fetcher,
})

describe('database connectors', () => {
  it('reports subscribed providers as unavailable until credentials are configured', () => {
    const empty = databaseStatuses({} as NodeJS.ProcessEnv)
    expect(empty.filter(item => item.available).map(item => item.id)).toEqual(['openalex', 'crossref', 'pubmed'])
    const configured = databaseStatuses({
      WOS_API_KEY: 'wos',
      SCOPUS_API_KEY: 'scopus',
      SERPAPI_API_KEY: 'serp',
      EYANBAO_CNKI_API_URL: 'https://cnki.example.test',
      EYANBAO_WANFANG_API_URL: 'https://wanfang.example.test',
    } as NodeJS.ProcessEnv)
    expect(configured.every(item => item.available)).toBe(true)
  })

  it('parses PubMed E-utilities', async () => {
    const fetcher = vi.fn(async input => {
      const url = String(input)
      if (url.includes('esearch')) return response({ esearchresult: { idlist: ['123'] } })
      return response({
        result: {
          uids: ['123'],
          123: {
            title: 'Medical evidence',
            pubdate: '2024 Jan',
            source: 'The Lancet',
            authors: [{ name: 'Ada Lovelace' }],
            articleids: [{ idtype: 'doi', value: '10.1/medical' }],
          },
        },
      })
    }) as unknown as typeof fetch
    const sources = await searchExternalDatabase('pubmed', 'medical evidence', options({}, fetcher))
    expect(sources[0]).toMatchObject({
      title: 'Medical evidence',
      year: 2024,
      venue: 'The Lancet',
      doi: '10.1/medical',
      source: 'pubmed',
    })
  })

  it('parses Web of Science and Scopus API responses', async () => {
    const fetcher = vi.fn(async input => {
      const url = String(input)
      if (url.includes('clarivate')) {
        return response({
          hits: [{
            uid: 'WOS:1',
            title: 'Management evidence',
            names: { authors: [{ displayName: 'Grace Hopper' }] },
            publicationInfo: { year: 2023, sourceTitle: 'Academy of Management Journal' },
            identifiers: { doi: '10.1/wos' },
          }],
        })
      }
      return response({
        'search-results': {
          entry: [{
            eid: '2-s2.0-1',
            'dc:title': 'Scopus evidence',
            'dc:creator': 'Alan Turing',
            'prism:publicationName': 'MIS Quarterly',
            'prism:coverDate': '2022-01-01',
            'prism:doi': '10.1/scopus',
            'citedby-count': '12',
          }],
        },
      })
    }) as unknown as typeof fetch
    const wos = await searchExternalDatabase('web-of-science', 'management', options({ WOS_API_KEY: 'key' }, fetcher))
    const scopus = await searchExternalDatabase('scopus', 'management', options({ SCOPUS_API_KEY: 'key' }, fetcher))
    expect(wos[0]).toMatchObject({ title: 'Management evidence', topJournal: true, source: 'web-of-science' })
    expect(scopus[0]).toMatchObject({ title: 'Scopus evidence', topJournal: true, citedBy: 12, source: 'scopus' })
  })

  it('parses SerpAPI Google Scholar and subscription gateways', async () => {
    const fetcher = vi.fn(async input => {
      const url = String(input)
      if (url.includes('serpapi')) {
        return response({
          organic_results: [{
            result_id: 'gs-1',
            title: 'Scholar evidence',
            link: 'https://example.test/scholar',
            snippet: 'A useful abstract.',
            publication_info: { summary: 'Ada Lovelace - Nature, 2024' },
            inline_links: { cited_by: { total: 9 } },
          }],
        })
      }
      return response({
        items: [{
          id: 'gateway-1',
          title: '中文文献',
          authors: ['张三'],
          year: 2021,
          venue: '教育研究',
          language: 'zh',
          abstract: '摘要',
        }],
      })
    }) as unknown as typeof fetch
    const scholar = await searchExternalDatabase('google-scholar', 'education', options({ SERPAPI_API_KEY: 'key' }, fetcher))
    const cnki = await searchExternalDatabase('cnki', '教育', options({ EYANBAO_CNKI_API_URL: 'https://cnki.test/api' }, fetcher))
    const wanfang = await searchExternalDatabase('wanfang', '教育', options({ EYANBAO_WANFANG_API_URL: 'https://wanfang.test/api' }, fetcher))
    expect(scholar[0]).toMatchObject({ title: 'Scholar evidence', year: 2024, citedBy: 9, source: 'google-scholar' })
    expect(cnki[0]).toMatchObject({ title: '中文文献', language: 'zh', source: 'cnki' })
    expect(wanfang[0]).toMatchObject({ title: '中文文献', source: 'wanfang' })
  })
})
