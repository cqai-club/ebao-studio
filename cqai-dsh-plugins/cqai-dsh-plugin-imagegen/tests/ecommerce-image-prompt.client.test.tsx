// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EcommerceImagePrompt } from '../src/client/EcommerceImagePrompt.tsx'
import { applyHostLocale } from '../src/client/helpers.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); applyHostLocale('zh-CN') })

const props = { label: '场景图 · 第 1 张', slotKey: 'scene-1', imageIndex: 0 }
const actual = { source: 'actual' as const, prompt: '  actual prompt\n\nwith original whitespace\n', attempt: 2 }

function openPrompt(): void {
  fireEvent.click(screen.getByText('查看提示词'))
}

describe('ecommerce result prompt disclosure', () => {
  it('shows a recoverable copy error and allows another clipboard attempt', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<EcommerceImagePrompt {...props} result={actual} />)
    openPrompt()
    const copy = screen.getByRole('button', { name: '复制场景图 · 第 1 张的提示词' })
    await act(async () => fireEvent.click(copy))
    expect(screen.getByRole('alert').textContent).toContain('手动复制')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(actual.prompt)
    await act(async () => fireEvent.click(copy))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('已复制')
    expect(writeText).toHaveBeenNthCalledWith(2, actual.prompt)
  })

  it('copies exact text through the compatibility path and restores keyboard focus', async () => {
    vi.stubGlobal('navigator', {})
    let copied = ''
    const execCommand = vi.fn(() => {
      copied = [...document.querySelectorAll('textarea')].at(-1)!.value
      return true
    })
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      render(<EcommerceImagePrompt {...props} result={actual} />)
      openPrompt()
      const copy = screen.getByRole('button', { name: '复制场景图 · 第 1 张的提示词' })
      copy.focus()
      await act(async () => fireEvent.click(copy))
      expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy')
      expect(copied).toBe(actual.prompt)
      expect(document.activeElement).toBe(copy)
      expect(document.querySelectorAll('textarea')).toHaveLength(1)
      expect(screen.getByRole('status').textContent).toBe('已复制')
    } finally {
      if (original) Object.defineProperty(document, 'execCommand', original)
      else delete (document as unknown as Record<string, unknown>).execCommand
    }
  })

  it('does not show old copy success after polling replaces the image prompt', async () => {
    let finish!: () => void
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const view = render(<EcommerceImagePrompt {...props} result={actual} />)
    openPrompt()
    fireEvent.click(screen.getByRole('button', { name: '复制场景图 · 第 1 张的提示词' }))
    view.rerender(<EcommerceImagePrompt {...props} result={{ ...actual, attempt: 3, prompt: 'new prompt' }} />)
    await act(async () => finish())
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('new prompt')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(actual.prompt)
  })

  it('labels incomplete saved metadata and refuses to copy a missing prompt', () => {
    const view = render(<EcommerceImagePrompt {...props} result={{ source: 'saved', prompt: 'legacy saved text' }} />)
    openPrompt()
    expect(screen.getByText('已保存提示词')).toBeTruthy()
    expect(screen.getByText(/无法确认实际使用/)).toBeTruthy()
    view.rerender(<EcommerceImagePrompt {...props} result={{ source: 'unavailable', prompt: null }} />)
    expect(screen.getByText('此图没有保存可查看的提示词。')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect((screen.getByRole('button', { name: '复制场景图 · 第 1 张的提示词' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
