export const API = '/cqai-short-video'
export type Stage = 'script' | 'terms' | 'audio' | 'subtitle' | 'materials' | 'video'
export type Status = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type UploadKind = 'material' | 'audio' | 'bgm'
export type ContentAction = 'preview' | 'script' | 'terms'
export type ContentResult = { prompt?: string; defaultSystemPrompt?: string; script?: string; terms?: string[] }
export type Artifact = { file: string; name: string; size: number; kind: 'video' | 'audio' | 'subtitle' | 'data' }
export type Draft = {
  textModel: string
  imageModel: string
  stopAt: Stage
  params: Record<string, unknown>
}
export function needsText(draft: Draft): boolean {
  return !draft.params.video_script || (draft.stopAt !== 'script' && draft.params.video_source !== 'local' && !draft.params.video_terms)
}
export function stageRequirements(draft: Draft) {
  const visuals = draft.stopAt === 'materials' || draft.stopAt === 'video'
  return {
    imageModel: visuals && draft.params.video_source === 'openai_image',
    materialUpload: visuals && draft.params.video_source === 'local',
    backgroundMusicUpload: draft.stopAt === 'video' && draft.params.bgm_type === 'custom',
  }
}
export type Job = Draft & {
  id: string
  status: Status
  progress: number
  createdAt: string
  updatedAt: string
  state?: Record<string, unknown>
  error?: string
  logs: string[]
  uploads: { material: string[]; audio?: string; bgm?: string }
  artifacts: Artifact[]
}
export type Catalog = {
  signedIn: boolean
  text: { id: string; name: string }[]
  image: { id: string; name: string }[]
  warning?: string
  defaultText?: string
  defaultImage?: string
}
export type Settings = {
  pexels_api_keys: string
  pixabay_api_keys: string
  coverr_api_keys: string
  subtitle_provider: 'edge' | 'whisper'
  video_codec: 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf'
}
export const defaultSettings: Settings = {
  pexels_api_keys: '', pixabay_api_keys: '', coverr_api_keys: '',
  subtitle_provider: 'edge', video_codec: 'libx264',
}
export const defaultParams: Record<string, unknown> = {
  video_subject: '', video_script: '', video_terms: '',
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
