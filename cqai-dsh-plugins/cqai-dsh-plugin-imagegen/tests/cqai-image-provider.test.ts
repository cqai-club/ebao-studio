import { describe, expect, it, vi } from 'vitest'
import type { DsnAccountService, DsnAccountSnapshot, DsnModel } from '@cqaiclub/dsn-account'
import { CqaiImageProvider } from '../src/cqai-image-provider.ts'
import { generateImage } from '../src/engine.ts'
import type { GenerateRequest } from '../src/protocol.ts'

const image = (id: string): DsnModel => ({
  id,
  ownedBy: 'cqai',
  categories: ['image'],
  supportedEndpointTypes: ['image-generation'],
})
const chat: DsnModel = {
  id: 'cqai-chat',
  ownedBy: 'cqai',
  categories: ['text'],
  supportedEndpointTypes: ['openai'],
}
const falsePositive: DsnModel = {
  id: 'image-looking-chat',
  ownedBy: 'cqai',
  categories: ['image'],
  supportedEndpointTypes: ['openai'],
}
const structuredImage: DsnModel = {
  id: 'structured-image',
  ownedBy: 'cqai',
  categories: ['other'],
  supportedEndpointTypes: ['image-generation'],
  architecture: { inputModalities: ['text'], outputModalities: ['image'] },
}
const staleImageCategory: DsnModel = {
  id: 'stale-image-category',
  ownedBy: 'cqai',
  categories: ['image'],
  supportedEndpointTypes: ['image-generation'],
  architecture: { inputModalities: ['text'], outputModalities: ['text'] },
}

function service(
  models: DsnModel[],
  imageDefault?: string,
  defaultProvider = 'cqaiclub',
): DsnAccountService & { fetchAi: ReturnType<typeof vi.fn> } {
  return {
    getStatus: vi.fn(async () => ({
      state: 'signed-in' as const,
      account: { userId: 1, platform: 'cqai' },
      refreshedAt: Date.now(),
      stale: false,
    })),
    getAccount: vi.fn(async () => ({ userId: 1, platform: 'cqai' })),
    listModels: vi.fn(async () => ({ models, fetchedAt: Date.now(), stale: false })),
    getDefaultModel: vi.fn(async () => ({ provider: defaultProvider, model: 'cqai-chat' })),
    setDefaultModel: vi.fn(),
    getCategoryDefaultModels: vi.fn(async () => ({
      global: { provider: defaultProvider, model: 'cqai-chat' },
      categories: imageDefault === undefined ? {} : { image: { provider: defaultProvider, model: imageDefault } },
    })),
    setCategoryDefaultModel: vi.fn(),
    getTopUpInfo: vi.fn(),
    listTopUps: vi.fn(),
    createTopUp: vi.fn(),
    fetchAi: vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from('image').toString('base64') }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })),
  } as unknown as DsnAccountService & { fetchAi: ReturnType<typeof vi.fn> }
}

function request(model = ''): GenerateRequest {
  return { mode: 'text', model, prompt: 'draw a fox', size: '1:1', quality: 'auto', n: 1, detail: '' }
}

describe('CqaiImageProvider', () => {
  it('filters the account catalog by image and image-generation capability and honors the category default', async () => {
    const account = service([
      image('one'),
      falsePositive,
      structuredImage,
      staleImageCategory,
      image('two'),
      chat,
    ], 'two')
    const provider = new CqaiImageProvider(account)

    await expect(provider.describe()).resolves.toMatchObject({
      provider: 'cqai',
      state: 'signed-in',
      models: [
        { alias: 'one', id: 'one' },
        { alias: 'structured-image', id: 'structured-image' },
        { alias: 'two', id: 'two' },
      ],
      defaultModel: 'two',
    })
    await expect(provider.resolveRequest(request())).resolves.toMatchObject({
      model: 'two', upstream: 'two', channelId: 'cqai', channel: 'CQAI',
    })
  })

  it('auto-selects exactly one model but requires a choice for an ambiguous catalog', async () => {
    const one = new CqaiImageProvider(service([image('only')]))
    await expect(one.resolveRequest(request())).resolves.toMatchObject({ model: 'only' })

    const manyAccount = service([image('a'), image('b')])
    const many = new CqaiImageProvider(manyAccount)
    await expect(many.resolveRequest(request())).rejects.toMatchObject({ code: 'model-choice-required' })
    await expect(many.resolveRequest(request('gone'))).rejects.toMatchObject({ code: 'cqai-model-unavailable' })
    await expect(many.resolveRequest(request('b'))).resolves.toMatchObject({ model: 'b', upstream: 'b' })
    expect(manyAccount.setCategoryDefaultModel).not.toHaveBeenCalled()
  })

  it('uses only the Account Service image endpoints and never creates an Authorization header', async () => {
    const account = service([image('qwen-image')], 'qwen-image')
    const provider = new CqaiImageProvider(account)
    const resolved = await provider.resolveRequest(request())
    const result = await generateImage(provider.channel(), resolved)

    expect(result.images).toHaveLength(1)
    expect(account.fetchAi).toHaveBeenCalledTimes(1)
    const [path, init] = account.fetchAi.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/v1/images/generations')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'qwen-image', prompt: 'draw a fox' })
  })

  it('does not fall back when signed out', async () => {
    const account = service([image('only')])
    account.getStatus = vi.fn(async (): Promise<DsnAccountSnapshot> => ({ state: 'signed-out' }))
    const provider = new CqaiImageProvider(account)
    await expect(provider.resolveRequest(request())).rejects.toMatchObject({ code: 'cqai-auth-required' })
    expect(account.fetchAi).not.toHaveBeenCalled()
  })

  it('runs prompt enhancement through CQAI chat completions', async () => {
    const account = service([image('img'), chat], 'img')
    account.fetchAi.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '<think>hidden</think>Detailed fox prompt' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const provider = new CqaiImageProvider(account)

    await expect(provider.complete({ system: 'enhance', content: 'fox' })).resolves.toBe('Detailed fox prompt')
    const [path, init] = account.fetchAi.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/v1/chat/completions')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'cqai-chat' })
  })
})
