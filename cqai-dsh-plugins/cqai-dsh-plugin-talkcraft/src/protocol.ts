export const API = '/api/cqai-talkcraft'
export type Stage = 'prepare' | 'shotbook' | 'sample' | 'finish' | 'review'
export const STAGES: readonly Stage[] = ['prepare', 'shotbook', 'sample', 'finish', 'review']
export const STAGE_LABEL: Record<Stage, string> = {prepare: '配音、对齐与素材', shotbook: '分镜', sample: '有声样板镜', finish: '完整成片', review: '独立审片'}
export type JobStatus = 'draft' | 'running' | 'awaiting-shotbook' | 'awaiting-sample' | 'interrupted' | 'failed' | 'cancelled' | 'completed'
export type UploadKind = 'voice' | 'video' | 'image'
export type VoiceSource = 'upload' | 'edge' | 'fish'
export interface EdgeVoice {id: string; locale: string; gender: 'Female' | 'Male'; label?: string}
export interface EdgeVoiceList {voices: EdgeVoice[]; source: 'live' | 'cache' | 'fallback'}
export const isEdgeVoiceId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2}-[A-Za-z0-9-]{1,70}Neural(?:-V[0-9]+)?$/.test(value)
export const EDGE_VOICES: readonly EdgeVoice[] = [
  {id: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN', gender: 'Female', label: '晓晓'},
  {id: 'zh-CN-XiaoyiNeural', locale: 'zh-CN', gender: 'Female', label: '晓伊'},
  {id: 'zh-CN-YunjianNeural', locale: 'zh-CN', gender: 'Male', label: '云健'},
  {id: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male', label: '云希'},
  {id: 'zh-CN-YunxiaNeural', locale: 'zh-CN', gender: 'Male', label: '云夏'},
  {id: 'zh-CN-YunyangNeural', locale: 'zh-CN', gender: 'Male', label: '云扬'},
  {id: 'zh-CN-liaoning-XiaobeiNeural', locale: 'zh-CN', gender: 'Female', label: '晓北（辽宁）'},
  {id: 'zh-CN-shaanxi-XiaoniNeural', locale: 'zh-CN', gender: 'Female', label: '晓妮（陕西）'},
  {id: 'zh-HK-HiuGaaiNeural', locale: 'zh-HK', gender: 'Female'},
  {id: 'zh-HK-HiuMaanNeural', locale: 'zh-HK', gender: 'Female'},
  {id: 'zh-HK-WanLungNeural', locale: 'zh-HK', gender: 'Male'},
  {id: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW', gender: 'Female'},
  {id: 'zh-TW-HsiaoYuNeural', locale: 'zh-TW', gender: 'Female'},
  {id: 'zh-TW-YunJheNeural', locale: 'zh-TW', gender: 'Male'},
]
export interface Candidate {id: string; provider: 'Pexels' | 'Pixabay'; kind: 'video' | 'image'; url: string; preview: string; source: string; author: string; selected: boolean}
export interface Artifact {file: string; name: string; size: number}
export interface JobDocument {file: 'sources.md' | 'SHOTBOOK.md'; name: string; text: string; size: number; tooLarge: boolean}
export interface Job {
  id: string; title: string; text: string; aspect: '16:9' | '9:16'; createdAt: string; updatedAt: string; stageStartedAt?: string
  onlineSearch?: boolean
  voiceSource?: VoiceSource; edgeVoice?: string
  status: JobStatus; stage: Stage | null; error?: string; feedback?: string
  uploads: Array<{kind: UploadKind; file: string; name: string}>
  candidates: Candidate[]; artifacts: Artifact[]; logs: string[]
  completedStages: Stage[]; fishSubmission?: 'uncertain' | 'completed'
  edgeSubmission?: 'uncertain' | 'completed'
  approvedShotbook?: boolean; approvedSample?: boolean
  stageSessions?: Partial<Record<Stage, string>>
  shotbookDraftSession?: string
  shotbookRepairSession?: string
}
