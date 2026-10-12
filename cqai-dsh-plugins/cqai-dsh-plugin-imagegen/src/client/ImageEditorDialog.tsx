/** Connect the lightweight editor to e图宝's existing models, queue and gallery. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CqaiImageProviderView, HistoryEntry } from '../protocol.ts'
import type { ImageGenApi } from './api.ts'
import type { ImageGenScope } from './settings-scope.ts'
import { EditorModal, type EditorApplyResult, type ImageEditorSource } from './image-editor/EditorModal.tsx'
import { applyImageEditorResult, imageEditorRequiresGeneration, imageEditorResultFingerprint, ImageEditorGallerySaveError, savePreparedImageEditorResult, type PreparedImageEditorResult, type ImageEditorSelection, type ImageEditorWorkflowResult } from './image-editor-workflow.ts'
import { imageModelChoiceKey, imageModelGroups } from './image-model-groups.ts'
import { errorMessage } from './helpers.ts'
import css from './image-editor-dialog.module.css'

export interface ImageEditorDialogProps {
  source: ImageEditorSource
  api: ImageGenApi
  scope: ImageGenScope
  initialSelection?: ImageEditorSelection
  sourceEntry?: Partial<HistoryEntry>
  onClose(): void
  onComplete?(result: ImageEditorWorkflowResult): void
}

export function ImageEditorDialog({ source, api, scope, initialSelection, sourceEntry, onClose, onComplete }: ImageEditorDialogProps): React.JSX.Element {
  const [config, setConfig] = useState(() => scope.getSnapshot().value)
  const [provider, setProvider] = useState<CqaiImageProviderView>({ provider: 'cqai', immutable: true, state: 'signed-out', models: [] })
  const [providerError, setProviderError] = useState<string | null>(null)
  const [providerLoaded, setProviderLoaded] = useState(false)
  const [choice, setChoice] = useState('')
  const [needsGeneration, setNeedsGeneration] = useState(false)
  const [status, setStatus] = useState('')
  const operation = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  const retrySave = useRef<{ key: string; prepared: PreparedImageEditorResult } | null>(null)
  const [savePending, setSavePending] = useState(false)
  useEffect(() => {
    setConfig(scope.getSnapshot().value)
    return scope.subscribe(() => { setConfig(scope.getSnapshot().value) })
  }, [scope])
  useEffect(() => {
    let disposed = false
    setProviderLoaded(false)
    void api.cqaiProvider().then(next => {
      if (!disposed) { setProvider(next); setProviderError(null); setProviderLoaded(true) }
    }).catch(error => { if (!disposed) { setProviderError(errorMessage(error)); setProviderLoaded(true) } })
    return () => { disposed = true }
  }, [api])
  useEffect(() => () => { operation.current?.abort() }, [])
  const groups = useMemo(() => imageModelGroups(provider, config?.channels ?? [], true), [provider, config?.channels])
  const choices = groups.flatMap(group => group.models.map(model => ({
    key: imageModelChoiceKey(group.providerId, model),
    selection: { model, channelId: group.providerId, channel: group.name },
  })))
  useEffect(() => {
    if (choices.some(item => item.key === choice)) return
    const requested = initialSelection === undefined ? undefined : choices.find(item => item.selection.model === initialSelection.model && item.selection.channelId === (initialSelection.channelId ?? 'cqai'))
    if (requested !== undefined) { setChoice(requested.key); return }
    if (!providerLoaded) { setChoice(''); return }
    const preferred = choices.find(item => item.selection.channelId === 'cqai' && item.selection.model === provider.defaultModel)
      ?? choices.find(item => item.selection.channelId === config?.defaultChannelId)
    const cqaiChoices = choices.filter(item => item.selection.channelId === 'cqai')
    const only = cqaiChoices.length === 1 ? cqaiChoices[0] : choices.length === 1 ? choices[0] : undefined
    setChoice((preferred ?? only)?.key ?? '')
  }, [groups, choice, initialSelection?.model, initialSelection?.channelId, provider.defaultModel, providerLoaded, config?.defaultChannelId])

  const apply = async (result: EditorApplyResult): Promise<void> => {
    if (submitting.current) throw new Error('图片编辑正在处理中。')
    const remote = imageEditorRequiresGeneration(result)
    if (remote && config?.enabled === false) throw new Error('请先在设置中启用 e图宝，再生成新版图片。')
    const selected = choices.find(item => item.key === choice)?.selection
    if (remote && selected === undefined) throw new Error(choices.length > 0 ? '请先选择用于图片编辑的模型。' : '没有可用的图片编辑模型，请登录 CQAI Club 或在 e图宝设置中添加支持图生图的模型。')
    const controller = new AbortController()
    operation.current = controller
    submitting.current = true
    setStatus(remote ? '正在提交图片编辑…' : '正在另存图片…')
    let key: string | undefined
    try {
      const selection = !remote || selected === undefined ? undefined : {
        ...selected, quality: initialSelection?.quality ?? 'auto', detail: initialSelection?.detail ?? '',
      }
      key = await imageEditorResultFingerprint(result, selection)
      const pending = retrySave.current?.key === key ? retrySave.current.prepared : undefined
      if (pending === undefined) { retrySave.current = null; setSavePending(false) }
      else if (!controller.signal.aborted) setStatus('正在重试保存图片…')
      const saved = pending === undefined ? await applyImageEditorResult(result, {
        api, source: sourceEntry, signal: controller.signal,
        selection,
        onTask: task => {
          if (!controller.signal.aborted) setStatus(task.status === 'queued' ? '编辑任务排队中…' : task.status === 'running' ? '正在生成新版图片…' : '正在保存新版图片…')
        },
      }) : await savePreparedImageEditorResult(pending, { api, signal: controller.signal })
      retrySave.current = null
      if (!controller.signal.aborted) setSavePending(false)
      if (!controller.signal.aborted) onComplete?.(saved)
    } catch (error) {
      if (error instanceof ImageEditorGallerySaveError && key !== undefined && !controller.signal.aborted) {
        retrySave.current = { key, prepared: error.prepared }
        setSavePending(true)
      }
      throw error
    } finally {
      submitting.current = false
      if (!controller.signal.aborted) setStatus('')
      if (operation.current === controller) operation.current = null
    }
  }

  return <EditorModal
    source={source}
    onCancel={onClose}
    onApply={apply}
    onIntentChange={setNeedsGeneration}
    applyLabel={needsGeneration ? '生成新版' : '另存图片'}
    options={<div className={css.options}>
      {needsGeneration && <label className={css.model}>图片编辑模型
        <select aria-label="图片编辑模型" value={choice} onChange={event => { setChoice(event.target.value) }} disabled={status !== ''}>
          {choices.length === 0 && <option value="">暂无可用模型</option>}
          {choices.length > 0 && choice === '' && <option value="">请选择图片编辑模型</option>}
          {groups.map(group => <optgroup key={group.providerId} label={group.name}>
            {group.models.map(model => <option key={model} value={imageModelChoiceKey(group.providerId, model)}>{model}</option>)}
          </optgroup>)}
        </select>
      </label>}
      <p className={css.hint}>{needsGeneration ? '标注和擦除将使用所选模型生成新版；同时使用时，只修改涂抹范围。' : '尺寸调整和纯色背景处理在本地完成。'}结果另存到 e图库，原图保留。</p>
      {needsGeneration && choices.length === 0 && <p className={css.error}>{providerError ?? '请登录 CQAI Club 或在 e图宝设置中添加图生图模型。'}</p>}
      {status !== '' && <p role="status" aria-live="polite" className={css.hint}>{status}</p>}
      {savePending && <p className={css.hint}>图片已处理完成。再次应用相同编辑会重试保存，无需重新生成。</p>}
    </div>}
  />
}
