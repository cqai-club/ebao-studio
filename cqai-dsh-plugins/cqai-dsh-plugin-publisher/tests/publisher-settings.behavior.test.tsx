// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PublisherSettings } from '../src/client/publisher-settings.tsx'
import { api } from '../src/client/shared.tsx'

vi.mock('../src/client/shared.tsx', () => ({
  api: vi.fn(),
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}))

const queryApi = api as unknown as Mock
let container: HTMLDivElement
let root: Root

async function renderSettings() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(<PublisherSettings/>) })
}

async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => { button.click() })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  queryApi.mockReset()
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

describe('Publisher project settings', () => {
  it('chooses a folder and persists it as the root for future projects', async () => {
    queryApi.mockImplementation((route: string, body?: unknown) => {
      if (route === 'project-settings' && body === undefined) return Promise.resolve({ defaultRoot: '/default/projects', isCustom: false })
      if (route === 'project-settings') return Promise.resolve({ defaultRoot: '/selected/projects', isCustom: true })
      throw new Error(`Unexpected route: ${route}`)
    })
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ path: '/selected/projects' }) }))
    vi.stubGlobal('fetch', fetch)
    await renderSettings()
    expect((container.querySelector('#pub-project-root') as HTMLInputElement).value).toBe('/default/projects')

    await click('选择文件夹')
    expect(fetch).toHaveBeenCalledWith('/_dsh/desktop/pick-directory', {
      method: 'POST', headers: { accept: 'application/json' },
    })
    expect((container.querySelector('#pub-project-root') as HTMLInputElement).value).toBe('/selected/projects')
    await click('保存设置')
    expect(queryApi).toHaveBeenCalledWith('project-settings', { defaultRoot: '/selected/projects' })
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已保存')
    expect((container.querySelector('.pub-settings-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the old root visible when saving the chosen directory fails', async () => {
    queryApi.mockImplementation((route: string, body?: unknown) => body === undefined
      ? Promise.resolve({ defaultRoot: '/default/projects', isCustom: false })
      : Promise.reject(new Error('项目根目录不可用')))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ path: '/missing/projects' }) })))
    await renderSettings()
    await click('选择文件夹')
    await click('保存设置')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('项目根目录不可用')
    expect((container.querySelector('#pub-project-root') as HTMLInputElement).value).toBe('/missing/projects')
  })
})
