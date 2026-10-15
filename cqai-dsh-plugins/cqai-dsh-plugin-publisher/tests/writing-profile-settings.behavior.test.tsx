// @vitest-environment jsdom
import { act, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { WritingProfileSettings } from '../src/client/writing-profile-settings.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button type="button" {...props}/>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(),
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  PublisherModal: ({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose(): void }) => <div role="dialog" aria-label={title}><button type="button" aria-label="关闭确认" onClick={onClose}>×</button>{children}{footer}</div>,
}))

type Profile = { revision: number; instructions: string | null; enabled: boolean }
const queryApi = api as unknown as Mock
let container: HTMLDivElement
let root: Root
let stored: Profile
let saveFailure: Error | undefined
let readFailure: Error | undefined

async function renderSettings(props: Parameters<typeof WritingProfileSettings>[0] = {}) {
  await act(async () => { root.render(<WritingProfileSettings {...props}/>) })
}
async function click(text: string, scope: ParentNode = container) {
  const button = Array.from(scope.querySelectorAll('button')).find(item => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => { button.click() })
}
async function edit(value: string) {
  const input = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const writes = () => queryApi.mock.calls.filter(call => call[1] !== undefined)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  stored = { revision: 4, instructions: '自然直接，多用具体例子。\n段落简短，保留个人经验。', enabled: true }
  saveFailure = undefined
  readFailure = undefined
  queryApi.mockReset()
  queryApi.mockImplementation(async (route: string, body?: { expected_revision: number; instructions: string | null; enabled: boolean }) => {
    if (route !== 'writing-profile') throw new Error(`Unexpected route: ${route}`)
    if (body === undefined) {
      if (readFailure) throw readFailure
      return { ...stored }
    }
    if (saveFailure) throw saveFailure
    stored = { revision: stored.revision + 1, instructions: body.instructions?.trim() || null, enabled: body.enabled }
    return { ...stored }
  })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('writing profile settings', () => {
  it('shows a compact saved rule summary and opens the full editable rules', async () => {
    await renderSettings()
    expect(container.textContent).toContain('已启用')
    expect(container.textContent).toContain('本次明确要求优先')
    expect(container.querySelector('.pub-writing-summary')!.textContent).toBe(stored.instructions)
    expect(container.querySelector('textarea')).toBeNull()
    await click('查看与编辑')
    expect(container.querySelector('textarea')!.value).toBe(stored.instructions)
    expect((Array.from(container.querySelectorAll('button')).find(button => button.textContent === '保存风格')!).disabled).toBe(true)
  })

  it('creates rules with revision protection and reports dirty and saving states', async () => {
    stored = { revision: 0, instructions: null, enabled: true }
    const dirty = vi.fn()
    const busy = vi.fn()
    await renderSettings({ onDirtyChange: dirty, onBusyChange: busy })
    expect(container.textContent).toContain('尚未设置')
    await click('设置写作风格')
    await edit('语气轻松，先说结论。')
    expect(dirty).toHaveBeenLastCalledWith(true)
    await click('保存风格')
    expect(writes()).toHaveLength(1)
    expect(writes()[0]![1]).toEqual({ expected_revision: 0, instructions: '语气轻松，先说结论。', enabled: true })
    expect(busy.mock.calls.flat()).toContain(true)
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(dirty).toHaveBeenLastCalledWith(false)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('写作风格已保存')
  })

  it('keeps pause local until explicitly saved and retains the saved rules', async () => {
    await renderSettings()
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
    expect(writes()).toHaveLength(0)
    expect(container.textContent).toContain('有未保存的修改')
    await click('保存风格')
    expect(writes()[0]![1]).toEqual({ expected_revision: 4, instructions: stored.instructions, enabled: false })
    expect(container.textContent).toContain('已停用')
    expect(container.querySelector('.pub-writing-summary')?.textContent).toBe(stored.instructions)
  })

  it('cancels unsaved rule and toggle changes without writing', async () => {
    await renderSettings()
    await click('查看与编辑')
    await edit('临时改写')
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
    await click('取消修改')
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
    expect(container.querySelector('.pub-writing-summary')!.textContent).toBe(stored.instructions)
    expect(writes()).toHaveLength(0)
  })

  it('confirms clearing rules and preserves the current enabled choice', async () => {
    await renderSettings()
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
    await click('清除风格规则')
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain('保留当前启用状态')
    await click('取消', container.querySelector('[role="dialog"]')!)
    expect(writes()).toHaveLength(0)
    await click('清除风格规则')
    await click('确认清除')
    expect(writes()[0]![1]).toEqual({ expected_revision: 4, instructions: null, enabled: false })
    expect(container.textContent).toContain('尚未设置')
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(container.textContent).toContain('已清除风格规则')
  })

  it('retains edits on save failure and permits retrying the same revision', async () => {
    await renderSettings()
    await click('查看与编辑')
    await edit('保留这段尚未保存的规则')
    saveFailure = new Error('写入暂时失败')
    await click('保存风格')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('写入暂时失败')
    expect(container.querySelector('textarea')!.value).toBe('保留这段尚未保存的规则')
    saveFailure = undefined
    await click('保存风格')
    expect(writes()[1]![1]).toEqual({ expected_revision: 4, instructions: '保留这段尚未保存的规则', enabled: true })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps controls locked and reports busy until a pending save completes', async () => {
    const busy = vi.fn()
    await renderSettings({ onBusyChange: busy })
    await click('查看与编辑')
    await edit('等待保存的规则')
    let finish: (profile: Profile) => void = () => {}
    queryApi.mockImplementationOnce(() => new Promise<Profile>(resolve => { finish = resolve }))
    await click('保存风格')
    expect(busy).toHaveBeenLastCalledWith(true)
    expect(container.querySelector('textarea')!.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll('button')).every(button => button.disabled)).toBe(true)
    expect(writes()).toHaveLength(1)
    await act(async () => { finish({ revision: 5, instructions: '等待保存的规则', enabled: true }) })
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(container.querySelector('.pub-writing-summary')!.textContent).toBe('等待保存的规则')
  })

  it('requires explicit discard before reloading a concurrent Agent update', async () => {
    await renderSettings()
    await click('查看与编辑')
    await edit('手动编辑中的规则')
    stored = { revision: 5, instructions: 'Agent 刚学到的新规则', enabled: false }
    saveFailure = new Error('写作风格已被其他操作更新，请重新读取后再保存')
    await click('保存风格')
    expect(container.querySelector('textarea')!.value).toBe('手动编辑中的规则')
    await click('重新读取')
    expect(queryApi.mock.calls.filter(call => call[1] === undefined)).toHaveLength(1)
    await click('取消', container.querySelector('[role="dialog"]')!)
    expect(container.querySelector('textarea')!.value).toBe('手动编辑中的规则')
    await click('重新读取')
    await click('放弃修改并读取')
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('.pub-writing-summary')!.textContent).toBe('Agent 刚学到的新规则')
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  })

  it('retains dirty input when a confirmed reload fails', async () => {
    await renderSettings()
    await click('查看与编辑')
    await edit('未保存的规则')
    await click('刷新')
    readFailure = new Error('暂时无法读取')
    await click('放弃修改并读取')
    expect(container.querySelector('textarea')!.value).toBe('未保存的规则')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('暂时无法读取')
  })

  it('shows a retry after initial read failure', async () => {
    readFailure = new Error('服务暂不可用')
    await renderSettings()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('服务暂不可用')
    readFailure = undefined
    await click('重试')
    expect(container.querySelector('.pub-writing-summary')!.textContent).toBe(stored.instructions)
  })

  it('counts Unicode code points and blocks only values over 12000 characters', async () => {
    await renderSettings()
    await click('查看与编辑')
    await edit('😀'.repeat(12_000))
    const save = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '保存风格')!
    expect(container.querySelector('.pub-writing-input-hints')!.textContent).toContain('12,000 / 12,000 字')
    expect(save().disabled).toBe(false)
    await edit('😀'.repeat(12_001))
    expect(save().disabled).toBe(true)
    expect(container.querySelector('textarea')!.getAttribute('aria-invalid')).toBe('true')
    expect(writes()).toHaveLength(0)
  })

  it('warns on window refresh only while unsaved changes exist', async () => {
    await renderSettings()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await click('查看与编辑')
    await edit('新规则')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    await click('取消修改')
    const reverted = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reverted)
    expect(reverted.defaultPrevented).toBe(false)
  })
})
