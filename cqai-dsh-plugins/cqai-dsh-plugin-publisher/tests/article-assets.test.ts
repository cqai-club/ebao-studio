import { describe, expect, it } from 'vitest'
import { articleAssetIds, articleImageSources, hasRawArticleImage } from '../src/article-assets.ts'
import { articleSubmissionWarnings, contentSubmissionError } from '../src/submission-validation.ts'
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
    expect(contentSubmissionError({ ...content, tags: ['AI'] }, [tt], [capability], 'draft')).toBeUndefined()
    expect(contentSubmissionError({ ...content, coverAssetId: undefined }, [tt], [capability], 'draft')).toBeUndefined()
    expect(articleSubmissionWarnings({ ...content, coverAssetId: undefined }, [tt], [capability])).toContain('头条：将自动选取首张图片作为封面')
    const emptyPlatformImages = { ...content, platformVariants: { tt: { assetOrder: [] } } }
    expect(contentSubmissionError(emptyPlatformImages, [tt], [capability], 'draft')).toBeUndefined()
    expect(articleSubmissionWarnings(emptyPlatformImages, [tt], [capability])).toContain('头条：封面不在该平台所选图片中，提交时将忽略')
    expect(contentSubmissionError(content, [tt], [capability], 'publish')).toContain('暂不支持')
  })

  it('warns about images removed from target copies while retaining strict source parsing', () => {
    for (const body of ['![本地](../a.png)', '![网络](https://example.com/a.png)',
      '![未知](ebao-asset://44444444-4444-4444-8444-444444444444)', '<img src="file:///tmp/a.png">']) {
      expect(contentSubmissionError({ ...content, body }, [tt], [capability], 'draft')).toBeUndefined()
      expect(articleSubmissionWarnings({ ...content, body }, [tt], [capability])).toContain('头条：不符合该平台要求的正文图片将从平台版本移除')
    }
    expect(contentSubmissionError(content, [blbl], [{ ...capability, platform: 'blbl' }], 'draft')).toBeUndefined()
    expect(articleSubmissionWarnings(content, [blbl], [{ ...capability, platform: 'blbl' }])).toContain('哔哩哔哩：正文插图将从该平台版本移除')
    expect(articleImageSources('```md\n![示例](https://example.com/a.png)\n```\n正文')).toEqual([])
    expect(hasRawArticleImage('```html\n<img src="example.png">\n```\n`<img src="inline.png">`')).toBe(false)
    expect(hasRawArticleImage(`![<img src="alt.png">](ebao-asset://${imageId})`)).toBe(false)
    expect(articleSubmissionWarnings({ ...content, body: `正文 ![<img src="alt.png">](ebao-asset://${imageId})` },
      [tt], [capability])).toEqual([])
  })
})
