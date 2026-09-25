import MarkdownIt from 'markdown-it'
import type { PublisherContent } from './protocol.ts'

const markdown = new MarkdownIt({ html: false, linkify: false })
const MANAGED_IMAGE = /^ebao-asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu

/** Read actual Markdown image nodes so code examples do not count as article pictures. */
export function articleImageSources(body: string): string[] {
  const sources: string[] = []
  const visit = (tokens: ReturnType<typeof markdown.parse>): void => {
    for (const token of tokens) {
      if (token.type === 'image') sources.push(token.attrGet('src') ?? '')
      if (token.children) visit(token.children)
    }
  }
  visit(markdown.parse(body, {}))
  return sources
}

export function hasRawArticleImage(body: string): boolean {
  const visit = (tokens: ReturnType<typeof markdown.parse>): boolean => tokens.some(token =>
    token.type !== 'image' && (
      ((token.type === 'text' || token.type === 'html_inline' || token.type === 'html_block') && /<img\b/iu.test(token.content))
      || !!token.children && visit(token.children)))
  return visit(markdown.parse(body, {}))
}

/** Validate Markdown image sources without accepting browser-supplied file paths or remote images. */
export function articleAssetIds(content: PublisherContent): string[] {
  if (content.contentType !== 'article') return []
  const known = new Set(content.assets.map(asset => asset.id))
  const used = new Set<string>()
  for (const source of articleImageSources(content.body)) {
    const id = MANAGED_IMAGE.exec(source)?.[1]
    if (!id || !known.has(id)) throw new Error('正文图片需先上传素材，再使用“插入正文”；不能引用本地路径或网络图片')
    used.add(id)
  }
  if (hasRawArticleImage(content.body)) throw new Error('正文图片请使用素材列表中的“插入正文”')
  return [...used]
}
