import { useId, useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { TITLE_MAX, type PublisherContent, type PublisherContentType } from '../protocol.ts'
import { api, CONTENT_LABELS, errorMessage, PublisherModal } from './shared.tsx'

export function CreateDraftDialog({ contentType, onCancel, onCreated }: {
  contentType: PublisherContentType
  onCancel(): void
  onCreated(content: PublisherContent): void
}) {
  const id = useId()
  const formId = `pub-create-draft-${id}`
  const nameId = `${formId}-name`
  const helpId = `${formId}-help`
  const errorId = `${formId}-error`
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const close = () => { if (!submitting.current) onCancel() }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    const title = name.trim()
    try {
      const created = await api<PublisherContent>('contents', { contentType, ...(title ? { title } : {}) })
      onCreated(created)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return <PublisherModal open title={`新建${CONTENT_LABELS[contentType]}草稿`} closeLabel="关闭新建草稿"
    className="pub-modal" contentClassName="pub-modal-content" onClose={close}
    footer={<>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>取消</Button>
      <Button type="submit" form={formId} size="sm" variant="primary" disabled={busy}>{busy ? '正在创建…' : '创建草稿'}</Button>
    </>}>
    <form id={formId} onSubmit={event => void submit(event)} aria-busy={busy}>
      <div className="pub-modal-field">
        <label className="pub-modal-label" htmlFor={nameId}>任务名称（可选）</label>
        <Input id={nameId} className="pub-text-input" data-pub-initial-focus data-modal-autofocus
          maxLength={TITLE_MAX} value={name} disabled={busy} placeholder="例如：重庆周末徒步攻略"
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
          onChange={event => { setName(event.target.value); setError('') }}/>
      </div>
      <p id={helpId} className="pub-modal-copy">名称用于初始标题和项目文件夹。留空将按内容类型和日期命名；创建后修改标题不会改变文件夹名称。</p>
      {error && <p id={errorId} className="pub-error" role="alert">创建失败：{error}</p>}
    </form>
  </PublisherModal>
}
