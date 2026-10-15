import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, errorMessage, PublisherModal } from './shared.tsx'

type WritingProfile = { revision: number; instructions: string | null; enabled: boolean }
const MAX_INSTRUCTIONS = 12_000

export function WritingProfileSettings({ onDirtyChange, onBusyChange }: { onDirtyChange?(dirty: boolean): void; onBusyChange?(busy: boolean): void }) {
  const id = `pub-writing-${useId().replace(/[^a-z0-9_-]/giu, '')}`
  const [profile, setProfile] = useState<WritingProfile>()
  const [instructions, setInstructions] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [confirmation, setConfirmation] = useState<'clear' | 'reload'>()
  const request = useRef(0)
  const abort = useRef<AbortController>()
  const saving = useRef(false)
  const onDirty = useRef(onDirtyChange)
  const onBusy = useRef(onBusyChange)
  onDirty.current = onDirtyChange
  onBusy.current = onBusyChange
  const dirty = profile !== undefined && (instructions !== (profile.instructions ?? '') || enabled !== profile.enabled)
  const count = [...instructions].length
  const tooLong = count > MAX_INSTRUCTIONS
  const unavailable = loading || busy

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  useEffect(() => () => { request.current++; abort.current?.abort(); onDirty.current?.(false); onBusy.current?.(false) }, [])
  useEffect(() => {
    if (!dirty) return
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [dirty])

  const load = useCallback(async () => {
    const current = ++request.current
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError('')
    setStatus('')
    try {
      const result = await api<WritingProfile>('writing-profile', undefined, controller.signal)
      if (current !== request.current) return
      setProfile(result)
      setInstructions(result.instructions ?? '')
      setEnabled(result.enabled)
      setEditing(false)
    } catch (cause) {
      if (current === request.current && !controller.signal.aborted) setError(errorMessage(cause))
    } finally { if (current === request.current) setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (clear = false) => {
    if (!profile || unavailable || saving.current || (!clear && (!dirty || tooLong))) return
    const current = ++request.current
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    saving.current = true
    setBusy(true)
    onBusy.current?.(true)
    setError('')
    setStatus('')
    try {
      const result = await api<WritingProfile>('writing-profile', {
        expected_revision: profile.revision, instructions: clear ? null : instructions, enabled,
      }, controller.signal)
      if (current !== request.current) return
      setProfile(result)
      setInstructions(result.instructions ?? '')
      setEnabled(result.enabled)
      setEditing(false)
      setStatus(clear ? '已清除风格规则，启用状态保持不变。' : '写作风格已保存，后续创作会读取新设置。')
    } catch (cause) {
      if (current === request.current && !controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (current === request.current) {
        saving.current = false
        setBusy(false)
        onBusy.current?.(false)
      }
    }
  }
  const reload = () => {
    if (unavailable) return
    if (dirty) setConfirmation('reload')
    else void load()
  }
  const cancel = () => {
    if (!profile || unavailable) return
    setInstructions(profile.instructions ?? '')
    setEnabled(profile.enabled)
    setEditing(false)
    setError('')
    setStatus('')
  }
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save() }
  const state = !profile?.instructions ? '尚未设置' : profile.enabled ? '已启用' : '已停用'

  return <section className="pub-writing-profile" aria-labelledby={`${id}-title`} aria-busy={unavailable}>
    <style>{writingProfileCss}</style>
    <div className="pub-writing-heading"><h3 id={`${id}-title`}>写作风格</h3>{profile && <span className="pub-writing-state">{state}</span>}</div>
    <p className="pub-writing-description">用于多平台发布的文章、图文和视频文案。本次明确要求优先。</p>
    {loading && !profile ? <p role="status">正在读取写作风格…</p> : !profile ? <div className="pub-writing-error" role="alert">{error || '无法读取写作风格'} <Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button></div>
      : <form className="pub-writing-card" onSubmit={submit}>
        <div className="pub-writing-toolbar"><label className="pub-writing-toggle"><input type="checkbox" checked={enabled} disabled={unavailable} onChange={event => { setEnabled(event.target.checked); setStatus('') }}/>使用已保存的风格</label>
          <Button type="button" variant="ghost" size="sm" disabled={unavailable} onClick={reload}>{loading ? '正在读取…' : '刷新'}</Button></div>
        {editing ? <><label className="pub-writing-label" htmlFor={`${id}-instructions`}>风格规则</label>
          <textarea id={`${id}-instructions`} className="pub-writing-input" aria-describedby={`${id}-hint ${id}-count`} aria-invalid={tooLong || undefined} value={instructions} disabled={unavailable} rows={8}
            placeholder="例如：语气自然直接，多用具体例子，少用口号；段落简短，保留个人经验。"
            onChange={event => { setInstructions(event.target.value); setStatus('') }}/>
          <div className="pub-writing-input-hints"><p id={`${id}-hint`}>可填写语气、结构、常用表达和需要避免的写法。</p><span id={`${id}-count`} className={tooLong ? 'pub-writing-error' : ''}>{count.toLocaleString()} / {MAX_INSTRUCTIONS.toLocaleString()} 字</span></div>
          {tooLong && <p className="pub-writing-error" role="alert">风格规则最多 {MAX_INSTRUCTIONS.toLocaleString()} 字，请精简后保存。</p>}</>
          : profile.instructions ? <><div className="pub-writing-summary">{profile.instructions}</div><Button type="button" variant="outline" size="sm" disabled={unavailable} onClick={() => setEditing(true)}>查看与编辑</Button></>
            : <div className="pub-writing-empty"><p>让 Agent 学习你的样文，或直接填写自己的写作偏好。</p><Button type="button" variant="outline" size="sm" disabled={unavailable} onClick={() => setEditing(true)}>设置写作风格</Button></div>}
        {(editing || dirty) && <div className="pub-writing-actions"><Button variant="primary" size="sm" type="submit" disabled={unavailable || !dirty || tooLong}>{busy ? '正在保存…' : '保存风格'}</Button><Button type="button" variant="ghost" size="sm" disabled={unavailable} onClick={cancel}>取消修改</Button>
          <span className="pub-writing-unsaved">{dirty ? '有未保存的修改' : '修改后保存生效'}</span></div>}
        {profile.instructions && <div className="pub-writing-clear"><Button type="button" variant="ghost" size="sm" disabled={unavailable} onClick={() => setConfirmation('clear')}>清除风格规则</Button></div>}
        {error && <div className="pub-writing-error" role="alert"><p>{error}</p><Button type="button" variant="outline" size="sm" disabled={unavailable} onClick={reload}>重新读取</Button></div>}
        {status && <p className="pub-writing-status" role="status">{status}</p>}
      </form>}
    {confirmation && <PublisherModal open title={confirmation === 'clear' ? '清除写作风格？' : '重新读取写作风格？'} closeLabel="取消" className="pub-modal" contentClassName="pub-modal-content" onClose={() => setConfirmation(undefined)}
      footer={<><Button type="button" variant="outline" size="sm" data-pub-initial-focus onClick={() => setConfirmation(undefined)}>取消</Button><Button type="button" variant="primary" size="sm" onClick={() => {
        const action = confirmation
        setConfirmation(undefined)
        if (action === 'clear') void save(true)
        else void load()
      }}>{confirmation === 'clear' ? '确认清除' : '放弃修改并读取'}</Button></>}>
      <p>{confirmation === 'clear' ? '将清除已保存的风格规则和当前未保存的文字，保留当前启用状态。之后可以重新学习或设置。' : '当前修改尚未保存。重新读取会放弃这些修改，并载入最新保存的规则。'}</p>
    </PublisherModal>}
  </section>
}

const writingProfileCss = `
.pub-writing-profile { max-width: 760px; margin-bottom: 32px; color: var(--pub-text, var(--dsw-alias-label-primary, #111318)); }
.pub-writing-heading { display: flex; align-items: center; gap: 10px; }
.pub-writing-heading h3 { margin: 0; font-size: 17px; line-height: 1.4; }
.pub-writing-state { padding: 2px 7px; border-radius: 5px; background: var(--pub-soft, var(--dsw-alias-bg-module-platform, #f5f6f7)); color: var(--pub-secondary-text, var(--dsw-alias-label-secondary, #535961)); font-size: 11px; }
.pub-writing-description { margin: 6px 0 16px; color: var(--pub-secondary-text, var(--dsw-alias-label-secondary, #535961)); font-size: 13px; line-height: 1.6; }
.pub-writing-card { padding: 18px 20px; border: 1px solid var(--pub-border, var(--dsw-alias-border-l2, #e4e6e9)); border-radius: 12px; background: var(--pub-surface, var(--dsw-alias-bg-base, #fff)); }
.pub-writing-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: -3px -5px 12px 0; }
.pub-writing-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
.pub-writing-toggle input { margin: 0; width: 15px; height: 15px; accent-color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub-writing-label { display: block; margin: 8px 0; font-size: 13px; font-weight: 500; }
.pub-writing-input { display: block; width: 100%; min-height: 180px; max-height: 52vh; resize: vertical; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--pub-border, var(--dsw-alias-border-l2, #e4e6e9)); border-radius: 8px; background: var(--pub-bg, var(--dsw-alias-bg-base, #fff)); color: inherit; font: inherit; font-size: 13px; line-height: 1.7; }
.pub-writing-input:focus-visible, .pub-writing-toggle input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-writing-input-hints { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-top: 7px; color: var(--pub-tertiary-text, var(--dsw-alias-label-tertiary, #777d85)); font-size: 11px; line-height: 1.5; }
.pub-writing-input-hints p { margin: 0; }
.pub-writing-summary { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; margin: 0 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.7; }
.pub-writing-empty p { margin: 0 0 12px; color: var(--pub-secondary-text, var(--dsw-alias-label-secondary, #535961)); font-size: 13px; line-height: 1.6; }
.pub-writing-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.pub-writing-unsaved { color: var(--pub-tertiary-text, var(--dsw-alias-label-tertiary, #777d85)); font-size: 11px; }
.pub-writing-clear { margin: 12px 0 -4px -7px; }
.pub-writing-error { margin-top: 10px; color: var(--dsw-alias-label-danger, #b42318); font-size: 12px; line-height: 1.6; }
.pub-writing-error p { margin: 0 0 8px; }
.pub-writing-status { margin: 12px 0 0; color: var(--pub-secondary-text, var(--dsw-alias-label-secondary, #535961)); font-size: 12px; line-height: 1.6; }
@container (max-width: 520px) { .pub-writing-card { padding: 14px 16px; } }
`
