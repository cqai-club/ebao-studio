// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublisherAgentSplitter, usePublisherAgentResize } from '../src/client/agent-splitter.tsx'

const storageKey = 'cqai.publisher.agent-panel-width'
let container: HTMLDivElement
let root: Root | undefined
let available = 1000
let resized: (() => void) | undefined
let capture: ReturnType<typeof vi.fn>
let release: ReturnType<typeof vi.fn>

function Fixture({ enabled = true }: { enabled?: boolean }) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { width, splitterProps } = usePublisherAgentResize(surfaceRef, enabled)
  return <div className="pub-surface" ref={surfaceRef}>
    <aside id="pub-agent-drawer" style={{ width }} hidden={!enabled}><textarea aria-label="Agent 输入" defaultValue="正在输入"/></aside>
    <PublisherAgentSplitter {...splitterProps}/>
    <main><textarea aria-label="正文" defaultValue="正在编辑"/></main>
  </div>
}

async function render(enabled = true) {
  await act(async () => { root!.render(<Fixture enabled={enabled}/>) })
}
function separator() { return container.querySelector<HTMLElement>('[role="separator"]')! }
function shownWidth() { return Number(separator().getAttribute('aria-valuenow')) }
async function pointer(type: string, x: number, target: EventTarget = separator(), pointerId = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button })
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } })
  await act(async () => { target.dispatchEvent(event) })
  return event
}
async function key(value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  await act(async () => { separator().dispatchEvent(event) })
  return event
}
async function resize(width: number) {
  available = width
  await act(async () => { resized?.() })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  available = 1000
  resized = undefined
  window.localStorage.clear()
  capture = vi.fn()
  release = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe = vi.fn()
    disconnect = vi.fn()
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains('pub-surface') ? available : 0, height: 600, top: 0, left: 0, right: available, bottom: 600, x: 0, y: 0, toJSON() {} }
  })
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { value: capture, configurable: true },
    releasePointerCapture: { value: release, configurable: true },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = undefined
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture
  window.localStorage.clear()
})

describe('Publisher Agent width', () => {
  it('exposes a named keyboard separator with the current container bounds', async () => {
    await render()
    const divider = separator()
    expect(shownWidth()).toBe(340)
    expect(divider.getAttribute('aria-label')).toBe('调整 Agent 面板宽度')
    expect(divider.getAttribute('aria-controls')).toBe('pub-agent-drawer')
    expect(divider.getAttribute('aria-orientation')).toBe('vertical')
    expect(divider.getAttribute('aria-valuemin')).toBe('280')
    expect(divider.getAttribute('aria-valuemax')).toBe('632')
    expect(divider.getAttribute('aria-valuetext')).toContain('340 像素')
    expect(divider.tabIndex).toBe(0)
  })

  it('drags under pointer capture and persists only the completed width', async () => {
    await render()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const surface = container.querySelector('.pub-surface')!
    const input = container.querySelector('textarea')!
    const body = container.querySelector<HTMLTextAreaElement>('main textarea')!
    input.value = '未发送的文字'
    body.value = '未保存的编辑'
    const start = await pointer('pointerdown', 340)
    expect(start.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(separator())
    expect(capture).toHaveBeenCalledWith(1)
    expect(surface.hasAttribute('data-agent-resizing')).toBe(true)
    await pointer('pointermove', 400)
    await pointer('pointermove', 540)
    expect(shownWidth()).toBe(540)
    expect(write).not.toHaveBeenCalled()
    await pointer('pointerup', 540)
    expect(write).toHaveBeenCalledExactlyOnceWith(storageKey, '540')
    expect(release).toHaveBeenCalledWith(1)
    expect(surface.hasAttribute('data-agent-resizing')).toBe(false)
    expect(container.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('未发送的文字')
    expect(container.querySelector('main textarea')).toBe(body)
    expect(body.value).toBe('未保存的编辑')
  })

  it('clamps dragging to useful Agent and content widths', async () => {
    await render()
    await pointer('pointerdown', 340)
    await pointer('pointermove', -500)
    expect(shownWidth()).toBe(280)
    await pointer('pointermove', 2000)
    expect(shownWidth()).toBe(632)
    await pointer('pointerup', 2000)
    expect(window.localStorage.getItem(storageKey)).toBe('632')
  })

  it('keeps the preference across close, reopen, and a fresh component mount', async () => {
    await render()
    await pointer('pointerdown', 340)
    await pointer('pointermove', 500)
    await pointer('pointerup', 500)
    await render(false)
    expect(separator().tabIndex).toBe(-1)
    await render()
    expect(shownWidth()).toBe(500)
    await act(async () => { root!.unmount() })
    root = createRoot(container)
    await render()
    expect(shownWidth()).toBe(500)
  })

  it('clamps a narrow container without overwriting the stored preference', async () => {
    window.localStorage.setItem(storageKey, '600')
    await render()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    await resize(800)
    expect(shownWidth()).toBe(432)
    expect(window.localStorage.getItem(storageKey)).toBe('600')
    await resize(640)
    expect(shownWidth()).toBe(280)
    await resize(1200)
    expect(shownWidth()).toBe(600)
    expect(write).not.toHaveBeenCalled()
  })

  it('uses narrow layout defaults and disables resizing in the overlay', async () => {
    available = 700
    await render()
    expect(shownWidth()).toBe(280)
    await resize(620)
    expect(separator().getAttribute('aria-hidden')).toBe('true')
    expect(separator().tabIndex).toBe(-1)
    await pointer('pointerdown', 280)
    await pointer('pointermove', 400)
    await key('ArrowRight')
    expect(shownWidth()).toBe(280)
    expect(capture).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(storageKey)).toBeNull()
  })

  it('does not replace a saved preference when a clamped divider is clicked', async () => {
    window.localStorage.setItem(storageKey, '600')
    available = 800
    await render()
    expect(shownWidth()).toBe(432)
    await pointer('pointerdown', 432)
    await pointer('pointerup', 432)
    await key('ArrowRight')
    await key('End')
    expect(window.localStorage.getItem(storageKey)).toBe('600')
    await resize(1200)
    expect(shownWidth()).toBe(600)
  })

  it('keeps the chosen drag width when the container temporarily shrinks', async () => {
    await render()
    await pointer('pointerdown', 340)
    await pointer('pointermove', 600)
    await resize(800)
    expect(shownWidth()).toBe(432)
    await pointer('pointerup', 600)
    expect(window.localStorage.getItem(storageKey)).toBe('600')
    await resize(1200)
    expect(shownWidth()).toBe(600)
  })

  it.each(['pointercancel', 'lostpointercapture'])('cancels %s and restores the previous preference', async (type) => {
    window.localStorage.setItem(storageKey, '400')
    await render()
    await pointer('pointerdown', 400)
    await pointer('pointermove', 550)
    expect(shownWidth()).toBe(550)
    await pointer(type, 550)
    expect(shownWidth()).toBe(400)
    expect(window.localStorage.getItem(storageKey)).toBe('400')
    expect(container.querySelector('.pub-surface')!.hasAttribute('data-agent-resizing')).toBe(false)
  })

  it('cleans up an interrupted drag on close, window blur, and unmount', async () => {
    await render()
    const surface = container.querySelector('.pub-surface')!
    await pointer('pointerdown', 340)
    await pointer('pointermove', 500)
    await render(false)
    expect(surface.hasAttribute('data-agent-resizing')).toBe(false)
    expect(shownWidth()).toBe(340)
    await render()
    await pointer('pointerdown', 340)
    await act(async () => { window.dispatchEvent(new Event('blur')) })
    expect(surface.hasAttribute('data-agent-resizing')).toBe(false)
    await pointer('pointerdown', 340)
    await act(async () => { root!.unmount() })
    root = undefined
    expect(surface.hasAttribute('data-agent-resizing')).toBe(false)
    expect(window.localStorage.getItem(storageKey)).toBeNull()
  })

  it('ignores other pointers and secondary buttons', async () => {
    await render()
    await pointer('pointerdown', 340, separator(), 1, 2)
    expect(capture).not.toHaveBeenCalled()
    await pointer('pointerdown', 340)
    await pointer('pointermove', 500, separator(), 2)
    await pointer('pointerup', 500, separator(), 2)
    expect(shownWidth()).toBe(340)
    expect(container.querySelector('.pub-surface')!.hasAttribute('data-agent-resizing')).toBe(true)
    await pointer('pointerup', 340, window)
    expect(container.querySelector('.pub-surface')!.hasAttribute('data-agent-resizing')).toBe(false)
  })

  it('supports arrows, a larger Shift step, Home, End, and default reset', async () => {
    await render()
    expect((await key('ArrowRight')).defaultPrevented).toBe(true)
    expect(shownWidth()).toBe(356)
    await key('ArrowRight', true)
    expect(shownWidth()).toBe(420)
    await key('ArrowLeft')
    expect(shownWidth()).toBe(404)
    await key('End')
    expect(shownWidth()).toBe(632)
    await key('Home')
    expect(shownWidth()).toBe(280)
    expect((await key('a')).defaultPrevented).toBe(false)
    await key('Enter')
    expect(shownWidth()).toBe(340)
    expect(window.localStorage.getItem(storageKey)).toBeNull()
    await resize(1200)
    expect(shownWidth()).toBe(408)
    await key('ArrowRight')
    await act(async () => { separator().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(shownWidth()).toBe(408)
    expect(window.localStorage.getItem(storageKey)).toBeNull()
  })

  it.each(['ctrlKey', 'altKey', 'metaKey'])('leaves %s navigation shortcuts untouched', async (modifier) => {
    await render()
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', [modifier]: true, bubbles: true, cancelable: true })
    await act(async () => { separator().dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(shownWidth()).toBe(340)
    expect(window.localStorage.getItem(storageKey)).toBeNull()
  })

  it('remains usable when storage is unavailable or contains invalid data', async () => {
    window.localStorage.setItem(storageKey, 'not-a-width')
    await render()
    expect(shownWidth()).toBe(340)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    await key('ArrowRight')
    expect(shownWidth()).toBe(356)
    await key('Enter')
    expect(shownWidth()).toBe(340)
  })
})
