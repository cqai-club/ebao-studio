// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AgentPublicationRequest } from '../src/agent-publication-protocol.ts'
import { AgentPublicationToolView } from '../src/client/agent-publication-card.tsx'
import { AgentPublicationTurnTail, publicationRequestIds } from '../src/client/agent-publication-turn-tail.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
  Modal: () => null,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('../src/client/shared.tsx', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/shared.tsx')>(), api: vi.fn(),
}))

const queryApi = api as unknown as Mock
let container: HTMLDivElement
let root: Root | undefined

function result(requestId: string, options: { name?: string; failed?: boolean; subCalls?: ToolResultNode[] } = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 10, time: 10, callId: `call-${requestId}`,
    call: { name: options.name ?? 'publisher_request_publication', argsRaw: '{}' }, callTime: 9,
    content: [{ type: 'text', text: JSON.stringify({ request_id: requestId }) }], isError: !!options.failed,
    subCalls: options.subCalls ?? [],
  }
}

function snapshot(requestId = 'request-1', sessionId = 'session-1', state: AgentPublicationRequest['state'] = 'awaiting-confirmation'): AgentPublicationRequest {
  return {
    requestId, sessionId, callId: `call-${requestId}`, state,
    createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z',
    content: {
      id: 'content-1', contentType: 'article', revision: 1,
      createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z',
      title: '发布确认验收文章', body: '完整待核对正文', summary: '', tags: [], creativeStatement: 'none', assets: [],
      platformFields: { juejin: { category: '前端' } },
    },
    accounts: [
      { id: 'account-1', platform: 'juejin', displayName: '发布账号一', loginState: 'logged-in' },
      { id: 'account-2', platform: 'juejin', displayName: '发布账号二', loginState: 'logged-in' },
    ],
    capabilities: [{ platform: 'juejin', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} }],
    requestedPlatforms: ['juejin'], accountIds: ['account-1'], mode: 'draft', errors: [], warnings: [],
  }
}

function chat() {
  const sources = new Map<number, ReturnType<typeof source>>()
  function source() {
    let rows: readonly ToolChatData[] = []
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => rows,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      set: (next: readonly ToolChatData[]) => { rows = next; listeners.forEach(listener => listener()) },
    }
  }
  const turnSource = (turn: number) => {
    let existing = sources.get(turn)
    if (!existing) { existing = source(); sources.set(turn, existing) }
    return existing
  }
  const nodes = { turnDataSource: vi.fn((turn: number, kind: string) => {
    if (kind !== 'tool-call') throw new Error(`Unexpected turn data kind: ${kind}`)
    return turnSource(turn)
  }) }
  return {
    nodes, turnSource,
    useChat: ((selector: (value: { nodes: typeof nodes }) => unknown) => selector({ nodes })) as ComponentProps<typeof AgentPublicationTurnTail>['useChat'],
  }
}

function tailProps(current: ReturnType<typeof chat>, turn = 1, sessionId = 'session-1'): ComponentProps<typeof AgentPublicationTurnTail> {
  return { sessionId, turn: { turn, status: 'closed' }, seq: 99, useChat: current.useChat, openFile: vi.fn() } as ComponentProps<typeof AgentPublicationTurnTail>
}

async function render(element: ReactNode) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => { root!.render(element) })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!found) throw new Error(`Button not found: ${label}`)
  return found
}

async function click(label: string) { await act(async () => { button(label).click() }) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  queryApi.mockReset()
  queryApi.mockResolvedValue(snapshot())
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  vi.unstubAllGlobals()
})

describe('publication confirmation in the official Turn tail', () => {
  it('selects only successful Publisher locators from paired root and nested Tool results and deduplicates them', () => {
    const rows: ToolChatData[] = [
      { root: result('request-1') }, { root: result('request-1') },
      { root: result('unrelated', { name: 'other_tool' }) },
      { root: result('failed', { failed: true }) },
      { root: result('outer', { name: 'execute', subCalls: [result('request-2'), result('request-1')] }) },
      { root: { ...result('malformed'), content: [{ type: 'text', text: 'not json' }] } },
    ]
    expect(publicationRequestIds(rows)).toEqual(['request-1', 'request-2'])
  })

  it('renders one visible confirmation outside a folded Tool process and loads only authoritative GET state', async () => {
    const current = chat()
    const block = result('request-1')
    current.turnSource(1).set([{ root: block }, { root: block }])
    await render(<>
      <div hidden data-tool-process="folded"><AgentPublicationToolView {...{
        phase: 'result', sessionId: 'session-1', block,
      } as ComponentProps<typeof AgentPublicationToolView>}/></div>
      <AgentPublicationTurnTail {...tailProps(current)}/>
    </>)
    expect(container.querySelector('[data-tool-process]')?.textContent).toContain('本轮回复下方核对后确认')
    expect(container.querySelector('[data-tool-process] [aria-label="Agent 发布确认"]')).toBeNull()
    const cards = container.querySelectorAll('[aria-label="Agent 发布确认"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].closest('[hidden]')).toBeNull()
    expect(container.textContent).toContain('完整待核对正文')
    expect(queryApi).toHaveBeenCalledOnce()
    expect(queryApi).toHaveBeenCalledWith('agent-publication/session-1/request-1')
    expect(current.nodes.turnDataSource).toHaveBeenCalledWith(1, 'tool-call')
    expect(button('确认转存草稿').disabled).toBe(false)
  })

  it('subscribes to the owning Turn, handles settlement updates and avoids leaking other Turns', async () => {
    const current = chat()
    current.turnSource(2).set([{ root: result('other-turn') }])
    await render(<AgentPublicationTurnTail {...tailProps(current)}/>)
    expect(container.textContent).toBe('')
    expect(queryApi).not.toHaveBeenCalled()
    await act(async () => { current.turnSource(1).set([{ root: result('request-1') }]) })
    expect(container.textContent).toContain('发布确认验收文章')
    expect(queryApi).toHaveBeenCalledOnce()
    await act(async () => { current.turnSource(2).set([{ root: result('other-turn-new') }]) })
    expect(queryApi).toHaveBeenCalledOnce()
    await render(<AgentPublicationTurnTail {...tailProps(current, 3)}/>)
    expect(container.textContent).toBe('')
    await act(async () => { current.turnSource(1).set([{ root: result('late-old-turn') }]) })
    expect(container.textContent).toBe('')
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('replays a locator after remount and reads the latest cancelled state instead of persisted pending copy', async () => {
    const current = chat()
    current.turnSource(1).set([{ root: result('request-1') }])
    await render(<AgentPublicationTurnTail {...tailProps(current)}/>)
    expect(container.textContent).toContain('待你确认')
    await render(null)
    queryApi.mockResolvedValue(snapshot('request-1', 'session-1', 'cancelled'))
    await render(<AgentPublicationTurnTail {...tailProps(current)}/>)
    expect(container.textContent).toContain('已取消本次发布')
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.startsWith('确认'))).toBe(false)
    expect(queryApi.mock.calls.every((call: unknown[]) => call.length === 1)).toBe(true)
    expect(queryApi).toHaveBeenCalledTimes(2)
  })

  it('uses the selected Session identity after switching and ignores a previous in-flight read', async () => {
    const first = chat()
    const second = chat()
    first.turnSource(1).set([{ root: result('request-1') }])
    second.turnSource(1).set([{ root: result('request-1') }])
    let finish!: (value: AgentPublicationRequest) => void
    queryApi.mockImplementation((action: string) => action.includes('/session-1/')
      ? new Promise<AgentPublicationRequest>(resolve => { finish = resolve })
      : Promise.resolve(snapshot('request-1', 'session/2', 'cancelled')))
    await render(<AgentPublicationTurnTail {...tailProps(first)}/>)
    await render(<AgentPublicationTurnTail {...tailProps(second, 1, 'session/2')}/>)
    expect(queryApi).toHaveBeenCalledWith('agent-publication/session%2F2/request-1')
    expect(container.textContent).toContain('已取消本次发布')
    await act(async () => { finish(snapshot()) })
    expect(container.textContent).toContain('已取消本次发布')
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.startsWith('确认'))).toBe(false)
  })

  it('changes choices locally and submits only after an explicit visible confirmation click', async () => {
    const current = chat()
    current.turnSource(1).set([{ root: result('request-1') }])
    queryApi.mockImplementation((action: string) => Promise.resolve(action === 'agent-publication-cancel'
      ? snapshot('request-1', 'session-1', 'cancelled') : snapshot()))
    await render(<AgentPublicationTurnTail {...tailProps(current)}/>)
    const selected = container.querySelector('input[value="account-2"]') as HTMLInputElement
    await act(async () => { selected.click() })
    expect(queryApi).toHaveBeenCalledOnce()
    await click('确认转存草稿')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-confirm', {
      sessionId: 'session-1', requestId: 'request-1', accountIds: ['account-2'], mode: 'draft',
    })
    await click('取消本次发布')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-cancel', { sessionId: 'session-1', requestId: 'request-1' })
    expect(container.textContent).toContain('已取消本次发布')
  })
})
