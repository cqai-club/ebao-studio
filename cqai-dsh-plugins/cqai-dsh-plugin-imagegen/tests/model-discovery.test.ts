import { afterEach, describe, expect, it, vi } from 'vitest'
import { listImageModels, listOpenAIModels, listPromptModels } from '../src/prompt-enhancer.ts'

const config = { apiUrl: 'https://gateway.test', apiKey: ' secret ' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

afterEach(() => vi.unstubAllGlobals())

describe('model discovery compatibility', () => {
  it.each([
    { data: [' model-z ', { id: 'model-a' }, 'model-a', '', null, { id: 7 }] },
    { models: [' model-z ', { id: 'model-a' }, 'model-a', '', null, { id: 7 }] },
    [' model-z ', { id: 'model-a' }, 'model-a', '', null, { id: 7 }],
  ])('accepts a supported list shape and normalizes model IDs (%#)', async body => {
    const fetchMock = vi.fn().mockResolvedValue(json(body))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listOpenAIModels(config)).toEqual(['model-a', 'model-z'])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.test/models', {
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    })
  })

  it('preserves explicit capabilities when filtering image models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ models: [
      { id: 'custom-renderer', capabilities: { image_generation: true } },
      { id: 'gpt-image-2', capabilities: { image_generation: false } },
      'glm-image', 'gpt-4o',
    ] })))
    expect(await listImageModels(config)).toEqual(['custom-renderer', 'glm-image'])
  })

  it('keeps prompt-model discovery inclusive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(['gpt-image-2', 'gpt-4o'])))
    expect(await listPromptModels({ ...config, model: '' })).toEqual(['gpt-4o', 'gpt-image-2'])
  })

  it('accepts an explicitly empty list without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listOpenAIModels(config)).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([404, 405])('falls back after an endpoint HTTP %i', async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: { message: 'missing route' } }, status))
      .mockResolvedValueOnce(json({ models: ['gpt-4o'] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listOpenAIModels(config)).toEqual(['gpt-4o'])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://gateway.test/models', 'https://gateway.test/v1/models',
    ])
  })

  it.each([
    new Response('<html>gateway homepage</html>', { headers: { 'content-type': 'text/html' } }),
    json({ success: true }),
  ])('falls back from successful responses that are not model lists (%#)', async response => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(json(['gpt-4o']))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listOpenAIModels(config)).toEqual(['gpt-4o'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tries the alternate discovery path after a connection failure', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValueOnce(json(['gpt-4o']))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listOpenAIModels(config)).toEqual(['gpt-4o'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 429, 500])('does not retry authentication or service HTTP %i errors', async status => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { message: 'provider rejected request' } }, status))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listOpenAIModels(config)).rejects.toThrow('provider rejected request')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports a bounded non-JSON preview with response details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(`  <html>\n${'x'.repeat(2_000)}</html>`, {
      headers: { 'content-type': 'text/html' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const error = await listOpenAIModels({ ...config, apiUrl: 'https://gateway.test/v1' }).catch(error => error as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('HTTP 200, text/html')
    expect((error as Error).message).toContain('<html> ')
    expect((error as Error).message.length).toBeLessThan(240)
    expect((error as Error).message).not.toContain('\n')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports missing-list responses instead of returning an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ unexpected: [] })))
    await expect(listOpenAIModels(config)).rejects.toThrow('模型接口响应中没有 data/models 列表')
  })

  it('bounds upstream error text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'x'.repeat(2_000) }, 403)))
    const error = await listOpenAIModels(config).catch(error => error as Error)
    expect((error as Error).message).toHaveLength(320)
  })
})

describe('discovery URL paths', () => {
  it.each([
    ['https://gateway.test/v1/chat/completions?key=ignored#anchor', 'https://gateway.test/v1/models'],
    ['https://gateway.test/chat/completions/', 'https://gateway.test/models'],
    ['https://gateway.test/api/v2beta/chat/completions', 'https://gateway.test/api/v2beta/models'],
    ['https://gateway.test/models?key=ignored#anchor', 'https://gateway.test/models'],
    ['https://gateway.test/api/v1/models/', 'https://gateway.test/api/v1/models'],
    [' https://gateway.test/api/?key=ignored#anchor ', 'https://gateway.test/api/models'],
    ['https://gateway.test/v1/', 'https://gateway.test/v1/models'],
  ])('resolves %s to %s', async (apiUrl, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(json(['gpt-4o']))
    vi.stubGlobal('fetch', fetchMock)
    await listOpenAIModels({ apiUrl, apiKey: '' })
    expect(fetchMock).toHaveBeenCalledWith(expected, { headers: { 'content-type': 'application/json' } })
  })

  it('uses /v1/models as fallback for an explicit /models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json(['gpt-4o']))
    vi.stubGlobal('fetch', fetchMock)
    await listOpenAIModels({ ...config, apiUrl: 'https://gateway.test/api/models' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://gateway.test/api/models', 'https://gateway.test/api/v1/models',
    ])
  })

  it('does not append another version segment to an existing versioned endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 404))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listOpenAIModels({ ...config, apiUrl: 'https://gateway.test/api/v2beta' })).rejects.toThrow('HTTP 404')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects an empty URL before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(listOpenAIModels({ ...config, apiUrl: '  ' })).rejects.toThrow('API URL is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
