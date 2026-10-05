// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EcommerceHistoryMenu, type EcommerceHistoryMenuProps } from '../src/client/EcommerceHistoryMenu.tsx'
import type { EcommerceRunSummary } from '../src/ecommerce-run-protocol.ts'
import { applyHostLocale } from '../src/client/helpers.ts'

afterEach(() => { cleanup(); applyHostLocale('zh-CN') })

const makeRun = (id: string, patch: Partial<EcommerceRunSummary> = {}): EcommerceRunSummary => ({
  id,
  name: id,
  createdAt: 1_000,
  updatedAt: 1_000,
  status: 'completed',
  done: 6,
  total: 6,
  model: 'image-model',
  size: '1:1',
  ...patch,
})

function setup(patch: Partial<EcommerceHistoryMenuProps> = {}): { props: EcommerceHistoryMenuProps; trigger: HTMLButtonElement; rerender: ReturnType<typeof render>['rerender'] } {
  const props: EcommerceHistoryMenuProps = {
    runs: [makeRun('保温杯')],
    selectedId: null,
    loading: false,
    error: null,
    onOpen: vi.fn(async () => {}),
    onRefresh: vi.fn(),
    onRemove: vi.fn(async () => {}),
    onClear: vi.fn(async () => {}),
    onCancel: vi.fn(async () => {}),
    ...patch,
  }
  const { rerender } = render(<EcommerceHistoryMenu {...props} />)
  const trigger = screen.getByRole('button', { name: /^历史任务/ }) as HTMLButtonElement
  fireEvent.click(trigger)
  return { props, trigger, rerender }
}

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: Error): void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('ecommerce history menu', () => {
  it('opens a saved task without submitting or mutating tasks, then closes and returns focus', async () => {
    const { props, trigger } = setup()
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('searchbox')).toBe(document.activeElement)

    fireEvent.click(screen.getByRole('button', { name: '打开保温杯' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(props.onOpen).toHaveBeenCalledWith('保温杯')
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(props.onClear).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(trigger).toBe(document.activeElement)
  })

  it('shows cancel for active tasks and delete only for ended tasks', async () => {
    const { props } = setup({ runs: [makeRun('进行中', { status: 'running', done: 2 }), makeRun('已结束')] })
    fireEvent.click(screen.getByRole('button', { name: '进行中的操作' }))
    expect(screen.queryByRole('button', { name: '删除任务…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消任务…' }))
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledWith('进行中'))
    expect(props.onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '已结束的操作' }))
    expect(screen.queryByRole('button', { name: '取消任务…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '删除任务…' }))
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith('已结束'))
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('keeps queued tasks and disables clear when there are no finished tasks', () => {
    setup({ runs: [makeRun('排队商品', { status: 'queued', done: 0 })] })
    expect((screen.getByRole('button', { name: '清空电商已结束任务…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('已完成 0/6')).toBeTruthy()
  })

  it('reports only saved result count for legacy tasks with no known original plan', () => {
    setup({ runs: [makeRun('旧商品', { legacy: true, done: 2, total: 2 })] })
    expect(screen.getByText('已保存 2 个结果')).toBeTruthy()
    expect(screen.queryByText('已完成 2/2')).toBeNull()
  })

  it('dismisses on Escape or outside click and returns focus to its trigger', () => {
    const { trigger } = setup()
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    fireEvent.click(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('returns focus when keyboard navigation leaves the nonmodal picker', () => {
    const { trigger } = setup()
    const lastControl = screen.getByRole('button', { name: '清空电商已结束任务…' })
    lastControl.focus()
    fireEvent.keyDown(lastControl, { key: 'Tab' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('filters product names and saved prompts independently by status, model and ratio', () => {
    setup({ runs: [
      makeRun('保温杯', { searchText: 'warm scene', status: 'running', done: 2, model: 'model-a', size: '3:4' }),
      makeRun('蓝牙耳机', { searchText: 'cool scene', model: 'model-b', size: '1:1' }),
    ] })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'warm' } })
    expect(screen.getByRole('button', { name: '打开保温杯' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打开蓝牙耳机' })).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: '任务状态' }), { target: { value: 'completed' } })
    expect(screen.getByText('没有符合筛选条件的任务。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
    fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: 'model-b' } })
    expect(screen.queryByRole('button', { name: '打开保温杯' })).toBeNull()
    expect(screen.getByRole('button', { name: '打开蓝牙耳机' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: '比例' }), { target: { value: '3:4' } })
    expect(screen.getByText('没有符合筛选条件的任务。')).toBeTruthy()
  })

  it('sorts by creation time and does not jump rows on progress updates', () => {
    const runs = [makeRun('旧任务', { createdAt: 1, updatedAt: 999 }), makeRun('新任务', { createdAt: 2, updatedAt: 2 })]
    const { props, rerender } = setup({ runs })
    const order = (): string[] => Array.from(document.querySelectorAll('[data-ecommerce-history-row]')).map(row => row.getAttribute('data-run-id')!)
    expect(order()).toEqual(['新任务', '旧任务'])
    rerender(<EcommerceHistoryMenu {...props} runs={[{ ...runs[0], updatedAt: 9_999 }, runs[1]]} />)
    expect(order()).toEqual(['新任务', '旧任务'])
  })

  it('distinguishes loading, empty history and retrieval failure with retry', () => {
    const { props, rerender } = setup({ runs: [], loading: true })
    expect(screen.getByRole('status').textContent).toBe('正在读取历史任务…')
    rerender(<EcommerceHistoryMenu {...props} loading={false} />)
    expect(screen.getByText(/暂无电商任务/)).toBeTruthy()
    rerender(<EcommerceHistoryMenu {...props} loading={false} error="读取失败" />)
    expect(screen.queryByText(/暂无电商任务/)).toBeNull()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('读取失败')
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(props.onRefresh).toHaveBeenCalledTimes(2)
  })

  it('keeps the picker open after failing to open a task', async () => {
    setup({ onOpen: vi.fn(async () => { throw new Error('参考图读取失败') }) })
    fireEvent.click(screen.getByRole('button', { name: '打开保温杯' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('参考图读取失败'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows action failure and leaves the original task available', async () => {
    setup({ onRemove: vi.fn(async () => { throw new Error('删除失败') }) })
    fireEvent.click(screen.getByRole('button', { name: '保温杯的操作' }))
    fireEvent.click(screen.getByRole('button', { name: '删除任务…' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('删除失败'))
    expect(screen.getByRole('button', { name: '打开保温杯' })).toBeTruthy()
  })

  it('keeps a newer selection open while an older load finishes', async () => {
    const first = deferred()
    const second = deferred()
    setup({ runs: [makeRun('商品A'), makeRun('商品B')], onOpen: id => id === '商品A' ? first.promise : second.promise })
    fireEvent.click(screen.getByRole('button', { name: '打开商品A' }))
    fireEvent.click(screen.getByRole('button', { name: '打开商品B' }))
    await act(async () => first.resolve())
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => second.resolve())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not close a reopened picker when a dismissed older load finishes', async () => {
    const pending = deferred()
    const { trigger } = setup({ onOpen: () => pending.promise })
    fireEvent.click(screen.getByRole('button', { name: '打开保温杯' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(trigger)
    await act(async () => pending.resolve())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('uses a viewport-bounded body portal below the trigger even inside an overflow container', () => {
    const previousWidth = window.innerWidth
    try {
      window.innerWidth = 320
      const { trigger } = setup()
      trigger.parentElement!.style.overflow = 'hidden'
      const menu = screen.getByRole('dialog')
      expect(menu.parentElement).toBe(document.body)
      expect(menu.style.width).toBe('296px')
      expect(menu.style.left).toBe('12px')
      expect(menu.style.top).toBe('8px')
    } finally {
      window.innerWidth = previousWidth
    }
  })

  it('keeps controls visible above a trigger near the viewport bottom', () => {
    const previousHeight = window.innerHeight
    try {
      window.innerHeight = 600
      const { trigger } = setup()
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(250, 560, 110, 32))
      fireEvent(window, new Event('resize'))
      const menu = screen.getByRole('dialog')
      expect(menu.style.bottom).toBe('48px')
      expect(menu.style.top).toBe('')
      expect(menu.style.maxHeight).toBe('540px')
    } finally {
      window.innerHeight = previousHeight
    }
  })

  it('renders live interface locale changes while history is open', () => {
    setup()
    act(() => applyHostLocale('en-US'))
    expect(screen.getByRole('dialog', { name: 'Ecommerce task history' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open 保温杯' })).toBeTruthy()
    act(() => applyHostLocale('ru-RU'))
    expect(screen.getByRole('dialog', { name: 'История товарных задач' })).toBeTruthy()
  })
})
