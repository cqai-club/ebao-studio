import { describe, expect, it, vi } from 'vitest'
import { searchCrossref, searchLiterature, searchOpenAlex } from '../src/literature.ts'

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('literature search', () => {
  it('normalizes OpenAlex works and reconstructs abstracts', async () => {
    const fetcher = vi.fn(async () => response({
      results: [{
        id: 'https://openalex.org/W1',
        doi: 'https://doi.org/10.1000/demo',
        title: 'A useful paper',
        publication_year: 2024,
        cited_by_count: 9,
        abstract_inverted_index: { This: [0], is: [1], evidence: [2] },
        authorships: [{ author: { display_name: 'Ada Lovelace' } }],
        primary_location: { landing_page_url: 'https://example.test/paper', source: { display_name: 'Demo Journal' } },
      }],
    }))
    const sources = await searchOpenAlex('evidence', { limit: 5, language: 'zh', fetcher: fetcher as unknown as typeof fetch })
    expect(sources[0]).toMatchObject({
      title: 'A useful paper',
      doi: '10.1000/demo',
      abstract: 'This is evidence',
      venue: 'Demo Journal',
      source: 'openalex',
    })
    const firstCall = fetcher.mock.calls[0] as unknown[] | undefined
    const url = String(firstCall?.[0])
    expect(url).toContain('is_retracted%3Afalse')
  })

  it('falls back to Crossref when OpenAlex fails', async () => {
    const fetcher = vi.fn(async input => {
      const url = String(input)
      if (url.includes('openalex')) throw new Error('offline')
      return response({
        message: { items: [{
          DOI: '10.2000/fallback',
          title: ['Crossref fallback'],
          author: [{ given: 'Grace', family: 'Hopper' }],
          issued: { 'date-parts': [[2022]] },
          'container-title': ['Fallback Journal'],
          URL: 'https://doi.org/10.2000/fallback',
        }] },
      })
    }) as unknown as typeof fetch
    const result = await searchLiterature('fallback', { limit: 5, language: 'zh', fetcher })
    expect(result.sources[0]).toMatchObject({ title: 'Crossref fallback', year: 2022, source: 'crossref' })
    expect(result.warning).toContain('Crossref')
  })

  it('removes duplicate DOI records', async () => {
    const fetcher = vi.fn(async input => {
      if (String(input).includes('openalex')) throw new Error('offline')
      return response({
        message: { items: [
          { DOI: '10.1/same', title: ['First'], author: [] },
          { DOI: '10.1/same', title: ['Second'], author: [] },
        ] },
      })
    })
    const result = await searchLiterature('same', { limit: 10, language: 'en', fetcher: fetcher as unknown as typeof fetch })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].title).toBe('First')
  })
})
