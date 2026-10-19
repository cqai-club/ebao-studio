import { createUserMessage, type GenerateOptions, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import {
  type LiteratureSource,
  type RunRequest,
  type ScholarProject,
  type TaskKind,
} from './protocol.ts'
import { newProjectId } from './store.ts'

export interface ResearchModelServices {
  defaultModel?: {
    currentSelection(): Pick<GenerateOptions, 'provider' | 'model' | 'reasoningEffort'>
  }
  llm?: Pick<LlmRuntime, 'stream'> & Partial<Pick<LlmRuntime, 'resolveModelInfo'>>
}

export class ResearchGenerationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'ResearchGenerationError'
  }
}

const TASK_LABELS: Record<TaskKind, string> = {
  search: '文献检索',
  review: '文献综述',
  journal: '期刊论文',
  research: '研究论文',
  thesis: '毕业论文',
  'journal-layout': '期刊排版',
  'thesis-layout': '毕业论文排版',
}

const DEGREE_LABELS = {
  undergraduate: '本科',
  master: '硕士',
  doctoral: '博士',
} as const

const CITATION_LABELS = {
  gb7714: 'GB/T 7714—2015',
  apa7: 'APA 7',
  mla9: 'MLA 9',
  chicago17: 'Chicago 17',
} as const

export function taskLabel(kind: TaskKind): string {
  return TASK_LABELS[kind]
}

export function initialProject(request: RunRequest): ScholarProject {
  const now = new Date().toISOString()
  const title = `${request.prompt.slice(0, 42)}${request.prompt.length > 42 ? '…' : ''}`
  return {
    id: newProjectId(),
    title,
    prompt: request.prompt,
    kind: request.kind,
    discipline: request.discipline,
    language: request.language,
    citationStyle: request.citationStyle,
    ...request.yearFrom === undefined ? {} : { yearFrom: request.yearFrom },
    sourceCount: request.sourceCount,
    status: 'draft',
    content: '',
    abstract: '',
    keywords: [],
    sources: [],
    layout: {
      degree: request.degree,
      journalName: request.journalName,
      author: request.author,
      affiliation: request.affiliation,
      template: request.kind === 'journal' || request.kind === 'research' || request.kind === 'journal-layout'
        ? 'journal'
        : request.kind === 'thesis' || request.kind === 'thesis-layout'
          ? 'thesis'
          : 'journal',
    },
    createdAt: now,
    updatedAt: now,
  }
}

function sourceContext(sources: LiteratureSource[]): string {
  return sources.map((source, index) => {
    const abstract = source.abstract === undefined ? '' : source.abstract.slice(0, 900)
    return [
      `[${index + 1}]`,
      `题名：${source.title}`,
      `作者：${source.authors.join('、') || '未知'}`,
      source.year === undefined ? '' : `年份：${source.year}`,
      source.venue === undefined ? '' : `来源：${source.venue}`,
      source.doi === undefined ? '' : `DOI：${source.doi}`,
      abstract === '' ? '' : `摘要：${abstract}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

function systemFor(project: ScholarProject): string {
  const language = project.language === 'zh' ? '中文' : '英文'
  const task = TASK_LABELS[project.kind]
  const degree = DEGREE_LABELS[project.layout.degree]
  const citation = CITATION_LABELS[project.citationStyle]
  const formatting = project.layout.template === 'journal'
    ? `期刊排版：${project.layout.journalName || '通用中文学术期刊'}。`
    : `${degree}学位论文排版。`
  return `你是 e研宝的学术研究与写作助手，服务在职研究生、硕士生和博士生。当前任务：${task}。使用${language}写作，引用格式：${citation}。${formatting}

必须遵守：
1. 只使用用户消息中来源清单提供的事实与文献；不得虚构作者、题名、DOI、数据、实验或引用。
2. 若证据不足以支撑某项判断，直接写明“现有来源不足以支持该判断”，并说明还缺什么证据。
3. 正文中的引用使用与来源清单序号对应的 [1]、[2] 形式；文末给出参考文献，逐条对应来源清单。
4. 区分文献结论、作者观点与你的分析。不得把推测写成既有研究结论。
5. 输出完整 Markdown 正文：第一行是一级标题；随后是摘要和关键词；再按任务组织正文与参考文献。
6. 不输出思考过程、写作说明、免责声明或代码围栏，直接输出可编辑稿件。

${project.kind === 'review' ? '文献综述应综合主题脉络、方法差异、争议、证据缺口与未来方向，避免逐篇摘要拼接。' : ''}
${project.kind === 'journal' || project.kind === 'journal-layout' ? '期刊论文应包含标题、摘要、关键词、引言、方法、结果或分析、讨论、结论与参考文献。' : ''}
${project.kind === 'research' ? '研究论文应给出清晰的研究问题、分析框架、方法、证据、讨论和局限。' : ''}
${project.kind === 'thesis' || project.kind === 'thesis-layout' ? '毕业论文应具备章节结构、研究设计、论证链、结论与参考文献；学位层次应与用户选择一致。' : ''}
${project.kind === 'journal-layout' || project.kind === 'thesis-layout' ? '本次重点是形成可直接进入排版的完整终稿，段落层级清晰，避免表格用复杂 Markdown。' : ''}`
}

function userPrompt(project: ScholarProject, sources: LiteratureSource[]): string {
  const degree = DEGREE_LABELS[project.layout.degree]
  return [
    `研究需求：${project.prompt}`,
    `任务：${TASK_LABELS[project.kind]}`,
    project.discipline === '' ? '' : `学科领域：${project.discipline}`,
    `学位层次：${degree}`,
    `起始年份：${project.yearFrom ?? '不限'}`,
    project.layout.author === '' ? '' : `作者：${project.layout.author}`,
    project.layout.affiliation === '' ? '' : `单位：${project.layout.affiliation}`,
    project.layout.journalName === '' ? '' : `目标期刊：${project.layout.journalName}`,
    '',
    '来源清单：',
    sourceContext(sources) || '（本次没有检索到可用来源）',
    '',
    `请根据以上来源完成${TASK_LABELS[project.kind]}。正文需要足够完整以便继续编辑和排版。`,
  ].filter(line => line !== '').join('\n')
}

export async function streamProjectDraft(
  project: ScholarProject,
  sources: LiteratureSource[],
  services: ResearchModelServices,
  onDelta: (text: string) => void | Promise<void>,
  signal: AbortSignal,
): Promise<string> {
  if (services.defaultModel === undefined || services.llm === undefined) {
    throw new ResearchGenerationError('默认文字模型尚未就绪，请先在模型设置中配置文字模型。', 'model-missing')
  }
  const selected = services.defaultModel.currentSelection()
  if (typeof selected?.provider !== 'string' || selected.provider.trim() === ''
    || typeof selected.model !== 'string' || selected.model.trim() === '') {
    throw new ResearchGenerationError('请先在模型设置中配置默认文字模型。', 'model-missing')
  }
  signal.throwIfAborted()
  if (services.llm.resolveModelInfo !== undefined) {
    const info = await services.llm.resolveModelInfo(selected.provider, selected.model, signal)
    if (info.inputModalities !== undefined && !info.inputModalities.includes('text')) {
      throw new ResearchGenerationError('当前默认模型不支持文字输入，请更换文字模型。', 'model-not-text')
    }
  }
  const maxTokens = project.kind === 'thesis' || project.kind === 'thesis-layout'
    ? 16_000
    : project.kind === 'journal' || project.kind === 'research' || project.kind === 'journal-layout'
      ? 12_000
      : 8_000
  let output = ''
  let finished = false
  for await (const chunk of services.llm.stream({
    ...selected,
    system: systemFor(project),
    messages: [createUserMessage({
      content: [{ type: 'text', text: userPrompt(project, sources) }],
      source: { kind: 'user' },
    })],
    maxTokens,
    signal,
  })) {
    signal.throwIfAborted()
    if (finished && chunk.type !== 'usage') {
      throw new ResearchGenerationError('模型响应在结束后仍有内容，未保存结果。', 'model-incomplete')
    }
    if (chunk.type === 'tool-call-delta'
      || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')
      || (chunk.type === 'block-end' && chunk.block.type === 'tool-call')) {
      throw new ResearchGenerationError('模型返回了工具调用，稿件生成已停止。', 'model-tool-call')
    }
    if (chunk.type === 'text-delta') {
      output += chunk.text
      await onDelta(chunk.text)
      if (output.length > 250_000) {
        throw new ResearchGenerationError('模型输出过长，稿件生成已停止。', 'model-output-too-long')
      }
    }
    if (chunk.type === 'finish') {
      if (chunk.reason.kind !== 'stop') {
        throw new ResearchGenerationError(
          chunk.reason.kind === 'aborted'
            ? '稿件生成已取消。'
            : chunk.reason.kind === 'error'
              ? chunk.reason.failure.message
              : '模型响应未完整结束，请重试。',
          chunk.reason.kind === 'aborted' ? 'cancelled' : 'model-incomplete',
        )
      }
      finished = true
    }
  }
  signal.throwIfAborted()
  if (!finished) throw new ResearchGenerationError('模型响应中断，请重试。', 'model-incomplete')
  const text = output.trim()
  if (text === '') throw new ResearchGenerationError('模型没有返回正文，请重试。', 'model-empty')
  return text
}

export function metadataFromMarkdown(markdown: string, fallbackTitle: string): {
  title: string
  abstract: string
  keywords: string[]
} {
  const titleMatch = /^#\s+(.+)$/mu.exec(markdown)
  const title = titleMatch?.[1]?.replace(/[*_`]/gu, '').trim() || fallbackTitle
  const abstractMatch = /(?:^|\n)(?:>\s*)?(?:\*\*)?摘要(?:\*\*)?[：:]\s*(?:\*\*)?\s*([^\n]+)/u.exec(markdown)
    ?? /(?:^|\n)##\s*摘要\s*\n+([^\n]+)/u.exec(markdown)
  const keywordsMatch = /(?:^|\n)(?:>\s*)?(?:\*\*)?关键词(?:\*\*)?[：:]\s*([^\n]+)/u.exec(markdown)
    ?? /(?:^|\n)##\s*关键词\s*\n+([^\n]+)/u.exec(markdown)
  const abstract = (abstractMatch?.[1] ?? '')
    .replace(/[*_`>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 3000)
  const keywords = (keywordsMatch?.[1] ?? '')
    .split(/[；;，,、]/u)
    .map(keyword => keyword.replace(/[*_`>]/gu, '').trim())
    .filter(Boolean)
    .slice(0, 12)
  return { title, abstract, keywords }
}

export function finalizeProject(
  project: ScholarProject,
  content: string,
  sources: LiteratureSource[],
): ScholarProject {
  const metadata = metadataFromMarkdown(content, project.title)
  return {
    ...project,
    ...metadata,
    content,
    sources,
    status: 'complete',
    error: undefined,
    updatedAt: new Date().toISOString(),
  }
}
