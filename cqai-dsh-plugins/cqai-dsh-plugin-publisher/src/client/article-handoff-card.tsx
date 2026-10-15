import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot, ToolCallBlock, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ISessions, SessionBinding, SessionEventWindow, SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-tools/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PublisherArticleHandoff, PublisherArticleHandoffResult } from '../article-handoff-protocol.ts'
import { API, PLATFORM_LABELS } from '../protocol.ts'
import { errorMessage } from './shared.tsx'
import { claimPublisherAutoHandoff } from './handoff.ts'
import { getPublisherWorkspaceVisibilitySnapshot, subscribePublisherWorkspaceVisibility } from './internal-workspace-visibility.tsx'

type Navigation = { beginNavigation(): AbortSignal; onOpen(result: PublisherArticleHandoffResult): void }
type Result = { isError?: boolean; content: readonly { type: string; text?: string }[] }
const HANDOFF_STATUS_EVENT = 'cqai-publisher-handoff-status'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export async function articleHandoffApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-ejianbao': '1' }, body: JSON.stringify(body) }),
    signal,
  })
  const value = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(value.error ?? '文章转交失败，请重试')
  return value
}

export function parseArticleHandoffId(result: Result): string | null {
  if (result.isError) return null
  for (const block of result.content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      const record = JSON.parse(block.text) as Record<string, unknown>
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        const id = record.handoff_id ?? record.handoffId
        if (typeof id === 'string' && UUID.test(id)) return id
      }
    } catch { /* A different tool result is not a handoff. */ }
  }
  return null
}

export function parseAutomaticArticleHandoff(result: Result): { handoffId: string; taskId: string } | null {
  const handoffId = parseArticleHandoffId(result)
  if (!handoffId) return null
  for (const block of result.content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      const value = JSON.parse(block.text) as Record<string, unknown>
      if (value?.auto_open === true && value.handoff_id === handoffId
        && typeof value.task_id === 'string' && value.task_id.length > 0 && value.task_id.length <= 512) {
        return { handoffId, taskId: value.task_id }
      }
    } catch { /* Other tool text cannot authorize navigation. */ }
  }
  return null
}

/** Observe live input and append deltas; history replacement never authorizes automatic navigation. */
export function watchAutomaticPublisherHandoffs(sessions: ISessions, layout: ILayout, onOpen: Navigation['onOpen']): () => void {
  if (typeof sessions.binding !== 'function') return () => {}
  type Flow = { id: SessionId; binding: SessionBinding; dispose(): void; prompts: Set<string>; revision: number;
    request?: AbortController; signal?: AbortSignal; turn?: number; finished?: boolean; task?: { handoffId: string; taskId: string }; opening?: boolean }
  let flow: Flow | undefined
  let disposed = false
  const selected = (): SessionId | undefined => {
    if (layout.panelInfo.getSnapshot().activePanelId !== null) return undefined
    const visibility = getPublisherWorkspaceVisibilitySnapshot()
    const list = sessions.list.getSnapshot() as SessionListState
    const references = list.ids.filter(id => (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0)
    if (references.length !== 1 || list.byId[references[0]]?.origin === 'subagent'
      || visibility.value.sessionIds.includes(references[0])) return undefined
    // Creating the delegated Workspace refreshes background visibility. Keep
    // only this already-qualified ordinary source; pending metadata cannot
    // qualify a newly selected or previously unknown conversation.
    if (visibility.phase !== 'ready' && flow?.id !== references[0]) return undefined
    return references[0]
  }
  const stillSelected = (owner: Flow) => !disposed && flow === owner && selected() === owner.id
  const current = (owner: Flow) => stillSelected(owner) && !owner.signal?.aborted
  const maybeOpen = (owner: Flow) => {
    if (!current(owner) || !owner.task || !owner.finished || !owner.signal || owner.opening
      || owner.binding.session.getSnapshot().running || owner.binding.session.getSnapshot().removed) return
    owner.opening = true
    const { handoffId, taskId } = owner.task
    void articleHandoffApi<PublisherArticleHandoffResult>('article-handoff-open', { sessionId: owner.id, handoffId }, owner.signal).then(result => {
      if (!current(owner) || result.handoff.source.sessionId !== owner.id || result.handoff.handoffId !== handoffId
        || result.handoff.delegation?.taskId !== taskId || !['article', 'image-note'].includes(result.content.contentType)) return
      onOpen(result)
    }).catch(cause => {
      if (current(owner) && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HANDOFF_STATUS_EVENT, {
        detail: { sessionId: owner.id, handoffId, error: errorMessage(cause) },
      }))
    })
  }
  const sessionChanged = (owner: Flow) => {
    if (!stillSelected(owner)) return
    for (const pending of owner.binding.session.getSnapshot().pendingSubmissions) {
      if (owner.prompts.has(pending.requestId)) continue
      owner.prompts.add(pending.requestId)
      owner.request?.abort()
      owner.request = new AbortController()
      // This local Send echo precedes its async Host admission. Later navigation
      // aborts the signal instead of a late Tool result superseding that navigation.
      owner.signal = AbortSignal.any([owner.request.signal, layout.beginNavigation()])
      owner.turn = undefined; owner.finished = false; owner.task = undefined; owner.opening = false
    }
    maybeOpen(owner)
  }
  const eventsChanged = (owner: Flow) => {
    if (!current(owner)) return
    const window = owner.binding.eventSource.getSnapshot() as SessionEventWindow
    if (window.revision === owner.revision) return
    owner.revision = window.revision
    if (window.change.kind !== 'append' || !owner.signal) return
    for (const entry of window.change.entries) {
      if (entry.type !== 'event') continue
      const event = entry.event
      if (event.type === 'turn/start' && owner.turn === undefined) owner.turn = event.data.turn
      if (event.type === 'tool/result' && event.data.turn === owner.turn) {
        const callId = event.data.message.source?.callId ?? event.data.message.toolCallId
        const call = window.entries.findLast(item => item.type === 'event' && item.event.type === 'tool/call'
          && item.event.data.callId === callId)
        if (call?.type !== 'event' || call.event.type !== 'tool/call' || call.event.data.name !== 'handoff_to_publisher') continue
        const task = parseAutomaticArticleHandoff(event.data.message)
        if (task && claimPublisherAutoHandoff(owner.id, task.taskId)) owner.task = task
      }
      if (event.type === 'tool/ptc-dispatch' && event.data.name === 'handoff_to_publisher' && event.data.isError === false) {
        // PTC records the inner outcome separately; run_code's printed text is
        // never evidence. Resolve its declared root call to the observed turn.
        const root = window.entries.findLast(item => item.type === 'event' && item.event.type === 'tool/call'
          && item.event.data.callId === event.data.rootCallId)
        if (root?.type !== 'event' || root.event.type !== 'tool/call' || root.event.data.name !== 'run_code'
          || owner.turn === undefined || root.event.data.turn !== owner.turn) continue
        const task = parseAutomaticArticleHandoff(event.data)
        if (task && claimPublisherAutoHandoff(owner.id, task.taskId)) owner.task = task
      }
      if (event.type === 'turn/end' && event.data.turn === owner.turn) owner.finished = event.data.reason.kind === 'completed'
    }
    maybeOpen(owner)
  }
  const reconcile = () => {
    if (disposed) return
    const id = selected(), binding = id ? sessions.binding(id) : undefined
    if (flow?.id === id && flow?.binding === binding) { if (flow) maybeOpen(flow); return }
    flow?.dispose(); flow = undefined
    if (!id || !binding) return
    const snapshot = binding.session.getSnapshot() as SessionSnapshot
    const owner: Flow = { id, binding, prompts: new Set(snapshot.pendingSubmissions.map(item => item.requestId)),
      revision: binding.eventSource.getSnapshot().revision, dispose: () => {} }
    flow = owner
    const removeSession = binding.session.subscribe(() => sessionChanged(owner))
    const removeEvents = binding.eventSource.subscribe(() => eventsChanged(owner))
    owner.dispose = () => { owner.request?.abort(); removeEvents(); removeSession() }
  }
  const cleanup = [sessions.list.subscribe(reconcile), layout.panelInfo.subscribe(reconcile), subscribePublisherWorkspaceVisibility(reconcile)]
  reconcile()
  return () => { disposed = true; flow?.dispose(); flow = undefined; cleanup.forEach(dispose => dispose()) }
}

export function articleHandoffIds(rows: readonly ToolChatData[]): string[] {
  const ids = new Set<string>()
  const visit = (block: ToolCallBlock) => {
    if ('kind' in block && block.kind === 'tool-result' && block.call?.name === 'handoff_to_publisher') {
      const id = parseArticleHandoffId(block)
      if (id) ids.add(id)
    }
    block.subCalls.forEach(visit)
  }
  rows.forEach(row => visit(row.root))
  return [...ids]
}

export function ArticleHandoffToolView(props: PropsRuntime<'tool.call.toolview'>) {
  if (props.phase !== 'result') return <div role="status">正在交给多平台发布…</div>
  return parseArticleHandoffId(props.block)
    ? <div role="status">已交给多平台发布，请在任务卡片查看进度。</div>
    : <div role="alert">转交准备失败，请检查来源后重试。</div>
}

const handoffCardCss = `
.pub-handoff-card { box-sizing: border-box; width: min(100%, 420px); min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #e4e6e9); border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111318); font-family: var(--dsw-font-family, inherit); }
.pub-handoff-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pub-handoff-icon { display: grid; place-items: center; flex: 0 0 32px; height: 32px; border-radius: 8px; background: var(--dsw-alias-bg-l2, #f4f5f7); color: var(--dsw-alias-label-secondary, #62666d); }
.pub-handoff-text { flex: 1; min-width: 0; }
.pub-handoff-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: 20px; }
.pub-handoff-meta { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--dsw-alias-label-secondary, #62666d); font-size: 12px; line-height: 18px; }
.pub-handoff-platforms { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pub-handoff-status, .pub-handoff-separator { flex-shrink: 0; }
.pub-handoff-open { flex-shrink: 0; width: auto; min-height: 28px; }
.pub-handoff-note { margin: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary, #62666d); font-size: 12px; line-height: 18px; }
.pub-handoff-error { color: var(--dsw-alias-text-error, #b42318); }
`
const handoffStatusLabels = {
  queued: '待处理', running: '处理中', completed: 'Agent 已回复', failed: '未完成', interrupted: '已中断',
} as const

export function ArticleHandoffCard({ sessionId, handoffId, beginNavigation, onOpen }: Navigation & { sessionId: string; handoffId: string }) {
  const [handoff, setHandoff] = useState<PublisherArticleHandoff>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController>()
  const generation = useRef(0)
  useEffect(() => {
    const request = new AbortController()
    const current = ++generation.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let remaining = 60
    let active = false
    setHandoff(undefined); setError(''); setBusy(false)
    const load = async () => {
      try {
        const value = await articleHandoffApi<PublisherArticleHandoff>(`article-handoff/${encodeURIComponent(sessionId)}/${encodeURIComponent(handoffId)}`, undefined, request.signal)
        if (value.handoffId !== handoffId || value.source.sessionId !== sessionId) throw new Error('文章转交与当前对话不匹配')
        if (request.signal.aborted || generation.current !== current) return
        setHandoff(value); setError('')
        active = value.delegation?.status === 'queued' || value.delegation?.status === 'running'
      } catch (cause) { if (!request.signal.aborted && generation.current === current) setError(errorMessage(cause)) }
      if (active && !request.signal.aborted && generation.current === current && remaining-- > 0) timer = setTimeout(() => void load(), 4000)
    }
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; handoffId?: string; error?: string }>).detail
      if (detail?.sessionId === sessionId && detail.handoffId === handoffId && detail.error) setError(detail.error)
    }
    window.addEventListener(HANDOFF_STATUS_EVENT, changed)
    void load()
    return () => { request.abort(); controller.current?.abort(); if (timer) clearTimeout(timer); window.removeEventListener(HANDOFF_STATUS_EVENT, changed); generation.current += 1 }
  }, [sessionId, handoffId])
  const open = async () => {
    if (busy || !handoff) return
    const navigation = beginNavigation()
    const request = new AbortController()
    controller.current = request
    const current = generation.current
    setBusy(true); setError('')
    try {
      const value = await articleHandoffApi<PublisherArticleHandoffResult>('article-handoff-open', { sessionId, handoffId }, AbortSignal.any([navigation, request.signal]))
      if (value.handoff.handoffId !== handoffId || value.handoff.source.sessionId !== sessionId || !['article', 'image-note'].includes(value.content.contentType)) throw new Error('转交结果不匹配')
      if (!navigation.aborted && !request.signal.aborted && generation.current === current) onOpen(value)
    } catch (cause) {
      if (!navigation.aborted && !request.signal.aborted && generation.current === current) setError(errorMessage(cause))
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }
  const title = handoff?.title || '发布草稿'
  const platforms = handoff?.platforms.map(platform => PLATFORM_LABELS[platform]).join('、') || '多平台发布'
  const status = handoff?.delegation ? handoffStatusLabels[handoff.delegation.status] : handoff ? '草稿已准备' : error ? '读取失败' : '正在读取…'
  return <section aria-label="文章转交" className="pub-handoff-card">
    <style>{handoffCardCss}</style>
    <div className="pub-handoff-main">
      <span className="pub-handoff-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>
      </svg></span>
      <div className="pub-handoff-text">
        <strong className="pub-handoff-title" title={title}>{title}</strong>
        <div className="pub-handoff-meta"><span className="pub-handoff-platforms" title={platforms}>{platforms}</span><span className="pub-handoff-separator" aria-hidden="true">·</span><span className="pub-handoff-status" role="status" aria-live="polite">{status}</span></div>
      </div>
      {handoff && <Button className="pub-handoff-open" size="sm" variant="outline" disabled={busy} aria-busy={busy} onClick={() => void open()}>{busy ? '打开中…' : '打开草稿'}</Button>}
    </div>
    {handoff?.delegation?.error && <p className="pub-handoff-note pub-handoff-error" title={handoff.delegation.error}>{handoff.delegation.error}</p>}
    {handoff && handoff.source.kind !== 'creation-brief' && handoff.sourceChanged && <p className="pub-handoff-note">原稿已更新，可在草稿中检查更新。</p>}
    {handoff && handoff.source.kind !== 'creation-brief' && !handoff.sourceAvailable && !handoff.contentId && <p className="pub-handoff-note">原稿已不可用，文章副本仍可转交。</p>}
    {error && <p className="pub-handoff-note pub-handoff-error" role="alert" title={error}>{error}</p>}
  </section>
}

export function ArticleHandoffTurnTail({ turn, sessionId, useChat, ...navigation }: PropsRuntime<'conversation.chat.turnTail'> & Navigation) {
  const nodes = useChat((snapshot: ChatSnapshot) => snapshot.nodes)
  const source = useMemo(() => nodes.turnDataSource(turn.turn, 'tool-call'), [nodes, turn.turn])
  const rows = useSyncExternalStore<readonly ToolChatData[]>(source.subscribe, source.getSnapshot, source.getSnapshot)
  return <div style={{ display: 'grid', gap: 12 }}>{articleHandoffIds(rows).map(handoffId => <ArticleHandoffCard key={`${sessionId}/${handoffId}`} sessionId={sessionId} handoffId={handoffId} {...navigation}/>)}</div>
}

const sourceControlsCss = `
.pub-card.pub-source-card { padding: 16px; }
.pub-source-card > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; color: var(--pub-text, var(--dsw-alias-label-primary, #111318)); font-size: 13px; font-weight: 600; line-height: 20px; }
.pub-source-card > summary::-webkit-details-marker { display: none; }
.pub-source-card > summary::marker { content: ''; }
.pub-source-card > summary:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; border-radius: 3px; }
.pub-source-kind { margin-left: auto; color: var(--pub-secondary-text, var(--dsw-alias-label-secondary, #62666d)); font-size: 12px; font-weight: 400; }
.pub-source-chevron { flex: none; }
.pub-source-card[open] .pub-source-chevron { transform: rotate(180deg); }
.pub-source-body { display: grid; gap: 12px; min-width: 0; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--pub-border, var(--dsw-alias-border-l2, #e4e6e9)); font-size: 13px; line-height: 1.65; }
.pub-source-body p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.pub-source-label { color: var(--pub-secondary-text, var(--dsw-alias-label-secondary, #62666d)); font-size: 12px; }
.pub-source-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pub-source-confirm { display: grid; gap: 8px; }
`

export function ArticleSourceControls({ contentId, active, busy, onReturn, onUpdate }: {
  contentId: string; active: boolean; busy: boolean
  onReturn(sessionId: string): Promise<void>
  onUpdate(handoff: PublisherArticleHandoff): Promise<void>
}) {
  const [origin, setOrigin] = useState<PublisherArticleHandoff & { sourceSessionAvailable?: boolean }>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [operation, setOperation] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const generation = useRef(0)
  useEffect(() => { setExpanded(false) }, [contentId])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController(), current = ++generation.current
    setOrigin(undefined); setError(''); setConfirm(false); setOperation(false)
    void articleHandoffApi<(PublisherArticleHandoff & { sourceSessionAvailable?: boolean }) | null>(`article-origin/${encodeURIComponent(contentId)}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted && generation.current === current && value?.contentId === contentId) setOrigin(value) })
      .catch(cause => { if (!controller.signal.aborted && generation.current === current) setError(errorMessage(cause)) })
    return () => { controller.abort(); generation.current += 1 }
  }, [active, contentId, refresh])
  if (!origin) return error ? <p role="status">来源信息暂时无法读取。<Button size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>重试</Button></p> : null
  const update = async () => {
    if (operation || busy) return
    const current = generation.current
    setOperation(true); setError('')
    try {
      await onUpdate(origin)
      if (generation.current === current) { setConfirm(false); setRefresh(value => value + 1) }
    } catch (cause) { if (generation.current === current) setError(errorMessage(cause)) }
    finally { if (generation.current === current) setOperation(false) }
  }
  return <details aria-label="文章来源" className="pub-card pub-source-card" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span>来源与要求</span><span className="pub-source-kind">{origin.source.kind === 'markdown' ? '原稿' : origin.source.kind === 'creation-brief' ? '创作任务' : '内容回复'}</span><svg className="pub-source-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    <style>{sourceControlsCss}</style>
    <div className="pub-source-body">
      <p className="pub-source-label">来自{origin.source.kind === 'markdown' ? `原稿「${origin.source.fileName ?? origin.title}」` : origin.source.kind === 'creation-brief' ? '外部对话的创作任务' : '外部对话的内容回复'}</p>
      <div className="pub-source-actions">
      <Button size="sm" variant="outline" disabled={busy || operation || origin.sourceSessionAvailable === false} onClick={() => { void onReturn(origin.source.sessionId).catch(cause => setError(errorMessage(cause))) }}>返回来源对话</Button>
      {origin.source.kind !== 'creation-brief' && <Button size="sm" variant="outline" disabled={busy || operation} onClick={() => setRefresh(value => value + 1)}>检查原稿更新</Button>}
      {origin.source.kind !== 'creation-brief' && origin.sourceChanged && origin.sourceAvailable && origin.updateReady && origin.sourceSessionAvailable !== false && <Button size="sm" variant="outline" disabled={busy || operation} onClick={() => setConfirm(true)}>更新正文和配图</Button>}
      </div>
    {origin.instructions && <p><strong>发布要求：</strong>{origin.instructions}</p>}
    {origin.creationBrief && <p><strong>创作需求：</strong>{origin.creationBrief}</p>}
    {origin.sourceSessionAvailable === false && <p role="status">来源对话已删除或归档，发布草稿可以继续编辑。</p>}
    {origin.source.kind !== 'creation-brief' && origin.sourceChanged && <p role="status">原稿已更新，当前发布稿保留你已有的编辑。</p>}
    {origin.source.kind !== 'creation-brief' && origin.sourceChanged && origin.sourceAvailable && !origin.updateReady && origin.sourceSessionAvailable !== false && <p>请返回来源对话重新转交最新原稿，查看新版本后再更新发布稿。</p>}
    {origin.source.kind !== 'creation-brief' && !origin.sourceAvailable && <p role="status">原稿已不可用，发布稿中的内容和配图仍可使用。</p>}
    {confirm && <div className="pub-source-confirm" role="group" aria-label="确认更新原稿"><p>更新将替换发布主稿的标题、正文，并导入新配图。原有素材和平台版本保留。请确认已审阅原稿的新版本。</p>
      <div className="pub-source-actions"><Button size="sm" variant="outline" disabled={operation} onClick={() => setConfirm(false)}>保留当前发布稿</Button>
      <Button size="sm" variant="primary" disabled={busy || operation} onClick={() => void update()}>{operation ? '正在更新…' : '确认更新原稿'}</Button>
      </div>
    </div>}
    {error && <p role="alert">{error}</p>}
    </div>
  </details>
}
