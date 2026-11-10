import {
  AlertCircle,
  BookOpenText,
  Check,
  ChevronRight,
  CircleStop,
  Database,
  Download,
  Eye,
  FilePenLine,
  FileText,
  GraduationCap,
  LayoutTemplate,
  LoaderCircle,
  Microscope,
  PanelLeft,
  PencilLine,
  Plus,
  Search,
  Settings2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  API,
  DEGREES,
  CITATION_STYLES,
  JOURNAL_QUALITIES,
  LITERATURE_SCOPES,
  type Degree,
  type DatabaseId,
  type DatabaseStatus,
  type HealthResponse,
  type JournalQuality,
  type LiteratureScope,
  type LiteratureSource,
  type ProjectSummary,
  type RunRequest,
  type ScholarProject,
  type StreamEvent,
  type TaskKind,
} from '../protocol.ts'
import {
  exportUrl,
  getHealth,
  getDatabases,
  getProject,
  listProjects,
  patchProject,
  runResearch,
} from './api.ts'
import { AiAssistant } from './AiAssistant.tsx'
import { MarkdownDocument } from './markdown.tsx'
import { workspaceStyles } from './styles.ts'

interface TaskDefinition {
  id: TaskKind
  label: string
  icon: LucideIcon
  sample: string
}

const TASKS: TaskDefinition[] = [
  { id: 'search', label: '查文献', icon: Search, sample: '检索生成式 AI 对知识工作的实证研究，聚焦 2021 年后的英文期刊' },
  { id: 'review', label: '文献综述', icon: BookOpenText, sample: '写一篇生成式 AI 与知识工作者生产力的文献综述' },
  { id: 'journal', label: '期刊论文', icon: FileText, sample: '写一篇关于生成式 AI 辅助科研写作的期刊论文' },
  { id: 'research', label: '研究论文', icon: Microscope, sample: '研究在职研究生使用 AI 工具后的学术写作投入变化' },
  { id: 'thesis', label: '毕业论文', icon: GraduationCap, sample: '写一篇关于生成式 AI 对科研工作影响的硕士学位论文' },
  { id: 'journal-layout', label: '期刊排版', icon: LayoutTemplate, sample: '把生成式 AI 辅助科研写作研究做成中文学术期刊排版稿' },
  { id: 'thesis-layout', label: '论文排版', icon: FilePenLine, sample: '把生成式 AI 与研究生学术写作研究做成硕士学位论文排版稿' },
]

const TASK_DETAILS: Record<TaskKind, { description: string; output: string; action: string }> = {
  search: { description: '查找相关研究，筛选可核查的来源。', output: '文献列表、来源链接与检索状态', action: '开始检索' },
  review: { description: '围绕研究问题梳理文献观点、分歧和研究空白。', output: '综述草稿与检索到的文献来源', action: '生成综述草稿' },
  journal: { description: '根据已有研究材料整理投稿论文草稿。', output: '期刊论文草稿及文献来源', action: '生成论文草稿' },
  research: { description: '组织研究问题、方法与证据，形成研究报告。', output: '研究报告草稿及文献来源', action: '生成研究草稿' },
  thesis: { description: '按照学位层次组织论文结构和已有材料。', output: '学位论文草稿与文献来源', action: '生成论文草稿' },
  'journal-layout': { description: '根据期刊要求处理已有 Word 稿件。', output: '排版副本与核对说明', action: '开始排版' },
  'thesis-layout': { description: '根据学校及学位要求处理已有 Word 论文。', output: '排版副本与核对说明', action: '开始排版' },
}

const MATERIAL_HINTS: Partial<Record<TaskKind, { label: string; placeholder: string; sample: string }>> = {
  review: { label: '综述问题和已有材料', placeholder: '粘贴综述关注的问题或已读材料摘要。', sample: '希望梳理不同任务的研究分歧；已读材料待补充。' },
  journal: { label: '研究方法和已有结果', placeholder: '粘贴真实研究方法、结果和投稿要求。', sample: '研究问题：AI 工具如何影响写作投入？方法与真实结果由作者补充。' },
  research: { label: '研究问题和已有材料', placeholder: '粘贴研究设计、访谈或问卷等已有材料。', sample: '拟采用访谈，访谈材料与实际研究结果待作者补充。' },
  thesis: { label: '研究材料和导师要求', placeholder: '粘贴已有方法、真实结果和导师意见。', sample: '研究方法、真实数据与导师意见待作者补充。' },
}

const DEGREE_LABELS: Record<Degree, string> = {
  undergraduate: '本科',
  master: '硕士',
  doctoral: '博士',
}

const CITATION_LABELS = {
  gb7714: 'GB/T 7714',
  apa7: 'APA 7',
  mla9: 'MLA 9',
  chicago17: 'Chicago 17',
} as const

const LITERATURE_SCOPE_LABELS: Record<LiteratureScope, string> = {
  mixed: '中外文混合',
  zh: '中文文献',
  foreign: '外文文献',
}

const JOURNAL_QUALITY_LABELS: Record<JournalQuality, string> = {
  any: '全部期刊',
  'top-preferred': '顶刊优先',
  'top-only': '仅顶级期刊',
}

const DATABASE_LABELS: Record<DatabaseId, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  pubmed: 'PubMed',
  'semantic-scholar': 'Semantic Scholar',
  'web-of-science': 'Web of Science',
  scopus: 'Scopus',
  'google-scholar': 'Google Scholar',
  cnki: '中国知网',
  wanfang: '万方',
}

const STAGES = [
  { id: 'search', label: '检索' },
  { id: 'evidence', label: '证据' },
  { id: 'write', label: '写作' },
  { id: 'polish', label: '校对' },
] as const

type Stage = typeof STAGES[number]['id']
type DetailTab = 'sources' | 'outline' | 'layout'
type DocumentMode = 'preview' | 'edit'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DEFAULT_REQUEST: RunRequest = {
  prompt: '',
  kind: 'search',
  degree: 'master',
  discipline: '',
  language: 'zh',
  literatureScope: 'mixed',
  journalQuality: 'any',
  databases: ['openalex', 'crossref', 'pubmed', 'semantic-scholar'],
  citationStyle: 'gb7714',
  sourceCount: 12,
  author: '',
  affiliation: '',
  journalName: '',
}

const STAGE_ORDER: Record<Stage, number> = { search: 0, evidence: 1, write: 2, polish: 3 }

function taskDefinition(kind: TaskKind): TaskDefinition {
  return TASKS.find(task => task.id === kind) ?? TASKS[0]
}

function statusText(project: ScholarProject | undefined, busy: boolean): string {
  if (busy) return '正在生成'
  if (project === undefined) return '未选择项目'
  if (project.status === 'complete') return '已完成'
  if (project.status === 'error') return '需要重试'
  return '草稿'
}

function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function upsertSummary(rows: ProjectSummary[], project: ScholarProject): ProjectSummary[] {
  const next: ProjectSummary = {
    id: project.id,
    title: project.title,
    prompt: project.prompt,
    kind: project.kind,
    status: project.status,
    sourceCount: project.sources.length,
    updatedAt: project.updatedAt,
  }
  return [next, ...rows.filter(row => row.id !== project.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function outlineOf(markdown: string): Array<{ text: string; level: number; index: number }> {
  const result: Array<{ text: string; level: number; index: number }> = []
  let index = 0
  for (const line of markdown.split('\n')) {
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line.trim())
    if (heading === null) continue
    result.push({ text: heading[2].replace(/[*_`]/gu, ''), level: heading[1].length, index: index++ })
  }
  return result
}

function sourceHref(source: LiteratureSource): string | undefined {
  if (source.doi !== undefined) return `https://doi.org/${source.doi}`
  if (source.url === undefined) return undefined
  try {
    const url = new URL(source.url)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function sourceLanguageLabel(source: LiteratureSource): string {
  const language = source.language?.toLocaleLowerCase()
  if (language?.startsWith('zh') || (language === undefined && /\p{Script=Han}/u.test(source.title))) return '中文'
  if (language?.startsWith('en')) return '英文'
  if (language?.startsWith('de')) return '德文'
  if (language?.startsWith('fr')) return '法文'
  if (language?.startsWith('es')) return '西班牙文'
  if (language?.startsWith('ja')) return '日文'
  if (language?.startsWith('ko')) return '韩文'
  return language === undefined ? '外文' : language.slice(0, 5).toLocaleUpperCase()
}

function isForeignSource(source: LiteratureSource): boolean {
  return sourceLanguageLabel(source) !== '中文'
}

function layoutMetrics(project: ScholarProject): Array<{ label: string; value: string }> {
  if (project.layout.template === 'journal') {
    return [
      { label: '纸张', value: 'A4 · 210 × 297 mm' },
      { label: '页边距', value: '上 25 / 下 25 / 左 24 / 右 24 mm' },
      { label: '正文', value: '宋体 / Times New Roman · 10.5 pt' },
      { label: '行距', value: '1.25 倍' },
    ]
  }
  const degree = project.layout.degree
  if (degree === 'doctoral') {
    return [
      { label: '纸张', value: 'A4 · 210 × 297 mm' },
      { label: '页边距', value: '上 35 / 下 28 / 左 34 / 右 28 mm' },
      { label: '正文', value: '宋体 / Times New Roman · 12 pt' },
      { label: '行距', value: '1.6 倍' },
    ]
  }
  if (degree === 'undergraduate') {
    return [
      { label: '纸张', value: 'A4 · 210 × 297 mm' },
      { label: '页边距', value: '上 25 / 下 25 / 左 30 / 右 25 mm' },
      { label: '正文', value: '宋体 / Times New Roman · 12 pt' },
      { label: '行距', value: '1.5 倍' },
    ]
  }
  return [
    { label: '纸张', value: 'A4 · 210 × 297 mm' },
    { label: '页边距', value: '上 30 / 下 25 / 左 32 / 右 26 mm' },
    { label: '正文', value: '宋体 / Times New Roman · 12 pt' },
    { label: '行距', value: '1.5 倍' },
  ]
}

function useDebouncedSave(
  project: ScholarProject | undefined,
  setProject: (project: ScholarProject) => void,
  setSaveState: (state: SaveState) => void,
) {
  const timers = useRef(new Map<string, number>())
  const pending = useRef(new Map<string, Partial<ScholarProject>>())
  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
    timers.current.clear()
    pending.current.clear()
  }, [])
  return (change: Partial<ScholarProject>, delay = 750) => {
    if (project === undefined) return
    const id = project.id
    const previousTimer = timers.current.get(id)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    pending.current.set(id, { ...pending.current.get(id), ...change })
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      const payload = pending.current.get(id)
      pending.current.delete(id)
      timers.current.delete(id)
      if (payload === undefined) return
      void patchProject(id, payload).then(
        saved => {
          setProject(saved)
          setSaveState('saved')
        },
        () => setSaveState('error'),
      )
    }, delay)
    timers.current.set(id, timer)
  }
}

export function EyanbaoWorkspace() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [project, setProjectState] = useState<ScholarProject>()
  const [health, setHealth] = useState<HealthResponse>()
  const [databases, setDatabases] = useState<DatabaseStatus[]>([])
  const [request, setRequest] = useState<RunRequest>(DEFAULT_REQUEST)
  const [view, setView] = useState<'composer' | 'document'>('composer')
  const [formatFile, setFormatFile] = useState<File | undefined>()
  const [formatBusy, setFormatBusy] = useState(false)
  const [formatTemplate, setFormatTemplate] = useState<File | undefined>()
  const [formatPreset, setFormatPreset] = useState<'baseline' | 'custom'>('baseline')
  const [formatPreview, setFormatPreview] = useState<{ changes: Array<{field: string; before: string | null; after: string}>; limitations: string; payload: Record<string, string> }>()
  const [researchMaterial, setResearchMaterial] = useState('')
  const [confirmPlan, setConfirmPlan] = useState(false)
  const [reviewSearch, setReviewSearch] = useState<{project: ScholarProject; fingerprint: string}>()
  const [reviewSourceIds, setReviewSourceIds] = useState<string[]>([])
  const [reviewSearchBusy, setReviewSearchBusy] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>('sources')
  const [documentMode, setDocumentMode] = useState<DocumentMode>('preview')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<Stage>()
  const [liveText, setLiveText] = useState('')
  const [error, setError] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  const [loadingProject, setLoadingProject] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [toast, setToast] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const abortRef = useRef<AbortController>()
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const aiTriggerRef = useRef<HTMLButtonElement>(null)
  const taskRefs = useRef<Partial<Record<TaskKind, HTMLButtonElement>>>({})
  const deferredFilter = useDeferredValue(projectFilter)
  const setProject = (next: ScholarProject) => {
    setProjectState(next)
    setProjects(rows => upsertSummary(rows, next))
  }
  const queueSave = useDebouncedSave(project, setProject, setSaveState)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([listProjects(controller.signal), getHealth(controller.signal), getDatabases(controller.signal)]).then(
      ([rows, nextHealth, nextDatabases]) => {
        setProjects(rows)
        setHealth(nextHealth)
        setDatabases(nextDatabases)
        const available = nextDatabases.filter(item => item.available).map(item => item.id)
        if (available.length > 0) {
          setRequest(current => ({ ...current, databases: available }))
        }
      },
      () => setHealth({ ok: false, modelReady: false, message: '无法连接 e研宝服务。' }),
    )
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!railOpen) return
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setRailOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [railOpen])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const filteredProjects = useMemo(() => {
    const query = deferredFilter.trim().toLocaleLowerCase()
    if (query === '') return projects
    return projects.filter(project => `${project.title} ${project.prompt}`.toLocaleLowerCase().includes(query))
  }, [deferredFilter, projects])

  const currentTask = taskDefinition(request.kind)
  const layoutMode = request.kind === 'journal-layout' || request.kind === 'thesis-layout'
  const degreeVisible = request.kind === 'thesis' || request.kind === 'thesis-layout'
  const journalQualityVisible = request.literatureScope === 'foreign'
  const displayedContent = busy ? liveText : project?.content ?? ''
  const outline = useMemo(() => outlineOf(displayedContent), [displayedContent])
  const canExport = project !== undefined && project.content.trim() !== '' && !busy
  const modelUnavailable = request.kind !== 'search' && health?.modelReady === false
  const selectedDatabases = request.databases
  const reviewFingerprint = JSON.stringify({ prompt: request.prompt.trim(), discipline: request.discipline, language: request.language, literatureScope: request.literatureScope, journalQuality: request.journalQuality, databases: request.databases, yearFrom: request.yearFrom, sourceCount: request.sourceCount })
  const reviewSourcesCurrent = reviewSearch !== undefined && reviewSearch.fingerprint === reviewFingerprint

  useEffect(() => {
    if (reviewSearch && reviewSearch.fingerprint !== reviewFingerprint) {
      setReviewSearch(undefined)
      setReviewSourceIds([])
      setConfirmPlan(false)
    }
  }, [reviewFingerprint, reviewSearch])

  const newStudy = () => {
    abortRef.current?.abort()
    setView('composer')
    setProjectState(undefined)
    setRequest(current => ({ ...current, prompt: '' }))
    setResearchMaterial('')
    setConfirmPlan(false)
    setReviewSearch(undefined)
    setReviewSourceIds([])
    setDetailTab('sources')
    setDocumentMode('preview')
    setLiveText('')
    setStage(undefined)
    setError('')
    setRailOpen(false)
    setAiOpen(false)
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }

  const closeAssistant = () => {
    setAiOpen(false)
    window.setTimeout(() => aiTriggerRef.current?.focus(), 0)
  }

  const applyAssistant = (text: string, replace: boolean) => {
    setRequest(current => ({
      ...current,
      prompt: replace ? text : `${current.prompt.trim()}\n\n${text}`,
    }))
    closeAssistant()
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }

  const openProject = async (id: string) => {
    if (busy) return
    setLoadingProject(true)
    setError('')
    setRailOpen(false)
    try {
      const next = await getProject(id)
      setProjectState(next)
      setRequest(current => ({
        ...current,
        prompt: next.prompt,
        kind: next.kind,
        degree: next.layout.degree,
        discipline: next.discipline,
        language: next.language,
        literatureScope: next.literatureScope ?? 'mixed',
        journalQuality: next.journalQuality ?? 'any',
        databases: next.databases ?? ['openalex', 'crossref', 'semantic-scholar'],
        citationStyle: next.citationStyle,
        yearFrom: next.yearFrom,
        sourceCount: next.sourceCount,
        author: next.layout.author,
        affiliation: next.layout.affiliation,
        journalName: next.layout.journalName,
      }))
      setDetailTab(next.sources.length > 0 ? 'sources' : 'outline')
      setDocumentMode('preview')
      setView('document')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开研究项目')
    } finally {
      setLoadingProject(false)
    }
  }

  const chooseSample = (task: TaskDefinition) => {
    if ((request.prompt.trim() || researchMaterial.trim()) && !window.confirm('使用示例会覆盖当前研究需求和材料，并调整相关筛选条件，是否继续？')) return
    setRequest(current => ({ ...current, kind: task.id, prompt: task.sample,
      ...(task.id === 'thesis' || task.id === 'thesis-layout' ? { degree: 'master' as const, discipline: '教育学', affiliation: '' } : {}),
      ...(task.id === 'journal' ? { journalName: '' } : {}),
      ...(task.id === 'search' ? { yearFrom: 2021, literatureScope: 'foreign' as const, databases: ['openalex', 'crossref', 'semantic-scholar'] as DatabaseId[] } : {}),
    }))
    setResearchMaterial(MATERIAL_HINTS[task.id]?.sample ?? '')
    setConfirmPlan(false)
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }

  const selectTask = (kind: TaskKind) => {
    if (formatBusy || reviewSearchBusy) return
    setConfirmPlan(false)
    setFormatPreview(undefined)
    setReviewSearch(undefined)
    setReviewSourceIds([])
    setRequest(current => ({ ...current, kind }))
  }

  const toggleDatabase = (id: DatabaseId) => {
    if (busy || databases.find(item => item.id === id)?.available === false) return
    setRequest(current => ({
      ...current,
      databases: current.databases.includes(id)
        ? current.databases.filter(item => item !== id)
        : [...current.databases, id],
    }))
  }

  const onTaskKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % TASKS.length
    else if (event.key === 'ArrowLeft') next = (index + TASKS.length - 1) % TASKS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TASKS.length - 1
    else return
    event.preventDefault()
    const kind = TASKS[next].id
    selectTask(kind)
    taskRefs.current[kind]?.focus()
  }

  const startResearch = async () => {
    if (request.prompt.trim().length < 4) {
      setError('请至少输入四个字的研究需求。')
      promptRef.current?.focus()
      return
    }
    if (modelUnavailable) {
      setError(health?.message ?? '请先在模型设置中配置默认文字模型。')
      return
    }
    if (request.databases.length === 0) {
      setError('请至少选择一个文献数据库。')
      return
    }
    if (request.kind === 'review' && (!reviewSourcesCurrent || !reviewSearch || reviewSourceIds.length === 0)) {
      setError('请先按当前条件检索并至少选择一条文献。')
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    setLiveText('')
    setStage('search')
    setView('document')
    setDetailTab('sources')
    setDocumentMode('preview')
    let sawProject = false
    try {
      await runResearch({ ...request, ...(request.kind !== 'search' && researchMaterial.trim() ? { researchMaterial: researchMaterial.trim() } : {}), ...(request.kind === 'review' && reviewSearch ? { sourceProjectId: reviewSearch.project.id, selectedSourceIds: reviewSourceIds } : {}) }, (event: StreamEvent) => {
        if (event.type === 'project') {
          sawProject = true
          setProject(event.project)
        }
        else if (event.type === 'status') {
          setStage(event.stage)
          setProjectState(current => current === undefined ? current : { ...current, status: 'running' })
        } else if (event.type === 'sources') {
          setProjectState(current => current === undefined ? current : {
            ...current,
            sources: event.sources,
            warning: event.warning,
          })
        } else if (event.type === 'delta') {
          setLiveText(current => current + event.text)
        } else if (event.type === 'result') {
          setProject(event.project)
          setLiveText('')
          setStage('polish')
          setProjects(rows => upsertSummary(rows, event.project))
        } else if (event.type === 'error') {
          setError(event.message)
          if (event.project !== undefined) setProject(event.project)
          else setProjectState(current => current === undefined ? current : { ...current, status: 'error', error: event.message })
        }
      }, controller.signal)
      setToast(request.kind === 'search' ? '文献检索完成' : '初稿已生成')
      void getHealth().then(setHealth, () => undefined)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '研究请求失败')
        if (!sawProject) setView('composer')
      }
    } finally {
      setBusy(false)
      setStage(undefined)
      abortRef.current = undefined
    }
  }

  const searchForReview = async () => {
    if (request.prompt.trim().length < 4 || request.databases.length === 0) { setError('请先填写研究需求并选择数据库。'); return }
    const controller = new AbortController()
    abortRef.current = controller
    setReviewSearchBusy(true); setReviewSearch(undefined); setReviewSourceIds([]); setConfirmPlan(false); setError('')
    try {
      let result: ScholarProject | undefined
      await runResearch({ ...request, kind: 'search' }, event => {
        if (event.type === 'result') result = event.project
        else if (event.type === 'error') throw new Error(event.message)
      }, controller.signal)
      if (!result) throw new Error('检索未返回结果。')
      setReviewSearch({ project: result, fingerprint: reviewFingerprint })
      setReviewSourceIds([])
      if (result.sources.length === 0) setError('没有检索到文献，请调整条件重试。')
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '检索失败') }
    finally { setReviewSearchBusy(false); abortRef.current = undefined }
  }

  const readFileBase64 = async (file: File): Promise<string> => await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })

  const previewFormat = async () => {
    if (!formatFile || !formatFile.name.toLowerCase().endsWith('.docx')) { setError('请选择 DOCX 原稿。'); return }
    if (formatFile.size > 8 * 1024 * 1024) { setError('原稿不能超过 8 MiB。'); return }
    if (formatPreset === 'custom' && (!formatTemplate || !formatTemplate.name.toLowerCase().endsWith('.docx'))) { setError('请选择 DOCX 模板。'); return }
    if (formatPreset === 'custom' && formatTemplate && formatTemplate.size > 8 * 1024 * 1024) { setError('模板不能超过 8 MiB。'); return }
    setFormatBusy(true); setError(''); setFormatPreview(undefined)
    try {
      const payload: Record<string, string> = { fileName: formatFile.name, dataBase64: await readFileBase64(formatFile), preset: formatPreset === 'custom' ? 'custom' : request.kind === 'journal-layout' ? 'journal' : 'thesis' }
      if (formatPreset === 'custom' && formatTemplate) { payload.templateFileName = formatTemplate.name; payload.templateBase64 = await readFileBase64(formatTemplate) }
      const response = await fetch(`${API}/format-preview`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eyanbao': '1' }, body: JSON.stringify(payload) })
      const body = await response.json() as { changes?: Array<{field: string; before: string | null; after: string}>; limitations?: string; error?: string }
      if (!response.ok || !Array.isArray(body.changes) || !body.limitations) throw new Error(body.error ?? '无法读取排版预览。')
      setFormatPreview({ changes: body.changes, limitations: body.limitations, payload })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '排版预览失败') }
    finally { setFormatBusy(false) }
  }

  const startFormat = async () => {
    if (!formatPreview) { setError('请先预览并确认排版差异。'); return }
    setFormatBusy(true); setError('')
    try {
      const response = await fetch(`${API}/format-docx`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-eyanbao': '1' },
        body: JSON.stringify({ ...formatPreview.payload, confirmed: true }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `排版失败（HTTP ${response.status}）`)
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url; link.download = `${formatPreview.payload.fileName.replace(/\.docx$/i, '')}-排版副本.docx`
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setToast('排版副本已下载，请核对格式与原稿内容。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '排版失败') }
    finally { setFormatBusy(false) }
  }

  const stopResearch = () => {
    const id = project?.id
    abortRef.current?.abort()
    setBusy(false)
    setStage(undefined)
    setToast('已停止生成，当前内容已保留')
    if (id !== undefined) {
      window.setTimeout(() => {
        void getProject(id).then(setProjectState, () => undefined)
      }, 250)
    }
  }

  const updateContent = (content: string) => {
    if (project === undefined) return
    const next = { ...project, content }
    setProjectState(next)
    queueSave({ content })
  }

  const updateLayout = (change: Partial<ScholarProject['layout']>) => {
    if (project === undefined) return
    const nextLayout = { ...project.layout, ...change }
    const next = { ...project, layout: nextLayout }
    setProjectState(next)
    queueSave({ layout: nextLayout })
  }

  const saveNow = () => {
    if (project === undefined) return
    queueSave({ title: project.title, content: project.content, layout: project.layout }, 0)
  }

  const renderRail = () => (
    <aside className="ey-rail" aria-label="研究项目">
      <div className="ey-rail-head">
        <h2>研究项目</h2>
        <button type="button" className="ey-icon-button" aria-label="新建研究" title="新建研究" onClick={newStudy}>
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="ey-rail-search">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="筛选研究项目"
          value={projectFilter}
          onChange={event => setProjectFilter(event.target.value)}
          placeholder="筛选项目"
        />
      </div>
      <div className="ey-project-list">
        {filteredProjects.length === 0 ? (
          <div className="ey-rail-empty">当前没有研究项目</div>
        ) : filteredProjects.map(row => {
          const definition = taskDefinition(row.kind)
          const Icon = definition.icon
          return (
            <button
              type="button"
              className="ey-project"
              key={row.id}
              aria-current={project?.id === row.id && view === 'document' ? 'true' : undefined}
              disabled={busy || loadingProject}
              onClick={() => void openProject(row.id)}
            >
              <span className="ey-project-icon"><Icon size={16} aria-hidden="true" /></span>
              <span className="ey-project-main">
                <span className="ey-project-title">{row.title}</span>
                <span className="ey-project-meta">{definition.label} · {shortDate(row.updatedAt)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )

  const renderComposer = () => (
    <div className="ey-compose-layout">
        <aside className="ey-composer-nav" aria-label="研究任务导航">
          <button
            ref={aiTriggerRef}
            type="button"
            className="ey-icon-button ey-ai-trigger"
            aria-label="打开 AI 研究助手"
            aria-expanded={aiOpen}
            aria-controls="ey-ai-assistant"
            title="AI 研究助手"
            onClick={() => setAiOpen(current => !current)}
          >
            <Sparkles size={19} aria-hidden="true" />
          </button>
          <div className="ey-task-tabs" role="group" aria-label="研究任务类型">
            {TASKS.map((task, index) => {
              const Icon = task.icon
              return (
                <div className="ey-nav-entry" key={task.id}>
                  {(index === 0 || index === 2 || index === 5) && <div className="ey-nav-group">{index === 0 ? "查找与梳理" : index === 2 ? "撰写与研究" : "格式与导出"}</div>}
                <button
                  type="button"
                  className="ey-task"
                  id={`ey-task-${task.id}`}
                  ref={element => { if (element) taskRefs.current[task.id] = element }}
                  aria-pressed={request.kind === task.id}
                  disabled={formatBusy || reviewSearchBusy}
                  onClick={() => selectTask(task.id)}
                  onKeyDown={event => onTaskKey(event, index)}
                >
                  <Icon size={17} aria-hidden="true" />
                  {task.label}
                </button>
                </div>
              )
            })}
          </div>
        </aside>
      <div className="ey-main-inner ey-compose-main">
      <div className="ey-compose-head">
        <div>
          <div className="ey-kicker">{request.kind === 'search' || request.kind === 'review' ? '查找与梳理' : layoutMode ? '格式与导出' : '撰写与研究'}</div>
          <h2>{currentTask.label}</h2>
          <p>{TASK_DETAILS[request.kind].description}</p>
        </div>
        <div className="ey-steps" aria-label="流程：填写材料、预览确认、生成与检查"><b>❶ 填写材料</b><span>— ② 预览确认 — ③ 生成与检查</span></div>
      </div>
      <div className="ey-compose-columns">
      <section className="ey-composer" aria-label="研究任务">
        <div className="ey-card-heading"><div><h3>填写任务</h3><p>{TASK_DETAILS[request.kind].description}</p></div>{!layoutMode && <button type="button" className="ey-example" onClick={() => chooseSample(currentTask)}>＋ 使用完整示例</button>}</div>
        {aiOpen && (
          <div id="ey-ai-assistant">
            <AiAssistant
              context={{
                prompt: request.prompt,
                kind: request.kind,
                degree: request.degree,
                discipline: request.discipline,
                language: request.language,
                literatureScope: request.literatureScope,
                journalQuality: request.journalQuality,
                databases: request.databases,
              }}
              onApply={applyAssistant}
              onClose={closeAssistant}
            />
          </div>
        )}
        {layoutMode ? (
          <div className="ey-format-panel">
            <details><summary>查看使用示例</summary><p>{request.kind === 'journal-layout' ? '例如：选择已有投稿论文，生成一份使用通用基线的副本，再按目标期刊要求手动核对。' : '例如：选择已有硕士论文，生成通用基线副本，再按学校最新规范手动核对。'}</p></details>
            <label className="ey-label" htmlFor="ey-format-file">已有 Word 稿件（DOCX，最大 8 MiB）</label>
            <input id="ey-format-file" type="file" disabled={formatBusy} accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => { setFormatFile(event.target.files?.[0]); setFormatPreview(undefined); setError('') }} />
            <label className="ey-label" htmlFor="ey-format-preset">模板来源</label>
            <select id="ey-format-preset" className="ey-select" disabled={formatBusy} value={formatPreset} onChange={event => { setFormatPreset(event.target.value as 'baseline' | 'custom'); setFormatPreview(undefined) }}><option value="baseline">通用格式基线</option><option value="custom">使用自己的 Word 模板</option></select>
            {formatPreset === 'custom' && <><label className="ey-label" htmlFor="ey-format-template">Word 模板（DOCX，最大 8 MiB）</label><input id="ey-format-template" type="file" disabled={formatBusy} accept=".docx" onChange={event => { setFormatTemplate(event.target.files?.[0]); setFormatPreview(undefined) }} /></>}
            <p>只比较和修改文档默认字体、字号、行距；原有命名样式及直接格式可能覆盖默认值。模板其他设置及引用格式不会迁移。请核对目标规范、公式、图表和参考文献。</p>
            <p>原文件保持不变，完成后下载一份副本。文件只提交给本机插件处理。</p>
            {error && <div className="ey-error" role="alert">{error}</div>}
            <button type="button" className="ey-button ey-button-primary" disabled={!formatFile || formatBusy} onClick={() => void previewFormat()}>{formatBusy ? '处理中…' : '预览格式变化'}</button>
            {formatPreview && <section className="ey-confirm-plan" aria-label="排版差异预览"><h3>请确认格式变化</h3><ul>{formatPreview.changes.map((change, index) => <li key={index}>{change.field}：{change.before ?? '未设置'} → {change.after}</li>)}</ul><p>{formatPreview.limitations}</p><button type="button" className="ey-button ey-button-primary" disabled={formatBusy} onClick={() => void startFormat()}>确认并下载副本</button></section>}
          </div>
        ) : (<>
        <div className="ey-prompt-wrap">
          <label className="ey-label" htmlFor="ey-research-prompt">研究主题或要求</label>
          {request.kind !== 'search' && <p className="ey-task-guidance">当前版本会先检索再生成草稿，不支持上传文件；生成内容和引用均需人工核验。</p>}
          <textarea
            ref={promptRef}
            id="ey-research-prompt"
            className="ey-prompt"
            value={request.prompt}
            maxLength={4000}
            onChange={event => setRequest(current => ({ ...current, prompt: event.target.value }))}
            placeholder="例如：生成一份关于生成式 AI 对知识工作影响的文献综述，聚焦 2021 年后的实证研究"
            aria-describedby={error ? 'ey-compose-error' : undefined}
          />
          {error !== '' && (
            <div className="ey-error ey-compose-error" id="ey-compose-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>
        {request.kind !== 'search' && <div className="ey-prompt-wrap">
          {request.kind === 'journal' && <div className="ey-field"><label htmlFor="ey-target-journal">目标期刊（选填）</label><input id="ey-target-journal" className="ey-input" value={request.journalName} placeholder="请填写实际目标期刊" onChange={event => setRequest(current => ({ ...current, journalName: event.target.value }))} /></div>}
          {request.kind === 'thesis' && <div className="ey-field"><label htmlFor="ey-target-school">学校或单位（选填）</label><input id="ey-target-school" className="ey-input" value={request.affiliation} placeholder="请填写实际学校" onChange={event => setRequest(current => ({ ...current, affiliation: event.target.value }))} /></div>}
          <label className="ey-label" htmlFor="ey-research-material">{MATERIAL_HINTS[request.kind]?.label ?? '已有研究材料'}（选填，最多 10000 字）</label>
          <textarea id="ey-research-material" className="ey-prompt" maxLength={10000} value={researchMaterial} onChange={event => setResearchMaterial(event.target.value)} placeholder={MATERIAL_HINTS[request.kind]?.placeholder ?? '粘贴已有材料；不足的部分请说明待补充。'} />
          <p className="ey-task-guidance">材料会发送给你配置的文字模型提供方用于生成；不会作为数据库检索词，也不会单独保存到项目，但生成的草稿可能包含其中内容。请仅输入你有权使用的内容。</p>
        </div>}
        <div className="ey-compose-footer">
          <div className="ey-suggestions" aria-label="示例研究需求">
            <button type="button" className="ey-chip" onClick={() => chooseSample(currentTask)}>{currentTask.sample}</button>
          </div>
          {request.kind === 'review' && <button type="button" className="ey-button" disabled={reviewSearchBusy || request.prompt.trim().length < 4 || request.databases.length === 0} onClick={() => void searchForReview()}>{reviewSearchBusy ? '正在检索…' : '检索并选择文献'}</button>}
          <button
            type="button"
            className="ey-button ey-button-primary"
            disabled={request.prompt.trim().length < 4 || modelUnavailable || request.databases.length === 0 || reviewSearchBusy || (request.kind === 'review' && (!reviewSourcesCurrent || reviewSourceIds.length === 0))}
            onClick={() => request.kind === 'search' ? void startResearch() : setConfirmPlan(true)}
          >
            <BookOpenText size={17} aria-hidden="true" />
            {request.kind === 'search' ? TASK_DETAILS[request.kind].action : '检查并确认'}
          </button>
        </div>
        {request.kind === 'review' && reviewSearch && <section className="ey-confirm-plan" aria-label="选择综述文献">
          <h3>选择综述文献</h3>
          {!reviewSourcesCurrent ? <p>检索条件已变化，请重新检索。</p> : <><p>已选择 {reviewSourceIds.length} 篇。请检查来源链接及摘要；系统未核实全文和研究结论。</p>{reviewSearch.project.warning && <p>{reviewSearch.project.warning}</p>}
            {reviewSearch.project.sources.map(source => <label key={source.id} style={{display:'block', margin:'8px 0'}}><input type="checkbox" checked={reviewSourceIds.includes(source.id)} onChange={event => { setConfirmPlan(false); setReviewSourceIds(current => event.target.checked ? [...current, source.id] : current.filter(id => id !== source.id)) }} /> {source.title}（{DATABASE_LABELS[source.source]}，{source.year ?? '年份未知'}）{sourceHref(source) && <> · <a href={sourceHref(source)} target="_blank" rel="noopener noreferrer">查看来源</a></>}</label>)}
          </>}
        </section>}
        {confirmPlan && request.kind !== 'search' && <section className="ey-confirm-plan" aria-label="确认生成内容">
          <h3>确认后开始生成</h3>
          <p>任务：{currentTask.label}；文献库：{request.databases.map(id => DATABASE_LABELS[id]).join('、')}；文献数量：{request.sourceCount}；起始年份：{request.yearFrom ?? '不限'}。</p>
          <p>研究需求：{request.prompt}</p>
          {request.kind === 'review' && reviewSearch && <p>已选文献：{reviewSearch.project.sources.filter(source => reviewSourceIds.includes(source.id)).map(source => source.title).join('；')}</p>}
          {request.kind === 'journal' && <p>目标期刊：{request.journalName || '未填写'}</p>}
          {request.kind === 'thesis' && <p>学校或单位：{request.affiliation || '未填写'}；学位：{DEGREE_LABELS[request.degree]}；学科：{request.discipline || '未填写'}。</p>}
          <p>研究材料：{researchMaterial.trim() || '未提供，将标记待补充。'}</p>
          <p>确认后将以研究需求检索文献，并把研究材料及来源交给配置的模型生成草稿；引用和结论需要人工核对。</p>
          <div><button type="button" className="ey-button" onClick={() => setConfirmPlan(false)}>继续修改</button>{' '}<button type="button" className="ey-button ey-button-primary" onClick={() => { setConfirmPlan(false); void startResearch() }}>确认并生成草稿</button></div>
        </section>}
        <div className="ey-controls">
          <div className="ey-field">
            <label htmlFor="ey-citation">引用格式</label>
            <select
              id="ey-citation"
              className="ey-select"
              value={request.citationStyle}
              onChange={event => setRequest(current => ({
                ...current,
                citationStyle: event.target.value as RunRequest['citationStyle'],
              }))}
            >
              {CITATION_STYLES.map(style => <option key={style} value={style}>{CITATION_LABELS[style]}</option>)}
            </select>
            <small>DOCX 导出引用样式尚需人工核对。</small>
          </div>
          <div className="ey-field">
            <label htmlFor="ey-literature-scope">文献范围</label>
            <select
              id="ey-literature-scope"
              className="ey-select"
              value={request.literatureScope}
              onChange={event => setRequest(current => ({
                ...current,
                literatureScope: event.target.value as LiteratureScope,
              }))}
            >
              {LITERATURE_SCOPES.map(scope => (
                <option key={scope} value={scope}>{LITERATURE_SCOPE_LABELS[scope]}</option>
              ))}
            </select>
          </div>
          {journalQualityVisible && (
            <div className="ey-field">
              <label htmlFor="ey-journal-quality">期刊层级</label>
              <select
                id="ey-journal-quality"
                className="ey-select"
                value={request.journalQuality}
                onChange={event => setRequest(current => ({
                  ...current,
                  journalQuality: event.target.value as JournalQuality,
                }))}
              >
                {JOURNAL_QUALITIES.map(quality => (
                  <option key={quality} value={quality}>{JOURNAL_QUALITY_LABELS[quality]}</option>
                ))}
              </select>
            </div>
          )}
          {degreeVisible && (
            <div className="ey-field">
              <span className="ey-field-label" id="ey-degree-label">论文层次</span>
              <div className="ey-segment" role="group" aria-labelledby="ey-degree-label">
                {DEGREES.map(level => (
                  <button
                    type="button"
                    key={level}
                    aria-pressed={request.degree === level}
                    onClick={() => setRequest(current => ({ ...current, degree: level }))}
                  >
                    {DEGREE_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          )}
            <div className="ey-field">
              <label htmlFor="ey-discipline">学科领域</label>
              <input
                id="ey-discipline"
                className="ey-input"
                value={request.discipline}
                onChange={event => setRequest(current => ({ ...current, discipline: event.target.value }))}
                placeholder="教育学、管理学、计算机…"
              />
            </div>
          <div className="ey-field">
            <label htmlFor="ey-source-count">文献数量</label>
            <input
              id="ey-source-count"
              className="ey-input"
              type="number"
              min={3}
              max={30}
              value={request.sourceCount}
              onChange={event => setRequest(current => ({
                ...current,
                sourceCount: Math.min(30, Math.max(3, Number(event.target.value) || 12)),
              }))}
            />
          </div>
          <div className="ey-field">
            <label htmlFor="ey-year-from">起始年份</label>
            <input
              id="ey-year-from"
              className="ey-input"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              value={request.yearFrom ?? ''}
              onChange={event => setRequest(current => ({
                ...current,
                yearFrom: event.target.value === '' ? undefined : Number(event.target.value),
              }))}
              placeholder="不限"
            />
          </div>
        </div>
        <details className="ey-database-picker">
          <summary>
            <Database size={16} aria-hidden="true" />
            <span>文献数据库</span>
            <strong>{selectedDatabases.length} 个已选</strong>
          </summary>
          <div className="ey-database-options">
            {(databases.length === 0
              ? Object.entries(DATABASE_LABELS).map(([id, label]) => ({
                  id: id as DatabaseId,
                  label,
                  available: ['openalex', 'crossref', 'pubmed', 'semantic-scholar'].includes(id),
                  requiresConfiguration: !['openalex', 'crossref', 'pubmed', 'semantic-scholar'].includes(id),
                  reason: ['openalex', 'crossref', 'pubmed', 'semantic-scholar'].includes(id)
                    ? undefined
                    : '需要配置 API 凭据',
                }))
              : databases
            ).map(database => (
              <label
                className="ey-database-option"
                key={database.id}
                data-available={database.available ? 'true' : 'false'}
                title={database.reason}
              >
                <input
                  type="checkbox"
                  checked={selectedDatabases.includes(database.id)}
                  disabled={busy || !database.available}
                  onChange={() => toggleDatabase(database.id)}
                />
                <span>
                  <strong>{database.label}</strong>
                  <small>{database.available ? '可选 · 连接尚未检测' : database.reason ?? '未配置'}</small>
                </span>
              </label>
            ))}
          </div>
          <p>检索时会尝试选中的数据库并合并去重；连接状态以实际请求结果为准。PubMed 主要适用于生物医学。</p>
        </details>
        <details className="ey-advanced ey-compose-advanced">
          <summary><Settings2 size={15} aria-hidden="true" />论文信息</summary>
          <div className="ey-advanced-grid">
            <div className="ey-field">
              <label htmlFor="ey-author">作者</label>
              <input id="ey-author" className="ey-input" value={request.author} onChange={event => setRequest(current => ({ ...current, author: event.target.value }))} />
            </div>
            <div className="ey-field">
              <label htmlFor="ey-affiliation">单位</label>
              <input id="ey-affiliation" className="ey-input" value={request.affiliation} onChange={event => setRequest(current => ({ ...current, affiliation: event.target.value }))} />
            </div>
            <div className="ey-field">
              <label htmlFor="ey-journal">目标期刊</label>
              <input id="ey-journal" className="ey-input" value={request.journalName} onChange={event => setRequest(current => ({ ...current, journalName: event.target.value }))} />
            </div>
          </div>
        </details>
        </>)}
      </section>
      <aside className="ey-summary" aria-label="任务说明"><div className="ey-summary-label">你将得到</div><h3>{TASK_DETAILS[request.kind].output}</h3><p>{TASK_DETAILS[request.kind].description}</p><hr /><div className="ey-summary-label">流程包含</div><ul><li>填写和检查任务材料</li><li>{layoutMode ? '预览格式变化并确认' : request.kind === 'review' ? '检索并选择文献' : '检查来源与研究内容'}</li><li>{layoutMode ? '下载副本并人工核对' : '结果和引用需要人工核对'}</li></ul><div className="ey-summary-note">{layoutMode ? '模板仅应用默认字体、字号与行距；请核对最新规范。' : '来源需核实，生成的研究内容和引用需要作者检查。'}</div></aside>
      </div>
      <section className="ey-recents" aria-labelledby="ey-recent-title">
        <div className="ey-section-head">
          <h3 id="ey-recent-title">最近研究</h3>
          <span>{projects.length} 个项目</span>
        </div>
        {filteredProjects.length === 0 ? (
          <div className="ey-empty-state">
            <div><strong>还没有研究项目</strong>输入研究需求即可创建第一份稿件。</div>
          </div>
        ) : (
          <div className="ey-recent-grid">
            {filteredProjects.slice(0, 6).map(row => {
              const definition = taskDefinition(row.kind)
              return (
                <button type="button" className="ey-recent" key={row.id} onClick={() => void openProject(row.id)}>
                  <h4>{row.title}</h4>
                  <div className="ey-recent-meta">
                    <span>{definition.label}</span>
                    <span>{row.sourceCount} 篇来源</span>
                    <span className="ey-status" data-status={row.status}>{row.status === 'complete' ? '已完成' : row.status === 'running' ? '进行中' : row.status === 'error' ? '失败' : '草稿'}</span>
                    <span>{shortDate(row.updatedAt)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>
      </div>
    </div>
  )

  const renderSources = () => {
    if (project === undefined || project.sources.length === 0) {
      return <div className="ey-rail-empty">尚未检索到来源</div>
    }
    const databaseCounts = new Map<DatabaseId, number>()
    for (const source of project.sources) {
      databaseCounts.set(source.source, (databaseCounts.get(source.source) ?? 0) + 1)
    }
    return (
      <div>
        <div className="ey-source-stats" role="group" aria-label="文献来源统计">
          {[...databaseCounts.entries()].map(([database, count]) => (
            <span className="ey-source-stat" key={database}>
              {DATABASE_LABELS[database]} {count} 篇
            </span>
          ))}
        </div>
        {project.sources.map((source: LiteratureSource, index) => {
          const href = sourceHref(source)
          return (
            <article className="ey-source" key={source.id}>
              <h4 className="ey-source-title">[{index + 1}] {source.title}</h4>
              <div className="ey-source-meta">
                <span className="ey-source-database">{DATABASE_LABELS[source.source]}</span>
                {source.topJournal === true && <span className="ey-source-language" data-top="true">顶刊</span>}
                <span className="ey-source-language" data-foreign={isForeignSource(source) ? 'true' : undefined}>
                  {sourceLanguageLabel(source)}
                </span>
                {source.authors.slice(0, 4).join('、') || '佚名'}
                {source.year === undefined ? '' : ` · ${source.year}`}
                {source.venue === undefined ? '' : ` · ${source.venue}`}
              </div>
              {source.abstract !== undefined && <p className="ey-source-abstract">{source.abstract}</p>}
              {href !== undefined && (
                <a className="ey-source-link" href={href} target="_blank" rel="noreferrer">
                  查看原文 <ChevronRight size={13} aria-hidden="true" />
                </a>
              )}
            </article>
          )
        })}
      </div>
    )
  }

  const renderOutline = () => (
    outline.length === 0 ? <div className="ey-rail-empty">正文生成后显示章节结构</div> : (
      <nav className="ey-outline" aria-label="稿件目录">
        {outline.map(item => (
          <a key={`${item.index}-${item.text}`} href={`#ey-heading-${item.index}`} data-level={item.level}>{item.text}</a>
        ))}
      </nav>
    )
  )

  const renderLayout = () => {
    if (project === undefined) return null
    return (
      <div className="ey-layout-panel">
        <div className="ey-layout-section">
          <h4>模板</h4>
          <div className="ey-segment" role="group" aria-label="排版模板">
            <button type="button" aria-pressed={project.layout.template === 'journal'} onClick={() => updateLayout({ template: 'journal' })}>期刊</button>
            <button type="button" aria-pressed={project.layout.template === 'thesis'} onClick={() => updateLayout({ template: 'thesis' })}>学位论文</button>
          </div>
        </div>
        {project.layout.template === 'thesis' ? (
          <div className="ey-layout-section">
            <h4>学位层次</h4>
            <div className="ey-segment" role="group" aria-label="学位论文层次">
              {DEGREES.map(level => (
                <button type="button" key={level} aria-pressed={project.layout.degree === level} onClick={() => updateLayout({ degree: level })}>
                  {DEGREE_LABELS[level]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ey-layout-section">
            <div className="ey-field">
              <label htmlFor="ey-layout-journal">目标期刊</label>
              <input id="ey-layout-journal" className="ey-input" value={project.layout.journalName} onChange={event => updateLayout({ journalName: event.target.value })} />
            </div>
          </div>
        )}
        <div className="ey-layout-section">
          <div className="ey-field">
            <label htmlFor="ey-layout-author">作者</label>
            <input id="ey-layout-author" className="ey-input" value={project.layout.author} onChange={event => updateLayout({ author: event.target.value })} />
          </div>
          <div className="ey-field">
            <label htmlFor="ey-layout-affiliation">单位</label>
            <input id="ey-layout-affiliation" className="ey-input" value={project.layout.affiliation} onChange={event => updateLayout({ affiliation: event.target.value })} />
          </div>
        </div>
        <div className="ey-layout-section">
          <h4>页面规格</h4>
          <div className="ey-metrics">
            {layoutMetrics(project).map(metric => (
              <div className="ey-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
          <a className="ey-button ey-button-accent" href={exportUrl(project.id, 'docx')} download>
            <Download size={17} aria-hidden="true" />
            导出 DOCX
          </a>
        </div>
      </div>
    )
  }

  const renderDocument = () => {
    if (project === undefined) {
      return (
        <div className="ey-main-inner">
          <div className="ey-empty-state">
            <div><strong>{loadingProject ? '正在打开项目' : '尚未打开研究项目'}</strong>{loadingProject ? '请稍候。' : '从左侧选择项目，或新建研究。'}</div>
          </div>
        </div>
      )
    }
    const definition = taskDefinition(project.kind)
    const TaskIcon = definition.icon
    const stageIndex = stage === undefined ? -1 : STAGE_ORDER[stage]
    return (
      <div className="ey-main-inner">
        <div className="ey-workspace">
          <div className="ey-doc-topbar">
            <div className="ey-doc-heading">
              <h2>{project.title}</h2>
              <div className="ey-doc-meta">
                <span className="ey-status" data-status={project.status}>{statusText(project, busy)}</span>
                <span>{definition.label}</span>
                <span>{project.sources.length} 篇来源</span>
                <span>{project.databases?.length ?? 2} 个数据库</span>
                <span>{LITERATURE_SCOPE_LABELS[project.literatureScope ?? 'mixed']}</span>
                {project.literatureScope === 'foreign' && project.journalQuality !== 'any' && (
                  <span>{JOURNAL_QUALITY_LABELS[project.journalQuality]}</span>
                )}
                <span>{CITATION_LABELS[project.citationStyle]}</span>
                {project.layout.template === 'thesis' && <span>{DEGREE_LABELS[project.layout.degree]}论文</span>}
              </div>
            </div>
            <div className="ey-doc-actions">
              <button type="button" className="ey-button ey-button-quiet" onClick={newStudy}>
                <Plus size={16} aria-hidden="true" />
                新建
              </button>
              <a
                className="ey-button"
                href={exportUrl(project.id, 'md')}
                download
                aria-disabled={!canExport}
                onClick={event => { if (!canExport) event.preventDefault() }}
              >
                <Download size={16} aria-hidden="true" />
                Markdown
              </a>
              <a
                className="ey-button ey-button-accent"
                href={exportUrl(project.id, 'docx')}
                download
                aria-disabled={!canExport}
                onClick={event => { if (!canExport) event.preventDefault() }}
              >
                <Download size={16} aria-hidden="true" />
                DOCX
              </a>
            </div>
          </div>
          {(busy || error !== '' || project.warning !== undefined) && (
            <div className="ey-run-banner" data-busy={busy ? 'true' : undefined} role={error === '' ? 'status' : 'alert'} aria-live="polite">
              {busy
                ? <LoaderCircle className="ey-spin" size={19} aria-hidden="true" />
                : error !== ''
                  ? <AlertCircle size={19} aria-hidden="true" />
                  : <TaskIcon size={19} aria-hidden="true" />}
              <div className="ey-run-copy">
                <strong>{busy ? '正在处理研究任务' : error !== '' ? '任务未完成' : '研究提示'}</strong>
                <span>{busy ? `当前阶段：${STAGES[Math.max(0, stageIndex)]?.label ?? '准备'}${saveState === 'saving' ? ' · 正在保存' : ''}` : error || project.warning}</span>
              </div>
              <div className="ey-run-steps" aria-label="生成进度">
                {STAGES.map(item => {
                  const state = !busy && project.status === 'complete'
                    ? 'done'
                    : stageIndex > STAGE_ORDER[item.id]
                      ? 'done'
                      : stageIndex === STAGE_ORDER[item.id] ? 'active' : 'waiting'
                  return <span className="ey-run-step" data-state={state} key={item.id}>
                    {state === 'done' ? <Check size={12} aria-hidden="true" /> : null}
                    {item.label}
                  </span>
                })}
              </div>
              {busy && (
                <button type="button" className="ey-button" onClick={stopResearch}>
                  <CircleStop size={16} aria-hidden="true" />
                  停止
                </button>
              )}
            </div>
          )}
          <div className="ey-work-grid">
            <section className="ey-side-panel" aria-label="研究资料与排版">
              <div className="ey-side-tabs" role="tablist" aria-label="研究资料">
                <button type="button" id="ey-detail-tab-sources" aria-controls="ey-detail-panel" aria-pressed={detailTab === 'sources'} onClick={() => setDetailTab('sources')}>
                  来源 {project.sources.length}
                </button>
                <button type="button" id="ey-detail-tab-outline" aria-controls="ey-detail-panel" aria-pressed={detailTab === 'outline'} onClick={() => setDetailTab('outline')}>大纲</button>
                <button type="button" id="ey-detail-tab-layout" aria-controls="ey-detail-panel" aria-pressed={detailTab === 'layout'} onClick={() => setDetailTab('layout')}>排版</button>
              </div>
              <div className="ey-side-body" id="ey-detail-panel" role="region" aria-live="polite">
                {detailTab === 'sources' ? renderSources() : detailTab === 'outline' ? renderOutline() : renderLayout()}
              </div>
            </section>
            <section className="ey-paper" aria-label="稿件">
              <div className="ey-paper-toolbar">
                <strong>稿件</strong>
                <span className="ey-source-meta">
                  {saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : saveState === 'saved' ? '已保存' : ''}
                </span>
                <div className="ey-view-switch" role="group" aria-label="稿件视图">
                  <button type="button" aria-pressed={documentMode === 'preview'} onClick={() => setDocumentMode('preview')}>
                    <Eye size={15} aria-hidden="true" />
                    预览
                  </button>
                  <button type="button" aria-pressed={documentMode === 'edit'} disabled={busy} onClick={() => setDocumentMode('edit')}>
                    <PencilLine size={15} aria-hidden="true" />
                    编辑
                  </button>
                </div>
              </div>
              <div className="ey-paper-body">
                {documentMode === 'edit' ? (
                  <textarea
                    className="ey-editor"
                    aria-label="稿件正文"
                    value={project.content}
                    onChange={event => updateContent(event.target.value)}
                    onBlur={saveNow}
                    spellCheck
                  />
                ) : (
                  <article className="ey-document" id="ey-document">
                    <MarkdownDocument
                      markdown={displayedContent}
                      empty={busy ? '正在生成正文…' : '暂无正文。'}
                    />
                  </article>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="ey-shell" data-eyanbao-main="" data-rail-open={railOpen ? 'true' : 'false'}>
      <style>{workspaceStyles}</style>
      <a className="ey-skip" href="#ey-main-content">跳到主要内容</a>
      <header className="ey-header">
        <button type="button" className="ey-icon-button ey-mobile-rail-toggle" aria-label="打开研究项目" onClick={() => setRailOpen(true)}>
          <PanelLeft size={19} aria-hidden="true" />
        </button>
        <div className="ey-brand">
          <span className="ey-brand-mark" aria-hidden="true"><GraduationCap size={21} /></span>
          <div>
            <h1>e研宝</h1>
            <small>研究工作台</small>
          </div>
        </div>
        <div className="ey-header-spacer" />
        <span className="ey-health" data-ready={health?.modelReady ? 'true' : 'false'} title={health?.message}>
          <span className="ey-dot" />
          {health?.modelReady ? '已选择模型，连接未验证' : health === undefined ? '正在检查模型' : '模型未配置'}
        </span>
        <button type="button" className="ey-button" onClick={newStudy}>
          <Plus size={16} aria-hidden="true" />
          新建研究
        </button>
      </header>
      <div className="ey-body" data-view={view}>
        {renderRail()}
        <button
          type="button"
          className="ey-scrim"
          data-open={railOpen ? 'true' : 'false'}
          aria-label="关闭研究项目"
          onClick={() => setRailOpen(false)}
        />
        <main className="ey-main" id="ey-main-content" tabIndex={-1}>
          {view === 'composer' ? renderComposer() : renderDocument()}
        </main>
      </div>
      {toast !== '' && <div className="ey-toast" role="status">{toast}</div>}
    </section>
  )
}
