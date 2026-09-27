import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SourceDocumentPreview, type SourceDocumentSnapshot } from '../src/client/source-document-preview.tsx'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const source: SourceDocumentSnapshot = {
  id: 'source-1', sessionId: 'session-1', revision: 'sha256-revision', fileName: '山行.md', title: '山行',
  body: `第一段 **重点**。\n\n![山路](source-image://${firstId})\n\n[参考资料](https://example.com)`,
  images: [
    { id: firstId, src: `source-image://${firstId}`, name: '山路.jpg', mime: 'image/jpeg', bytes: 12 },
    { id: secondId, src: `source-image://${secondId}`, name: '封面.png', mime: 'image/png', bytes: 20 },
  ],
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...elements(element.props.children as ReactNode)]
}

describe('source document preview', () => {
  it('renders Markdown and registered image references without a Publisher draft', () => {
    const imageUrl = vi.fn((sourceId: string, imageId: string) => `/api/cqai-publisher/source-image/${sourceId}/${imageId}`)
    const tree = elements(SourceDocumentPreview({ source, imageUrl }))
    expect(tree[0]?.props['aria-label']).toBe('原始文档预览')
    expect(tree.some(node => node.type === 'strong')).toBe(true)
    const images = tree.filter(node => node.type === 'img')
    expect(images.map(node => node.props.src)).toEqual([
      `/api/cqai-publisher/source-image/source-1/${firstId}`,
      `/api/cqai-publisher/source-image/source-1/${secondId}`,
    ])
    expect(images.map(node => node.props.alt)).toEqual(['山路', '封面.png'])
    expect(imageUrl).toHaveBeenCalledWith(source.id, firstId)
    expect(imageUrl).toHaveBeenCalledWith(source.id, secondId)
    expect(tree.some(node => node.props['aria-label'] === '未在正文引用的图片')).toBe(true)
    const link = tree.find(node => node.type === 'a')
    expect(link?.props).toMatchObject({ href: 'https://example.com', rel: 'noopener noreferrer' })
  })

  it('never uses raw Markdown image URLs or unsafe URLs returned by the caller', () => {
    const unsafe = {
      ...source,
      body: `![外部](https://evil.example/photo.jpg)\n\n![本地](source-image://${firstId})\n\n<script>alert(1)</script>`,
      images: source.images.slice(0, 1),
    }
    const tree = elements(SourceDocumentPreview({ source: unsafe, imageUrl: () => '//evil.example/photo.jpg' }))
    expect(tree.filter(node => node.type === 'img')).toHaveLength(0)
    expect(tree.filter(node => node.type === 'script')).toHaveLength(0)
    expect(tree.filter(node => node.props.className === 'pub-wechat-preview-image-error')).toHaveLength(2)
  })

  it('can preview a platform candidate by replacing title and body on the source snapshot', () => {
    const candidate = { ...source, title: '候选标题', body: `候选正文\n\n![封面](source-image://${secondId})` }
    const tree = elements(SourceDocumentPreview({ source: candidate, imageUrl: (_sourceId, imageId) => `/source/${imageId}`, showUnusedImages: false }))
    expect(tree.find(node => node.type === 'h1')?.props.children).toBe('候选标题')
    expect(tree.filter(node => node.type === 'img').map(node => node.props.alt)).toEqual(['封面'])
    expect(tree.some(node => node.props['aria-label'] === '未在正文引用的图片')).toBe(false)
  })

  it('shows image-note candidate images as an ordered gallery outside the description', () => {
    const candidate = { ...source, body: `正文\n\n![封面](source-image://${secondId})\n\n![山路](source-image://${firstId})` }
    const tree = elements(SourceDocumentPreview({ source: candidate, imageUrl: (_sourceId, imageId) => `/source/${imageId}`,
      showUnusedImages: false, imagePresentation: 'gallery' }))
    const body = tree.find(node => node.props['aria-label'] === 'Markdown 正文预览')
    expect(elements(body?.props.children as ReactNode).some(node => node.type === 'img')).toBe(false)
    expect(tree.filter(node => node.type === 'img').map(node => node.props.alt)).toEqual(['封面.png', '山路.jpg'])
    expect(tree.some(node => node.props['aria-label'] === '图文图集')).toBe(true)
  })
})
