// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasWorkspace } from '../src/client/CanvasWorkspace.tsx'
import type { ImageGenApi } from '../src/client/api.ts'
import { applyHostLocale, tt } from '../src/client/helpers.ts'
import type { CanvasAssetRef, CanvasDocument, CanvasSkillInstallRequest, CanvasSkillInstallResult, CanvasSkillLibrary } from '../src/protocol.ts'

vi.mock('../src/client/TemplateLibrary.tsx', () => ({ TemplateLibrary: () => null }))
vi.mock('../src/client/CanvasBackgrounds.tsx', () => Object.fromEntries([
  'DotFieldBackground', 'DotGridBackground', 'FaultyTerminalBackground', 'FloatingLinesBackground',
  'FlowBackground', 'GalaxyBackground', 'LiquidEtherBackground', 'ShapeGridBackground', 'SilkBackground', 'WavesBackground',
].map(name => [name, () => null])))

beforeEach(() => {
  applyHostLocale('zh-CN')
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear() })

const library: CanvasSkillLibrary = { root: '/skills', entries: [], catalog: [], networkAvailable: true }
const installedLibrary: CanvasSkillLibrary = {
  ...library,
  entries: [{ name: 'working-skill', description: '已安装的可用技能', sizeBytes: 100, updatedAt: 1 }],
}
const document: CanvasDocument = {
  version: 2, id: 'canvas-skills', title: 'Skills canvas', revision: 1,
  viewport: { x: 0, y: 0, k: 1 }, background: 'blank', nodes: [], connections: [], createdAt: 1, updatedAt: 1,
}
const asset: CanvasAssetRef = { assetId: 'skills.zip', url: '/asset/skills.zip', mime: 'application/zip', bytes: 100, width: 0, height: 0, origin: 'upload', kind: 'file', name: 'skills.zip' }
const source = 'https://github.com/example/nested-skills'

function setup() {
  const api = {
    canvasList: vi.fn(async () => [{ id: document.id, title: document.title, revision: 1, nodeCount: 0, createdAt: 1, updatedAt: 1 }]),
    canvasRead: vi.fn(async () => structuredClone(document)),
    canvasSave: vi.fn(async (next: CanvasDocument) => next),
    canvasSkillTasks: vi.fn(async () => []),
    canvasSkillsList: vi.fn(async () => ({ skills: [], installed: [] })),
    canvasSkillLibrary: vi.fn(async () => library),
    canvasFileUpload: vi.fn(async (_file: File) => asset),
    canvasSkillInstall: vi.fn(async (_request: CanvasSkillInstallRequest): Promise<CanvasSkillInstallResult> => ({ ok: true, installed: ['working-skill'], failed: [], library: installedLibrary })),
  }
  render(<CanvasWorkspace api={api as unknown as ImageGenApi} imageModels={[]} requireExplicitImageModel={false} connected history={[]} gallery={[]} tasks={[]} />)
  return api
}

async function openLibrary(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: tt('canvas.skills.libraryButton') }))
  const dialog = await screen.findByRole('dialog', { name: tt('canvas.skills.libraryTitle') })
  await waitFor(() => expect(within(dialog).queryByText(tt('canvas.skills.loading'))).toBeNull())
  return dialog
}

function startInstall(dialog: HTMLElement, kind: 'url' | 'zip'): File | undefined {
  if (kind === 'url') {
    fireEvent.change(within(dialog).getByPlaceholderText(tt('canvas.skills.libraryUrlPlaceholder')), { target: { value: source } })
    fireEvent.click(within(dialog).getByRole('button', { name: tt('canvas.skills.libraryInstallAction') }))
    return undefined
  }
  const file = new File(['test archive'], 'skills.zip', { type: 'application/zip' })
  fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [file] } })
  return file
}

describe('skill library errors inside the manager dialog', () => {
  it.each(['url', 'zip'] as const)('shows every %s installation failure and keeps the concrete reasons instead of HTTP 200', async kind => {
    const api = setup()
    api.canvasSkillInstall.mockResolvedValue({
      ok: false, installed: [], library, message: '200',
      failed: [
        { source, message: '该来源里没有找到 SKILL.md' },
        { source: 'second-skill', message: 'SKILL.md 缺少 description' },
      ],
    })
    const dialog = await openLibrary()
    const file = startInstall(dialog, kind)
    const alert = await within(dialog).findByRole('alert')
    expect(alert.closest('[role="dialog"]')).toBe(dialog)
    expect(alert.textContent).toContain(source)
    expect(alert.textContent).toContain('该来源里没有找到 SKILL.md')
    expect(alert.textContent).toContain('second-skill')
    expect(alert.textContent).toContain('SKILL.md 缺少 description')
    expect(alert.textContent).not.toContain('200')
    expect(alert.style.whiteSpace).toBe('pre-wrap')
    if (kind === 'zip') {
      expect(api.canvasFileUpload).toHaveBeenCalledExactlyOnceWith(file)
      expect(api.canvasSkillInstall).toHaveBeenCalledWith({ asset, force: false, name: 'skills' })
    } else expect(api.canvasSkillInstall).toHaveBeenCalledWith({ sources: [source], force: false })
  })

  it.each(['url', 'zip'] as const)('shows partial %s failures while displaying the successfully installed skill', async kind => {
    const api = setup()
    api.canvasSkillInstall.mockResolvedValue({
      ok: false, installed: ['working-skill'], library: installedLibrary,
      failed: [{ source: 'broken-skill', message: '技能目录中没有 SKILL.md' }],
    })
    const dialog = await openLibrary()
    startInstall(dialog, kind)
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('broken-skill')
    expect(alert.textContent).toContain('技能目录中没有 SKILL.md')
    expect(within(dialog).getByText('working-skill')).toBeTruthy()
    expect(api.canvasSkillInstall).toHaveBeenCalledTimes(1)
  })

  it.each(['url', 'zip'] as const)('shows a rejected %s installation request in the open dialog', async kind => {
    const api = setup()
    api.canvasSkillInstall.mockRejectedValue(new Error('连接中断：下载超时'))
    const dialog = await openLibrary()
    startInstall(dialog, kind)
    expect((await within(dialog).findByRole('alert')).textContent).toBe('连接中断：下载超时')
    expect(screen.getByRole('dialog', { name: tt('canvas.skills.libraryTitle') })).toBe(dialog)
  })

  it('shows an archive upload failure without trying to install an unavailable asset', async () => {
    const api = setup()
    api.canvasFileUpload.mockRejectedValue(new Error('压缩包上传失败：磁盘已满'))
    const dialog = await openLibrary()
    startInstall(dialog, 'zip')
    expect((await within(dialog).findByRole('alert')).textContent).toBe('压缩包上传失败：磁盘已满')
    expect(api.canvasSkillInstall).not.toHaveBeenCalled()
  })

  it('shows a library loading failure and clears it after an explicit refresh', async () => {
    const api = setup()
    api.canvasSkillLibrary.mockRejectedValueOnce(new Error('技能目录暂时无法读取'))
    const dialog = await openLibrary()
    expect((await within(dialog).findByRole('alert')).textContent).toBe('技能目录暂时无法读取')
    fireEvent.click(within(dialog).getByRole('button', { name: tt('canvas.skills.libraryReload') }))
    await waitFor(() => expect(api.canvasSkillLibrary).toHaveBeenCalledTimes(2))
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('clears a prior installation failure on retry and ignores archives dropped while installation is pending', async () => {
    const api = setup()
    api.canvasSkillInstall.mockResolvedValueOnce({ ok: false, installed: [], failed: [{ source, message: '第一次下载失败' }], library })
    const dialog = await openLibrary()
    startInstall(dialog, 'url')
    await within(dialog).findByRole('alert')
    let finish!: (result: CanvasSkillInstallResult) => void
    api.canvasSkillInstall.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    startInstall(dialog, 'url')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect((dialog.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true)
    fireEvent.drop(within(dialog).getByRole('button', { name: tt('canvas.skills.libraryDropzone') }), { dataTransfer: { files: [new File(['archive'], 'second.zip')] } })
    expect(api.canvasFileUpload).not.toHaveBeenCalled()
    await act(async () => finish({ ok: true, installed: ['working-skill'], failed: [], library: installedLibrary }))
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(within(dialog).getByText('working-skill')).toBeTruthy()
    expect(api.canvasSkillInstall).toHaveBeenCalledTimes(2)
  })

  it('keeps a top-level business failure when no per-source failure was supplied', async () => {
    const api = setup()
    api.canvasSkillInstall.mockResolvedValue({ ok: false, installed: [], failed: [], library, message: '宿主拒绝解压这个来源' })
    const dialog = await openLibrary()
    startInstall(dialog, 'url')
    expect((await within(dialog).findByRole('alert')).textContent).toBe('宿主拒绝解压这个来源')
  })
})
