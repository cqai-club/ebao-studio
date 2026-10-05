// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasGenerationHistory } from '../src/client/CanvasGenerationHistory.tsx'
import type { ImageGenApi } from '../src/client/api.ts'
import { tt } from '../src/client/helpers.ts'
import type { CanvasAssetRef, HistoryEntry } from '../src/protocol.ts'

vi.mock('../src/client/image-ops.ts', () => ({ loadRaster: vi.fn(async () => ({ width: 1, height: 1 })) }))

afterEach(cleanup)

function entry(id: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id, createdAt: 1, mode: 'text', model: 'image', prompt: id, size: '1:1', quality: 'auto', detail: '', n: 1, images: [{ url: `/history/${id}.png`, mime: 'image/png' }], ...extra }
}

function setup() {
  const ordinary = entry('ordinary')
  const commerce = entry('commerce', { workflow: 'ecommerce', projectId: 'product-a' })
  const canvas = entry('canvas hero', { canvas: { canvasId: 'canvas-a' }, size: '3:2' })
  const secondCanvas = entry('canvas poster', { canvas: { canvasId: 'canvas-b' }, model: 'alternate' })
  const mixed = [ordinary, commerce, canvas, secondCanvas]
  const historyList = vi.fn(async () => mixed)
  const historyClear = vi.fn(async () => [ordinary, commerce])
  const historyRemove = vi.fn(async () => [ordinary, commerce, secondCanvas])
  const onHistoryChange = vi.fn()
  const onOpenProject = vi.fn(async () => {})
  const onAssets = vi.fn()
  const asset: CanvasAssetRef = { assetId: 'asset.png', url: '/asset.png', mime: 'image/png', bytes: 1, width: 1, height: 1, origin: 'history' }
  const canvasImport = vi.fn(async () => asset)
  const api = { historyList, historyClear, historyRemove, canvasImport } as unknown as ImageGenApi
  const props = { api, history: mixed, projects: [{ id: 'canvas-a', title: 'Canvas A' }, { id: 'canvas-b', title: 'Canvas B' }], currentCanvasId: 'canvas-a', onHistoryChange, onOpenProject, onAssets }
  const view = render(<CanvasGenerationHistory {...props} />)
  return { ...view, props, ordinary, commerce, canvas, secondCanvas, asset, historyList, historyClear, historyRemove, canvasImport, onHistoryChange, onOpenProject, onAssets }
}

describe('canvas generation history', () => {
  it('lists only canvas records with independent query/model/ratio/project filters and no generation', async () => {
    const view = setup()
    const trigger = view.getByRole('button', { name: tt('canvas.generationHistory.title') })
    fireEvent.click(trigger)
    await waitFor(() => expect(view.getByText('canvas hero')).toBeTruthy())
    expect(view.historyList).toHaveBeenCalledExactlyOnceWith('canvas')
    expect(view.queryByText('ordinary')).toBeNull()
    expect(view.queryByText('commerce')).toBeNull()
    const query = view.getByRole('textbox', { name: tt('history.search') })
    expect(globalThis.document.activeElement).toBe(query)
    fireEvent.change(query, { target: { value: 'poster' } })
    expect(view.queryByText('canvas hero')).toBeNull()
    expect(view.getByText('canvas poster')).toBeTruthy()
    fireEvent.change(query, { target: { value: '' } })
    fireEvent.change(view.getByRole('combobox', { name: tt('history.model') }), { target: { value: 'image' } })
    expect(view.getByText('canvas hero')).toBeTruthy()
    expect(view.queryByText('canvas poster')).toBeNull()
    fireEvent.change(view.getByRole('combobox', { name: tt('history.ratio') }), { target: { value: '1:1' } })
    expect(view.getByText(tt('canvas.generationHistory.noMatch'))).toBeTruthy()
    fireEvent.change(view.getByRole('combobox', { name: tt('history.ratio') }), { target: { value: 'all' } })
    fireEvent.change(view.getByRole('combobox', { name: tt('canvas.project') }), { target: { value: 'canvas-b' } })
    expect(view.getByText(tt('canvas.generationHistory.noMatch'))).toBeTruthy()
    fireEvent.keyDown(query, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(globalThis.document.activeElement).toBe(trigger)
    expect(view.onAssets).not.toHaveBeenCalled()
    expect(view.onOpenProject).not.toHaveBeenCalled()
  })

  it('confirms the whole canvas source scope despite filters, then synchronizes the shared index', async () => {
    const view = setup()
    fireEvent.click(view.getByRole('button', { name: tt('canvas.generationHistory.title') }))
    await waitFor(() => expect(view.getByText('canvas hero')).toBeTruthy())
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'hero' } })
    fireEvent.click(view.getByRole('button', { name: tt('canvas.generationHistory.clear') }))
    expect(view.getByText(tt('canvas.generationHistory.clearConfirm', { count: 2 }))).toBeTruthy()
    expect(view.historyClear).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: tt('canvas.generationHistory.confirm') }))
    await waitFor(() => expect(view.onHistoryChange).toHaveBeenCalledExactlyOnceWith([view.ordinary, view.commerce]))
    expect(view.historyClear).toHaveBeenCalledExactlyOnceWith('canvas')
    expect(view.queryByText('canvas hero')).toBeNull()
  })

  it('keeps the actual list after a failed scoped removal and allows a later retry', async () => {
    const view = setup()
    view.historyRemove.mockRejectedValueOnce(new Error('disk unavailable'))
    fireEvent.click(view.getByRole('button', { name: tt('canvas.generationHistory.title') }))
    await waitFor(() => expect(view.getByText('canvas hero')).toBeTruthy())
    fireEvent.click(view.getAllByRole('button', { name: tt('history.delete') })[0]!)
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('disk unavailable'))
    expect(view.getByText('canvas hero')).toBeTruthy()
    expect(view.onHistoryChange).not.toHaveBeenCalled()
    expect(view.historyRemove).toHaveBeenCalledExactlyOnceWith('canvas hero', 'canvas')
    fireEvent.click(view.getAllByRole('button', { name: tt('history.delete') })[0]!)
    await waitFor(() => expect(view.queryByText('canvas hero')).toBeNull())
    expect(view.onHistoryChange).toHaveBeenCalledExactlyOnceWith([view.ordinary, view.commerce, view.secondCanvas])
  })

  it('does not insert a late history import into a newly selected canvas', async () => {
    const view = setup()
    let finishImport!: (asset: CanvasAssetRef) => void
    view.canvasImport.mockImplementationOnce(() => new Promise(resolve => { finishImport = resolve }))
    fireEvent.click(view.getByRole('button', { name: tt('canvas.generationHistory.title') }))
    await waitFor(() => expect(view.getByText('canvas hero')).toBeTruthy())
    fireEvent.click(view.getAllByRole('button', { name: tt('canvas.addToCanvas') })[0]!)
    await waitFor(() => expect(view.canvasImport).toHaveBeenCalledExactlyOnceWith('history', 'canvas hero', 0, 1, 1))
    view.rerender(<CanvasGenerationHistory {...view.props} currentCanvasId="canvas-b" />)
    finishImport(view.asset)
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain(tt('canvas.generationHistory.projectChanged')))
    expect(view.onAssets).not.toHaveBeenCalled()
  })
})
