// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasWorkspace } from '../src/client/CanvasWorkspace.tsx'
import { ImageGenApiError, type ImageGenApi } from '../src/client/api.ts'
import { createTaskPollingState, mergeTaskSummaries } from '../src/client/generation-task-poll.ts'
import { tt } from '../src/client/helpers.ts'
import type { CanvasAssetRef, CanvasDocument, GenerationTask, GenerationTaskSummary } from '../src/protocol.ts'

vi.mock('../src/client/TemplateLibrary.tsx', () => ({ TemplateLibrary: () => null }))
vi.mock('../src/client/CanvasBackgrounds.tsx', () => Object.fromEntries([
  'DotFieldBackground', 'DotGridBackground', 'FaultyTerminalBackground', 'FloatingLinesBackground',
  'FlowBackground', 'GalaxyBackground', 'LiquidEtherBackground', 'ShapeGridBackground', 'SilkBackground', 'WavesBackground',
].map(name => [name, () => null])))

const request: GenerationTask['request'] = {
  mode: 'text', model: 'test-image', prompt: 'Recover the canvas image', size: '1:1', quality: 'auto', detail: '', n: 1,
  canvas: { canvasId: 'canvas-1', parentNodeId: 'placeholder', placement: 'right' },
}
const complete: GenerationTask = {
  id: 'existing-task', status: 'completed', createdAt: 1, request,
  result: { images: [{ b64: 'image-bytes', mime: 'image/png' }] },
}
const summary: GenerationTaskSummary = { id: complete.id, status: 'completed', createdAt: 1, request, resultAvailable: true }
const asset: CanvasAssetRef = {
  assetId: `${'a'.repeat(64)}.png`, url: '/asset/recovered.png', mime: 'image/png', width: 1, height: 1, bytes: 10, origin: 'generated',
}
const document: CanvasDocument = {
  version: 2, id: 'canvas-1', title: 'Recovery canvas', revision: 1, viewport: { x: 0, y: 0, k: 1 }, background: 'blank',
  nodes: [{ id: 'placeholder', type: 'image', title: 'Pending image', x: 0, y: 0, width: 240, height: 240,
    metadata: { status: 'generating', taskId: complete.id } }],
  connections: [], createdAt: 1, updatedAt: 1,
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('Image', class {
    onload?: () => void
    naturalWidth = 1
    naturalHeight = 1
    set src(_value: string) { queueMicrotask(() => { this.onload?.() }) }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(tasks: GenerationTask[], taskGet = vi.fn(async () => complete)) {
  const canvasUpload = vi.fn(async () => asset)
  const canvasSave = vi.fn(async (next: CanvasDocument) => ({ ...next, revision: next.revision + 1 }))
  const api = {
    canvasList: vi.fn(async () => [{ id: document.id, title: document.title, revision: 1, nodeCount: 1, createdAt: 1, updatedAt: 1 }]),
    canvasRead: vi.fn(async () => structuredClone(document)),
    canvasSkillTasks: vi.fn(async () => []),
    canvasUpload, canvasSave, taskGet,
  } as unknown as ImageGenApi
  const props = { api, imageModels: ['test-image'], requireExplicitImageModel: false, connected: true, history: [], gallery: [], tasks }
  const view = render(<CanvasWorkspace {...props} />)
  return { ...view, props, canvasUpload, canvasSave, taskGet }
}

function recovered(container: HTMLElement): Element | null {
  return container.querySelector('[data-node-id="placeholder"] img[src="/asset/recovered.png"]')
}

describe('pending canvas task recovery', () => {
  it('restores a task completed before the studio opened and consumes its image once', async () => {
    const getForPanel = vi.fn()
    const feed = await mergeTaskSummaries([summary], [], getForPanel, createTaskPollingState(100))
    expect(getForPanel).not.toHaveBeenCalled()
    const view = setup(feed.tasks)
    await waitFor(() => expect(recovered(view.container)).not.toBeNull())
    expect(view.taskGet).toHaveBeenCalledExactlyOnceWith(complete.id)
    view.rerender(<CanvasWorkspace {...view.props} tasks={[...feed.tasks]} />)
    await waitFor(() => expect(view.canvasSave).toHaveBeenCalled())
    expect(view.canvasUpload).toHaveBeenCalledOnce()
    expect(view.canvasSave.mock.calls[0]?.[0].nodes[0]?.metadata?.status).toBe('success')
  })

  it('recovers completed tasks omitted from the capped terminal feed', async () => {
    const view = setup([])
    await waitFor(() => expect(recovered(view.container)).not.toBeNull())
    expect(view.taskGet).toHaveBeenCalledExactlyOnceWith(complete.id)
    expect(view.canvasUpload).toHaveBeenCalledOnce()
    expect(view.container.textContent).not.toContain(tt('canvas.taskLost'))
  })

  it('keeps a placeholder pending after a temporary detail failure and retries without duplicating the image', async () => {
    const taskGet = vi.fn().mockRejectedValueOnce(new Error('temporary connection failure')).mockResolvedValue(complete)
    const view = setup([{ ...complete, result: undefined }], taskGet)
    await waitFor(() => expect(taskGet).toHaveBeenCalledOnce())
    expect(view.canvasUpload).not.toHaveBeenCalled()
    expect(view.container.textContent).not.toContain(tt('canvas.generateFailed'))
    view.rerender(<CanvasWorkspace {...view.props} tasks={[{ ...complete, result: undefined }]} />)
    await waitFor(() => expect(recovered(view.container)).not.toBeNull())
    view.rerender(<CanvasWorkspace {...view.props} tasks={[{ ...complete, result: undefined }]} />)
    await waitFor(() => expect(view.canvasSave).toHaveBeenCalled())
    expect(taskGet).toHaveBeenCalledTimes(2)
    expect(view.canvasUpload).toHaveBeenCalledOnce()
  })

  it('waits when a completed detail has no result and retries on the next feed update', async () => {
    const taskGet = vi.fn().mockResolvedValueOnce({ ...complete, result: undefined }).mockResolvedValue(complete)
    const view = setup([{ ...complete, result: undefined }], taskGet)
    await waitFor(() => expect(taskGet).toHaveBeenCalledOnce())
    expect(view.canvasUpload).not.toHaveBeenCalled()
    expect(view.container.textContent).not.toContain(tt('canvas.generateFailed'))
    view.rerender(<CanvasWorkspace {...view.props} tasks={[{ ...complete, result: undefined }]} />)
    await waitFor(() => expect(recovered(view.container)).not.toBeNull())
    expect(view.canvasUpload).toHaveBeenCalledOnce()
  })

  it('marks a placeholder lost only after an authoritative not-found detail response', async () => {
    const taskGet = vi.fn().mockRejectedValue(new ImageGenApiError('task not found', 'not-found'))
    const view = setup([], taskGet)
    await waitFor(() => expect(view.container.textContent).toContain(tt('canvas.taskLost')))
    expect(taskGet).toHaveBeenCalledExactlyOnceWith(complete.id)
    expect(view.canvasUpload).not.toHaveBeenCalled()
  })
})
