import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { API, type PublisherContent } from '../src/protocol.ts'
import { ArticleMarkdownPreview, wechatBodyImageIds } from '../src/client/wechat-preview-html.tsx'

const imageId = '33333333-3333-4333-8333-333333333333'
const missingId = '44444444-4444-4444-8444-444444444444'
const content = {
  id: '22222222-2222-4222-8222-222222222222',
  assets: [{ id: imageId, name: '正文.png', mime: 'image/png', bytes: 12 }],
} as PublisherContent
const localUrl = (id: string) => `${API}/content-asset/${content.id}/${id}`

type ViewedNode = { type: string; props?: Record<string, unknown>; text?: string }
function nodes(value: ReactNode): ViewedNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (isValidElement(value)) {
    const props = value.props as { children?: ReactNode }
    return [{ type: typeof value.type === 'string' ? value.type : value.type.name, props: value.props as Record<string, unknown> },
      ...nodes(props.children)]
  }
  return typeof value === 'string' ? [{ type: '#text', text: value }] : []
}
function preview(body: string, assetUrl = localUrl): ViewedNode[] {
  return nodes(ArticleMarkdownPreview({ body, content, assetUrl }))
}

describe('WeChat article preview Markdown', () => {
  it('keeps the Worker-style blocks and passes raw HTML to React as text', () => {
    const tree = preview('# 标题\n\n> 引用\n\n- 一项\n\n| A | B |\n| - | - |\n| x | y |\n\n<script>alert(1)</script>')
    expect(tree.map(node => node.type)).toEqual(expect.arrayContaining(['h1', 'blockquote', 'ul', 'table']))
    expect(tree.some(node => node.type === '#text' && node.text?.includes('<script>alert(1)</script>'))).toBe(true)
    expect(tree.some(node => node.type === 'script')).toBe(false)
  })

  it('uses only the current draft local route for a managed image', () => {
    const image = preview(`![说明](ebao-asset://${imageId})`).find(node => node.type === 'ManagedPreviewImage')
    expect(image?.props).toMatchObject({ src: localUrl(imageId), alt: '说明' })
  })

  it('shows a non-image warning for missing, remote, or unsafe image URLs', () => {
    const body = `![缺失](ebao-asset://${missingId})\n\n![远程](https://example.com/x.png)\n\n![已有](ebao-asset://${imageId})`
    const tree = preview(body, () => 'https://example.com/redirect.png')
    expect(tree.filter(node => node.props?.className === 'pub-wechat-preview-image-error')).toHaveLength(3)
    expect(tree.some(node => node.type === 'ManagedPreviewImage' || node.type === 'img')).toBe(false)
  })

  it('counts only managed images embedded as Markdown images', () => {
    const body = `普通文字 ebao-asset://${missingId}\n\n![已插入](ebao-asset://${imageId})\n\n![网络](https://example.com/x.png)`
    expect([...wechatBodyImageIds(body)]).toEqual([imageId])
  })
})
