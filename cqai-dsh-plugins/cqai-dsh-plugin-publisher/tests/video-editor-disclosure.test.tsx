// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherContent, PublisherContentPatch, Work } from '../src/protocol.ts'
import { VideoPage } from '../src/client/video.tsx'
import { api } from '../src/client/shared.tsx'
import { PublisherTipsProvider } from '../src/client/tips.tsx'
import { applyContentPatch } from '../src/client/content-patch.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button type="button" {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(), capabilityMessage: () => '', errorMessage: (error: Error) => error.message,
  STATEMENT_LABELS: { none: '不声明', ai_generated: 'AI 生成' },
  PublisherModal: () => null, ConfirmDialog: () => null,
}))
vi.mock('../src/client/project-directory-info.tsx', () => ({
  ProjectDirectoryInfo: () => <details className="project-directory"><summary>项目目录</summary></details>,
}))
vi.mock('../src/client/content-preview.tsx', () => ({ PublisherContentPreview: () => <div data-testid="preview"/> }))

const queryApi = api as unknown as Mock
let root: Root
let container: HTMLDivElement
let content: PublisherContent
const work: Work = { id: 'work-1', title: '旅行成片', description: '沿途的真实记录', tags: ['旅行'],
  aiGeneratedDisclosure: 'ai_generated', createdAt: '2026-10-15T00:00:00.000Z', bytes: 2048 }

async function render() {
  await act(async () => root.render(<PublisherTipsProvider><VideoPage active selectedContentId="video-1"
    onSelectedContentChange={vi.fn()} onBack={vi.fn()} onRestartAgent={vi.fn(async () => {})}/></PublisherTipsProvider>))
}
function details(title: string) {
  return Array.from(container.querySelectorAll<HTMLDetailsElement>('details')).find(item => item.querySelector('summary')?.textContent?.startsWith(title))!
}
async function click(selector: string) {
  const button = container.querySelector<HTMLElement>(selector)!
  expect(button).not.toBeNull()
  await act(async () => button.click())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  content = { id: 'video-1', contentType: 'video', revision: 1, title: '当前标题', description: '当前简介',
    shortTitle: '旧短标题', tags: ['旧话题'], body: '', summary: '', creativeStatement: 'none', assets: [], platformFields: {},
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' }
  queryApi.mockReset().mockImplementation(async (route: string, payload?: { patch?: PublisherContentPatch }) => {
    if (route === 'capability') return { supported: true, running: true }
    if (route === 'works') return [work]
    if (route === 'accounts') return []
    if (route === 'content/video-1') return content
    if (route === 'local-video-select') return { id: 'local-1', fileName: 'local.mp4', title: '本地片段', bytes: 4096 }
    if (route === 'content-patch') {
      content = { ...applyContentPatch(content, payload?.patch ?? {}), revision: content.revision + 1 }
      return content
    }
    throw new Error(`Unexpected route ${route}`)
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('video editor progressive disclosure', () => {
  it('keeps selected media and main copy visible while folding replacement, extra fields and secondary actions', async () => {
    content.videoSource = { kind: 'local', localVideoId: 'local-1', fileName: 'clip.mp4', bytes: 1024 }
    await render()
    expect(container.querySelector('.pub-editor-main video')?.getAttribute('src')).toBe('/api/cqai-publisher/video-preview/local/local-1')
    expect(container.querySelector<HTMLInputElement>('.pub-editor-main #pub-title')?.value).toBe('当前标题')
    expect(container.querySelector<HTMLTextAreaElement>('.pub-editor-main #pub-description')?.value).toBe('当前简介')
    expect(details('更换视频').open).toBe(false)
    expect(details('发布信息').open).toBe(false)
    expect(container.querySelector('.pub-editor-sidebar #pub-tags')).not.toBeNull()
    const more = container.querySelector<HTMLDetailsElement>('.pub-editor-more')!
    expect(more.open).toBe(false)
    expect(Array.from(more.querySelectorAll('button'), button => button.textContent)).toEqual(['保存', '重新开始对话', '复制', '删除'])
    expect(container.querySelector('.pub-editor-actions > button:last-child')?.textContent).toBe('发布')
  })

  it('starts an empty draft with media choices expanded and folds them after choosing a work without losing reset fields', async () => {
    await render()
    expect(details('选择视频素材').open).toBe(true)
    expect(container.querySelector('video')).toBeNull()
    await click('button.pub-work')
    expect(details('更换视频').open).toBe(false)
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/cqai-publisher/video-preview/work/work-1')
    expect(container.querySelector<HTMLInputElement>('#pub-title')?.value).toBe(work.title)
    expect(container.querySelector<HTMLTextAreaElement>('#pub-description')?.value).toBe(work.description)
    expect(container.querySelector<HTMLInputElement>('#pub-tags')?.value).toBe('旅行')
    expect(container.querySelector<HTMLInputElement>('#pub-short-title')?.value).toBe('')
    expect(container.querySelector<HTMLSelectElement>('#pub-statement')?.value).toBe('ai_generated')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(queryApi).toHaveBeenCalledWith('content-patch', expect.objectContaining({ patch: expect.objectContaining({
      videoSource: { kind: 'work', workId: work.id }, title: work.title, description: work.description,
      shortTitle: '', tags: ['旅行'], creativeStatement: 'ai_generated',
    }) }))
  })

  it('retains the native file chooser and clears the former work metadata when replacing a selected video', async () => {
    content.videoSource = { kind: 'work', workId: work.id }
    await render()
    await act(async () => { details('更换视频').querySelector('summary')!.click() })
    const local = Array.from(details('更换视频').querySelectorAll('button')).find(button => button.textContent === '选择本地文件…')!
    await act(async () => local.click())
    expect(queryApi).toHaveBeenCalledWith('local-video-select', {})
    expect(details('更换视频').open).toBe(false)
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/cqai-publisher/video-preview/local/local-1')
    expect(container.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('本地片段')
    expect(container.querySelector<HTMLTextAreaElement>('#pub-description')?.value).toBe('')
    expect(container.querySelector<HTMLInputElement>('#pub-tags')?.value).toBe('')
    expect(container.querySelector<HTMLInputElement>('#pub-short-title')?.value).toBe('')
    expect(container.querySelector<HTMLSelectElement>('#pub-statement')?.value).toBe('none')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(content.videoSource).toEqual({ kind: 'local', localVideoId: 'local-1', fileName: 'local.mp4', bytes: 4096 })
  })
})
