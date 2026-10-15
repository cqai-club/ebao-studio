/**
 * Adapted from Dogwind221/img2img-studio, MIT License.
 * Copyright (c) 2026 img2img-studio contributors.
 * Source: plugins/dsh-img2img-config/src/client/raster.ts at ff2b2bb.
 *
 * Raster operations behind the editor: deterministic resize/crop, a local
 * flat-background cutout preview, the brush mask, and the numbered marker pins.
 *
 * Everything runs on plain 2D canvases in the browser tab. Generated editing
 * belongs to the caller; this module never performs a network call.
 */

/** How a target size is reached from the source bitmap. */
export type SizeMode = 'cover' | 'contain' | 'stretch'

/** Target size plus the fitting rule. */
export interface SizeSpec {
  readonly width: number
  readonly height: number
  readonly mode: SizeMode
}

/** One numbered marker: normalized position plus the requested change. */
export interface MarkerItem {
  readonly id: number
  x: number
  y: number
  text: string
}

/**
 * One brush stroke. Points and radius are normalized (0..1) so the same stroke
 * list replays identically after a resize.
 */
export interface Stroke {
  readonly mode: 'paint' | 'restore'
  radius: number
  points: Array<[number, number]>
}

/** Local cutout configuration. */
export interface CutoutSpec {
  readonly enabled: boolean
  readonly tolerance: number
}

/** Local operations fail explicitly before allocating an unsupported bitmap. */
export const MAX_EDITOR_DIMENSION = 4096
export const MAX_EDITOR_PIXELS = 16_777_216
/** Largest bitmap the local cutout scans. */
export const CUTOUT_PIXEL_LIMIT = 6_000_000

export function assertBitmapSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('图片宽高必须是大于 0 的整数')
  }
  if (width > MAX_EDITOR_DIMENSION || height > MAX_EDITOR_DIMENSION || width * height > MAX_EDITOR_PIXELS) {
    throw new Error(`图片尺寸超出本地编辑上限（单边 ${MAX_EDITOR_DIMENSION} 像素，最多 1600 万像素）`)
  }
}

/** Pin colour, matching the marker list accent. */
const PIN_FILL = 'rgba(255, 59, 48, 0.92)'
/** Translucent stroke colour used by the on-canvas mask overlay. */
const MASK_OVERLAY = 'rgba(255, 90, 60, 0.55)'

/** Create an offscreen canvas of the given pixel size. */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  assertBitmapSize(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 2D context of a canvas, failing loud when the browser refuses one. */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('当前环境无法打开图片编辑画布')
  return ctx
}

/** Draw an image element into a fresh canvas at its natural size. */
export function sourceCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight)
  context2d(canvas).drawImage(image, 0, 0)
  return canvas
}

/**
 * Local flat-background cutout: flood the border inward while pixels stay within
 * `tolerance` of the border reference colour, then zero their alpha and soften
 * the seam by one pixel.
 *
 * The reference colour is the median of border samples, so a subject that
 * touches the frame edge keeps its pixels unless they match the background.
 * Complex or gradient backgrounds need the cloud channel; the editor says so
 * instead of pretending otherwise.
 */
export function applyCutout(source: HTMLCanvasElement, tolerance: number): HTMLCanvasElement {
  const width = source.width
  const height = source.height
  const out = createCanvas(width, height)
  const ctx = context2d(out)
  ctx.drawImage(source, 0, 0)
  const frame = ctx.getImageData(0, 0, width, height)
  frame.data.set(cutoutRgba(frame.data, width, height, tolerance))
  ctx.putImageData(frame, 0, 0)
  return out
}

/** Flood only matching border-connected pixels, preserving original alpha. */
export function cutoutRgba(source: Uint8ClampedArray, width: number, height: number, tolerance: number): Uint8ClampedArray {
  assertBitmapSize(width, height)
  const total = width * height
  if (total > CUTOUT_PIXEL_LIMIT) throw new Error('本地移除背景最多支持 600 万像素，请先缩小图片尺寸')
  if (source.length !== total * 4) throw new Error('图片像素数据不完整')
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) throw new Error('背景容差无效')
  const pixels = new Uint8ClampedArray(source)
  const reference = borderReference(pixels, width, height)
  if (reference === undefined) return pixels
  const removed = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const tolerance2 = tolerance * tolerance
  const matches = (index: number): boolean => {
    const offset = index * 4
    if (pixels[offset + 3] < 8) return true
    const dr = pixels[offset] - reference[0]
    const dg = pixels[offset + 1] - reference[1]
    const db = pixels[offset + 2] - reference[2]
    return dr * dr + dg * dg + db * db <= tolerance2
  }
  const push = (index: number): void => {
    if (removed[index] === 1) return
    removed[index] = 1
    queue[tail] = index
    tail += 1
  }
  const seed = (index: number): void => { if (matches(index)) push(index) }
  for (let x = 0; x < width; x += 1) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    const y = (index - x) / width
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ]
    for (const neighbour of neighbours) {
      if (neighbour < 0 || removed[neighbour] === 1) continue
      if (matches(neighbour)) push(neighbour)
    }
  }
  if (tail / total > 0.985) throw new Error('没有识别到可保留的主体，请降低背景容差或恢复背景')
  const alpha = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) alpha[index] = removed[index] === 1 ? 0 : 255
  for (let index = 0; index < total; index += 1) {
    if (removed[index] === 1) continue
    const x = index % width
    const y = (index - x) / width
    const touching = (x > 0 && removed[index - 1] === 1)
      || (x < width - 1 && removed[index + 1] === 1)
      || (y > 0 && removed[index - width] === 1)
      || (y < height - 1 && removed[index + width] === 1)
    if (touching) alpha[index] = 150
  }
  for (let index = 0; index < total; index += 1) {
    pixels[index * 4 + 3] = Math.round(pixels[index * 4 + 3] * alpha[index] / 255)
  }
  return pixels
}

/** Median border colour of an RGBA buffer, sampled every few pixels. */
function borderReference(pixels: Uint8ClampedArray, width: number, height: number): [number, number, number] | undefined {
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  const stride = Math.max(1, Math.round(Math.min(width, height) / 128))
  const sample = (x: number, y: number): void => {
    const offset = (y * width + x) * 4
    if (pixels[offset + 3] < 8) return
    reds.push(pixels[offset])
    greens.push(pixels[offset + 1])
    blues.push(pixels[offset + 2])
  }
  for (let x = 0; x < width; x += stride) {
    sample(x, 0)
    sample(x, height - 1)
  }
  for (let y = 0; y < height; y += stride) {
    sample(0, y)
    sample(width - 1, y)
  }
  const median = (values: number[]): number => {
    values.sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)] ?? 0
  }
  return reds.length === 0 ? undefined : [median(reds), median(greens), median(blues)]
}

/** Placement for a pixel resize; centering crops cover and letterboxes contain. */
export function fitRect(sourceWidth: number, sourceHeight: number, size: SizeSpec): { x: number; y: number; width: number; height: number } {
  assertBitmapSize(size.width, size.height)
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('原图尺寸无效')
  if (size.mode === 'stretch') return { x: 0, y: 0, width: size.width, height: size.height }
  const scale = size.mode === 'cover'
    ? Math.max(size.width / sourceWidth, size.height / sourceHeight)
    : Math.min(size.width / sourceWidth, size.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height }
}

/**
 * Resize directly from the decoded image, then cut out at the chosen output
 * size. Large inputs do not allocate a second full-resolution source canvas.
 */
export function drawBase(image: HTMLImageElement, size: SizeSpec, cutout: CutoutSpec): HTMLCanvasElement {
  const out = createCanvas(size.width, size.height)
  const ctx = context2d(out)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const rect = fitRect(image.naturalWidth, image.naturalHeight, size)
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  return cutout.enabled ? applyCutout(out, cutout.tolerance) : out
}

/**
 * Replay the brush strokes into a canvas.
 *
 * `overlay` is the translucent on-canvas guide; `binary` is the exported mask
 * the providers need (white = the region to redraw, black = keep), which is the
 * `wanx2.1-imageedit` mask convention.
 */
export function renderMask(
  strokes: readonly Stroke[],
  width: number,
  height: number,
  style: 'overlay' | 'binary',
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  if (style === 'binary') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  for (const stroke of strokes) {
    const paint = style === 'binary'
      ? (stroke.mode === 'paint' ? '#ffffff' : '#000000')
      : MASK_OVERLAY
    ctx.save()
    if (style === 'overlay' && stroke.mode === 'restore') ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = paint
    ctx.fillStyle = paint
    ctx.lineWidth = Math.max(1, stroke.radius * Math.min(canvas.width, canvas.height) * 2)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const points = stroke.points
    const first = points[0]
    if (first !== undefined && points.length === 1) {
      ctx.beginPath()
      ctx.arc(first[0] * canvas.width, first[1] * canvas.height, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (first !== undefined) {
      ctx.beginPath()
      ctx.moveTo(first[0] * canvas.width, first[1] * canvas.height)
      for (let index = 1; index < points.length; index += 1) {
        const point = points[index]
        ctx.lineTo(point[0] * canvas.width, point[1] * canvas.height)
      }
      ctx.stroke()
    }
    ctx.restore()
  }
  return canvas
}

/** A fully restored black mask does not request any model operation. */
export function maskHasPaint(pixels: Uint8ClampedArray): boolean {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] >= 128 && pixels[offset + 3] > 0) return true
  }
  return false
}

/** Draw the numbered pins that tell the model where each change belongs. */
export function paintMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly MarkerItem[],
  width: number,
  height: number,
  activeId?: number,
): void {
  const radius = Math.max(11, Math.min(width, height) * 0.026)
  for (const marker of markers) {
    const cx = marker.x * width
    const cy = marker.y * height
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, marker.id === activeId ? radius * 1.18 : radius, 0, Math.PI * 2)
    ctx.fillStyle = PIN_FILL
    ctx.fill()
    ctx.lineWidth = Math.max(2, radius * 0.2)
    ctx.strokeStyle = marker.id === activeId ? '#ffd60a' : 'rgba(255, 255, 255, 0.95)'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${Math.round(radius * 1.1)}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(marker.id), cx, cy + 1)
    ctx.restore()
  }
}

/** The exported edited bitmap: base pixels plus the marker pins. */
export function composeEdited(base: HTMLCanvasElement, markers: readonly MarkerItem[]): HTMLCanvasElement {
  const canvas = createCanvas(base.width, base.height)
  const ctx = context2d(canvas)
  ctx.drawImage(base, 0, 0)
  paintMarkers(ctx, markers, canvas.width, canvas.height)
  return canvas
}

/** PNG blob of a canvas, for composer attachments and downloads. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('图片导出失败，请重试'))
      else resolve(blob)
    }, 'image/png')
  })
}

/** Largest size fitting `width`×`height` inside a box, preserving the ratio. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
