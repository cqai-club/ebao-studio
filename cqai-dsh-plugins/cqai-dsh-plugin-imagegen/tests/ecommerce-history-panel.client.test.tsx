// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGenPanel } from '../src/client/ImageGenPanel.tsx'
import type { ImageGenApi } from '../src/client/api.ts'
import type { ImageGenScope } from '../src/client/settings-scope.ts'
import type { EcommerceRun, EcommerceRunSubmit, EcommerceRunSummary } from '../src/ecommerce-run-protocol.ts'
import type { ProductSetDraft } from '../src/protocol.ts'
import { applyHostLocale } from '../src/client/helpers.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button type="button" {...props} />,
  Pill: ({ active: _active, children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) => onClick ? <button type="button" onClick={onClick} {...props}>{children}</button> : <span className={props.className}>{children}</span>,
}))
vi.mock('../src/client/CanvasWorkspace.tsx', () => ({ CanvasWorkspace: () => null }))
vi.mock('../src/client/TemplateLibrary.tsx', () => ({ TemplateLibrary: () => null }))
vi.mock('../src/client/GooeyNav.tsx', () => ({
  GooeyNav: ({ items, onSelect }: { items: Array<{ key: string; label: ReactNode }>; onSelect(index: number): void }) => <nav>{items.map((item, index) => <button key={item.key} type="button" onClick={() => onSelect(index)}>{item.label}</button>)}</nav>,
}))

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); applyHostLocale('zh-CN') })

function draft(name: string): ProductSetDraft {
  return {
    projectId: '', projectName: `${name}套图`, productName: name, promptInfo: `${name}的保存参数`,
    category: '家居用品', platform: 'Amazon', language: 'English', size: '3:4',
    promptOverrides: { 'main-1': '保存的主图提示词' },
    slots: [
      { key: 'main', label: '主图', description: '商品主图', count: 1, enabled: true, refRole: 'product' },
      { key: 'scene', label: '场景图', description: '使用场景', count: 3, enabled: true, refRole: 'product' },
    ],
  }
}

function savedRun(id: string, name: string, patch: Partial<EcommerceRun> = {}): EcommerceRun {
  return {
    id, createdAt: 1_000, updatedAt: 1_000, status: 'running',
    config: {
      draft: draft(name), providerId: 'cqai', model: 'gpt-image-1', quality: '2k', detail: 'high',
      assets: [{ id: `asset-${id}`, name: `${name}参考图.png`, role: 'product', url: `/assets/${id}` }],
    },
    slots: ['main-1', 'scene-1', 'scene-2', 'scene-3'].map((key, index) => ({
      key, label: index === 0 ? '主图' : '场景图', attempt: 1,
      status: index === 0 ? 'completed' : index === 1 ? 'running' : 'queued',
      request: { mode: 'edit', workflow: 'ecommerce', model: 'gpt-image-1', prompt: `${name}:${key}`, size: '3:4', quality: '2k', detail: 'high', n: 1, slotKey: key, slotLabel: index === 0 ? '主图' : '场景图', image: `/assets/${id}` },
      images: index === 0 ? [{ url: `/results/${id}`, mime: 'image/png' }] : [],
    })),
    ...patch,
  }
}

function summary(run: EcommerceRun): EcommerceRunSummary {
  return {
    id: run.id, name: run.config?.draft.productName ?? run.id, createdAt: run.createdAt, updatedAt: run.updatedAt,
    status: run.status, done: run.slots.filter(slot => slot.status === 'completed').length, total: run.slots.length,
    model: run.config?.model ?? 'gpt-image-1', size: run.config?.draft.size ?? '1:1', legacy: run.legacy,
  }
}

function completedRun(): EcommerceRun {
  const run = savedRun('run-a', '保温杯', { status: 'completed' })
  return {
    ...run,
    slots: run.slots.map(slot => ({ ...slot, status: 'completed', images: [{ url: `/results/${run.id}/${slot.key}`, mime: 'image/png' }] })),
  }
}

function groupRetryButton(label: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-ecommerce-group="${label}"] header button`)!
}

function groupSlotStatuses(label: string): string[] {
  return Array.from(document.querySelectorAll(`[data-ecommerce-group="${label}"] [data-status]`), slot => slot.getAttribute('data-status')!)
}

function deferredRun() {
  let resolve!: (run: EcommerceRun) => void
  const promise = new Promise<EcommerceRun>(finish => { resolve = finish })
  return { promise, resolve }
}

function bench(runs: EcommerceRun[] = [savedRun('run-a', '保温杯')]) {
  const api = {
    ecommerceList: vi.fn(async () => runs.map(summary)),
    ecommerceGet: vi.fn(async (id: string) => runs.find(run => run.id === id)!),
    ecommerceSubmit: vi.fn(async (_input: EcommerceRunSubmit) => runs[0]),
    ecommerceRemove: vi.fn(async () => []), ecommerceClear: vi.fn(async () => []),
    ecommerceCancel: vi.fn(async () => runs[0]), ecommerceRetry: vi.fn(async (_id: string, _key: string) => runs[0]),
    cqaiProvider: vi.fn(async () => ({ provider: 'cqai', immutable: true, state: 'signed-in', models: [{ alias: 'gpt-image-1', upstream: 'gpt-image-1' }], defaultModel: 'gpt-image-1' })),
    historyList: vi.fn(async () => []), galleryList: vi.fn(async () => []), taskList: vi.fn(async () => []),
    taskSubmit: vi.fn(), taskGet: vi.fn(),
  }
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: { enabled: true, channels: [] }, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }),
    subscribe: () => () => {}, getKeySetSnapshot: () => true, getSecretSetSnapshot: () => true,
    subscribeSecretSets: () => () => {}, subscribeKeySet: () => () => {},
  } as unknown as ImageGenScope
  const view = render(<ImageGenPanel api={api as unknown as ImageGenApi} scope={scope} />)
  fireEvent.click(screen.getByRole('button', { name: /电商模式/ }))
  return { api, view }
}

async function openRun(name: string): Promise<void> {
  fireEvent.click(document.querySelector('[data-ecommerce-history-trigger]')!)
  const row = await screen.findByRole('button', { name: `打开${name}` })
  fireEvent.click(row)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '电商历史任务' })).toBeNull())
}

describe('product-set saved task integration', () => {
  it('places the compact history entry immediately beside the new-product action', async () => {
    bench()
    const trigger = document.querySelector('[data-ecommerce-history-trigger]')!
    const next = document.querySelector('[data-ecommerce-new]')!
    expect(trigger.parentElement).toBe(next.parentElement)
    expect(trigger.nextElementSibling).toBe(next)
    expect(document.querySelector('[data-history-rail="true"]')).toBeNull()
    fireEvent.click(trigger)
    await screen.findByRole('button', { name: '打开保温杯' })
    expect(screen.getByRole('dialog', { name: '电商历史任务' }).parentElement).toBe(document.body)
  })

  it('restores saved configuration, asset URLs and the full running plan without generating', async () => {
    const { api } = bench()
    await openRun('保温杯')
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('保温杯')
    expect((document.querySelector('[data-ecommerce-config-readonly]') as HTMLFieldSetElement).disabled).toBe(true)
    expect(document.querySelector('img[src="/assets/run-a"]')).toBeTruthy()
    expect(document.querySelector('img[src="/results/run-a"]')).toBeTruthy()
    expect(document.querySelector('[data-ecommerce-run-progress]')?.textContent).toContain('1/4 已完成')
    expect(document.querySelectorAll('[data-ecommerce-group]')).toHaveLength(2)
    expect(api.taskSubmit).not.toHaveBeenCalled()
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
  })

  it('returns to the original edited draft after opening multiple saved products', async () => {
    const { api } = bench([savedRun('run-a', '保温杯'), savedRun('run-b', '蓝牙耳机')])
    fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '待编辑帆布包' } })
    const info = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="选填：品牌型号"]')!
    fireEvent.change(info, { target: { value: '帆布包的未提交参数' } })
    await openRun('保温杯')
    await openRun('蓝牙耳机')
    fireEvent.click(document.querySelector('[data-ecommerce-return-draft]')!)
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('待编辑帆布包')
    expect(document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="选填：品牌型号"]')!.value).toBe('帆布包的未提交参数')
    expect(document.querySelector('[data-ecommerce-config-readonly]')).toBeNull()
    expect(document.querySelector('img[src="/assets/run-a"]')).toBeNull()
    expect(document.querySelector('img[src="/assets/run-b"]')).toBeNull()
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
  })

  it('shows legacy results without presenting another draft as the original task configuration', async () => {
    const legacy = savedRun('旧保温杯', 'ignored', { config: undefined, legacy: true, status: 'completed' })
    bench([legacy])
    fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '别的草稿商品' } })
    await openRun('旧保温杯')
    expect(screen.queryByPlaceholderText('商品名称（必填）')).toBeNull()
    expect(screen.getAllByText('此旧任务仅保存了结果，原配置和参考图无法完整恢复。').length).toBeGreaterThan(0)
    expect(document.querySelector('img[src="/results/旧保温杯"]')).toBeTruthy()
    expect(document.querySelector('[data-ecommerce-copy-config]')).toBeNull()
    expect(document.querySelector('[data-ecommerce-run-progress]')).toBeNull()
  })

  it('keeps the last selection when an earlier task finishes loading later', async () => {
    const a = savedRun('run-a', '保温杯')
    const b = savedRun('run-b', '蓝牙耳机')
    let resolveA!: (run: EcommerceRun) => void
    let resolveB!: (run: EcommerceRun) => void
    const promiseA = new Promise<EcommerceRun>(resolve => { resolveA = resolve })
    const promiseB = new Promise<EcommerceRun>(resolve => { resolveB = resolve })
    const { api } = bench([a, b])
    api.ecommerceGet.mockImplementation(id => id === a.id ? promiseA : promiseB)
    fireEvent.click(document.querySelector('[data-ecommerce-history-trigger]')!)
    fireEvent.click(await screen.findByRole('button', { name: '打开保温杯' }))
    fireEvent.click(screen.getByRole('button', { name: '打开蓝牙耳机' }))
    await act(async () => resolveB(b))
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('蓝牙耳机')
    await act(async () => resolveA(a))
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('蓝牙耳机')
    expect(document.querySelector('img[src="/results/run-b"]')).toBeTruthy()
    expect(document.querySelector('img[src="/results/run-a"]')).toBeNull()
  })

  it('copies saved references into an editable draft only after an explicit copy action', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['saved-product-pixels'], { type: 'image/png' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = bench([savedRun('run-a', '保温杯'), savedRun('run-b', '蓝牙耳机')])
    fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '复制之前的旧草稿' } })
    await openRun('保温杯')
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-ecommerce-copy-config]')!)
    await waitFor(() => expect(document.querySelector('[data-ecommerce-config-readonly]')).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith('/assets/run-a')
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('保温杯')
    expect(document.querySelector('img[src^="data:image/png;base64,"]')).toBeTruthy()
    expect(api.taskSubmit).not.toHaveBeenCalled()
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '复制后编辑的保温杯' } })
    await openRun('蓝牙耳机')
    fireEvent.click(document.querySelector('[data-ecommerce-return-draft]')!)
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('复制后编辑的保温杯')
  })

  it.each(['cancel', 'remove', 'clear'] as const)('cannot leave a new product draft when an earlier %s response arrives', async operation => {
    const a = savedRun('run-a', '保温杯', { status: operation === 'cancel' ? 'running' : 'completed' })
    const { api } = bench([a])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish!: () => void
    if (operation === 'cancel') {
      api.ecommerceCancel.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ...a, status: 'cancelled' }) }))
    } else if (operation === 'remove') {
      api.ecommerceRemove.mockImplementation(() => new Promise(resolve => { finish = () => resolve([]) }))
    } else {
      api.ecommerceClear.mockImplementation(() => new Promise(resolve => { finish = () => resolve([]) }))
    }
    try {
      await openRun('保温杯')
      fireEvent.click(document.querySelector('[data-ecommerce-history-trigger]')!)
      if (operation === 'clear') fireEvent.click(screen.getByRole('button', { name: '清空电商已结束任务…' }))
      else {
        fireEvent.click(await screen.findByRole('button', { name: '保温杯的操作' }))
        fireEvent.click(screen.getByRole('button', { name: operation === 'cancel' ? '取消任务…' : '删除任务…' }))
      }
      await waitFor(() => expect(finish).toBeTypeOf('function'))
      fireEvent.click(document.querySelector('[data-ecommerce-new]')!)
      fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '正在编辑的新帆布包' } })
      await act(async () => finish())
      expect(document.querySelector('[data-ecommerce-config-readonly]')).toBeNull()
      expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('正在编辑的新帆布包')
      expect(document.querySelector('img[src="/results/run-a"]')).toBeNull()
    } finally { confirm.mockRestore() }
  })

  it('submits the complete plan to the host after preview and explicit generation', async () => {
    const { api } = bench()
    await waitFor(() => expect(api.cqaiProvider).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '新帆布包' } })
    fireEvent.click(screen.getByRole('button', { name: '生成套图预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认生成整套图片' }))
    await waitFor(() => expect(api.ecommerceSubmit).toHaveBeenCalledTimes(1))
    const input = api.ecommerceSubmit.mock.calls[0][0] as unknown as { requests: Array<{ slotKey: string }>; requestId: string; draft: ProductSetDraft }
    expect(input.draft.productName).toBe('新帆布包')
    expect(input.requestId).toBeTruthy()
    expect(input.requests).toHaveLength(6)
    expect(input.requests.map(request => request.slotKey)).toEqual(['main-1', 'selling-point-1', 'selling-point-2', 'scene-1', 'scene-2', 'detail-1'])
    expect(api.taskSubmit).not.toHaveBeenCalled()
  })

  it('allows another group to retry while the first group request is still pending', async () => {
    const run = completedRun()
    const main = deferredRun()
    const scene = deferredRun()
    const { api } = bench([run])
    api.ecommerceRetry.mockImplementation((_id, key) => key === 'main-1' ? main.promise : scene.promise)
    await openRun('保温杯')

    fireEvent.click(groupRetryButton('主图'))
    expect(groupRetryButton('主图').disabled).toBe(true)
    expect(groupRetryButton('场景图').disabled).toBe(false)
    fireEvent.click(groupRetryButton('场景图'))
    expect(api.ecommerceRetry.mock.calls).toEqual([[run.id, 'main-1'], [run.id, 'scene-1']])
    expect(groupRetryButton('场景图').disabled).toBe(true)

    const next: EcommerceRun = { ...run, updatedAt: run.updatedAt + 1, status: 'running', slots: run.slots.map(slot => ({ ...slot, attempt: 2, status: 'running' })) }
    api.ecommerceGet.mockResolvedValue(next)
    await act(async () => { main.resolve(next); scene.resolve(next) })
    expect(api.ecommerceRetry.mock.calls.map(call => call[1])).toEqual(['main-1', 'scene-1', 'scene-2', 'scene-3'])
  })

  it('retries a completed group while another group is already running', async () => {
    const completed = completedRun()
    let latest: EcommerceRun = {
      ...completed, status: 'running',
      slots: completed.slots.map(slot => slot.key === 'main-1' ? { ...slot, status: 'running', attempt: 2 } : slot),
    }
    const { api } = bench([latest])
    api.ecommerceGet.mockImplementation(async () => latest)
    api.ecommerceRetry.mockImplementation(async (_id, key) => {
      latest = { ...latest, updatedAt: latest.updatedAt + 1, slots: latest.slots.map(slot => slot.key === key ? { ...slot, status: 'running', attempt: slot.attempt + 1 } : slot) }
      return latest
    })
    await openRun('保温杯')

    expect(groupRetryButton('主图').disabled).toBe(true)
    expect(groupRetryButton('场景图').disabled).toBe(false)
    fireEvent.click(groupRetryButton('场景图'))
    await waitFor(() => expect(groupSlotStatuses('场景图')).toEqual(['running', 'running', 'running']))
    expect(api.ecommerceRetry.mock.calls.map(call => call[1])).toEqual(['scene-1', 'scene-2', 'scene-3'])
    expect(groupRetryButton('主图').disabled).toBe(true)
    expect(groupRetryButton('场景图').disabled).toBe(true)
    expect(api.taskSubmit).not.toHaveBeenCalled()
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
  })

  it('does not submit the same group again during a pending request or while its slot runs', async () => {
    const run = completedRun()
    const main = deferredRun()
    const { api } = bench([run])
    api.ecommerceRetry.mockImplementation(() => main.promise)
    await openRun('保温杯')

    fireEvent.click(groupRetryButton('主图'))
    fireEvent.click(groupRetryButton('主图'))
    fireEvent.click(groupRetryButton('主图'))
    expect(api.ecommerceRetry).toHaveBeenCalledTimes(1)
    const running: EcommerceRun = { ...run, updatedAt: run.updatedAt + 1, status: 'running', slots: run.slots.map(slot => slot.key === 'main-1' ? { ...slot, status: 'running', attempt: 2 } : slot) }
    api.ecommerceGet.mockResolvedValue(running)
    await act(async () => main.resolve(running))
    expect(groupSlotStatuses('主图')).toEqual(['running'])
    expect(groupRetryButton('主图').disabled).toBe(true)
    fireEvent.click(groupRetryButton('主图'))
    expect(api.ecommerceRetry.mock.calls).toEqual([[run.id, 'main-1']])
  })

  it('keeps newer states when concurrent group retry responses finish in reverse order', async () => {
    const run = completedRun()
    const main = deferredRun()
    const oldMainResponse: EcommerceRun = { ...run, updatedAt: run.updatedAt + 1, status: 'running', slots: run.slots.map(slot => slot.key === 'main-1' ? { ...slot, status: 'running', attempt: 2 } : slot) }
    let latest = oldMainResponse
    const { api } = bench([run])
    api.ecommerceGet.mockImplementation(async () => latest)
    api.ecommerceRetry.mockImplementation(async (_id, key) => {
      if (key === 'main-1') return main.promise
      latest = { ...latest, updatedAt: latest.updatedAt + 1, slots: latest.slots.map(slot => slot.key === key ? { ...slot, status: 'running', attempt: 2 } : slot) }
      return latest
    })
    // Opening is a read of the original completed plan; host mutations below
    // become visible only after the user starts each independent group.
    api.ecommerceGet.mockResolvedValueOnce(run)
    await openRun('保温杯')

    fireEvent.click(groupRetryButton('主图'))
    fireEvent.click(groupRetryButton('场景图'))
    await waitFor(() => expect(groupSlotStatuses('场景图')).toEqual(['running', 'running', 'running']))
    expect(groupSlotStatuses('主图')).toEqual(['running'])
    await act(async () => main.resolve(oldMainResponse))
    expect(groupSlotStatuses('主图')).toEqual(['running'])
    expect(groupSlotStatuses('场景图')).toEqual(['running', 'running', 'running'])
    expect(document.querySelector('[data-ecommerce-run-progress]')?.textContent).toContain('0/4 已完成')
    expect(api.ecommerceRetry.mock.calls.map(call => call[1])).toEqual(['main-1', 'scene-1', 'scene-2', 'scene-3'])
    expect(groupRetryButton('主图').disabled).toBe(true)
    expect(groupRetryButton('场景图').disabled).toBe(true)
  })

  it('cannot reopen a saved task when its retry response arrives after creating a new product', async () => {
    const run = completedRun()
    const main = deferredRun()
    const { api } = bench([run])
    api.ecommerceRetry.mockImplementation(() => main.promise)
    await openRun('保温杯')
    fireEvent.click(groupRetryButton('主图'))
    expect(api.ecommerceRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(document.querySelector('[data-ecommerce-new]')!)
    fireEvent.change(screen.getByPlaceholderText('商品名称（必填）'), { target: { value: '新的帆布包草稿' } })

    const running: EcommerceRun = { ...run, updatedAt: run.updatedAt + 1, status: 'running', slots: run.slots.map(slot => slot.key === 'main-1' ? { ...slot, status: 'running', attempt: 2 } : slot) }
    await act(async () => main.resolve(running))
    expect(document.querySelector('[data-ecommerce-config-readonly]')).toBeNull()
    expect((screen.getByPlaceholderText('商品名称（必填）') as HTMLInputElement).value).toBe('新的帆布包草稿')
    expect(document.querySelector('[data-ecommerce-group]')).toBeNull()
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
  })

  it('stops submitting the rest of a multi-slot group after cancelling its task', async () => {
    const completed = completedRun()
    const run: EcommerceRun = { ...completed, status: 'running', slots: completed.slots.map(slot => slot.key === 'main-1' ? { ...slot, status: 'running' } : slot) }
    const pending = deferredRun()
    const { api } = bench([run])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    api.ecommerceRetry.mockImplementation(() => pending.promise)
    const cancelled: EcommerceRun = { ...run, updatedAt: run.updatedAt + 2, status: 'cancelled', slots: run.slots.map(slot => ({ ...slot, status: 'cancelled' })) }
    api.ecommerceCancel.mockResolvedValue(cancelled)
    try {
      await openRun('保温杯')
      fireEvent.click(groupRetryButton('场景图'))
      expect(api.ecommerceRetry.mock.calls).toEqual([[run.id, 'scene-1']])
      fireEvent.click(document.querySelector('[data-ecommerce-history-trigger]')!)
      fireEvent.click(await screen.findByRole('button', { name: '保温杯的操作' }))
      fireEvent.click(screen.getByRole('button', { name: '取消任务…' }))
      expect(api.ecommerceCancel).not.toHaveBeenCalled()
      expect(api.ecommerceRetry.mock.calls).toEqual([[run.id, 'scene-1']])

      // Wait for the already-submitted request before sending cancel, so a
      // later-arriving retry POST cannot restart the host task after cancel.
      const lateRetry: EcommerceRun = { ...run, updatedAt: run.updatedAt + 3, slots: run.slots.map(slot => slot.key === 'scene-1' ? { ...slot, status: 'running', attempt: 2 } : slot) }
      await act(async () => pending.resolve(lateRetry))
      await waitFor(() => expect(groupSlotStatuses('场景图')).toEqual(['cancelled', 'cancelled', 'cancelled']))
      expect(api.ecommerceRetry.mock.calls).toEqual([[run.id, 'scene-1']])
      expect(groupSlotStatuses('场景图')).toEqual(['cancelled', 'cancelled', 'cancelled'])
      expect(groupSlotStatuses('主图')).toEqual(['cancelled'])
      expect(api.ecommerceCancel).toHaveBeenCalledTimes(1)
      expect(api.ecommerceCancel).toHaveBeenCalledWith(run.id)
    } finally { confirm.mockRestore() }
  })

  it('shows the image generation attempt actual anchored scene prompt without opening preview or generating', async () => {
    const run = completedRun()
    const slot = run.slots[1]!
    const actualPrompt = '以第1张图片中的商品为唯一外观锚点。\n保持杯身颜色、杯盖和轮廓一致。\n生成厨房早餐场景。'
    run.config!.draft.promptOverrides = { 'scene-1': '只存在于预览的场景提示词' }
    slot.request = { ...slot.request, prompt: '原始场景计划' }
    slot.attempts = [{ number: 1, status: 'completed', request: { ...slot.request, prompt: actualPrompt, image: '/results/run-a/main-1' }, images: slot.images }]
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { api } = bench([run])
    await openRun('保温杯')

    const details = document.querySelector<HTMLDetailsElement>('[data-ecommerce-image-prompt][data-slot-key="scene-1"][data-image-index="0"]')!
    const trigger = screen.getByLabelText('查看场景图 · 第 1 张的提示词')
    expect(trigger.closest('figure')).toBeNull()
    expect(details.open).toBe(false)
    fireEvent.click(trigger)
    expect(details.open).toBe(true)
    const text = details.querySelector<HTMLTextAreaElement>('[data-ecommerce-prompt-text]')!
    expect(text.value).toBe(actualPrompt)
    expect(text.readOnly).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(api.ecommerceRetry).not.toHaveBeenCalled()
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
    expect(api.taskSubmit).not.toHaveBeenCalled()
  })

  it('keeps the retained image prompt tied to its completed attempt while a new retry is running', async () => {
    const run = completedRun()
    const main = run.slots[0]!
    const oldPrompt = '这是旧图成功生成时的实际提示词，保留深蓝杯盖。'
    const nextPrompt = '这次重新生成请求使用另一组约束，尚未生成结果。'
    main.request = { ...main.request, prompt: oldPrompt }
    const oldAttempt = { number: 1, status: 'completed' as const, request: main.request, images: main.images }
    main.attempts = [oldAttempt]
    const running: EcommerceRun = {
      ...run, updatedAt: run.updatedAt + 1, status: 'running',
      slots: run.slots.map(slot => slot.key === 'main-1' ? {
        ...slot, attempt: 2, status: 'running', request: { ...slot.request, prompt: nextPrompt },
        attempts: [oldAttempt, { number: 2, status: 'running', request: { ...slot.request, prompt: nextPrompt }, images: [] }],
      } : slot),
    }
    const { api } = bench([run])
    await openRun('保温杯')
    api.ecommerceRetry.mockResolvedValue(running)
    api.ecommerceGet.mockResolvedValue(running)
    fireEvent.click(groupRetryButton('主图'))
    await waitFor(() => expect(groupSlotStatuses('主图')).toEqual(['running']))

    fireEvent.click(screen.getByLabelText('查看主图 · 第 1 张的提示词'))
    const details = document.querySelector('[data-ecommerce-image-prompt][data-slot-key="main-1"][data-image-index="0"]')!
    expect(document.querySelector('img[src="/results/run-a/main-1"]')).toBeTruthy()
    expect(details.querySelector<HTMLTextAreaElement>('[data-ecommerce-prompt-text]')!.value).toBe(oldPrompt)
    expect(api.ecommerceRetry.mock.calls).toEqual([[run.id, 'main-1']])
    expect(api.ecommerceSubmit).not.toHaveBeenCalled()
    expect(api.taskSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('copies the exact selected image prompt including whitespace and line breaks', async () => {
    const run = completedRun()
    const slot = run.slots[1]!
    const actualPrompt = ' 场景图保持商品一致。\n\nUse the generated main image as the product anchor.\n'
    slot.request = { ...slot.request, prompt: actualPrompt }
    slot.attempts = [{ number: 1, status: 'completed', request: slot.request, images: slot.images }]
    const writeText = vi.fn(async (_text: string) => {})
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { api } = bench([run])
    try {
      await openRun('保温杯')
      fireEvent.click(screen.getByLabelText('查看场景图 · 第 1 张的提示词'))
      const copy = screen.getByRole('button', { name: '复制场景图 · 第 1 张的提示词' })
      fireEvent.click(copy)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(actualPrompt))
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(document.querySelector('[data-ecommerce-image-prompt][data-slot-key="scene-1"] [role="status"]')?.textContent).toBe('已复制')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(api.ecommerceRetry).not.toHaveBeenCalled()
      expect(api.ecommerceSubmit).not.toHaveBeenCalled()
      expect(api.taskSubmit).not.toHaveBeenCalled()
    } finally {
      if (original !== undefined) Object.defineProperty(navigator, 'clipboard', original)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
