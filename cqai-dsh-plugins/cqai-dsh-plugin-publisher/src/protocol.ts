/** Loopback HTTP surface shared by the DSH Host and the React publisher panel. */
export const API = '/api/cqai-publisher'

/** Video platforms supported by the embedded MatrixMedia Worker. */
export const VIDEO_PLATFORMS = ['dy', 'sph', 'xhs', 'blbl', 'ks', 'tt', 'bjh', 'fqsp'] as const
export const PLATFORMS = [...VIDEO_PLATFORMS, 'juejin', 'wxmp'] as const
export type Platform = typeof PLATFORMS[number]
export type PublisherContentType = 'video' | 'article' | 'image-note'
export type PublisherMode = 'publish' | 'draft'

export const PLATFORM_LABELS: Record<Platform, string> = {
  dy: '抖音', sph: '视频号', xhs: '小红书', blbl: '哔哩哔哩',
  ks: '快手', tt: '头条', bjh: '百家号', fqsp: '番茄视频', juejin: '掘金', wxmp: '微信公众号',
}

export const MAX_TAGS = 8
export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 2000

export const CREATIVE_STATEMENTS = [
  'none', 'ai_generated', 'fiction', 'marketing', 'personal_opinion', 'repost', 'self_made_no_repost',
] as const
export type CreativeStatement = typeof CREATIVE_STATEMENTS[number]

/** Article layout selection; old manifests without a selection use the classic layout. */
export const ARTICLE_THEMES = ['classic', 'editorial', 'orangeheart', 'lapis', 'purple'] as const
export type ArticleTheme = typeof ARTICLE_THEMES[number]
export const ARTICLE_THEME_LABELS: Record<ArticleTheme, string> = {
  classic: '基础排版',
  editorial: '清新杂志',
  orangeheart: '文颜灵感 · 橙心',
  lapis: '文颜灵感 · 青金石',
  purple: '文颜灵感 · 紫韵',
}

/** Public account snapshot. Cookie values and session partition names never cross this API. */
export interface PublisherAccount {
  id: string
  displayName: string
  platform: Platform
  loginState: 'logged-in' | 'logged-out' | 'unknown'
  /** Sanitized Worker diagnostic from the last API credential check. */
  loginError?: string
  expiresAt?: number
}

/** Accepted submission details with the Worker's latest local execution state. */
export interface PublisherSubmission {
  id: string
  createdAt: string
  contentId: string
  contentType: PublisherContentType
  /** Retained for old video submissions and e剪宝 handoff lookup. */
  workId?: string
  title: string
  mode: PublisherMode
  /** Present when an article requested immediate publish but was changed to a reviewable platform draft. */
  requestedMode?: PublisherMode
  /** Target-specific edits made to the submitted copy; the local source remains unchanged. */
  adjustments?: Array<{ accountId: string; messages: string[] }>
  /** Absent only when connected to an older Worker. */
  state?: 'queued' | 'running' | 'unknown' | 'completed' | 'failed'
  /** A short local explanation when a result needs attention. */
  message?: string
  targets: Array<{
    accountId: string
    platform: Platform
    accountName: string
  }>
}

/** Result of opening one submission target in its own platform account session. */
export interface PublisherOpenTargetResult {
  kind: 'draft' | 'draft-list' | 'content-list' | 'backend' | 'review-window'
}

export interface PublisherPlatformCapability {
  platform: Platform
  contentTypes: PublisherContentType[]
  modes: Partial<Record<PublisherContentType, PublisherMode[]>>
  requiredFields: Partial<Record<PublisherContentType, string[]>>
  maxAssets?: Partial<Record<PublisherContentType, number>>
  maxTitleLength?: Partial<Record<PublisherContentType, number>>
  /** Present only when the active WeChat Worker supports themed article HTML. */
  articleThemeVersion?: number
}

export interface PublisherAsset {
  id: string
  name: string
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: number
  /** New uploads are bound to their original bytes; legacy manifests may omit it. */
  sha256?: string
}

/** Optional per-platform edits; an absent field follows the conversation's primary draft. */
export interface PublisherPlatformVariant {
  title?: string
  body?: string
  summary?: string
  tags?: string[]
  /** null explicitly clears an inherited primary-draft cover. */
  coverAssetId?: string | null
  /** Images selected for this platform, in order; omitted means all primary images. */
  assetOrder?: string[]
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
  /** Article-only layout. Missing in old drafts, which use the classic layout. */
  articleTheme?: ArticleTheme
  /** Video-only fields; article and image-note continue to use body/summary. */
  description?: string
  shortTitle?: string
  videoSource?: PublisherVideoSource
  tags: string[]
  creativeStatement: CreativeStatement
  assets: PublisherAsset[]
  coverAssetId?: string
  platformFields: Partial<Record<Platform, Record<string, string>>>
  platformVariants?: Partial<Record<Platform, PublisherPlatformVariant>>
}

export function resolveArticleTheme(content: Pick<PublisherContent, 'articleTheme'>): ArticleTheme {
  return content.articleTheme ?? 'classic'
}

/** Return the content that a selected platform will receive without changing the stored draft. */
export function projectContentForPlatform(content: PublisherContent, platform: Platform): PublisherContent {
  const variant = content.platformVariants?.[platform]
  const byId = new Map(content.assets.map(asset => [asset.id, asset]))
  return {
    ...content,
    title: variant?.title ?? content.title,
    body: variant?.body ?? content.body,
    summary: variant?.summary ?? content.summary,
    tags: [...(variant?.tags ?? content.tags)],
    coverAssetId: variant?.coverAssetId === null ? undefined : variant?.coverAssetId ?? content.coverAssetId,
    assets: variant?.assetOrder
      ? variant.assetOrder.map(assetId => byId.get(assetId)!).filter(Boolean)
      : [...content.assets],
  }
}

/** The single article or image-note draft associated with one Agent conversation. */
export interface PublisherSessionContent {
  sessionId: string
  contentId: string | null
  revision: number | null
  content: PublisherContent | null
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
