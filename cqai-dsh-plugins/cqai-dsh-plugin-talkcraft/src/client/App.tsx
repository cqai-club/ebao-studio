import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { MediaSettingsEditor } from 'cqai-dsh-media-settings/client'
import type { EjianbaoWorkspaceOwner, MediaSettingsPublic } from 'cqai-dsh-media-settings/contracts'
import { API, EDGE_VOICES, isEdgeVoiceId, type Artifact, type EdgeVoice, type EdgeVoiceList, type Job, type JobDocument, type UploadKind, type VoiceSource } from '../protocol.ts'
import { parseShotbook } from './shotbook.ts'
import { styles } from './styles.ts'

type Page = 'home' | 'create' | 'job' | 'settings' | 'help' | 'editor'
type VoiceMode = VoiceSource
type SecretName = 'fish' | 'pexels' | 'pixabay'
type Filter = 'all' | 'attention' | 'running' | 'completed' | 'paused'
type Draft = {title: string; text: string; aspect: '16:9' | '9:16'; voiceMode: VoiceMode; edgeVoice: string; onlineSearch: boolean}
type MediaEntry = {id: number; kind: 'image' | 'video'; file: File}
type Preview = {kind: 'image' | 'video'; label: string; file?: File; url?: string}
type DeleteTarget = Pick<Job, 'id' | 'title' | 'status'>
type SetupState = {status: 'idle' | 'running' | 'completed' | 'failed'; items: {id: string; label: string; status: string; detail?: string}[]; logs: string[]; updatedAt: number}

const DRAFT_KEY = 'cqai-talkcraft-create-draft-v2'
const emptyDraft: Draft = {title: '', text: '', aspect: '9:16', voiceMode: 'upload', edgeVoice: EDGE_VOICES[0].id, onlineSearch: true}
const stageNames = ['准备声音与素材', '安排画面', '制作试片', '完成视频'] as const
const fileFormats = {voice: ['wav', 'mp3', 'm4a', 'aac', 'ogg'], image: ['png', 'jpg', 'jpeg', 'webp'], video: ['mp4', 'mov', 'webm']} as const
const serviceNames: Record<SecretName, string> = {fish: 'Fish Audio 配音', pexels: 'Pexels 素材', pixabay: 'Pixabay 素材'}
const markdownLabels = {code: {copyLabel: '复制', copiedLabel: '已复制'}, footnotes: '注释'}
const jsonLabels = {copyValue: '复制内容', copyJson: '复制 JSON', copyPath: '复制路径', copyPrettyJson: '复制格式化 JSON', copyCompactJson: '复制紧凑 JSON', copied: '已复制', copyFailed: '复制失败', collapseNode: '收起', expandNode: '展开', copyButtonTitle: (action: string) => action}
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

function readDraft(): {draft: Draft; restored: boolean} {
  try {
    const saved = localStorage.getItem(DRAFT_KEY)
    if (!saved) return {draft: {...emptyDraft}, restored: false}
    const value = JSON.parse(saved) as Omit<Partial<Draft>, 'voiceMode'> & {voiceMode?: VoiceMode | 'ai'}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {draft: {...emptyDraft}, restored: false}
    return {restored: true, draft: {title: typeof value.title === 'string' ? value.title : '', text: typeof value.text === 'string' ? value.text : '',
      aspect: value.aspect === '9:16' ? '9:16' : '16:9', voiceMode: value.voiceMode === 'ai' || value.voiceMode === 'fish' ? 'fish' : value.voiceMode === 'edge' ? 'edge' : 'upload',
      edgeVoice: isEdgeVoiceId(value.edgeVoice) ? value.edgeVoice : EDGE_VOICES[0].id,
      onlineSearch: value.onlineSearch !== false}}
  } catch {return {draft: {...emptyDraft}, restored: false}}
}

async function api<T>(action: string, data?: unknown, method: 'GET' | 'POST' | 'DELETE' = data === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const options: RequestInit = method === 'GET' ? {} : method === 'DELETE'
    ? {method, headers: {'x-talkcraft': '1'}}
    : {method, headers: {'content-type': 'application/json', 'x-talkcraft': '1'}, body: JSON.stringify(data)}
  const response = await fetch(`${API}/${action}`, {...options, signal})
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('口播视频制作服务未就绪，请稍后重试')
  const result = await response.json() as T & {error?: string}
  if (!response.ok) throw new Error(result.error ?? '操作失败')
  return result
}
const artifactUrl = (job: Job, file: string, download = false) => `${API}/artifact?id=${job.id}&file=${encodeURIComponent(file)}${download ? '&download=1' : ''}`
const mediaUrl = (job: Job, file: string) => `${API}/media?id=${job.id}&file=${encodeURIComponent(file)}`
const edgeVoiceLabel = (voice: EdgeVoice) => `${voice.locale} · ${voice.label ?? voice.id.slice(voice.locale.length + 1).replace(/Neural(?:-V\d+)?$/, '')} · ${voice.gender === 'Female' ? '女声' : '男声'}`
const hasArtifact = (job: Job, file: string) => job.artifacts.some(item => item.file === file)
const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})
const elapsed = (value: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000))
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : formatDate(value)
}
const suggestedTitle = (text: string) => text.trim().split(/[。！？!?\n]/)[0]?.trim().slice(0, 24) || '未命名口播视频'
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const shortJobError = (job: Job, fallback: string) => {
  if (!job.error) return fallback
  const first = job.error.split(/\r?\n/, 1)[0].trim()
  return first.length > 180 || first.includes('�') ? '制作遇到了问题。查看制作记录了解详情，处理后可以继续。' : first
}
const usableFiles = (files: FileList | File[], kind: UploadKind) => Array.from(files).filter(file => fileFormats[kind].includes(file.name.split('.').pop()?.toLowerCase() as never))

function userStatus(job: Job): {label: string; detail: string; tone: string; attention: boolean} {
  switch (job.status) {
    case 'awaiting-shotbook': return {label: '等你确认画面', detail: '画面安排已做好，等你看一眼', tone: 'warn', attention: true}
    case 'awaiting-sample': return {label: '等你看试片', detail: '开头试片已完成，等你试看', tone: 'warn', attention: true}
    case 'running': return {label: '制作中', detail: job.stage === 'prepare' ? '正在准备声音与素材' : job.stage === 'shotbook' ? '正在安排画面' : job.stage === 'sample' ? '正在制作试片' : '正在完成整条视频', tone: '', attention: false}
    case 'completed': return {label: '已完成', detail: '可以播放和下载', tone: 'done', attention: false}
    case 'failed': return {label: '制作暂停', detail: '遇到了问题，可以查看原因并继续', tone: 'error', attention: true}
    case 'interrupted': return {label: '已暂停', detail: '可以从已完成的进度继续', tone: 'warn', attention: true}
    case 'cancelled': return {label: '已停止', detail: '已完成的内容仍然保留', tone: 'warn', attention: false}
    default: return {label: '待开始', detail: '项目已创建，可以继续添加素材', tone: '', attention: false}
  }
}

function useObjectUrl(file?: File): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file) {setUrl(undefined); return}
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

function MediaTile({entry, onRemove, onPreview}: {entry: MediaEntry; onRemove: () => void; onPreview: () => void}) {
  const url = useObjectUrl(entry.file)
  return <div className="tc-media-tile"><div className="tc-media-thumb">{url ? entry.kind === 'image' ? <img src={url} alt="上传素材预览"/> : <video src={url} muted preload="metadata"/> : '画面'}</div><div className="tc-media-tile-name" title={entry.file.name}>{entry.file.name}</div><div className="tc-media-tile-actions"><button className="tc-plain" type="button" onClick={onPreview}>预览</button><button className="tc-plain" type="button" onClick={onRemove}>移除</button></div></div>
}

function PreviewDialog({item, onClose, active}: {item: Preview; onClose: () => void; active: boolean}) {
  const fileUrl = useObjectUrl(item.file)
  const url = item.url ?? fileUrl
  useEffect(() => {
    if (!active) return
    const close = (event: KeyboardEvent) => {if (event.key === 'Escape') onClose()}
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [active, onClose])
  return <div className="tc-modal-backdrop" role="presentation" onMouseDown={event => {if (event.target === event.currentTarget) onClose()}}><div className="tc-modal" role="dialog" aria-modal="true" aria-label={item.label}><div className="tc-modal-header"><strong>{item.label}</strong><button className="tc-subtle" type="button" onClick={onClose} aria-label="关闭预览">关闭</button></div>{url && (item.kind === 'image' ? <img src={url} alt={item.label}/> : <video src={url} controls autoPlay/>)}</div></div>
}

function DeleteDialog({job, busy, error, onCancel, onConfirm, active}: {job: DeleteTarget; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void; active: boolean}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {if (active) cancelRef.current?.focus()}, [active])
  useEffect(() => {
    if (!active) return
    const close = (event: KeyboardEvent) => {if (event.key === 'Escape' && !busy) onCancel()}
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [active, busy, onCancel])
  return <div className="tc-modal-backdrop" role="presentation" onMouseDown={event => {if (!busy && event.target === event.currentTarget) onCancel()}}>
    <div className="tc-modal tc-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-delete-title" aria-describedby="tc-delete-description">
      <h2 id="tc-delete-title">删除“{job.title}”？</h2>
      <p id="tc-delete-description">该视频的配音、上传素材、分镜和成片将从本机永久删除，无法撤销。</p>
      {job.status === 'running' && <p>正在制作的任务会先停止，再删除文件。</p>}
      {error && <div className="tc-notice error" role="alert">{error}</div>}
      <div className="tc-actions tc-delete-actions"><button ref={cancelRef} type="button" className="tc-subtle" disabled={busy} onClick={onCancel}>取消</button><Button variant="primary" className="tc-primary" disabled={busy} onClick={onConfirm}>{busy ? '正在删除…' : '确认删除'}</Button></div>
    </div>
  </div>
}

function ProjectCover({job}: {job: Job}) {
  const image = job.uploads.find(item => item.kind === 'image')
  return <div className="tc-project-cover">{image ? <img src={mediaUrl(job, image.file)} alt="项目素材缩略图" loading="lazy"/> : <span className="tc-placeholder" aria-hidden="true">▶</span>}<span className="tc-project-aspect">{job.aspect}</span></div>
}

function VideoPlayer({job, file, className = ''}: {job: Job; file: string; className?: string}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [job.id, file])
  if (failed) return <div className="tc-notice warn">视频暂时无法播放。请使用下方的下载入口保存文件后查看。</div>
  return <video className={`tc-player ${job.aspect === '9:16' ? 'portrait' : ''} ${className}`} src={artifactUrl(job, file)} controls preload="metadata" playsInline onError={() => setFailed(true)}/>
}

type ArtifactKind = 'markdown' | 'json' | 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'unsupported'
function artifactKind(file: string): ArtifactKind {
  const extension = file.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'json') return 'json'
  if (['txt', 'log', 'csv', 'srt', 'vtt', 'yaml', 'yml', 'xml', 'html', 'jsonl'].includes(extension)) return 'text'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) return 'image'
  if (['mp4', 'mov', 'webm'].includes(extension)) return 'video'
  if (['wav', 'mp3', 'm4a', 'aac', 'ogg'].includes(extension)) return 'audio'
  if (extension === 'pdf') return 'pdf'
  return 'unsupported'
}

function JsonPreview({source, label}: {source: string; label: string}) {
  try {
    const value = JSON.parse(source) as unknown
    return value !== null && typeof value === 'object'
      ? <JsonTree data={value} label={label} labels={jsonLabels}/>
      : <pre className="tc-artifact-text">{JSON.stringify(value, null, 2)}</pre>
  } catch {
    return <><p className="tc-muted">JSON 尚未写完或格式有误，以下是原始内容。</p><pre className="tc-artifact-text">{source}</pre></>
  }
}

function ArtifactPreview({job, item, active}: {job: Job; item: Artifact; active: boolean}) {
  const kind = artifactKind(item.file)
  const url = artifactUrl(job, item.file)
  const isText = kind === 'markdown' || kind === 'json' || kind === 'text'
  const [content, setContent] = useState<{text?: string; error?: string}>({})
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!active) return
    setFailed(false)
    if (!isText || item.size > MAX_TEXT_PREVIEW_BYTES) return
    const controller = new AbortController()
    setContent({})
    void fetch(url, {signal: controller.signal, cache: 'no-store'})
      .then(response => {if (!response.ok) throw new Error('文件暂时无法读取'); return response.text()})
      .then(text => {if (!controller.signal.aborted) setContent({text})})
      .catch(cause => {if (!controller.signal.aborted) setContent({error: errorMessage(cause)})})
    return () => controller.abort()
  }, [active, job.id, item.file, item.size, isText, url])
  if (failed) return <p className="tc-muted">浏览器无法预览这个文件，请下载后查看。</p>
  if (isText) {
    if (item.size > MAX_TEXT_PREVIEW_BYTES) return <p className="tc-muted">文件超过 1 MB，请下载后查看。</p>
    if (content.error) return <p className="tc-notice warn">{content.error}，请稍后重试或下载查看。</p>
    if (content.text === undefined) return <p className="tc-muted">正在读取文件…</p>
    if (kind === 'markdown') return <MarkdownText text={content.text} labels={markdownLabels} variant="compact"/>
    if (kind === 'json') return <JsonPreview source={content.text} label={item.name}/>
    return <pre className="tc-artifact-text">{content.text}</pre>
  }
  if (kind === 'image') return <img className="tc-artifact-image" src={url} alt={item.name} onError={() => setFailed(true)}/>
  if (kind === 'video') return <video className="tc-artifact-video" src={url} controls preload="metadata" playsInline onError={() => setFailed(true)}/>
  if (kind === 'audio') return <audio className="tc-artifact-audio" src={url} controls preload="metadata" onError={() => setFailed(true)}/>
  if (kind === 'pdf') return <iframe className="tc-artifact-pdf" src={url} title={`${item.name} 预览`}/>
  return <p className="tc-muted">这个格式暂时无法在页面中预览，请下载后查看。</p>
}

function ArtifactLibrary({job, items, active}: {job: Job; items: Artifact[]; active: boolean}) {
  const [selectedFile, setSelectedFile] = useState('')
  const selected = items.find(item => item.file === selectedFile) ?? items[0]
  if (!selected) return null
  return <section className="tc-document-panel tc-section" aria-label="其他文件">
    <div className="tc-document-head"><div><h2>其他文件</h2><span className="tc-muted">选择文件直接预览</span></div><a href={artifactUrl(job, selected.file, true)} download={selected.name}>下载当前文件 ↓</a></div>
    <div className="tc-document-layout"><div className="tc-document-tabs" role="tablist" aria-label="其他文件">{items.map(item => <button type="button" role="tab" aria-controls="tc-artifact-preview" aria-selected={selected.file === item.file} key={item.file} onClick={() => setSelectedFile(item.file)}>{item.name}<small>{item.file} · {Math.max(1, Math.round(item.size / 1024))} KB</small></button>)}</div>
      <div className="tc-document-content tc-artifact-preview" id="tc-artifact-preview" role="tabpanel"><ArtifactPreview key={`${job.id}:${selected.file}:${selected.size}`} job={job} item={selected} active={active}/></div>
    </div>
  </section>
}

function StageRail({job}: {job: Job}) {
  const states = [job.completedStages.includes('prepare'), !!job.approvedShotbook, !!job.approvedSample, job.status === 'completed']
  const current = job.status === 'completed' || job.status === 'draft' ? -1 : job.status === 'awaiting-shotbook' ? 1 : job.status === 'awaiting-sample' ? 2 : job.stage === 'prepare' ? 0 : job.stage === 'shotbook' ? 1 : job.stage === 'sample' ? 2 : 3
  return <div className="tc-stage-rail" aria-label="制作阶段">{stageNames.map((name, index) => <div key={name} className={`tc-stage-item ${states[index] ? 'done' : current === index ? 'active' : ''}`}>{states[index] ? '✓' : current === index ? '●' : '○'} {name}</div>)}</div>
}

export function TalkCraft({active = true, containerPanelId, onOpenSettings}: Partial<EjianbaoWorkspaceOwner> = {}) {
  const rootElement = useRef<HTMLElement>(null)
  const editorFrame = useRef<HTMLIFrameElement>(null)
  const visibleReads = useRef<AbortController>()
  const [initialDraft] = useState(readDraft)
  const restoredDraft = useRef(initialDraft.restored)
  const draftGeneration = useRef(0)
  const protectedDefaults = useRef(new Set<'aspect' | 'edgeVoice'>(initialDraft.restored ? ['aspect', 'edgeVoice'] : []))
  const defaultsPending = useRef(!initialDraft.restored)
  const [defaultsRequest, setDefaultsRequest] = useState(0)
  const [page, setPage] = useState<Page>('home')
  const [returnPage, setReturnPage] = useState<Page>('home')
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [draft, setDraft] = useState<Draft>(initialDraft.draft)
  const [voiceFile, setVoiceFile] = useState<File>()
  const voiceUrl = useObjectUrl(voiceFile)
  const [mediaFiles, setMediaFiles] = useState<MediaEntry[]>([])
  const nextFileId = useRef(1)
  const mediaInput = useRef<HTMLInputElement>(null)
  const voiceInput = useRef<HTMLInputElement>(null)
  const extraInput = useRef<HTMLInputElement>(null)
  const recoveryInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [showAll, setShowAll] = useState(false)
  const [health, setHealth] = useState<Record<string, unknown>>({})
  const [setup, setSetup] = useState<SetupState>({status: 'idle', items: [], logs: [], updatedAt: 0})
  const [edgeVoiceList, setEdgeVoiceList] = useState<EdgeVoiceList>({voices: [...EDGE_VOICES], source: 'fallback'})
  const [edgeVoiceLoading, setEdgeVoiceLoading] = useState(false)
  const [edgeVoiceQuery, setEdgeVoiceQuery] = useState('')
  const [edgeShowAll, setEdgeShowAll] = useState(false)
  const [edgePreview, setEdgePreview] = useState<{voice: string; text: string; url: string}>()
  const [edgePreviewBusy, setEdgePreviewBusy] = useState(false)
  const [edgePreviewError, setEdgePreviewError] = useState('')
  const edgePreviewRequest = useRef<AbortController>()
  const edgePreviewObjectUrl = useRef<string>()
  const edgePreviewPlayer = useRef<HTMLAudioElement>(null)
  const [settings, setSettings] = useState<Record<string, boolean>>({})
  const [keyEditing, setKeyEditing] = useState<SecretName | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [removeKey, setRemoveKey] = useState<SecretName | null>(null)
  const [documents, setDocuments] = useState<{id: string; items: JobDocument[]; error?: string}>()
  const [activeDocument, setActiveDocument] = useState<JobDocument['file']>('SHOTBOOK.md')
  const [chosen, setChosen] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [editor, setEditor] = useState<{id: string; url: string}>()
  const editorId = useRef<string>()
  const [preview, setPreview] = useState<Preview>()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const job = jobs.find(item => item.id === selected)
  const currentDocuments = documents && job && documents.id === job.id ? documents.items : []
  const shotbookText = currentDocuments.find(item => item.file === 'SHOTBOOK.md')?.text
  editorId.current = editor?.id

  const notifyWorkbenchVisibility = () => {
    if (!editor) return
    try {editorFrame.current?.contentWindow?.postMessage({type: 'talkcraft:visibility', active: active && page === 'editor'}, new URL(editor.url).origin)}
    catch {/* A workbench that is still loading will receive the state after its ready message. */}
  }

  const clearEdgePreview = () => {
    edgePreviewRequest.current?.abort()
    edgePreviewRequest.current = undefined
    edgePreviewPlayer.current?.pause()
    if (edgePreviewObjectUrl.current) URL.revokeObjectURL(edgePreviewObjectUrl.current)
    edgePreviewObjectUrl.current = undefined
    setEdgePreview(undefined)
    setEdgePreviewBusy(false)
    setEdgePreviewError('')
  }

  useEffect(() => {try {localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))} catch {/* local storage may be unavailable */}}, [draft])
  useEffect(() => {clearEdgePreview()}, [page, step, draft.voiceMode, draft.edgeVoice])
  useEffect(() => () => {
    edgePreviewRequest.current?.abort()
    if (edgePreviewObjectUrl.current) URL.revokeObjectURL(edgePreviewObjectUrl.current)
    if (editorId.current) void api(`editor/close?id=${editorId.current}`, {}).catch(() => {})
  }, [])
  useEffect(() => {
    if (active && edgePreview?.url) void edgePreviewPlayer.current?.play().catch(() => {})
  }, [edgePreview?.url])
  useEffect(() => {
    if (active && page !== 'settings') return
    edgePreviewRequest.current?.abort()
    edgePreviewRequest.current = undefined
    setEdgePreviewBusy(false)
    rootElement.current?.querySelectorAll('audio, video').forEach(element => (element as HTMLMediaElement).pause())
    if (rootElement.current?.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur()
    try {
      editorFrame.current?.contentDocument?.querySelectorAll('audio, video').forEach(element => (element as HTMLMediaElement).pause())
    } catch {/* The editor may run on its own origin. Its iframe remains mounted. */}
  }, [active, page])
  useEffect(() => {
    if (!editor) return
    const origin = new URL(editor.url).origin
    const ready = (event: MessageEvent) => {
      if (event.origin === origin && event.source === editorFrame.current?.contentWindow && event.data?.type === 'talkcraft:ready') notifyWorkbenchVisibility()
    }
    window.addEventListener('message', ready)
    notifyWorkbenchVisibility()
    return () => window.removeEventListener('message', ready)
  }, [active, page, editor?.url])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    visibleReads.current = controller
    return () => {controller.abort(); visibleReads.current = undefined}
  }, [active])
  useEffect(() => {
    if (!active || !defaultsPending.current) return
    const generation = draftGeneration.current
    const controller = new AbortController()
    void api<MediaSettingsPublic>('media-settings', undefined, 'GET', controller.signal).then(value => {
      if (controller.signal.aborted || generation !== draftGeneration.current) return
      const defaults = value.effective ?? value.defaults
      defaultsPending.current = false
      setDraft(previous => ({...previous,
        aspect: protectedDefaults.current.has('aspect') ? previous.aspect : defaults.aspect,
        edgeVoice: protectedDefaults.current.has('edgeVoice') || !isEdgeVoiceId(defaults.edgeVoiceId) ? previous.edgeVoice : defaults.edgeVoiceId,
      }))
    }).catch(() => {/* A new draft keeps the local defaults when the service is unavailable. */})
    return () => controller.abort()
  }, [active, defaultsRequest])
  useEffect(() => {
    if (!active) return
    let live = true
    const controller = new AbortController()
    const read = <T,>(action: string) => api<T>(action, undefined, 'GET', controller.signal)
    const poll = () => read<Job[]>('jobs').then(items => {if (live) setJobs(items)}).catch(() => {})
    void poll()
    void read<Record<string, unknown>>('health').then(value => {if (live) setHealth(value)}).catch(() => {})
    let refreshedAt = 0
    const pollSetup = () => {void read<SetupState>('setup').then(value => {if (!live) return; setSetup(value);if ((value.status === 'completed' || value.status === 'failed') && value.updatedAt !== refreshedAt) {refreshedAt = value.updatedAt;void read<Record<string, unknown>>('health').then(result => {if (live) setHealth(result)}).catch(() => {})}}).catch(() => {})}
    void pollSetup()
    setNow(Date.now())
    const timer = setInterval(poll, 2500)
    const setupTimer = setInterval(pollSetup, 2500)
    const clock = setInterval(() => setNow(Date.now()), 30000)
    return () => {live = false; controller.abort(); clearInterval(timer); clearInterval(setupTimer); clearInterval(clock)}
  }, [active])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void api<Record<string, boolean>>('settings', undefined, 'GET', controller.signal)
      .then(value => {if (!controller.signal.aborted) setSettings(value)})
      .catch(() => {})
    return () => controller.abort()
  }, [active, page])
  useEffect(() => {
    if (!active || page !== 'create' || step !== 1 || draft.voiceMode !== 'edge') return
    let live = true
    const controller = new AbortController()
    setEdgeVoiceLoading(true)
    void api<EdgeVoiceList>('edge-voices', undefined, 'GET', controller.signal).then(value => {if (live) setEdgeVoiceList(value)}).catch(() => {})
      .finally(() => {if (live) setEdgeVoiceLoading(false)})
    void api<Record<string, unknown>>('health', undefined, 'GET', controller.signal).then(value => {if (live) setHealth(value)}).catch(() => {})
    return () => {live = false; controller.abort()}
  }, [active, page, step, draft.voiceMode])
  useEffect(() => {
    if (!active || page !== 'job' || !job) return
    let live = true
    const controller = new AbortController()
    const id = job.id
    const poll = () => api<JobDocument[]>(`documents?id=${id}`, undefined, 'GET', controller.signal)
      .then(items => {if (live) setDocuments({id, items})})
      .catch(cause => {if (live) setDocuments(previous => ({id, items: previous?.id === id ? previous.items : [], error: errorMessage(cause)}))})
    void poll()
    const timer = setInterval(poll, job.status === 'running' ? 4000 : 12000)
    return () => {live = false; controller.abort(); clearInterval(timer)}
  }, [active, page, job?.id, job?.status])
  useEffect(() => {
    if (job?.status === 'awaiting-shotbook') setChosen(job.candidates.filter(item => item.selected).map(item => item.id))
    setFeedback(''); setFeedbackOpen(false)
  }, [job?.id, job?.status])

  const refresh = async () => {
    const controller = visibleReads.current
    if (!controller) return
    const result = await api<Job[]>('jobs', undefined, 'GET', controller.signal)
    if (!controller.signal.aborted) setJobs(result)
  }
  const refreshEdgeVoices = async () => {
    const controller = visibleReads.current
    if (!controller) return
    setEdgeVoiceLoading(true)
    try {const value = await api<EdgeVoiceList>('edge-voices?refresh=1', undefined, 'GET', controller.signal); if (!controller.signal.aborted) setEdgeVoiceList(value)}
    catch (cause) {if (!controller.signal.aborted) setError(errorMessage(cause))}
    finally {if (!controller.signal.aborted) setEdgeVoiceLoading(false)}
  }
  const playEdgePreview = async () => {
    const voice = draft.edgeVoice
    const text = Array.from(draft.text.trim().replace(/\s+/g, ' ')).slice(0, 80).join('')
    if (edgePreview?.voice === voice && edgePreview.text === text) {
      if (edgePreviewPlayer.current) {
        edgePreviewPlayer.current.currentTime = 0
        void edgePreviewPlayer.current.play().catch(() => {})
      }
      return
    }
    clearEdgePreview()
    const controller = new AbortController()
    edgePreviewRequest.current = controller
    setEdgePreviewBusy(true)
    try {
      const response = await fetch(`${API}/edge-preview`, {
        method: 'POST', headers: {'content-type': 'application/json', 'x-talkcraft': '1'},
        body: JSON.stringify({voice, text}), signal: controller.signal,
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as {error?: string}
        throw new Error(response.status === 404 ? '试听服务尚未加载，请重启e宝工坊开发版后重试' : result.error ?? '试听生成失败，请稍后重试')
      }
      if (!response.headers.get('content-type')?.includes('audio/mpeg')) throw new Error('试听服务返回了非音频内容，请重启e宝工坊开发版后重试')
      const audio = await response.blob()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(audio)
      edgePreviewObjectUrl.current = url
      setEdgePreview({voice, text, url})
      setHealth(previous => ({...previous, edgeTts: true}))
    } catch (cause) {
      if (!controller.signal.aborted) setEdgePreviewError(errorMessage(cause))
    } finally {
      if (edgePreviewRequest.current === controller) {
        edgePreviewRequest.current = undefined
        setEdgePreviewBusy(false)
      }
    }
  }
  const requestDraftDefaults = () => {draftGeneration.current++; defaultsPending.current = true; setDefaultsRequest(value => value + 1)}
  const resetDraft = () => {
    restoredDraft.current = false
    protectedDefaults.current.clear()
    setDraft({...emptyDraft})
    requestDraftDefaults()
  }
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (key === 'aspect' || key === 'edgeVoice') protectedDefaults.current.add(key)
    setDraft(previous => ({...previous, [key]: value}))
  }
  const beginCreate = () => {
    if (!draft.title && !draft.text && !voiceFile && mediaFiles.length === 0 && !restoredDraft.current) requestDraftDefaults()
    setPage('create'); setStep(0); setError('')
  }
  const goHome = () => {if (editor) closeEditor(); setPage('home'); setError('')}
  const openJob = (id: string) => {if (editor && editor.id !== id) closeEditor(); setSelected(id); setPage('job'); setError('')}
  const openSettings = () => {
    if (onOpenSettings) {onOpenSettings(); return}
    setReturnPage(page === 'settings' ? returnPage : page); setPage('settings'); setError('')
  }
  const closeEditor = () => {if (editor) void api(`editor/close?id=${editor.id}`, {}).catch(() => {}); setEditor(undefined); setPage('job')}
  const askDelete = (item: Job) => {setDeleteTarget({id: item.id, title: item.title, status: item.status}); setDeleteError('')}
  const deleteVideo = async () => {
    if (!deleteTarget || deleteBusy) return
    const target = deleteTarget
    setDeleteBusy(true); setDeleteError('')
    try {
      await api<{ok: true}>(`jobs?id=${target.id}`, undefined, 'DELETE')
      setJobs(current => current.filter(item => item.id !== target.id))
      if (selected === target.id) {setSelected(''); setDocuments(undefined); setPage('home')}
      if (editor?.id === target.id) setEditor(undefined)
      setDeleteTarget(undefined)
      await refresh().catch(() => {})
    } catch (cause) {
      const latest = await api<Job[]>('jobs').catch(() => undefined)
      if (latest) {
        setJobs(latest)
        if (!latest.some(item => item.id === target.id)) {setDeleteTarget(undefined); return}
      }
      setDeleteError(errorMessage(cause))
    } finally {setDeleteBusy(false)}
  }
  const addMedia = (files: FileList | File[]) => {
    const valid = Array.from(files).filter(file => [...fileFormats.image, ...fileFormats.video].includes(file.name.split('.').pop()?.toLowerCase() as never))
    if (valid.length !== files.length) setError('部分文件格式不支持。请上传 JPG、PNG、WebP、MP4、MOV 或 WebM。')
    if (valid.some(file => file.size > 1024 * 1024 * 1024)) {setError('单个画面文件不能超过 1 GB'); return}
    setMediaFiles(previous => [...previous, ...valid.map(file => ({id: nextFileId.current++, file, kind: fileFormats.image.includes(file.name.split('.').pop()?.toLowerCase() as never) ? 'image' as const : 'video' as const}))])
  }
  const pickVoice = (file?: File) => {
    if (!file) return
    if (!usableFiles([file], 'voice').length) {setError('请上传 MP3、WAV、M4A、AAC 或 OGG 音频'); return}
    if (file.size > 250 * 1024 * 1024) {setError('配音文件不能超过 250 MB'); return}
    setVoiceFile(file); setError('')
  }
  const upload = async (id: string, kind: UploadKind, file: File) => {
    const response = await fetch(`${API}/upload?id=${id}&kind=${kind}&name=${encodeURIComponent(file.name)}`, {method: 'POST', headers: {'x-talkcraft': '1', 'content-type': 'application/octet-stream'}, body: file})
    const result = await response.json() as {error?: string}
    if (!response.ok) throw new Error(result.error ?? `${file.name} 上传失败`)
  }
  const uploadExisting = async (id: string, files: File[], voiceOnly = false) => {
    if (!files.length) return
    setBusy('上传素材…'); setError('')
    try {
      for (const file of files) {
        const extension = file.name.split('.').pop()?.toLowerCase()
        const kind: UploadKind = voiceOnly || fileFormats.voice.includes(extension as never) ? 'voice' : fileFormats.image.includes(extension as never) ? 'image' : 'video'
        if (!usableFiles([file], kind).length) throw new Error(`${file.name} 的格式不支持`)
        await upload(id, kind, file)
      }
      await refresh()
    } catch (cause) {setError(errorMessage(cause))}
    finally {setBusy('')}
  }
  const validateStep = (): boolean => {
    setError('')
    if (step === 0 && !draft.text.trim()) {setError('先填写口播稿，再选择声音。'); return false}
    if (step === 1 && draft.voiceMode === 'upload' && !voiceFile) {setError('先上传成品配音，或选择 AI 配音。'); return false}
    if (step === 1 && draft.voiceMode === 'fish' && !settings.fish) {setError('Fish Audio 尚未连接，请先在设置中填写密钥。'); return false}
    if (step === 1 && draft.voiceMode === 'edge' && health.edgeTts === false) {setError('Edge TTS 依赖尚未准备，请查看设置中的准备说明。'); return false}
    if (step === 1 && draft.voiceMode === 'edge' && health.asrModel === false) {setError('Edge TTS 需要本地配音识别模型完成字级对齐，请查看设置中的准备说明。'); return false}
    if (step === 1 && draft.voiceMode === 'edge' && edgeVoiceList.source === 'live' && !edgeVoiceList.voices.some(item => item.id === draft.edgeVoice)) {setError('所选音色不在当前 Edge 目录中，请重新选择。'); return false}
    return true
  }
  const create = async () => {
    if (!draft.text.trim()) {setStep(0); setError('先填写口播稿。'); return}
    if (draft.voiceMode === 'upload' && !voiceFile) {setStep(1); setError('先上传成品配音。'); return}
    if (draft.voiceMode === 'fish' && !settings.fish) {setStep(1); setError('请先配置 Fish Audio。'); return}
    if (draft.voiceMode === 'edge' && health.edgeTts !== true) {setStep(1); setError('Edge TTS 依赖尚未准备，请查看设置中的准备说明。'); return}
    if (draft.voiceMode === 'edge' && health.asrModel !== true) {setStep(1); setError('请先准备本地配音识别模型，再使用 Edge TTS。'); return}
    if (draft.voiceMode === 'edge' && edgeVoiceList.source === 'live' && !edgeVoiceList.voices.some(item => item.id === draft.edgeVoice)) {setStep(1); setError('所选音色不在当前 Edge 目录中，请重新选择。'); return}
    if (!mediaFiles.length && (!draft.onlineSearch || (!settings.pexels && !settings.pixabay))) {setError('请添加照片或视频，或连接在线素材服务。'); return}
    setBusy('创建项目…'); setError('')
    try {
      const next = await api<Job>('jobs', {title: draft.title.trim() || suggestedTitle(draft.text), text: draft.text, aspect: draft.aspect, onlineSearch: draft.onlineSearch,
        voiceSource: draft.voiceMode, edgeVoice: draft.voiceMode === 'edge' ? draft.edgeVoice : undefined})
      setSelected(next.id); setPage('job')
      if (draft.voiceMode === 'upload' && voiceFile) {setBusy(`上传 ${voiceFile.name}…`); await upload(next.id, 'voice', voiceFile)}
      for (const item of mediaFiles) {setBusy(`上传 ${item.file.name}…`); await upload(next.id, item.kind, item.file)}
      setBusy('开始制作…'); await api(`start?id=${next.id}`, {})
      resetDraft(); setVoiceFile(undefined); setMediaFiles([]); try {localStorage.removeItem(DRAFT_KEY)} catch {/* no storage */}
      await refresh()
    } catch (cause) {setError(errorMessage(cause)); await refresh().catch(() => {})}
    finally {setBusy('')}
  }
  const action = async (name: 'start' | 'cancel' | 'approve', data: unknown = {}) => {
    if (!job) return
    setBusy('正在处理…'); setError('')
    try {await api(`${name}?id=${job.id}`, data); await refresh(); setFeedback(''); setFeedbackOpen(false)}
    catch (cause) {setError(errorMessage(cause))}
    finally {setBusy('')}
  }
  const startEditor = async () => {
    if (!job) return
    setBusy('正在打开精细编辑…'); setError('')
    try {const result = await api<{url: string}>(`editor/open?id=${job.id}`, {}); setEditor({id: job.id, url: result.url}); setPage('editor')}
    catch (cause) {setError(errorMessage(cause))}
    finally {setBusy('')}
  }
  const saveKey = async (name: SecretName, value: string) => {
    setBusy('正在保存…'); setError('')
    try {setSettings(await api<Record<string, boolean>>('settings', {name, value})); setKeyValue(''); setKeyEditing(null); setRemoveKey(null)}
    catch (cause) {setError(errorMessage(cause))}
    finally {setBusy('')}
  }
  const checkHealth = async () => {
    const controller = visibleReads.current
    if (!controller) return
    setBusy('正在检查…')
    try {const value = await api<Record<string, unknown>>('health', undefined, 'GET', controller.signal); if (!controller.signal.aborted) setHealth(value)}
    catch (cause) {if (!controller.signal.aborted) setError(errorMessage(cause))}
    finally {setBusy('')}
  }
  const installMissing = async () => {
    setError('')
    try {setSetup(await api<SetupState>('setup', {}))}
    catch (cause) {setError(errorMessage(cause))}
  }
  const shots = useMemo(() => job && shotbookText ? parseShotbook(shotbookText, job.uploads) : [], [job?.id, job?.uploads, shotbookText])
  const selectedChanged = !!job && job.candidates.some(item => item.selected !== chosen.includes(item.id))
  const attention = jobs.filter(item => userStatus(item).attention)
  const visibleJobs = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(item => filter === 'all' || (filter === 'attention' && userStatus(item).attention) || (filter === 'running' && item.status === 'running') || (filter === 'completed' && item.status === 'completed') || (filter === 'paused' && ['interrupted', 'failed', 'cancelled', 'draft'].includes(item.status)))
  const anyMaterialService = !!settings.pexels || !!settings.pixabay
  const coreReady = ['node', 'python', 'ffmpeg', 'ffprobe', 'remotion', 'browser'].every(key => health[key] === true)
  const agentIssues = Array.isArray(health.agents) ? health.agents as string[] : []

  const feedbackBox = (suggestions: string[]) => <div className="tc-feedback"><h3>希望怎么调整？</h3><div className="tc-chips">{suggestions.map(item => <button key={item} type="button" onClick={() => setFeedback(current => current.includes(item) ? current : `${current}${current ? '；' : ''}${item}`)}>{item}</button>)}</div><textarea aria-label="修改意见" value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="写下你想改变的地方…"/><p className="tc-field-help">提交后会按这些意见重新制作当前步骤。</p></div>
  const edgeQuery = edgeVoiceQuery.trim().toLowerCase()
  const visibleEdgeVoices = edgeVoiceList.voices.filter(item =>
    (edgeShowAll || !!edgeQuery || item.locale.startsWith('zh-') || item.id === draft.edgeVoice)
    && (!edgeQuery || edgeVoiceLabel(item).toLowerCase().includes(edgeQuery) || item.id.toLowerCase().includes(edgeQuery)))

  const renderHome = () => <>
    <div className="tc-page-heading"><div><span className="tc-eyebrow">你的创作空间</span><h1>我的视频</h1><p className="tc-description">从口播稿开始，逐步做成一条完整视频。</p></div><Button variant="primary" className="tc-primary" onClick={beginCreate}>＋ 做新视频</Button></div>
    {attention.length > 0 && <section className="tc-section"><div className="tc-section-head"><h2>需要你处理</h2><span className="tc-muted">{attention.length} 项</span></div>{attention.map(item => <div className="tc-attention" key={item.id}><span className="tc-attention-icon" aria-hidden="true">▶</span><div className="tc-attention-main"><strong>{item.title}</strong><p>{userStatus(item).detail}</p></div><Button variant="primary" className="tc-primary" onClick={() => openJob(item.id)}>{['failed', 'interrupted'].includes(item.status) ? '查看并继续 →' : '去确认 →'}</Button></div>)}</section>}
    {jobs.length === 0 ? <div className="tc-card tc-empty"><div className="tc-empty-icon">▶</div><h2>做你的第一条口播视频</h2><p>准备一段文案。你可以上传自己的配音和照片，剩下的步骤会逐一提示。</p><Button variant="primary" className="tc-primary" onClick={beginCreate}>＋ 做新视频</Button></div> : <section className="tc-section"><div className="tc-section-head"><h2>最近的视频</h2></div><div className="tc-filter" aria-label="筛选项目">{([['all', '全部'], ['attention', '等我确认'], ['running', '制作中'], ['completed', '已完成'], ['paused', '已暂停']] as const).map(([value, label]) => <button type="button" aria-pressed={filter === value} key={value} onClick={() => {setFilter(value); setShowAll(false)}}>{label}</button>)}</div>{visibleJobs.length ? <div className="tc-project-grid tc-section">{(showAll ? visibleJobs : visibleJobs.slice(0, 6)).map(item => <article className="tc-project" key={item.id}><button type="button" className="tc-project-open" onClick={() => openJob(item.id)}><ProjectCover job={item}/><div className="tc-project-copy"><strong>{item.title}</strong><small>{userStatus(item).label} · {formatDate(item.updatedAt)}</small></div></button><button type="button" className="tc-project-delete" disabled={deleteBusy || !!busy} aria-label={`删除视频「${item.title}」`} onClick={() => askDelete(item)}>删除</button></article>)}</div> : <div className="tc-card tc-empty tc-section"><p>这里暂时没有符合条件的视频。</p></div>}{visibleJobs.length > 6 && !showAll && <button className="tc-plain" type="button" onClick={() => setShowAll(true)}>查看全部 {visibleJobs.length} 条视频 →</button>}</section>}
  </>

  const renderVoiceStep = () => <>
    <span className="tc-eyebrow">第二步 · 声音</span>
    <h1>视频用什么声音？</h1>
    <p className="tc-description">上传录好的配音，或根据文案生成声音。</p>
    <div className="tc-choice-grid tc-voice-options tc-section">
      <button type="button" className="tc-choice" aria-pressed={draft.voiceMode === 'upload'} onClick={() => updateDraft('voiceMode', 'upload')}>
        <span className="tc-choice-check">{draft.voiceMode === 'upload' ? '✓' : ''}</span><strong>上传我的配音</strong><span>保留原声</span>
      </button>
      <button type="button" className="tc-choice" aria-pressed={draft.voiceMode === 'edge'} onClick={() => updateDraft('voiceMode', 'edge')}>
        <span className="tc-choice-check">{draft.voiceMode === 'edge' ? '✓' : ''}</span><strong>Edge TTS</strong><span>无需填写密钥</span>
      </button>
      <button type="button" className="tc-choice" aria-pressed={draft.voiceMode === 'fish'} onClick={() => updateDraft('voiceMode', 'fish')}>
        <span className="tc-choice-check">{draft.voiceMode === 'fish' ? '✓' : ''}</span><strong>Fish Audio</strong><span>使用已连接的服务</span>
      </button>
    </div>
    {draft.voiceMode === 'upload' && <>
      <div className={`tc-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => {event.preventDefault(); setDragging(true)}} onDragLeave={() => setDragging(false)} onDrop={event => {event.preventDefault(); setDragging(false); pickVoice(event.dataTransfer.files[0])}}>
        <strong>把音频拖进来，或从电脑选择</strong><p>支持 MP3、WAV、M4A、AAC、OGG；单个文件不超过 250 MB</p>
        <input ref={voiceInput} type="file" accept=".wav,.mp3,.m4a,.aac,.ogg" hidden onChange={event => {pickVoice(event.target.files?.[0]); event.target.value = ''}}/>
        <Button variant="outline" className="tc-secondary" onClick={() => voiceInput.current?.click()}>选择音频文件</Button>
      </div>
      {voiceFile && <div className="tc-file-row"><span aria-hidden="true">♫</span><div className="tc-file-main"><strong>{voiceFile.name}</strong><small>{(voiceFile.size / 1024 / 1024).toFixed(1)} MB · 已选择</small></div><div className="tc-file-actions"><button className="tc-plain" type="button" onClick={() => voiceInput.current?.click()}>换一个</button><button className="tc-plain" type="button" onClick={() => setVoiceFile(undefined)}>移除</button></div></div>}
      {voiceUrl && <audio className="tc-audio" controls src={voiceUrl}/>}
      <p className="tc-field-help">声音和文案不同的地方，字幕可能对不上。</p>
    </>}
    {draft.voiceMode === 'edge' && <div className="tc-section">
      <div className="tc-field tc-voice-select"><label htmlFor="tc-edge-search">查找音色</label><input id="tc-edge-search" type="search" value={edgeVoiceQuery} onChange={event => setEdgeVoiceQuery(event.target.value)} placeholder="输入名称或地区，例如 晓晓、en-US"/></div>
      <div className="tc-field tc-voice-select"><label htmlFor="tc-edge-voice">选择声音</label><select id="tc-edge-voice" value={draft.edgeVoice} onChange={event => updateDraft('edgeVoice', event.target.value)}>
        {!visibleEdgeVoices.some(item => item.id === draft.edgeVoice) && <option value={draft.edgeVoice}>{draft.edgeVoice} · 当前选择</option>}
        {visibleEdgeVoices.map(item => <option key={item.id} value={item.id}>{edgeVoiceLabel(item)}</option>)}
      </select></div>
      <div className="tc-actions tc-voice-actions"><button type="button" className="tc-plain" onClick={() => setEdgeShowAll(value => !value)}>{edgeShowAll ? '只看中文' : '查看全部语言'}</button><button type="button" className="tc-plain" disabled={edgeVoiceLoading} onClick={() => void refreshEdgeVoices()}>{edgeVoiceLoading ? '正在读取音色…' : '刷新音色'}</button><span className="tc-muted">{edgeVoiceList.voices.length} 种音色{edgeVoiceList.source === 'fallback' ? ' · 当前显示基础列表' : ''}</span></div>
      <div className="tc-edge-preview"><Button variant="outline" className="tc-secondary" disabled={edgePreviewBusy} onClick={() => void playEdgePreview()}>{edgePreviewBusy ? '正在生成试听…' : edgePreview?.voice === draft.edgeVoice ? '▶ 再听一次' : '▶ 试听声音'}</Button><span className="tc-muted">试听当前口播稿的开头，最多 80 字</span></div>
      {edgePreviewError && <p className="tc-notice warn" role="alert">{edgePreviewError}</p>}
      {edgePreview && <audio ref={edgePreviewPlayer} className="tc-audio" controls src={edgePreview.url} preload="auto" aria-label="Edge TTS 音色试听" onError={() => {clearEdgePreview(); setEdgePreviewError('试听音频无法播放，请重试')}}/>}
      <div className={`tc-notice ${health.edgeTts === true && health.asrModel === true ? 'info' : 'warn'}`}>
        {health.edgeTts === false ? 'Edge TTS 依赖尚未准备，请在设置中查看准备说明。' : health.asrModel === false ? 'Edge TTS 已可生成声音；字级对齐还需准备本地识别模型。' : '开始制作时生成配音，并在本机完成字级对齐。'}
      </div>
    </div>}
    {draft.voiceMode === 'fish' && <div className={`tc-notice ${settings.fish ? 'info' : 'warn'}`}>{settings.fish ? 'Fish Audio 已连接。开始制作时才会提交配音请求。' : onOpenSettings ? 'Fish Audio 尚未连接，请在 e剪宝 顶部设置连接。' : <>Fish Audio 尚未连接。<button type="button" className="tc-plain" onClick={openSettings}>去设置 →</button></>}</div>}
    <div className="tc-footer sticky"><button className="tc-subtle" type="button" onClick={() => {setStep(0); setError('')}}>返回</button><Button variant="primary" className="tc-primary" onClick={() => {if (validateStep()) setStep(2)}}>下一步：添加画面 →</Button></div>
  </>

  const renderCreate = () => <div className="tc-wizard"><button className="tc-back" type="button" onClick={goHome}>← 我的视频</button><div className="tc-steps" aria-label="新建视频步骤">{['写文案', '选声音', '添画面'].map((name, index) => <div className="tc-step" key={name}><span className={`${index === step ? 'tc-step current' : index < step ? 'tc-step done' : 'tc-step'}`}><span className="tc-step-dot">{index < step ? '✓' : index + 1}</span>{name}</span>{index < 2 && <span className="tc-step-line"/>}</div>)}</div>
    {step === 0 && <><span className="tc-eyebrow">第一步 · 内容</span><h1>这条视频想说什么？</h1><p className="tc-description">把口播稿贴在这里。接下来会根据每句话安排画面。</p><div className="tc-form tc-section"><div className="tc-field"><label htmlFor="tc-title">视频名称（可改）</label><Input className="tc-title-input" id="tc-title" type="text" maxLength={120} value={draft.title} onChange={event => updateDraft('title', event.target.value)} placeholder={suggestedTitle(draft.text)}/>{!draft.title && draft.text.trim() && <div className="tc-field-help">留空时将使用口播稿第一句：{suggestedTitle(draft.text)}</div>}</div><div className="tc-field"><label htmlFor="tc-script">口播稿</label><textarea id="tc-script" maxLength={10000} value={draft.text} onChange={event => updateDraft('text', event.target.value)} placeholder="例如：很多人问，徒步到底是什么？其实徒步没有那么复杂……"/><div className="tc-field-count"><span>请尽量与配音说的话一致</span><span>{draft.text.trim().length} / 10000 字</span></div></div></div><div className="tc-footer sticky"><span className="tc-footer-hint">写完后选择配音来源。</span><Button variant="primary" className="tc-primary" onClick={() => {if (validateStep()) setStep(1)}}>下一步：选择声音 →</Button></div></>}
    {step === 1 && renderVoiceStep()}
    {step === 2 && <><span className="tc-eyebrow">第三步 · 画面</span><h1>画面从哪里来？</h1><p className="tc-description">上传自己拍的照片或视频；需要时也可以自动查找在线素材。</p><div className={`tc-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => {event.preventDefault(); setDragging(true)}} onDragLeave={() => setDragging(false)} onDrop={event => {event.preventDefault(); setDragging(false); addMedia(event.dataTransfer.files)}}><strong>拖入照片或视频</strong><p>也可以一次选择多个文件。支持 JPG、PNG、WebP、MP4、MOV、WebM。</p><input ref={mediaInput} type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm" multiple hidden onChange={event => {if (event.target.files) addMedia(event.target.files); event.target.value = ''}}/><Button variant="outline" className="tc-secondary" onClick={() => mediaInput.current?.click()}>＋ 添加照片或视频</Button></div>{mediaFiles.length > 0 && <div className="tc-media-grid">{mediaFiles.map(item => <MediaTile key={item.id} entry={item} onRemove={() => setMediaFiles(current => current.filter(other => other.id !== item.id))} onPreview={() => setPreview({kind: item.kind, file: item.file, label: item.file.name})}/>)}<button type="button" className="tc-add-tile" onClick={() => mediaInput.current?.click()}>＋ 继续添加</button></div>}<label className="tc-checkbox"><input type="checkbox" checked={draft.onlineSearch} onChange={event => updateDraft('onlineSearch', event.target.checked)}/><span>需要时找在线素材 <span className="tc-muted">（优先使用我上传的画面）</span></span></label>{draft.onlineSearch && !anyMaterialService && <div className="tc-notice warn">在线素材服务尚未连接。你可以直接使用上传的画面，{onOpenSettings ? '或在 e剪宝 顶部设置连接。' : <>或<button type="button" className="tc-plain" onClick={openSettings}>去设置在线素材 →</button></>}</div>}<p className="tc-field-help">人物出镜视频可以直接上传；这里不会生成数字人。</p><div className="tc-section"><div className="tc-field-label">视频画幅</div><div className="tc-choice-grid"><button className="tc-choice" type="button" aria-pressed={draft.aspect === '16:9'} onClick={() => updateDraft('aspect', '16:9')}><span className="tc-choice-check">{draft.aspect === '16:9' ? '✓' : ''}</span><strong>横屏 16:9</strong><span>适合电脑、电视和常规横版视频</span></button><button className="tc-choice" type="button" aria-pressed={draft.aspect === '9:16'} onClick={() => updateDraft('aspect', '9:16')}><span className="tc-choice-check">{draft.aspect === '9:16' ? '✓' : ''}</span><strong>竖屏 9:16</strong><span>适合手机竖版视频</span></button></div></div><div className="tc-summary">这次制作：{draft.text.trim().length} 字文案 · {draft.voiceMode === 'upload' ? `上传配音 ${voiceFile?.name ?? '未选择'}` : draft.voiceMode === 'edge' ? `Edge TTS · ${edgeVoiceList.voices.find(item => item.id === draft.edgeVoice)?.label ?? draft.edgeVoice}` : 'Fish Audio 配音'} · {mediaFiles.length} 项素材 · {draft.aspect === '16:9' ? '横屏' : '竖屏'}<br/>开始后会先安排画面，完成时等你确认，再制作一段试片。</div><div className="tc-footer sticky"><button className="tc-subtle" type="button" onClick={() => {setStep(1); setError('')}}>返回</button><Button variant="primary" className="tc-primary" disabled={!!busy} onClick={() => void create()}>{busy || '开始制作视频 →'}</Button></div></>}
  </div>

  const renderDocuments = () => {
    if (!job || (job.status === 'draft' && currentDocuments.length === 0)) return null
    const current = currentDocuments.find(item => item.file === activeDocument)
      ?? currentDocuments.find(item => item.file === 'SHOTBOOK.md')
      ?? currentDocuments[0]
    const loadError = documents?.id === job.id ? documents.error : undefined
    return <section className="tc-document-panel tc-section" aria-label="制作文档">
      <div className="tc-document-head"><div><h2>制作文档</h2><span className="tc-muted">{job.status === 'running' ? '制作中自动更新' : '直接在这里阅读素材来源和分镜脚本'}</span></div>{current && hasArtifact(job, current.file) && <a href={artifactUrl(job, current.file, true)} download={current.file}>下载 .md ↓</a>}</div>
      <div className="tc-document-layout"><div className="tc-document-tabs" role="tablist" aria-label="制作文档">{currentDocuments.map(item => <button type="button" role="tab" aria-controls="tc-document-content" aria-selected={current?.file === item.file} key={item.file} onClick={() => setActiveDocument(item.file)}>{item.name}<small>{item.file}</small></button>)}</div>
        <div className="tc-document-content" id="tc-document-content" role="tabpanel">{loadError && <p className="tc-notice warn">文档更新失败：{loadError}</p>}{current ? current.tooLarge ? <p>文件超过 1 MB，暂时无法在页面预览。</p> : <MarkdownText text={current.text} labels={markdownLabels} variant="compact"/> : <p className="tc-muted">{job.status === 'running' ? '制作文档生成后会自动显示在这里。' : '这条视频还没有生成制作文档。'}</p>}</div>
      </div>
    </section>
  }
  const retryEdge = async () => {
    if (!job) return
    setBusy('重试 Edge TTS…'); setError('')
    try {await api(`retry-edge?id=${job.id}`, {}); await api(`start?id=${job.id}`, {}); await refresh()}
    catch (cause) {setError(errorMessage(cause)); await refresh().catch(() => {})}
    finally {setBusy('')}
  }

  const renderJob = () => {
    if (!job) return <div className="tc-card tc-empty"><p>未找到这个视频。请返回“我的视频”重新选择。</p></div>
    const status = userStatus(job)
    const sampleFile = 'remotion/out/preview/s01.mp4'
    const otherArtifacts = job.artifacts.filter(item => item.file !== 'SHOTBOOK.md')
    const isReview = job.status === 'awaiting-shotbook' || job.status === 'awaiting-sample'
    return <div className="tc-detail"><button type="button" className="tc-back" onClick={goHome}>← 我的视频</button><div className="tc-status-head"><div><span className="tc-eyebrow">{isReview ? '需要你决定下一步' : '视频项目'}</span><h1>{job.title}</h1><p className="tc-description">{job.aspect} · {formatDate(job.createdAt)} 创建 · 最近更新 {elapsed(job.updatedAt, now)}</p></div><span className={`tc-status ${status.tone}`}>{status.label}</span></div>
      {job.status === 'awaiting-shotbook' ? <><div className="tc-section"><h2>看看画面安排</h2><p className="tc-description">{shots.length ? `已安排 ${shots.length} 段画面。确认后会先制作一段有声试片。` : '画面安排已生成，请查看分镜脚本。'}</p></div><div className="tc-card tc-section">{shots.length ? shots.map(shot => <div className="tc-shot" key={shot.id}><div className="tc-shot-media">{shot.upload ? shot.upload.kind === 'image' ? <img src={mediaUrl(job, shot.upload.file)} alt={`${shot.id} 素材预览`} loading="lazy"/> : <video src={mediaUrl(job, shot.upload.file)} muted preload="metadata"/> : <span>素材预览</span>}</div><div><div className="tc-shot-title"><span>{shot.id} · {shot.title}</span><span className="tc-shot-time">{formatSeconds(shot.start)}–{formatSeconds(shot.end)}</span></div><div className="tc-shot-copy">{shot.narration && <p><strong>旁白：</strong>{shot.narration}</p>}{shot.visual && <p><strong>画面：</strong>{shot.visual}</p>}</div><div className="tc-shot-source">{shot.upload ? `${shot.upload.name} · 我上传的素材` : shot.source || '素材详情见分镜脚本'}</div><details className="tc-details"><summary>查看这段的详细安排</summary><pre>{shot.body}</pre></details></div></div>) : <p>{shotbookText ? '画面安排暂时无法解析，请查看下方的分镜脚本。' : '正在读取画面安排…'}</p>}</div>{job.uploads.some(item => item.kind !== 'voice') && <section className="tc-section"><h2>我上传的画面</h2><div className="tc-candidates">{job.uploads.filter(item => item.kind !== 'voice').map(item => <div className="tc-candidate" key={item.file}>{item.kind === 'image' ? <img src={mediaUrl(job, item.file)} alt={item.name} loading="lazy"/> : <span aria-hidden="true">🎞</span>}<span>{item.name}<br/><span className="tc-muted">来自我的文件</span></span></div>)}</div></section>}{job.candidates.length > 0 && <section className="tc-section"><h2>可选的在线素材</h2><p className="tc-description">勾选要使用的素材。修改选择后会重新安排画面。</p><div className="tc-candidates tc-section">{job.candidates.map(item => <label className="tc-candidate" key={item.id}><input type="checkbox" checked={chosen.includes(item.id)} onChange={event => setChosen(items => event.target.checked ? [...items, item.id] : items.filter(id => id !== item.id))}/>{item.preview && <img src={item.preview} alt="在线素材预览" loading="lazy"/>}<span>{item.kind === 'video' ? '视频' : '图片'} · {item.provider}{item.author ? ` · ${item.author}` : ''}{item.source && <a href={item.source} target="_blank" rel="noreferrer">查看来源 ↗</a>}</span></label>)}</div></section>}{renderDocuments()}{feedbackOpen && feedbackBox(['多用我上传的画面', '文字少一些', '节奏慢一些'])}<div className="tc-footer sticky"><span className="tc-footer-hint">{selectedChanged ? '素材选择改变后将重新安排画面。' : '确认后会制作一段有声试片。'}</span><button type="button" className="tc-subtle" onClick={() => setFeedbackOpen(current => !current)}>{feedbackOpen ? '收起意见' : '我想调整'}</button>{feedbackOpen && <Button variant="outline" className="tc-secondary" disabled={!!busy || (!feedback.trim() && !selectedChanged)} onClick={() => void action('approve', {gate: 'shotbook', accepted: selectedChanged, feedback, selected: chosen})}>提交意见，重新安排</Button>}<Button variant="primary" className="tc-primary" disabled={!!busy || !hasArtifact(job, 'SHOTBOOK.md')} onClick={() => void action('approve', {gate: 'shotbook', accepted: true, feedback: '', selected: chosen})}>{selectedChanged ? '应用素材调整 →' : '可以，制作试片 →'}</Button></div></> : null}
      {job.status === 'awaiting-sample' && <><div className="tc-section"><h2>试看一小段</h2><p className="tc-description">这是开头的一段，带有配音。满意后继续制作完整视频。</p></div><div className="tc-video-layout tc-section"><div>{hasArtifact(job, sampleFile) ? <VideoPlayer job={job} file={sampleFile}/> : <div className="tc-notice warn">试片文件暂时无法读取，请刷新项目后重试。</div>}<div className="tc-actions tc-section">{hasArtifact(job, sampleFile) && <a className="tc-subtle" href={artifactUrl(job, sampleFile, true)} download="sample.mp4">下载试片</a>}</div></div><div className="tc-card tc-video-side"><strong>这段说了什么</strong><p>{shots[0]?.narration || job.text.split(/[。！？!?]/)[0]}</p>{shots[0]?.upload && <p>画面：{shots[0].upload.name}</p>}<details className="tc-details"><summary>查看镜头说明</summary><p>{shots[0]?.visual || '详细内容见分镜脚本'}</p></details></div></div>{renderDocuments()}{feedbackOpen && feedbackBox(['画面不合适', '字幕挡住人物', '节奏太快', '声音有问题'])}<div className="tc-footer sticky"><span className="tc-footer-hint">确认后会继续制作完整视频。</span><button type="button" className="tc-subtle" onClick={() => setFeedbackOpen(current => !current)}>{feedbackOpen ? '收起意见' : '我想调整'}</button>{feedbackOpen && <Button variant="outline" className="tc-secondary" disabled={!!busy || !feedback.trim()} onClick={() => void action('approve', {gate: 'sample', accepted: false, feedback})}>提交意见，重做试片</Button>}<Button variant="primary" className="tc-primary" disabled={!!busy || !hasArtifact(job, sampleFile)} onClick={() => void action('approve', {gate: 'sample', accepted: true})}>满意，继续完成 →</Button></div></>}
      {job.status === 'running' && <><StageRail job={job}/><div className="tc-status-card"><span className="tc-eyebrow">正在制作</span><h2>{status.detail}</h2><p className="tc-detail-meta">本阶段已用时 {Math.max(0, Math.floor((now - Date.parse(job.stageStartedAt ?? job.updatedAt)) / 60000))} 分钟 · 最近活动 {elapsed(job.updatedAt, now)}</p><p className="tc-muted">完成当前步骤后，如果需要你确认，会停下来等你查看。可以先离开这个页面，稍后从“我的视频”回来。</p><div className="tc-actions"><Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => void action('cancel')}>停止制作</Button>{hasArtifact(job, 'SHOTBOOK.md') && <a href={artifactUrl(job, 'SHOTBOOK.md', true)} download="SHOTBOOK.md">下载已有分镜</a>}</div></div></>}
      {['interrupted', 'failed', 'cancelled', 'draft'].includes(job.status) && <><StageRail job={job}/><div className="tc-status-card"><span className="tc-eyebrow">{status.label}</span><h2>{job.status === 'draft' ? '继续准备这条视频' : '可以从上次进度继续'}</h2><p>{shortJobError(job, status.detail)}</p>{job.fishSubmission === 'uncertain' && <div className="tc-notice warn">上次 Fish Audio 请求结果不明。为避免重复提交，请上传一份已生成的配音后继续。</div>}{job.edgeSubmission === 'uncertain' && <div className="tc-notice warn">上次 Edge TTS 请求结果不明，不会自动重新生成。你可以明确重试，或上传一份配音后继续。<div className="tc-actions"><Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => void retryEdge()}>重试 Edge TTS</Button></div></div>}{job.status === 'draft' && <div className="tc-field tc-section"><div className="tc-field-label">补充配音或画面素材</div><input ref={extraInput} type="file" accept=".wav,.mp3,.m4a,.aac,.ogg,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm" multiple hidden onChange={event => {const files = Array.from(event.target.files ?? []); event.target.value = ''; void uploadExisting(job.id, files)}}/><Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => extraInput.current?.click()}>选择文件上传</Button><p className="tc-field-help">已上传 {job.uploads.filter(item => item.kind !== 'voice').length} 项画面{job.uploads.some(item => item.kind === 'voice') ? '，已有配音' : ''}</p></div>}{(job.fishSubmission === 'uncertain' || job.edgeSubmission === 'uncertain') && <div className="tc-field tc-section"><div className="tc-field-label">上传已生成的配音</div><input ref={recoveryInput} type="file" accept=".wav,.mp3,.m4a,.aac,.ogg" hidden onChange={event => {const files = Array.from(event.target.files ?? []); event.target.value = ''; void uploadExisting(job.id, files, true)}}/><Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => recoveryInput.current?.click()}>选择配音文件</Button></div>}<Button variant="primary" className="tc-primary" disabled={!!busy} onClick={() => void action('start')}>{job.status === 'draft' ? '开始制作 →' : '从上次进度继续 →'}</Button></div></>}
      {job.status === 'completed' && <><div className="tc-section"><h2>视频做好了</h2><p className="tc-description">现在可以播放和下载。需要调整镜头或文字时，再进入精细编辑。</p></div>{hasArtifact(job, 'delivery.mp4') && <VideoPlayer job={job} file="delivery.mp4" className="tc-section"/>}<div className="tc-actions tc-section">{hasArtifact(job, 'delivery.mp4') && <a className="tc-subtle" href={artifactUrl(job, 'delivery.mp4', true)} download={`${job.title}.mp4`}>下载视频 MP4 ↓</a>}{job.approvedSample && <Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => void startEditor()}>精细编辑镜头、文字和节奏 →</Button>}</div></>}
      {job.status !== 'completed' && job.approvedSample && <div className="tc-section"><Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => void startEditor()}>精细编辑镜头、文字和节奏 →</Button></div>}
      {!isReview && renderDocuments()}
      {otherArtifacts.length > 0 && <ArtifactLibrary job={job} items={otherArtifacts} active={active}/>}
      <details className="tc-details"><summary>制作记录</summary><pre>{job.logs.length ? job.logs.join('\n') : '还没有制作记录。'}</pre></details>
    </div>
  }

  const renderEnvironment = () => <div className="tc-card tc-section">
    <div className="tc-health"><div><h2>制作状态</h2><p>{coreReady && agentIssues.length === 0 ? health.asrModel === false ? '本地制作工具已就绪；上传配音或 Edge TTS 还需准备配音识别模型。' : '本地制作工具已就绪。' : '有些制作工具需要准备，展开详情查看。'}</p></div><Button variant="outline" className="tc-secondary" disabled={!!busy} onClick={() => void checkHealth()}>重新检查</Button></div>
    <div className="tc-actions"><Button variant="primary" className="tc-primary" disabled={setup.status === 'running' || !!busy} onClick={() => void installMissing()}>{setup.status === 'running' ? '正在安装…' : '一键安装所有缺失依赖'}</Button></div>
    <p className="tc-field-help">依赖安装到应用私有目录。配音识别模型至少约 700 MB，Remotion 浏览器也需单独下载。</p>
    {setup.items.find(item => item.status === 'running') && <p className="tc-notice info">正在处理：{setup.items.find(item => item.status === 'running')?.label}</p>}
    {setup.status === 'failed' && <p className="tc-notice warn">有依赖安装失败，展开详情查看原因并重试。</p>}
    <details className="tc-details"><summary>查看本地环境与安装进度</summary>
      <div className="tc-health-list">{(['node', 'python', 'edgeTts', 'ffmpeg', 'ffprobe', 'remotion', 'browser', 'asrModel'] as const).map(key => <span className={health[key] === true ? '' : 'missing'} key={key}>{health[key] === true ? '✓' : '需准备'} {key === 'asrModel' ? '配音识别模型' : key === 'edgeTts' ? 'Edge TTS' : key === 'python' ? '口播 Python 包环境' : key === 'remotion' ? 'Remotion 与原生组件' : key}</span>)}</div>
      {agentIssues.map(issue => <p className="tc-notice warn" key={issue}>{issue}</p>)}
      {setup.items.map(item => <p className="tc-field-help" key={item.id}>{item.status === 'running' ? '正在处理' : item.status === 'completed' || item.status === 'ready' ? '✓' : item.status === 'failed' ? '失败' : '待处理'} {item.label}{item.detail ? `：${item.detail}` : ''}</p>)}
      {setup.status === 'failed' && <p className="tc-notice warn">部分依赖安装失败；再次点击只处理未就绪项。</p>}
      {setup.logs.length > 0 && <pre>{setup.logs.join('\n')}</pre>}
    </details>
  </div>

  const renderSettings = () => <div className="tc-detail"><button className="tc-back" type="button" onClick={() => {setPage(returnPage === 'settings' ? 'home' : returnPage); setError('')}}>← 返回</button><span className="tc-eyebrow">口播视频制作</span><h1>设置</h1><p className="tc-description">Edge TTS 无需密钥；Fish Audio 与在线素材服务可在这里连接。</p><section className="tc-section"><MediaSettingsEditor api={API} engine="talkcraft"/></section>{renderEnvironment()}<section className="tc-section"><h2>口播专属服务</h2><div className="tc-settings-grid">{(['fish'] as const).map(name => <div className="tc-card" key={name}><div className="tc-service"><div><h3>{serviceNames[name]}</h3><p>{name === 'fish' ? '没有成品配音时生成声音' : '上传的画面不够时查找素材'}</p><p className={settings[name] ? 'tc-service-connected' : undefined}>{settings[name] ? '● 已连接' : '○ 未连接'}</p></div><button className="tc-subtle" type="button" onClick={() => {setKeyEditing(keyEditing === name ? null : name); setRemoveKey(null); setKeyValue('')}}>{keyEditing === name ? '收起' : settings[name] ? '管理' : '连接'}</button></div>{keyEditing === name && <div className="tc-service-edit"><label className="tc-field-label" htmlFor={`tc-key-${name}`}>{settings[name] ? '输入新密钥以替换' : '输入服务密钥'}</label><input id={`tc-key-${name}`} type="password" autoComplete="off" value={keyValue} onChange={event => setKeyValue(event.target.value)} placeholder="密钥仅保存到本机 Credentials"/><div className="tc-actions"><Button variant="primary" className="tc-primary" disabled={!!busy || !keyValue.trim()} onClick={() => void saveKey(name, keyValue)}>保存密钥</Button>{settings[name] && <button type="button" className="tc-plain" onClick={() => setRemoveKey(name)}>移除密钥</button>}</div>{removeKey === name && <div className="tc-notice warn">确定移除 {serviceNames[name]} 的密钥吗？<div className="tc-actions"><button type="button" className="tc-subtle" disabled={!!busy} onClick={() => void saveKey(name, '')}>确认移除</button><button type="button" className="tc-plain" onClick={() => setRemoveKey(null)}>取消</button></div></div>}</div>}</div>)}</div></section></div>

  const renderHelp = () => <div className="tc-detail"><button className="tc-back" type="button" onClick={goHome}>← 我的视频</button><h1>怎样制作一条视频</h1><div className="tc-card tc-section"><h2>只需准备三样东西</h2><p>一段口播稿、声音来源，以及照片或视频。没有足够画面时，可以连接在线素材服务。</p><h2>制作时会请你看两次</h2><p>先确认画面安排，再试看开头的一小段有声视频。确认后继续制作整条视频。</p><h2>想自己细调？</h2><p>试片确认后，可以从项目进入精细编辑，调整镜头、文字和节奏。</p></div></div>

  return <section ref={rootElement} className="tc" data-talkcraft-main="" data-container-panel={containerPanelId} hidden={!active}>
    <style>{styles}</style>
    <div className={`tc-shell ${page === 'editor' ? 'editing' : ''}`}>
      <header className="tc-top"><button className="tc-brand" type="button" onClick={goHome} aria-label="口播视频制作首页"><span className="tc-brand-mark">▶</span>口播视频制作</button><div className="tc-top-actions"><button type="button" onClick={() => {if (editor) closeEditor(); setPage('help'); setError('')}}>帮助</button>{!onOpenSettings && <button type="button" onClick={openSettings}>设置</button>}</div></header>
      {error && <div className="tc-notice error" role="alert">{error}</div>}
      {busy && page !== 'create' && <div className="tc-notice info" role="status">{busy}</div>}
      {page === 'home' ? renderHome() : page === 'create' ? renderCreate() : page === 'job' ? renderJob() : page === 'settings' ? renderSettings() : page === 'help' ? renderHelp() : null}
      {editor && <div hidden={page !== 'editor'}>
        <button type="button" className="tc-back" onClick={closeEditor}>← 返回视频</button>
        <div className="tc-page-heading"><div><span className="tc-eyebrow">{job?.title}</span><h1>精细编辑</h1><p className="tc-description">调整镜头、文字和节奏，完成后可在工作台导出。</p></div><Button variant="outline" className="tc-secondary" onClick={closeEditor}>关闭工作台</Button></div>
        <iframe ref={editorFrame} title="口播视频制作工作台" className="tc-editor" src={editor.url} onLoad={notifyWorkbenchVisibility}/>
      </div>}
    </div>
    {preview && <PreviewDialog item={preview} active={active} onClose={() => setPreview(undefined)}/>}
    {deleteTarget && <DeleteDialog job={deleteTarget} active={active} busy={deleteBusy} error={deleteError} onCancel={() => {setDeleteTarget(undefined); setDeleteError('')}} onConfirm={() => void deleteVideo()}/>}
  </section>
}
