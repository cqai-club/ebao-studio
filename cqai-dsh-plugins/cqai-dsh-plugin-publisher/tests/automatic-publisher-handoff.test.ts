// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAutomaticArticleHandoff, watchAutomaticPublisherHandoffs } from '../src/client/article-handoff-card.tsx'
const visibility = vi.hoisted(() => ({ phase: 'ready' as 'ready' | 'pending', value: { workspaceIds: ['publisher'], sessionIds: ['owned'] }, listeners: new Set<() => void>() }))
vi.mock('../src/client/internal-workspace-visibility.tsx', () => ({
  getPublisherWorkspaceVisibilitySnapshot: () => visibility,
  subscribePublisherWorkspaceVisibility: (listener: () => void) => { visibility.listeners.add(listener); return () => { visibility.listeners.delete(listener) } },
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: () => null }))
vi.mock('../src/client/shared.tsx', () => ({ errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : '操作失败' }))
const fetcher = vi.fn<typeof fetch>()
const cleanups: (() => void)[] = []
const handoffId = 'e49579e2-5810-458d-b6f4-d5617f85ebea'
let sequence = 0
function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; listeners.forEach(listener => listener()) }, listenerCount: () => listeners.size }
}
function fixture() {
  const taskId = `live-task-${++sequence}`
  const session = store({ pendingSubmissions: [] as { requestId: string }[], running: false, removed: false })
  const events = store({ entries: [] as any[], revision: 0, change: { kind: 'replace', entries: [] as any[] } })
  const binding = { session, eventSource: events }
  const panelInfo = store({ activePanelId: null as string | null })
  let navigation = new AbortController()
  const layout = { panelInfo, beginNavigation: vi.fn(() => { navigation.abort(); navigation = new AbortController(); return navigation.signal }) }
  let main = 'outside'
  const list = store({ ids: ['outside', 'owned'], byId: { outside: {}, owned: {} } })
  const sessions = { list, binding: () => binding,
    retainInfo: (id: string) => ({ getSnapshot: () => ({ retainedBy: { mainView: main === id ? 1 : 0 } }) }) }
  const onOpen = vi.fn()
  const close = watchAutomaticPublisherHandoffs(sessions as never, layout as never, onOpen)
  cleanups.push(close)
  const result = { handoff: { handoffId, source: { sessionId: 'outside' }, delegation: { taskId } }, content: { id: 'content-1', contentType: 'image-note' } }
  fetcher.mockResolvedValue({ ok: true, json: async () => result } as Response)
  const append = (type: string, data: unknown, kind = 'append') => {
    const before = events.getSnapshot()
    const entry = { type: 'event', event: { type, data, seq: before.revision + 1 } }
    events.set({ entries: [...before.entries, entry], revision: before.revision + 1, change: { kind, entries: [entry] } })
  }
  const send = () => { session.set({ ...session.getSnapshot(), pendingSubmissions: [{ requestId: `request-${sequence}` }] }) }
  const start = () => { session.set({ ...session.getSnapshot(), pendingSubmissions: [], running: true }); append('turn/start', { turn: 1 }) }
  const transfer = (options: { kind?: string; name?: string; automatic?: boolean } = {}) => {
    append('tool/call', { turn: 1, callId: 'call-1', name: options.name ?? 'handoff_to_publisher' })
    append('tool/result', { turn: 1, message: { toolCallId: 'call-1', content: [{ type: 'text', text: JSON.stringify({ handoff_id: handoffId, task_id: taskId, auto_open: options.automatic ?? true }) }] } }, options.kind)
  }
  const ptcTransfer = (options: { kind?: string; name?: string; isError?: boolean; rootTurn?: number } = {}) => {
    append('tool/call', { turn: options.rootTurn ?? 1, callId: 'program-1', name: 'run_code' })
    append('tool/ptc-dispatch-start', { rootCallId: 'program-1', parentCallId: 'program-1', subCallId: 'program-1:ptc:1', name: options.name ?? 'handoff_to_publisher', arguments: { creationBrief: '写一篇露营分享' } })
    append('tool/ptc-dispatch', { rootCallId: 'program-1', parentCallId: 'program-1', subCallId: 'program-1:ptc:1', name: options.name ?? 'handoff_to_publisher', arguments: { creationBrief: '写一篇露营分享' },
      isError: options.isError ?? false, content: [{ type: 'text', text: JSON.stringify({ handoff_id: handoffId, task_id: taskId, auto_open: true }) }] }, options.kind)
  }
  const finish = (reason = 'completed') => { append('turn/end', { turn: 1, reason: { kind: reason } }); session.set({ ...session.getSnapshot(), running: false }) }
  return { session, events, layout, onOpen, close, result, append, send, start, transfer, ptcTransfer, finish,
    changeMain: (id: string) => { main = id; list.set({ ...list.getSnapshot() }) } }
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve() }
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); sessionStorage.clear(); visibility.phase = 'ready'; visibility.value.sessionIds = ['owned'] })
afterEach(() => { cleanups.splice(0).forEach(close => close()); vi.unstubAllGlobals() })

describe('fresh automatic Publisher delegation navigation', () => {
  it('requires a successful automatic tool handle with a persistent task', () => {
    expect(parseAutomaticArticleHandoff({ content: [{ type: 'text', text: JSON.stringify({ handoff_id: handoffId, task_id: 'task', auto_open: true }) }] }))
      .toEqual({ handoffId, taskId: 'task' })
    expect(parseAutomaticArticleHandoff({ content: [{ type: 'text', text: JSON.stringify({ handoff_id: handoffId, auto_open: true }) }] })).toBeNull()
  })
  it('opens article or image-note only after the observed local source turn ends and stops running', async () => {
    const host = fixture()
    host.send(); host.start(); host.transfer()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
    host.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
    host.session.set({ ...host.session.getSnapshot(), running: false })
    await settle()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ sessionId: 'outside', handoffId })
    expect(host.onOpen).toHaveBeenCalledExactlyOnceWith(host.result)
  })
  it('preserves the already-qualified ordinary source while delegation creation refreshes visibility', async () => {
    const host = fixture()
    host.send(); host.start()
    visibility.phase = 'pending'; visibility.listeners.forEach(listener => listener())
    host.transfer()
    visibility.phase = 'ready'; visibility.listeners.forEach(listener => listener())
    host.finish()
    await settle()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(host.onOpen).toHaveBeenCalledExactlyOnceWith(host.result)
  })
  it('accepts the genuine inner PTC dispatch result only after its observed source turn ends', async () => {
    const host = fixture()
    host.send(); host.start(); host.ptcTransfer()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
    host.finish()
    await settle()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(host.onOpen).toHaveBeenCalledExactlyOnceWith(host.result)
  })
  it.each([
    { name: 'another-tool' }, { isError: true }, { rootTurn: 2 }, { kind: 'replace' }, { kind: 'prepend' },
  ])('keeps unrelated, unsuccessful, other-turn or historical PTC evidence manual: %j', async options => {
    const host = fixture()
    host.send(); host.start(); host.ptcTransfer(options); host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not interpret a run_code printed handle as an inner handoff', async () => {
    const host = fixture()
    host.send(); host.start(); host.transfer({ name: 'run_code' }); host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not qualify a fresh conversation or replay its completed turn while visibility is pending', async () => {
    visibility.phase = 'pending'
    const host = fixture()
    host.send(); host.start(); host.transfer(); host.finish()
    visibility.phase = 'ready'; visibility.listeners.forEach(listener => listener())
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
    expect(host.onOpen).not.toHaveBeenCalled()
  })
  it('still cancels source-page navigation during a background visibility refresh', async () => {
    const host = fixture()
    host.send(); host.start()
    visibility.phase = 'pending'; visibility.listeners.forEach(listener => listener())
    host.layout.panelInfo.set({ activePanelId: 'another-plugin' })
    host.transfer(); host.finish()
    visibility.phase = 'ready'; visibility.listeners.forEach(listener => listener())
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('cancels a qualified source if refreshed metadata now identifies it as hidden', async () => {
    const host = fixture()
    host.send(); host.start(); host.transfer()
    visibility.value.sessionIds = ['owned', 'outside']; visibility.listeners.forEach(listener => listener())
    host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['replace', 'prepend'])('never delivers %s history even while viewing the same source', async kind => {
    const host = fixture()
    host.send(); host.start(); host.transfer({ kind }); host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps mid-turn or reopened history manual when no local Send was observed', async () => {
    const host = fixture()
    host.start(); host.transfer(); host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not supersede a later asynchronous navigation before its visible panel changes', async () => {
    const host = fixture()
    host.send(); host.start()
    const later = host.layout.beginNavigation()
    host.transfer(); host.finish()
    await settle()
    expect(later.aborted).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['panel', 'main'])('discards a fresh transfer after changing the %s selection', async change => {
    const host = fixture()
    host.send(); host.start(); host.transfer()
    if (change === 'panel') host.layout.panelInfo.set({ activePanelId: 'other-plugin' })
    else host.changeMain('owned')
    host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['aborted', 'error', 'interrupted'])('keeps %s source turns manual', async reason => {
    const host = fixture()
    host.send(); host.start(); host.transfer(); host.finish(reason)
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects another tool and nonautomatic handles', async () => {
    const host = fixture()
    host.send(); host.start(); host.transfer({ name: 'another-tool' }); host.transfer({ automatic: false }); host.finish()
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('cancels an in-flight automatic open after leaving its source and removes subscriptions', async () => {
    let resolve!: (value: Response) => void
    const host = fixture()
    fetcher.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    host.send(); host.start(); host.transfer(); host.finish()
    await settle()
    host.close()
    expect(fetcher.mock.calls[0][1]!.signal?.aborted).toBe(true)
    resolve({ ok: true, json: async () => host.result } as Response)
    await settle()
    expect(host.onOpen).not.toHaveBeenCalled()
    expect(host.events.listenerCount()).toBe(0)
    expect(host.session.listenerCount()).toBe(0)
  })
  it('does not deliver the same task again when its source emits duplicate append evidence', async () => {
    const host = fixture()
    host.send(); host.start(); host.transfer(); host.finish()
    await settle()
    host.transfer(); host.finish()
    await settle()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(host.onOpen).toHaveBeenCalledOnce()
  })
})
