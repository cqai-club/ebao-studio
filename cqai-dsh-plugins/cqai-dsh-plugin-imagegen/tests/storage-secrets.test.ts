import { describe, expect, it } from 'vitest'
import { resolveStorageConfig } from '../src/index.ts'

describe('S3 runtime credentials', () => {
  it('uses both Credentials values and never falls back to legacy plaintext settings', () => {
    const resolved = resolveStorageConfig({
      storageEnabled: true,
      storageEndpoint: ' https://bucket.example.com ',
      storageRegion: ' ap-guangzhou ',
      storagePrefix: ' images ',
      storageAccessKey: 'legacy-plaintext-access',
      storageSecretKey: 'legacy-plaintext-secret',
      storageSyncGallery: false,
      storageSyncHistory: true,
    }, {
      storageAccessKey: 'credential-access',
      storageSecretKey: 'credential-secret',
    })

    expect(resolved).toEqual({
      enabled: true,
      endpoint: 'https://bucket.example.com',
      region: 'ap-guangzhou',
      accessKey: 'credential-access',
      secretKey: 'credential-secret',
      prefix: 'images',
      syncGallery: false,
      syncHistory: true,
    })

    const withoutCredentials = resolveStorageConfig({
      storageAccessKey: 'must-not-fallback',
      storageSecretKey: 'must-not-fallback',
    }, {})
    expect(withoutCredentials.accessKey).toBe('')
    expect(withoutCredentials.secretKey).toBe('')
  })
})
