import type { CanvasDocument, GenerateRequest, HistoryEntry, HistoryImageRef } from '../protocol.ts'
import type { EcommerceRun, EcommerceRunSummary } from '../ecommerce-run-protocol.ts'
import { generationOrigin } from '../history-origin.ts'
import type { ImageGenApi } from './api.ts'

export interface GenerationOverviewEntry extends HistoryEntry {
  overview?: { kind: 'ecommerce'; runId: string } | { kind: 'canvas'; canvasId: string } | { kind: 'gallery' }
}

type OverviewApi = Pick<ImageGenApi, 'ecommerceList' | 'ecommerceGet' | 'canvasList' | 'canvasRead' | 'galleryList'>
const BASE = '/api/dsh-imagegen'
const HASH = /^[a-f0-9]{64}$/u
const RUN_ID = /^(?:[a-f0-9-]{36}|legacy-[a-f0-9]{32})$/u
const HISTORY_FILE = /^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(?:png|jpg|jpeg|webp|gif)$/u
const CANVAS_FILE = /^[a-f0-9]{64}\.(?:png|jpg|jpeg|webp|gif|bmp|tiff|tif)$/u
const UPLOADED_MODELS = new Set(['uploaded', '本地上传', 'local upload', 'локальный файл'])
const INVALID = '生成记录格式无效，请刷新后重试'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function records<T>(value: T[]): T[] {
  if (!Array.isArray(value) || value.some(item => !record(item))) throw new Error(INVALID)
  return value
}

function id(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(INVALID)
  return value
}

function timestamp(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(INVALID)
  return value
}

function imageHash(image: HistoryImageRef): string | undefined {
  const canonical = image.url.match(/^\/api\/dsh-imagegen\/(?:canvas\/asset|ecommerce\/asset\/(?:[a-f0-9-]{36}|legacy-[a-f0-9]{32}))\/([a-f0-9]{64})\.(?:png|jpg|jpeg|webp|gif|bmp|tiff|tif)$/u)?.[1]
  return canonical ?? (typeof image.sha256 === 'string' && HASH.test(image.sha256) ? image.sha256 : undefined)
}

function imageRef(image: HistoryImageRef, source: 'ecommerce' | 'canvas' | 'gallery', runId?: string): HistoryImageRef {
  if (!record(image) || typeof image.url !== 'string' || typeof image.mime !== 'string'
    || !/^image\/(?:png|jpeg|webp|gif|bmp|tiff)(?:;|$)/iu.test(image.mime)) throw new Error(INVALID)
  const prefix = source === 'ecommerce' ? `${BASE}/ecommerce/asset/${runId}/`
    : source === 'canvas' ? `${BASE}/canvas/asset/` : `${BASE}/gallery/image/`
  const file = image.url.startsWith(prefix) ? image.url.slice(prefix.length) : ''
  if (!(source === 'gallery' ? HISTORY_FILE : CANVAS_FILE).test(file)) {
    throw new Error('生成图片地址无效，已停止读取')
  }
  const sha256 = imageHash(image)
  return { ...image, ...sha256 === undefined ? {} : { sha256 } }
}

function fromRequest(request: GenerateRequest, images: HistoryImageRef[]): Omit<HistoryEntry, 'id' | 'createdAt'> {
  if (!record(request) || !['text', 'edit'].includes(request.mode)
    || [request.model, request.prompt, request.size, request.quality, request.detail].some(value => typeof value !== 'string')) {
    throw new Error(INVALID)
  }
  return {
    mode: request.mode, model: request.model, prompt: request.prompt, size: request.size,
    quality: request.quality, detail: request.detail, n: images.length, images,
    ...request.refName === undefined ? {} : { refName: request.refName },
    ...request.channelId === undefined ? {} : { channelId: request.channelId },
    ...request.channel === undefined ? {} : { channel: request.channel },
    ...request.comparisonId === undefined ? {} : { comparisonId: request.comparisonId },
    ...request.comparisonModels === undefined ? {} : { comparisonModels: request.comparisonModels },
  }
}

function ecommerceEntries(run: EcommerceRun, summary: EcommerceRunSummary): GenerationOverviewEntry[] {
  if (!record(run) || run.id !== summary.id || !RUN_ID.test(run.id)) throw new Error(INVALID)
  const createdAt = timestamp(run.createdAt)
  return records(run.slots).flatMap(slot => {
    const key = id(slot.key)
    const outputs = (images: HistoryImageRef[], request: GenerateRequest, at: number, suffix: string): GenerationOverviewEntry[] => {
      const refs = records(images).map(image => imageRef(image, 'ecommerce', run.id))
      if (!refs.length) return []
      return [{ ...fromRequest(request, refs), id: `overview:ecommerce:${run.id}:${key}:${suffix}`, createdAt: timestamp(at),
        workflow: 'ecommerce', projectId: run.legacy ? request.projectId ?? run.id : run.id, projectName: request.projectName || summary.name,
        slotKey: key, slotLabel: slot.label, overview: { kind: 'ecommerce', runId: run.id } }]
    }
    // A retry may retain the previous successful slot images. They are outputs,
    // even when the latest slot state is queued or failed; config assets are inputs.
    const attempts = records(slot.attempts ?? []).flatMap(attempt => {
      if (attempt.status !== 'completed') return []
      if (!Number.isSafeInteger(attempt.number) || attempt.number < 1) throw new Error(INVALID)
      return outputs(attempt.images, attempt.request, attempt.finishedAt ?? attempt.startedAt ?? createdAt, `attempt-${attempt.number}`)
    })
    return [...attempts, ...outputs(slot.images, slot.request, createdAt, 'current')]
  })
}

function canvasEntries(document: CanvasDocument, canvasId: string): GenerationOverviewEntry[] {
  if (!record(document) || document.id !== canvasId) throw new Error(INVALID)
  const updatedAt = timestamp(document.updatedAt)
  const nodes = records(document.nodes)
  return nodes.flatMap(node => {
    const metadata = node.metadata
    const asset = metadata?.asset
    if (!['image', 'file'].includes(node.type) || asset?.origin !== 'generated'
      || typeof asset.mime !== 'string' || !/^image\/(?:png|jpeg|webp|gif|bmp|tiff)(?:;|$)/iu.test(asset.mime)) return []
    const image = imageRef({ url: asset.url, mime: asset.mime }, 'canvas')
    const peer = metadata?.taskId === undefined ? undefined
      : nodes.find(candidate => candidate.id !== node.id && candidate.metadata?.taskId === metadata.taskId && candidate.metadata?.prompt !== undefined)
    const parent = nodes.find(candidate => candidate.id === metadata?.sourceNodeId)
    const settings = (field: 'prompt' | 'model' | 'size' | 'quality'): string | undefined => {
      const value = metadata?.[field] ?? peer?.metadata?.[field] ?? parent?.metadata?.[field]
      if (value !== undefined && typeof value !== 'string') throw new Error(INVALID)
      return value
    }
    return [{ id: `overview:canvas:${canvasId}:${id(node.id)}`, createdAt: timestamp(metadata?.skill?.createdAt ?? updatedAt),
      mode: metadata?.annotationEdit === undefined ? 'text' : 'edit', model: settings('model') || metadata?.skill?.label || '画布生成',
      prompt: settings('prompt') ?? asset.name ?? node.title ?? document.title,
      size: settings('size') || 'auto', quality: settings('quality') || 'auto', detail: '', n: 1, images: [image],
      canvas: { canvasId, parentNodeId: node.id }, overview: { kind: 'canvas', canvasId } }]
  })
}

function galleryEntries(entries: HistoryEntry[]): GenerationOverviewEntry[] {
  return records(entries).flatMap(entry => {
    if (typeof entry.model !== 'string') throw new Error(INVALID)
    // The current uploader persisted its translated model label, older clients
    // used "uploaded". Neither represents a saved generation.
    if (UPLOADED_MODELS.has(entry.model.trim().toLowerCase())) return []
    const images = records(entry.images).map(image => imageRef(image, 'gallery'))
    if (!images.length) return []
    return [{ ...entry, id: `overview:gallery:${id(entry.id)}`, createdAt: timestamp(entry.createdAt),
      n: images.length, images, overview: { kind: 'gallery' } }]
  })
}

/** Read durable output stores only, with at most three API requests in flight. */
export async function listAdditionalGenerationHistory(api: OverviewApi): Promise<GenerationOverviewEntry[]> {
  const labelled = async <T>(label: string, read: () => Promise<T>): Promise<T> => {
    try { return await read() }
    catch (error) { throw new Error(`${label}读取失败：${error instanceof Error ? error.message : INVALID}`) }
  }
  const [runs, projects, gallery] = await Promise.all([
    labelled('商品套图', () => api.ecommerceList()), labelled('画布', () => api.canvasList()), labelled('图库收藏', () => api.galleryList(true)),
  ])
  const jobs: Array<() => Promise<GenerationOverviewEntry[]>> = [
    ...records(runs).map(summary => async () => labelled('商品套图', async () => {
      const runId = id(summary.id)
      if (!RUN_ID.test(runId)) throw new Error(INVALID)
      return ecommerceEntries(await api.ecommerceGet(runId), summary)
    })),
    ...records(projects).map(summary => async () => labelled('画布', async () => {
      const canvasId = id(summary.id)
      return canvasEntries(await api.canvasRead(canvasId), canvasId)
    })),
  ]
  const groups: GenerationOverviewEntry[][] = Array.from({ length: jobs.length }, () => [])
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = next++
      if (index >= jobs.length) return
      try { groups[index] = await jobs[index]() }
      catch (error) { failed = true; throw error }
    }
  }
  const saved = galleryEntries(gallery)
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker))
  return [...groups.flat(), ...saved].sort((left, right) => right.createdAt - left.createdAt)
}

function identities(image: HistoryImageRef): string[] {
  const hash = imageHash(image)
  return [image.url, ...hash === undefined ? [] : [`sha256:${hash}`]]
}

/** Mutation responses omit opt-in hashes; retain them only for unchanged refs. */
export function preserveGenerationHistoryHashes(next: HistoryEntry[], previous: HistoryEntry[]): HistoryEntry[] {
  const previousEntries = new Map(previous.map(entry => [entry.id, entry]))
  return next.map(entry => {
    const before = previousEntries.get(entry.id)
    if (before === undefined) return entry
    let changed = false
    const images = entry.images.map(image => {
      if (image.sha256 !== undefined) return image
      const known = before.images.find(candidate => candidate.url === image.url && candidate.mime === image.mime
        && typeof candidate.sha256 === 'string' && HASH.test(candidate.sha256))
      if (known === undefined) return image
      changed = true
      return { ...image, sha256: known.sha256 }
    })
    return changed ? { ...entry, images } : entry
  })
}

function nativeMatch(entry: HistoryEntry, source: GenerationOverviewEntry): boolean {
  const overview = source.overview!
  return overview.kind === 'ecommerce' ? generationOrigin(entry) === 'ecommerce'
    && (entry.projectId === overview.runId || (overview.runId.startsWith('legacy-') && source.projectId !== undefined && entry.projectId === source.projectId))
    : overview.kind === 'canvas' && generationOrigin(entry) === 'canvas' && entry.canvas?.canvasId === overview.canvasId
}

/** Keep every original request; remove only redundant output-store copies. */
export function mergeGenerationOverview(shared: HistoryEntry[], additional: GenerationOverviewEntry[]): GenerationOverviewEntry[] {
  const merged: GenerationOverviewEntry[] = [...shared]
  const original = new Map<string, number[]>()
  const seen = new Set<string>()
  shared.forEach((entry, index) => entry.images.forEach(image => identities(image).forEach(key => {
    seen.add(key)
    original.set(key, [...original.get(key) ?? [], index])
  })))
  // Native stores remain actionable when a later gallery save has the same bytes.
  const priority = (entry: GenerationOverviewEntry): number => entry.overview?.kind === 'gallery' ? 1 : 0
  for (const entry of [...additional].sort((left, right) => priority(left) - priority(right) || right.createdAt - left.createdAt)) {
    const images = entry.images.filter(image => {
      const keys = identities(image)
      if (entry.overview !== undefined) {
        const matches = new Set(keys.flatMap(key => original.get(key) ?? []))
        for (const index of matches) if (nativeMatch(shared[index], entry)) {
          merged[index] = { ...merged[index], overview: entry.overview }
        }
      }
      if (keys.some(key => seen.has(key))) return false
      keys.forEach(key => seen.add(key))
      return true
    })
    if (images.length) merged.push({ ...entry, images, n: images.length })
  }
  return merged.sort((left, right) => right.createdAt - left.createdAt)
}
