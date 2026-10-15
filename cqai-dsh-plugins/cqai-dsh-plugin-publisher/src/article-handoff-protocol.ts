import type { Platform, PublisherContent } from './protocol.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export interface PublisherArticleHandoffSource {
  kind: 'markdown' | 'assistant-message' | 'creation-brief'
  sessionId: string
  sourceId: string
  revision: string
  messageId?: string
  fileName?: string
  requestId?: string
}

/** Public transfer metadata. Disk paths and complete source documents remain Host-only. */
export interface PublisherArticleHandoff {
  handoffId: string
  title: string
  excerpt: string
  platforms: Platform[]
  instructions?: string
  /** A reviewed creative task, carried separately from the article's prose. */
  creationBrief?: string
  contentType?: 'article' | 'image-note'
  source: PublisherArticleHandoffSource
  contentId?: string
  sourceChanged: boolean
  sourceAvailable: boolean
  /** True only after the changed source has been prepared and reviewed again. */
  updateReady?: boolean
  delegation?: import('./publisher-delegation-protocol.ts').PublisherDelegation
}

export interface PreparePublisherArticleHandoff {
  sessionId: string
  markdownPath?: string
  messageId?: string
  creationBrief?: string
  requestId?: string
  contentType?: 'article' | 'image-note'
  title?: string
  platforms?: Platform[]
  instructions?: string
  /** Host-only fallback; existing requirements and the genuine source request take priority. */
  defaultInstructions?: string
  /** Host-verified images from this exact genuine user request; never tool arguments. */
  sourceImages?: readonly { ref: ImageAttachmentRef; data: Uint8Array }[]
}

export interface PublisherArticleHandoffResult {
  handoff: PublisherArticleHandoff
  content: PublisherContent
  sourceChanged: boolean
}
