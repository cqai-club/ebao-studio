// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherSubmission } from '../src/protocol.ts'
import { SubmissionHistory } from '../src/client/history.tsx'
import { api } from '../src/client/shared.tsx'
import { PublisherTipsProvider } from '../src/client/tips.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
  Tag: ({ children, tone }: any) => <span data-tone={tone}>{children}</span>,
}))
vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(), CONTENT_LABELS: { article: '文章', video: '视频', 'image-note': '图文' },
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : '操作失败',
  PublisherModal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) => open
    ? <div role="dialog">{children}{footer}</div> : null,
}))

const queryApi = api as unknown as Mock
let root: Root | undefined
let container: HTMLDivElement
const oldNotice = '该平台文章适配器暂不写入标签；标签仍保留在本地草稿'
function row(platform: 'tt' | 'bjh' = 'tt'): PublisherSubmission {
  return { id: 'job', contentType: 'article', contentId: 'draft', title: '旧任务', createdAt: '2026-10-05T00:00:00.000Z',
    mode: 'draft', requestedMode: 'publish', state: 'unknown',
    targets: [{ accountId: 'account', platform, accountName: '账号' }],
    message: 'Waiting failed: 45000ms exceeded；窗口已保留；账号已锁定',
    adjustments: [{ accountId: 'account', messages: [oldNotice] }],
  }
}
async function render(value: PublisherSubmission) {
  queryApi.mockResolvedValue([value])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<PublisherTipsProvider><SubmissionHistory active/></PublisherTipsProvider>) })
}
async function click(text: string) {
  const target = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!
  expect(target).toBeDefined()
  await act(async () => { target.click() })
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); queryApi.mockReset() })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove(); root = undefined; vi.unstubAllGlobals()
})

describe('Toutiao history presentation', () => {
  it('renders an old timeout as unfinished without altering history and still requires unknown-delete acknowledgement', async () => {
    const original = row()
    const stored = JSON.stringify(original)
    await render(original)
    expect(container.textContent).toContain('未完成')
    expect(container.textContent).toContain('操作超时，任务未完成')
    expect(container.textContent).not.toMatch(/结果待确认|Waiting failed|窗口|账号已锁定|标签仍保留|按平台要求调整/u)
    expect(container.querySelector('[data-tone="success"]')).toBeNull()
    expect(queryApi).toHaveBeenCalledExactlyOnceWith('submissions')
    expect(JSON.stringify(original)).toBe(stored)
    await click('删除')
    const confirm = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '确认删除')!
    expect(confirm.disabled).toBe(true)
    const acknowledge = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => { acknowledge.click() })
    queryApi.mockResolvedValue(undefined)
    await click('确认删除')
    expect(queryApi).toHaveBeenCalledWith('submission-delete', { id: 'job', acknowledgeUnknown: true })
  })

  it('keeps real image supplementation visible through history', async () => {
    const value = row()
    value.adjustments![0]!.messages.push('头条正文已保留 1 处图片占位，请在草稿窗口手动上传')
    await render(value)
    expect(container.textContent).toContain('从发布历史打开草稿手动补图')
    expect(container.textContent).not.toContain(oldNotice)
  })

  it('leaves another platform history presentation unchanged', async () => {
    await render(row('bjh'))
    expect(container.textContent).toContain('结果待确认')
    expect(container.textContent).toContain('Waiting failed')
    expect(container.textContent).toContain(oldNotice)
  })
})
