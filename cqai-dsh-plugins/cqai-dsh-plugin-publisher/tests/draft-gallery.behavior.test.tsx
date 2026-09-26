// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherContentCard, PublisherContentQueryResult } from '../src/protocol.ts'
import { DraftGallery, type DraftGalleryProps } from '../src/client/draft-gallery.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('../src/client/shared.tsx', () => ({
  CONTENT_LABELS: { article: '文章', 'image-note': '图文', video: '视频' },
  api: vi.fn(),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '操作失败',
}))

const queryApi = api as unknown as Mock
let root: Root | undefined
let container: HTMLDivElement | undefined

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = []
  target?: Element
  disconnected = false

  constructor(private callback: IntersectionObserverCallback) {
    TestIntersectionObserver.instances.push(this)
  }

  observe(target: Element) { this.target = target }
  disconnect() { this.disconnected = true }
  unobserve() {}
  takeRecords() { return [] }
  trigger() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function card(id: string, contentType: PublisherContentCard['contentType'] = 'article'): PublisherContentCard {
  return { id, contentType, revision: 1, updatedAt: '2026-09-25T00:00:00.000Z', title: id, excerpt: '' }
}

function page(items: PublisherContentCard[], nextCursor: string | null = null): PublisherContentQueryResult {
  return { items, nextCursor }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function renderGallery(overrides: Partial<DraftGalleryProps> = {}) {
  container = document.createElement('div')
  container.className = 'pub'
  document.body.append(container)
  root = createRoot(container)
  const callbacks = { onOpen: vi.fn(), onCreate: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn() }
  await act(async () => {
    root!.render(<DraftGallery contentType="article" active {...callbacks} {...overrides}/>)
  })
  return callbacks
}

function search(value: string) {
  const input = container!.querySelector<HTMLInputElement>('input[type="search"]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  TestIntersectionObserver.instances = []
  queryApi.mockReset()
})

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
  vi.unstubAllGlobals()
})

describe('draft gallery interactions', () => {
  it('debounces search for 300 ms and ignores an older response after the query changes', async () => {
    const initial = deferred<PublisherContentQueryResult>()
    const matching = deferred<PublisherContentQueryResult>()
    queryApi.mockImplementation((_route: string, payload: { query: string }) =>
      payload.query === 'coffee' ? matching.promise : initial.promise)
    await renderGallery()
    expect(queryApi).toHaveBeenCalledWith('contents-query', { contentType: 'article', query: '' })

    vi.useFakeTimers()
    await act(async () => { search('coffee') })
    expect(container!.textContent).toContain('正在搜索')
    await act(async () => { vi.advanceTimersByTime(299) })
    expect(queryApi).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(queryApi).toHaveBeenCalledWith('contents-query', { contentType: 'article', query: 'coffee' })

    await act(async () => { matching.resolve(page([card('coffee-draft')])) })
    expect(container!.querySelectorAll('.pub-gallery-card')).toHaveLength(1)
    expect(container!.textContent).toContain('coffee-draft')
    await act(async () => { initial.resolve(page([card('obsolete-draft')])) })
    expect(container!.textContent).not.toContain('obsolete-draft')
    expect(container!.querySelectorAll('.pub-gallery-card')).toHaveLength(1)
  })

  it('loads the next page once when the sentinel intersects and ignores overlapping cards', async () => {
    const second = deferred<PublisherContentQueryResult>()
    queryApi.mockImplementation((_route: string, payload: { cursor?: string }) =>
      payload.cursor ? second.promise : Promise.resolve(page([card('one'), card('two')], 'cursor-2')))
    await renderGallery()
    expect(container!.querySelectorAll('.pub-gallery-card')).toHaveLength(2)
    const sentinel = TestIntersectionObserver.instances.find(observer => observer.target?.classList.contains('pub-gallery-sentinel'))
    expect(sentinel).toBeDefined()

    await act(async () => { sentinel!.trigger(); sentinel!.trigger() })
    expect(queryApi).toHaveBeenCalledTimes(2)
    expect(queryApi).toHaveBeenLastCalledWith('contents-query', { contentType: 'article', query: '', cursor: 'cursor-2' })
    await act(async () => { second.resolve(page([card('two'), card('three'), card('three')])) })
    expect([...container!.querySelectorAll('.pub-gallery-card')].map(element => element.textContent)).toEqual([
      expect.stringContaining('one'), expect.stringContaining('two'), expect.stringContaining('three'),
    ])
    expect(container!.querySelectorAll('.pub-gallery-card')).toHaveLength(3)
    expect(container!.textContent).toContain('已显示全部草稿')
  })

  it('opens new and selected drafts and exposes copy/delete through the touch and keyboard menu', async () => {
    queryApi.mockResolvedValue(page([card('note-1', 'image-note')]))
    const callbacks = await renderGallery({ contentType: 'image-note' })
    expect(container!.getAttribute('class')).toBe('pub')
    expect(container!.querySelector('.pub-gallery-masonry')).not.toBeNull()

    await act(async () => { container!.querySelector<HTMLButtonElement>('.pub-gallery-create')!.click() })
    expect(callbacks.onCreate).toHaveBeenCalledTimes(1)
    await act(async () => { container!.querySelector<HTMLButtonElement>('.pub-gallery-open')!.click() })
    expect(callbacks.onOpen).toHaveBeenCalledWith('note-1')

    const more = container!.querySelector<HTMLButtonElement>('.pub-gallery-more')!
    more.focus()
    expect(document.activeElement).toBe(more)
    await act(async () => { more.click() })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(container!.querySelector('.pub-gallery-actions-open')).not.toBeNull()
    await act(async () => { container!.querySelector<HTMLButtonElement>('.pub-gallery-actions button:nth-child(2)')!.click() })
    expect(callbacks.onCopy).toHaveBeenCalledWith('note-1')
    expect(more.getAttribute('aria-expanded')).toBe('false')

    await act(async () => { more.click() })
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { more.click() })
    await act(async () => { container!.querySelector<HTMLButtonElement>('.pub-gallery-delete')!.click() })
    expect(callbacks.onDelete).toHaveBeenCalledWith('note-1')
  })
})
