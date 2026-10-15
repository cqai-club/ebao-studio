// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PublisherAccount, PublisherContent, PublisherPlatformCapability } from '../src/protocol.ts'
import { ContentEditor } from '../src/client/content.tsx'
import { VideoPage } from '../src/client/video.tsx'
import { PublisherTipsProvider } from '../src/client/tips.tsx'
import { api } from '../src/client/shared.tsx'
import { applyContentPatch } from '../src/client/content-patch.ts'
import type { PublisherContentPatch } from '../src/protocol.ts'

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
  ConfirmDialog: ({ onCancel, onConfirm, targetSummaries, mode }: any) => <div role="dialog" aria-label="确认提交">
    <span>{mode}</span><div data-testid="confirmed-summary">{Object.values(targetSummaries ?? {}).join('、')}</div>
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
    if (route === 'content-patch') {
      const current = drafts.get(String(payload?.id))!
      const saved = { ...applyContentPatch(current, payload?.patch as PublisherContentPatch), revision: current.revision + 1, updatedAt: '2026-09-25T00:01:00.000Z' }
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
  it.each(['article', 'image-note'] as const)('collapses %s source requirements below the project directory and saves edits before returning', async contentType => {
    const content = draft(`${contentType}-origin`, contentType)
    apiFor([content])
    const origin = { handoffId: '11111111-1111-4111-8111-111111111111', contentId: content.id,
      title: '重庆分享', excerpt: '真实素材分享', platforms: ['xhs'], creationBrief: '根据真实素材创作图文分享',
      source: { kind: 'creation-brief', sessionId: 'ordinary-source', requestId: 'real-user', sourceId: 'source', revision: 'version' },
      sourceChanged: false, sourceAvailable: true, sourceSessionAvailable: true }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true,
      json: async () => url.includes('/article-origin/') ? origin : { apps: ['finder'] } })))
    const onReturn = vi.fn(async () => {})
    await render(<ContentEditor contentType={contentType} active selectedContentId={content.id} onReturnToSource={onReturn} onBack={vi.fn()}/>)
    const source = container!.querySelector<HTMLDetailsElement>('[aria-label="文章来源"]')!
    expect(source).not.toBeNull()
    expect(source.parentElement).toBe(container!.querySelector('.pub-grid > div:last-child'))
    expect(source.previousElementSibling).toBe(container!.querySelector('.pub-project-directory'))
    expect(source.open).toBe(false)
    await act(async () => { source.querySelector('summary')!.click() })
    expect(source.open).toBe(true)
    expect(source.textContent).toContain('返回来源对话')
    expect(source.textContent).not.toContain('检查原稿更新')
    await enter(`#pub-${contentType}-body`, '手工修改后返回来源')
    const button = [...source.querySelectorAll('button')].find(item => item.textContent === '返回来源对话')!
    await act(async () => { button.click() })
    expect(queryApi).toHaveBeenCalledWith('content-patch', { id: content.id, revision: 1, patch: { body: '手工修改后返回来源' } })
    expect(onReturn).toHaveBeenCalledWith('ordinary-source', undefined)
    await click('.pub-editor-view-switch button:last-child')
    expect(container!.querySelector('[data-testid="preview"]')).not.toBeNull()
    expect(container!.querySelector('.pub-project-directory + .pub-source-card')).toBe(source)
    expect(source.open).toBe(true)
  })
  const dyAccount: PublisherAccount = { id: 'dy-1', platform: 'dy', displayName: '抖音文章账号', loginState: 'logged-in' }
  const dyCapability: PublisherPlatformCapability = { platform: 'dy', contentTypes: ['article'],
    modes: { article: ['draft', 'publish'] }, requiredFields: {} }
  async function checkDouyin(content: PublisherContent) {
    await render(<ContentEditor contentType="article" active selectedContentId={content.id} intendedPlatforms={['dy']} onBack={vi.fn()}/>)
    await click('.pub-editor-actions > button:last-child')
    await choose('#pub-target-article-dy', 'dy-1')
    await click('.pub-publish-modal .pub-mode label:first-child input')
    await click('.pub-publish-modal .mock-modal-footer button:last-child')
  }

  it('compresses the selected Douyin summary before confirmation and submits only the confirmed revision', async () => {
    const content: PublisherContent = { ...draft('compressed-article'), summary: '这是一份超过三十个字的完整原摘要，需要用模型重新组织成适合抖音的简短摘要，不能直接截断。',
      platformVariants: { dy: { title: '抖音标题' }, juejin: { summary: '掘金独立摘要' } } }
    apiFor([content], [dyAccount], [dyCapability])
    const base = queryApi.getMockImplementation()!
    const summary = '用模型压缩摘要，保留原文要点。'
    queryApi.mockImplementation(async (route, payload, signal) => {
      if (route === 'summary-compress') {
        expect(payload).toEqual({ id: content.id, revision: 1, platform: 'dy' })
        expect(signal).toBeInstanceOf(AbortSignal)
        return { generated: true, summary, content: { ...content, revision: 2,
          platformVariants: { ...content.platformVariants, dy: { ...content.platformVariants?.dy, summary } } } }
      }
      return base(route, payload)
    })
    await checkDouyin(content)
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
    expect(container!.querySelector('[data-testid="confirmed-summary"]')?.textContent).toBe(summary)
    expect(container!.querySelector('[aria-label="确认提交"]')?.textContent).toContain('publish')
    expect(content.summary).toContain('不能直接截断')
    expect(content.platformVariants?.dy?.summary).toBeUndefined()
    await click('[aria-label="确认提交"] .mock-modal-footer button:last-child')
    expect(queryApi).toHaveBeenCalledWith('submissions', expect.objectContaining({ contentId: content.id, revision: 2, mode: 'publish' }))
  })

  it('keeps the original draft and publishing settings when summary generation fails', async () => {
    const content = { ...draft('summary-failed'), summary: '摘要'.repeat(30) }
    apiFor([content], [dyAccount], [dyCapability])
    const base = queryApi.getMockImplementation()!
    queryApi.mockImplementation(async (route, payload) => {
      if (route === 'summary-compress') throw new Error('摘要模型暂不可用')
      return base(route, payload)
    })
    await checkDouyin(content)
    expect(container!.querySelector('[aria-label="确认提交"]')).toBeNull()
    expect(container!.querySelector('[aria-label="发布设置"]')).not.toBeNull()
    expect(container!.textContent).toContain('摘要模型暂不可用')
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions' || route === 'content-patch')).toBe(false)
    expect(content.summary).toBe('摘要'.repeat(30))
  })

  it('does not call the model for a Douyin summary already within the platform limit', async () => {
    const content = { ...draft('short-summary'), summary: '已有的简短摘要' }
    apiFor([content], [dyAccount], [dyCapability])
    await checkDouyin(content)
    expect(queryApi.mock.calls.some(([route]) => route === 'summary-compress' || route === 'submissions')).toBe(false)
    expect(container!.querySelector('[data-testid="confirmed-summary"]')?.textContent).toBe(content.summary)
  })

  it.each(['over-limit', 'old-revision', 'invalid-format'])('blocks an invalid compression response: %s', async issue => {
    const content = { ...draft('invalid-summary'), summary: '摘要'.repeat(30) }
    apiFor([content], [dyAccount], [dyCapability])
    const base = queryApi.getMockImplementation()!
    queryApi.mockImplementation(async (route, payload) => {
      if (route === 'summary-compress') {
        const summary = issue === 'over-limit' ? '摘'.repeat(31) : '简短摘要'
        return issue === 'invalid-format' ? { generated: true } : { generated: true, summary, content: { ...content,
          revision: issue === 'old-revision' ? 1 : 2, platformVariants: { dy: { summary } } } }
      }
      return base(route, payload)
    })
    await checkDouyin(content)
    expect(container!.querySelector('[aria-label="确认提交"]')).toBeNull()
    expect(container!.textContent).toContain('压缩后的抖音摘要未通过校验')
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
    expect(content.summary).toBe('摘要'.repeat(30))
  })

  it('aborts a late compression result after a handoff and never confirms the wrong article', async () => {
    const first = { ...draft('summary-first'), summary: '摘要'.repeat(30) }
    const second = draft('summary-second')
    apiFor([first, second], [dyAccount], [dyCapability])
    const base = queryApi.getMockImplementation()!
    const pending = deferred<unknown>()
    let compressionSignal: AbortSignal | undefined
    queryApi.mockImplementation(async (route, payload, signal) => {
      if (route === 'summary-compress') { compressionSignal = signal; return pending.promise }
      return base(route, payload)
    })
    await checkDouyin(first)
    expect(container!.textContent).toContain('正在压缩抖音摘要')
    expect(container!.querySelector<HTMLButtonElement>('.pub-publish-modal .mock-modal-footer button:last-child')?.disabled).toBe(true)
    await render(<ContentEditor contentType="article" active selectedContentId={second.id} onBack={vi.fn()}/>)
    expect(compressionSignal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ generated: true, summary: '压缩摘要', content: { ...first, revision: 2, platformVariants: { dy: { summary: '压缩摘要' } } } }) })
    expect(container!.querySelector('[aria-label="确认提交"]')).toBeNull()
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe(second.title)
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('offers Douyin article editing and confirms image adjustments as a platform draft', async () => {
    const imageId = '33333333-3333-4333-8333-333333333333'
    const content: PublisherContent = { ...draft('douyin-article'), body: `正文 ![配图](ebao-asset://${imageId})`,
      tags: ['标签'], assets: [{ id: imageId, name: '配图.png', mime: 'image/png', bytes: 12 }], coverAssetId: imageId }
    const account: PublisherAccount = { id: 'dy-1', platform: 'dy', displayName: '抖音文章账号', loginState: 'logged-in' }
    const capability: PublisherPlatformCapability = { platform: 'dy', contentTypes: ['article'],
      modes: { article: ['draft', 'publish'] }, requiredFields: {} }
    apiFor([content], [account], [capability])
    await render(<ContentEditor contentType="article" active selectedContentId={content.id} intendedPlatforms={['dy']} onBack={vi.fn()}/>)
    const dyVersion = Array.from(container!.querySelectorAll<HTMLButtonElement>('.pub-version-tab')).find(item => item.textContent === '抖音')!
    await act(async () => { dyVersion.click() })
    expect(container!.textContent).toContain('正文图片和封面不自动上传')
    expect(container!.textContent).toContain('抖音文章正文（含内容声明）最多 20000 字')
    expect(container!.textContent).toContain('独立摘要最多 30 字')
    expect(container!.querySelector<HTMLTextAreaElement>('#pub-article-summary')?.value).toBe(content.summary)
    await enter('#pub-article-summary', '抖音独立摘要')
    await click('.pub-editor-view-switch > button:last-child')
    expect(container!.textContent).toContain('独立摘要字段：抖音独立摘要')
    await click('.pub-editor-view-switch > button:first-child')
    expect(container!.querySelector<HTMLTextAreaElement>('#pub-article-summary')?.value).toBe('抖音独立摘要')
    expect(content.summary).toBe('douyin-article summary')
    await click('.pub-editor-actions > button:last-child')
    await choose('#pub-target-article-dy', 'dy-1')
    await click('.pub-publish-modal .pub-mode label:first-child input')
    expect(container!.textContent).toContain('抖音草稿手动补图')
    expect(container!.textContent).toContain('本次将转存平台草稿供核对')
    await click('.pub-publish-modal .mock-modal-footer button:last-child')
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
    await click('[role="dialog"][aria-label="确认提交"] .mock-modal-footer button:last-child')
    expect(queryApi).toHaveBeenCalledWith('submissions', expect.objectContaining({
      contentType: 'article', contentId: content.id, mode: 'draft', accountIds: ['dy-1'],
    }))
    expect(content.body).toContain(`ebao-asset://${imageId}`)
    expect(content.tags).toEqual(['标签'])
  })

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
    expect([...container!.querySelectorAll<HTMLDetailsElement>('.pub-editor-sidebar > details')].every(section => !section.open)).toBe(true)
    expect(container!.querySelector('#pub-article-summary')?.closest('details')?.querySelector('summary')?.textContent).toContain('发布信息')
    expect(container!.querySelector<HTMLSelectElement>('[aria-label="编辑版本"]')?.value).toBe('master')
    expect(container!.querySelector<HTMLDetailsElement>('.pub-editor-more')?.open).toBe(false)
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
    expect(queryApi).toHaveBeenCalledWith('content-patch', expect.objectContaining({ id: 'article-1', patch: { title: 'Edited before Agent' } }))
    expect(onToggleAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'article-1', title: 'Edited before Agent', revision: 2 }), { kind: 'main' })
  })

  it('preserves the selected platform version when reopening Agent', async () => {
    apiFor([{ ...draft('article-1'), platformVariants: { juejin: { title: '掘金专属标题' } } }], [
      { id: 'account-1', platform: 'juejin', displayName: '掘金账号', loginState: 'logged-in' },
    ])
    const onToggleAgent = vi.fn(async () => {})
    await render(<ContentEditor contentType="article" active selectedContentId="article-1"
      onToggleAgent={onToggleAgent} onBack={vi.fn()}/> )
    await click('.pub-version-tab:nth-child(2)')
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('掘金专属标题')
    await click('[aria-controls="pub-agent-drawer"]')
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('掘金专属标题')
    expect(container!.querySelector('.pub-version-tab[aria-pressed="true"]')?.textContent).toContain('掘金')
    expect(onToggleAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'article-1' }), { kind: 'platform', platform: 'juejin' })
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
      if (route === 'content-patch') return Promise.reject(new Error('草稿已在其他页面更新，请重新加载后再保存'))
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
    expect(queryApi).toHaveBeenCalledWith('content-patch', expect.objectContaining({
      id: 'article-1', patch: { title: 'Local unsaved title', body: 'Local unsaved body' },
    }))
  })

  it('starts image-note editing with image assets before title and body', async () => {
    apiFor([draft('image-1', 'image-note')])
    await render(<ContentEditor contentType="image-note" active selectedContentId="image-1" onBack={vi.fn()}/>)
    const cardTitles = Array.from(container!.querySelectorAll('.pub-grid .pub-card h2'), heading => heading.textContent)
    expect(cardTitles.slice(0, 2)).toEqual(['图片素材与排序', '图文内容'])
    expect(container!.querySelector('.pub-grid .pub-version-card .pub-version-tabs')).not.toBeNull()
    expect(container!.querySelector('.pub-grid > div:last-child > .pub-version-card + .pub-project-directory code')?.textContent).toBe('/projects/image-1')
    await click('.pub-editor-view-switch button:nth-child(2)')
    expect(container!.querySelector('[data-testid="preview"]')?.textContent).toBe('image-1 title')
    await click('.pub-editor-view-switch button:first-child')
    expect(container!.querySelector<HTMLInputElement>('#pub-image-note-title')?.value).toBe('image-1 title')
  })

  it('saves image-note edits before opening Agent and refreshes later Agent edits', async () => {
    apiFor([draft('image-1', 'image-note')])
    const onToggleAgent = vi.fn(async () => {})
    vi.useFakeTimers()
    await render(<ContentEditor contentType="image-note" active selectedContentId="image-1"
      agentOpen onToggleAgent={onToggleAgent} onBack={vi.fn()}/> )
    await enter('#pub-image-note-title', 'Local image-note title')
    await click('[aria-controls="pub-agent-drawer"]')
    expect(onToggleAgent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'image-1', contentType: 'image-note', title: 'Local image-note title', revision: 2,
    }), { kind: 'main' })
    const regularApi = queryApi.getMockImplementation()!
    queryApi.mockImplementation(async (route: string, payload?: Record<string, unknown>) => {
      if (route === 'content/image-1') return { ...draft('image-1', 'image-note'),
        title: 'Agent image-note title', revision: 3 }
      return regularApi(route, payload)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(container!.querySelector<HTMLInputElement>('#pub-image-note-title')?.value).toBe('Agent image-note title')
  })

  it('shows the selected video before its text fields while editing', async () => {
    apiFor([{ ...draft('video-1', 'video'), videoSource: { kind: 'local', localVideoId: 'local-1', fileName: 'clip.mp4', bytes: 1024 } }])
    await render(<VideoPage active selectedContentId="video-1" onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>)
    const cardTitles = Array.from(container!.querySelectorAll('.pub-video-editor-main > .pub-editor-main > .pub-card'), card => card.querySelector('h2')?.textContent)
    expect(cardTitles[0]).toContain('视频素材')
    expect(cardTitles[1]).toContain('发布内容')
    expect(container!.querySelector('.pub-editor-sidebar .pub-project-directory > summary')?.textContent).toContain('项目目录')
    expect(container!.querySelector('.pub-editor-view-switch button:first-child')?.getAttribute('aria-pressed')).toBe('true')
    expect(container!.querySelector('.pub-video-editor-main > .pub-editor-main > .pub-card:first-child video')?.getAttribute('src'))
      .toBe('/api/cqai-publisher/video-preview/local/local-1')
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('video-1 title')
  })

  it('saves video copy before opening Agent and refreshes later Agent edits', async () => {
    apiFor([draft('video-1', 'video')])
    const onToggleAgent = vi.fn(async () => {})
    vi.useFakeTimers()
    await render(<VideoPage active selectedContentId="video-1" agentOpen
      onToggleAgent={onToggleAgent} onSelectedContentChange={vi.fn()} onBack={vi.fn()}/> )
    await enter('#pub-title', 'Local video title')
    await click('[aria-controls="pub-agent-drawer"]')
    expect(onToggleAgent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'video-1', contentType: 'video', title: 'Local video title', revision: 2,
    }))
    const regularApi = queryApi.getMockImplementation()!
    queryApi.mockImplementation(async (route: string, payload?: Record<string, unknown>) => {
      if (route === 'content/video-1') return { ...draft('video-1', 'video'),
        title: 'Agent video title', description: 'Agent video description', revision: 3 }
      return regularApi(route, payload)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('Agent video title')
    expect(container!.querySelector<HTMLTextAreaElement>('#pub-description')?.value).toBe('Agent video description')
  })

  it('keeps unsaved video edits visible until the user reloads an Agent revision', async () => {
    apiFor([draft('video-1', 'video')])
    const regularApi = queryApi.getMockImplementation()!
    let remote = draft('video-1', 'video')
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) => {
      if (route === 'content/video-1') return Promise.resolve(remote)
      if (route === 'content-patch') return Promise.reject(new Error('草稿已在其他页面更新，请重新加载后再保存'))
      return regularApi(route, payload)
    })
    vi.useFakeTimers()
    await render(<VideoPage active selectedContentId="video-1" agentOpen
      onToggleAgent={vi.fn(async () => {})} onSelectedContentChange={vi.fn()} onBack={vi.fn()}/> )
    await enter('#pub-title', 'Local video title')
    remote = { ...remote, title: 'Agent video title', revision: 2 }
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('Local video title')
    expect(container!.textContent).toContain('当前未保存的修改会丢失')
    const reload = Array.from(container!.querySelectorAll('button')).find(button => button.textContent === '重新加载草稿')!
    await act(async () => { reload.click() })
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('Agent video title')
  })

  it('discards a late conflict reload after opening another video draft', async () => {
    apiFor([draft('video-1', 'video'), draft('video-2', 'video')])
    const regularApi = queryApi.getMockImplementation()!
    const pendingReload = deferred<PublisherContent>()
    let rejectSave = true
    let delayReload = false
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) => {
      if (route === 'content-patch' && rejectSave) return Promise.reject(new Error('草稿已在其他页面更新，请重新加载后再保存'))
      if (route === 'content/video-1' && delayReload) return pendingReload.promise
      return regularApi(route, payload)
    })
    const editor = (selectedContentId: string) => <VideoPage active selectedContentId={selectedContentId}
      onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>
    vi.useFakeTimers()
    await render(editor('video-1'))
    await enter('#pub-title', 'Local video title')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    const reload = Array.from(container!.querySelectorAll('button')).find(button => button.textContent === '重新加载草稿')!
    expect(reload).toBeDefined()
    delayReload = true
    rejectSave = false
    await act(async () => { reload.click() })
    await render(editor('video-2'))
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('video-2 title')
    const workReads = queryApi.mock.calls.filter(([route]) => route === 'works').length
    await act(async () => { pendingReload.resolve({ ...draft('video-1', 'video'), title: 'Late Agent title', revision: 3,
      videoSource: { kind: 'work', workId: 'old-work' } }) })
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('video-2 title')
    expect(queryApi.mock.calls.filter(([route]) => route === 'works')).toHaveLength(workReads)
    expect(container!.textContent).not.toContain('已加载最新草稿。')
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
      route === 'content-patch' ? saving.promise : regularApi(route, payload))
    const onBack = vi.fn()
    await render(<ContentEditor contentType="article" active selectedContentId="article-1" onBack={onBack}/>)
    await enter('#pub-article-title', 'Revised article')
    await click('.pub-editor-back')
    expect(queryApi).toHaveBeenCalledWith('content-patch', expect.objectContaining({ id: 'article-1', patch: { title: 'Revised article' } }))
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => { saving.resolve({ ...draft('article-1'), title: 'Revised article', revision: 2 }) })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

  it('keeps the article editor open and reports an error if the return save fails', async () => {
    apiFor([draft('article-1')])
    const regularApi = queryApi.getMockImplementation()!
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) =>
      route === 'content-patch' ? Promise.reject(new Error('disk full')) : regularApi(route, payload))
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
    await click('.pub-editor-more > summary')
    const copy = [...container!.querySelectorAll<HTMLButtonElement>('.pub-editor-more-panel button')].find(button => button.textContent === '复制')!
    await act(async () => { copy.click() })
    expect(queryApi).toHaveBeenCalledWith('content-copy', { id: 'article-1' })
    expect(onSelectedContentChange).toHaveBeenCalledWith('article-1-copy')
    await render(editor('article-1-copy'))
    await click('.pub-editor-more > summary')
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
    expect(container!.querySelector('.pub-video-editor-main > .pub-editor-main > .pub-card:first-child h2')?.textContent).toContain('视频素材')
    await click('.pub-editor-view-switch button:nth-child(2)')
    expect(container!.querySelector('[data-testid="preview"]')?.textContent).toBe('video-1 title')
    expect(container!.querySelector('#pub-title')).toBeNull()
    expect(container!.querySelector('.pub-video-editor-main .pub-card')).not.toBeNull()
    await click('.pub-editor-view-switch button:first-child')
    await enter('#pub-title', 'Revised video')
    await click('.pub-editor-back')
    expect(queryApi).toHaveBeenCalledWith('content-patch', expect.objectContaining({ id: 'video-1', patch: { title: 'Revised video' } }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(queryApi.mock.calls.some(([route]) => route === 'contents' || route === 'contents-query' || route === 'submissions')).toBe(false)

    const regularApi = queryApi.getMockImplementation()!
    queryApi.mockImplementation((route: string, payload?: Record<string, unknown>) =>
      route === 'content-patch' ? Promise.reject(new Error('disk full')) : regularApi(route, payload))
    await enter('#pub-title', 'Unsaved video')
    await click('.pub-editor-back')
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(container!.querySelector<HTMLInputElement>('#pub-title')?.value).toBe('Unsaved video')
    expect(container!.textContent).toContain('自动保存失败')
  })
  it.each(['article', 'image-note', 'video'] as const)('merges %s local fields into the latest Agent draft and uses the last save for the same field', async type => {
    const id = `${type}-concurrent`
    let remote = draft(id, type)
    apiFor([remote])
    const base = queryApi.getMockImplementation()!
    queryApi.mockImplementation(async (route, payload) => {
      if (route === `content/${id}`) return remote
      if (route === 'content-patch') {
        remote = { ...applyContentPatch(remote, payload.patch), revision: remote.revision + 1 }
        return remote
      }
      return base(route, payload)
    })
    vi.useFakeTimers()
    await render(type === 'video' ? <VideoPage active selectedContentId={id} agentOpen onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>
      : <ContentEditor contentType={type} active selectedContentId={id} agentOpen onBack={vi.fn()}/>)
    const titleId = type === 'video' ? '#pub-title' : `#pub-${type}-title`
    await enter(titleId, 'Manual last title')
    remote = { ...remote, title: 'Agent earlier title', body: 'Agent body', description: 'Agent description', tags: ['agent'], platformVariants: { juejin: { summary: 'Agent platform summary' } }, revision: 2 }
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(queryApi).toHaveBeenCalledWith('content-patch', { id, revision: 1, patch: { title: 'Manual last title' } })
    expect(remote).toMatchObject({ title: 'Manual last title', body: 'Agent body', description: 'Agent description', tags: ['agent'], platformVariants: { juejin: { summary: 'Agent platform summary' } } })
    expect(container!.querySelector<HTMLInputElement>(titleId)?.value).toBe('Manual last title')
    expect(container!.textContent).not.toContain('自动保存失败')
    remote = { ...remote, title: 'Agent newest title', revision: 4 }
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(container!.querySelector<HTMLInputElement>(titleId)?.value).toBe('Agent newest title')
  })

  it('saves only the selected platform field and rebinds its target while keeping preview', async () => {
    let remote: PublisherContent = { ...draft('platform-patch'), platformVariants: { juejin: { title: 'Initial platform' } } }
    apiFor([remote], [{ id: 'juejin-one', platform: 'juejin', displayName: '掘金', loginState: 'logged-in' }])
    const base = queryApi.getMockImplementation()!
    queryApi.mockImplementation(async (route, payload) => {
      if (route === 'content/platform-patch') return remote
      if (route === 'content-patch') return remote = { ...applyContentPatch(remote, payload.patch), revision: remote.revision + 1 }
      return base(route, payload)
    })
    const onAgentTargetChange = vi.fn(async () => {})
    const onDraftReady = vi.fn()
    vi.useFakeTimers()
    await render(<ContentEditor contentType="article" active selectedContentId="platform-patch" agentOpen onAgentTargetChange={onAgentTargetChange} onDraftReady={onDraftReady} onBack={vi.fn()}/>)
    expect(onDraftReady).toHaveBeenCalledOnce()
    await click('.pub-version-tab:nth-child(2)')
    expect(onAgentTargetChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'platform-patch' }), { kind: 'platform', platform: 'juejin' })
    await enter('#pub-article-title', 'Manual platform title')
    remote = { ...remote, revision: 2, body: 'Agent main body', platformVariants: { juejin: { title: 'Initial platform', summary: 'Agent platform summary' } } }
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(queryApi).toHaveBeenCalledWith('content-patch', { id: 'platform-patch', revision: 1, patch: { platformVariants: { juejin: { title: 'Manual platform title' } } } })
    expect(remote.title).toBe('platform-patch title')
    expect(remote.platformVariants?.juejin).toEqual({ title: 'Manual platform title', summary: 'Agent platform summary' })
    await click('.pub-editor-view-switch button:nth-child(2)')
    await click('.pub-version-tab:first-child')
    expect(container!.querySelector('[data-testid="preview"]')?.textContent).toBe('platform-patch title')
    expect(onAgentTargetChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'platform-patch' }), { kind: 'main' })
    expect(onDraftReady).toHaveBeenCalledOnce()
  })

  it('asks before restarting an article conversation and saves content without deleting it', async () => {
    apiFor([draft('restart')])
    const onRestartAgent = vi.fn(async () => {})
    await render(<ContentEditor contentType="article" active selectedContentId="restart" onRestartAgent={onRestartAgent} onBack={vi.fn()}/>)
    await enter('#pub-article-title', 'Keep this title')
    const restart = Array.from(container!.querySelectorAll('button')).find(button => button.textContent === '重新开始对话')!
    await act(async () => { restart.click() })
    expect(onRestartAgent).not.toHaveBeenCalled()
    await click('[aria-label="重新开始对话"] .mock-modal-footer button:last-child')
    expect(onRestartAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'restart', title: 'Keep this title', revision: 2 }), { kind: 'main' })
    expect(container!.querySelector<HTMLInputElement>('#pub-article-title')?.value).toBe('Keep this title')
    expect(queryApi.mock.calls.some(([route]) => route === 'content-delete')).toBe(false)
  })

  it.each(['article', 'image-note', 'video'] as const)('preserves %s in-flight input and ignores an older save response after a newer Agent snapshot', async type => {
    const id = `${type}-delayed`
    const original = draft(id, type)
    apiFor([original])
    const base = queryApi.getMockImplementation()!
    const reading = deferred<PublisherContent>()
    const saving = deferred<PublisherContent>()
    let reads = 0
    queryApi.mockImplementation((route, payload) => {
      if (route === `content/${id}` && ++reads > 1) return reading.promise
      if (route === 'content-patch') return saving.promise
      return base(route, payload)
    })
    vi.useFakeTimers()
    await render(type === 'video' ? <VideoPage active selectedContentId={id} agentOpen onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>
      : <ContentEditor contentType={type} active selectedContentId={id} agentOpen onBack={vi.fn()}/>)
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    const titleId = type === 'video' ? '#pub-title' : `#pub-${type}-title`
    const bodyId = type === 'video' ? '#pub-description' : `#pub-${type}-body`
    await enter(titleId, 'Manual in-flight title')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(queryApi).toHaveBeenCalledWith('content-patch', { id, revision: 1, patch: { title: 'Manual in-flight title' } })
    await act(async () => { reading.resolve({ ...original, title: 'Agent latest title', body: 'Agent latest body', description: 'Agent latest description', revision: 3 }) })
    expect(container!.querySelector<HTMLInputElement>(titleId)?.value).toBe('Manual in-flight title')
    expect(container!.querySelector<HTMLTextAreaElement>(bodyId)?.value).toBe(type === 'video' ? 'Agent latest description' : 'Agent latest body')
    await act(async () => { saving.resolve({ ...original, title: 'Manual in-flight title', revision: 2 }) })
    expect(container!.querySelector<HTMLInputElement>(titleId)?.value).toBe('Agent latest title')
    expect(container!.querySelector<HTMLTextAreaElement>(bodyId)?.value).toBe(type === 'video' ? 'Agent latest description' : 'Agent latest body')
    expect(queryApi.mock.calls.filter(([route]) => route === 'content-patch')).toHaveLength(1)
  })

  it.each(['article', 'image-note', 'video'] as const)('opens the requested %s preview or publishing settings without submitting', async type => {
    const content = draft(`${type}-shortcut`, type)
    apiFor([content])
    const editor = (initialMode: 'preview' | 'publish') => type === 'video'
      ? <VideoPage active selectedContentId={content.id} initialMode={initialMode} onSelectedContentChange={vi.fn()} onBack={vi.fn()}/>
      : <ContentEditor contentType={type} active selectedContentId={content.id} initialMode={initialMode} onBack={vi.fn()}/>
    await render(editor('preview'))
    expect(container!.querySelector('[data-testid="preview"]')).not.toBeNull()
    await render(editor('publish'))
    expect(container!.querySelector('[role="dialog"][aria-label="发布设置"]')).not.toBeNull()
    expect(queryApi.mock.calls.some(([route]) => route === 'submissions')).toBe(false)
  })

})
