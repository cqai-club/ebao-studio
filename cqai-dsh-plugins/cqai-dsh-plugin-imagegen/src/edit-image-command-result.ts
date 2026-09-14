/** Durable wire text used by `/edit_image` command results and their Client renderer. */

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

const RESULT_MARKER = '@@cqai-dsh-imagegen/edit-command-result:v1@@'

/** Structured, versioned payload embedded after the human-readable command outcome. */
export interface EditImageCommandResult {
  readonly version: 1
  readonly taskId: string
  readonly images: readonly ImageAttachmentRef[]
  readonly summary: string
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return value === 'image/png'
    || value === 'image/jpeg'
    || value === 'image/webp'
    || value === 'image/gif'
}

function imageReference(value: unknown): ImageAttachmentRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.attachmentId !== 'string' || raw.attachmentId === ''
    || !isImageMediaType(raw.mediaType)
    || !Number.isSafeInteger(raw.bytes) || (raw.bytes as number) < 1
    || !Number.isSafeInteger(raw.width) || (raw.width as number) < 1
    || !Number.isSafeInteger(raw.height) || (raw.height as number) < 1
    || (raw.name !== undefined && typeof raw.name !== 'string')) return undefined
  return {
    attachmentId: raw.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: raw.mediaType,
    bytes: raw.bytes as number,
    width: raw.width as number,
    height: raw.height as number,
    ...raw.name === undefined ? {} : { name: raw.name },
  }
}

/** Encode durable attachment references without turning them into model-visible content. */
export function serializeEditImageCommandResult(
  taskId: string,
  images: readonly ImageAttachmentRef[],
  summary = '图片编辑已完成。',
): string {
  const payload: EditImageCommandResult = { version: 1, taskId, images, summary }
  return `${summary}\n${RESULT_MARKER}${JSON.stringify(payload)}`
}

/** Decode only this plugin's exact, validated result envelope. */
export function parseEditImageCommandResult(text: string | undefined): EditImageCommandResult | undefined {
  if (text === undefined) return undefined
  const marker = text.indexOf(RESULT_MARKER)
  if (marker < 0) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(marker + RESULT_MARKER.length))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || typeof raw.taskId !== 'string' || raw.taskId === ''
    || typeof raw.summary !== 'string' || raw.summary.trim() === ''
    || !Array.isArray(raw.images) || raw.images.length === 0) return undefined
  const images = raw.images.map(imageReference)
  if (images.some(image => image === undefined)) return undefined
  return {
    version: 1,
    taskId: raw.taskId,
    summary: raw.summary,
    images: images as ImageAttachmentRef[],
  }
}
