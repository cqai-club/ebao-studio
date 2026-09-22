/** Loopback HTTP surface shared by the DSH Host and the two React panels. */
export const API = '/api/cqai-publisher'

/** Video platforms supported by the embedded MatrixMedia Worker. */
export const VIDEO_PLATFORMS = ['dy', 'sph', 'xhs', 'blbl', 'ks', 'tt', 'bjh', 'fqsp'] as const
export type Platform = typeof VIDEO_PLATFORMS[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  dy: '抖音', sph: '视频号', xhs: '小红书', blbl: '哔哩哔哩',
  ks: '快手', tt: '头条', bjh: '百家号', fqsp: '番茄视频',
}

export const MAX_TAGS = 8
export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 2000

export const CREATIVE_STATEMENTS = [
  'none', 'ai_generated', 'fiction', 'marketing', 'personal_opinion', 'repost', 'self_made_no_repost',
] as const
export type CreativeStatement = typeof CREATIVE_STATEMENTS[number]

/** Public account snapshot. Cookie values and session partition names never cross this API. */
export interface PublisherAccount {
  id: string
  displayName: string
  platform: Platform
  loginState: 'logged-in' | 'logged-out' | 'unknown'
  expiresAt?: number
}

/** Immutable accepted-submission snapshot. It intentionally contains no execution state. */
export interface PublisherSubmission {
  id: string
  createdAt: string
  workId: string
  title: string
  mode: 'publish' | 'draft'
  targets: Array<{
    accountId: string
    platform: Platform
    accountName: string
  }>
}

/** Side-effect-free desktop capability answer. */
export interface PublisherCapability {
  supported: boolean
  running: boolean
  reason?: 'publisher-not-supported' | 'publisher-worker-missing'
  message?: string
}

/** e剪宝 output safe to expose to the browser. The absolute video path is Host-only. */
export interface Work {
  id: string
  title: string
  description: string
  tags: string[]
  aiGeneratedDisclosure: string
  createdAt: string
  bytes: number
}

/** Existing standalone MatrixMedia accounts that can be copied into e宝. */
export interface PublisherImportPreview {
  running: boolean
  accounts: Array<{
    displayName: string
    platform: Platform
    platformName: string
  }>
}

/** Browser request; Host resolves workId to its actual final_video.mp4. */
export interface CreateSubmissionRequest {
  workId: string
  title: string
  description?: string
  shortTitle?: string
  tags?: string[]
  creativeStatement?: CreativeStatement
  mode: 'publish' | 'draft'
  accountIds: string[]
}

/** Worker acceptance response. */
export interface CreateSubmissionResult {
  accepted: true
  submission: PublisherSubmission
}
