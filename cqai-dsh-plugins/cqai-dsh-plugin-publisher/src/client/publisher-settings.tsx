import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from './shared.tsx'
import { publisherSettingsCss } from './publisher-settings-style.ts'

type ProjectSettings = { defaultRoot: string; isCustom: boolean }
const PICK_DIRECTORY = '/_dsh/desktop/pick-directory'

async function pickProjectRoot(): Promise<string | null> {
  const response = await fetch(PICK_DIRECTORY, { method: 'POST', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('系统文件夹选择器暂不可用，请手动输入目录路径')
  const result: unknown = await response.json()
  if (!result || typeof result !== 'object' || !('path' in result)
    || (result.path !== null && typeof result.path !== 'string')) throw new Error('文件夹选择器返回了无效路径')
  return result.path
}

export function PublisherSettings() {
  const [settings, setSettings] = useState<ProjectSettings>()
  const [draftRoot, setDraftRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = () => {
    setLoading(true)
    setError('')
    void api<ProjectSettings>('project-settings').then(result => {
      setSettings(result)
      setDraftRoot(result.defaultRoot)
    }).catch(cause => setError(errorMessage(cause))).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const choose = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const path = await pickProjectRoot()
      if (path !== null) setDraftRoot(path)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !draftRoot.trim()) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await api<ProjectSettings>('project-settings', { defaultRoot: draftRoot })
      setSettings(result)
      setDraftRoot(result.defaultRoot)
      setSaved(true)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  return <section className="pub-settings" aria-labelledby="pub-settings-title"><style>{publisherSettingsCss}</style>
    <h3 id="pub-settings-title">项目工作区</h3>
    <p>为每篇文章、每份图文和每条视频草稿建立独立的项目目录，供 Agent 存放资料和生成文件。</p>
    {loading ? <p role="status">正在读取设置…</p> : !settings ? <div role="alert">{error || '无法读取项目工作区设置'} <button type="button" className="pub-settings-retry" onClick={load}>重试</button></div>
      : <form className="pub-settings-card" onSubmit={event => void save(event)}>
        <label className="pub-settings-label" htmlFor="pub-project-root">默认项目根目录</label>
        <div className="pub-settings-path">
          <input id="pub-project-root" aria-label="默认项目根目录" value={draftRoot} onChange={event => { setDraftRoot(event.target.value); setSaved(false) }} disabled={busy} spellCheck={false} autoComplete="off"/>
          <button type="button" onClick={() => void choose()} disabled={busy}>选择文件夹</button>
        </div>
        <p className="pub-settings-hint">新草稿会在此目录下按内容类型和草稿 ID 建立子目录。更改此设置不会移动已有项目；删除草稿也不会删除项目目录中的文件。</p>
        <div className="pub-settings-actions"><button type="submit" className="pub-settings-save" disabled={busy || !draftRoot.trim() || draftRoot === settings.defaultRoot}>{busy ? '正在保存…' : '保存设置'}</button></div>
        {error && <p className="pub-settings-error" role="alert">{error}</p>}
        {saved && <p className="pub-settings-status" role="status">已保存。后续新建项目将使用这个目录。</p>}
      </form>}
  </section>
}
