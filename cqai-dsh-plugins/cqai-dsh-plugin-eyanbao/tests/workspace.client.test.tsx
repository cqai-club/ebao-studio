// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '../src/protocol.ts'
import { project } from './fixtures.ts'

const api = vi.hoisted(() => ({
  getHealth: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  patchProject: vi.fn(),
  runResearch: vi.fn(),
  exportUrl: vi.fn((id: string, format: string) => `/api/cqai-eyanbao/projects/${id}/export.${format}`),
}))

vi.mock('../src/client/api.ts', () => api)

import { EyanbaoWorkspace } from '../src/client/EyanbaoWorkspace.tsx'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  container?.remove()
  container = undefined
  vi.clearAllMocks()
  vi.useRealTimers()
})

function findButton(label: string): HTMLButtonElement | undefined {
  return [...container!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)
}

async function render() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api.getHealth.mockResolvedValue({ ok: true, modelReady: true, provider: 'demo', model: 'demo' })
  api.listProjects.mockResolvedValue([])
  api.patchProject.mockImplementation(async (_id, change) => ({ ...project(), ...change }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<EyanbaoWorkspace />))
}

describe('e研宝 workspace', () => {
  it('shows all one-sentence tasks and reveals degree choices for a thesis', async () => {
    await render()
    for (const label of ['查文献', '文献综述', '期刊论文', '研究论文', '毕业论文', '期刊排版', '论文排版']) {
      expect([...container!.querySelectorAll('button')].some(button => button.textContent?.includes(label))).toBe(true)
    }
    await act(async () => findButton('毕业论文')!.click())
    const segment = [...container!.querySelectorAll('.ey-segment button')].map(button => button.textContent)
    expect(segment).toEqual(['本科', '硕士', '博士'])
    expect(findButton('本科')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('streams a draft into the document view and exposes export actions', async () => {
    await render()
    const textarea = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '研究生成式 AI 对学术写作的影响')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const result = project({ title: '生成式 AI 对学术写作的影响', content: '# 生成式 AI 对学术写作的影响\n\n## 引言\n\n正文。' })
    api.runResearch.mockImplementation(async (_request, onEvent: (event: StreamEvent) => void) => {
      onEvent({ type: 'project', project: { ...result, status: 'running', content: '' } })
      onEvent({ type: 'status', stage: 'search', message: '正在检索' })
      onEvent({ type: 'sources', sources: result.sources })
      onEvent({ type: 'delta', text: '# 生成式 AI 对学术写作的影响\n\n## 引言\n\n正文。' })
      onEvent({ type: 'result', project: result })
    })
    await act(async () => findButton('开始研究')!.click())
    expect(api.runResearch).toHaveBeenCalledOnce()
    expect(container!.querySelector('.ey-document h1')?.textContent).toBe('生成式 AI 对学术写作的影响')
    expect([...container!.querySelectorAll('a')].some(link => link.textContent?.includes('DOCX'))).toBe(true)
    expect(container!.querySelector('#ey-heading-1')?.textContent).toBe('引言')
  })

  it('merges rapid content and layout edits into one autosave', async () => {
    await render()
    const prompt = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '研究生成式 AI 对学术写作的影响')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const result = project()
    api.runResearch.mockImplementation(async (_request, onEvent: (event: StreamEvent) => void) => {
      onEvent({ type: 'project', project: result })
      onEvent({ type: 'result', project: result })
    })
    await act(async () => findButton('开始研究')!.click())
    vi.useFakeTimers()
    await act(async () => findButton('编辑')!.click())
    const editor = container!.querySelector<HTMLTextAreaElement>('.ey-editor')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, `${result.content}\n\n新增正文。`)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => findButton('排版')!.click())
    await act(async () => findButton('学位论文')!.click())
    await act(async () => {
      vi.advanceTimersByTime(900)
      await Promise.resolve()
    })
    expect(api.patchProject).toHaveBeenCalledTimes(1)
    const change = api.patchProject.mock.calls[0]![1]
    expect(change.content).toContain('新增正文。')
    expect(change.layout?.template).toBe('thesis')
  })
})
