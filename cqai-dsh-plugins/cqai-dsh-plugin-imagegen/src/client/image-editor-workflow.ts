/** Persist local edits or submit an editor's marked reference to the existing queue. */
import type { GenerateRequest, GeneratedImage, GenerationTask, HistoryEntry, HistoryEntryInput } from '../protocol.ts'
import type { ImageGenApi } from './api.ts'
import type { EditorApplyResult } from './image-editor/EditorModal.tsx'
import type { EditManifest } from './image-editor/manifest.ts'
import { canvasToDataUrl, loadRaster } from './image-ops.ts'

export interface ImageEditorSelection {
  model: string
  channelId?: string
  channel?: string
  size?: string
  quality?: string
  detail?: string
}

export interface ImageEditorWorkflowOptions {
  api: Pick<ImageGenApi, 'taskSubmit' | 'taskGet' | 'taskCancel' | 'galleryAppend'>
  selection?: ImageEditorSelection
  source?: Partial<HistoryEntry>
  signal?: AbortSignal
  pollIntervalMs?: number
  timeoutMs?: number
  onTask?: (task: GenerationTask) => void
}

export interface ImageEditorWorkflowResult {
  kind: 'local' | 'generated'
  image: GeneratedImage
  /** Present only when the gallery created a new entry; deduplication returns its list. */
  entry?: HistoryEntry
  gallery: HistoryEntry[]
  galleryAdded: boolean
  task?: GenerationTask
  history?: HistoryEntry[]
  historyError?: string
}

/** A completed edit can be saved again without another billed generation. */
export interface PreparedImageEditorResult {
  kind: ImageEditorWorkflowResult['kind']
  image: GeneratedImage
  galleryEntry: HistoryEntryInput
  task?: GenerationTask
  history?: HistoryEntry[]
  historyError?: string
}

export interface ImageEditorSaveOptions {
  api: Pick<ImageGenApi, 'galleryAppend'>
  signal?: AbortSignal
  timeoutMs?: number
}

/** Raster work is injectable so queue, error and preservation paths stay headless-testable. */
export interface ImageEditorWorkflowHelpers {
  readFile(file: File): Promise<string>
  buildBrushReference(reference: string, mask: string, markers?: EditManifest['markers']): Promise<string>
  compositeBrush(image: string, original: string, mask: string): Promise<string>
  resizeImage(image: string, width: number, height: number): Promise<string>
}

export class ImageEditorWorkflowError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'ImageEditorWorkflowError'
  }
}

export class ImageEditorGallerySaveError extends ImageEditorWorkflowError {
  constructor(error: unknown, readonly prepared: PreparedImageEditorResult) {
    const reason = error instanceof Error ? error.message : String(error)
    super(`保存新版图片失败：${reason}`, 'gallery-save-failed')
    this.name = 'ImageEditorGallerySaveError'
  }
}

/** The editor exports an opaque binary mask: white redraws, black preserves. */
export function brushMaskCoverage(mask: ArrayLike<number>, offset: number): number {
  return ((mask[offset] + mask[offset + 1] + mask[offset + 2]) / (3 * 255)) * (mask[offset + 3] / 255)
}

export function validateBrushMaskPixels(mask: Uint8ClampedArray, width: number, height: number, markers: EditManifest['markers'] = []): void {
  if (mask.length !== width * height * 4) throw new ImageEditorWorkflowError('涂抹范围的尺寸不一致。', 'mask-size-mismatch')
  let hasPaint = false
  for (let offset = 0; offset < mask.length; offset += 4) {
    if (brushMaskCoverage(mask, offset) > 0) { hasPaint = true; break }
  }
  if (!hasPaint) throw new ImageEditorWorkflowError('涂抹范围为空，请先涂抹需要修改的区域。', 'empty-brush-mask')
  for (const marker of markers) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(marker.x * width)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(marker.y * height)))
    if (!Number.isFinite(x) || !Number.isFinite(y) || brushMaskCoverage(mask, (y * width + x) * 4) === 0) {
      throw new ImageEditorWorkflowError(`标记 ${marker.id} 位于涂抹范围之外；请涂抹该位置或清除涂抹后按标记编辑。`, 'marker-outside-brush')
    }
  }
}

/** Keep every pixel outside the brush identical to the locally edited base. */
export function compositeBrushPixels(original: Uint8ClampedArray, generated: Uint8ClampedArray, mask: Uint8ClampedArray): Uint8ClampedArray {
  if (original.length !== generated.length || original.length !== mask.length || original.length % 4 !== 0) {
    throw new ImageEditorWorkflowError('图片与涂抹范围的尺寸不一致。', 'mask-size-mismatch')
  }
  const output = new Uint8ClampedArray(original)
  for (let offset = 0; offset < output.length; offset += 4) {
    const coverage = brushMaskCoverage(mask, offset)
    if (coverage === 0) continue
    for (let channel = 0; channel < 4; channel += 1) {
      output[offset + channel] = original[offset + channel] * (1 - coverage) + generated[offset + channel] * coverage
    }
  }
  return output
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const value = document.createElement('canvas')
  value.width = width
  value.height = height
  return value
}

function context(value: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = value.getContext('2d', { willReadFrequently: true })
  if (result === null) throw new ImageEditorWorkflowError('当前浏览器无法编辑图片像素。', 'canvas-unavailable')
  return result
}

function scaledPixels(value: HTMLCanvasElement, width: number, height: number): ImageData {
  const target = canvas(width, height)
  const ctx = context(target)
  ctx.drawImage(value, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

export const defaultImageEditorWorkflowHelpers: ImageEditorWorkflowHelpers = {
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new ImageEditorWorkflowError('无法读取编辑后的图片。', 'file-read-failed'))
      reader.readAsDataURL(file)
    })
  },
  async buildBrushReference(reference, maskUrl, markers = []) {
    const [base, mask] = await Promise.all([loadRaster(reference, 0), loadRaster(maskUrl, 0)])
    const ctx = context(base)
    const pixels = ctx.getImageData(0, 0, base.width, base.height)
    const coverage = scaledPixels(mask, base.width, base.height).data
    validateBrushMaskPixels(coverage, base.width, base.height, markers)
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const weight = brushMaskCoverage(coverage, offset) * 0.65
      if (weight === 0) continue
      pixels.data[offset] = pixels.data[offset] * (1 - weight) + 255 * weight
      pixels.data[offset + 1] *= 1 - weight
      pixels.data[offset + 2] *= 1 - weight
      pixels.data[offset + 3] = Math.max(pixels.data[offset + 3], Math.round(255 * weight))
    }
    ctx.putImageData(pixels, 0, 0)
    return canvasToDataUrl(base)
  },
  async compositeBrush(image, original, maskUrl) {
    const [generated, base, mask] = await Promise.all([loadRaster(image, 0), loadRaster(original, 0), loadRaster(maskUrl, 0)])
    const ctx = context(base)
    const originalPixels = ctx.getImageData(0, 0, base.width, base.height)
    const result = scaledPixels(generated, base.width, base.height)
    const coverage = scaledPixels(mask, base.width, base.height)
    originalPixels.data.set(compositeBrushPixels(originalPixels.data, result.data, coverage.data))
    ctx.putImageData(originalPixels, 0, 0)
    return canvasToDataUrl(base)
  },
  async resizeImage(image, width, height) {
    const base = await loadRaster(image, 0)
    if (base.width === width && base.height === height) return image
    const output = canvas(width, height)
    context(output).drawImage(base, 0, 0, width, height)
    return canvasToDataUrl(output)
  },
}

export function imageEditorRequiresGeneration(result: EditorApplyResult): boolean {
  return hasImageEditorGeneration(result)
}

export function hasImageEditorGeneration(value: EditorApplyResult | EditManifest): boolean {
  const manifest = 'manifest' in value ? value.manifest : value
  return manifest.markers.length > 0 || manifest.erase.strokes > 0
}

/** Use the same supported ratio vocabulary as the image workbench. */
export function imageEditorAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ImageEditorWorkflowError('编辑后的图片尺寸无效。', 'invalid-editor-size')
  }
  const wanted = width / height
  const ratios = ['1:1', '3:4', '4:3', '9:16', '2:3', '3:2', '16:9', '21:9']
  return ratios.reduce((best, current) => {
    const ratio = (value: string): number => { const [w, h] = value.split(':').map(Number); return w / h }
    return Math.abs(Math.log(ratio(current) / wanted)) < Math.abs(Math.log(ratio(best) / wanted)) ? current : best
  })
}

/** Describe guidance as part of the image, without claiming provider mask support. */
export function buildImageEditorPrompt(result: EditorApplyResult): string {
  const { manifest } = result
  const lines = ['根据参考图片进行编辑，保留原图的构图、尺寸与未要求修改的内容。']
  if (manifest.markers.length > 0) {
    lines.push('编号圆点仅用于定位；坐标从图片左上角计算：')
    for (const marker of manifest.markers) {
      if (marker.text.trim() === '') throw new ImageEditorWorkflowError(`请填写标记 ${marker.id} 的修改要求。`, 'marker-instructions-required')
      lines.push(`${marker.id}：x=${(marker.x * 100).toFixed(1)}%，y=${(marker.y * 100).toFixed(1)}%：${marker.text.trim()}`)
    }
  }
  if (manifest.erase.strokes > 0) {
    lines.push(`红色半透明涂抹覆盖的区域需要重绘：${manifest.erase.prompt.trim() || '移除区域内的内容，并根据周围画面自然补全。'}`)
    lines.push('只修改涂抹区域，区域外保持原图。第二张参考图是没有定位标记的底图；如有编号要求，也只在涂抹范围内处理。')
  }
  lines.push('所有编号圆点、定位标记和红色涂抹仅是编辑指引，不属于画面内容；最终图片中不要保留或新增这些标记。')
  return lines.join('\n')
}

function localEditPrompt(result: EditorApplyResult): string {
  const actions: string[] = []
  if (result.manifest.size.changed) actions.push(`调整尺寸至 ${result.manifest.size.width}×${result.manifest.size.height}`)
  if (result.manifest.bgRemove.requested) actions.push('本地移除背景')
  return actions.length === 0 ? '保存编辑后的图片' : actions.join('；')
}

function generatedImage(dataUrl: string): GeneratedImage {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl)
  if (match === null) throw new ImageEditorWorkflowError('编辑器返回了无效的图片数据。', 'invalid-editor-image')
  return { mime: match[1], b64: match[2] }
}

function fileOf(result: EditorApplyResult, name: string | undefined): File {
  const file = result.files.find(value => value.name === name)
  if (file === undefined) throw new ImageEditorWorkflowError('编辑器缺少所需的图片文件。', 'editor-file-missing')
  return file
}

/** Ignore export timestamps/names, but include raster contents and the selected route. */
export async function imageEditorResultFingerprint(
  result: EditorApplyResult,
  selection?: ImageEditorSelection,
  helpers: Pick<ImageEditorWorkflowHelpers, 'readFile'> = defaultImageEditorWorkflowHelpers,
): Promise<string> {
  const { createdAt: _createdAt, files, ...manifest } = result.manifest
  const contents = await Promise.all((['edited', 'marked', 'mask'] as const).flatMap(slot => {
    const name = files[slot]
    return name === undefined ? [] : [helpers.readFile(fileOf(result, name)).then(value => [slot, value] as const)]
  }))
  const payload = new TextEncoder().encode(JSON.stringify({ manifest, contents, selection }))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

function cancelled(): ImageEditorWorkflowError {
  return new ImageEditorWorkflowError('图片编辑已取消。', 'cancelled')
}

function timeout(): ImageEditorWorkflowError {
  return new ImageEditorWorkflowError('图片编辑等待超时，请查看生成队列后重试。', 'timeout')
}

/** Race each asynchronous step so abort/timeout also stops a stalled status request. */
function bounded<T>(promise: Promise<T>, signal: AbortSignal | undefined, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { void promise.catch(() => {}); reject(cancelled()); return }
    const remaining = deadline - Date.now()
    if (remaining <= 0) { void promise.catch(() => {}); reject(timeout()); return }
    const finish = (action: () => void): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      action()
    }
    const abort = (): void => { finish(() => reject(cancelled())) }
    const timer = setTimeout(() => { finish(() => reject(timeout())) }, remaining)
    signal?.addEventListener('abort', abort, { once: true })
    promise.then(value => { finish(() => resolve(value)) }, error => { finish(() => reject(error)) })
  })
}

function pause(ms: number, signal: AbortSignal | undefined, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return }
    const remaining = deadline - Date.now()
    if (remaining <= 0) { reject(timeout()); return }
    const delay = Math.min(ms, remaining)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      if (Date.now() >= deadline) reject(timeout())
      else resolve()
    }, delay)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Retry only the gallery write after a complete edit, keeping saving failures visible. */
export async function savePreparedImageEditorResult(
  prepared: PreparedImageEditorResult,
  options: ImageEditorSaveOptions,
): Promise<ImageEditorWorkflowResult> {
  if (options.signal?.aborted) throw cancelled()
  const deadline = Date.now() + Math.max(1, options.timeoutMs ?? 30_000)
  try {
    const saved = await bounded(options.api.galleryAppend(prepared.galleryEntry), options.signal, deadline)
    const entry = saved.added ? saved.entries[0] : undefined
    if (saved.added && entry === undefined) throw new ImageEditorWorkflowError('素材库没有返回保存结果。', 'gallery-result-missing')
    return {
      kind: prepared.kind, image: prepared.image, gallery: saved.entries, galleryAdded: saved.added,
      ...(entry === undefined ? {} : { entry }),
      ...(prepared.task === undefined ? {} : { task: prepared.task }),
      ...(prepared.history === undefined ? {} : { history: prepared.history }),
      ...(prepared.historyError === undefined ? {} : { historyError: prepared.historyError }),
    }
  } catch (error) {
    if (error instanceof ImageEditorWorkflowError && error.code === 'cancelled') throw error
    throw new ImageEditorGallerySaveError(error, prepared)
  }
}

/** Edits always append a new library image; the source is never replaced. */
export async function applyImageEditorResult(
  result: EditorApplyResult,
  options: ImageEditorWorkflowOptions,
  helpers: ImageEditorWorkflowHelpers = defaultImageEditorWorkflowHelpers,
): Promise<ImageEditorWorkflowResult> {
  const deadline = Date.now() + Math.max(1, options.timeoutMs ?? 300_000)
  const { api, signal, selection, source } = options
  if (signal?.aborted) throw cancelled()
  const remote = imageEditorRequiresGeneration(result)
  if (remote && (selection === undefined || selection.model.trim() === '')) {
    throw new ImageEditorWorkflowError('请先选择用于图片编辑的模型与渠道。', 'image-model-required')
  }
  const prompt = remote ? buildImageEditorPrompt(result) : localEditPrompt(result)
  const edited = await bounded(helpers.readFile(fileOf(result, result.manifest.files.edited)), signal, deadline)
  let image = generatedImage(edited)
  let task: GenerationTask | undefined
  let history: HistoryEntry[] | undefined
  let historyError: string | undefined
  try {
    if (remote) {
      let reference = result.manifest.files.marked === undefined
        ? edited
        : await bounded(helpers.readFile(fileOf(result, result.manifest.files.marked)), signal, deadline)
      const mask = result.manifest.erase.strokes > 0
        ? await bounded(helpers.readFile(fileOf(result, result.manifest.files.mask)), signal, deadline)
        : undefined
      if (mask !== undefined) reference = await bounded(helpers.buildBrushReference(reference, mask, result.manifest.markers), signal, deadline)
      const request: GenerateRequest = {
        mode: 'edit', model: selection!.model, prompt,
        size: selection!.size ?? imageEditorAspectRatio(result.manifest.size.width, result.manifest.size.height),
        quality: selection!.quality ?? 'auto', detail: selection!.detail ?? '', n: 1,
        image: reference,
        ...(reference === edited ? {} : { images: [edited] }),
        refName: result.manifest.source.name,
        ...(selection!.channelId === undefined ? {} : { channelId: selection!.channelId }),
        ...(selection!.channel === undefined ? {} : { channel: selection!.channel }),
      }
      let submissionStopped = false
      const submission = api.taskSubmit(request)
      void submission.then(value => {
        if (submissionStopped) void api.taskCancel(value.id).catch(() => {})
      }, () => {})
      try { task = await bounded(submission, signal, deadline) }
      catch (error) { submissionStopped = true; throw error }
      options.onTask?.(task)
      while (task.status === 'queued' || task.status === 'running') {
        await pause(Math.max(0, options.pollIntervalMs ?? 800), signal, deadline)
        task = await bounded(api.taskGet(task.id), signal, deadline)
        options.onTask?.(task)
      }
      if (task.status === 'cancelled') throw cancelled()
      if (task.status !== 'completed') throw new ImageEditorWorkflowError(task.error ?? '图片编辑失败。', 'task-failed')
      const output = task.result?.images[0]
      if (output === undefined) throw new ImageEditorWorkflowError('图片编辑已完成，但没有可用的图片结果。', 'empty-result')
      const outputUrl = `data:${output.mime};base64,${output.b64}`
      const finalUrl = await bounded(mask === undefined
        ? helpers.resizeImage(outputUrl, result.manifest.size.width, result.manifest.size.height)
        : helpers.compositeBrush(outputUrl, edited, mask), signal, deadline)
      image = { ...generatedImage(finalUrl), ...(output.revisedPrompt === undefined ? {} : { revisedPrompt: output.revisedPrompt }) }
      history = task.result?.history
      historyError = task.result?.historyError
    }
    if (signal?.aborted) throw cancelled()
    const galleryEntry: HistoryEntryInput = {
      id: '', createdAt: Date.now(), mode: 'edit',
      model: remote ? selection!.model : (source?.model ?? '本地编辑'),
      prompt, size: remote ? task!.request.size : imageEditorAspectRatio(result.manifest.size.width, result.manifest.size.height),
      quality: remote ? task!.request.quality : (source?.quality ?? 'auto'),
      detail: remote ? task!.request.detail : (source?.detail ?? ''),
      n: 1, images: [image], refName: result.manifest.source.name,
      ...(remote ? selection!.channelId : source?.channelId) === undefined ? {} : { channelId: remote ? selection!.channelId : source?.channelId },
      ...(remote ? selection!.channel : source?.channel) === undefined ? {} : { channel: remote ? selection!.channel : source?.channel },
    }
    return savePreparedImageEditorResult({
      kind: remote ? 'generated' : 'local', image, galleryEntry,
      ...(task === undefined ? {} : { task }),
      ...(history === undefined ? {} : { history }),
      ...(historyError === undefined ? {} : { historyError }),
    }, { api, signal, timeoutMs: Math.max(1, deadline - Date.now()) })
  } catch (error) {
    if (task !== undefined && (task.status === 'queued' || task.status === 'running') && error instanceof ImageEditorWorkflowError && (error.code === 'cancelled' || error.code === 'timeout')) {
      void api.taskCancel(task.id).catch(() => {})
    }
    throw error
  }
}
