import { describe, expect, it, vi } from 'vitest'
import type { PublisherContentCard } from '../src/protocol.ts'
import { appendUniqueCards, distributeGalleryCards, galleryColumnCount, galleryCoverUrl, videoGalleryPreviewUrl } from '../src/client/draft-gallery.tsx'

vi.mock('../src/client/shared.tsx', () => ({
  CONTENT_LABELS: { article: '文章', 'image-note': '图文', video: '视频' },
  api: vi.fn(),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '操作失败',
}))

const card = (id: string, contentType: PublisherContentCard['contentType'] = 'article'): PublisherContentCard => ({
  id, contentType, revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', title: id, excerpt: '',
})

describe('draft gallery card data', () => {
  it('keeps the first page order and ignores cards repeated across later pages', () => {
    const first = [card('first'), card('second')]
    const later = [card('second'), card('third'), card('third'), card('fourth')]
    expect(appendUniqueCards(first, later).map(item => item.id)).toEqual(['first', 'second', 'third', 'fourth'])
    expect(first.map(item => item.id)).toEqual(['first', 'second'])
  })

  it('appends cards without moving earlier cards between masonry columns', () => {
    const first = ['a', 'b', 'c', 'd', 'e'].map(id => card(id, 'image-note'))
    const later = [...first, card('f', 'image-note'), card('g', 'image-note')]
    const before = distributeGalleryCards(first, 3).map(column => column.map(item => item.id))
    const after = distributeGalleryCards(later, 3).map(column => column.map(item => item.id))
    expect(before).toEqual([['a', 'd'], ['b', 'e'], ['c']])
    expect(after).toEqual([['a', 'd', 'g'], ['b', 'e'], ['c', 'f']])
    expect(galleryColumnCount(320)).toBe(1)
    expect(galleryColumnCount(600)).toBe(2)
    expect(galleryColumnCount(900)).toBe(3)
    expect(galleryColumnCount(1100)).toBe(4)
  })

  it('uses only a saved cover asset and falls back when the card has none', () => {
    expect(galleryCoverUrl({ ...card('draft/one'), coverAssetId: 'asset?#' }))
      .toBe('/api/cqai-publisher/content-asset/draft%2Fone/asset%3F%23')
    expect(galleryCoverUrl(card('draft/two', 'image-note'))).toBeUndefined()
  })

  it('uses the existing range-capable video preview route without exposing a local file path', () => {
    expect(videoGalleryPreviewUrl({ kind: 'work', workId: 'work/one' }))
      .toBe('/api/cqai-publisher/video-preview/work/work%2Fone#t=0.1')
    expect(videoGalleryPreviewUrl({ kind: 'local', localVideoId: 'local/one', fileName: 'private.mp4', bytes: 42 }))
      .toBe('/api/cqai-publisher/video-preview/local/local%2Fone#t=0.1')
    expect(videoGalleryPreviewUrl()).toBeUndefined()
  })
})
