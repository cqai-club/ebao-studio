export const API = '/api/cqai-video'
export const STAGES = ['script', 'digitalhuman', 'motionpack', 'align', 'render', 'studio', 'publish'] as const
export type Stage = typeof STAGES[number]
export const LABELS: Record<Stage, string> = {script: '文案整理', digitalhuman: '口播视频', motionpack: '动效包装', align: '字幕校准', render: '渲染成片', studio: '导入预览台', publish: '准备发布包'}
export type Mode = 'video' | 'digitalhuman' | 'plan'
export type UploadKind = 'script' | 'video' | 'avatar' | 'voice'
export interface Options {title: string; text: string; duration: number; mode: Mode; optimize: boolean; covers: boolean; studio: boolean}
export interface Job {
  id: string; createdAt: string; options: Options; status: 'draft' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stage?: Stage; stages: Partial<Record<Stage, 'running' | 'completed' | 'skipped' | 'failed'>>;
  uploads: Partial<Record<UploadKind, {file: string; name: string}>>; logs: string[]; error?: string;
  artifacts: {name: string; file: string; size: number}[];
  cloud?: {provider?: 'inferflow'; credentialId?: string; quote: {id: string; amount: number; unit: string; expiresAt: string; displayAmount?: string}; runId?: string; accountId: number; submissionStarted?: boolean};
}
