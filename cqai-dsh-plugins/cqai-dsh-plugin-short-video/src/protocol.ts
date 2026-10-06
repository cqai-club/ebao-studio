export const API = '/cqai-short-video'
export type Stage = 'script' | 'terms' | 'audio' | 'subtitle' | 'materials' | 'video'
export type Status = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type UploadKind = 'material' | 'audio' | 'bgm'
export type AudioSource = 'tts' | 'upload' | 'video_original'
export type ContentAction = 'preview' | 'script' | 'terms'
export type ContentResult = { prompt?: string; defaultSystemPrompt?: string; script?: string; terms?: string[] }
export type Artifact = { file: string; name: string; size: number; kind: 'video' | 'audio' | 'subtitle' | 'material' | 'data' }
export type Draft = {
  textModel: string
  imageModel: string
  videoModel: string
  stopAt: Stage
  params: Record<string, unknown>
}
export function needsText(draft: Draft): boolean {
  return !draft.params.video_script || (['materials','video'].includes(draft.stopAt) && draft.params.video_source !== 'local' && !draft.params.video_terms)
}
export function stageRequirements(draft: Draft) {
  const visuals = draft.stopAt === 'materials' || draft.stopAt === 'video' || (draft.stopAt === 'subtitle' && draft.params.audio_source === 'video_original')
  return {
    imageModel: visuals && draft.params.video_source === 'openai_image',
    videoModel: visuals && draft.params.video_source === 'cqai_video',
    materialUpload: visuals && draft.params.video_source === 'local',
    backgroundMusicUpload: draft.stopAt === 'video' && draft.params.bgm_type === 'custom',
  }
}
export type Job = Draft & {
  id: string
  workflowId?: string
  status: Status
  progress: number
  createdAt: string
  updatedAt: string
  state?: Record<string, unknown>
  error?: string
  logs: string[]
  uploads: { material: string[]; audio?: string; bgm?: string }
  artifacts: Artifact[]
  audioPreviewJobId?: string
  materialPreviewJobId?: string
  subtitlePreviewJobId?: string
  materialGroups?: string[][]
  materialAudio?: boolean[][]
  materialDurations?: number[][]
  materialShots?: { videoIndex: number; clipIndex: number; remoteTaskId?: string; file: string }[]
  subtitleDurations?: number[]
  voiceTimingAvailable?: boolean
  subtitleProvider?: Settings['subtitle_provider']
  videoTasks?: { key: string; id?: string; model: string; prompt: string; status: 'submitting' | 'queued' | 'in_progress' | 'completed' | 'failed'; seconds: number; progress?: number }[]
}
export type WorkflowGroup = { id: string; latest: Job; jobs: Job[] }
export function workflowIdForJob(job: Job, byId: ReadonlyMap<string, Job>): string {
  const visited = new Set<string>()
  let current = job
  while (true) {
    if (current.workflowId) return current.workflowId
    if (!current.audioPreviewJobId || visited.has(current.id)) return current.id
    visited.add(current.id)
    const preview = byId.get(current.audioPreviewJobId)
    if (!preview) return current.audioPreviewJobId
    current = preview
  }
}
export function workflowIdForNewJob(id: string, requested: string | undefined, preview: Job | undefined, byId: ReadonlyMap<string, Job>): string {
  const inherited = preview ? workflowIdForJob(preview, byId) : undefined
  if (requested && inherited && requested !== inherited) throw new Error('配音试听不属于当前制作流程')
  if (requested && !inherited && ![...byId.values()].some(job => workflowIdForJob(job, byId) === requested)) throw new Error('找不到制作流程，请新增任务')
  return inherited || requested || id
}
export function groupJobsByWorkflow(jobs: Job[]): WorkflowGroup[] {
  const byId = new Map(jobs.map(job => [job.id, job]))
  const groups = new Map<string, WorkflowGroup>()
  for (const job of [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))) {
    const id = workflowIdForJob(job, byId)
    const group = groups.get(id)
    if (group) group.jobs.push(job)
    else groups.set(id, {id, latest: job, jobs: [job]})
  }
  return [...groups.values()]
}
export function workflowDisplayJob(group: WorkflowGroup): Job {
  return group.jobs.find(job => job.status === 'running') || group.latest
}
export function workflowDraft(group: WorkflowGroup, manifests: ReadonlyMap<string, {script?: unknown; search_terms?: unknown}> = new Map()): Draft {
  const content = (key: 'video_script' | 'video_terms'): string => {
    for (const job of group.jobs) {
      const generated = job.state?.[key === 'video_script' ? 'script' : 'terms']
      if (typeof generated === 'string' && generated.trim()) return generated
      if (key === 'video_terms' && Array.isArray(generated) && generated.every(term => typeof term === 'string') && generated.length) return generated.join(', ')
      const saved = manifests.get(job.id)?.[key === 'video_script' ? 'script' : 'search_terms']
      if (typeof saved === 'string' && saved.trim()) return saved
      if (key === 'video_terms' && Array.isArray(saved) && saved.every(term => typeof term === 'string') && saved.length) return saved.join(', ')
      const entered = job.params[key]
      if (typeof entered === 'string' && entered.trim()) return entered
    }
    return ''
  }
  const latest = group.latest
  const visual = group.jobs.find(job => ['materials', 'subtitle', 'video'].includes(job.stopAt))
  const model = (key: 'textModel' | 'imageModel' | 'videoModel'): string => group.jobs.find(job => job[key])?.[key] || ''
  return {
    textModel: model('textModel'), imageModel: model('imageModel'), videoModel: model('videoModel'), stopAt: latest.stopAt,
    params: {...defaultParams, ...latest.params,
      ...(latest.stopAt === 'audio' && visual ? {video_source: visual.params.video_source} : {}),
      video_script: content('video_script'), video_terms: content('video_terms')},
  }
}
export function workflowAudioPreview(group: WorkflowGroup, draft: Draft): Job | undefined {
  return group.jobs.find(job => !audioPreviewReuseIssue(job, {...draft, stopAt: 'audio'}, draft.params.audio_source === 'upload' ? 'whisper' : 'edge'))
}
export function audioPreviewReuseIssue(source: Job, draft: Draft, subtitleProvider: Settings['subtitle_provider']): string | undefined {
  if (source.params.audio_source === 'video_original' || draft.params.audio_source === 'video_original') return '视频原声不使用配音试听'
  if ((source.params.audio_source ?? 'tts') !== (draft.params.audio_source ?? 'tts')) return '声音来源已改变，请重新确认声音'
  if (source.status !== 'completed' || !['audio', 'subtitle'].includes(source.stopAt)) return '请先完成配音生成'
  if (!source.artifacts.some(a => a.kind === 'audio')) return '试听任务没有音频文件，请重新生成配音'
  if (!source.params.video_script || !draft.params.video_script) return '请先确认视频文案，再生成配音'
  if (['video_script', 'voice_name', 'voice_rate', 'voice_volume'].some(key => source.params[key] !== draft.params[key])) {
    return '文案或配音设置已改变，请重新生成配音'
  }
  const needsSubtitle = draft.params.subtitle_enabled && ['subtitle', 'video'].includes(draft.stopAt)
  if (needsSubtitle && subtitleProvider === 'edge' && !source.voiceTimingAvailable) {
    const legacySubtitle = source.stopAt === 'subtitle' &&
      source.params.subtitle_display_mode === draft.params.subtitle_display_mode &&
      source.subtitleProvider === subtitleProvider &&
      source.artifacts.some(a => a.kind === 'subtitle')
    if (!legacySubtitle) return source.uploads.audio
      ? '上传旁白没有 Edge 时间轴；请在“字幕”步骤选用 Whisper 并保存，或关闭字幕'
      : '这段配音缺少可复用时间轴；请重新生成配音，或在“字幕”步骤选用 Whisper'
  }
}
export function materialPreviewReuseIssue(source: Job, draft: Draft): string | undefined {
  if (source.stopAt !== 'materials' || source.params.video_source !== 'cqai_video') return '请先完成 AI 视频素材生成'
  if (source.status === 'running') return 'AI 视频素材正在生成，请等待任务完成'
  if (source.status !== 'completed') {
    if (source.videoTasks?.some(task => ['submitting', 'queued', 'in_progress'].includes(task.status))) return '视频镜头可能已受理，请核对远端任务并在原任务中继续，避免重复计费'
    if (source.status === 'failed') return 'AI 视频素材生成失败，请查看任务错误并确认模型和服务可用后再生成素材'
    if (source.status === 'cancelled' || source.status === 'interrupted') return 'AI 视频素材生成已停止，请查看原任务状态后继续'
    return '请先完成 AI 视频素材生成'
  }
  const perVideo = Math.ceil(Number(source.params.target_duration_seconds) / Number(source.params.video_clip_duration))
  if (!source.materialGroups?.length || source.materialGroups.length !== source.params.video_count || !Number.isFinite(perVideo) || source.materialGroups.some(group => group.length !== perVideo)) return '已生成素材缺少镜头文件'
  const generatedTerms=Array.isArray(source.state?.terms) && source.state.terms.every(term=>typeof term==='string') ? source.state.terms.join(', ') : undefined
  const termsMatch=draft.params.video_terms===source.params.video_terms || (generatedTerms!==undefined && draft.params.video_terms===generatedTerms)
  if (source.videoModel !== draft.videoModel || !termsMatch || ['target_duration_seconds','video_clip_duration','video_count','match_materials_to_script'].some(key => source.params[key] !== draft.params[key])) return '视频素材参数已改变，请重新生成素材'
}
export function subtitlePreviewReuseIssue(source: Job, draft: Draft, materialPreviewId?: string, audioPreviewId?: string): string | undefined {
  if (source.status !== 'completed' || source.stopAt !== 'subtitle') return '请先完成字幕预览'
  if (source.params.audio_source !== draft.params.audio_source || source.materialPreviewJobId !== materialPreviewId) return '声音或素材已改变，请重新生成字幕'
  const keys = source.params.audio_source === 'video_original'
    ? ['video_concat_mode','video_clip_speed','video_transition_mode','video_aspect','video_fit_mode','video_count','subtitle_display_mode']
    : ['video_script','voice_name','voice_rate','voice_volume','subtitle_display_mode']
  if (keys.some(key => source.params[key] !== draft.params[key])) return '声音或剪辑设置已改变，请重新生成字幕'
  if (source.params.audio_source === 'upload' && (!audioPreviewId || (source.audioPreviewJobId !== audioPreviewId && source.id !== audioPreviewId))) return '上传的旁白已改变，请重新生成字幕'
}
export type Catalog = {
  signedIn: boolean
  text: { id: string; name: string }[]
  image: { id: string; name: string }[]
  video?: { id: string; name: string; callable: boolean }[]
  warning?: string
  defaultText?: string
  defaultImage?: string
}

export const VIDEO_MODEL_UNAVAILABLE = '该模型未声明可用的视频生成服务，暂不可选；请刷新模型列表，或联系管理员确认服务配置'

/** Share the capability gate between the selector, imported drafts, and Host submissions. */
export function videoModelIssue(catalog: Catalog | undefined, model: string): string | undefined {
  if (!catalog?.signedIn) return '请先登录 CQAI Club 并刷新模型列表'
  if (!model) return '请选择可用的 CQAI Club 视频模型'
  const selected = catalog.video?.find(item => item.id === model)
  if (!selected) return '所选视频模型不在当前 CQAI Club 账号中，请刷新模型列表并重新选择'
  if (selected.callable !== true) return VIDEO_MODEL_UNAVAILABLE
}

export function defaultVideoModel(catalog: Catalog | undefined, current = ''): string {
  // Keep explicit/history parameters, including models used by completed paid clips.
  // videoModelIssue blocks new submissions if that selection is no longer callable.
  if (current) return current
  if (!catalog?.signedIn) return ''
  return catalog.video?.find(model => model.callable === true)?.id || ''
}
export type Settings = {
  pexelsConfigured: boolean
  pixabayConfigured: boolean
  coverrConfigured: boolean
  subtitle_provider: 'edge' | 'whisper'
  video_codec: 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf'
}
export const defaultSettings: Settings = {
  pexelsConfigured: false, pixabayConfigured: false, coverrConfigured: false,
  subtitle_provider: 'edge', video_codec: 'libx264',
}
const stockMaterialKeys = {
  pexels: {name: 'Pexels', key: 'pexelsConfigured'},
  pixabay: {name: 'Pixabay', key: 'pixabayConfigured'},
  coverr: {name: 'Coverr', key: 'coverrConfigured'},
} as const
export function materialKeyIssue(draft: Draft, settings: Settings): string | undefined {
  if (!stageRequirements(draft).materialUpload && !['materials','video'].includes(draft.stopAt)) return
  const source = String(draft.params.video_source)
  if (!(source in stockMaterialKeys)) return
  const {name, key} = stockMaterialKeys[source as keyof typeof stockMaterialKeys]
  if (!settings[key]) return `当前选择 ${name} 素材库，但尚未保存 ${name} API Key。请在“设置 → 素材平台”填入密钥并点击“保存设置”后重试。`
}
export const defaultParams: Record<string, unknown> = {
  video_subject: '', video_script: '', video_terms: '',
  audio_source: 'tts', target_duration_seconds: 30,
  video_aspect: '9:16', video_fit_mode: 'cover',
  video_concat_mode: 'random', video_transition_mode: null,
  video_clip_duration: 5, video_clip_speed: 1, video_count: 1,
  video_source: 'pexels', match_materials_to_script: false,
  video_language: '', paragraph_number: 1,
  video_script_prompt: '', custom_system_prompt: '',
  voice_name: 'zh-CN-XiaoxiaoNeural-Female', voice_rate: 1,
  voice_volume: 1, bgm_type: 'none', bgm_volume: 0.2,
  subtitle_enabled: true, subtitle_position: 'bottom',
  subtitle_display_mode: 'sentence', subtitle_animation: 'none',
  font_name: '', font_size: 60, custom_position: 70,
  text_fore_color: '#FFFFFF', text_background_color: false,
  rounded_subtitle_background: false, stroke_color: '#000000',
  stroke_width: 1.5, n_threads: 2,
}
