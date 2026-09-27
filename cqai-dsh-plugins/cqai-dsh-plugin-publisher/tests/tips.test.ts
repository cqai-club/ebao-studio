import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TIP_DURATION_MS, scheduleTipDismiss } from '../src/client/tips.tsx'

afterEach(() => vi.useRealTimers())

describe('publisher tips', () => {
  it('dismisses after three seconds by default', () => {
    vi.useFakeTimers()
    const dismissed = vi.fn()
    scheduleTipDismiss(dismissed)
    expect(DEFAULT_TIP_DURATION_MS).toBe(3_000)
    vi.advanceTimersByTime(2_999)
    expect(dismissed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(dismissed).toHaveBeenCalledOnce()
  })

  it('cancels an older tip timer when replaced', () => {
    vi.useFakeTimers()
    const dismissed = vi.fn()
    const cancel = scheduleTipDismiss(dismissed)
    vi.advanceTimersByTime(1_000)
    cancel()
    scheduleTipDismiss(dismissed)
    vi.advanceTimersByTime(2_000)
    expect(dismissed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(dismissed).toHaveBeenCalledOnce()
  })
})
