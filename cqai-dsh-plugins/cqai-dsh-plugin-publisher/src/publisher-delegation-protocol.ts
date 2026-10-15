/** Durable Publisher task links; the publishing conversation remains an ordinary owned Session. */
export type PublisherDelegationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'

export interface PublisherDelegation {
  taskId: string
  handoffId: string
  sourceSessionId: string
  requestId: string
  contentId: string
  publisherSessionId: string
  status: PublisherDelegationStatus
  createdAt: string
  updatedAt: string
  summary?: string
  error?: string
}

/** Trusted Host provenance, distinct from a human message or arbitrary injected context. */
export interface PublisherDelegationSource {
  kind: 'publisher-delegation'
  taskId: string
  sourceSessionId: string
  requestId: string
  contentId: string
}
