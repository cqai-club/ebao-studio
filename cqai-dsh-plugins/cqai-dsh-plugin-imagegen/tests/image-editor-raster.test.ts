import { describe, expect, it, vi } from 'vitest'
import { assertBitmapSize, cutoutRgba, drawBase, fitRect, maskHasPaint, MAX_EDITOR_DIMENSION } from '../src/client/image-editor/raster.ts'

/** Small real RGBA fixtures, with opaque white background and a red subject. */
function fixture(width: number, height: number, subject: (x: number, y: number) => boolean): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set(subject(x, y) ? [220, 30, 20, 255] : [255, 255, 255, 255], (y * width + x) * 4)
  }
  return pixels
}
const alpha = (pixels: Uint8ClampedArray, width: number, x: number, y: number): number => pixels[(y * width + x) * 4 + 3]

describe('image editor raster pixels', () => {
  it('removes the connected backdrop while retaining a subject that touches the edge', () => {
    const original = fixture(9, 9, (x, y) => x >= 3 && x <= 5 && y <= 5)
    const result = cutoutRgba(original, 9, 9, 36)
    expect(alpha(result, 9, 0, 0)).toBe(0)
    expect(alpha(result, 9, 4, 0)).toBe(255)
    expect(alpha(result, 9, 4, 3)).toBe(255)
    expect(alpha(original, 9, 0, 0)).toBe(255)
  })

  it('retains an enclosed detail with the same colour as the removed background', () => {
    const pixels = fixture(9, 9, (x, y) => x >= 2 && x <= 6 && y >= 2 && y <= 6)
    pixels.set([255, 255, 255, 255], (4 * 9 + 4) * 4)
    const result = cutoutRgba(pixels, 9, 9, 36)
    expect(alpha(result, 9, 4, 4)).toBe(255)
    expect(alpha(result, 9, 0, 4)).toBe(0)
  })

  it('preserves transparency and never turns semi-transparent subject pixels opaque', () => {
    const pixels = fixture(9, 9, (x, y) => x >= 2 && x <= 6 && y >= 2 && y <= 6)
    pixels[(4 * 9 + 4) * 4 + 3] = 45
    pixels[(4 * 9 + 5) * 4 + 3] = 0
    const result = cutoutRgba(pixels, 9, 9, 36)
    expect(alpha(result, 9, 4, 4)).toBe(45)
    expect(alpha(result, 9, 5, 4)).toBe(0)
  })

  it('reports an unsupported cutout or an indistinguishable subject without returning unchanged pixels', () => {
    expect(() => cutoutRgba(new Uint8ClampedArray(), 4096, 2048, 36)).toThrow('600 万像素')
    expect(() => cutoutRgba(fixture(4, 4, () => false), 4, 4, 36)).toThrow('没有识别到')
    expect(() => cutoutRgba(new Uint8ClampedArray(2), 4, 4, 36)).toThrow('不完整')
  })

  it('ignores a fully restored mask and treats only visible white regions as edits', () => {
    expect(maskHasPaint(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]))).toBe(false)
    expect(maskHasPaint(new Uint8ClampedArray([255, 255, 255, 0]))).toBe(false)
    expect(maskHasPaint(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]))).toBe(true)
  })
})

describe('image editor pixel resize', () => {
  it('crops or letterboxes a landscape image and stretches only when requested', () => {
    expect(fitRect(400, 200, { width: 100, height: 100, mode: 'cover' })).toEqual({ x: -50, y: 0, width: 200, height: 100 })
    expect(fitRect(400, 200, { width: 100, height: 100, mode: 'contain' })).toEqual({ x: 0, y: 25, width: 100, height: 50 })
    expect(fitRect(400, 200, { width: 100, height: 100, mode: 'stretch' })).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('sets exported bitmap dimensions and draws directly at the chosen pixel placement', () => {
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }) }
    vi.stubGlobal('document', { createElement: () => canvas })
    try {
      const image = { naturalWidth: 400, naturalHeight: 200 } as HTMLImageElement
      const output = drawBase(image, { width: 100, height: 100, mode: 'contain' }, { enabled: false, tolerance: 36 })
      expect(output.width).toBe(100)
      expect(output.height).toBe(100)
      expect(drawImage).toHaveBeenCalledWith(image, 0, 25, 100, 50)
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects invalid or oversized allocations before drawing', () => {
    expect(() => assertBitmapSize(0, 100)).toThrow('整数')
    expect(() => assertBitmapSize(10.5, 100)).toThrow('整数')
    expect(() => assertBitmapSize(MAX_EDITOR_DIMENSION + 1, 100)).toThrow('上限')
    expect(() => assertBitmapSize(Number.NaN, 100)).toThrow('整数')
  })
})
