// @vitest-environment jsdom
import { act, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { WritingProfileDialog } from '../src/client/writing-profile-dialog.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button type="button" {...props}/>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  PublisherModal: ({ open, title, description, children, footer, onClose, closeLabel }: { open: boolean; title: string; description?: string; children?: ReactNode; footer?: ReactNode; onClose(): void; closeLabel: string }) => open ? <div role="dialog" aria-label={title}><button type="button" aria-label={closeLabel} onClick={onClose}>×</button>{description && <p>{description}</p>}{children}{footer}</div> : null,
}))
vi.mock('../src/client/writing-profile-settings.tsx', () => ({
  WritingProfileSettings: ({ onDirtyChange, onBusyChange }: { onDirtyChange(dirty: boolean): void; onBusyChange(busy: boolean): void }) => {
    const [value, setValue] = useState('保存的风格规则')
    useEffect(() => { onDirtyChange(false); onBusyChange(false) }, [onDirtyChange, onBusyChange])
    return <div data-testid="settings"><label>风格规则<textarea value={value} onChange={event => { setValue(event.target.value); onDirtyChange(true) }}/></label>
      <button type="button" onClick={() => onBusyChange(true)}>开始保存</button><button type="button" onClick={() => { onBusyChange(false); onDirtyChange(false) }}>保存完成</button></div>
  },
}))

let container: HTMLDivElement
let root: Root
let closed: Mock<() => void>

function Harness() {
  const [open, setOpen] = useState(true)
  return <><button type="button" onClick={() => setOpen(true)}>打开风格设置</button><WritingProfileDialog open={open} onClose={() => { closed(); setOpen(false) }}/></>
}
async function click(text: string, scope: ParentNode = container) {
  const button = Array.from(scope.querySelectorAll('button')).find(item => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => { button.click() })
}
async function closeHeader() {
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="关闭写作风格"]')!.click() })
}
async function edit(value: string) {
  const input = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  closed = vi.fn<() => void>()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<Harness/>) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('writing profile editor dialog', () => {
  it('closes a clean dialog directly', async () => {
    expect(container.querySelector('[aria-label="写作风格"]')).not.toBeNull()
    await closeHeader()
    expect(closed).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the same child and unsaved input after canceling a dirty close', async () => {
    await edit('正在修改的文风规则')
    const input = container.querySelector('textarea')!
    await closeHeader()
    expect(closed).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="放弃未保存的文风修改？"]')).not.toBeNull()
    await click('继续修改')
    expect(container.querySelector('[aria-label="放弃未保存的文风修改？"]')).toBeNull()
    expect(container.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('正在修改的文风规则')
    await click('关闭')
    await click('放弃修改并关闭')
    expect(closed).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('blocks repeated close attempts while a write is pending', async () => {
    await edit('等待写入的规则')
    await click('开始保存')
    const closeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '关闭')!
    expect(closeButton.disabled).toBe(true)
    await closeHeader()
    await closeHeader()
    await click('关闭')
    expect(closed).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="放弃未保存的文风修改？"]')).toBeNull()
    expect(container.querySelector('textarea')!.value).toBe('等待写入的规则')
    await click('保存完成')
    expect(closeButton.disabled).toBe(false)
    await closeHeader()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('reopens with fresh child state and no stale discard confirmation', async () => {
    await edit('将放弃的临时修改')
    await closeHeader()
    await click('放弃修改并关闭')
    await click('打开风格设置')
    expect(container.querySelector('textarea')!.value).toBe('保存的风格规则')
    expect(container.querySelector('[aria-label="放弃未保存的文风修改？"]')).toBeNull()
    await click('关闭')
    expect(closed).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
