import { describe, expect, it } from 'vitest'
import { CONTENT_ACCOUNT_PLATFORMS, contentModeAvailable, selectedContentAccounts } from '../src/content-targets.ts'
import type { PublisherAccount, PublisherPlatformCapability } from '../src/protocol.ts'

const account = (id: string, platform: PublisherAccount['platform']): PublisherAccount => ({
  id, platform, displayName: id, loginState: 'logged-in',
})

describe('article and image-note account choices', () => {
  it('keeps target accounts selectable while Worker capability data loads', () => {
    const accounts = [account('juejin-1', 'juejin'), account('blbl-1', 'blbl'), account('xhs-1', 'xhs'), account('tt-1', 'tt'), account('bjh-1', 'bjh'), account('wxmp-1', 'wxmp'), account('dy-1', 'dy'), account('ks-1', 'ks')]
    expect(CONTENT_ACCOUNT_PLATFORMS.article).toEqual(['juejin', 'blbl', 'tt', 'bjh', 'wxmp'])
    expect(CONTENT_ACCOUNT_PLATFORMS['image-note']).toEqual(['xhs', 'dy', 'ks', 'tt'])
    expect(selectedContentAccounts('article', accounts, { juejin: 'juejin-1', blbl: 'blbl-1' }))
      .toEqual(accounts.slice(0, 2))
    expect(selectedContentAccounts('image-note', accounts, { xhs: 'xhs-1' })).toEqual([accounts[2]])
    expect(selectedContentAccounts('image-note', accounts, { xhs: 'xhs-1', dy: 'dy-1', ks: 'ks-1', tt: 'tt-1' }))
      .toEqual([accounts[2], accounts[6], accounts[7], accounts[3]])
    expect(selectedContentAccounts('article', accounts, { tt: 'tt-1', bjh: 'bjh-1', wxmp: 'wxmp-1' })).toEqual(accounts.slice(3, 6))
    expect(contentModeAvailable('juejin', 'article', 'publish', [])).toBe(false)
  })

  it('does not select a mismatched account ID and gates each submission mode separately', () => {
    const accounts = [account('xhs-1', 'xhs'), account('blbl-1', 'blbl'), account('dy-1', 'dy'), account('ks-1', 'ks'), account('tt-1', 'tt')]
    expect(selectedContentAccounts('image-note', accounts, { xhs: 'blbl-1' })).toEqual([])
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'xhs', contentTypes: ['video', 'image-note'],
      modes: { video: ['publish', 'draft'], 'image-note': ['draft'] }, requiredFields: {},
    }, ...(['dy', 'ks', 'tt'] as const).map(platform => ({
      platform, contentTypes: ['video'] as PublisherPlatformCapability['contentTypes'],
      modes: { video: ['publish', 'draft'] as PublisherPlatformCapability['modes']['video'] }, requiredFields: {},
    }))]
    expect(contentModeAvailable('xhs', 'image-note', 'draft', capabilities)).toBe(true)
    expect(contentModeAvailable('xhs', 'image-note', 'publish', capabilities)).toBe(false)
    for (const platform of ['dy', 'ks', 'tt'] as const) {
      expect(contentModeAvailable(platform, 'image-note', 'draft', capabilities)).toBe(false)
      expect(contentModeAvailable(platform, 'image-note', 'publish', capabilities)).toBe(false)
    }
    expect(contentModeAvailable('blbl', 'article', 'draft', capabilities)).toBe(false)
  })
})
