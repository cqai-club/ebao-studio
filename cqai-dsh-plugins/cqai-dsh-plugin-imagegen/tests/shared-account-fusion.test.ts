import type { DsnAccountService, DsnModel } from '@cqaiclub/dsn-account'
import { describe, expect, it, vi } from 'vitest'

import { Config, inject } from '../src/index.ts'
import { CqaiImageProvider } from '../src/cqai-image-provider.ts'
import type { GenerateRequest } from '../src/protocol.ts'

const models: DsnModel[] = ['image-a', 'image-b'].map(id => ({
  id,
  ownedBy: 'cqai',
  categories: ['image'],
  supportedEndpointTypes: ['image-generation'],
}))

function sharedAccount(provider: string): DsnAccountService {
  return {
    getStatus: vi.fn(async () => ({
      state: 'signed-in' as const,
      account: { userId: 1, platform: 'cqai' },
      refreshedAt: Date.now(),
      stale: false,
    })),
    getAccount: vi.fn(),
    listModels: vi.fn(async () => ({ models, fetchedAt: Date.now(), stale: false })),
    getDefaultModel: vi.fn(async () => ({ provider, model: 'chat-a' })),
    setDefaultModel: vi.fn(),
    getCategoryDefaultModels: vi.fn(async () => ({
      global: { provider, model: 'chat-a' },
      categories: { image: { provider, model: 'image-b' } },
    })),
    setCategoryDefaultModel: vi.fn(),
    getTopUpInfo: vi.fn(),
    listTopUps: vi.fn(),
    createTopUp: vi.fn(),
    fetchAi: vi.fn(),
  } as unknown as DsnAccountService
}

function request(): GenerateRequest {
  return {
    mode: 'text',
    model: '',
    prompt: 'draw a fox',
    size: '1:1',
    quality: 'auto',
    n: 1,
    detail: '',
  }
}

describe('shared @cqaiclub/dsn-account fusion', () => {
  it('requires the shared Host service without owning account configuration', () => {
    expect(inject).toEqual(['dsnAccount', 'credentials', 'webServer', 'systemPrompt', 'commands'])

    const resolved = Config({}) as Record<string, unknown>
    expect(resolved).not.toHaveProperty('issuer')
    expect(resolved).not.toHaveProperty('clientId')
    expect(resolved).not.toHaveProperty('resource')
    expect(resolved).not.toHaveProperty('accountServiceUrl')
    expect(resolved).not.toHaveProperty('scopes')
  })

  it.each(['cqaiclub', 'cqai'])('honors %s account defaults while keeping image tasks on cqai', async providerId => {
    const provider = new CqaiImageProvider(sharedAccount(providerId))

    await expect(provider.resolveRequest(request())).resolves.toMatchObject({
      model: 'image-b',
      upstream: 'image-b',
      channelId: 'cqai',
      channel: 'CQAI',
    })
    expect(provider.channel()).toMatchObject({ id: 'cqai', preset: 'cqai' })
  })

  it('does not adopt another provider\'s category default', async () => {
    const provider = new CqaiImageProvider(sharedAccount('third-party'))

    await expect(provider.resolveRequest(request())).rejects.toMatchObject({
      code: 'model-choice-required',
    })
  })

  it('handles an account change snapshot without polling status recursively', async () => {
    const account = sharedAccount('cqai')
    const provider = new CqaiImageProvider(account)

    await expect(provider.describeSnapshot({
      state: 'signed-in',
      account: { userId: 1, platform: 'cqai' },
      refreshedAt: Date.now(),
      stale: false,
    })).resolves.toMatchObject({
      provider: 'cqai',
      state: 'signed-in',
      models: [{ id: 'image-a' }, { id: 'image-b' }],
      defaultModel: 'image-b',
    })

    expect(account.getStatus).not.toHaveBeenCalled()
    expect(account.listModels).toHaveBeenCalledOnce()
  })
})
