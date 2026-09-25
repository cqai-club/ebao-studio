import { readFileSync } from 'node:fs'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { PublisherContent } from '../src/protocol.ts'
import { PublisherContentPreview, contentAssetUrl, previewContentModel } from '../src/client/content-preview.tsx'
import { ImageNoteCarousel } from '../src/client/image-note-carousel.tsx'
import { ArticleMarkdownPreview } from '../src/client/wechat-preview-html.tsx'

const coverId = '11111111-1111-4111-8111-111111111111'
const inlineId = '22222222-2222-4222-8222-222222222222'
const unusedId = '33333333-3333-4333-8333-333333333333'
const asset = (id: string) => ({ id, name: `${id}.png`, mime: 'image/png' as const, bytes: 12 })
const article = {
  id: 'draft/one', contentType: 'article', title: '共同标题', body: `![配图](ebao-asset://${inlineId})`,
  summary: '独立摘要', articleTheme: 'editorial', creativeStatement: 'ai_generated',
  tags: ['标签'], assets: [asset(coverId), asset(inlineId), asset(unusedId)], coverAssetId: coverId,
} as PublisherContent

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...elements(element.props.children as ReactNode)]
}

describe('shared Publisher content preview', () => {
  it('uses one renderer and one CSS module in both publisher and conversation mounts', () => {
    const publisher = readFileSync(new URL('../src/client/content.tsx', import.meta.url), 'utf8')
    const conversation = readFileSync(new URL('../src/client/conversation-preview.tsx', import.meta.url), 'utf8')
    const publisherStyles = readFileSync(new URL('../src/client/shared.tsx', import.meta.url), 'utf8')
    expect(publisher).toContain('<PublisherContentPreview content={visibleDraft!}')
    expect(conversation).toContain('<PublisherContentPreview content={content} device={device}/>')
    expect(publisherStyles).toContain('${contentPreviewCss}')
    expect(conversation).toContain('${contentPreviewCss}')
  })

  it('keeps the master title, body, cover, theme, tags and truly unused images together', () => {
    const model = previewContentModel(article)
    expect(model.renderedBody).toBe(article.body)
    expect(model.cover?.id).toBe(coverId)
    expect(model.articleTheme).toBe('editorial')
    expect([...model.embeddedAssets]).toEqual([inlineId])
    expect(model.remainingAssets.map(item => item.id)).toEqual([unusedId])

    const tree = elements(PublisherContentPreview({ content: article }))
    expect(tree[0]?.props).toMatchObject({ 'aria-label': '文章内容预览', 'data-theme': 'editorial' })
    expect(tree.some(node => node.props.className === 'pub-content-preview-cover')).toBe(true)
    expect(tree.some(node => node.props.className === 'pub-content-preview-tags')).toBe(true)
    const markdown = tree.find(node => node.type === ArticleMarkdownPreview)
    expect(markdown?.props.body).toBe(article.body)
    expect((markdown?.props.assetUrl as (id: string) => string)(inlineId)).toBe(contentAssetUrl(article.id, inlineId))
  })

  it('honors platform projections and treats literal asset references as unused', () => {
    const content = { ...article, body: `正文提到 ebao-asset://${inlineId}，没有插入图片。` }
    expect(previewContentModel(content).remainingAssets.map(item => item.id)).toEqual([inlineId, unusedId])
    const bilibili = previewContentModel(content, 'blbl')
    expect(bilibili.renderedBody).toContain('独立摘要\n\n正文提到')
    expect(bilibili.renderedBody).toContain('内容声明：本文包含 AI 生成内容')
    expect(contentAssetUrl('content/1', 'asset?#')).toBe('/api/cqai-publisher/content-asset/content%2F1/asset%3F%23')
  })

  it('renders image-note images in draft order through the same carousel', () => {
    const note = { ...article, contentType: 'image-note' as const, body: '图文正文', assets: [asset(unusedId), asset(coverId)] }
    const tree = elements(PublisherContentPreview({ content: note, device: 'mobile' }))
    expect(tree[0]?.props).toMatchObject({ 'aria-label': '图文内容预览', 'data-device': 'mobile' })
    const carousel = tree.find(node => node.type === ImageNoteCarousel)
    expect((carousel?.props.assets as { id: string }[]).map(item => item.id)).toEqual([unusedId, coverId])
    expect(tree.some(node => node.props.className === 'pub-content-preview-tags')).toBe(true)
  })
})
