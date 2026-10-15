// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorMoreMenu, EditorSection } from '../src/client/editor-layout.tsx'

let container: HTMLDivElement
let root: Root

async function render(node: ReactNode) {
  await act(async () => { root.render(node) })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('editor disclosure sections', () => {
  it('starts folded while keeping child fields mounted', async () => {
    await render(<EditorSection title="发布信息" hint="摘要、标签、内容声明">
      <label htmlFor="summary">摘要</label><textarea id="summary" defaultValue="保存的摘要"/>
    </EditorSection>)

    expect(container.querySelector('details')!.open).toBe(false)
    expect(container.querySelector('summary')!.textContent).toContain('发布信息')
    expect(container.querySelector('summary')!.textContent).toContain('摘要、标签、内容声明')
    expect(container.querySelector('textarea')!.value).toBe('保存的摘要')
  })

  it('keeps the user disclosure state and entered value across rerenders', async () => {
    const section = (hint: string) => <EditorSection title="发布信息" hint={hint}>
      <input aria-label="标签" defaultValue="已有标签"/>
    </EditorSection>
    await render(section('已有标签'))
    const details = container.querySelector('details')!
    const input = container.querySelector('input')!

    await click(details.querySelector('summary')!)
    expect(details.open).toBe(true)
    input.value = '用户正在编辑的标签'
    await render(section('自动保存中…'))
    expect(details.open).toBe(true)
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('用户正在编辑的标签')

    await click(details.querySelector('summary')!)
    expect(details.open).toBe(false)
    await render(section('已保存'))
    expect(details.open).toBe(false)
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('用户正在编辑的标签')
  })
})

describe('editor more actions', () => {
  it('opens through the native summary and returns focus there on Escape', async () => {
    await render(<EditorMoreMenu><button type="button">复制</button></EditorMoreMenu>)
    const details = container.querySelector('details')!
    const summary = container.querySelector('summary')!
    const action = container.querySelector('button')!
    expect(details.open).toBe(false)

    await click(summary)
    expect(details.open).toBe(true)
    action.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { action.dispatchEvent(escape) })
    expect(escape.defaultPrevented).toBe(true)
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(summary)
  })

  it('closes only for a pointer press outside the disclosure', async () => {
    await render(<><EditorMoreMenu><button type="button">复制</button></EditorMoreMenu><button type="button" id="outside">正文操作</button></>)
    const details = container.querySelector('details')!
    await click(details.querySelector('summary')!)
    await act(async () => { details.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(details.open).toBe(true)

    await act(async () => { container.querySelector('#outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(details.open).toBe(false)
  })

  it('leaves a disabled action inert without closing the disclosure', async () => {
    const action = vi.fn()
    await render(<EditorMoreMenu><button type="button" disabled onClick={action}>删除</button></EditorMoreMenu>)
    const details = container.querySelector('details')!
    await click(details.querySelector('summary')!)
    await click(details.querySelector('button')!)

    expect(action).not.toHaveBeenCalled()
    expect(details.open).toBe(true)
  })

  it('runs an action once, closes, and returns focus to the summary', async () => {
    const action = vi.fn()
    await render(<EditorMoreMenu><button type="button" onClick={action}><span>复制</span></button></EditorMoreMenu>)
    const details = container.querySelector('details')!
    const summary = details.querySelector('summary')!
    await click(summary)
    details.querySelector('button')!.focus()
    await click(details.querySelector('button span')!)

    expect(action).toHaveBeenCalledOnce()
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(summary)
  })
})
