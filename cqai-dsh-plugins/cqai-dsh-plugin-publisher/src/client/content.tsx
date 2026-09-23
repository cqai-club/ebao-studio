import { useEffect, useMemo, useRef, useState } from 'react'
import {
  API, CREATIVE_STATEMENTS, MAX_TAGS, PLATFORMS, PLATFORM_LABELS, TITLE_MAX,
  type CreateSubmissionResult, type Platform, type PublisherAccount,
  type PublisherContent, type PublisherPlatformCapability,
} from '../protocol.ts'
import {
  api, ConfirmDialog, errorMessage, PlatformAccountSelect, STATEMENT_LABELS, uploadAsset,
} from './shared.tsx'
import { usePublisherTips } from './tips.tsx'

function MarkdownPreview({ value }: { value: string }) {
  const lines = value.split(/\r?\n/u)
  const blocks: React.ReactNode[] = []
  let code: string[] | undefined
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('```')) {
      if (code) { blocks.push(<pre key={index}><code>{code.join('\n')}</code></pre>); code = undefined }
      else code = []
      continue
    }
    if (code) { code.push(line); continue }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line)
    if (heading) {
      const text = heading[2]
      blocks.push(heading[1].length === 1 ? <h1 key={index}>{text}</h1> : heading[1].length === 2 ? <h2 key={index}>{text}</h2> : <h3 key={index}>{text}</h3>)
      continue
    }
    if (/^[-*]\s+/u.test(line)) { blocks.push(<p key={index}>• {line.slice(2)}</p>); continue }
    if (/^>\s?/u.test(line)) { blocks.push(<blockquote key={index}>{line.replace(/^>\s?/u, '')}</blockquote>); continue }
    blocks.push(<p key={index}>{line || '\u00a0'}</p>)
  }
  if (code) blocks.push(<pre key="last"><code>{code.join('\n')}</code></pre>)
  return <div className="pub-preview" aria-label="Markdown 预览">{blocks}</div>
}

type EditorType = 'article' | 'image-note'
type Mode = 'publish' | 'draft'
const FIELD_LABELS: Record<string, string> = { category: '分类', topic: '话题', original: '原创声明' }

export function ContentEditor({ contentType, active }: { contentType: EditorType; active: boolean }) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [contents, setContents] = useState<PublisherContent[]>([])
  const [draft, setDraft] = useState<PublisherContent>()
  const draftRef = useRef<PublisherContent>()
  const dirtyRef = useRef(false)
  const saveTask = useRef<Promise<void>>()
  const [editVersion, setEditVersion] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [capabilities, setCapabilities] = useState<PublisherPlatformCapability[]>([])
  const [selection, setSelection] = useState<Partial<Record<Platform, string>>>({})
  const [mode, setMode] = useState<Mode>('publish')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [saveError, setSaveError] = useState('')

  const refreshContents = async () => {
    const rows = await api<PublisherContent[]>('contents')
    setContents(rows.filter(item => item.contentType === contentType))
  }
  const setServerDraft = (value: PublisherContent | undefined) => {
    draftRef.current = value
    dirtyRef.current = false
    setSaveError('')
    setDraft(value)
    setTagsInput(value?.tags.join(' ') ?? '')
  }
  useEffect(() => {
    if (!active) return
    let live = true
    void api<PublisherContent[]>('contents').then(rows => {
      if (!live || draftRef.current) return
      const matches = rows.filter(item => item.contentType === contentType)
      setContents(matches)
      setServerDraft(matches[0])
    }).catch(cause => { if (live) showError(errorMessage(cause)) })
    return () => { live = false }
  }, [contentType, active])
  useEffect(() => {
    if (!active) return
    let live = true
    void Promise.all([
      api<PublisherAccount[]>('accounts'),
      api<PublisherPlatformCapability[]>('platform-capabilities'),
    ]).then(([accountRows, capabilityRows]) => {
      if (live) { setAccounts(accountRows); setCapabilities(capabilityRows) }
    }).catch(() => { if (live) setCapabilities([]) })
    return () => { live = false }
  }, [active])

  const update = (patch: Partial<PublisherContent>) => {
    if (!draftRef.current) return
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    dirtyRef.current = true
    setDraft(next)
    setEditVersion(version => version + 1)
  }

  const flush = async (): Promise<PublisherContent | undefined> => {
    if (saveTask.current) await saveTask.current
    const current = draftRef.current
    if (!current || !dirtyRef.current) return current
    dirtyRef.current = false
    const task = (async () => {
      try {
        const saved = await api<PublisherContent>('content-save', {
          id: current.id, revision: current.revision, title: current.title, body: current.body,
          summary: current.summary, tags: current.tags, creativeStatement: current.creativeStatement,
          coverAssetId: current.coverAssetId, assetOrder: current.assets.map(asset => asset.id),
          platformFields: current.platformFields,
        })
        if (draftRef.current?.id === current.id) {
          const latest = draftRef.current
          const merged = { ...latest, revision: saved.revision, updatedAt: saved.updatedAt }
          draftRef.current = merged
          setDraft(merged)
        }
        setContents(rows => rows.map(row => row.id === saved.id ? saved : row))
        setSaveError('')
      } catch (cause) {
        dirtyRef.current = true
        setSaveError(errorMessage(cause))
        throw cause
      }
    })()
    saveTask.current = task
    try { await task } finally { if (saveTask.current === task) saveTask.current = undefined }
    if (dirtyRef.current) return flush()
    return draftRef.current
  }

  useEffect(() => {
    if (editVersion === 0) return
    const timer = setTimeout(() => { void flush().catch(cause => showError(errorMessage(cause))) }, 800)
    return () => clearTimeout(timer)
  }, [editVersion])

  const act = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true); clearTip()
    try { await task() } catch (cause) { showError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  const selectDraft = (id: string) => void act(async () => {
    await flush()
    setServerDraft(await api<PublisherContent>(`content/${id}`))
  })
  const create = () => void act(async () => {
    await flush()
    const created = await api<PublisherContent>('contents', { contentType })
    setServerDraft(created)
    await refreshContents()
  })
  const duplicate = () => void act(async () => {
    const current = await flush()
    if (!current) return
    const copy = await api<PublisherContent>('content-copy', { id: current.id })
    setServerDraft(copy)
    await refreshContents()
  })
  const remove = () => {
    if (!draftRef.current || !window.confirm('删除这份本地草稿？已经提交的内容快照不受影响。')) return
    void act(async () => {
      const id = draftRef.current!.id
      await api('content-delete', { id })
      await refreshContents()
      setServerDraft(undefined)
    })
  }
  const importText = (file: File | undefined) => void act(async () => {
    if (!file) return
    if (!/\.(md|txt)$/iu.test(file.name) || file.size > 2 * 1024 * 1024) throw new Error('只支持 2MB 以内的 .md/.txt 文件')
    const text = await file.text()
    if (!draftRef.current) {
      const created = await api<PublisherContent>('contents', { contentType })
      setServerDraft(created)
      await refreshContents()
    }
    update({ body: text, title: draftRef.current!.title || file.name.replace(/\.(md|txt)$/iu, '') })
    showSuccess('已导入编辑器，草稿会自动保存。')
  })
  const addImages = (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    if (!selected.length) return
    void act(async () => {
      let current = await flush()
      if (!current) current = await api<PublisherContent>('contents', { contentType })
      if (current.assets.length + selected.length > 20) throw new Error('每份内容最多 20 个素材')
      for (const file of selected) {
        current = await uploadAsset(current.id, file)
        setServerDraft(current)
      }
      if (contentType === 'article' && current.assets.length === 1 && !current.coverAssetId) {
        current = await api<PublisherContent>('content-save', {
          id: current.id, revision: current.revision, title: current.title, body: current.body,
          summary: current.summary, tags: current.tags, creativeStatement: current.creativeStatement,
          coverAssetId: current.assets[0]!.id, assetOrder: current.assets.map(asset => asset.id),
          platformFields: current.platformFields,
        })
        setServerDraft(current)
      }
      await refreshContents()
    })
  }
  const removeImage = (assetId: string) => void act(async () => {
    const current = await flush()
    if (!current) return
    setServerDraft(await api<PublisherContent>('content-asset-delete', { id: current.id, assetId }))
    await refreshContents()
  })
  const reorder = (assetId: string, delta: number) => void act(async () => {
    const current = await flush()
    if (!current) return
    const order = current.assets.map(asset => asset.id)
    const index = order.indexOf(assetId)
    const target = index + delta
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    setServerDraft(await api<PublisherContent>('content-save', {
      id: current.id, revision: current.revision, title: current.title, body: current.body,
      summary: current.summary, tags: current.tags, creativeStatement: current.creativeStatement,
      coverAssetId: current.coverAssetId, assetOrder: order, platformFields: current.platformFields,
    }))
    await refreshContents()
  })

  const supportedPlatforms = useMemo(() => PLATFORMS.filter(platform =>
    capabilities.some(item => item.platform === platform && item.modes[contentType]?.length)), [capabilities, contentType])
  const selectedAccounts = supportedPlatforms.flatMap(platform => accounts.filter(account => account.id === selection[platform]))
  const submitReady = supportedPlatforms.length > 0 && selectedAccounts.length > 0
  const requestConfirm = () => void act(async () => {
    const current = await flush()
    if (!current?.title.trim()) throw new Error('请填写标题')
    if (contentType === 'article' && !current.body.trim()) throw new Error('请填写正文')
    if (contentType === 'image-note' && current.assets.length === 0) throw new Error('图文至少添加一张图片')
    if (!submitReady) throw new Error('请选择支持此类型的发布账号')
    for (const account of selectedAccounts) {
      const capability = capabilities.find(item => item.platform === account.platform)
      if (!capability?.modes[contentType]?.includes(mode)) throw new Error(`${PLATFORM_LABELS[account.platform]}暂不支持此提交方式`)
      const titleLimit = capability.maxTitleLength?.[contentType]
      if (titleLimit && current.title.length > titleLimit) throw new Error(`${PLATFORM_LABELS[account.platform]}标题不能超过 ${titleLimit} 字`)
      const assetLimit = capability.maxAssets?.[contentType]
      if (assetLimit && current.assets.length > assetLimit) throw new Error(`${PLATFORM_LABELS[account.platform]}当前最多支持 ${assetLimit} 张图片`)
      if (contentType === 'article' && current.assets.length && !current.coverAssetId) throw new Error('请为文章选择封面图片')
      for (const field of capability.requiredFields[contentType] ?? []) {
        if (!current.platformFields[account.platform]?.[field]?.trim()) throw new Error(`请填写${PLATFORM_LABELS[account.platform]}的${FIELD_LABELS[field] || field}`)
      }
    }
    setConfirm(true)
  })
  const submit = () => void act(async () => {
    const current = await flush()
    if (!current) throw new Error('请先创建草稿')
    await api<CreateSubmissionResult>('submissions', {
      contentType, contentId: current.id, revision: current.revision,
      mode, accountIds: selectedAccounts.map(account => account.id),
    })
    setConfirm(false)
    showSuccess('已提交，请稍后到平台后台确认。')
  })

  return <div>
    <div className="pub-drafts">
      <select className="pub-input" aria-label="选择本地草稿" value={draft?.id ?? ''} onChange={event => selectDraft(event.target.value)}>
        <option value="">选择本地草稿</option>
        {contents.map(item => <option key={item.id} value={item.id}>{item.title || '未命名草稿'} · {new Date(item.updatedAt).toLocaleString()}</option>)}
      </select>
      <button className="pub-secondary" disabled={busy} onClick={create}>新建</button>
      <button className="pub-secondary" disabled={busy || !draft} onClick={duplicate}>复制</button>
      <button className="pub-danger" disabled={busy || !draft} onClick={remove}>删除</button>
      <span className={saveError ? 'pub-warn' : 'pub-muted'}>{saveError ? '自动保存失败，请继续编辑以重试' : dirtyRef.current ? '自动保存中…' : '本地草稿自动保存'}</span>
    </div>
    {!draft ? <div className="pub-empty">点击“新建”开始编辑{contentType === 'article' ? '文章' : '图文'}。</div> : <div className="pub-grid">
      <div>
        <div className="pub-card"><h2>{contentType === 'article' ? '文章内容' : '图文内容'}</h2>
          <div className="pub-field"><label htmlFor={`pub-${contentType}-title`}>标题</label><input className="pub-input" id={`pub-${contentType}-title`} maxLength={TITLE_MAX} value={draft.title} onChange={event => update({ title: event.target.value })}/></div>
          {contentType === 'article' && <div className="pub-actions" style={{ marginBottom: 12 }}>
            <button className="pub-secondary" aria-pressed={!preview} onClick={() => setPreview(false)}>Markdown 编辑</button>
            <button className="pub-secondary" aria-pressed={preview} onClick={() => setPreview(true)}>预览</button>
            <label className="pub-secondary">导入 .md/.txt<input type="file" accept=".md,.txt,text/markdown,text/plain" style={{ display: 'none' }} onChange={event => { importText(event.target.files?.[0]); event.target.value = '' }}/></label>
          </div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-body`}>{contentType === 'article' ? '正文' : '正文 / 话题'}</label>
            {preview && contentType === 'article' ? <MarkdownPreview value={draft.body}/> : <textarea className={`pub-input ${contentType === 'article' ? 'pub-editor' : ''}`} id={`pub-${contentType}-body`} value={draft.body} onChange={event => update({ body: event.target.value })}/>}
          </div>
          {contentType === 'article' && <div className="pub-field"><label htmlFor="pub-article-summary">摘要</label><textarea className="pub-input" id="pub-article-summary" maxLength={2000} value={draft.summary} onChange={event => update({ summary: event.target.value })}/></div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-tags`}>标签（最多 {MAX_TAGS} 个）</label><input className="pub-input" id={`pub-${contentType}-tags`} value={tagsInput} onChange={event => { setTagsInput(event.target.value); update({ tags: event.target.value.split(/[,，\s]+/u).filter(Boolean).slice(0, MAX_TAGS) }) }}/></div>
          <div className="pub-field"><label htmlFor={`pub-${contentType}-statement`}>AI 内容声明</label><select className="pub-input" id={`pub-${contentType}-statement`} value={draft.creativeStatement} onChange={event => update({ creativeStatement: event.target.value as PublisherContent['creativeStatement'] })}>{CREATIVE_STATEMENTS.map(value => <option key={value} value={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
        </div>
        <div className="pub-card"><h2>{contentType === 'article' ? '封面与正文图片' : '图片素材与排序'}</h2>
          <label className="pub-secondary">添加图片<input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={event => { addImages(event.target.files); event.target.value = '' }}/></label>
          <p className="pub-muted">仅支持 JPEG / PNG / WebP；每张不超过 20MB，最多 20 张。</p>
          {contentType === 'article' && <p className="pub-muted">首批文章平台目前只接受单张封面；正文插图仍在适配与验收中。</p>}
          <div className="pub-assets">{draft.assets.map((asset, index) => <div className="pub-asset" key={asset.id}>
            <img src={`${API}/content-asset/${draft.id}/${asset.id}`} alt={asset.name}/><small>{String(index + 1).padStart(2, '0')} · {asset.name}</small>
            {contentType === 'article' && <label><input type="radio" name={`cover-${draft.id}`} checked={draft.coverAssetId === asset.id} onChange={() => update({ coverAssetId: asset.id })}/>封面</label>}
            <div className="pub-actions"><button className="pub-secondary" disabled={index === 0 || busy} onClick={() => reorder(asset.id, -1)}>↑</button><button className="pub-secondary" disabled={index === draft.assets.length - 1 || busy} onClick={() => reorder(asset.id, 1)}>↓</button><button className="pub-danger" disabled={busy} onClick={() => removeImage(asset.id)}>删除</button></div>
          </div>)}</div>
        </div>
      </div>
      <div>
        <div className="pub-card"><h2>选择平台账号</h2>
          {supportedPlatforms.length === 0 ? <p className="pub-muted">此内容类型正在建设与验收中。草稿可先保存，平台通过验收后才能提交。</p> : supportedPlatforms.map(platform =>
            <PlatformAccountSelect key={platform} platform={platform} accounts={accounts} value={selection[platform] ?? ''} onChange={id => setSelection(current => ({ ...current, [platform]: id || undefined }))}/>)}
          {selectedAccounts.map(account => {
            const fields = capabilities.find(item => item.platform === account.platform)?.requiredFields[contentType] ?? []
            return fields.map(field => <div className="pub-field" key={`${account.platform}:${field}`}>
              <label htmlFor={`pub-field-${account.platform}-${field}`}>{PLATFORM_LABELS[account.platform]} · {FIELD_LABELS[field] || field}</label>
              <input className="pub-input" id={`pub-field-${account.platform}-${field}`} value={draft.platformFields[account.platform]?.[field] ?? ''} onChange={event => update({ platformFields: { ...draft.platformFields, [account.platform]: { ...draft.platformFields[account.platform], [field]: event.target.value } } })}/>
            </div>)
          })}
        </div>
        <div className="pub-card"><h2>提交方式</h2><div className="pub-mode">
          <label><input type="radio" name={`pub-mode-${contentType}`} checked={mode === 'publish'} onChange={() => setMode('publish')}/>立即发布</label>
          <label><input type="radio" name={`pub-mode-${contentType}`} checked={mode === 'draft'} onChange={() => setMode('draft')}/>转存草稿</label>
        </div></div>
        <button className="pub-primary pub-submit" disabled={busy || !submitReady} onClick={requestConfirm}>检查并提交</button>
        <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。</p>
      </div>
    </div>}
    {confirm && draft && <ConfirmDialog contentType={contentType} title={draft.title} mode={mode} accounts={selectedAccounts} busy={busy} onCancel={() => setConfirm(false)} onConfirm={submit}/>}
  </div>
}
