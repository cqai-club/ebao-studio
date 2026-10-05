import type { EcommerceRefRole, GenerateRequest, HistoryImageRef, ProductSetDraft } from './protocol.ts'

/** One host-owned product-set run, independent of any browser selection. */
export const ECOMMERCE_API = {
  submit: '/api/dsh-imagegen/ecommerce/submit',
  list: '/api/dsh-imagegen/ecommerce/list',
  get: '/api/dsh-imagegen/ecommerce/get',
  remove: '/api/dsh-imagegen/ecommerce/remove',
  clear: '/api/dsh-imagegen/ecommerce/clear',
  cancel: '/api/dsh-imagegen/ecommerce/cancel',
  retry: '/api/dsh-imagegen/ecommerce/retry',
  asset: '/api/dsh-imagegen/ecommerce/asset',
} as const

export type EcommerceRunStatus = 'queued' | 'running' | 'completed' | 'partial-failed' | 'failed' | 'cancelled' | 'interrupted'
export type EcommerceSlotStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface EcommerceRunSubmit {
  /** A single click's idempotency key, never reused for a new generation. */
  requestId: string
  draft: ProductSetDraft
  providerId: string
  model: string
  quality: string
  detail: string
  assets: Array<{ id: string; name: string; role: Exclude<EcommerceRefRole, 'none'>; dataUrl: string }>
  /** Complete per-image plan. slotKey values are unique (main-1, scene-1…). */
  requests: GenerateRequest[]
}

export interface EcommerceRunConfig {
  draft: ProductSetDraft
  providerId: string
  model: string
  quality: string
  detail: string
  assets: Array<{ id: string; name: string; role: Exclude<EcommerceRefRole, 'none'>; url: string }>
}

export interface EcommerceRunSlot {
  key: string
  label: string
  status: EcommerceSlotStatus
  attempt: number
  taskId?: string
  /** Saved plan, with host asset URLs in reference fields, never image bytes. */
  request: GenerateRequest
  images: HistoryImageRef[]
  error?: string
  /** Original plan has never been submitted because its main anchor failed. */
  blockedByMain?: boolean
  /** Prior attempts retain their exact resolved plan, references and results. */
  attempts?: EcommerceRunAttempt[]
}

export interface EcommerceRunAttempt {
  number: number
  status: EcommerceSlotStatus
  taskId?: string
  startedAt?: number
  finishedAt?: number
  /** Exact request, including the generated main anchor, as host asset URLs. */
  request: GenerateRequest
  images: HistoryImageRef[]
  error?: string
}

export interface EcommerceRun {
  id: string
  createdAt: number
  updatedAt: number
  status: EcommerceRunStatus
  /** Old history has no recoverable draft/reference configuration. */
  config?: EcommerceRunConfig
  slots: EcommerceRunSlot[]
  legacy?: boolean
}

export interface EcommerceRunSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  status: EcommerceRunStatus
  done: number
  total: number
  model: string
  size: string
  thumbnail?: HistoryImageRef
  searchText?: string
  legacy?: boolean
}
