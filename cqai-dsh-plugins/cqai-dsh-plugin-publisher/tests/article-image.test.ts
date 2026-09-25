import { afterEach, describe, expect, it, vi } from 'vitest'
import { articleUploadFile } from '../src/client/article-image.ts'

afterEach(() => vi.unstubAllGlobals())

describe('article WebP upload conversion', () => {
  it('keeps non-WebP assets unchanged', async () => {
    const png = new File(['png'], 'image.png', { type: 'image/png' })
    expect(await articleUploadFile(png)).toBe(png)
  })

  it('converts a WebP cover to JPEG with an opaque white background', async () => {
    const close = vi.fn()
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    const context = { fillStyle: '', fillRect, drawImage }
    const canvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: (blob: Blob) => void, type: string, quality: number) => {
        expect(type).toBe('image/jpeg')
        expect(quality).toBe(0.92)
        callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type }))
      }),
    }
    const bitmap = { width: 800, height: 600, close }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
    const original = new File(['webp'], '封面.WEBP', { type: 'image/webp' })

    const converted = await articleUploadFile(original)

    expect(converted.name).toBe('封面.jpg')
    expect(converted.type).toBe('image/jpeg')
    expect(new Uint8Array(await converted.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
    expect(canvas).toMatchObject({ width: 800, height: 600 })
    expect(context.fillStyle).toBe('#fff')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 800, 600)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(close).toHaveBeenCalledOnce()
    expect(original.type).toBe('image/webp')
  })

  it('rejects failed encoding before the asset upload', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close })))
    vi.stubGlobal('document', { createElement: vi.fn(() => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(null),
    })) })
    await expect(articleUploadFile(new File(['webp'], 'cover.webp', { type: 'image/webp' }))).rejects.toThrow('WebP 转换失败')
    expect(close).toHaveBeenCalledOnce()
  })
})
