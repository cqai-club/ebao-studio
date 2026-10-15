// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PublisherContentType } from '../src/protocol.ts'
import { PublisherChatHistory, type PublisherChatHistoryProps } from '../src/client/agent-panel.tsx'

let root: Root | undefined, container: HTMLDivElement
function selectorHook<T>(getState: () => T) {
  return Object.assign(<S,>(select: (state: T) => S) => select(getState()), { getState })
}
function fixture(contentType: PublisherContentType = 'article') {
  const session = {
    sessionId: 'publisher-session', openState: 'open', blank: true, running: false, removed: false,
    awaitingFirstTurn: false, pendingSubmissions: [], subagent: null, openError: null, hasMore: false,
    loadingOlder: false, promptError: null, promptAttempted: false, lastAgentError: null,
  } as unknown as SessionSnapshot
  const input: InputState = { draft: '', phase: 'plain', attachmentIds: [], draftRev: 0, occurrences: [], queue: [] }
  const inbox = { 'next-turn': [] as unknown[], 'next-step': [] as unknown[] }
  let inboxReady = true
  const nodes: unknown[] = []
  const chat = {
    order: [] as string[], nodes: { values: () => nodes, get: () => undefined },
    locations: { getTurn: () => [], getStep: () => [] }, navigation: { items: () => [] },
    timeline: { turnOrder: [] as number[], turns: new Map() },
    legacy: { nodes: [], turnEnds: new Map(), turnTimings: new Map(), partial: null, runningCalls: [] },
  } as unknown as ChatSnapshot
  const submitted: string[] = []
  const inputActions = {
    setDraft: vi.fn((text: string) => { (input as { draft: string }).draft = text }),
    submit: vi.fn(() => {
      submitted.push(input.draft)
      ;(input as { draft: string }).draft = ''
      ;(session as unknown as { pendingSubmissions: unknown[] }).pendingSubmissions = [{ requestId: 'accepted-request' }]
    }),
  }
  const renderSlot = vi.fn(() => <div data-native-transcript>原生对话区域</div>)
  const props = {
    contentType, sessionId: session.sessionId, renderSlot,
    useSession: selectorHook(() => session),
    useChat: selectorHook(() => chat),
    useInput: selectorHook(() => input),
    useProjection: (_key: string, select?: (state: typeof inbox | undefined) => unknown) => {
      const value = inboxReady ? inbox : undefined
      return select ? select(value) : value
    },
    inputActions,
  } as unknown as PublisherChatHistoryProps
  return { props, session, input, inbox, nodes, chat, inputActions, submitted, renderSlot,
    setInboxReady: (value: boolean) => { inboxReady = value } }
}
async function render(props: PublisherChatHistoryProps) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await act(async () => { root!.render(<PublisherChatHistory {...props}/>) })
}
function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(item => item.querySelector('.pub-agent-shortcut-copy > span')?.textContent === label)
  if (!result) throw new Error(`Shortcut not found: ${label}`)
  return result
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => { await act(async () => { root?.unmount() }); container?.remove(); root = undefined; vi.unstubAllGlobals() })

describe('empty Publisher Agent media shortcuts', () => {
  it.each([
    ['article', '帮我写一篇文章', '/publisher-write-article'],
    ['article', '整理素材成文', '/publisher-write-article'],
    ['article', '为文章配图', '/publisher-illustrate-article'],
    ['image-note', '写小红书图文', '/publisher-write-article'],
    ['image-note', '写抖音图文', '/publisher-write-article'],
    ['image-note', '整理图文素材', '/publisher-edit-draft'],
    ['video', '准备视频文案', '/publisher-edit-draft'],
    ['video', '选择已有成片', '/publisher-edit-draft'],
    ['video', '整理发布信息', '/publisher-edit-draft'],
  ] as const)('shows %s actions and immediately sends its native scoped Skill request once', async (contentType, label, skill) => {
    const host = fixture(contentType)
    await render(host.props)
    expect(container.querySelectorAll('button')).toHaveLength(3)
    expect(container.querySelector('[data-native-transcript]')).not.toBeNull()
    await act(async () => { const action = button(label); action.click(); action.click() })
    expect(host.inputActions.setDraft).toHaveBeenCalledOnce()
    expect(host.inputActions.setDraft.mock.calls[0][0]).toMatch(new RegExp(`^${skill}\\s+\\S`))
    expect(host.inputActions.submit).toHaveBeenCalledOnce()
    expect(host.submitted).toEqual([host.inputActions.setDraft.mock.calls[0][0]])
    await render(host.props)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('switches action sets when the content type changes and keeps the transcript delegation', async () => {
    const host = fixture()
    await render(host.props)
    expect(button('帮我写一篇文章')).toBeDefined()
    await render({ ...host.props, contentType: 'image-note' })
    expect(button('写小红书图文')).toBeDefined()
    expect(container.textContent).not.toContain('帮我写一篇文章')
    await render({ ...host.props, contentType: 'video' })
    expect(button('准备视频文案')).toBeDefined()
    expect(container.textContent).not.toContain('写小红书图文')
    expect(host.renderSlot).toHaveBeenLastCalledWith('conversation.session', { view: 'chat' })
    expect(host.inputActions.submit).not.toHaveBeenCalled()
  })

  it.each(['nonblank', 'history-order', 'history-node', 'history-turn', 'loading', 'has-more', 'running', 'removed', 'awaiting', 'pending-submission', 'queue', 'next-turn', 'next-step', 'inbox-unknown', 'attachment', 'typed-input', 'claimed', 'adjudicating', 'submitting'] as const)
    ('omits actions for %s while preserving the DS transcript', async condition => {
      const host = fixture()
      const session = host.session as unknown as Record<string, unknown>
      const input = host.input as unknown as Record<string, unknown>
      switch (condition) {
        case 'nonblank': session.blank = false; break
        case 'history-order': (host.chat.order as string[]).push('assistant-history'); break
        case 'history-node': host.nodes.push({ kind: 'assistant-step' }); break
        case 'history-turn': (host.chat.timeline.turnOrder as number[]).push(1); break
        case 'loading': session.openState = 'loading'; break
        case 'has-more': session.hasMore = true; break
        case 'running': session.running = true; break
        case 'removed': session.removed = true; break
        case 'awaiting': session.awaitingFirstTurn = true; break
        case 'pending-submission': session.pendingSubmissions = [{ requestId: 'pending' }]; break
        case 'queue': input.queue = [{ id: 'queued' }]; break
        case 'next-turn': host.inbox['next-turn'].push({ id: 'queued' }); break
        case 'next-step': host.inbox['next-step'].push({ id: 'steering' }); break
        case 'inbox-unknown': host.setInboxReady(false); break
        case 'attachment': input.attachmentIds = ['attachment-1']; break
        case 'typed-input': input.draft = '尚未发送的用户内容'; break
        default: input.phase = condition
      }
      await render(host.props)
      expect(container.querySelectorAll('button')).toHaveLength(0)
      expect(container.querySelector('[data-native-transcript]')).not.toBeNull()
      expect(host.inputActions.setDraft).not.toHaveBeenCalled()
      expect(host.inputActions.submit).not.toHaveBeenCalled()
    })

  it('shows a synchronous preparation failure and permits retry without inventing another Session', async () => {
    const host = fixture()
    host.inputActions.setDraft.mockImplementationOnce(() => { throw new Error('输入组件暂未就绪') })
    await render(host.props)
    await act(async () => { button('帮我写一篇文章').click() })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('暂时无法开始，请重试或在下方输入需求。')
    expect(host.inputActions.submit).not.toHaveBeenCalled()
    await act(async () => { button('帮我写一篇文章').click() })
    expect(host.inputActions.setDraft).toHaveBeenCalledTimes(2)
    expect(host.inputActions.submit).toHaveBeenCalledOnce()
    expect(host.submitted[0]).toMatch(/^\/publisher-write-article\s/u)
  })

  it('preserves the prepared draft on a submission failure and shows feedback until the user retries', async () => {
    const host = fixture()
    host.inputActions.submit.mockImplementationOnce(() => { throw new Error('提交组件暂未就绪') })
    await render(host.props)
    await act(async () => { button('帮我写一篇文章').click() })
    expect(host.input.draft).toBe(host.inputActions.setDraft.mock.calls[0][0])
    expect(host.submitted).toEqual([])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('暂时无法开始，请重试或在下方输入需求。')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    ;(host.input as { draft: string }).draft = ''
    await render(host.props)
    await act(async () => { button('帮我写一篇文章').click() })
    expect(host.inputActions.submit).toHaveBeenCalledTimes(2)
    expect(host.submitted).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('hides suggestions after the user begins typing, then restores them only when the draft is empty again', async () => {
    const host = fixture()
    await render(host.props)
    ;(host.input as { draft: string }).draft = '我想自己输入的要求'
    await render(host.props)
    expect(container.querySelectorAll('button')).toHaveLength(0)
    ;(host.input as { draft: string }).draft = ''
    await render(host.props)
    expect(container.querySelectorAll('button')).toHaveLength(3)
    expect(host.inputActions.setDraft).not.toHaveBeenCalled()
  })
})
