import { describe, expect, it } from 'vitest'
import { contentAssetUrl, previewForSession, sameDraftRevision, sessionContentUrl, type SessionContentSnapshot } from '../src/client/conversation-preview.tsx'
import type { PublisherContent } from '../src/protocol.ts'

const empty: SessionContentSnapshot = { sessionId: 'session-1', contentId: null, revision: null, content: null }

describe('conversation draft preview identity', () => {
  it('keeps session and asset IDs in their own URL segments', () => {
    expect(sessionContentUrl('session/1?#')).toBe('/api/cqai-publisher/session-content/session%2F1%3F%23')
    expect(contentAssetUrl('content/1', 'asset?#')).toBe('/api/cqai-publisher/content-asset/content%2F1/asset%3F%23')
  })

  it('refreshes when a different session, draft or revision arrives', () => {
    expect(sameDraftRevision(undefined, empty)).toBe(false)
    expect(sameDraftRevision(empty, { ...empty })).toBe(true)
    expect(sameDraftRevision(empty, { ...empty, sessionId: 'session-2' })).toBe(false)
    expect(sameDraftRevision(empty, { ...empty, contentId: 'draft-1', revision: 1 })).toBe(false)
    const draft = { ...empty, contentId: 'draft-1', revision: 1 }
    expect(sameDraftRevision(draft, { ...draft, revision: 2 })).toBe(false)
    expect(sameDraftRevision(draft, { ...draft, contentId: 'draft-2' })).toBe(false)
  })

  it('never offers a stale or failed session draft for publication', () => {
    const content = { id: 'draft-1', contentType: 'article' } as PublisherContent
    const snapshot: SessionContentSnapshot = { sessionId: 'session-1', contentId: content.id, revision: 1, content }
    expect(previewForSession(snapshot, undefined, 'session-1').canPublish).toBe(true)
    expect(previewForSession(snapshot, { sessionId: 'session-1', message: '读取失败' }, 'session-1').canPublish).toBe(false)
    const switched = previewForSession(snapshot, { sessionId: 'session-1', message: '读取失败' }, 'session-2')
    expect(switched.content).toBeNull()
    expect(switched.currentError).toBe('')
    expect(switched.canPublish).toBe(false)
    expect(previewForSession(empty, undefined, 'session-1').canPublish).toBe(false)
  })
})
