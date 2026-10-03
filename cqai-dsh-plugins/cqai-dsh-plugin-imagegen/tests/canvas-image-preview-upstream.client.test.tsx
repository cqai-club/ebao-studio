// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasAssetRef } from '../src/protocol.ts'
import type { ImageGenApi } from '../src/client/api.ts'
import { CanvasFileOverlay } from '../src/client/CanvasFilePreview.tsx'
import { tt } from '../src/client/helpers.ts'

afterEach(cleanup)

const asset: CanvasAssetRef = {
  assetId: `${'a'.repeat(64)}.png`, url: '/canvas/image.png', mime: 'image/png',
  kind: 'image', width: 100, height: 100, bytes: 100, origin: 'upload',
}

describe('canvas full image preview', () => {
  it('zooms within bounds, resets, and restores fit when the image changes', () => {
    const canvasFilePreview = vi.fn()
    const props = { api: { canvasFilePreview } as unknown as ImageGenApi, asset, title: 'Image', fileKind: 'image' as const, onClose: vi.fn() }
    const view = render(<CanvasFileOverlay {...props} />)
    const toolbar = within(screen.getByRole('toolbar', { name: tt('preview.zoomControls') }))
    const zoomIn = toolbar.getByRole('button', { name: tt('preview.zoomIn') })
    const zoomOut = toolbar.getByRole('button', { name: tt('preview.zoomOut') })
    for (let i = 0; i < 20; i++) fireEvent.click(zoomIn)
    expect(toolbar.getByText('400%')).toBeTruthy()
    expect((zoomIn as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 20; i++) fireEvent.click(zoomOut)
    expect(toolbar.getByText('50%')).toBeTruthy()
    expect((zoomOut as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(toolbar.getAllByRole('button', { name: tt('preview.zoomReset') })[0])
    expect(toolbar.getByText('100%')).toBeTruthy()
    fireEvent.click(zoomIn)
    expect(toolbar.getByText('125%')).toBeTruthy()
    view.rerender(<CanvasFileOverlay {...props} asset={{ ...asset, url: '/canvas/other.png' }} />)
    expect(toolbar.getByText('100%')).toBeTruthy()
    expect(canvasFilePreview).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Image' }).getAttribute('src')).toBe('/canvas/other.png')
  })

  it('toggles image zoom on double click and closes on Escape', () => {
    const onClose = vi.fn()
    render(<CanvasFileOverlay api={{} as ImageGenApi} asset={asset} title="Image" fileKind="image" onClose={onClose} />)
    fireEvent.doubleClick(screen.getByRole('img', { name: 'Image' }))
    expect(screen.getByText('200%')).toBeTruthy()
    fireEvent.doubleClick(screen.getByRole('img', { name: 'Image' }))
    expect(screen.getByText('100%')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
