import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ImageGenConversationBridge } from './dsh-integration.tsx'

/** Document event used to bridge chat tool results into the image workspace. */
export const CHAT_IMAGE_EVENT = 'dsh-imagegen:chat-images'

export interface ChatImageEventDetail {
  sessionId: SessionId
  refs: readonly ImageAttachmentRef[]
}

/** Official session-maybe composer bridge supplied by dsh-integration. */
export type ConversationService = ImageGenConversationBridge
