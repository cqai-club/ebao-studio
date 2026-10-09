// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../src/client/shared.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Modal: ({ title, children, footer, onClose, className }: any) => <div className={className} role="dialog" aria-label={title}>
    <button aria-label="关闭" onClick={onClose}/>{children}<footer>{footer}</footer>
  </div>,
}))

let container: HTMLDivElement
let root: Root
const confirm = vi.fn()
const cancel = vi.fn()
const props: ComponentProps<typeof ConfirmDialog> = {
  contentType: 'article', title: '周末徒步攻略', mode: 'publish', busy: false,
  accounts: [
    { id: 'bjh-a', displayName: '百家号账号', platform: 'bjh', loginState: 'logged-in' },
    { id: 'juejin-a', displayName: '掘金主账号', platform: 'juejin', loginState: 'logged-in' },
  ],
  targetTitles: { 'juejin-a': '掘金平台标题' },
  onConfirm: confirm, onCancel: cancel,
}

async function render(overrides: Partial<ComponentProps<typeof ConfirmDialog>> = {}) {
  await act(async () => { root.render(<ConfirmDialog {...props} {...overrides}/>) })
}
function button(text: string) {
  return Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)!
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  confirm.mockReset()
  cancel.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('Publisher confirmation dialog', () => {
  it.each(['publish', 'draft'] as const)('names the %s action and exact account count before one explicit submission', async mode => {
    await render({ mode })
    const label = mode === 'publish' ? '确认发布' : '确认转存草稿'
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(label)
    expect(container.textContent).toContain('目标账号 · 2 个')
    expect(container.textContent).toContain('掘金平台标题')
    expect(confirm).not.toHaveBeenCalled()
    const submit = button(`${label} · 2 个账号`)
    await act(async () => { submit.click(); submit.click() })
    expect(confirm).toHaveBeenCalledOnce()
    await act(async () => { button('返回修改').click() })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('blocks busy or empty-target confirmation and keeps the return action available only before submission', async () => {
    await render({ accounts: [] })
    expect(button('确认发布 · 0 个账号').disabled).toBe(true)
    await act(async () => { button('确认发布 · 0 个账号').click() })
    expect(confirm).not.toHaveBeenCalled()
    await act(async () => { button('返回修改').click() })
    expect(cancel).toHaveBeenCalledOnce()
    cancel.mockReset()
    await render({ busy: true })
    expect(button('正在校验并提交…').disabled).toBe(true)
    expect(button('返回修改').disabled).toBe(true)
    await act(async () => { (container.querySelector('[aria-label="关闭"]') as HTMLButtonElement).click() })
    expect(cancel).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
})
