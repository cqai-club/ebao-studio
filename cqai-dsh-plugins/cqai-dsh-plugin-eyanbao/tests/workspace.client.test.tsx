// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '../src/protocol.ts'
import { project, source } from './fixtures.ts'

const api = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getDatabases: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  patchProject: vi.fn(),
  runResearch: vi.fn(),
  runAssist: vi.fn(),
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
  api.getDatabases.mockResolvedValue([
    { id: 'openalex', label: 'OpenAlex', available: true, requiresConfiguration: false },
    { id: 'crossref', label: 'Crossref', available: true, requiresConfiguration: false },
    { id: 'pubmed', label: 'PubMed', available: true, requiresConfiguration: false },
    { id: 'semantic-scholar', label: 'Semantic Scholar', available: true, requiresConfiguration: false },
    { id: 'web-of-science', label: 'Web of Science', available: false, requiresConfiguration: true, reason: '需要 Clarivate WOS_API_KEY' },
    { id: 'scopus', label: 'Scopus', available: false, requiresConfiguration: true, reason: '需要 Elsevier SCOPUS_API_KEY' },
    { id: 'google-scholar', label: 'Google Scholar', available: false, requiresConfiguration: true, reason: '需要 SerpAPI Google Scholar 密钥' },
    { id: 'cnki', label: 'CNKI 中国知网', available: false, requiresConfiguration: true, reason: '需要 CNKI 企业 API 网关地址' },
    { id: 'wanfang', label: '万方数据', available: false, requiresConfiguration: true, reason: '需要万方数据 API 网关地址' },
  ])
  api.listProjects.mockResolvedValue([])
  api.patchProject.mockImplementation(async (_id, change) => ({ ...project(), ...change }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<EyanbaoWorkspace />))
}

describe('e研宝 workspace', () => {
  it('switches all seven task views and exposes the matching inputs', async () => {
    await render()
    const modes = ['查文献', '文献综述', '期刊论文', '研究论文', '毕业论文', '期刊排版', '论文排版']
    for (const [index, label] of modes.entries()) {
      const button = findButton(label)!
      await act(async () => button.click())
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(container!.querySelector('.ey-compose-head h2')?.textContent).toBe(label)
      expect(container!.querySelector('[aria-label="任务说明"]')).not.toBeNull()
      if (index >= 5) {
        expect(container!.querySelector('#ey-format-file')).not.toBeNull()
        expect(container!.querySelector('#ey-research-prompt')).toBeNull()
      } else {
        expect(container!.querySelector('#ey-research-prompt')).not.toBeNull()
        expect(container!.querySelector('#ey-format-file')).toBeNull()
      }
    }
  })
  it('shows grouped navigation and a task-specific summary while keeping projects accessible', async () => {
    await render()
    const navigation = container!.querySelector('[aria-label="研究任务导航"]')!
    expect(navigation.textContent).toContain('查找与梳理')
    expect(navigation.textContent).toContain('撰写与研究')
    expect(navigation.textContent).toContain('格式与导出')
    expect(container!.querySelector('[aria-label="任务说明"]')?.textContent).toContain('文献列表')
    await act(async () => findButton('论文排版')!.click())
    expect(container!.querySelector('[aria-label="任务说明"]')?.textContent).toContain('排版副本')
    expect(container!.querySelector('#ey-format-file')).not.toBeNull()
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="打开研究项目"]')!.click())
    expect(container!.querySelector('.ey-shell')?.getAttribute('data-rail-open')).toBe('true')
  })
  it('requires review sources to be selected from the saved search before generation', async () => {
    await render()
    await act(async () => findButton('文献综述')!.click())
    const prompt = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '研究 AI 对写作的影响'); prompt.dispatchEvent(new Event('input', { bubbles: true })) })
    const found = project({ kind: 'search', sources: [source], status: 'complete' })
    api.runResearch.mockImplementationOnce(async (_request, onEvent: (event: StreamEvent) => void) => onEvent({ type: 'result', project: found }))
    await act(async () => findButton('检索并选择文献')!.click())
    expect(api.runResearch.mock.calls[0]![0]).toMatchObject({ kind: 'search' })
    expect(api.runResearch.mock.calls[0]![0]).not.toHaveProperty('researchMaterial')
    expect(findButton('检查并确认')!.disabled).toBe(true)
    const choice = container!.querySelector<HTMLInputElement>('[aria-label="选择综述文献"] input[type=checkbox]')!
    await act(async () => choice.click())
    await act(async () => findButton('检查并确认')!.click())
    api.runResearch.mockResolvedValueOnce(undefined)
    await act(async () => findButton('确认并生成草稿')!.click())
    expect(api.runResearch.mock.calls[1]![0]).toMatchObject({ kind: 'review', sourceProjectId: found.id, selectedSourceIds: [source.id] })
  })

  it('invalidates selected review sources when search conditions change', async () => {
    await render()
    await act(async () => findButton('文献综述')!.click())
    const prompt = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '研究 AI 对写作的影响'); prompt.dispatchEvent(new Event('input', { bubbles: true })) })
    api.runResearch.mockImplementationOnce(async (_request, onEvent: (event: StreamEvent) => void) => onEvent({ type: 'result', project: project({ kind: 'search', sources: [source] }) }))
    await act(async () => findButton('检索并选择文献')!.click())
    await act(async () => container!.querySelector<HTMLInputElement>('[aria-label="选择综述文献"] input')!.click())
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '新的研究主题和条件'); prompt.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(container!.querySelector('[aria-label="选择综述文献"]')).toBeNull()
    expect(findButton('检查并确认')!.disabled).toBe(true)
  })
  it('applies the thesis example with its degree and discipline, and submits school details', async () => {
    await render()
    await act(async () => findButton('毕业论文')!.click())
    await act(async () => findButton('博士')!.click())
    await act(async () => container!.querySelector<HTMLButtonElement>('.ey-chip')!.click())
    expect(findButton('硕士')?.getAttribute('aria-pressed')).toBe('true')
    expect(container!.querySelector<HTMLInputElement>('#ey-discipline')!.value).toBe('教育学')
    expect(container!.querySelector<HTMLTextAreaElement>('#ey-research-material')!.value).toContain('待作者补充')
    const school = container!.querySelector<HTMLInputElement>('#ey-target-school')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(school, '实际学校'); school.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => findButton('检查并确认')!.click())
    expect(container!.querySelector('.ey-confirm-plan')?.textContent).toContain('实际学校')
    api.runResearch.mockResolvedValue(undefined)
    await act(async () => findButton('确认并生成草稿')!.click())
    expect(api.runResearch.mock.calls[0]![0]).toMatchObject({ degree: 'master', discipline: '教育学', affiliation: '实际学校' })
  })

  it('exposes a target journal in journal writing and passes it through', async () => {
    await render()
    await act(async () => findButton('期刊论文')!.click())
    await act(async () => container!.querySelector<HTMLButtonElement>('.ey-chip')!.click())
    const journal = container!.querySelector<HTMLInputElement>('#ey-target-journal')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(journal, '目标期刊'); journal.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => findButton('检查并确认')!.click())
    expect(container!.querySelector('.ey-confirm-plan')?.textContent).toContain('目标期刊')
    api.runResearch.mockResolvedValue(undefined)
    await act(async () => findButton('确认并生成草稿')!.click())
    expect(api.runResearch.mock.calls[0]![0]).toMatchObject({ journalName: '目标期刊' })
  })
  it('previews author material before starting a writing request', async () => {
    await render()
    await act(async () => findButton('研究论文')!.click())
    const prompt = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    const material = container!.querySelector<HTMLTextAreaElement>('#ey-research-material')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '研究生成式 AI 对写作的影响')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(material, '访谈材料来自作者')
      material.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => findButton('检查并确认')!.click())
    expect(api.runResearch).not.toHaveBeenCalled()
    expect(container!.querySelector('.ey-confirm-plan')?.textContent).toContain('访谈材料来自作者')
    api.runResearch.mockResolvedValue(undefined)
    await act(async () => findButton('确认并生成草稿')!.click())
    expect(api.runResearch.mock.calls[0]![0]).toMatchObject({ prompt: '研究生成式 AI 对写作的影响', researchMaterial: '访谈材料来自作者' })
  })
  it('keeps formatting separate from literature search and requires a file', async () => {
    await render()
    for (const mode of ['期刊排版', '论文排版']) {
      await act(async () => findButton(mode)!.click())
      expect(container!.querySelector('#ey-format-file')).not.toBeNull()
      expect(container!.querySelector('#ey-research-prompt')).toBeNull()
      expect(findButton('预览格式变化')?.disabled).toBe(true)
      expect(container!.textContent).toContain('模板其他设置及引用格式不会迁移')
    }
  })

  it('sends the selected DOCX to the local formatting endpoint', async () => {
    await render()
    await act(async () => findButton('论文排版')!.click())
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ changes: [{ field: '字号', before: '10', after: '12' }], limitations: '仅测试' }) }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['word']) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const input = container!.querySelector<HTMLInputElement>('#ey-format-file')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['test'], '论文.docx')] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => { findButton('预览格式变化')!.click(); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/cqai-eyanbao/format-preview')
    expect(click).not.toHaveBeenCalled()
    await act(async () => findButton('确认并下载副本')!.click())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('/api/cqai-eyanbao/format-docx')
    expect(JSON.parse(init.body)).toMatchObject({ fileName: '论文.docx', preset: 'thesis', dataBase64: 'dGVzdA==', confirmed: true })
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('clears a previous formatting preview if the template selection changes', async () => {
    await render()
    await act(async () => findButton('期刊排版')!.click())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ changes: [{ field: '字号', before: null, after: '12' }], limitations: '需核对' }) }))
    const input = container!.querySelector<HTMLInputElement>('#ey-format-file')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['test'], '稿件.docx')] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => { findButton('预览格式变化')!.click(); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(findButton('确认并下载副本')).toBeDefined()
    const preset = container!.querySelector<HTMLSelectElement>('#ey-format-preset')!
    await act(async () => { preset.value = 'custom'; preset.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(findButton('确认并下载副本')).toBeUndefined()
    expect(container!.querySelector('#ey-format-template')).not.toBeNull()
    vi.unstubAllGlobals()
  })

  it('previews a user-provided template with both local files', async () => {
    await render()
    await act(async () => findButton('期刊排版')!.click())
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ changes: [], limitations: '只比较文档默认样式' }) })
    vi.stubGlobal('fetch', fetchMock)
    const source = container!.querySelector<HTMLInputElement>('#ey-format-file')!
    Object.defineProperty(source, 'files', { configurable: true, value: [new File(['source'], '稿件.docx')] })
    await act(async () => source.dispatchEvent(new Event('change', { bubbles: true })))
    const preset = container!.querySelector<HTMLSelectElement>('#ey-format-preset')!
    await act(async () => { preset.value = 'custom'; preset.dispatchEvent(new Event('change', { bubbles: true })) })
    const template = container!.querySelector<HTMLInputElement>('#ey-format-template')!
    Object.defineProperty(template, 'files', { configurable: true, value: [new File(['template'], '模板.docx')] })
    await act(async () => template.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => { findButton('预览格式变化')!.click(); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ preset: 'custom', fileName: '稿件.docx', templateFileName: '模板.docx', dataBase64: 'c291cmNl', templateBase64: 'dGVtcGxhdGU=' })
    expect(findButton('确认并下载副本')).toBeDefined()
    vi.unstubAllGlobals()
  })
  it('shows all one-sentence tasks and reveals degree choices for a thesis', async () => {
    await render()
    for (const label of ['查文献', '文献综述', '期刊论文', '研究论文', '毕业论文', '期刊排版', '论文排版']) {
      expect([...container!.querySelectorAll('button')].some(button => button.textContent?.includes(label))).toBe(true)
    }
    await act(async () => findButton('毕业论文')!.click())
    const segment = [...container!.querySelectorAll('.ey-segment button')].map(button => button.textContent)
    expect(segment).toEqual(['本科', '硕士', '博士'])
    expect(findButton('本科')?.getAttribute('aria-pressed')).toBe('false')
    const scope = container!.querySelector<HTMLSelectElement>('#ey-literature-scope')!
    expect(scope.value).toBe('mixed')
    expect([...scope.options].map(option => option.textContent)).toEqual(['中外文混合', '中文文献', '外文文献'])
    expect(container!.querySelector('.ey-database-picker summary')?.textContent).toContain('4 个已选')
    const wos = [...container!.querySelectorAll<HTMLLabelElement>('.ey-database-option')]
      .find(option => option.textContent?.includes('Web of Science'))!
    expect(wos.querySelector('input')?.disabled).toBe(true)
  })

  it('streams a draft into the document view and exposes export actions', async () => {
    await render()
    const textarea = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '研究生成式 AI 对学术写作的影响')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const scope = container!.querySelector<HTMLSelectElement>('#ey-literature-scope')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(scope, 'foreign')
      scope.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const quality = container!.querySelector<HTMLSelectElement>('#ey-journal-quality')!
    expect([...quality.options].map(option => option.textContent)).toEqual(['全部期刊', '顶刊优先', '仅顶级期刊'])
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(quality, 'top-only')
      quality.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const pubmed = [...container!.querySelectorAll<HTMLLabelElement>('.ey-database-option')]
      .find(option => option.textContent?.includes('PubMed'))!
    await act(async () => pubmed.querySelector<HTMLInputElement>('input')!.click())
    const result = project({ title: '生成式 AI 对学术写作的影响', content: '# 生成式 AI 对学术写作的影响\n\n## 引言\n\n正文。' })
    api.runResearch.mockImplementation(async (_request, onEvent: (event: StreamEvent) => void) => {
      onEvent({ type: 'project', project: { ...result, status: 'running', content: '' } })
      onEvent({ type: 'status', stage: 'search', message: '正在检索' })
      onEvent({ type: 'sources', sources: result.sources })
      onEvent({ type: 'delta', text: '# 生成式 AI 对学术写作的影响\n\n## 引言\n\n正文。' })
      onEvent({ type: 'result', project: result })
    })
    await act(async () => findButton('开始检索')!.click())
    expect(api.runResearch).toHaveBeenCalledOnce()
    expect(api.runResearch.mock.calls[0]![0]).toMatchObject({
      literatureScope: 'foreign',
      journalQuality: 'top-only',
      databases: ['openalex', 'crossref', 'semantic-scholar'],
    })
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
    await act(async () => findButton('开始检索')!.click())
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

  it('opens the AI assistant from the task row and applies a refined prompt', async () => {
    await render()
    const prompt = container!.querySelector<HTMLTextAreaElement>('#ey-research-prompt')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '研究生成式 AI 对学术写作的影响')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const trigger = container!.querySelector<HTMLButtonElement>('[aria-label="打开 AI 研究助手"]')!
    await act(async () => trigger.click())
    expect(container!.querySelector('[role="dialog"]')).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    api.runAssist.mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'status', message: '正在分析当前研究需求' })
      onEvent({ type: 'delta', text: '研究生成式 AI 对在职研究生学术写作投入与证据核验的影响。' })
      onEvent({ type: 'result', text: '研究生成式 AI 对在职研究生学术写作投入与证据核验的影响。' })
    })
    await act(async () => findButton('生成建议')!.click())
    expect(api.runAssist).toHaveBeenCalledOnce()
    expect(container!.querySelector('.ey-ai-result')?.textContent).toContain('证据核验')
    await act(async () => findButton('替换研究需求')!.click())
    expect(prompt.value).toBe('研究生成式 AI 对在职研究生学术写作投入与证据核验的影响。')
    expect(container!.querySelector('[role="dialog"]')).toBeNull()
  })
})
