export const API = '/api/cqai-eyanbao'

export const TASK_KINDS = [
  'search',
  'review',
  'journal',
  'research',
  'thesis',
  'journal-layout',
  'thesis-layout',
] as const

export type TaskKind = typeof TASK_KINDS[number]

export const DEGREES = ['undergraduate', 'master', 'doctoral'] as const
export type Degree = typeof DEGREES[number]

export const CITATION_STYLES = ['gb7714', 'apa7', 'mla9', 'chicago17'] as const
export type CitationStyle = typeof CITATION_STYLES[number]

export const LANGUAGES = ['zh', 'en'] as const
export type Language = typeof LANGUAGES[number]

export const LITERATURE_SCOPES = ['mixed', 'zh', 'foreign'] as const
export type LiteratureScope = typeof LITERATURE_SCOPES[number]

export const JOURNAL_QUALITIES = ['any', 'top-preferred', 'top-only'] as const
export type JournalQuality = typeof JOURNAL_QUALITIES[number]

export const ASSIST_ACTIONS = ['refine', 'keywords', 'method', 'outline'] as const
export type AssistAction = typeof ASSIST_ACTIONS[number]

export const DATABASE_IDS = [
  'openalex',
  'crossref',
  'pubmed',
  'web-of-science',
  'scopus',
  'google-scholar',
  'cnki',
  'wanfang',
] as const
export type DatabaseId = typeof DATABASE_IDS[number]

export interface DatabaseStatus {
  id: DatabaseId
  label: string
  available: boolean
  requiresConfiguration: boolean
  reason?: string
}

export const PROJECT_STATUSES = ['draft', 'running', 'complete', 'error'] as const
export type ProjectStatus = typeof PROJECT_STATUSES[number]

export interface LiteratureSource {
  id: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  doi?: string
  url?: string
  abstract?: string
  language?: string
  topJournal?: boolean
  citedBy?: number
  source: DatabaseId
}

export interface LayoutSettings {
  degree: Degree
  journalName: string
  author: string
  affiliation: string
  template: 'journal' | 'thesis'
}

export interface ScholarProject {
  id: string
  title: string
  prompt: string
  kind: TaskKind
  discipline: string
  language: Language
  literatureScope: LiteratureScope
  journalQuality: JournalQuality
  databases: DatabaseId[]
  citationStyle: CitationStyle
  yearFrom?: number
  sourceCount: number
  status: ProjectStatus
  content: string
  abstract: string
  keywords: string[]
  sources: LiteratureSource[]
  layout: LayoutSettings
  warning?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary {
  id: string
  title: string
  prompt: string
  kind: TaskKind
  status: ProjectStatus
  sourceCount: number
  updatedAt: string
}

export interface RunRequest {
  prompt: string
  kind: TaskKind
  degree: Degree
  discipline: string
  language: Language
  literatureScope: LiteratureScope
  journalQuality: JournalQuality
  databases: DatabaseId[]
  citationStyle: CitationStyle
  yearFrom?: number
  sourceCount: number
  author: string
  affiliation: string
  journalName: string
}

export interface AssistRequest {
  action: AssistAction
  prompt: string
  kind: TaskKind
  degree: Degree
  discipline: string
  language: Language
  literatureScope: LiteratureScope
  journalQuality: JournalQuality
  databases: DatabaseId[]
}

export interface HealthResponse {
  ok: boolean
  modelReady: boolean
  provider?: string
  model?: string
  message?: string
}

export type StreamEvent =
  | { type: 'project'; project: ScholarProject }
  | { type: 'status'; stage: 'search' | 'evidence' | 'write' | 'polish'; message: string }
  | { type: 'sources'; sources: LiteratureSource[]; warning?: string }
  | { type: 'delta'; text: string }
  | { type: 'result'; project: ScholarProject }
  | { type: 'error'; message: string; project?: ScholarProject }

export type AssistEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }

const TASK_KIND_SET = new Set<string>(TASK_KINDS)
const DEGREE_SET = new Set<string>(DEGREES)
const CITATION_STYLE_SET = new Set<string>(CITATION_STYLES)
const LANGUAGE_SET = new Set<string>(LANGUAGES)
const LITERATURE_SCOPE_SET = new Set<string>(LITERATURE_SCOPES)
const JOURNAL_QUALITY_SET = new Set<string>(JOURNAL_QUALITIES)
const ASSIST_ACTION_SET = new Set<string>(ASSIST_ACTIONS)
const DATABASE_ID_SET = new Set<string>(DATABASE_IDS)

export function taskKind(value: unknown): TaskKind {
  if (typeof value !== 'string' || !TASK_KIND_SET.has(value)) throw new Error('研究任务类型无效')
  return value as TaskKind
}

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && TASK_KIND_SET.has(value)
}

export function degree(value: unknown): Degree {
  if (typeof value !== 'string' || !DEGREE_SET.has(value)) throw new Error('学位层次无效')
  return value as Degree
}

export function citationStyle(value: unknown): CitationStyle {
  if (typeof value !== 'string' || !CITATION_STYLE_SET.has(value)) throw new Error('引用格式无效')
  return value as CitationStyle
}

export function language(value: unknown): Language {
  if (typeof value !== 'string' || !LANGUAGE_SET.has(value)) throw new Error('写作语言无效')
  return value as Language
}

export function literatureScope(value: unknown): LiteratureScope {
  if (typeof value !== 'string' || !LITERATURE_SCOPE_SET.has(value)) throw new Error('文献范围无效')
  return value as LiteratureScope
}

export function journalQuality(value: unknown): JournalQuality {
  if (typeof value !== 'string' || !JOURNAL_QUALITY_SET.has(value)) throw new Error('期刊层级无效')
  return value as JournalQuality
}

export function assistAction(value: unknown): AssistAction {
  if (typeof value !== 'string' || !ASSIST_ACTION_SET.has(value)) throw new Error('AI 辅助类型无效')
  return value as AssistAction
}

export function databaseId(value: unknown): DatabaseId {
  if (typeof value !== 'string' || !DATABASE_ID_SET.has(value)) throw new Error('文献数据库无效')
  return value as DatabaseId
}

export function databaseIds(value: unknown): DatabaseId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('请至少选择一个文献数据库')
  const ids = [...new Set(value.map(databaseId))]
  if (ids.length > DATABASE_IDS.length) throw new Error('文献数据库数量无效')
  return ids
}

export function parseRunRequest(value: unknown): RunRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('研究请求格式无效')
  const body = value as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt.length < 4) throw new Error('请至少输入四个字的研究需求')
  if (prompt.length > 4000) throw new Error('研究需求不能超过 4000 个字符')
  const sourceCount = Number(body.sourceCount ?? 12)
  if (!Number.isInteger(sourceCount) || sourceCount < 3 || sourceCount > 30) throw new Error('文献数量需在 3 到 30 之间')
  const year = body.yearFrom === undefined || body.yearFrom === null || body.yearFrom === ''
    ? undefined
    : Number(body.yearFrom)
  const currentYear = new Date().getFullYear()
  if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > currentYear)) {
    throw new Error(`起始年份需在 1900 到 ${currentYear} 之间`)
  }
  const clean = (key: string, max: number): string => {
    const raw = body[key]
    if (raw === undefined || raw === null) return ''
    if (typeof raw !== 'string') throw new Error(`${key} 必须是文本`)
    return raw.trim().slice(0, max)
  }
  return {
    prompt,
    kind: taskKind(body.kind),
    degree: degree(body.degree ?? 'master'),
    discipline: clean('discipline', 80),
    language: language(body.language ?? 'zh'),
    literatureScope: literatureScope(body.literatureScope ?? 'mixed'),
    journalQuality: journalQuality(body.journalQuality ?? 'any'),
    databases: databaseIds(body.databases ?? ['openalex', 'crossref']),
    citationStyle: citationStyle(body.citationStyle ?? 'gb7714'),
    ...year === undefined ? {} : { yearFrom: year },
    sourceCount,
    author: clean('author', 80),
    affiliation: clean('affiliation', 160),
    journalName: clean('journalName', 120),
  }
}

export function parseAssistRequest(value: unknown): AssistRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 辅助请求格式无效')
  const body = value as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt.length < 4) throw new Error('请先输入至少四个字的研究需求')
  if (prompt.length > 4000) throw new Error('研究需求不能超过 4000 个字符')
  const discipline = typeof body.discipline === 'string' ? body.discipline.trim().slice(0, 80) : ''
  return {
    action: assistAction(body.action),
    prompt,
    kind: taskKind(body.kind),
    degree: degree(body.degree ?? 'master'),
    discipline,
    language: language(body.language ?? 'zh'),
    literatureScope: literatureScope(body.literatureScope ?? 'mixed'),
    journalQuality: journalQuality(body.journalQuality ?? 'any'),
    databases: databaseIds(body.databases ?? ['openalex', 'crossref']),
  }
}

export function projectSummary(project: ScholarProject): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    prompt: project.prompt,
    kind: project.kind,
    status: project.status,
    sourceCount: project.sources.length,
    updatedAt: project.updatedAt,
  }
}

export function isScholarProject(value: unknown): value is ScholarProject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const project = value as Partial<ScholarProject>
  return typeof project.id === 'string'
    && typeof project.title === 'string'
    && typeof project.content === 'string'
    && isTaskKind(project.kind)
    && PROJECT_STATUSES.includes(project.status as ProjectStatus)
    && Array.isArray(project.sources)
}

export function sourceLabel(source: LiteratureSource, index: number): string {
  const authors = source.authors.length === 0
    ? '佚名'
    : source.authors.length > 3
      ? `${source.authors.slice(0, 3).join('、')}等`
      : source.authors.join('、')
  return `[${index + 1}] ${authors}. ${source.title}${source.venue === undefined ? '' : `. ${source.venue}`}${
    source.year === undefined ? '' : `, ${source.year}`
  }.${source.doi === undefined ? '' : ` https://doi.org/${source.doi}`}`
}

export function safeFileStem(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80) || 'e研宝文档'
}
