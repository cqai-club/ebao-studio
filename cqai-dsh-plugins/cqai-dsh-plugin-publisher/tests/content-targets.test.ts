import { describe, expect, it } from 'vitest'
import { CONTENT_ACCOUNT_PLATFORMS, contentModeAvailable, selectedContentAccounts } from '../src/content-targets.ts'
import type { PublisherAccount, PublisherPlatformCapability } from '../src/protocol.ts'

const account = (id: string, platform: PublisherAccount['platform']): PublisherAccount => ({
  id, platform, displayName: id, loginState: 'logged-in',
})

describe('article and image-note account choices', () => {
  it('keeps adapter accounts selectable even while their submission capability is closed', () => {
    const accounts = [account('juejin-1', 'juejin'), account('blbl-1', 'blbl'), account('xhs-1', 'xhs')]
    expect(CONTENT_ACCOUNT_PLATFORMS.article).toEqual(['juejin', 'blbl'])
    expect(CONTENT_ACCOUNT_PLATFORMS['image-note']).toEqual(['xhs'])
    expect(selectedContentAccounts('article', accounts, { juejin: 'juejin-1', blbl: 'blbl-1' }))
      .toEqual(accounts.slice(0, 2))
    expect(selectedContentAccounts('image-note', accounts, { xhs: 'xhs-1' })).toEqual([accounts[2]])
    expect(contentModeAvailable('juejin', 'article', 'publish', [])).toBe(false)
  })

  it('does not select a mismatched account ID and gates each submission mode separately', () => {
    const accounts = [account('xhs-1', 'xhs'), account('blbl-1', 'blbl')]
    expect(selectedContentAccounts('image-note', accounts, { xhs: 'blbl-1' })).toEqual([])
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'xhs', contentTypes: ['video', 'image-note'],
      modes: { video: ['publish', 'draft'], 'image-note': ['draft'] }, requiredFields: {},
    }]
    expect(contentModeAvailable('xhs', 'image-note', 'draft', capabilities)).toBe(true)
    expect(contentModeAvailable('xhs', 'image-note', 'publish', capabilities)).toBe(false)
    expect(contentModeAvailable('blbl', 'article', 'draft', capabilities)).toBe(false)
  })
})
