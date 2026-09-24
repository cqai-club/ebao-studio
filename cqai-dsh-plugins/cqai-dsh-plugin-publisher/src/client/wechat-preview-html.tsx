import { createElement, useEffect, useState, type ReactNode } from 'react'
import MarkdownIt from 'markdown-it'
import { API, type PublisherContent } from '../protocol.ts'

const markdown = new MarkdownIt({ html: false, linkify: false })
const managedImage = /^ebao-asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu
const imageWarning = '【图片无法预览：请使用当前草稿中已上传的图片】'
const allowedTags = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
  'em', 'strong', 's', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
])
type MarkdownToken = ReturnType<typeof markdown.parse>[number]
type Frame = { tag: string | null; props: Record<string, unknown>; children: ReactNode[] }

function visitImages(tokens: MarkdownToken[], visit: (token: MarkdownToken) => void): void {
  for (const token of tokens) {
    if (token.type === 'image') visit(token)
    if (token.children) visitImages(token.children, visit)
  }
}

/** Count images actually embedded in Markdown, rather than plain-text asset references. */
export function wechatBodyImageIds(body: string): Set<string> {
  const ids = new Set<string>()
  visitImages(markdown.parse(body, {}), token => {
    const id = managedImage.exec(token.attrGet('src') ?? '')?.[1]
    if (id) ids.add(id)
  })
  return ids
}

function localImageUrl(token: MarkdownToken, content: PublisherContent, assetUrl: (id: string) => string): string | undefined {
  const id = managedImage.exec(token.attrGet('src') ?? '')?.[1]
  if (!id || !content.assets.some(asset => asset.id === id)) return
  const expected = `${API}/content-asset/${encodeURIComponent(content.id)}/${encodeURIComponent(id)}`
  try {
    const url = assetUrl(id)
    if (url === expected) return url
  } catch { /* A failed local asset lookup stays visible as a warning. */ }
}

function ManagedPreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return failed
    ? <span className="pub-wechat-preview-image-error">图片加载失败：{alt || '正文图片'}</span>
    : <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)}/>
}

function safeLinkProps(token: MarkdownToken): Record<string, unknown> {
  const href = token.attrGet('href') ?? ''
  return /^(?:https?:\/\/|mailto:)/iu.test(href)
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
    : {}
}

/** Render the Worker's Markdown token structure as React nodes, never injected HTML. */
function renderTokens(tokens: MarkdownToken[], content: PublisherContent, assetUrl: (id: string) => string): ReactNode[] {
  const root: Frame = { tag: null, props: {}, children: [] }
  const frames = [root]
  let key = 0
  const append = (node: ReactNode): void => { frames[frames.length - 1].children.push(node) }

  for (const token of tokens) {
    if (token.hidden) continue
    if (token.type === 'inline') {
      frames[frames.length - 1].children.push(...renderTokens(token.children ?? [], content, assetUrl))
      continue
    }
    if (token.type === 'image') {
      const src = localImageUrl(token, content, assetUrl)
      append(src
        ? <ManagedPreviewImage key={key++} src={src} alt={token.content}/>
        : <span key={key++} className="pub-wechat-preview-image-error">{imageWarning}</span>)
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
      const tag = allowedTags.has(token.tag) ? token.tag : 'span'
      const props = token.type === 'link_open' ? safeLinkProps(token)
        : token.type === 'ordered_list_open' && token.attrGet('start')
          ? { start: Number(token.attrGet('start')) } : {}
      frames.push({ tag, props, children: [] })
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
  return root.children
}

export function WechatMarkdownPreview({ body, content, assetUrl }: {
  body: string
  content: PublisherContent
  assetUrl: (id: string) => string
}) {
  return <div className="pub-preview pub-wechat-markdown" aria-label="公众号 Markdown 正文预览">
    {renderTokens(markdown.parse(body, {}), content, assetUrl)}
  </div>
}
