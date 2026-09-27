import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPublisherHandoff, readPublisherHandoff, rememberPublisherHandoff,
  requestPublisherHandoff, subscribePublisherHandoff,
} from '../src/client/handoff.ts'

const article = { contentId: '9e94dbea-78e7-4fb9-90e1-2d231aa24436', contentType: 'article' } as const
const imageNote = { contentId: '8818dfc6-1318-43a8-9b18-3d303878aa48', contentType: 'image-note' } as const

beforeEach(() => {
  const events = new EventTarget()
  const stored = new Map<string, string>()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  })
  vi.stubGlobal('CustomEvent', class<T> extends Event {
    detail: T
    constructor(name: string, options: { detail: T }) {
      super(name)
      this.detail = options.detail
    }
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('publisher draft handoff', () => {
  it('remembers the exact draft for a panel mounted after navigation and for reload', () => {
    requestPublisherHandoff(article)
    expect(readPublisherHandoff()).toEqual(article)
    rememberPublisherHandoff(imageNote)
    expect(readPublisherHandoff()).toEqual(imageNote)
    clearPublisherHandoff()
    expect(readPublisherHandoff()).toBeUndefined()
  })

  it('notifies mounted publisher panels and rejects malformed IDs and types', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePublisherHandoff(listener)
    requestPublisherHandoff(article)
    expect(listener).toHaveBeenCalledExactlyOnceWith(article)
    unsubscribe()
    requestPublisherHandoff(imageNote)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => requestPublisherHandoff({ contentId: 'wrong', contentType: 'article' })).toThrow('发布草稿 ID 或类型无效')
    expect(() => requestPublisherHandoff({ ...article, platforms: ['wxmp', 'wxmp'] })).toThrow('发布草稿 ID 或类型无效')
  })

  it('retains candidate target platforms across a module reload', async () => {
    const candidate = { ...article, platforms: ['wxmp', 'tt'] as const }
    requestPublisherHandoff({ ...candidate, platforms: [...candidate.platforms] })
    vi.resetModules()
    const { readPublisherHandoff: readAfterReload } = await import('../src/client/handoff.ts')
    expect(readAfterReload()).toEqual(candidate)
    expect(window.sessionStorage.getItem('cqai-publisher-handoff')).toContain('"platforms":["wxmp","tt"]')
  })

  it('discards malformed or stale session data instead of choosing an arbitrary draft', () => {
    window.sessionStorage.setItem('cqai-publisher-handoff', JSON.stringify({ contentId: 'wrong', contentType: 'article' }))
    expect(readPublisherHandoff()).toBeUndefined()
    expect(window.sessionStorage.getItem('cqai-publisher-handoff')).toBeNull()
    window.sessionStorage.setItem('cqai-publisher-handoff', '{broken')
    expect(readPublisherHandoff()).toBeUndefined()
    expect(window.sessionStorage.getItem('cqai-publisher-handoff')).toBeNull()
  })

  it('keeps the exact handoff for a panel mounted later when session storage is unavailable', () => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => { throw new Error('storage unavailable') },
        setItem: () => { throw new Error('storage unavailable') },
        removeItem: () => { throw new Error('storage unavailable') },
      },
      dispatchEvent: () => true,
    })
    requestPublisherHandoff(article)
    expect(readPublisherHandoff()).toEqual(article)
    clearPublisherHandoff()
    expect(readPublisherHandoff()).toBeUndefined()
  })
})
