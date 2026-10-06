import { createElement, Fragment, useMemo, type ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Definition, Nodes, Root } from 'mdast'

const MAX_DESCRIPTION_DEPTH = 32
const MAX_DESCRIPTION_NODES = 1_000

function displayText(value: string, code = false): string {
  // Entities are decoded by the Markdown parser, after the transport has been validated.
  // Keep structural newlines and code indentation while visibly neutralizing decoded controls.
  return value.replace(code
    ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu
    : /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '\ufffd')
}

function safeLink(value: string): string | undefined {
  if (value.length > 2048 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function hasBoundedStructure(root: Root): boolean {
  const pending: { node: Nodes; depth: number }[] = [{ node: root, depth: 0 }]
  let visited = 0
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!
    if (++visited > MAX_DESCRIPTION_NODES || depth > MAX_DESCRIPTION_DEPTH) return false
    if ('children' in node) {
      for (const child of node.children) pending.push({ node: child, depth: depth + 1 })
    }
  }
  return true
}

function renderDescription(root: Root): ReactNode {
  const definitions = new Map<string, Definition>()
  function collectDefinitions(node: Nodes): void {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node)
    if ('children' in node) node.children.forEach(collectDefinitions)
  }
  collectDefinitions(root)

  function children(node: { children: Nodes[] }): ReactNode {
    return node.children.map((child, index) => <Fragment key={index}>{renderNode(child)}</Fragment>)
  }

  function link(node: { children: Nodes[] }, url: string | undefined, title?: string | null): ReactNode {
    const href = url === undefined ? undefined : safeLink(url)
    if (href === undefined) return children(node)
    // Native link activation follows the same Desktop external-link path as other Market links.
    return <a href={href} title={title == null ? undefined : displayText(title)} target="_blank" rel="noopener noreferrer">{children(node)}</a>
  }

  function renderNode(node: Nodes): ReactNode {
    switch (node.type) {
      case 'root': return children(node)
      case 'text': return displayText(node.value)
      case 'paragraph': return <p>{children(node)}</p>
      case 'heading': return createElement(`h${node.depth}`, undefined, children(node))
      case 'list': return node.ordered
        ? <ol start={node.start ?? undefined}>{children(node)}</ol>
        : <ul>{children(node)}</ul>
      case 'listItem': return <li>{children(node)}</li>
      case 'emphasis': return <em>{children(node)}</em>
      case 'strong': return <strong>{children(node)}</strong>
      case 'inlineCode': return <code>{displayText(node.value, true)}</code>
      case 'code': return <pre><code>{displayText(node.value, true)}</code></pre>
      case 'break': return <br />
      case 'blockquote': return <blockquote>{children(node)}</blockquote>
      case 'thematicBreak': return <hr />
      case 'link': return link(node, node.url, node.title)
      case 'linkReference': {
        const definition = definitions.get(node.identifier)
        return link(node, definition?.url, definition?.title)
      }
      case 'definition': return null
      // Description images cannot bypass the Host's icon-media boundary.
      case 'image':
      case 'imageReference': return displayText(node.alt ?? '')
      case 'html': return <span className="dshMarketDescriptionLiteral">{displayText(node.value)}</span>
      default: return 'children' in node ? children(node) : 'value' in node ? displayText(node.value) : null
    }
  }

  return children(root)
}

/** Render only inert CommonMark text structure and user-activated, credential-free HTTPS links. */
export function MarketDescription({ text }: { text: string }): ReactNode {
  const content = useMemo(() => {
    const normalized = text.replace(/[\u2028\u2029]/gu, '\n')
    const literal = () => <span className="dshMarketDescriptionLiteral">{displayText(normalized)}</span>
    try {
      const root = fromMarkdown(normalized)
      // Valid transport text can still encode thousands of nested blockquotes.
      // Check iteratively before either our renderer or React sees that tree.
      return hasBoundedStructure(root) ? renderDescription(root) : literal()
    } catch {
      return literal()
    }
  }, [text])
  return <div className="dshMarketDescription">{content}</div>
}
