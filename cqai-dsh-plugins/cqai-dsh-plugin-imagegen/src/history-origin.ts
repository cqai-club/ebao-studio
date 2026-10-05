/** Durable source classification shared by the Host and every workspace. */
export type HistoryScope = 'normal' | 'ecommerce' | 'canvas'
export type GenerationOrigin = HistoryScope | 'unknown'

/** Accept unknown metadata too, so malformed legacy rows are kept safely. */
export interface GenerationOriginMetadata {
  canvas?: unknown
  workflow?: unknown
  projectId?: unknown
  projectName?: unknown
  slotKey?: unknown
  slotLabel?: unknown
}

export function isHistoryScope(value: unknown): value is HistoryScope {
  return value === 'normal' || value === 'ecommerce' || value === 'canvas'
}

export function generationOrigin(value: GenerationOriginMetadata): GenerationOrigin {
  const hasCanvas = value.canvas !== undefined
  const ecommerceFields = [value.projectId, value.projectName, value.slotKey, value.slotLabel]
  const hasEcommerce = value.workflow === 'ecommerce' || ecommerceFields.some(field => field !== undefined)
  if (value.workflow !== undefined && value.workflow !== 'ecommerce') return 'unknown'
  if (hasCanvas && hasEcommerce) return 'unknown'
  if (hasCanvas) {
    if (value.canvas === null || typeof value.canvas !== 'object') return 'unknown'
    const canvasId = (value.canvas as { canvasId?: unknown }).canvasId
    return typeof canvasId === 'string' && canvasId.trim() !== '' ? 'canvas' : 'unknown'
  }
  if (hasEcommerce) {
    if (ecommerceFields.some(field => field !== undefined && (typeof field !== 'string' || field.trim() === ''))) return 'unknown'
    return 'ecommerce'
  }
  return 'normal'
}

export class HistoryScopeMismatchError extends Error {
  readonly code = 'history-scope-mismatch'
  constructor() { super('该记录不属于当前生成历史来源'); this.name = 'HistoryScopeMismatchError' }
}
