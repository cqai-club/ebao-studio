// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEcommerceHistory } from '../src/client/use-ecommerce-history.ts'
import type { ImageGenApi } from '../src/client/api.ts'
import type { EcommerceRun, EcommerceRunSummary } from '../src/ecommerce-run-protocol.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })

const run = (id: string, patch: Partial<EcommerceRun> = {}): EcommerceRun => ({
  id, createdAt: 1, updatedAt: 1, status: 'running', slots: [], ...patch,
})
const summary = (item: EcommerceRun): EcommerceRunSummary => ({
  id: item.id, name: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt,
  status: item.status, done: 0, total: 0, model: 'image-model', size: '1:1',
})

function bench() {
  const records = new Map([['a', run('a')], ['b', run('b')]])
  const api = {
    ecommerceList: vi.fn(async () => [...records.values()].map(summary)),
    ecommerceGet: vi.fn(async (id: string) => records.get(id)!),
  }
  const hook = renderHook(() => useEcommerceHistory(api as unknown as ImageGenApi))
  return { ...hook, api, records }
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }

describe('saved ecommerce task polling', () => {
  it('updates the selected task and list while another completed task cannot replace the view', async () => {
    const { result, api, records } = bench()
    await flush()
    await act(async () => { await result.current.open('a'); await result.current.open('b') })
    api.ecommerceGet.mockClear()
    records.set('a', run('a', { updatedAt: 3, status: 'completed' }))
    records.set('b', run('b', { updatedAt: 2 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    expect(result.current.runs.find(item => item.id === 'a')?.status).toBe('completed')
    expect(result.current.run?.id).toBe('b')
    expect(result.current.run?.updatedAt).toBe(2)
    expect(api.ecommerceGet).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('discards a poll for the previous task after a newer task is opened', async () => {
    const { result, api, records } = bench()
    await flush()
    act(() => result.current.select(records.get('a')!))
    let resolvePoll!: (value: EcommerceRun) => void
    const pendingPoll = new Promise<EcommerceRun>(resolve => { resolvePoll = resolve })
    api.ecommerceGet.mockImplementation(id => id === 'a' ? pendingPoll : Promise.resolve(records.get('b')!))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.ecommerceGet).toHaveBeenCalledWith('a')
    await act(async () => { await result.current.open('b') })
    await act(async () => resolvePoll(run('a', { status: 'completed', updatedAt: 100 })))
    expect(result.current.run?.id).toBe('b')
  })

  it('rejects older snapshots so progress cannot move backwards on polling', async () => {
    const { result, records } = bench()
    await flush()
    act(() => result.current.select(run('b', { updatedAt: 20, status: 'completed' })))
    records.set('b', run('b', { updatedAt: 10, status: 'running' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.run?.updatedAt).toBe(20)
    expect(result.current.run?.status).toBe('completed')
  })

  it('merges concurrent retry responses without replacing a newer run or changing selection', async () => {
    const { result, records } = bench()
    await flush()
    act(() => result.current.select(records.get('a')!))
    act(() => {
      result.current.update(run('a', { updatedAt: 30, status: 'completed' }))
      result.current.update(run('a', { updatedAt: 20, status: 'running' }))
      result.current.update(run('b', { updatedAt: 40, status: 'failed' }))
    })
    expect(result.current.selectedId()).toBe('a')
    expect(result.current.run).toMatchObject({ id: 'a', updatedAt: 30, status: 'completed' })
    act(() => result.current.select(null))
    act(() => result.current.update(run('a', { updatedAt: 50 })))
    expect(result.current.run).toBeNull()
  })

  it('keeps a pending poll valid after a retry update while rejecting its older snapshot', async () => {
    const { result, api, records } = bench()
    await flush()
    act(() => result.current.select(records.get('a')!))
    let resolvePoll!: (value: EcommerceRun) => void
    api.ecommerceGet.mockImplementation(() => new Promise(resolve => { resolvePoll = resolve }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    act(() => result.current.update(run('a', { updatedAt: 20 })))
    await act(async () => resolvePoll(run('a', { updatedAt: 30, status: 'completed' })))
    expect(result.current.run).toMatchObject({ updatedAt: 30, status: 'completed' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    act(() => result.current.update(run('a', { updatedAt: 40 })))
    await act(async () => resolvePoll(run('a', { updatedAt: 35, status: 'completed' })))
    expect(result.current.run).toMatchObject({ updatedAt: 40, status: 'running' })
  })

  it('discards an old task poll error after selecting a different task', async () => {
    const { result, api, records } = bench()
    await flush()
    act(() => result.current.select(records.get('a')!))
    let rejectPoll!: (error: Error) => void
    const pending = new Promise<EcommerceRun>((_resolve, reject) => { rejectPoll = reject })
    api.ecommerceGet.mockImplementation(id => id === 'a' ? pending : Promise.resolve(records.get('b')!))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await act(async () => { await result.current.open('b') })
    await act(async () => rejectPoll(new Error('old task A failed')))
    expect(result.current.run?.id).toBe('b')
    expect(result.current.error).toBeNull()
  })

  it('cannot reopen a task after returning to a draft while its read is pending', async () => {
    const { result, api } = bench()
    await flush()
    let resolveRead!: (value: EcommerceRun) => void
    api.ecommerceGet.mockImplementation(() => new Promise(resolve => { resolveRead = resolve }))
    let opening!: Promise<EcommerceRun | null>
    act(() => { opening = result.current.open('a') })
    act(() => result.current.select(null))
    await act(async () => resolveRead(run('a')))
    expect(await opening).toBeNull()
    expect(result.current.run).toBeNull()
    expect(result.current.openingId).toBeNull()
  })

  it('preserves the last good list during a read failure and clears the error after retry', async () => {
    const { result, api } = bench()
    await flush()
    expect(result.current.runs).toHaveLength(2)
    api.ecommerceList.mockRejectedValueOnce(new Error('历史读取失败'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.error).toBe('历史读取失败')
    expect(result.current.runs).toHaveLength(2)
    await act(async () => { await result.current.refresh() })
    expect(result.current.error).toBeNull()
  })

  it('does not apply an in-flight open after the workbench unmounts', async () => {
    const { result, api, unmount } = bench()
    await flush()
    let resolveRead!: (value: EcommerceRun) => void
    api.ecommerceGet.mockImplementation(() => new Promise(resolve => { resolveRead = resolve }))
    let opening!: Promise<EcommerceRun | null>
    act(() => { opening = result.current.open('a') })
    unmount()
    resolveRead(run('a'))
    expect(await opening).toBeNull()
  })
})
