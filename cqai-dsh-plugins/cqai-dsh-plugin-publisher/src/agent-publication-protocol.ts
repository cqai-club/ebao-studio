/** Browser-safe contract for an Agent's user-confirmed publication request. */
import type {
  Platform, PublisherAccount, PublisherContent, PublisherMode,
  PublisherPlatformCapability, PublisherSubmission,
} from './protocol.ts'

export type AgentPublicationState =
  | 'awaiting-confirmation' | 'submitting' | 'submitted' | 'uncertain' | 'cancelled' | 'stale'

export interface AgentPublicationRequest {
  requestId: string
  sessionId: string
  callId: string
  createdAt: string
  updatedAt: string
  state: AgentPublicationState
  /** The exact local draft shown for confirmation, including platform variants. */
  content: PublisherContent
  accounts: PublisherAccount[]
  capabilities: PublisherPlatformCapability[]
  requestedPlatforms: Platform[]
  accountIds: string[]
  mode: PublisherMode
  warnings: string[]
  errors: string[]
  /** Acceptance and execution status, not proof of platform approval. */
  submission?: PublisherSubmission
  message?: string
}

export interface PrepareAgentPublicationOptions {
  contentId?: string
  expectedRevision?: number
  bindingToken?: string
  candidateId?: string
  platforms?: Platform[]
  accountIds?: string[]
  mode?: PublisherMode
}

export interface ConfirmAgentPublicationChoices {
  accountIds: string[]
  mode: PublisherMode
}
