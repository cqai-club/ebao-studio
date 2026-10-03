// @vitest-environment jsdom
import { act, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TalkCraft } from '../src/client/App.tsx'
import { API, EDGE_VOICES, type Job } from '../src/protocol.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({variant: _variant, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {variant?: string}) => <button {...props}/>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props}/>,
  JsonTree: () => null,
  MarkdownText: () => null,
}))
vi.mock('cqai-dsh-media-settings/client', () => ({MediaSettingsEditor: () => <div data-common-settings=""/>}))

const DRAFT_KEY = 'cqai-talkcraft-create-draft-v2'
const defaults = {aspect: '9:16', edgeVoiceId: 'zh-CN-XiaoxiaoNeural'}
const publicSettings = {revision: 1, defaults, effective: defaults}
const completedJob: Job = {id: 'completed', title: '完成的口播视频', text: '测试口播', aspect: '16:9',
  status: 'completed', stage: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  uploads: [], candidates: [], artifacts: [], logs: [], completedStages: ['prepare', 'shotbook', 'sample', 'finish'], approvedSample: true}
const json = (value: unknown) => new Response(JSON.stringify(value), {status: 200, headers: {'content-type': 'application/json'}})
let container: HTMLDivElement
let root: Root | undefined
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

async function render(props: Parameters<typeof TalkCraft>[0] = {}) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => {root!.render(<TalkCraft {...props}/> )})
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === text || item.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => {button.click()})
}
async function enterText(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>('#tc-script')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {setter.call(input, value); input.dispatchEvent(new Event('input', {bubbles: true}))})
}
const calls = (action: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(`${API}/${action}`))
const savedDraft = () => JSON.parse(localStorage.getItem(DRAFT_KEY)!) as {aspect: string; edgeVoice: string; text: string}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  fetchMock = vi.fn<typeof fetch>(async url => {
    const action = String(url).slice(API.length + 1).split('?')[0]
    switch (action) {
      case 'jobs': return json([completedJob])
      case 'documents': return json([])
      case 'health': return json({edgeTts: true, asrModel: true})
      case 'settings': return json({fish: true, pexels: true, pixabay: false})
      case 'setup': return json({status: 'idle', items: [], logs: [], updatedAt: 0})
      case 'edge-voices': return json({voices: EDGE_VOICES, source: 'fallback'})
      case 'media-settings': return json(publicSettings)
      case 'editor/open': return json({url: 'http://127.0.0.1:54321/?tracks'})
      case 'editor/close': return json({ok: true})
      default: throw new Error(`Unexpected URL: ${url}`)
    }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  if (root) await act(async () => {root!.unmount()})
  root = undefined
  container?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('TalkCraft retained video workspace', () => {
  it('uses effective shared defaults for a fresh draft', async () => {
    fetchMock.mockImplementation(async url => String(url).endsWith('/media-settings')
      ? json({...publicSettings, effective: {aspect: '16:9', edgeVoiceId: 'zh-CN-XiaoyiNeural'}})
      : json(String(url).endsWith('/jobs') ? [] : {}))
    await render()
    expect(savedDraft()).toMatchObject({aspect: '16:9', edgeVoice: 'zh-CN-XiaoyiNeural'})
  })

  it('restores the exact saved aspect and voice rather than applying changed common defaults', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({title: '旧稿', text: '继续这条稿件', aspect: '16:9', edgeVoice: 'zh-CN-YunxiNeural'}))
    await render()
    await click('做新视频')
    expect(savedDraft()).toMatchObject({aspect: '16:9', edgeVoice: 'zh-CN-YunxiNeural', text: '继续这条稿件'})
    expect(calls('media-settings')).toHaveLength(0)
  })

  it('keeps an explicit aspect selected while a delayed defaults request is in flight', async () => {
    const pending: Array<(response: Response) => void> = []
    const normal = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url, options) => String(url).endsWith('/media-settings')
      ? new Promise<Response>(resolve => pending.push(resolve)) : normal(url, options))
    await render()
    await click('做新视频')
    await enterText('这是一条口播稿。')
    await click('下一步：选择声音')
    await click('Fish Audio')
    await click('下一步：添加画面')
    await click('横屏 16:9')
    await act(async () => {pending.forEach(resolve => resolve(json(publicSettings)))})
    expect(savedDraft().aspect).toBe('16:9')
    expect(savedDraft().text).toBe('这是一条口播稿。')
  })

  it('pauses hidden reads, aborts in-flight polling, and retains the editor through aggregate settings', async () => {
    const onOpenSettings = vi.fn()
    await render({onOpenSettings})
    await click('完成的口播视频')
    await click('精细编辑镜头')
    const iframe = container.querySelector('iframe')!
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')
    await act(async () => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'talkcraft:ready'}, source: iframe.contentWindow, origin: 'https://unrelated.example'}))})
    expect(postMessage).not.toHaveBeenCalled()
    await act(async () => {window.dispatchEvent(new MessageEvent('message', {data: {type: 'talkcraft:ready'}, source: iframe.contentWindow, origin: 'http://127.0.0.1:54321'}))})
    expect(postMessage).toHaveBeenLastCalledWith({type: 'talkcraft:visibility', active: true}, 'http://127.0.0.1:54321')
    expect([...container.querySelectorAll('button')].some(button => button.textContent === '设置')).toBe(false)
    expect(onOpenSettings).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')).toBe(iframe)
    expect(calls('editor/close')).toHaveLength(0)
    const readCalls = fetchMock.mock.calls.filter(([, options]) => options?.signal)
    await render({active: false, onOpenSettings})
    expect(postMessage).toHaveBeenLastCalledWith({type: 'talkcraft:visibility', active: false}, 'http://127.0.0.1:54321')
    expect(readCalls.every(([, options]) => options!.signal!.aborted)).toBe(true)
    const hiddenCallCount = fetchMock.mock.calls.length
    await act(async () => {vi.advanceTimersByTime(15000)})
    expect(fetchMock.mock.calls).toHaveLength(hiddenCallCount)
    expect(container.querySelector('iframe')).toBe(iframe)
    expect(calls('editor/close')).toHaveLength(0)
    await render({active: true, onOpenSettings})
    expect(postMessage).toHaveBeenLastCalledWith({type: 'talkcraft:visibility', active: true}, 'http://127.0.0.1:54321')
    expect(calls('jobs').length).toBeGreaterThan(1)
    expect(container.querySelector('iframe')).toBe(iframe)
    await act(async () => {root!.unmount()})
    root = undefined
    expect(calls('editor/close')).toHaveLength(1)
  })

  it('keeps the editor iframe mounted while visiting standalone settings and returning', async () => {
    await render()
    await click('完成的口播视频')
    await click('精细编辑镜头')
    const iframe = container.querySelector('iframe')!
    await click('设置')
    expect(container.querySelector('[data-common-settings]')).not.toBeNull()
    expect(iframe.parentElement!.hidden).toBe(true)
    expect(container.querySelector('iframe')).toBe(iframe)
    expect(calls('editor/close')).toHaveLength(0)
    await click('← 返回')
    expect(iframe.parentElement!.hidden).toBe(false)
    expect(container.querySelector('iframe')).toBe(iframe)
    expect(calls('editor/close')).toHaveLength(0)
  })

  it('ignores Escape in a hidden delete dialog and restores its keyboard behavior when shown', async () => {
    await render()
    await click('删除')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await render({active: false})
    await act(async () => {window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))})
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await render({active: true})
    await act(async () => {window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))})
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
