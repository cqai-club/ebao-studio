/** Loopback HTTP surface shared by the DSH Host and the React publisher panel. */
export const API = '/api/cqai-publisher'

/** Video platforms supported by the embedded MatrixMedia Worker. */
export const VIDEO_PLATFORMS = ['dy', 'sph', 'xhs', 'blbl', 'ks', 'tt', 'bjh', 'fqsp'] as const
export const PLATFORMS = [...VIDEO_PLATFORMS, 'juejin'] as const
export type Platform = typeof PLATFORMS[number]
export type PublisherContentType = 'video' | 'article' | 'image-note'
export type PublisherMode = 'publish' | 'draft'

export const PLATFORM_LABELS: Record<Platform, string> = {
  dy: '抖音', sph: '视频号', xhs: '小红书', blbl: '哔哩哔哩',
  ks: '快手', tt: '头条', bjh: '百家号', fqsp: '番茄视频', juejin: '掘金',
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
  contentId: string
  contentType: PublisherContentType
  /** Retained for old video submissions and e剪宝 handoff lookup. */
  workId?: string
  title: string
  mode: PublisherMode
  targets: Array<{
    accountId: string
    platform: Platform
    accountName: string
  }>
}

export interface PublisherPlatformCapability {
  platform: Platform
  contentTypes: PublisherContentType[]
  modes: Partial<Record<PublisherContentType, PublisherMode[]>>
  requiredFields: Partial<Record<PublisherContentType, string[]>>
  maxAssets?: Partial<Record<PublisherContentType, number>>
  maxTitleLength?: Partial<Record<PublisherContentType, number>>
}

export interface PublisherAsset {
  id: string
  name: string
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: number
}

/** A video draft remembers only a managed work ID or an opaque native selection ID. */
export type PublisherVideoSource =
  | { kind: 'work'; workId: string }
  | { kind: 'local'; localVideoId: string; fileName: string; bytes: number }

export interface PublisherContent {
  id: string
  contentType: PublisherContentType
  revision: number
  createdAt: string
  updatedAt: string
  title: string
  body: string
  summary: string
  /** Video-only fields; article and image-note continue to use body/summary. */
  description?: string
  shortTitle?: string
  videoSource?: PublisherVideoSource
  tags: string[]
  creativeStatement: CreativeStatement
  assets: PublisherAsset[]
  coverAssetId?: string
  platformFields: Partial<Record<Platform, Record<string, string>>>
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

/** A native file chooser selection; the absolute path stays in Electron main's private registry. */
export interface PublisherLocalVideo {
  id: string
  fileName: string
  title: string
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

/** Browser request; Host resolves works while Electron main resolves native-picked videos. */
export type CreateVideoSubmissionRequest = {
  contentType?: 'video'
  title: string
  description?: string
  shortTitle?: string
  tags?: string[]
  creativeStatement?: CreativeStatement
  mode: PublisherMode
  accountIds: string[]
} & ({ workId: string; localVideoId?: never } | { localVideoId: string; workId?: never })

export interface CreateContentSubmissionRequest {
  contentType: PublisherContentType
  contentId: string
  revision: number
  mode: PublisherMode
  accountIds: string[]
}

export type CreateSubmissionRequest = CreateVideoSubmissionRequest | CreateContentSubmissionRequest

/** Worker acceptance response. */
export interface CreateSubmissionResult {
  accepted: true
  submission: PublisherSubmission
}
