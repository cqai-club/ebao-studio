import {
  AlertCircle,
  BookOpenText,
  Check,
  ChevronRight,
  CircleStop,
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
  DEGREES,
  CITATION_STYLES,
  JOURNAL_QUALITIES,
  LITERATURE_SCOPES,
  type Degree,
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
  getProject,
  listProjects,
  patchProject,
  runResearch,
} from './api.ts'
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
  const [request, setRequest] = useState<RunRequest>(DEFAULT_REQUEST)
  const [view, setView] = useState<'composer' | 'document'>('composer')
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
  const abortRef = useRef<AbortController>()
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const taskRefs = useRef<Partial<Record<TaskKind, HTMLButtonElement>>>({})
  const deferredFilter = useDeferredValue(projectFilter)
  const setProject = (next: ScholarProject) => {
    setProjectState(next)
    setProjects(rows => upsertSummary(rows, next))
  }
  const queueSave = useDebouncedSave(project, setProject, setSaveState)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([listProjects(controller.signal), getHealth(controller.signal)]).then(
      ([rows, nextHealth]) => {
        setProjects(rows)
        setHealth(nextHealth)
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
  const degreeVisible = request.kind === 'thesis' || request.kind === 'thesis-layout'
  const journalQualityVisible = request.literatureScope === 'foreign'
  const displayedContent = busy ? liveText : project?.content ?? ''
  const outline = useMemo(() => outlineOf(displayedContent), [displayedContent])
  const canExport = project !== undefined && project.content.trim() !== '' && !busy
  const modelUnavailable = request.kind !== 'search' && health?.modelReady === false

  const newStudy = () => {
    abortRef.current?.abort()
    setView('composer')
    setProjectState(undefined)
    setRequest(current => ({ ...current, prompt: '' }))
    setDetailTab('sources')
    setDocumentMode('preview')
    setLiveText('')
    setStage(undefined)
    setError('')
    setRailOpen(false)
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
    setRequest(current => ({ ...current, kind: task.id, prompt: task.sample }))
    window.setTimeout(() => promptRef.current?.focus(), 0)
  }

  const selectTask = (kind: TaskKind) => {
    setRequest(current => ({ ...current, kind }))
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
      await runResearch(request, (event: StreamEvent) => {
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
    <div className="ey-main-inner">
      <div className="ey-compose-head">
        <div>
          <h2>今天要研究什么？</h2>
        </div>
      </div>
      <section className="ey-composer" aria-label="研究任务">
        <div className="ey-task-tabs" role="group" aria-label="研究任务类型">
          {TASKS.map((task, index) => {
            const Icon = task.icon
            return (
              <button
                type="button"
                className="ey-task"
                key={task.id}
                id={`ey-task-${task.id}`}
                ref={element => { if (element) taskRefs.current[task.id] = element }}
                aria-pressed={request.kind === task.id}
                onClick={() => selectTask(task.id)}
                onKeyDown={event => onTaskKey(event, index)}
              >
                <Icon size={17} aria-hidden="true" />
                {task.label}
              </button>
            )
          })}
        </div>
        <div className="ey-prompt-wrap">
          <label className="ey-label" htmlFor="ey-research-prompt">研究主题或要求</label>
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
        <div className="ey-compose-footer">
          <div className="ey-suggestions" aria-label="示例研究需求">
            <button type="button" className="ey-chip" onClick={() => chooseSample(currentTask)}>{currentTask.sample}</button>
          </div>
          <button
            type="button"
            className="ey-button ey-button-primary"
            disabled={request.prompt.trim().length < 4 || modelUnavailable}
            onClick={() => void startResearch()}
          >
            <BookOpenText size={17} aria-hidden="true" />
            开始研究
          </button>
        </div>
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
          {degreeVisible ? (
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
          ) : (
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
          )}
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
      </section>
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
  )

  const renderSources = () => (
    project?.sources.length === 0 ? <div className="ey-rail-empty">尚未检索到来源</div> : (
      <div>
        {project?.sources.map((source: LiteratureSource, index) => {
          const href = sourceHref(source)
          return (
            <article className="ey-source" key={source.id}>
              <h4 className="ey-source-title">[{index + 1}] {source.title}</h4>
              <div className="ey-source-meta">
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
  )

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
          {health?.modelReady ? '模型已就绪' : health === undefined ? '正在检查模型' : '模型未配置'}
        </span>
        <button type="button" className="ey-button" onClick={newStudy}>
          <Plus size={16} aria-hidden="true" />
          新建研究
        </button>
      </header>
      <div className="ey-body">
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
