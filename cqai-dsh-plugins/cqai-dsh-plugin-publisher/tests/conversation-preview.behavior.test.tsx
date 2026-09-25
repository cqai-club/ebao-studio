// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationPreview } from '../src/client/conversation-preview.tsx'

const sessionId = 'session-1'
const source = {
  id: 'source-1', sessionId, revision: 'revision-1', fileName: '原稿.md', title: '原稿', body: '正文', images: [],
}
const candidate = {
  id: 'candidate-1', sessionId, sourceId: source.id, sourceRevision: source.revision,
  contentType: 'article', platforms: ['wxmp'], title: '发布主稿', body: '正文', summary: '', tags: [], platformVariants: {},
}

afterEach(() => vi.unstubAllGlobals())

it('switches preview devices and opens multi-platform publishing from the header only', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = url.includes('/session-preview/') ? { sessionId, source, candidate }
      : url.endsWith('/publication-open') ? { id: 'prepared-1', contentType: 'article' }
        : { sessionId, contentId: null, revision: null, content: null }
    return {
      ok: true, headers: { get: () => 'application/json' }, json: async () => body,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const abort = new AbortController()
  const tab = { id: 'preview-tab', signal: abort.signal, visible: true, actions: { close: vi.fn() } }
  const onPublish = vi.fn()
  const onOpenPublisher = vi.fn()
  const props = { sessionId, useTabInfo: () => ({ tab }), onPublish, onOpenPublisher } as Parameters<typeof ConversationPreview>[0]

  try {
    await act(async () => { root.render(<ConversationPreview {...props}/>); await Promise.resolve() })
    const controls = host.querySelector('.pub-conv-controls')!
    const switchButtons = controls.querySelectorAll<HTMLButtonElement>('.pub-conv-switch button')
    expect(switchButtons).toHaveLength(2)
    expect(switchButtons[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.pub-conv-footer')).toBeNull()
    await act(async () => { switchButtons[1]!.click() })
    expect(switchButtons[1]?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.pub-conv-device-scroll')?.getAttribute('data-device')).toBe('pc')

    const publish = controls.querySelector<HTMLButtonElement>('.pub-conv-publish')!
    expect(publish.textContent).toBe('多平台发布')
    expect(publish.disabled).toBe(false)
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/publication-open') && init?.method === 'POST')).toBe(false)
    await act(async () => { publish.click(); await Promise.resolve() })
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/publication-open') && init?.method === 'POST')).toHaveLength(1)
    expect(onPublish).toHaveBeenCalledWith({ id: 'prepared-1', contentType: 'article' }, ['wxmp'])
    expect(onOpenPublisher).not.toHaveBeenCalled()
  } finally {
    abort.abort()
    await act(async () => { root.unmount() })
    host.remove()
  }
})

it('imports the exact source revision as an article when the preview has no publish candidate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true, headers: { get: () => 'application/json' },
    json: async () => String(input).endsWith('/publication-open-source')
      ? { id: 'source-article-1', contentType: 'article' }
      : { sessionId, source, candidate: null },
  } as unknown as Response))
  vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const abort = new AbortController()
  const tab = { id: 'preview-tab', signal: abort.signal, visible: true, actions: { close: vi.fn() } }
  const onPublish = vi.fn()
  const onOpenPublisher = vi.fn()
  const props = { sessionId, useTabInfo: () => ({ tab }), onPublish, onOpenPublisher } as Parameters<typeof ConversationPreview>[0]

  try {
    await act(async () => { root.render(<ConversationPreview {...props}/>); await Promise.resolve() })
    const publish = host.querySelector<HTMLButtonElement>('.pub-conv-publish')!
    expect(publish.disabled).toBe(false)
    await act(async () => { publish.click(); await Promise.resolve() })
    const imports = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/publication-open-source') && init?.method === 'POST')
    expect(imports).toHaveLength(1)
    expect(JSON.parse(String(imports[0]![1]?.body))).toEqual({ sessionId, sourceRevision: source.revision })
    expect(onPublish).toHaveBeenCalledWith({ id: 'source-article-1', contentType: 'article' })
    expect(onOpenPublisher).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/publication-open'))).toBe(false)
  } finally {
    abort.abort()
    await act(async () => { root.unmount() })
    host.remove()
  }
})

it('opens the draft gallery without importing when no conversation source exists', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true, headers: { get: () => 'application/json' },
    json: async () => String(input).includes('/session-preview/')
      ? { sessionId, source: null, candidate: null }
      : { sessionId, contentId: null, revision: null, content: null },
  } as unknown as Response))
  vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const abort = new AbortController()
  const tab = { id: 'preview-tab', signal: abort.signal, visible: true, actions: { close: vi.fn() } }
  const onPublish = vi.fn()
  const onOpenPublisher = vi.fn()
  const props = { sessionId, useTabInfo: () => ({ tab }), onPublish, onOpenPublisher } as Parameters<typeof ConversationPreview>[0]

  try {
    await act(async () => { root.render(<ConversationPreview {...props}/>); await Promise.resolve() })
    const publish = host.querySelector<HTMLButtonElement>('.pub-conv-publish')!
    await act(async () => { publish.click() })
    expect(onOpenPublisher).toHaveBeenCalledTimes(1)
    expect(onPublish).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/publication-open-source'))).toBe(false)
  } finally {
    abort.abort()
    await act(async () => { root.unmount() })
    host.remove()
  }
})
