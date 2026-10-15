import { describe, expect, it } from 'vitest'

import { isDsnDefaultModelCategory, isPublicAccount, parseDsnModelList, remainingQuota } from '../src/protocol.ts'

describe('account protocol', () => {
  it('uses the service-reported remaining wallet quota', () => {
    expect(remainingQuota({ userId: 1, platform: 'dsn', quota: 100, quotaUsed: 40 })).toBe(100)
    expect(remainingQuota({ userId: 1, platform: 'dsn', quota: 10, quotaUsed: 20 })).toBe(10)
    expect(remainingQuota({ userId: 1, platform: 'dsn', quota: 100, tokenQuota: 0, tokenUnlimitedQuota: false })).toBe(0)
    expect(remainingQuota({ userId: 1, platform: 'dsn', quota: 100, tokenQuota: 30, tokenUnlimitedQuota: false })).toBe(30)
    expect(remainingQuota({ userId: 1, platform: 'dsn' })).toBeUndefined()
  })

  it('keeps tokenId flexible but requires quota fields to be numeric', () => {
    expect(isPublicAccount({ userId: 1, platform: 'dsn', tokenId: '42', quota: 10, quotaUsed: 2 })).toBe(true)
    expect(isPublicAccount({ userId: 1, platform: 'dsn', tokenQuota: 10, tokenUnlimitedQuota: false })).toBe(true)
    expect(isPublicAccount({ userId: 1, platform: 'dsn', quota: '10' })).toBe(false)
    expect(isPublicAccount({ userId: 1, platform: 'dsn', quota: Number.NaN })).toBe(false)
    expect(isPublicAccount({ userId: 1, platform: 'dsn', tokenUnlimitedQuota: 'false' })).toBe(false)
  })

  it('preserves vector and rerank catalog categories and their endpoint declarations', () => {
    expect(parseDsnModelList([
      {
        id: 'vector', owned_by: 'relay',
        categories: ['embedding', 'embedding', 'unsupported'],
        supported_endpoint_types: ['embeddings'],
      },
      {
        id: 'ranking', owned_by: 'relay', categories: ['rerank'],
        supported_endpoint_types: ['jina-rerank'],
      },
    ])).toEqual([
      { id: 'vector', ownedBy: 'relay', categories: ['embedding'], supportedEndpointTypes: ['embeddings'] },
      { id: 'ranking', ownedBy: 'relay', categories: ['rerank'], supportedEndpointTypes: ['jina-rerank'] },
    ])
    expect(isDsnDefaultModelCategory('embedding')).toBe(true)
    expect(isDsnDefaultModelCategory('rerank')).toBe(false)
  })
})
