import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, linkify: false })

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
