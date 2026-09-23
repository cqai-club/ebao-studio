import { describe, expect, it } from 'vitest'
import { articleAssetIds } from '../src/article-assets.ts'
import { contentSubmissionError } from '../src/submission-validation.ts'
import type { PublisherAccount, PublisherContent, PublisherPlatformCapability } from '../src/protocol.ts'

const imageId = '33333333-3333-4333-8333-333333333333'
const content: PublisherContent = {
  id: '22222222-2222-4222-8222-222222222222', contentType: 'article', revision: 1,
  createdAt: '', updatedAt: '', title: '正文插图', body: `正文\n\n![说明](ebao-asset://${imageId})`,
  summary: '', tags: [], creativeStatement: 'none',
  assets: [{ id: imageId, name: '正文.png', mime: 'image/png', bytes: 12 }], coverAssetId: imageId,
  platformFields: {},
}
const tt: PublisherAccount = { id: '11111111-1111-4111-8111-111111111111', platform: 'tt', displayName: '头条号', loginState: 'logged-in' }
const blbl: PublisherAccount = { ...tt, platform: 'blbl' }
const capability: PublisherPlatformCapability = {
  platform: 'tt', contentTypes: ['video', 'article'], modes: { video: ['draft', 'publish'], article: ['draft'] },
  requiredFields: { article: [] }, maxAssets: { article: 20 },
}

describe('article managed image preflight', () => {
  it('accepts only assets owned by this draft and keeps the cover independent', () => {
    expect(articleAssetIds(content)).toEqual([imageId])
    expect(contentSubmissionError(content, [tt], [capability], 'draft')).toBeUndefined()
    expect(contentSubmissionError({ ...content, tags: ['AI'] }, [tt], [capability], 'draft')).toContain('清空标签')
    expect(contentSubmissionError({ ...content, coverAssetId: undefined }, [tt], [capability], 'draft')).toContain('封面')
    expect(contentSubmissionError(content, [tt], [capability], 'publish')).toContain('暂不支持')
  })

  it('rejects local, remote, missing and raw HTML image references', () => {
    for (const body of ['![本地](../a.png)', '![网络](https://example.com/a.png)',
      '![未知](ebao-asset://44444444-4444-4444-8444-444444444444)', '<img src="file:///tmp/a.png">']) {
      expect(contentSubmissionError({ ...content, body }, [tt], [capability], 'draft')).toMatch(/图片/u)
    }
    expect(contentSubmissionError(content, [blbl], [{ ...capability, platform: 'blbl' }], 'draft')).toContain('暂不支持正文插图')
  })
})
