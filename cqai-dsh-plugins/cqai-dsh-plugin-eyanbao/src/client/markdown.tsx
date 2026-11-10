import { Fragment, type ReactNode } from 'react'

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/iu

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/gu
  let cursor = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`strong-${index++}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`em-${index++}`}>{token.slice(1, -1)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token)
      if (link !== null && SAFE_LINK.test(link[2])) {
        nodes.push(<a key={`link-${index++}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>)
      } else {
        nodes.push(link?.[1] ?? token)
      }
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function MarkdownDocument({ markdown, empty }: { markdown: string; empty?: string }) {
  if (markdown.trim() === '') return <div className="ey-doc-empty">{empty ?? '暂无正文。'}</div>
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let code: string[] = []
  let inCode = false
  let key = 0
  let headingIndex = 0

  const flush = () => {
    const text = paragraph.join(' ').trim()
    paragraph = []
    if (text !== '') blocks.push(<p key={`p-${key++}`}>{inline(text)}</p>)
  }
  const flushCode = () => {
    blocks.push(<pre key={`code-${key++}`}><code>{code.join('\n')}</code></pre>)
    code = []
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flush()
      if (inCode) flushCode()
      inCode = !inCode
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading !== null) {
      flush()
      const depth = Math.min(6, heading[1].length)
      const content = inline(heading[2])
      const id = `ey-heading-${headingIndex++}`
      if (depth === 1) blocks.push(<h1 id={id} key={`h-${key++}`}>{content}</h1>)
      else if (depth === 2) blocks.push(<h2 id={id} key={`h-${key++}`}>{content}</h2>)
      else if (depth === 3) blocks.push(<h3 id={id} key={`h-${key++}`}>{content}</h3>)
      else blocks.push(<h4 id={id} key={`h-${key++}`}>{content}</h4>)
      continue
    }
    const quote = /^>\s?(.*)$/u.exec(line)
    if (quote !== null) {
      flush()
      blocks.push(<blockquote key={`quote-${key++}`}>{inline(quote[1])}</blockquote>)
      continue
    }
    const bullet = /^[-*+]\s+(.+)$/u.exec(line)
    if (bullet !== null) {
      flush()
      blocks.push(<div className="ey-bullet" key={`bullet-${key++}`}><span aria-hidden="true">•</span><span>{inline(bullet[1])}</span></div>)
      continue
    }
    const numbered = /^(\d+)[.)]\s+(.+)$/u.exec(line)
    if (numbered !== null) {
      flush()
      blocks.push(<div className="ey-numbered" key={`number-${key++}`}><span>{numbered[1]}.</span><span>{inline(numbered[2])}</span></div>)
      continue
    }
    if (/^\s*---+\s*$/u.test(line)) {
      flush()
      blocks.push(<hr key={`rule-${key++}`} />)
      continue
    }
    if (line.trim() === '') flush()
    else paragraph.push(line.trim())
  }
  flush()
  if (inCode) flushCode()
  return <Fragment>{blocks}</Fragment>
}
