import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateRequest, GenerationTask, HistoryEntry, HistoryEntryInput } from '../src/protocol.ts'
import type { EditorApplyResult } from '../src/client/image-editor/EditorModal.tsx'
import {
  applyImageEditorResult, buildImageEditorPrompt, compositeBrushPixels,
  hasImageEditorGeneration, imageEditorAspectRatio, imageEditorResultFingerprint,
  ImageEditorGallerySaveError, savePreparedImageEditorResult,
  validateBrushMaskPixels,
  type ImageEditorWorkflowHelpers,
} from '../src/client/image-editor-workflow.ts'

const clean = 'data:image/png;base64,Y2xlYW4='
const marked = 'data:image/png;base64,bWFya2Vk'
const mask = 'data:image/png;base64,bWFzaw=='
const guide = 'data:image/png;base64,Z3VpZGU='
const finished = 'data:image/png;base64,ZmluYWw='

function editor({ markers = false, brush = false, resize = false, cutout = false } = {}): EditorApplyResult {
  return {
    files: [new File(['clean'], 'edited.png', { type: 'image/png' }), new File(['marked'], 'marked.png', { type: 'image/png' }), new File(['mask'], 'mask.png', { type: 'image/png' })],
    legend: [],
    manifest: {
      version: 1, createdAt: '2026-10-09T00:00:00Z',
      source: { name: 'original.png', width: 1024, height: 1024 },
      size: { width: resize ? 1600 : 1024, height: resize ? 900 : 1024, changed: resize, mode: 'contain' },
      bgRemove: { requested: cutout, localPreview: cutout, tolerance: 32 },
      erase: { strokes: brush ? 1 : 0, prompt: brush ? '把衣服改成蓝色' : '' },
      markers: markers ? [{ id: 1, x: 0.25, y: 0.5, text: '背景改成夜景' }] : [],
      files: { edited: 'edited.png', ...(markers ? { marked: 'marked.png' } : {}), ...(brush ? { mask: 'mask.png' } : {}) },
    },
  }
}

const original: HistoryEntry = {
  id: 'original', createdAt: 1, mode: 'text', model: 'original-model', prompt: 'original prompt',
  size: '1:1', quality: '2k', detail: '', n: 1,
  channelId: 'custom:original', channel: 'Original Provider',
  images: [{ url: '/original.png', mime: 'image/png' }],
}

function harness() {
  const request: GenerateRequest = { mode: 'edit', model: 'test-image', prompt: 'edit', size: '1:1', quality: 'auto', detail: '', n: 1 }
  const task = (status: GenerationTask['status'], overrides: Partial<GenerationTask> = {}): GenerationTask => ({
    id: 'editor-task', createdAt: 1, request, status,
    ...(status === 'completed' ? { result: { images: [{ b64: 'QUk=', mime: 'image/png', revisedPrompt: 'revised' }], history: [original] } } : {}),
    ...overrides,
  })
  const api = {
    taskSubmit: vi.fn(async (input: GenerateRequest) => task('queued', { request: input })),
    taskGet: vi.fn(async (_id: string) => task('completed', { request: api.taskSubmit.mock.calls[0]?.[0] ?? request })),
    taskCancel: vi.fn(async (_id: string) => task('cancelled')),
    galleryAppend: vi.fn(async (input: HistoryEntryInput) => ({
      added: true,
      entries: [{ ...input, id: 'new-gallery', images: [{ url: '/new-gallery.png', mime: input.images[0].mime }] }, original] as HistoryEntry[],
    })),
  }
  const helpers: ImageEditorWorkflowHelpers = {
    readFile: vi.fn(async (file: File) => ({ 'edited.png': clean, 'marked.png': marked, 'mask.png': mask })[file.name]!),
    buildBrushReference: vi.fn(async () => guide),
    compositeBrush: vi.fn(async () => finished),
    resizeImage: vi.fn(async () => finished),
  }
  return { api, helpers, task }
}

afterEach(() => { vi.useRealTimers() })

describe('image editor workflow', () => {
  it('saves local resize and cutout as a new library entry without a generation call or source mutation', async () => {
    const { api, helpers } = harness()
    const before = structuredClone(original)
    const result = await applyImageEditorResult(editor({ resize: true, cutout: true }), { api, source: original }, helpers)
    expect(hasImageEditorGeneration(editor({ resize: true, cutout: true }))).toBe(false)
    expect(api.taskSubmit).not.toHaveBeenCalled()
    expect(api.galleryAppend).toHaveBeenCalledWith(expect.objectContaining({
      id: '', mode: 'edit', model: 'original-model', n: 1,
      images: [{ mime: 'image/png', b64: 'Y2xlYW4=' }],
      refName: 'original.png', channelId: 'custom:original', size: '16:9',
    }))
    expect(result.kind).toBe('local')
    expect(result.entry?.id).toBe('new-gallery')
    expect(original).toEqual(before)
  })

  it('stores square local edits with the workbench ratio so size filtering can find them', async () => {
    const { api, helpers } = harness()
    await applyImageEditorResult(editor({ cutout: true }), { api }, helpers)
    expect(api.galleryAppend.mock.calls[0][0].size).toBe('1:1')
  })

  it('routes marked edits through the selected queue and returns the resized final image with history', async () => {
    const { api, helpers, task } = harness()
    api.taskGet.mockResolvedValueOnce(task('running')).mockResolvedValueOnce(task('completed'))
    const onTask = vi.fn()
    const result = await applyImageEditorResult(editor({ markers: true, resize: true }), {
      api, selection: { model: 'gpt-image-2', channelId: 'cqai', channel: 'CQAI', quality: '2k', detail: 'high' }, pollIntervalMs: 0, onTask,
    }, helpers)
    expect(api.taskSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'edit', model: 'gpt-image-2', channelId: 'cqai', channel: 'CQAI', n: 1,
      image: marked, images: [clean], size: '16:9', quality: '2k', detail: 'high', refName: 'original.png',
    }))
    const submitted = api.taskSubmit.mock.calls[0][0]
    expect(submitted.prompt).toContain('x=25.0%，y=50.0%：背景改成夜景')
    expect(submitted.prompt).toContain('不要保留或新增这些标记')
    expect(submitted).not.toHaveProperty('mask')
    expect(onTask.mock.calls.map(([value]) => value.status)).toEqual(['queued', 'running', 'completed'])
    expect(helpers.resizeImage).toHaveBeenCalledWith('data:image/png;base64,QUk=', 1600, 900)
    expect(helpers.compositeBrush).not.toHaveBeenCalled()
    expect(result.image).toEqual({ mime: 'image/png', b64: 'ZmluYWw=', revisedPrompt: 'revised' })
    expect(result.history).toEqual([original])
    expect(api.galleryAppend.mock.calls[0][0].images).toEqual([result.image])
  })

  it('bakes the brush into a guidance image and composites onto the clean base before saving', async () => {
    const { api, helpers } = harness()
    const input = editor({ brush: true, markers: true })
    const result = await applyImageEditorResult(input, { api, selection: { model: 'test-image' }, pollIntervalMs: 0 }, helpers)
    expect(helpers.buildBrushReference).toHaveBeenCalledWith(marked, mask, input.manifest.markers)
    expect(api.taskSubmit.mock.calls[0][0]).toMatchObject({ image: guide, images: [clean] })
    expect(api.taskSubmit.mock.calls[0][0]).not.toHaveProperty('mask')
    expect(helpers.compositeBrush).toHaveBeenCalledWith('data:image/png;base64,QUk=', clean, mask)
    expect(helpers.resizeImage).not.toHaveBeenCalled()
    expect(result.image.b64).toBe('ZmluYWw=')
  })

  it('requires an explicit model and nonempty marker instruction before submitting or saving', async () => {
    const { api, helpers } = harness()
    const input = editor({ markers: true })
    await expect(applyImageEditorResult(input, { api }, helpers)).rejects.toMatchObject({ code: 'image-model-required' })
    input.manifest.markers[0].text = ' '
    await expect(applyImageEditorResult(input, { api, selection: { model: 'test-image' } }, helpers)).rejects.toMatchObject({ code: 'marker-instructions-required' })
    expect(api.taskSubmit).not.toHaveBeenCalled()
    expect(api.galleryAppend).not.toHaveBeenCalled()
  })

  it.each(['failed', 'cancelled'] as const)('surfaces a %s provider task without saving a successful image', async status => {
    const { api, helpers, task } = harness()
    api.taskGet.mockResolvedValue(task(status, { error: 'Provider cannot edit this model' }))
    await expect(applyImageEditorResult(editor({ markers: true }), { api, selection: { model: 'test-image' }, pollIntervalMs: 0 }, helpers))
      .rejects.toMatchObject({ code: status === 'failed' ? 'task-failed' : 'cancelled' })
    expect(api.galleryAppend).not.toHaveBeenCalled()
  })

  it('rejects an empty completed result without claiming success', async () => {
    const { api, helpers, task } = harness()
    api.taskGet.mockResolvedValue(task('completed', { result: { images: [] } }))
    await expect(applyImageEditorResult(editor({ markers: true }), { api, selection: { model: 'test-image' }, pollIntervalMs: 0 }, helpers))
      .rejects.toMatchObject({ code: 'empty-result' })
    expect(api.galleryAppend).not.toHaveBeenCalled()
  })

  it('stops an aborted polling request and asks the host to cancel the active task', async () => {
    const { api, helpers } = harness()
    const controller = new AbortController()
    api.taskGet.mockImplementation(() => new Promise(() => {}))
    const pending = applyImageEditorResult(editor({ markers: true }), { api, selection: { model: 'test-image' }, signal: controller.signal, pollIntervalMs: 0 }, helpers)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(api.taskGet).toHaveBeenCalledOnce())
    controller.abort()
    await rejection
    expect(api.taskCancel).toHaveBeenCalledExactlyOnceWith('editor-task')
    expect(api.galleryAppend).not.toHaveBeenCalled()
    expect(api.taskGet).toHaveBeenCalledOnce()
  })

  it('times out even when taskGet never responds and cancels the active task', async () => {
    const { api, helpers } = harness()
    api.taskGet.mockImplementation(() => new Promise(() => {}))
    await expect(applyImageEditorResult(editor({ markers: true }), { api, selection: { model: 'test-image' }, pollIntervalMs: 0, timeoutMs: 30 }, helpers))
      .rejects.toMatchObject({ code: 'timeout' })
    expect(api.taskCancel).toHaveBeenCalledExactlyOnceWith('editor-task')
    expect(api.galleryAppend).not.toHaveBeenCalled()
  })

  it('cancels a submission that resolves after the user aborts', async () => {
    const { api, helpers, task } = harness()
    let submitted!: (value: GenerationTask) => void
    api.taskSubmit.mockImplementation(() => new Promise(resolve => { submitted = resolve }))
    const controller = new AbortController()
    const pending = applyImageEditorResult(editor({ markers: true }), { api, selection: { model: 'test-image' }, signal: controller.signal }, helpers)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(api.taskSubmit).toHaveBeenCalledOnce())
    controller.abort()
    await rejection
    submitted(task('queued'))
    await vi.waitFor(() => expect(api.taskCancel).toHaveBeenCalledExactlyOnceWith('editor-task'))
    expect(api.galleryAppend).not.toHaveBeenCalled()
  })

  it('does not identify an unrelated first gallery entry as a deduplicated image', async () => {
    const { api, helpers } = harness()
    api.galleryAppend.mockResolvedValue({ added: false, entries: [original] })
    const result = await applyImageEditorResult(editor({ resize: true }), { api }, helpers)
    expect(result.galleryAdded).toBe(false)
    expect(result.entry).toBeUndefined()
    expect(result.image.b64).toBe('Y2xlYW4=')
  })

  it('retains a completed AI image when saving fails so retry saves without a second generation', async () => {
    const { api, helpers } = harness()
    api.galleryAppend.mockRejectedValueOnce(new Error('disk full'))
    let failure: ImageEditorGallerySaveError | undefined
    try {
      await applyImageEditorResult(editor({ brush: true }), { api, selection: { model: 'test-image' }, pollIntervalMs: 0 }, helpers)
    } catch (error) {
      expect(error).toBeInstanceOf(ImageEditorGallerySaveError)
      failure = error as ImageEditorGallerySaveError
    }
    expect(failure?.message).toContain('disk full')
    expect(failure?.prepared.image.b64).toBe('ZmluYWw=')
    const result = await savePreparedImageEditorResult(failure!.prepared, { api })
    expect(result.image.b64).toBe('ZmluYWw=')
    expect(result.entry?.id).toBe('new-gallery')
    expect(api.taskSubmit).toHaveBeenCalledOnce()
    expect(api.taskGet).toHaveBeenCalledOnce()
    expect(helpers.compositeBrush).toHaveBeenCalledOnce()
    expect(api.galleryAppend).toHaveBeenCalledTimes(2)
    expect(api.galleryAppend.mock.calls[1][0]).toBe(failure!.prepared.galleryEntry)
  })

  it('keeps a local image available after repeated save failures without retrying automatically', async () => {
    const { api, helpers } = harness()
    api.galleryAppend.mockRejectedValue(new Error('storage unavailable'))
    const failure = await applyImageEditorResult(editor({ cutout: true }), { api }, helpers).catch(error => error)
    expect(failure).toBeInstanceOf(ImageEditorGallerySaveError)
    await expect(savePreparedImageEditorResult(failure.prepared, { api })).rejects.toMatchObject({
      code: 'gallery-save-failed', prepared: { kind: 'local', image: { b64: 'Y2xlYW4=' } },
    })
    expect(api.galleryAppend).toHaveBeenCalledTimes(2)
    expect(api.taskSubmit).not.toHaveBeenCalled()
  })

  it('fingerprints content and routing instead of fresh export filenames or timestamps', async () => {
    const first = editor({ brush: true })
    const next: EditorApplyResult = {
      ...editor({ brush: true }),
      files: [new File(['clean'], 'edited-next.png', { type: 'image/png' }), new File(['mask'], 'mask-next.png', { type: 'image/png' })],
    }
    next.manifest.createdAt = '2026-10-09T01:00:00Z'
    next.manifest.files = { edited: 'edited-next.png', mask: 'mask-next.png' }
    const helpers = { readFile: async (file: File): Promise<string> => `data:image/png;base64,${btoa(await file.text())}` }
    const selection = { model: 'test-image', channelId: 'cqai' }
    const key = await imageEditorResultFingerprint(first, selection, helpers)
    expect(await imageEditorResultFingerprint(next, selection, helpers)).toBe(key)
    expect(await imageEditorResultFingerprint(next, { ...selection, channelId: 'custom:other' }, helpers)).not.toBe(key)
    next.files[1] = new File(['different brush pixels'], 'mask-next.png', { type: 'image/png' })
    expect(await imageEditorResultFingerprint(next, selection, helpers)).not.toBe(key)
  })
})

describe('brush pixel preservation and request vocabulary', () => {
  it('uses binary white to replace pixels and black or transparent white to keep all original channels', () => {
    const originalPixels = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128])
    const generated = new Uint8ClampedArray([200, 210, 220, 255, 201, 211, 221, 255, 202, 212, 222, 255])
    const coverage = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0])
    expect(Array.from(compositeBrushPixels(originalPixels, generated, coverage))).toEqual([10, 20, 30, 0, 201, 211, 221, 255, 70, 80, 90, 128])
    expect(Array.from(originalPixels)).toEqual([10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128])
  })

  it('rejects pixel buffers with mismatched dimensions', () => {
    expect(() => compositeBrushPixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8), new Uint8ClampedArray(4)))
      .toThrow('图片与涂抹范围的尺寸不一致')
  })

  it('rejects restored or transparent masks that contain no effective repaint region', () => {
    expect(() => validateBrushMaskPixels(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1)).toThrow('涂抹范围为空')
    expect(() => validateBrushMaskPixels(new Uint8ClampedArray([255, 255, 255, 0]), 1, 1)).toThrow('涂抹范围为空')
  })

  it('rejects marker edits outside a brush while accepting a marker inside its repaint region', () => {
    const coverage = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const marker = { id: 1, x: 0.75, y: 0.5, text: '改成蓝色' }
    expect(() => validateBrushMaskPixels(coverage, 2, 1, [marker])).toThrow('标记 1 位于涂抹范围之外')
    expect(() => validateBrushMaskPixels(coverage, 2, 1, [{ ...marker, x: 0.25 }])).not.toThrow()
  })

  it('maps editor pixel dimensions onto supported aspect ratios', () => {
    expect(imageEditorAspectRatio(1024, 1024)).toBe('1:1')
    expect(imageEditorAspectRatio(1600, 900)).toBe('16:9')
    expect(imageEditorAspectRatio(750, 1000)).toBe('3:4')
    expect(imageEditorAspectRatio(1600, 1000)).toBe('3:2')
  })

  it('states the brush boundary and guidance-removal constraint when marker and brush edits coexist', () => {
    const prompt = buildImageEditorPrompt(editor({ markers: true, brush: true }))
    expect(prompt).toContain('只修改涂抹区域')
    expect(prompt).toContain('如有编号要求，也只在涂抹范围内处理')
    expect(prompt).toContain('不要保留或新增这些标记')
  })
})
