// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArticleHandoffCard, ArticleSourceControls, parseArticleHandoffId } from '../src/client/article-handoff-card.tsx'
import type { PublisherArticleHandoff, PublisherArticleHandoffResult } from '../src/article-handoff-protocol.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: ({ children, size: _size, variant: _variant, ...props }: Record<string, unknown> & { children?: ReactNode }) => <button {...props}>{children}</button> }))
vi.mock('../src/client/shared.tsx', () => ({ errorMessage: (error: unknown) => error instanceof Error ? error.message : '操作失败' }))
const id = 'e49579e2-5810-458d-b6f4-d5617f85ebea'
const prepared: PublisherArticleHandoff = { handoffId: id, title: '文章原稿', excerpt: '原稿内容', platforms: ['wxmp'], instructions: '保持口语风格', source: { kind: 'markdown', sessionId: 'outside', sourceId: 'source-id', revision: 'revision', fileName: 'article.md' }, sourceAvailable: true, sourceChanged: false }
const opened: PublisherArticleHandoffResult = { handoff: { ...prepared, contentId: 'content-1' }, sourceChanged: false, content: { id: 'content-1', contentType: 'article', workflowVersion: 2, revision: 1, title: prepared.title, body: prepared.excerpt, summary: '', tags: [], creativeStatement: 'none', assets: [], platformFields: {}, createdAt: '', updatedAt: '' } }
let root: Root | undefined, container: HTMLDivElement
const fetcher = vi.fn<typeof fetch>()
const response = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response
async function render(node: ReactNode) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await act(async () => { root!.render(node) })
}
async function click(label: string) { await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click() }) }
async function expandSource() {
  const source = container.querySelector<HTMLDetailsElement>('.pub-source-card')!
  expect(source.open).toBe(false)
  await act(async () => { source.querySelector('summary')!.click() })
  expect(source.open).toBe(true)
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetcher); fetcher.mockReset().mockImplementation(async (_url, init) => response(init?.method === 'POST' ? opened : prepared)) })
afterEach(async () => { await act(async () => { root?.unmount() }); container?.remove(); root = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('article transfer card', () => {
  it('accepts only a successful persisted transfer handle', () => {
    expect(parseArticleHandoffId({ content: [{ type: 'text', text: JSON.stringify({ handoff_id: id }) }] })).toBe(id)
    expect(parseArticleHandoffId({ isError: true, content: [{ type: 'text', text: JSON.stringify({ handoff_id: id }) }] })).toBeNull()
    expect(parseArticleHandoffId({ content: [{ type: 'text', text: '{"handoff_id":"../unsafe"}' }] })).toBeNull()
  })
  it('does not create a draft until clicked, then navigates using the server result', async () => {
    const onOpen = vi.fn(), navigation = new AbortController()
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => navigation.signal} onOpen={onOpen}/>)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('文章原稿')
    expect(container.textContent).toContain('微信公众号')
    expect(container.textContent).not.toContain(prepared.excerpt)
    expect(container.textContent).not.toContain(prepared.instructions)
    await click('打开草稿')
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({ sessionId: 'outside', handoffId: id })
    expect(fetcher.mock.calls[1]![1]!.headers).toMatchObject({ 'x-ejianbao': '1' })
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(opened)
  })
  it('ignores a late response after later navigation', async () => {
    const pending = deferred<Response>(), navigation = new AbortController(), onOpen = vi.fn()
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => navigation.signal} onOpen={onOpen}/>)
    fetcher.mockReturnValue(pending.promise)
    await click('打开草稿')
    navigation.abort()
    await act(async () => { pending.resolve(response(opened)) })
    expect(onOpen).not.toHaveBeenCalled()
  })
  it('rejects a card or open result owned by another conversation', async () => {
    const onOpen = vi.fn()
    fetcher.mockResolvedValue(response({ ...prepared, source: { ...prepared.source, sessionId: 'different' } }))
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => new AbortController().signal} onOpen={onOpen}/>)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('不匹配')
    expect(container.querySelector('button')).toBeNull()
    expect(onOpen).not.toHaveBeenCalled()
  })
  it('can transfer the retained snapshot after the original file is removed', async () => {
    fetcher.mockImplementation(async (_url, init) => response(init?.method === 'POST' ? opened : { ...prepared, sourceAvailable: false }))
    const onOpen = vi.fn()
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => new AbortController().signal} onOpen={onOpen}/>)
    expect(container.textContent).toContain('文章副本仍可转交')
    await click('打开草稿')
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('opens an image-note delegation without recreating an article-shaped copy', async () => {
    const value = { ...opened, content: { ...opened.content, contentType: 'image-note' as const } }
    fetcher.mockImplementation(async (_url, init) => response(init?.method === 'POST' ? value : prepared))
    const onOpen = vi.fn()
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => new AbortController().signal} onOpen={onOpen}/>)
    await click('打开草稿')
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(value)
  })
  it('refreshes compact task status without repeating the Agent reply and then stops polling', async () => {
    vi.useFakeTimers()
    const task = { taskId: 'task-1', handoffId: id, sourceSessionId: 'outside', requestId: 'request', contentId: 'content-1', publisherSessionId: 'publisher-session', createdAt: '', updatedAt: '', status: 'running' as const }
    fetcher.mockResolvedValueOnce(response({ ...prepared, delegation: task }))
      .mockResolvedValue(response({ ...prepared, delegation: { ...task, status: 'completed', summary: '已完成正文与小红书配图说明' } }))
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => new AbortController().signal} onOpen={vi.fn()}/>)
    expect(container.textContent).toContain('处理中')
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(container.textContent).toContain('Agent 已回复')
    expect(container.textContent).not.toContain('已完成正文与小红书配图说明')
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('bounds active progress polling and cancels its timer on unmount', async () => {
    vi.useFakeTimers()
    fetcher.mockResolvedValue(response({ ...prepared, delegation: { status: 'queued' } }))
    await render(<ArticleHandoffCard sessionId="outside" handoffId={id} beginNavigation={() => new AbortController().signal} onOpen={vi.fn()}/>)
    await act(async () => { await vi.advanceTimersByTimeAsync(300000) })
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(61)
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { root!.unmount(); root = undefined })
    expect(fetcher.mock.calls[0][1]!.signal?.aborted).toBe(true)
  })
})

describe('publication source controls', () => {
  it('updates the source only after explicit confirmation and retains a return link', async () => {
    fetcher.mockResolvedValue(response({ ...opened.handoff, sourceChanged: true, updateReady: true }))
    const onReturn = vi.fn().mockResolvedValue(undefined), onUpdate = vi.fn().mockResolvedValue(undefined)
    await render(<ArticleSourceControls contentId="content-1" active busy={false} onReturn={onReturn} onUpdate={onUpdate}/>)
    await expandSource()
    await click('返回来源对话')
    expect(onReturn).toHaveBeenCalledExactlyOnceWith('outside')
    await click('更新正文和配图')
    expect(onUpdate).not.toHaveBeenCalled()
    await click('确认更新原稿')
    expect(onUpdate).toHaveBeenCalledOnce()
  })
  it('keeps the draft usable and disables only returning when the source conversation was deleted', async () => {
    fetcher.mockResolvedValue(response({ ...opened.handoff, sourceSessionAvailable: false, sourceAvailable: false }))
    await render(<ArticleSourceControls contentId="content-1" active busy={false} onReturn={vi.fn()} onUpdate={vi.fn()}/>)
    expect(container.textContent).toContain('发布草稿可以继续编辑')
    expect([...container.querySelectorAll('button')].find(button => button.textContent === '返回来源对话')?.disabled).toBe(true)
    expect(container.textContent).not.toContain('更新正文和配图')
  })
  it('asks to prepare the latest original before offering an update of an unseen revision', async () => {
    fetcher.mockResolvedValue(response({ ...opened.handoff, sourceChanged: true, updateReady: false }))
    await render(<ArticleSourceControls contentId="content-1" active busy={false} onReturn={vi.fn()} onUpdate={vi.fn()}/>)
    expect(container.textContent).toContain('重新转交最新原稿')
    expect(container.textContent).not.toContain('更新正文和配图')
  })
  it('retains confirmation and explains a version conflict so the user can retry', async () => {
    fetcher.mockResolvedValue(response({ ...opened.handoff, sourceChanged: true, updateReady: true }))
    const onUpdate = vi.fn().mockRejectedValue(new Error('发布稿已修改，请重新查看后再更新'))
    await render(<ArticleSourceControls contentId="content-1" active busy={false} onReturn={vi.fn()} onUpdate={onUpdate}/>)
    await expandSource()
    await click('更新正文和配图'); await click('确认更新原稿')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('发布稿已修改')
    expect(container.querySelector('[aria-label="确认更新原稿"]')).not.toBeNull()
  })
  it('shows nothing for an ordinary locally created draft with no source association', async () => {
    fetcher.mockResolvedValue(response(null))
    await render(<ArticleSourceControls contentId="content-1" active busy={false} onReturn={vi.fn()} onUpdate={vi.fn()}/>)
    expect(container.textContent).toBe('')
  })
  it('labels creation briefs as tasks and omits original-prose update actions', async () => {
    fetcher.mockResolvedValue(response({ ...opened.handoff, source: { ...prepared.source, kind: 'creation-brief', requestId: 'original-request' }, creationBrief: '写一篇小红书露营分享，附三张图片建议', sourceChanged: true, updateReady: true }))
    await render(<ArticleSourceControls contentId="content-1" active busy={false} onReturn={vi.fn()} onUpdate={vi.fn()}/>)
    expect(container.textContent).toContain('来自外部对话的创作任务')
    expect(container.textContent).toContain('写一篇小红书露营分享')
    expect(container.textContent).toContain('返回来源对话')
    expect(container.textContent).not.toContain('检查原稿更新')
    expect(container.textContent).not.toContain('更新正文和配图')
    expect(container.textContent).not.toContain('原稿已更新')
  })
})
