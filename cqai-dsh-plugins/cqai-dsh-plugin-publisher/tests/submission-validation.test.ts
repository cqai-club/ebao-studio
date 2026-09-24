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
  it('requires a WeChat cover and accepts only supported article assets', () => {
    const draft = content('article')
    const targets = [account('wxmp')]
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'wxmp', contentTypes: ['article'], modes: { article: ['draft', 'publish'] },
      requiredFields: {}, maxTitleLength: { article: 64 }, maxAssets: { article: 20 },
    }]
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toContain('必须选择封面')
    draft.assets = [{ id: '33333333-3333-4333-8333-333333333333', name: '封面.png', mime: 'image/png', bytes: 12 }]
    draft.coverAssetId = draft.assets[0]!.id
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBeUndefined()
    expect(contentSubmissionError({ ...draft, tags: ['标签'] }, targets, capabilities, 'draft')).toBeUndefined()
    expect(contentSubmissionError({ ...draft, summary: '摘要'.repeat(61) }, targets, capabilities, 'draft')).toContain('120 字')
    expect(contentSubmissionError({ ...draft, assets: [{ ...draft.assets[0]!, mime: 'image/webp' }] }, targets, capabilities, 'draft')).toContain('重新上传')
  })

  it('requires the corresponding Worker theme version for WeChat output', () => {
    const draft = content('article')
    draft.assets = [{ id: '33333333-3333-4333-8333-333333333333', name: '封面.png', mime: 'image/png', bytes: 12 }]
    draft.coverAssetId = draft.assets[0]!.id
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'wxmp', contentTypes: ['article'], modes: { article: ['draft'] }, requiredFields: {},
    }]
    expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toBeUndefined()
    draft.articleTheme = 'editorial'
    expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toContain('更新 Worker')
    capabilities[0]!.articleThemeVersion = 1
    expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toBeUndefined()
    for (const theme of ['orangeheart', 'lapis', 'purple'] as const) {
      draft.articleTheme = theme
      expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toContain('更新 Worker')
      capabilities[0]!.articleThemeVersion = 2
      expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toBeUndefined()
      capabilities[0]!.articleThemeVersion = 1
    }
    capabilities[0]!.articleThemeVersion = 2
    draft.articleTheme = 'editorial'
    expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toBeUndefined()
  })

  it('rejects Toutiao article summary before acceptance without blocking other article platforms', () => {
    const draft = { ...content('article'), summary: '摘要内容' }
    const capabilities: PublisherPlatformCapability[] = [{
      platform: 'tt', contentTypes: ['article'], modes: { article: ['draft', 'publish'] }, requiredFields: {},
    }, {
      platform: 'juejin', contentTypes: ['article'], modes: { article: ['draft', 'publish'] }, requiredFields: {},
    }]
    expect(contentSubmissionError(draft, [account('tt')], capabilities, 'draft')).toContain('请清空摘要')
    expect(contentSubmissionError(draft, [account('juejin')], capabilities, 'draft')).toBeUndefined()
    expect(contentSubmissionError({ ...draft, summary: '' }, [account('tt')], capabilities, 'draft')).toBeUndefined()
  })

  it('keeps draft tags while allowing article targets that skip tag upload', () => {
    const tagged = { ...content('article'), tags: ['AI'] }
    tagged.assets = [{ id: '33333333-3333-4333-8333-333333333333', name: '封面.png', mime: 'image/png', bytes: 12 }]
    tagged.coverAssetId = tagged.assets[0]!.id
    const targets = [account('wxmp'), account('tt'), account('bjh'), account('juejin')]
    const capabilities: PublisherPlatformCapability[] = targets.map(target => ({
      platform: target.platform, contentTypes: ['article'], modes: { article: ['draft'] }, requiredFields: {},
    }))
    expect(contentSubmissionError(tagged, targets, capabilities, 'draft')).toBeUndefined()
    expect(tagged.tags).toEqual(['AI'])
  })

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
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toContain('只支持单张封面')
    draft.platformVariants = { juejin: { assetOrder: [draft.assets[0]!.id] } }
    expect(contentSubmissionError(draft, targets, capabilities, 'draft')).toBeUndefined()
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

  it('validates the exact platform version that will be submitted', () => {
    const draft = content('article')
    draft.title = '主标题'.repeat(20)
    draft.summary = '主摘要'
    draft.body = '主稿 ![未上传](ebao-asset://33333333-3333-4333-8333-333333333333)'
    draft.assets = [{ id: '44444444-4444-4444-8444-444444444444', name: '封面.png', mime: 'image/png', bytes: 12 }]
    draft.coverAssetId = draft.assets[0]!.id
    draft.platformVariants = {
      wxmp: { title: '微信标题', body: '微信正文', summary: '' },
      tt: { title: '头条标题', body: '头条正文', summary: '', coverAssetId: null, assetOrder: [] },
      juejin: { title: '掘金标题', body: '掘金正文', coverAssetId: null, assetOrder: [] },
    }
    const capabilities: PublisherPlatformCapability[] = ['wxmp', 'tt', 'juejin'].map(platform => ({
      platform: platform as PublisherAccount['platform'], contentTypes: ['article'],
      modes: { article: ['draft'] }, requiredFields: {}, maxTitleLength: { article: 64 },
    }))
    expect(contentSubmissionError(draft, [account('wxmp'), account('tt'), account('juejin')], capabilities, 'draft')).toBeUndefined()
    draft.platformVariants.juejin!.coverAssetId = draft.coverAssetId
    expect(contentSubmissionError(draft, [account('juejin')], capabilities, 'draft')).toContain('封面不在该平台已选图片中')
    draft.platformVariants.juejin!.coverAssetId = null
    draft.platformVariants.tt!.body = `头条正文 ![被排除的图](ebao-asset://${draft.assets[0]!.id})`
    expect(contentSubmissionError(draft, [account('tt')], capabilities, 'draft')).toContain('正文图片需先上传')
    draft.platformVariants.tt!.body = '头条正文'
    draft.platformVariants.wxmp!.body = '微信正文 ![缺图](ebao-asset://33333333-3333-4333-8333-333333333333)'
    expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toContain('正文图片需先上传')
    draft.platformVariants.wxmp!.body = '微信正文'
    draft.platformVariants.wxmp!.title = ''
    expect(contentSubmissionError(draft, [account('wxmp')], capabilities, 'draft')).toBe('请填写标题')
  })
})
