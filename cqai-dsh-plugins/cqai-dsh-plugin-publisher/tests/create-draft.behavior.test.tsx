// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'
import { API, TITLE_MAX, type PublisherContentType } from '../src/protocol.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
  Modal: ({ open, onClose, title, closeLabel, children, footer, className }: any) => open
    ? <div role="dialog" aria-label={title} className={className}>
        <button type="button" aria-label={closeLabel} onClick={onClose}>关闭</button>
        {children}{footer}
      </div> : null,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('../src/client/accounts.tsx', () => ({ AccountsPage: () => null }))
vi.mock('../src/client/history.tsx', () => ({ SubmissionHistory: () => null }))
vi.mock('../src/client/conversation-preview.tsx', () => ({
  ConversationPreview: () => null, ConversationPreviewAction: () => null,
  PREVIEW_ID: 'publisher-preview', PREVIEW_KIND: 'publisher-preview',
}))
vi.mock('../src/client/handoff.ts', () => ({
  readPublisherHandoff: () => undefined,
  clearPublisherHandoff: vi.fn(), requestPublisherHandoff: vi.fn(),
  subscribePublisherHandoff: () => () => {},
}))
vi.mock('../src/client/tips.tsx', () => ({
  PublisherTipsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../src/client/draft-gallery.tsx', () => ({
  DraftGallery: ({ active, contentType, onCreate, onOpen }: {
    active: boolean; contentType: PublisherContentType; onCreate(): void; onOpen(id: string): void
  }) => active ? <>
    <button type="button" onClick={onCreate}>新建草稿</button>
    <button type="button" onClick={() => onOpen(`${contentType}-existing`)}>打开已有草稿</button>
  </> : null,
}))
const editor = ({ active, selectedContentId }: { active: boolean; selectedContentId: string }) => active
  ? <div data-editing-id={selectedContentId}>编辑草稿</div> : null
vi.mock('../src/client/content.tsx', () => ({ ContentEditor: (props: any) => editor(props) }))
vi.mock('../src/client/video.tsx', () => ({ VideoPage: (props: any) => editor(props) }))

const request = vi.fn()
let container: HTMLDivElement
let root: Root | undefined

function response(contentType: PublisherContentType = 'article') {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ id: `${contentType}-created`, contentType }),
  }
}

async function renderPublisher(type: PublisherContentType = 'article') {
  localStorage.setItem('cqai-publisher-content-type', type)
  container = document.createElement('div')
  document.body.append(container)
  let Page: (() => ReactNode) | undefined
  const list = { subscribe: () => () => {}, getSnapshot: () => ({ phase: 'ready', ids: [], items: [], archivedSessionIds: [] }) }
  apply({
    sessions: { list }, workspaces: { list }, uiWorkspace: {}, layout: {},
    slots: {
      inject: (_slot: string, callback: () => void) => callback(),
      register: (options: { name: string; key?: string }, renderer: () => ReactNode) => {
        if (options.name === 'main' && options.key === 'cqai-publisher') Page = renderer
        return () => {}
      },
    },
    effect: (callback: () => void) => callback(),
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { active: () => undefined, openTab: vi.fn() },
  } as never)
  if (!Page) throw new Error('Publisher main panel was not registered')
  const RegisteredPage = Page
  root = createRoot(container)
  await act(async () => { root!.render(<RegisteredPage/>) })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!found) throw new Error(`Button not found: ${label}`)
  return found
}

async function click(label: string) {
  await act(async () => { button(label).click() })
}

async function name(value: string) {
  const input = container.querySelector('[role="dialog"] input') as HTMLInputElement
  if (!input) throw new Error('Task name input was not found')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  request.mockReset()
  request.mockResolvedValue(response())
  vi.stubGlobal('fetch', request)
  localStorage.clear()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  vi.unstubAllGlobals()
})

describe('new Publisher draft task name', () => {
  it.each(['article', 'image-note', 'video'] as const)('posts the trimmed name for a %s draft and selects the result', async type => {
    request.mockResolvedValue(response(type))
    await renderPublisher(type)
    await click('新建草稿')
    expect(request).not.toHaveBeenCalled()
    const input = container.querySelector('input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.maxLength).toBe(TITLE_MAX)
    expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('任务名称（可选）')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(button('创建草稿').form).toBe(container.querySelector('form'))
    await name('  重庆周末徒步攻略  ')
    await click('创建草稿')
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(`${API}/contents`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ejianbao': '1' },
      body: JSON.stringify({ contentType: type, title: '重庆周末徒步攻略' }),
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[data-editing-id]')?.getAttribute('data-editing-id')).toBe(`${type}-created`)
  })

  it('cancels without creating a draft and preserves opening an existing draft', async () => {
    await renderPublisher()
    const trigger = button('新建草稿')
    trigger.focus()
    await click('新建草稿')
    await name('取消的任务')
    await click('取消')
    expect(request).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await click('打开已有草稿')
    expect(container.querySelector('[data-editing-id]')?.getAttribute('data-editing-id')).toBe('article-existing')
  })

  it('omits an empty name so the server can choose the type and date default', async () => {
    await renderPublisher()
    await click('新建草稿')
    await name('   ')
    await click('创建草稿')
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ contentType: 'article' })
  })

  it('keeps the task name and shows a creation failure inside the dialog for retry', async () => {
    request.mockRejectedValueOnce(new Error('项目根目录不可用'))
    await renderPublisher()
    await click('新建草稿')
    await name('徒步文章')
    await click('创建草稿')
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('项目根目录不可用')
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('徒步文章')
    expect(button('创建草稿').disabled).toBe(false)
    await click('创建草稿')
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ contentType: 'article', title: '徒步文章' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('locks repeated form submissions and closing while creation is pending', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void
    request.mockReturnValue(new Promise<ReturnType<typeof response>>(done => { resolve = done }))
    await renderPublisher()
    await click('新建草稿')
    await name('一次创建')
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(request).toHaveBeenCalledOnce()
    expect(button('正在创建…').disabled).toBe(true)
    expect(button('取消').disabled).toBe(true)
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('true')
    await click('关闭')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      resolve(response())
    })
    expect(request).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
