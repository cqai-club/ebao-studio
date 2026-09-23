import { describe, expect, it } from 'vitest'
import { contentSubmissionError } from '../src/submission-validation.ts'
import type { PublisherAccount, PublisherContent, PublisherPlatformCapability } from '../src/protocol.ts'

const account = (platform: PublisherAccount['platform']): PublisherAccount => ({
  id: '11111111-1111-4111-8111-111111111111', displayName: '测试账号', platform, loginState: 'logged-in',
})
const content = (contentType: PublisherContent['contentType']): PublisherContent => ({
  id: '22222222-2222-4222-8222-222222222222', contentType, revision: 1,
  createdAt: '', updatedAt: '', title: '标题', body: '正文', summary: '', tags: [],
  creativeStatement: 'none', assets: [], platformFields: {},
})

describe('article and image-note preflight', () => {
  it('requires article text, the selected platform fields, and a single designated cover', () => {
    const draft = content('article')
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'juejin', contentTypes: ['article'], modes: { article: ['draft', 'publish'] },
      requiredFields: { article: ['category'] }, maxAssets: { article: 1 },
    }]
    const targets = [account('juejin')]
    expect(contentSubmissionError({ ...draft, body: '' }, targets, capabilities, 'draft')).toBe('请填写正文')
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toContain('分类')
    draft.platformFields = { juejin: { category: '前端' } }
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBeUndefined()
    draft.assets = [{ id: '33333333-3333-4333-8333-333333333333', name: '封面.png', mime: 'image/png', bytes: 12 }]
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBe('请为文章选择封面图片')
    draft.coverAssetId = draft.assets[0]!.id
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBeUndefined()
    draft.assets.push({ id: '44444444-4444-4444-8444-444444444444', name: '正文.png', mime: 'image/png', bytes: 12 })
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toContain('最多支持 1 张')
  })

  it('enforces image-note image, title, mode and supported declaration before Worker acceptance', () => {
    const draft = content('image-note')
    const targets = [account('xhs')]
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'xhs', contentTypes: ['image-note'], modes: { 'image-note': ['draft'] },
      requiredFields: {}, maxTitleLength: { 'image-note': 20 }, maxAssets: { 'image-note': 20 },
    }]
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBe('图文至少添加一张图片')
    draft.assets = [{ id: '33333333-3333-4333-8333-333333333333', name: '图片.png', mime: 'image/png', bytes: 12 }]
    expect(contentSubmissionError({ ...draft, title: '太长的标题'.repeat(5) }, targets, capabilities, 'draft')).toContain('不能超过 20 字')
    expect(contentSubmissionError(draft, targets, capabilities, 'publish')).toContain('暂不支持')
    expect(contentSubmissionError({ ...draft, creativeStatement: 'repost' }, targets, capabilities, 'draft')).toContain('内容声明')
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBeUndefined()
  })
})
