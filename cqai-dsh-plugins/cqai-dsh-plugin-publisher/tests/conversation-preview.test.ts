import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advancePreviewDiscovery, advanceSessionPreviewDiscovery, contentAssetUrl, openPublicationCandidate,
  PreviewTabRegistry, previewForSession, sameDraftRevision, sameSessionPreview, sessionContentUrl,
  sessionPreviewUrl, sourceImageUrl, sourcePreviewForSession,
  type SessionContentSnapshot, type SessionPreviewSnapshot,
} from '../src/client/conversation-preview.tsx'
import type { PublisherContent } from '../src/protocol.ts'

const empty: SessionContentSnapshot = { sessionId: 'session-1', contentId: null, revision: null, content: null }
const article = { id: 'draft-1', contentType: 'article' } as PublisherContent
const imageNote = { id: 'note-1', contentType: 'image-note' } as PublisherContent
const video = { id: 'video-1', contentType: 'video' } as PublisherContent
const loaded = (sessionId: string, content: PublisherContent, revision = 1): SessionContentSnapshot => ({
  sessionId, contentId: content.id, revision, content,
})
const original: NonNullable<SessionPreviewSnapshot['source']> = {
  id: 'source-1', sessionId: 'session-1', revision: 'source-revision-1', fileName: '原稿.md',
  title: '原稿', body: '正文', images: [],
}
const candidate: NonNullable<SessionPreviewSnapshot['candidate']> = {
  id: 'candidate-1', sessionId: 'session-1', sourceId: original.id, sourceRevision: original.revision,
  contentType: 'article', platforms: ['wxmp'], title: '发布主稿', body: '候选正文', summary: '', tags: [],
  platformVariants: { wxmp: { title: '公众号标题', body: '公众号正文' } },
}
const sourcePreview: SessionPreviewSnapshot = { sessionId: 'session-1', source: original, candidate }

afterEach(() => vi.unstubAllGlobals())

describe('conversation draft preview identity', () => {
  it('keeps session and asset IDs in their own URL segments', () => {
    expect(sessionContentUrl('session/1?#')).toBe('/api/cqai-publisher/session-content/session%2F1%3F%23')
    expect(sessionPreviewUrl('session/1?#')).toBe('/api/cqai-publisher/session-preview/session%2F1%3F%23')
    expect(sourceImageUrl('source/1', 'image?#')).toBe('/api/cqai-publisher/source-image/source%2F1/image%3F%23')
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
    const failedRead = previewForSession(snapshot, { sessionId: 'session-1', message: '读取失败' }, 'session-1')
    expect(failedRead.content?.id).toBe(content.id)
    expect(failedRead.currentError).toBe('读取失败')
    expect(failedRead.canPublish).toBe(false)
    const switched = previewForSession(snapshot, { sessionId: 'session-1', message: '读取失败' }, 'session-2')
    expect(switched.content).toBeNull()
    expect(switched.currentError).toBe('')
    expect(switched.canPublish).toBe(false)
    expect(previewForSession(empty, undefined, 'session-1').canPublish).toBe(false)
  })
})

describe('source-first conversation preview', () => {
  it('refreshes on source revision or candidate changes, without offering another session', () => {
    expect(sameSessionPreview(undefined, sourcePreview)).toBe(false)
    expect(sameSessionPreview(sourcePreview, { ...sourcePreview })).toBe(true)
    expect(sameSessionPreview(sourcePreview, { ...sourcePreview, source: { ...original, revision: 'new' } })).toBe(false)
    expect(sameSessionPreview(sourcePreview, { ...sourcePreview, candidate: { ...candidate, id: 'new' } })).toBe(false)
    expect(sourcePreviewForSession(sourcePreview, loaded('session-1', article), undefined, 'session-2').canPublish).toBe(false)
  })

  it('requires a candidate for the exact source revision and falls back to old drafts only without a source', () => {
    const ready = sourcePreviewForSession(sourcePreview, loaded('session-1', article), undefined, 'session-1')
    expect(ready.source?.id).toBe(original.id)
    expect(ready.candidate?.id).toBe(candidate.id)
    expect(ready.content).toBeNull()
    expect(ready.canPublish).toBe(true)

    const revised = { ...sourcePreview, source: { ...original, revision: 'new' } }
    const stale = sourcePreviewForSession(revised, loaded('session-1', article), undefined, 'session-1')
    expect(stale.candidate).toBeNull()
    expect(stale.candidateStale).toBe(true)
    expect(stale.canPublish).toBe(false)
    const failed = sourcePreviewForSession(sourcePreview, undefined, { sessionId: 'session-1', message: '读取失败' }, 'session-1')
    expect(failed.canPublish).toBe(false)

    const old = sourcePreviewForSession({ sessionId: 'session-1', source: null, candidate: null }, loaded('session-1', article), undefined, 'session-1')
    expect(old.content?.id).toBe(article.id)
    expect(old.canPublish).toBe(true)
  })

  it('opens once when a previously empty session first gains an original MD', () => {
    const emptyPreview: SessionPreviewSnapshot = { sessionId: 'session-1', source: null, candidate: null }
    const initial = advanceSessionPreviewDiscovery(undefined, emptyPreview)
    expect(initial.showAction).toBe(false)
    const added = advanceSessionPreviewDiscovery(initial.state, { ...sourcePreview, candidate: null })
    expect(added.showAction).toBe(true)
    expect(added.autoOpen).toBe(true)
    expect(advanceSessionPreviewDiscovery(added.state, sourcePreview).autoOpen).toBe(false)
    const removed = advanceSessionPreviewDiscovery(added.state, emptyPreview)
    expect(removed.closePreview).toBe(true)
    expect(advanceSessionPreviewDiscovery(undefined, emptyPreview, loaded('session-1', article)).showAction).toBe(true)
  })

  it('sends the candidate ID and returns the persisted preparation or an error', async () => {
    const preparation = { id: '11111111-1111-4111-8111-111111111111', contentType: 'article' }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(preparation), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetcher)
    await expect(openPublicationCandidate('session-1', 'candidate-1')).resolves.toMatchObject(preparation)
    expect(fetcher).toHaveBeenCalledWith('/api/cqai-publisher/publication-open', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ejianbao': '1' },
      body: JSON.stringify({ sessionId: 'session-1', candidateId: 'candidate-1' }),
    }))
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ error: '原稿已变化' }), {
      status: 409, headers: { 'content-type': 'application/json' },
    }))
    await expect(openPublicationCandidate('session-1', 'candidate-1')).rejects.toThrow('原稿已变化')
  })
})

describe('conversation preview discovery', () => {
  it('hides the action for an initial empty session and unsupported video draft', () => {
    const initial = advancePreviewDiscovery(undefined, empty)
    expect(initial.showAction).toBe(false)
    expect(initial.autoOpen).toBe(false)
    expect(initial.closePreview).toBe(false)

    const videoResult = advancePreviewDiscovery(undefined, loaded('session-1', video))
    expect(videoResult.showAction).toBe(false)
    expect(videoResult.autoOpen).toBe(false)

    const mismatchedDraft = advancePreviewDiscovery(undefined, { ...loaded('session-1', article), contentId: 'other-draft' })
    expect(mismatchedDraft.showAction).toBe(false)
    expect(mismatchedDraft.autoOpen).toBe(false)
  })

  it('opens exactly once when an already-observed empty session first gains an article or image note', () => {
    const initial = advancePreviewDiscovery(undefined, empty)
    const created = advancePreviewDiscovery(initial.state, loaded('session-1', article))
    expect(created.showAction).toBe(true)
    expect(created.autoOpen).toBe(true)
    expect(created.closePreview).toBe(false)

    const revised = advancePreviewDiscovery(created.state, loaded('session-1', article, 2))
    expect(revised.showAction).toBe(true)
    expect(revised.autoOpen).toBe(false)

    const noteBaseline = advancePreviewDiscovery(undefined, { ...empty, sessionId: 'session-2' })
    const noteCreated = advancePreviewDiscovery(noteBaseline.state, loaded('session-2', imageNote))
    expect(noteCreated.showAction).toBe(true)
    expect(noteCreated.autoOpen).toBe(true)
  })

  it('shows an existing draft after session restore without automatically reopening it', () => {
    const restored = advancePreviewDiscovery(undefined, loaded('session-1', article))
    expect(restored.showAction).toBe(true)
    expect(restored.autoOpen).toBe(false)

    // A user may close the preview tab and then reopen it from the action.
    // Polling the same or a revised draft must not steal focus.
    expect(advancePreviewDiscovery(restored.state, loaded('session-1', article)).autoOpen).toBe(false)
    expect(advancePreviewDiscovery(restored.state, loaded('session-1', article, 3)).autoOpen).toBe(false)
  })

  it('keeps session transitions independent and closes only a deleted draft preview', () => {
    const first = advancePreviewDiscovery(undefined, loaded('session-1', article))
    const second = advancePreviewDiscovery(undefined, { ...empty, sessionId: 'session-2' })
    expect(first.showAction).toBe(true)
    expect(second.showAction).toBe(false)
    expect(advancePreviewDiscovery(first.state, { ...empty, sessionId: 'session-2' }).showAction).toBe(false)

    const deleted = advancePreviewDiscovery(first.state, empty)
    expect(deleted.showAction).toBe(false)
    expect(deleted.closePreview).toBe(true)
    expect(advancePreviewDiscovery(deleted.state, empty).closePreview).toBe(false)

    // A second draft in the same session does not automatically reopen the tab.
    expect(advancePreviewDiscovery(deleted.state, loaded('session-1', article, 4)).autoOpen).toBe(false)

    const initiallyEmpty = advancePreviewDiscovery(undefined, empty)
    const firstCreation = advancePreviewDiscovery(initiallyEmpty.state, loaded('session-1', article))
    const removed = advancePreviewDiscovery(firstCreation.state, empty)
    expect(advancePreviewDiscovery(removed.state, loaded('session-1', article, 5)).autoOpen).toBe(false)
  })

})

describe('conversation preview tab cleanup', () => {
  it('closes only the deleted session preview, once, even when another tab is focused', () => {
    const registry = new PreviewTabRegistry()
    const first = new AbortController()
    const second = new AbortController()
    const closed: string[] = []
    registry.register('session-1', 'preview-1', first.signal, () => { closed.push('preview-1') })
    registry.register('session-2', 'preview-2', second.signal, () => { closed.push('preview-2') })

    registry.closeSession('session-1')
    registry.closeSession('session-1')
    expect(closed).toEqual(['preview-1'])

    first.abort()
    registry.closeSession('session-1')
    expect(closed).toEqual(['preview-1'])
    registry.closeSession('session-2')
    expect(closed).toEqual(['preview-1', 'preview-2'])
  })

  it('removes aborted registrations without removing a replacement tab', () => {
    const registry = new PreviewTabRegistry()
    const oldTab = new AbortController()
    const newTab = new AbortController()
    const closed: string[] = []
    registry.register('session-1', 'preview', oldTab.signal, () => { closed.push('old') })
    registry.register('session-1', 'preview', newTab.signal, () => { closed.push('new') })
    oldTab.abort()
    registry.closeSession('session-1')
    expect(closed).toEqual(['new'])
    newTab.abort()
    registry.closeSession('session-1')
    expect(closed).toEqual(['new'])
  })
})
