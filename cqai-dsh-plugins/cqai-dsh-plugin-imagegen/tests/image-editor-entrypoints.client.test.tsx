// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenApi } from '../src/client/api.ts'
import type { ImageGenScope } from '../src/client/settings-scope.ts'
import type { ImageEditorDialogProps } from '../src/client/ImageEditorDialog.tsx'
import type { ImageEditorWorkflowResult } from '../src/client/image-editor-workflow.ts'
import { ImageEditCommandView } from '../src/client/image-toolview.tsx'
import { ImageGenPanel } from '../src/client/ImageGenPanel.tsx'
import { serializeEditImageCommandResult } from '../src/edit-image-command-result.ts'

vi.mock('../src/client/ImageEditorDialog.tsx', () => ({
  ImageEditorDialog: ({ source, onClose, onComplete }: ImageEditorDialogProps) => <section role="dialog" aria-label="测试图片编辑器">
    <img src={source.previewUrl} alt="待编辑原图" />
    <button onClick={onClose}>放弃编辑</button>
    <button onClick={() => {
      onComplete?.({ image: { mime: 'image/png', b64: 'bmV3' }, gallery: [], galleryAdded: true, kind: 'local' } as ImageEditorWorkflowResult)
      onClose()
    }}>保存测试编辑</button>
  </section>,
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _v, size: _s, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
  Pill: ({ active: _a, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) => <button {...props}>{children}</button>,
}))
vi.mock('../src/client/CanvasWorkspace.tsx', () => ({ CanvasWorkspace: () => null }))
vi.mock('../src/client/TemplateLibrary.tsx', () => ({ TemplateLibrary: () => null }))
vi.mock('../src/client/GooeyNav.tsx', () => ({ GooeyNav: ({ items, onSelect }: { items: Array<{ key: string; label: ReactNode }>; onSelect(index: number): void }) => <nav>{items.map((item, index) => <button key={item.key} onClick={() => onSelect(index)}>{item.label}</button>)}</nav> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear() })
function services() {
  const api = {
    cqaiProvider: vi.fn(async () => ({ provider: 'cqai', immutable: true, state: 'signed-in', models: [{ alias: 'gpt-image-1', upstream: 'image-1' }], defaultModel: 'gpt-image-1' })),
    historyList: vi.fn(async () => []), galleryList: vi.fn(async () => []), taskList: vi.fn(async () => [{
      id: 'original-task', createdAt: Date.now() + 1000, status: 'completed', resultAvailable: true,
      request: { mode: 'text', model: 'gpt-image-1', prompt: '原始图片', size: '1:1', quality: 'auto', detail: '', n: 1 },
    }]),
    taskGet: vi.fn(async () => ({ id: 'original-task', createdAt: Date.now() + 1000, status: 'completed', request: { mode: 'text', model: 'gpt-image-1', prompt: '原始图片', size: '1:1', quality: 'auto', detail: '', n: 1 }, result: { images: [{ mime: 'image/png', b64: 'b3JpZ2luYWw=' }] } })),
    ecommerceList: vi.fn(async () => []), canvasList: vi.fn(async () => []),
  } as unknown as ImageGenApi
  const scope = {
    getSnapshot: () => ({ value: { enabled: true, channels: [] } }), subscribe: () => () => {},
    getSecretSetSnapshot: () => true, subscribeSecretSets: () => () => {},
  } as unknown as ImageGenScope
  return { api, scope }
}

describe('image edit entrypoints', () => {
  it('opens the clicked durable command image and displays a separate edited version', async () => {
    const image: ImageAttachmentRef = { attachmentId: 'original' as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: '原图.png' }
    const node = { kind: 'command', seq: 1, time: 1, commandId: 'edit-command', name: 'edit_image', args: '', outcome: { kind: 'success', text: serializeEditImageCommandResult('task-1', [image]) } } as CommandNode
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render(<ImageEditCommandView node={node} sessionId={'session' as SessionId} loadImage={async () => 'blob:original'} editor={services()} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑图片：原图.png' }))
    expect(screen.getByRole('img', { name: '待编辑原图' }).getAttribute('src')).toBe('blob:original')
    fireEvent.click(screen.getByRole('button', { name: '保存测试编辑' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('img', { name: '原图.png' }).getAttribute('src')).toBe('blob:original')
    expect(screen.getByRole('img', { name: '编辑后的新版图片' }).getAttribute('src')).toBe('data:image/png;base64,bmV3')
    fireEvent.click(screen.getByRole('button', { name: '继续编辑图片' }))
    expect(screen.getByRole('img', { name: '待编辑原图' }).getAttribute('src')).toBe('data:image/png;base64,bmV3')
  })

  it('opens editing from studio preview, restores on cancel and previews the saved version', async () => {
    render(<ImageGenPanel {...services()} />)
    fireEvent.click((await screen.findByRole('img', { name: '原始图片' })).closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    expect(screen.getByRole('img', { name: '待编辑原图' }).getAttribute('src')).toBe('data:image/png;base64,b3JpZ2luYWw=')
    fireEvent.click(screen.getByRole('button', { name: '放弃编辑' }))
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑图片' }))
    fireEvent.click(screen.getByRole('button', { name: '保存测试编辑' }))
    await act(async () => {})
    expect(screen.queryByRole('dialog', { name: '测试图片编辑器' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '图片预览' }).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,bmV3')
  })
})
