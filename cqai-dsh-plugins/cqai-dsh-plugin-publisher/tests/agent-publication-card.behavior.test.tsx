// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentPublicationRequest } from '../src/agent-publication-protocol.ts'
import { API, type PublisherVideoSource } from '../src/protocol.ts'
import { AgentPublicationCard, AgentPublicationToolView, parseAgentPublicationRequestId } from '../src/client/agent-publication-card.tsx'
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

function publication(overrides: Partial<AgentPublicationRequest> = {}): AgentPublicationRequest {
  return {
    requestId: 'request-1', sessionId: 'session-1', callId: 'call-1',
    createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z',
    state: 'awaiting-confirmation',
    content: {
      id: 'content-1', contentType: 'article', revision: 3,
      createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z',
      title: '周末徒步攻略', body: '# 完整正文\n\n主稿正文内容', summary: '', tags: [],
      creativeStatement: 'none', assets: [], platformFields: { juejin: { category: '前端' } },
      platformVariants: { juejin: { title: '掘金平台标题', body: '# 平台全文\n\n掘金版本正文' } },
    },
    accounts: [
      { id: 'juejin-a', displayName: '掘金主账号', platform: 'juejin', loginState: 'logged-in' },
      { id: 'juejin-b', displayName: '掘金备用账号', platform: 'juejin', loginState: 'logged-in' },
      { id: 'tt-a', displayName: '头条账号', platform: 'tt', loginState: 'logged-in' },
      { id: 'juejin-out', displayName: '未登录账号', platform: 'juejin', loginState: 'logged-out' },
      { id: 'xhs-unsupported', displayName: '小红书账号', platform: 'xhs', loginState: 'logged-in' },
    ],
    capabilities: [
      { platform: 'juejin', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} },
      { platform: 'tt', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} },
      { platform: 'xhs', contentTypes: ['image-note'], modes: { 'image-note': ['publish', 'draft'] }, requiredFields: {} },
    ],
    requestedPlatforms: ['juejin'], accountIds: ['juejin-a'], mode: 'publish', warnings: [], errors: [],
    ...overrides,
  }
}

function accepted(state: 'queued' | 'running' | 'completed' | 'failed' | 'unknown' = 'queued'): AgentPublicationRequest {
  return publication({
    state: 'submitted', submission: {
      id: 'submission-1', contentId: 'content-1', contentType: 'article', title: '周末徒步攻略', mode: 'publish',
      createdAt: '2026-10-05T00:00:00.000Z', state,
      targets: [{ accountId: 'juejin-a', platform: 'juejin', accountName: '掘金主账号' }],
      message: state === 'failed' ? '平台登录已过期' : undefined,
    },
  })
}

function videoPublication(source?: PublisherVideoSource): AgentPublicationRequest {
  const value = publication({
    accounts: [{ id: 'dy-a', displayName: '抖音视频账号', platform: 'dy', loginState: 'logged-in' }],
    capabilities: [{ platform: 'dy', contentTypes: ['video'], modes: { video: ['publish', 'draft'] }, requiredFields: {} }],
    requestedPlatforms: ['dy'], accountIds: ['dy-a'],
  })
  value.content = {
    ...value.content, contentType: 'video', body: '', summary: '', platformVariants: {}, platformFields: {},
    title: '徒步视频', description: '一段视频简介', shortTitle: '周末徒步', tags: ['徒步'],
    creativeStatement: 'ai_generated', ...(source ? { videoSource: source } : {}),
  }
  return value
}

function toolProps(requestId = 'request-1', sessionId = 'session-1'): ComponentProps<typeof AgentPublicationToolView> {
  return {
    phase: 'result', sessionId, callId: 'call-1', toolName: 'publisher_request_publication',
    block: {
      kind: 'tool-result', callId: 'call-1', call: { name: 'publisher_request_publication', argsRaw: '{}' },
      content: [{ type: 'text', text: JSON.stringify({ request_id: requestId, state: 'awaiting-confirmation' }) }], isError: false,
    },
  } as ComponentProps<typeof AgentPublicationToolView>
}

async function renderTool(props = toolProps(), strict = false) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const requestId = props.phase === 'result' ? parseAgentPublicationRequestId(props.block) : null
  const element = requestId
    ? <AgentPublicationCard key={`${props.sessionId}/${requestId}`} sessionId={props.sessionId} requestId={requestId}/>
    : <AgentPublicationToolView {...props}/>
  await act(async () => {
    root!.render(strict ? <StrictMode>{element}</StrictMode> : element)
  })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!found) throw new Error(`Button not found: ${label}`)
  return found
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

async function selectAccount(accountId: string) {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(item => item.value === accountId)
  if (!input) throw new Error(`Account radio not found: ${accountId}`)
  await act(async () => { input.click() })
}

async function select(label: string, value: string) {
  const fieldLabel = Array.from(container.querySelectorAll<HTMLLabelElement>('label')).find(item => item.textContent === label)
  const input = fieldLabel ? document.getElementById(fieldLabel.htmlFor) as HTMLSelectElement : null
  if (!input) throw new Error(`Select not found: ${label}`)
  await act(async () => {
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  queryApi.mockReset()
  queryApi.mockResolvedValue(publication())
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Agent publication tool card', () => {
  it('uses a successful JSON tool result as a locator and rejects failed or malformed results', () => {
    expect(parseAgentPublicationRequestId({ content: [{ type: 'text', text: '{"request_id":"request-1"}' }] })).toBe('request-1')
    expect(parseAgentPublicationRequestId({ content: [{ type: 'text', text: '{"requestId":"request-2"}' }] })).toBe('request-2')
    expect(parseAgentPublicationRequestId({ isError: true, content: [{ type: 'text', text: '{"request_id":"request-1"}' }] })).toBeNull()
    expect(parseAgentPublicationRequestId({ content: [{ type: 'text', text: '{"request_id":"../other"}' }] })).toBeNull()
    expect(parseAgentPublicationRequestId({ content: [{ type: 'text', text: 'not json' }] })).toBeNull()
  })

  it('loads the latest request and shows complete main and platform previews without submitting', async () => {
    await renderTool()
    expect(queryApi).toHaveBeenCalledOnce()
    expect(queryApi).toHaveBeenCalledWith('agent-publication/session-1/request-1')
    expect(container.querySelector('[aria-label="Agent 发布确认"]')).not.toBeNull()
    expect(container.textContent).toContain('完整正文')
    expect(container.textContent).toContain('主稿正文内容')
    expect(container.textContent).toContain('待你确认')
    expect(button('确认发布').disabled).toBe(false)
    await select('预览版本', 'juejin')
    expect(container.textContent).toContain('掘金平台标题')
    expect(container.textContent).toContain('掘金版本正文')
    expect(container.textContent).toContain('分类')
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('keeps card layout styles owned by Publisher when another client module is materialized and unloaded', async () => {
    await renderTool()
    const card = container.querySelector<HTMLElement>('[aria-label="Agent 发布确认"]')!
    const style = card.querySelector<HTMLStyleElement>('style')!
    expect(style.dataset.plugin).toBe('cqai-dsh-plugin-publisher')
    expect(style.dataset.pluginCss).toBe('cqai-dsh-plugin-publisher/agent-publication-card')
    const foreign = document.createElement('style')
    foreign.textContent = '.foreign-module-test { display: block; }'
    document.head.append(foreign)
    // The official loader claims only unowned styles, then removes its own styles on HMR teardown.
    document.querySelectorAll<HTMLStyleElement>('style:not([data-plugin])').forEach(sheet => { sheet.dataset.plugin = 'foreign-module-test' })
    document.querySelectorAll<HTMLStyleElement>('style[data-plugin="foreign-module-test"]').forEach(sheet => sheet.remove())
    expect(style.isConnected).toBe(true)
    const cardRule = Array.from(style.sheet!.cssRules).find(rule => 'selectorText' in rule && rule.selectorText === '.pub-agent-publication') as CSSStyleRule
    // jsdom cannot resolve inherited font shorthand or CSS variables in border values.
    expect(cardRule.style.getPropertyValue('font-size')).toBe('13px')
    expect(cardRule.style.getPropertyValue('border')).toBe('1px solid var(--pub-border)')
    const computed = getComputedStyle(card)
    expect(computed.display).toBe('grid')
    expect(computed.paddingTop).toBe('14px')
    const targets = card.querySelector<HTMLElement>('.pub-agent-publication-targets')!
    expect(getComputedStyle(targets).paddingTop).toBe('0px')
    expect(getComputedStyle(card.querySelector('header')!).display).toBe('flex')
    expect(getComputedStyle(card.querySelector('.pub-agent-publication-platform label')!).display).toBe('grid')
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('changes one account per platform and mode locally, then confirms only opaque identifiers', async () => {
    queryApi.mockImplementation((route: string) => Promise.resolve(route === 'agent-publication-confirm' ? accepted() : publication({ requestedPlatforms: [] })))
    await renderTool()
    await selectAccount('juejin-b')
    expect((container.querySelector('input[value="juejin-a"]') as HTMLInputElement).checked).toBe(false)
    expect((container.querySelector('input[value="juejin-b"]') as HTMLInputElement).checked).toBe(true)
    await selectAccount('tt-a')
    await select('提交方式', 'draft')
    expect(queryApi).toHaveBeenCalledOnce()
    await click('确认转存草稿')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-confirm', {
      sessionId: 'session-1', requestId: 'request-1', accountIds: ['juejin-b', 'tt-a'], mode: 'draft',
    })
    const payload = queryApi.mock.calls.find((call: unknown[]) => call[0] === 'agent-publication-confirm')![1]
    expect(Object.keys(payload).sort()).toEqual(['accountIds', 'mode', 'requestId', 'sessionId'])
    expect(JSON.stringify(payload)).not.toMatch(/cookie|filePath|videoPath|body|partition|\//u)
    expect(container.textContent).toContain('已进入本机提交队列')
    expect(container.querySelector('button')?.textContent).toBe('刷新状态')
  })

  it('shows account choices only for the requested platforms', async () => {
    await renderTool()
    expect(container.querySelector('.pub-agent-publication-targets input[value="juejin-a"]')).not.toBeNull()
    expect(container.querySelector('.pub-agent-publication-targets input[value="tt-a"]')).toBeNull()
    expect(container.querySelector('.pub-agent-publication-targets input[value="xhs-unsupported"]')).toBeNull()
    expect(button('确认发布').disabled).toBe(false)
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('blocks logged-out and unsupported accounts, and requires an account for every requested platform', async () => {
    queryApi.mockResolvedValue(publication({ requestedPlatforms: ['juejin', 'tt'] }))
    await renderTool()
    expect((container.querySelector('input[value="juejin-out"]') as HTMLInputElement).disabled).toBe(true)
    expect(container.querySelector('input[value="xhs-unsupported"]')).toBeNull()
    expect(container.textContent).toContain('未登录')
    expect(container.textContent).toContain('请为头条选择一个账号')
    expect(button('确认发布').disabled).toBe(true)
    await selectAccount('tt-a')
    expect(button('确认发布').disabled).toBe(false)
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('shows unsupported accounts only when their platform was requested and blocks confirmation', async () => {
    queryApi.mockResolvedValue(publication({ requestedPlatforms: ['xhs'], accountIds: [] }))
    await renderTool()
    expect((container.querySelector('input[value="xhs-unsupported"]') as HTMLInputElement).disabled).toBe(true)
    expect(container.textContent).toContain('暂不支持此内容类型')
    expect(button('确认发布').disabled).toBe(true)
    expect(container.querySelector('input[value="juejin-a"]')).toBeNull()
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('shows article adjustments and explicitly confirms the effective draft mode', async () => {
    const value = publication({ accountIds: ['tt-a'], requestedPlatforms: ['tt'] })
    value.content = { ...value.content, body: '正文 ![图片](https://example.com/image.png)', summary: '本地摘要' }
    queryApi.mockImplementation((route: string) => Promise.resolve(route === 'agent-publication-confirm'
      ? { ...accepted(), mode: 'draft' } : value))
    await renderTool()
    expect(container.textContent).toContain('从发布历史打开头条草稿手动补图')
    expect(container.textContent).not.toContain('独立摘要不会写入头条文章')
    expect(container.textContent).toContain('本次实际提交方式：转存草稿')
    expect(container.textContent).toContain('将整批转存草稿供你核对')
    await click('确认转存草稿')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-confirm', {
      sessionId: 'session-1', requestId: 'request-1', accountIds: ['tt-a'], mode: 'draft',
    })
  })

  it('does not force a Toutiao draft or show skipped-summary/tag notices from an old response', async () => {
    const value = publication({ accountIds: ['tt-a'], requestedPlatforms: ['tt'],
      warnings: ['头条：独立摘要不会写入头条文章', '头条：文章标签暂不写入该平台'] })
    value.content = { ...value.content, summary: '本地摘要', tags: ['本地标签'] }
    queryApi.mockResolvedValue(value)
    await renderTool()
    expect(container.textContent).toContain('本次实际提交方式：立即发布')
    expect(container.textContent).not.toMatch(/独立摘要不会写入|标签暂不写入|整批转存草稿/u)
    expect(button('确认发布').disabled).toBe(false)
    await select('预览版本', 'tt')
    expect(container.querySelector('.pub-agent-publication-summary')).toBeNull()
    await click('确认发布')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-confirm', {
      sessionId: 'session-1', requestId: 'request-1', accountIds: ['tt-a'], mode: 'publish',
    })
  })

  it.each(['unknown', 'failed'] as const)('shows a Toutiao %s timeout as unfinished without a repeat-confirm action', async state => {
    const value = accepted(state)
    value.requestedPlatforms = ['tt']
    value.accountIds = ['tt-a']
    value.submission = { ...value.submission!, targets: [{ accountId: 'tt-a', platform: 'tt', accountName: '头条账号' }],
      message: 'Waiting failed: 45000ms exceeded；窗口已保留；账号已锁定',
      adjustments: [{ accountId: 'tt-a', messages: ['该平台文章适配器暂不写入标签；标签仍保留在本地草稿'] }],
    }
    const stored = JSON.stringify(value)
    queryApi.mockResolvedValue(value)
    await renderTool()
    expect(container.textContent).toContain('操作超时，任务未完成')
    expect(container.textContent).not.toMatch(/结果待确认|结果尚未确认|Waiting failed|窗口|锁定|标签仍保留|执行完成/u)
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.startsWith('确认'))).toBe(false)
    expect(JSON.stringify(value)).toBe(stored)
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it.each([
    { kind: 'local', localVideoId: 'local-video-1', fileName: '徒步.mp4', bytes: 1024 },
    { kind: 'work', workId: 'work-1' },
  ] as const)('previews a $kind video through its opaque source and submits only request and account identifiers', async source => {
    const value = videoPublication(source)
    queryApi.mockImplementation((route: string) => Promise.resolve(route === 'agent-publication-confirm'
      ? { ...value, state: 'submitted', submission: { ...accepted().submission!, contentType: 'video' } } : value))
    await renderTool()
    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toBe(`${API}/video-preview/${source.kind}/${source.kind === 'local' ? source.localVideoId : source.workId}`)
    expect(video.controls).toBe(true)
    expect(video.preload).toBe('metadata')
    expect(video.autoplay).toBe(false)
    expect(container.textContent).toContain(source.kind === 'local' ? '徒步.mp4' : 'e剪宝成片')
    expect(container.textContent).toContain('徒步视频')
    expect(container.textContent).toContain('一段视频简介')
    expect(container.textContent).toContain('周末徒步')
    expect(container.textContent).toContain('内容由 AI 生成')
    await click('确认发布')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-confirm', {
      sessionId: 'session-1', requestId: 'request-1', accountIds: ['dy-a'], mode: 'publish',
    })
  })

  it('keeps submitted mode, target names and adjustments authoritative after account or capability changes', async () => {
    const value = accepted('completed')
    value.mode = 'publish'
    value.accounts = [{ id: 'juejin-a', platform: 'juejin', displayName: '后来改名的账号', loginState: 'logged-out' }]
    value.capabilities = []
    value.accountIds = []
    value.submission = {
      ...value.submission!, mode: 'draft', requestedMode: 'publish',
      targets: [
        { accountId: 'juejin-a', platform: 'juejin', accountName: '提交时的掘金账号' },
        { accountId: 'deleted-account', platform: 'tt', accountName: '已删除的头条账号' },
      ],
      adjustments: [{ accountId: 'deleted-account', messages: ['独立摘要未写入平台文章',
        '头条正文已保留 1 处图片占位，请在草稿窗口手动上传'] }],
    }
    queryApi.mockResolvedValue(value)
    await renderTool()
    expect(container.querySelector('.pub-agent-publication-effective')?.textContent).toContain('本次实际提交方式：转存草稿')
    expect(container.querySelector('[aria-label="已提交目标账号"]')?.textContent).toContain('提交时的掘金账号')
    expect(container.querySelector('[aria-label="已提交目标账号"]')?.textContent).toContain('已删除的头条账号')
    expect(container.querySelector('[aria-label="已提交目标账号"]')?.textContent).not.toContain('后来改名的账号')
    expect(container.querySelector('[aria-label="已提交平台调整"]')?.textContent).toContain('已删除的头条账号：头条正文已保留 1 处图片占位，请从发布历史打开草稿手动补图')
    expect(container.textContent).not.toContain('独立摘要未写入平台文章')
    expect(container.querySelector('input[type="radio"]')).toBeNull()

    const after = accepted('completed')
    after.mode = 'draft'
    after.accounts = []
    after.capabilities = []
    after.content = { ...after.content, summary: '当前能力若重算会产生平台调整' }
    after.submission = { ...after.submission!, mode: 'publish', targets: [{ accountId: 'deleted', platform: 'tt', accountName: '提交时的头条账号' }] }
    queryApi.mockResolvedValue(after)
    await click('刷新状态')
    expect(container.querySelector('.pub-agent-publication-effective')?.textContent).toBe('本次实际提交方式：立即发布')
    expect(container.querySelector('[aria-label="已提交目标账号"]')?.textContent).toContain('提交时的头条账号')
  })

  it.each(['completed', 'failed'] as const)('automatically reads queued and running status, then stops at %s without another confirmation', async terminal => {
    vi.useFakeTimers()
    queryApi.mockImplementation((route: string) => Promise.resolve(route === 'agent-publication-confirm' ? accepted('queued') : publication()))
    await renderTool()
    await click('确认发布')
    expect(container.textContent).toContain('已进入本机提交队列')
    queryApi.mockResolvedValueOnce(accepted('running')).mockResolvedValueOnce(accepted(terminal))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(container.textContent).toContain('本机任务正在执行')
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(container.textContent).toContain(terminal === 'completed' ? '本机执行完成，请到平台后台核对' : '本机执行失败')
    const callCount = queryApi.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(queryApi).toHaveBeenCalledTimes(callCount)
    expect(queryApi.mock.calls.filter((call: unknown[]) => call[0] === 'agent-publication-confirm')).toHaveLength(1)
    expect(queryApi.mock.calls.filter((call: unknown[]) => call[0] === 'agent-publication/session-1/request-1')).toHaveLength(3)
  })

  it('polls read-only state once per interval in StrictMode and clears the timer on session change', async () => {
    vi.useFakeTimers()
    queryApi.mockImplementation((route: string) => Promise.resolve(route.endsWith('/request-1') ? accepted('queued')
      : publication({ sessionId: 'session-2', requestId: 'request-2', state: 'cancelled' })))
    await renderTool(toolProps(), true)
    const initialReads = queryApi.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(queryApi).toHaveBeenCalledTimes(initialReads + 1)
    await renderTool(toolProps('request-2', 'session-2'), true)
    const afterSwitch = queryApi.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(queryApi).toHaveBeenCalledTimes(afterSwitch)
    expect(container.textContent).toContain('已取消本次发布')
    expect(queryApi.mock.calls.every((call: unknown[]) => call.length === 1)).toBe(true)
  })

  it('does not start polling uncertain requests or unknown execution results', async () => {
    vi.useFakeTimers()
    queryApi.mockResolvedValue(publication({ state: 'uncertain' }))
    await renderTool()
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(queryApi).toHaveBeenCalledOnce()
    queryApi.mockResolvedValue(accepted('unknown'))
    await click('刷新状态')
    const reads = queryApi.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(queryApi).toHaveBeenCalledTimes(reads)
  })

  it('does not overlap a slow read-only poll and clears pending work on unmount', async () => {
    vi.useFakeTimers()
    const pending = deferred<AgentPublicationRequest>()
    queryApi.mockResolvedValueOnce(accepted('queued')).mockReturnValue(pending.promise)
    await renderTool()
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(queryApi).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(queryApi).toHaveBeenCalledTimes(2)
    await act(async () => { root!.unmount() })
    root = undefined
    await act(async () => { await vi.advanceTimersByTimeAsync(12000) })
    expect(queryApi).toHaveBeenCalledTimes(2)
    await act(async () => { pending.resolve(accepted('completed')) })
    expect(container.textContent).toBe('')
  })

  it('requires the selected video source and platform fields before enabling confirmation', async () => {
    const value = videoPublication()
    value.capabilities[0].requiredFields.video = ['topic']
    queryApi.mockResolvedValue(value)
    await renderTool()
    expect(button('确认发布').disabled).toBe(true)
    expect(container.textContent).toContain('请先选择一条 e剪宝成片或一个本地视频')
    expect(container.textContent).toContain('请填写抖音的话题')
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it('cancels the request without a publication confirmation call', async () => {
    queryApi.mockImplementation((route: string) => Promise.resolve(route === 'agent-publication-cancel'
      ? publication({ state: 'cancelled' }) : publication()))
    await renderTool()
    await click('取消本次发布')
    expect(queryApi).toHaveBeenCalledWith('agent-publication-cancel', { sessionId: 'session-1', requestId: 'request-1' })
    expect(queryApi.mock.calls.some((call: unknown[]) => call[0] === 'agent-publication-confirm')).toBe(false)
    expect(container.textContent).toContain('已取消本次发布')
    expect(container.querySelector('button')?.textContent).toBe('刷新状态')
  })

  it('locks rapid repeated confirmation clicks while the request is pending', async () => {
    const pending = deferred<AgentPublicationRequest>()
    queryApi.mockImplementation((route: string) => route === 'agent-publication-confirm' ? pending.promise : Promise.resolve(publication()))
    await renderTool()
    const confirm = button('确认发布')
    await act(async () => { confirm.click(); confirm.click() })
    expect(queryApi.mock.calls.filter((call: unknown[]) => call[0] === 'agent-publication-confirm')).toHaveLength(1)
    expect(confirm.disabled).toBe(true)
    expect(button('取消本次发布').disabled).toBe(true)
    expect(button('刷新状态').disabled).toBe(true)
    await act(async () => { pending.resolve(accepted()) })
    expect(container.textContent).toContain('已进入本机提交队列')
  })

  it('locks a disconnected confirmation and refreshes the same request without retrying publication', async () => {
    let reads = 0
    queryApi.mockImplementation((route: string) => {
      if (route === 'agent-publication-confirm') return Promise.reject(new Error('连接中断'))
      return Promise.resolve(++reads === 1 ? publication() : accepted('running'))
    })
    await renderTool()
    await click('确认发布')
    expect(container.textContent).toContain('提交结果待确认')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接中断')
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '确认发布')).toBe(false)
    await click('刷新状态')
    expect(queryApi.mock.calls.filter((call: unknown[]) => call[0] === 'agent-publication-confirm')).toHaveLength(1)
    expect(queryApi.mock.calls.filter((call: unknown[]) => call[0] === 'agent-publication/session-1/request-1')).toHaveLength(2)
    expect(container.textContent).toContain('本机任务正在执行')
  })

  it.each([
    ['queued', '已进入本机提交队列'], ['running', '本机任务正在执行'],
    ['completed', '本机执行完成，请到平台后台核对'], ['failed', '本机执行失败'], ['unknown', '执行结果待确认'],
  ] as const)('renders persisted %s execution state without enabling another confirmation', async (state, label) => {
    queryApi.mockResolvedValue(accepted(state))
    await renderTool()
    expect(container.textContent).toContain(label)
    expect(container.textContent).toContain('不代表平台最终发布成功')
    if (state === 'failed') expect(container.textContent).toContain('平台登录已过期')
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.startsWith('确认'))).toBe(false)
    expect(queryApi).toHaveBeenCalledOnce()
  })

  it.each(['stale', 'uncertain', 'submitting', 'cancelled'] as const)('keeps a %s server request read-only', async state => {
    queryApi.mockResolvedValue(publication({ state }))
    await renderTool()
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.startsWith('确认'))).toBe(false)
    if (state === 'stale') expect(container.textContent).toContain('最新内容重新生成')
    if (state === 'uncertain') expect(container.textContent).toContain('到平台后台核对')
  })

  it('clears old state on a new session and request and ignores an old in-flight response', async () => {
    const old = deferred<AgentPublicationRequest>()
    queryApi.mockImplementation((route: string) => route.endsWith('/request-1') ? old.promise
      : Promise.resolve(publication({ sessionId: 'session/2', requestId: 'request-2', state: 'cancelled' })))
    await renderTool()
    expect(container.textContent).toContain('正在加载')
    await renderTool(toolProps('request-2', 'session/2'))
    expect(queryApi).toHaveBeenCalledWith('agent-publication/session%2F2/request-2')
    expect(container.textContent).toContain('已取消本次发布')
    await act(async () => { old.resolve(publication()) })
    expect(container.textContent).toContain('已取消本次发布')
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '确认发布')).toBe(false)
  })

  it('rejects a response from another session and offers only read-only reload', async () => {
    queryApi.mockResolvedValue(publication({ sessionId: 'other-session' }))
    await renderTool()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('与当前对话不匹配')
    await click('重新加载确认请求')
    expect(queryApi.mock.calls.every((call: unknown[]) => call.length === 1)).toBe(true)
  })

  it('does not load or submit failed tool results or preparing calls', async () => {
    const props = toolProps()
    await renderTool({ ...props, phase: 'result', block: { ...props.block, isError: true } } as ComponentProps<typeof AgentPublicationToolView>)
    expect(container.textContent).toContain('准备失败')
    expect(queryApi).not.toHaveBeenCalled()
    await renderTool({ phase: 'preparing', sessionId: 'session-1', block: {} } as ComponentProps<typeof AgentPublicationToolView>)
    expect(container.textContent).toContain('正在准备发布确认')
    expect(queryApi).not.toHaveBeenCalled()
  })

  it('recovers read-only loading under React StrictMode without automatic confirmation', async () => {
    await renderTool(toolProps(), true)
    expect(container.textContent).toContain('待你确认')
    expect(button('确认发布').disabled).toBe(false)
    expect(queryApi.mock.calls.every((call: unknown[]) => call.length === 1)).toBe(true)
  })
})
