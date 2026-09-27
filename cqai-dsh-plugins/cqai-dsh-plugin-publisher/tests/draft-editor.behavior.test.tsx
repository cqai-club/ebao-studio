// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherAccount, PublisherContent, PublisherPlatformCapability } from '../src/protocol.ts'
import { ContentEditor } from '../src/client/content.tsx'
import { VideoPage } from '../src/client/video.tsx'
import { PublisherTipsProvider } from '../src/client/tips.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button type="button" {...props}>{children}</button>,
  Input: (props: any) => <input {...props}/>,
  Menu: ({ anchor }: any) => anchor,
  IconChevronDownOutlineMedium: () => <span aria-hidden="true">⌄</span>,
}))

vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(),
  capabilityMessage: (capability?: { supported: boolean }) => capability?.supported ? '' : '正在检查发布能力…',
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '操作失败',
  STATEMENT_LABELS: { none: '不声明' },
  uploadAsset: vi.fn(),
  ConfirmDialog: ({ onCancel, onConfirm }: any) => <div role="dialog" aria-label="确认提交">
    <div className="mock-modal-footer"><button type="button" onClick={onCancel}>返回修改</button><button type="button" onClick={onConfirm}>确认提交</button></div>
  </div>,
  PlatformAccountSelect: ({ idPrefix, platform, accounts, value, onChange }: any) => <select
    id={`pub-target-${idPrefix}-${platform}`} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">不发布</option>
    {accounts.filter((account: PublisherAccount) => account.platform === platform).map((account: PublisherAccount) =>
      <option key={account.id} value={account.id}>{account.displayName}</option>)}
  </select>,
  PublisherModal: ({ open, title, description, footer, children, className }: any) => open
    ? <div role="dialog" aria-label={title} className={className}><h3>{title}</h3><p>{description}</p>{children}<div className="mock-modal-footer">{footer}</div></div> : null,
}))

vi.mock('../src/client/content-preview.tsx', () => ({
  PublisherContentPreview: ({ content, videoPreviewUrl }: { content: PublisherContent; videoPreviewUrl?: string }) =>
    <div data-testid="preview">{content.title}{videoPreviewUrl && <video src={videoPreviewUrl}/>}</div>,
  AssetPreviewImage: () => null,
  contentAssetUrl: () => '/asset',
}))

const queryApi = api as unknown as Mock
let root: Root | undefined
let container: HTMLDivElement | undefined

function draft(id: string, contentType: PublisherContent['contentType'] = 'article'): PublisherContent {
  return {
    id, contentType, revision: 1, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
    title: `${id} title`, body: `${id} body`, summary: `${id} summary`, description: `${id} description`,
    tags: [], creativeStatement: 'none', assets: [], platformFields: {},
  }
}

function apiFor(contents: PublisherContent[], accounts: PublisherAccount[] = [], capabilities: PublisherPlatformCapability[] = []) {
  const drafts = new Map(contents.map(item => [item.id, item]))
  queryApi.mockImplementation(async (route: string, payload?: Record<string, unknown>) => {
    if (route === 'capability') return { supported: true, running: true }
    if (route === 'accounts') return accounts
    if (route === 'platform-capabilities') return capabilities
    if (route === 'works') return []
    if (route === 'project-workspace') return { contentId: payload?.contentId, path: `/projects/${String(payload?.contentId)}` }
    if (route.startsWith('content/')) return drafts.get(route.slice('content/'.length))
    if (route === 'content-save') {
      const current = drafts.get(String(payload?.id))!
      const saved = { ...current, ...payload, revision: current.revision + 1, updatedAt: '2026-09-25T00:01:00.000Z' }
      drafts.set(saved.id, saved)
      return saved
    }
    if (route === 'content-copy') {
      const original = drafts.get(String(payload?.id))!
      const copy = { ...original, id: `${original.id}-copy`, revision: 1 }
      drafts.set(copy.id, copy)
      return copy
    }
    if (route === 'content-delete') {
      drafts.delete(String(payload?.id))
      return undefined
    }
    if (route === 'submissions') return { submission: { mode: payload?.mode } }
    throw new Error(`Unexpected Publisher API route: ${route}`)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function render(node: ReactNode) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => { root!.render(<PublisherTipsProvider>{node}</PublisherTipsProvider>) })
}

async function click(selector: string) {
  const button = container!.querySelector<HTMLButtonElement>(selector)
  expect(button, `missing button ${selector}`).not.toBeNull()
  await act(async () => { button!.click() })
}

async function enter(selector: string, value: string) {
  const input = container!.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(input, `missing input ${selector}`).not.toBeNull()
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function choose(selector: string, value: string) {
  const select = container!.querySelector<HTMLSelectElement>(selector)
  expect(select, `missing select ${selector}`).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select!.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ apps: ['finder', 'vscode', 'terminal'] }) })))
  queryApi.mockReset()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('draft editor navigation', () => {
  it('opens the exact requested article and reloads a later handoff by ID without listing drafts', async () => {
    apiFor([draft('first'), draft('handoff')])
    const onBack = vi.fn()
    const editor = (selectedContentId: string) => <ContentEditor contentType="article" active selectedContentId={selectedContentId} onBack={onBack}/>
    await render(editor('first'))
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('first title')
    expect(container!.querySelector('[data-testid="preview"]')).toBeNull()
    await render(editor('handoff'))
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('handoff title')
    expect(queryApi.mock.calls.filter(([route]) => String(route).startsWith('content/')).map(([route]) => route)).toEqual([
      'content/first', 'content/handoff',
    ])
    expect(queryApi.mock.calls.some(([route]) => route === 'contents' || route === 'contents-query')).toBe(false)
  })

  it('starts article editing at the content card and switches preview from the toolbar', async () => {
    apiFor([draft('article-1')])
    await render(<ContentEditor contentType="article" active selectedContentId="article-1" onBack={vi.fn()}/>)
    expect(container!.querySelector('.pub-grid > div:first-child > .pub-card:first-child h2')?.textContent).toBe('文章内容')
    expect(container!.querySelector('.pub-grid .pub-version-card .pub-version-tabs')).not.toBeNull()
    expect(container!.querySelector('.pub-grid > div:last-child > .pub-version-card + .pub-project-directory code')?.textContent).toBe('/projects/article-1')
    expect(container!.querySelector('.pub-editor-view-switch button:first-child')?.getAttribute('aria-pressed')).toBe('true')
    await click('.pub-editor-view-switch button:nth-child(2)')
    expect(container!.querySelector('[data-testid="preview"]')?.textContent).toBe('article-1 title')
    expect(container!.querySelector('#pub-article-title')).toBeNull()
    await click('.pub-editor-view-switch button:first-child')
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('article-1 title')
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('saves local article edits before opening the Agent drawer', async () => {
    apiFor([draft('article-1')])
    const onToggleAgent = vi.fn(async () => {})
    await render(<ContentEditor contentType="article" active selectedContentId="article-1"
      onToggleAgent={onToggleAgent} onBack={vi.fn()}/> )
    await enter('#pub-article-title', 'Edited before Agent')
    await click('[aria-controls="pub-agent-drawer"]')
    expect(queryApi).toHaveBeenCalledWith('content-save', expect.objectContaining({ id: 'article-1', title: 'Edited before Agent' }))
    expect(onToggleAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'article-1', title: 'Edited before Agent', revision: 2 }))
  })

  it('returns to the main article before the Agent edits it', async () => {
    apiFor([{ ...draft('article-1'), platformVariants: { juejin: { title: '掘金专属标题' } } }], [
      { id: 'account-1', platform: 'juejin', displayName: '掘金账号', loginState: 'logged-in' },
    ])
    const onToggleAgent = vi.fn(async () => {})
    await render(<ContentEditor contentType="article" active selectedContentId="article-1"
      onToggleAgent={onToggleAgent} onBack={vi.fn()}/> )
    await click('.pub-version-tab:nth-child(2)')
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('掘金专属标题')
    await click('[aria-controls="pub-agent-drawer"]')
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('article-1 title')
    expect(container!.querySelector('.pub-version-tab[aria-pressed="true"]')?.textContent).toBe('主稿')
    expect(onToggleAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'article-1' }))
  })

  it('refreshes the visible article after the Agent saves a newer revision', async () => {
    apiFor([draft('article-1')])
    const regularApi = queryApi.getMockImplementation()!
    let remote = draft('article-1')
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) =>
      route === 'content/article-1' ? Promise.resolve(remote) : regularApi(route, payload))
    vi.useFakeTimers()
    await render(<ContentEditor contentType="article" active selectedContentId="article-1"
      agentOpen onToggleAgent={vi.fn(async () => {})} onBack={vi.fn()}/> )
    remote = { ...remote, title: 'Agent saved title', revision: 2 }
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('Agent saved title')
  })

  it('keeps unsaved local edits visible when an Agent revision wins the save race', async () => {
    apiFor([draft('article-1')])
    const regularApi = queryApi.getMockImplementation()!
    let remote = draft('article-1')
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) => {
      if (route === 'content/article-1') return Promise.resolve(remote)
      if (route === 'content-save') return Promise.reject(new Error('草稿已在其他页面更新，请重新加载后再保存'))
      return regularApi(route, payload)
    })
    vi.useFakeTimers()
    await render(<ContentEditor contentType="article" active selectedContentId="article-1"
      agentOpen onToggleAgent={vi.fn(async () => {})} onBack={vi.fn()}/> )
    await enter('#pub-article-title', 'Local unsaved title')
    await enter('#pub-article-body', 'Local unsaved body')
    remote = { ...remote, title: 'Agent saved title', body: 'Agent saved body', revision: 2 }
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('Local unsaved title')
    expect(container!.querySelector<HTMLTextAreaElement>('#pub-article-body')?.value).toBe('Local unsaved body')
    expect(container!.textContent).toContain('当前未保存的修改会丢失')
    expect(queryApi).toHaveBeenCalledWith('content-save', expect.objectContaining({
      id: 'article-1', title: 'Local unsaved title', body: 'Local unsaved body',
    }))
  })

  it('starts image-note editing with image assets before title and body', async () => {
    apiFor([draft('image-1', 'image-note')])
    await render(<ContentEditor contentType="image-note" active selectedContentId="image-1" onBack={vi.fn()}/>)
    const cardTitles = Array.from(container!.querySelectorAll('.pub-grid .pub-card > h2'), heading => heading.textContent)
    expect(cardTitles.slice(0, 2)).toEqual(['图片素材与排序', '图文内容'])
    expect(container!.querySelector('.pub-grid .pub-version-card .pub-version-tabs')).not.toBeNull()
    expect(container!.querySelector('.pub-grid > div:last-child > .pub-version-card + .pub-project-directory code')?.textContent).toBe('/projects/image-1')
    await click('.pub-editor-view-switch button:nth-child(2)')
    expect(container!.querySelector('[data-testid="preview"]')?.textContent).toBe('image-1 title')
    await click('.pub-editor-view-switch button:first-child')
    expect(container!.querySelector<HTMLInputElement>('#pub-image-note-title')?.value).toBe('image-1 title')
  })

  it('shows the selected video before its text fields while editing', async () => {
    apiFor([{ ...draft('video-1', 'video'), videoSource: { kind: 'local', localVideoId: 'local-1', fileName: 'clip.mp4', bytes: 1024 } }])
    await render(<VideoPage active selectedContentId="video-1" onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>)
    const cardTitles = Array.from(container!.querySelectorAll('.pub-video-editor-main > .pub-card'), card => card.querySelector('h2')?.textContent)
    expect(cardTitles[0]).toContain('选择视频素材')
    expect(cardTitles[1]).toContain('发布内容')
    expect(cardTitles[2]).toBe('项目目录')
    expect(container!.querySelector('.pub-editor-view-switch button:first-child')?.getAttribute('aria-pressed')).toBe('true')
    expect(container!.querySelector('.pub-video-editor-main > .pub-card:first-child video')?.getAttribute('src'))
      .toBe('/api/cqai-publisher/video-preview/local/local-1')
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('video-1 title')
  })

  it('opens article publishing settings, keeps account and mode when returning from confirmation, and submits only on final confirmation', async () => {
    const account: PublisherAccount = { id: 'blbl-1', platform: 'blbl', displayName: '专栏账号', loginState: 'logged-in' }
    const capability: PublisherPlatformCapability = { platform: 'blbl', contentTypes: ['article'], modes: { article: ['draft', 'publish'] }, requiredFields: { article: [] } }
    apiFor([draft('article-1')], [account], [capability])
    await render(<ContentEditor contentType="article" active selectedContentId="article-1" onBack={vi.fn()}/>)
    expect(container!.querySelector('#pub-target-article-blbl')).toBeNull()
    await click('.pub-editor-actions > button:last-child')
    expect(container!.querySelector('[role="dialog"][aria-label="发布设置"]')).not.toBeNull()
    expect(container!.querySelector<HTMLButtonElement>('.pub-publish-modal .mock-modal-footer button:last-child')?.disabled).toBe(true)
    await choose('#pub-target-article-blbl', 'blbl-1')
    await click('.pub-publish-modal .pub-mode label:first-child input')
    expect(container!.querySelector<HTMLButtonElement>('.pub-publish-modal .mock-modal-footer button:last-child')?.disabled).toBe(false)
    await click('.pub-publish-modal .mock-modal-footer button:last-child')
    expect(container!.querySelector('[role="dialog"][aria-label="确认提交"]')).not.toBeNull()
    expect(container!.querySelector('.pub-publish-modal')).toBeNull()
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
    await click('[role="dialog"][aria-label="确认提交"] .mock-modal-footer button:first-child')
    expect(container!.querySelector<HTMLSelectElement>('#pub-target-article-blbl')?.value).toBe('blbl-1')
    expect(container!.querySelector<HTMLInputElement>('.pub-publish-modal .pub-mode label:first-child input')?.checked).toBe(true)
    await click('.pub-publish-modal .mock-modal-footer button:last-child')
    await click('[role="dialog"][aria-label="确认提交"] .mock-modal-footer button:last-child')
    expect(queryApi.mock.calls.filter(([route]) => route === 'submissions')).toHaveLength(1)
    expect(queryApi).toHaveBeenCalledWith('submissions', expect.objectContaining({ contentType: 'article', mode: 'publish', accountIds: ['blbl-1'] }))
  })

  it('shows image-note account and submission mode only inside publishing settings', async () => {
    const account: PublisherAccount = { id: 'xhs-1', platform: 'xhs', displayName: '图文账号', loginState: 'logged-in' }
    apiFor([draft('image-1', 'image-note')], [account])
    await render(<ContentEditor contentType="image-note" active selectedContentId="image-1" onBack={vi.fn()}/>)
    expect(container!.querySelector('#pub-target-image-note-xhs')).toBeNull()
    await click('.pub-editor-actions > button:last-child')
    await choose('#pub-target-image-note-xhs', 'xhs-1')
    expect(container!.querySelector('.pub-publish-modal .pub-mode')).not.toBeNull()
    await click('.pub-publish-modal .mock-modal-footer button:first-child')
    expect(container!.querySelector('#pub-target-image-note-xhs')).toBeNull()
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('opens video publishing settings from the toolbar and returns to them from confirmation', async () => {
    const account: PublisherAccount = { id: 'dy-1', platform: 'dy', displayName: '视频账号', loginState: 'logged-in' }
    apiFor([{ ...draft('video-1', 'video'), videoSource: { kind: 'local', localVideoId: 'local-1', fileName: 'clip.mp4', bytes: 1024 } }], [account])
    await render(<VideoPage active selectedContentId="video-1" onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>)
    expect(container!.querySelector('#pub-target-dy')).toBeNull()
    await click('.pub-editor-actions > button:last-child')
    await choose('#pub-target-dy', 'dy-1')
    expect(container!.querySelector('.pub-publish-modal .pub-mode')).not.toBeNull()
    await click('.pub-publish-modal .mock-modal-footer button:last-child')
    expect(container!.querySelector('[role="dialog"][aria-label="确认提交"]')).not.toBeNull()
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
    await click('[role="dialog"][aria-label="确认提交"] .mock-modal-footer button:first-child')
    expect(container!.querySelector<HTMLSelectElement>('#pub-target-dy')?.value).toBe('dy-1')
  })

  it('saves an edited article before returning to the card list', async () => {
    apiFor([draft('article-1')])
    const regularApi = queryApi.getMockImplementation()!
    const saving = deferred<PublisherContent>()
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) =>
      route === 'content-save' ? saving.promise : regularApi(route, payload))
    const onBack = vi.fn()
    await render(<ContentEditor contentType="article" active selectedContentId="article-1" onBack={onBack}/>)
    await enter('#pub-article-title', 'Revised article')
    await click('.pub-editor-back')
    expect(queryApi).toHaveBeenCalledWith('content-save', expect.objectContaining({ id: 'article-1', title: 'Revised article' }))
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => { saving.resolve({ ...draft('article-1'), title: 'Revised article', revision: 2 }) })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('keeps the article editor open and reports an error if the return save fails', async () => {
    apiFor([draft('article-1')])
    const regularApi = queryApi.getMockImplementation()!
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) =>
      route === 'content-save' ? Promise.reject(new Error('disk full')) : regularApi(route, payload))
    const onBack = vi.fn()
    await render(<ContentEditor contentType="article" active selectedContentId="article-1" onBack={onBack}/>)
    await enter('#pub-article-title', 'Unsaved article')
    await click('.pub-editor-back')
    expect(onBack).not.toHaveBeenCalled()
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('Unsaved article')
    expect(container!.textContent).toContain('自动保存失败')
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('keeps the current article edits mounted while another content type is active', async () => {
    apiFor([draft('article-1')])
    const onBack = vi.fn()
    const editor = (active: boolean) => <ContentEditor contentType="article" active={active}
      selectedContentId="article-1" onBack={onBack}/>
    await render(editor(true))
    await enter('#pub-article-title', 'Still editing')
    await render(editor(false))
    await render(editor(true))
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('Still editing')
    expect(onBack).not.toHaveBeenCalled()
    expect(queryApi.mock.calls.some(([route]) => route === 'contents' || route === 'submissions')).toBe(false)
  })

  it('opens a copied article and deletes only the selected local copy after confirmation', async () => {
    apiFor([draft('article-1')])
    const onBack = vi.fn()
    const onSelectedContentChange = vi.fn()
    const editor = (selectedContentId: string) => <ContentEditor contentType="article" active selectedContentId={selectedContentId}
      onSelectedContentChange={onSelectedContentChange} onBack={onBack}/>
    await render(editor('article-1'))
    await click('.pub-editor-actions > button:first-of-type')
    expect(queryApi).toHaveBeenCalledWith('content-copy', { id: 'article-1' })
    expect(onSelectedContentChange).toHaveBeenCalledWith('article-1-copy')
    await render(editor('article-1-copy'))
    await click('.pub-editor-actions .pub-danger-action')
    expect(queryApi.mock.calls.some(([route]) => route === 'content-delete')).toBe(false)
    await click('[role="dialog"] .pub-danger-action')
    expect(queryApi).toHaveBeenCalledWith('content-delete', { id: 'article-1-copy' })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('loads a selected video directly, saves it on return, and leaves it open on save failure', async () => {
    apiFor([draft('video-1', 'video')])
    const onBack = vi.fn()
    const onSelectedContentChange = vi.fn()
    await render(<VideoPage active selectedContentId="video-1" onSelectedContentChange={onSelectedContentChange} onBack={onBack}/>)
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('video-1 title')
    expect(container!.querySelector('.pub-video-editor-main > .pub-card:first-child h2')?.textContent).toContain('选择视频素材')
    await click('.pub-editor-view-switch button:nth-child(2)')
    expect(container!.querySelector('[data-testid="preview"]')?.textContent).toBe('video-1 title')
    expect(container!.querySelector('#pub-title')).toBeNull()
    expect(container!.querySelector('.pub-video-editor-main .pub-card')).not.toBeNull()
    await click('.pub-editor-view-switch button:first-child')
    await enter('#pub-title', 'Revised video')
    await click('.pub-editor-back')
    expect(queryApi).toHaveBeenCalledWith('content-save', expect.objectContaining({ id: 'video-1', title: 'Revised video' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(queryApi.mock.calls.some(([route]) => route === 'contents' || route === 'contents-query' || route === 'submissions')).toBe(false)

    const regularApi = queryApi.getMockImplementation()!
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) =>
      route === 'content-save' ? Promise.reject(new Error('disk full')) : regularApi(route, payload))
    await enter('#pub-title', 'Unsaved video')
    await click('.pub-editor-back')
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('Unsaved video')
    expect(container!.textContent).toContain('自动保存失败')
  })
})
