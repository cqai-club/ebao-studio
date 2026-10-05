/** Read existing e图宝 results through its same-origin API; never starts generation. */
import { generationOrigin, type GenerationOrigin, type HistoryScope } from '../../../cqai-dsh-plugin-imagegen/src/history-origin.ts'

export type ImagegenSource = GenerationOrigin | 'gallery'
export type ImagegenScope = HistoryScope | 'gallery' | 'all'

export interface ImagegenImage {
  id: string
  url: string
  name: string
  prompt: string
  createdAt: number
  source: ImagegenSource
  label: string
  sha256?: string
  searchText?: string
}

const BASE = '/api/dsh-imagegen'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const LABELS: Record<ImagegenSource, string> = {
  normal: '普通生成', canvas: '画布生成', ecommerce: '商品套图', gallery: '图库收藏',
  unknown: '生成历史',
}
const HISTORY_FILE = '[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\\.(?:png|jpg|jpeg|webp|gif)'
const RUN_ID = '(?:[a-f0-9-]{36}|legacy-[a-f0-9]{32})'
const RUN_FILE = '[a-f0-9]{64}\\.(?:png|jpg|webp|gif|bmp)'
const CANVAS_FILE = '[a-f0-9]{64}\\.(?:png|jpg|jpeg|webp|gif|bmp|tiff|tif)'
const NOT_READY = 'e图宝图片服务暂未就绪，请稍候或重启应用'
const INVALID_RECORD = 'e图宝生成记录格式无效，请刷新后重试'
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('请求已取消', 'AbortError')
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (object(error) && error.name === 'AbortError')
}

function validSource(source: unknown): source is ImagegenSource {
  return typeof source === 'string' && Object.hasOwn(LABELS, source)
}

function safeImageUrl(url: unknown, source: ImagegenSource): url is string {
  if (typeof url !== 'string' || /[\s%?#\\]/u.test(url)) return false
  const history = `history/image/${HISTORY_FILE}`
  const suffix = source === 'ecommerce'
    ? `(?:ecommerce/asset/${RUN_ID}/${RUN_FILE}|${history})`
    : source === 'canvas' ? `(?:canvas/asset/${CANVAS_FILE}|${history})`
      : source === 'gallery' ? `gallery/image/${HISTORY_FILE}` : history
  return new RegExp(`^${BASE}/${suffix}$`).test(url)
}

function checkResponseLocation(response: Response, requested: string): void {
  if (response.redirected) throw new Error('e图宝图片接口发生跳转，请刷新后重试')
  if (response.url && typeof location !== 'undefined'
    && response.url !== new URL(requested, location.href).href) {
    throw new Error('e图宝图片接口地址不一致，请刷新后重试')
  }
}

async function jsonRequest(path: string, body: unknown | undefined, signal?: AbortSignal): Promise<Record<string, unknown>> {
  checkAborted(signal)
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', redirect: 'error', signal,
      ...(body === undefined ? {} : {
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
  } catch (error) {
    if (isAbort(error, signal)) throw error
    throw new Error('无法读取 e图宝生成记录，请稍后重试')
  }
  checkAborted(signal)
  checkResponseLocation(response, path)
  if (response.status === 404 || response.status === 503
    || !response.headers.get('content-type')?.includes('application/json')) throw new Error(NOT_READY)
  let result: unknown
  try { result = await response.json() } catch (error) {
    if (isAbort(error, signal)) throw error
    throw new Error(INVALID_RECORD)
  }
  checkAborted(signal)
  if (!object(result)) throw new Error(INVALID_RECORD)
  if (!response.ok || result.ok !== true) {
    throw new Error(typeof result.message === 'string' && result.message.trim()
      ? result.message : '读取 e图宝生成记录失败，请稍后重试')
  }
  return result
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(item => !object(item))) throw new Error(INVALID_RECORD)
  return value as Record<string, unknown>[]
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(INVALID_RECORD)
  return value
}

function requiredId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(INVALID_RECORD)
  return value
}

function promptOf(value: unknown): string {
  if (typeof value !== 'string') throw new Error(INVALID_RECORD)
  return value
}

function displayName(value: string, fallback: string): string {
  return value.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 60) || fallback
}

function imageHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : undefined
}

function assetHash(url: string): string | undefined {
  return url.match(/^\/api\/dsh-imagegen\/(?:canvas\/asset|ecommerce\/asset\/[^/]+)\/([a-f0-9]{64})\./u)?.[1]
}

function representativePriority(image: ImagegenImage): number {
  if (image.url.startsWith(`${BASE}/ecommerce/asset/`)) return 0
  if (image.url.startsWith(`${BASE}/history/image/`)) return 1
  if (image.url.startsWith(`${BASE}/canvas/asset/`)) return 2
  return 3
}

function uniqueImages(images: ImagegenImage[]): ImagegenImage[] {
  const merge = (existing: ImagegenImage, image: ImagegenImage): ImagegenImage => {
    const representative = representativePriority(image) < representativePriority(existing) ? image : existing
    const sha256 = imageHash(existing.sha256) ?? imageHash(image.sha256)
    return { ...representative, ...sha256 === undefined ? {} : { sha256 }, createdAt: Math.max(existing.createdAt, image.createdAt),
      searchText: [...new Set([existing.searchText, existing.name, existing.prompt, image.searchText, image.name, image.prompt].filter(Boolean))].join('\n'),
    }
  }
  const urls = new Map<string, ImagegenImage>()
  for (const image of images.sort((left, right) => right.createdAt - left.createdAt)) {
    const existing = urls.get(image.url)
    urls.set(image.url, existing ? merge(existing, image) : image)
  }
  const groups = new Map<string, ImagegenImage>()
  for (const image of urls.values()) {
    const hash = imageHash(image.sha256) ?? assetHash(image.url)
    const identity = hash === undefined ? image.url : `sha256:${hash}`
    const existing = groups.get(identity)
    if (!existing) { groups.set(identity, image); continue }
    groups.set(identity, merge(existing, image))
  }
  return [...groups.values()].sort((left, right) => right.createdAt - left.createdAt)
}

function imagesFromEntry(entry: Record<string, unknown>, source: ImagegenSource): ImagegenImage[] {
  const id = requiredId(entry.id)
  const createdAt = timestamp(entry.createdAt)
  const prompt = promptOf(entry.prompt)
  return records(entry.images).map((image, index) => {
    if (!safeImageUrl(image.url, source)) throw new Error('e图宝图片地址无效，已停止读取')
    return {
      id: `${source}:${id}:${index}`, url: image.url,
      name: `${displayName(prompt, LABELS[source])}-${index + 1}`,
      prompt, createdAt, source, label: LABELS[source],
      ...imageHash(image.sha256) === undefined ? {} : { sha256: imageHash(image.sha256) },
    }
  })
}

async function historyImages(scope: HistoryScope | undefined, signal?: AbortSignal): Promise<ImagegenImage[]> {
  const result = await jsonRequest(`${BASE}/history/list`, { includeImageHashes: true, ...scope === undefined ? {} : { scope } }, signal)
  return records(result.entries).flatMap(entry => imagesFromEntry(entry, scope ?? generationOrigin(entry)))
}

async function galleryImages(signal?: AbortSignal): Promise<ImagegenImage[]> {
  return records((await jsonRequest(`${BASE}/gallery/list`, { includeImageHashes: true }, signal)).entries)
    .flatMap(entry => imagesFromEntry(entry, 'gallery'))
}

async function canvasImages(signal?: AbortSignal): Promise<ImagegenImage[]> {
  const projects = records((await jsonRequest(`${BASE}/canvas/list`, {}, signal)).projects)
  const groups: ImagegenImage[][] = Array.from({ length: projects.length }, () => [])
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      checkAborted(signal)
      const index = next++
      if (index >= projects.length) return
      const id = requiredId(projects[index]!.id)
      const result = await jsonRequest(`${BASE}/canvas/read`, { id }, signal)
      const document = result.document
      if (!object(document) || document.id !== id) throw new Error(INVALID_RECORD)
      const updatedAt = timestamp(document.updatedAt)
      const title = displayName(typeof document.title === 'string' ? document.title : '', LABELS.canvas)
      groups[index] = records(document.nodes).flatMap(node => {
        if (node.type !== 'image' && node.type !== 'file') return []
        const metadata = node.metadata
        if (!object(metadata) || !object(metadata.asset)) return []
        const asset = metadata.asset
        // Imported/uploaded references are inputs, and generated non-image files are not pictures.
        if (asset.origin !== 'generated' || typeof asset.mime !== 'string'
          || !/^image\/(?:png|jpeg|webp|gif|bmp|tiff)(?:;|$)/iu.test(asset.mime)) return []
        if (!safeImageUrl(asset.url, 'canvas') || !asset.url.startsWith(`${BASE}/canvas/asset/`)) {
          throw new Error('e图宝图片地址无效，已停止读取')
        }
        const nodeId = requiredId(node.id)
        const name = displayName(typeof asset.name === 'string' ? asset.name
          : typeof node.title === 'string' ? node.title : '', title)
        const prompt = typeof metadata.prompt === 'string' ? metadata.prompt : name
        const createdAt = object(metadata.skill) && metadata.skill.createdAt !== undefined
          ? timestamp(metadata.skill.createdAt) : updatedAt
        return [{ id: `canvas:${id}:${nodeId}`, url: asset.url, name, prompt, createdAt,
          source: 'canvas' as const, label: LABELS.canvas }]
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, projects.length) }, worker))
  return groups.flat()
}

async function ecommerceImages(signal?: AbortSignal): Promise<ImagegenImage[]> {
  const summaries = records((await jsonRequest(`${BASE}/ecommerce/list`, undefined, signal)).runs)
  const groups: ImagegenImage[][] = Array.from({ length: summaries.length }, () => [])
  let next = 0
  // A bounded number of reads preserves the list order without flooding the Host.
  const worker = async (): Promise<void> => {
    for (;;) {
      checkAborted(signal)
      const index = next++
      if (index >= summaries.length) return
      const summary = summaries[index]!
      const id = requiredId(summary.id)
      if (!new RegExp(`^${RUN_ID}$`).test(id)) throw new Error(INVALID_RECORD)
      const response = await jsonRequest(`${BASE}/ecommerce/get?id=${encodeURIComponent(id)}`, undefined, signal)
      const run = response.run
      if (!object(run) || run.id !== id) throw new Error(INVALID_RECORD)
      const createdAt = timestamp(run.createdAt)
      const product = displayName(typeof summary.name === 'string' ? summary.name : '', LABELS.ecommerce)
      groups[index] = records(run.slots).flatMap(slot => {
        const key = requiredId(slot.key)
        const request = slot.request
        if (!object(request)) throw new Error(INVALID_RECORD)
        const prompt = promptOf(request.prompt)
        const slotName = displayName(typeof slot.label === 'string' ? slot.label : '', '图片')
        // Only output images are selectable. run.config.assets and request refs are inputs.
        const outputs = (value: unknown, attemptPrompt: string, at: number, attempt?: number): ImagegenImage[] => records(value).map((image, imageIndex) => {
          if (!safeImageUrl(image.url, 'ecommerce') || !image.url.startsWith(`${BASE}/ecommerce/asset/${id}/`)) {
            throw new Error('e图宝图片地址无效，已停止读取')
          }
          return {
            id: `ecommerce:${id}:${key}:${attempt === undefined ? '' : `attempt-${attempt}:`}${imageIndex}`, url: image.url,
            name: `${product}-${slotName}${attempt === undefined ? '' : `-第${attempt}次`}-${imageIndex + 1}`,
            prompt: attemptPrompt, createdAt: at,
            source: 'ecommerce' as const, label: LABELS.ecommerce,
          }
        })
        return [
          ...outputs(slot.images, prompt, createdAt),
          ...records(slot.attempts ?? []).flatMap(attempt => {
            if (!object(attempt.request) || !Number.isSafeInteger(attempt.number) || Number(attempt.number) < 1) throw new Error(INVALID_RECORD)
            return outputs(attempt.images, promptOf(attempt.request.prompt),
              timestamp(attempt.finishedAt ?? attempt.startedAt ?? createdAt), Number(attempt.number))
          }),
        ]
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, summaries.length) }, worker))
  return groups.flat()
}

export async function listImagegenImages(scope: ImagegenScope, signal?: AbortSignal): Promise<ImagegenImage[]> {
  if (!['all', 'normal', 'canvas', 'ecommerce', 'gallery'].includes(scope)) throw new Error('图片来源无效')
  checkAborted(signal)
  const labelled = async (label: string, read: () => Promise<ImagegenImage[]>): Promise<ImagegenImage[]> => {
    try { return await read() } catch (error) {
      if (isAbort(error, signal)) throw error
      throw new Error(`${label}读取失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    }
  }
  const images = scope === 'all'
    ? (await Promise.all([
      labelled('生成历史', () => historyImages(undefined, signal)),
      labelled(LABELS.canvas, () => canvasImages(signal)),
      labelled(LABELS.ecommerce, () => ecommerceImages(signal)),
      labelled(LABELS.gallery, () => galleryImages(signal)),
    ])).flat()
    : scope === 'ecommerce' ? await ecommerceImages(signal)
      : scope === 'gallery' ? await galleryImages(signal)
        : scope === 'canvas' ? (await Promise.all([
          historyImages('canvas', signal), canvasImages(signal),
        ])).flat() : await historyImages('normal', signal)
  checkAborted(signal)
  return uniqueImages(images)
}

export async function readImagegenFile(image: ImagegenImage, signal?: AbortSignal): Promise<File> {
  if (!validSource(image.source) || !safeImageUrl(image.url, image.source)) throw new Error('e图宝图片地址无效，已停止读取')
  checkAborted(signal)
  let response: Response
  try {
    response = await fetch(image.url, { credentials: 'same-origin', redirect: 'error', signal })
  } catch (error) {
    if (isAbort(error, signal)) throw error
    throw new Error('读取 e图宝图片失败，请刷新后重试')
  }
  checkAborted(signal)
  checkResponseLocation(response, image.url)
  if (response.status === 404 || response.status === 503) throw new Error('这张 e图宝图片已删除或暂时无法读取，请刷新记录')
  if (!response.ok) throw new Error('读取 e图宝图片失败，请刷新后重试')
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const extension = IMAGE_TYPES[mime]
  if (!extension) throw new Error('仅支持导入 JPEG、PNG 或 WebP 图片')
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 20MB')
  let blob: Blob
  try { blob = await response.blob() } catch (error) {
    if (isAbort(error, signal)) throw error
    throw new Error('读取 e图宝图片失败，请刷新后重试')
  }
  checkAborted(signal)
  if (blob.size === 0) throw new Error('e图宝图片为空，请刷新记录')
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 20MB')
  const name = displayName(image.name, LABELS[image.source]).replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_')
    .replace(/\.(?:png|jpe?g|webp|gif|bmp)$/iu, '')
  return new File([blob], `${name || 'e图宝图片'}.${extension}`, { type: mime })
}
