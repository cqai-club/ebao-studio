// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { ProjectDirectoryInfo } from '../src/client/project-directory-info.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: ({ anchor, open, items, onSelect }: any) => <>{anchor}{open && <div role="menu">{items.map((item: any) => <button type="button" key={item.id} data-app={item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>}</>,
  IconChevronDownOutlineMedium: () => <span aria-hidden="true">⌄</span>,
}))

vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(),
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}))

const queryApi = api as unknown as Mock
const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input: string | URL) => {
    const route = new URL(String(input)).pathname
    if (route === '/open-in-app/apps') return { ok: true, json: async () => ({ apps: ['finder', 'vscode', 'terminal'] }) }
    if (route === '/open-in-app/open') return { ok: true, json: async () => ({ ok: true }) }
    throw new Error(`Unexpected route: ${route}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  queryApi.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

it('resolves the content-specific project directory when an old draft opens', async () => {
  queryApi.mockResolvedValue({ contentId: 'article-1', path: '/projects/article/article-1' })
  await act(async () => { root.render(<ProjectDirectoryInfo contentId="article-1"/>) })
  expect(queryApi).toHaveBeenCalledWith('project-workspace', { contentId: 'article-1' })
  expect(container.querySelector('code')?.textContent).toBe('/projects/article/article-1')
})

it('allows retry when the configured root is unavailable', async () => {
  queryApi.mockRejectedValueOnce(new Error('项目根目录不存在')).mockResolvedValueOnce({ contentId: 'video-1', path: '/projects/video/video-1' })
  await act(async () => { root.render(<ProjectDirectoryInfo contentId="video-1"/>) })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('项目根目录不存在')
  const retry = container.querySelector<HTMLButtonElement>('.pub-project-directory-retry')
  await act(async () => { retry!.click() })
  expect(queryApi).toHaveBeenCalledTimes(2)
  expect(container.querySelector('code')?.textContent).toBe('/projects/video/video-1')
})

it('opens the bound directory in Finder and lets the user choose another installed app', async () => {
  queryApi.mockResolvedValue({ contentId: 'article-1', path: '/projects/article/article-1' })
  await act(async () => { root.render(<ProjectDirectoryInfo contentId="article-1"/>) })
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="在访达中打开项目目录"]')!.click() })
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/open-in-app/open'), expect.objectContaining({
    method: 'POST', body: JSON.stringify({ app: 'finder', path: '/projects/article/article-1' }),
  }))
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="选择打开项目目录的应用"]')!.click() })
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-app="vscode"]')!.click() })
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/open-in-app/open'), expect.objectContaining({
    method: 'POST', body: JSON.stringify({ app: 'vscode', path: '/projects/article/article-1' }),
  }))
})
