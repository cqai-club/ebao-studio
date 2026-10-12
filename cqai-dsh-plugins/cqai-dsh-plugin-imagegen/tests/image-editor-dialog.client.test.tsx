// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorApplyResult, EditorModalProps } from '../src/client/image-editor/EditorModal.tsx'
import type { ImageGenApi } from '../src/client/api.ts'
import type { ImageGenScope } from '../src/client/settings-scope.ts'
import type { ImageEditorWorkflowResult } from '../src/client/image-editor-workflow.ts'
import { ImageEditorDialog } from '../src/client/ImageEditorDialog.tsx'
import { ImageEditorGallerySaveError } from '../src/client/image-editor-workflow.ts'

const state = vi.hoisted(() => ({ apply: vi.fn(), save: vi.fn(), fingerprint: vi.fn(async () => 'same-edit'), props: null as EditorModalProps | null }))
vi.mock('../src/client/image-editor-workflow.ts', () => ({
  imageEditorRequiresGeneration: (result: EditorApplyResult) => result.manifest.markers.length > 0,
  applyImageEditorResult: state.apply,
  savePreparedImageEditorResult: state.save,
  imageEditorResultFingerprint: state.fingerprint,
  ImageEditorGallerySaveError: class extends Error {
    constructor(error: unknown, public prepared: unknown) { super(String(error)) }
  },
}))
vi.mock('../src/client/image-editor/EditorModal.tsx', () => ({
  EditorModal: (props: EditorModalProps) => {
    state.props = props
    return <section role="dialog"><span>{props.source.name}</span>{props.options}<span>{props.applyLabel}</span></section>
  },
}))
afterEach(() => { cleanup(); state.apply.mockReset(); state.save.mockReset(); state.fingerprint.mockReset().mockResolvedValue('same-edit'); state.props = null })

function setup(patch: { enabled?: boolean; signedIn?: boolean } = {}) {
  const api = { cqaiProvider: vi.fn(async () => ({ provider: 'cqai', immutable: true, state: patch.signedIn === false ? 'signed-out' : 'signed-in', models: patch.signedIn === false ? [] : [{ alias: 'gpt-image-1', upstream: 'image-1' }], defaultModel: patch.signedIn === false ? undefined : 'gpt-image-1' })) } as unknown as ImageGenApi
  const scope = { getSnapshot: () => ({ value: { enabled: patch.enabled !== false, channels: [{ id: 'custom', name: '自定义渠道', apiUrl: 'https://image.invalid', models: [{ alias: 'gpt-image-1', upstream: 'custom-image' }] }] } }), subscribe: () => () => {} } as unknown as ImageGenScope
  const onComplete = vi.fn(), onClose = vi.fn()
  const view = render(<ImageEditorDialog source={{ previewUrl: 'blob:original', name: '原图.png' }} api={api} scope={scope} initialSelection={{ model: 'gpt-image-1', channelId: 'custom', quality: '2k', size: '1:1' }} onComplete={onComplete} onClose={onClose} />)
  return { ...view, api, scope, onComplete, onClose }
}
const draft = (remote = false) => ({ files: [], legend: [], manifest: { markers: remote ? [{ id: 1, x: 0.3, y: 0.3, text: '修改' }] : [] } }) as unknown as EditorApplyResult
const saved = { kind: 'local', image: { mime: 'image/png', b64: 'new' }, gallery: [], galleryAdded: true } as ImageEditorWorkflowResult

describe('editor queue/gallery controller', () => {
  it('saves local edits without requiring an AI model and returns the saved image', async () => {
    const fixture = setup({ signedIn: false })
    await act(async () => {})
    state.apply.mockResolvedValue(saved)
    await act(async () => { await state.props!.onApply(draft()) })
    expect(fixture.onComplete).toHaveBeenCalledExactlyOnceWith(saved)
    expect(state.apply.mock.calls[0][1].api).toBe(fixture.api)
    expect(state.apply.mock.calls[0][1].signal.aborted).toBe(false)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('retains route identity for equal aliases and leaves size to the edited manifest', async () => {
    setup()
    await act(async () => { state.props!.onIntentChange!(true) })
    await waitFor(() => expect((screen.getByRole('combobox', { name: '图片编辑模型' }) as HTMLSelectElement).value).toBe('["custom","gpt-image-1"]'))
    state.apply.mockResolvedValue(saved)
    await act(async () => { await state.props!.onApply(draft(true)) })
    expect(state.apply.mock.calls[0][1].selection).toEqual({ channelId: 'custom', channel: '自定义渠道', model: 'gpt-image-1', quality: '2k', detail: '' })
    expect(screen.getByText('生成新版')).toBeTruthy()
  })

  it('blocks AI when disabled and propagates queue failures without completing', async () => {
    const fixture = setup({ enabled: false })
    await act(async () => {})
    await expect(state.props!.onApply(draft(true))).rejects.toThrow('启用 e图宝')
    expect(state.apply).not.toHaveBeenCalled()
    fixture.unmount()
    const next = setup()
    await act(async () => {})
    state.apply.mockRejectedValue(new Error('模型失败'))
    await act(async () => { await expect(state.props!.onApply(draft(true))).rejects.toThrow('模型失败') })
    expect(next.onComplete).not.toHaveBeenCalled()
    expect(next.onClose).not.toHaveBeenCalled()
  })

  it('aborts the workflow on unmount and ignores a late completion', async () => {
    const fixture = setup()
    await act(async () => {})
    let resolve!: (value: ImageEditorWorkflowResult) => void
    state.apply.mockReturnValue(new Promise<ImageEditorWorkflowResult>(done => { resolve = done }))
    let operation!: Promise<void> | void
    await act(async () => { operation = state.props!.onApply(draft()); await Promise.resolve() })
    const signal = state.apply.mock.calls[0][1].signal as AbortSignal
    fixture.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve(saved); await operation })
    expect(fixture.onComplete).not.toHaveBeenCalled()
  })

  it('retries a failed gallery save without invoking another image generation', async () => {
    const fixture = setup()
    await act(async () => {})
    const prepared = { kind: 'generated', image: saved.image, galleryEntry: {} } as unknown as ImageEditorGallerySaveError['prepared']
    state.apply.mockRejectedValue(new ImageEditorGallerySaveError(new Error('存储失败'), prepared))
    await act(async () => { await expect(state.props!.onApply(draft(true))).rejects.toThrow('存储失败') })
    state.save.mockResolvedValue(saved)
    await act(async () => { await state.props!.onApply(draft(true)) })
    expect(state.apply).toHaveBeenCalledOnce()
    expect(state.save.mock.calls[0][0]).toBe(prepared)
    expect(fixture.onComplete).toHaveBeenCalledExactlyOnceWith(saved)
  })

  it('requires a model choice when CQAI has several models and no configured default', async () => {
    const api = { cqaiProvider: async () => ({ provider: 'cqai', immutable: true, state: 'signed-in', models: [{ alias: 'gpt-image-1' }, { alias: 'gpt-image-2' }] }) } as unknown as ImageGenApi
    const scope = { getSnapshot: () => ({ value: { channels: [] } }), subscribe: () => () => {} } as unknown as ImageGenScope
    render(<ImageEditorDialog source={{ previewUrl: 'blob:original', name: '原图.png' }} api={api} scope={scope} onClose={vi.fn()} />)
    await act(async () => { state.props!.onIntentChange!(true) })
    expect((screen.getByRole('combobox', { name: '图片编辑模型' }) as HTMLSelectElement).value).toBe('')
    await expect(state.props!.onApply(draft(true))).rejects.toThrow('请先选择用于图片编辑的模型')
    expect(state.apply).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '["cqai","gpt-image-2"]' } })
    state.apply.mockResolvedValue(saved)
    await act(async () => { await state.props!.onApply(draft(true)) })
    expect(state.apply.mock.calls[0][1].selection.model).toBe('gpt-image-2')
  })
})
