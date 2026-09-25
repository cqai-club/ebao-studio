import { createElement, type ReactNode } from 'react'
import MarkdownIt from 'markdown-it'
import { articlePreviewCss } from './article-preview-style.ts'

export interface SourceDocumentSnapshot {
  id: string
  sessionId: string
  revision: string
  fileName: string
  title: string
  body: string
  images: ReadonlyArray<{ id: string; src: string; name: string; mime: string; bytes: number }>
}

type MarkdownToken = ReturnType<typeof markdown.parse>[number]
type Frame = { tag: string | null; props: Record<string, unknown>; children: ReactNode[] }

const markdown = new MarkdownIt({ html: false, linkify: false })
const allowedTags = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
  'em', 'strong', 's', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
])

const sourcePreviewCss = `
.pub-source-preview { box-sizing: border-box; width: 100%; max-width: 720px; margin: 0 auto; padding: 24px; border: 1px solid var(--dsw-alias-border-l2, #e4e6e9); border-radius: 12px; overflow-wrap: anywhere; }
.pub-source-preview * { box-sizing: border-box; }
.pub-source-preview > h1 { margin: 0 0 6px; font-size: 23px; line-height: 1.4; }
.pub-source-preview-file { margin: 0 0 22px; color: var(--dsw-alias-label-tertiary, #777d85); font-size: 12px; }
.pub-source-preview-unused, .pub-source-preview-gallery { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--article-rule); }
.pub-source-preview-unused h2, .pub-source-preview-gallery h2 { margin: 0 0 12px; font-size: 14px; }
.pub-source-preview-unused figure, .pub-source-preview-gallery figure { margin: 0 0 16px; }
.pub-source-preview-unused img, .pub-source-preview-gallery img { display: block; max-width: 100%; max-height: 420px; object-fit: contain; }
.pub-source-preview-unused figcaption, .pub-source-preview-gallery figcaption { margin-top: 4px; color: var(--dsw-alias-label-tertiary, #777d85); font-size: 12px; }
`

function sameOriginPath(url: string): boolean {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !/[\\\u0000-\u001f\u007f]/u.test(url)
}

function safeImageUrl(imageUrl: (sourceId: string, imageId: string) => string, sourceId: string, imageId: string): string | undefined {
  try {
    const url = imageUrl(sourceId, imageId)
    return sameOriginPath(url) ? url : undefined
  } catch { return undefined }
}

function safeLinkProps(token: MarkdownToken): Record<string, unknown> {
  const href = token.attrGet('href') ?? ''
  return /^(?:https?:\/\/|mailto:)/iu.test(href)
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
    : {}
}

/** Resolve only images registered in this document; never render raw Markdown URLs. */
function imageForReference(source: SourceDocumentSnapshot, reference: string): SourceDocumentSnapshot['images'][number] | undefined {
  return source.images.find(image => image.src === reference && reference === `source-image://${image.id}`)
}

function renderMarkdown(source: SourceDocumentSnapshot, imageUrl: (sourceId: string, imageId: string) => string, imagePresentation: 'inline' | 'gallery') {
  const root: Frame = { tag: null, props: {}, children: [] }
  const frames = [root]
  const usedImageIds = new Set<string>()
  const orderedImages: Array<{ image: SourceDocumentSnapshot['images'][number]; url: string }> = []
  let key = 0
  const append = (node: ReactNode): void => { frames[frames.length - 1].children.push(node) }
  const renderTokens = (tokens: MarkdownToken[]): void => {
    for (const token of tokens) {
      if (token.hidden) continue
      if (token.type === 'inline') {
        renderTokens(token.children ?? [])
        continue
      }
      if (token.type === 'image') {
        const image = imageForReference(source, token.attrGet('src') ?? '')
        const url = image ? safeImageUrl(imageUrl, source.id, image.id) : undefined
        if (image && url) {
          if (!usedImageIds.has(image.id)) orderedImages.push({ image, url })
          usedImageIds.add(image.id)
          if (imagePresentation === 'inline') append(<img key={key++} src={url} alt={token.content || image.name} loading="lazy"/>)
        } else {
          append(<span key={key++} className="pub-wechat-preview-image-error">图片引用无法预览</span>)
        }
        continue
      }
      if (token.type === 'text' || token.type === 'html_inline' || token.type === 'html_block') {
        append(token.content)
        continue
      }
      if (token.type === 'code_inline') {
        append(<code key={key++}>{token.content}</code>)
        continue
      }
      if (token.type === 'fence' || token.type === 'code_block') {
        append(<pre key={key++}><code>{token.content}</code></pre>)
        continue
      }
      if (token.type === 'hr') {
        append(<hr key={key++}/>)
        continue
      }
      if (token.type === 'hardbreak') {
        append(<br key={key++}/>)
        continue
      }
      if (token.type === 'softbreak') {
        append('\n')
        continue
      }
      if (token.nesting === 1) {
        frames.push({
          tag: allowedTags.has(token.tag) ? token.tag : 'span',
          props: token.type === 'link_open' ? safeLinkProps(token)
            : token.type === 'ordered_list_open' && token.attrGet('start')
              ? { start: Number(token.attrGet('start')) } : {},
          children: [],
        })
        continue
      }
      if (token.nesting === -1) {
        if (frames.length > 1) {
          const frame = frames.pop()!
          append(createElement(frame.tag!, { key: key++, ...frame.props }, ...frame.children))
        }
        continue
      }
      if (token.content) append(token.content)
    }
  }
  renderTokens(markdown.parse(source.body, {}))
  return { nodes: root.children, usedImageIds, orderedImages }
}

/** Preview the source Markdown before any platform-specific publishing draft exists. */
export function SourceDocumentPreview({ source, imageUrl, showUnusedImages = true, imagePresentation = 'inline' }: {
  source: SourceDocumentSnapshot
  imageUrl: (sourceId: string, imageId: string) => string
  showUnusedImages?: boolean
  imagePresentation?: 'inline' | 'gallery'
}) {
  const { nodes, usedImageIds, orderedImages } = renderMarkdown(source, imageUrl, imagePresentation)
  const unusedImages = !showUnusedImages ? [] : source.images.flatMap(image => {
    if (usedImageIds.has(image.id)) return []
    const url = safeImageUrl(imageUrl, source.id, image.id)
    return url ? [{ image, url }] : []
  })
  return <section className="pub-source-preview ebao-article-reader" aria-label="原始文档预览">
    <style>{articlePreviewCss}{sourcePreviewCss}</style>
    <h1>{source.title || source.fileName}</h1>
    <p className="pub-source-preview-file">{source.fileName}</p>
    <div className="pub-wechat-markdown" aria-label="Markdown 正文预览">{nodes}</div>
    {imagePresentation === 'gallery' && orderedImages.length > 0 && <section className="pub-source-preview-gallery" aria-label="图文图集">
      <h2>图文图集</h2>
      {orderedImages.map(({ image, url }) => <figure key={image.id}>
        <img src={url} alt={image.name} loading="lazy"/><figcaption>{image.name}</figcaption>
      </figure>)}
    </section>}
    {unusedImages.length > 0 && <section className="pub-source-preview-unused" aria-label="未在正文引用的图片">
      <h2>未在正文引用的图片</h2>
      {unusedImages.map(({ image, url }) => <figure key={image.id}>
        <img src={url} alt={image.name} loading="lazy"/><figcaption>{image.name}</figcaption>
      </figure>)}
    </section>}
  </section>
}
