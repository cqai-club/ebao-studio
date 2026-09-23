import MarkdownIt from 'markdown-it'
import type { PublisherContent } from './protocol.ts'

const markdown = new MarkdownIt({ html: false, linkify: false })
const MANAGED_IMAGE = /^ebao-asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu

/** Validate Markdown image sources without accepting browser-supplied file paths or remote images. */
export function articleAssetIds(content: PublisherContent): string[] {
  if (content.contentType !== 'article') return []
  const known = new Set(content.assets.map(asset => asset.id))
  const used = new Set<string>()
  for (const block of markdown.parse(content.body, {})) {
    for (const token of block.children ?? []) {
      if (token.type !== 'image') continue
      const source = token.attrGet('src') ?? ''
      const id = MANAGED_IMAGE.exec(source)?.[1]
      if (!id || !known.has(id)) throw new Error('正文图片需先上传素材，再使用“插入正文”；不能引用本地路径或网络图片')
      used.add(id)
    }
  }
  if (/<img\b/iu.test(content.body)) throw new Error('正文图片请使用素材列表中的“插入正文”')
  return [...used]
}
