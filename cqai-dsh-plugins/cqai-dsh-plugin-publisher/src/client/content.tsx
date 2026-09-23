import { useEffect, useMemo, useRef, useState } from 'react'
import {
  API, CREATIVE_STATEMENTS, MAX_TAGS, PLATFORMS, PLATFORM_LABELS, TITLE_MAX,
  type CreateSubmissionResult, type Platform, type PublisherAccount,
  type PublisherCapability, type PublisherContent, type PublisherPlatformCapability,
} from '../protocol.ts'
import {
  api, capabilityMessage, ConfirmDialog, DraftToolbar, errorMessage, PlatformAccountSelect, STATEMENT_LABELS, uploadAsset,
} from './shared.tsx'
import { contentSubmissionError } from '../submission-validation.ts'
import { usePublisherTips } from './tips.tsx'

function MarkdownPreview({ value }: { value: string }) {
  const inline = (line: string) => {
    const nodes: React.ReactNode[] = []
    const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/gu
    let offset = 0
    for (const match of line.matchAll(tokens)) {
      const index = match.index ?? 0
      if (index > offset) nodes.push(line.slice(offset, index))
      const token = match[0]
      if (token.startsWith('`')) nodes.push(<code key={index}>{token.slice(1, -1)}</code>)
      else if (token.startsWith('**')) nodes.push(<strong key={index}>{token.slice(2, -2)}</strong>)
      else nodes.push(<em key={index}>{token.slice(1, -1)}</em>)
      offset = index + token.length
    }
    if (offset < line.length) nodes.push(line.slice(offset))
    return nodes
  }
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
      const text = inline(heading[2])
      blocks.push(heading[1].length === 1 ? <h1 key={index}>{text}</h1> : heading[1].length === 2 ? <h2 key={index}>{text}</h2> : <h3 key={index}>{text}</h3>)
      continue
    }
    if (/^[-*]\s+/u.test(line)) { blocks.push(<p key={index}>• {inline(line.slice(2))}</p>); continue }
    const ordered = /^\d+\.\s+(.+)$/u.exec(line)
    if (ordered) { blocks.push(<p key={index}>{inline(line)}</p>); continue }
    if (/^>\s?/u.test(line)) { blocks.push(<blockquote key={index}>{inline(line.replace(/^>\s?/u, ''))}</blockquote>); continue }
    if (/^---+\s*$/u.test(line)) { blocks.push(<hr key={index}/>); continue }
    blocks.push(<p key={index}>{line ? inline(line) : '\u00a0'}</p>)
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
  const busyRef = useRef(false)
  const [confirm, setConfirm] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [draggedAssetId, setDraggedAssetId] = useState<string>()
  const [runtimeCapability, setRuntimeCapability] = useState<PublisherCapability>()

  const refreshContents = async (): Promise<PublisherContent[]> => {
    const rows = await api<PublisherContent[]>('contents')
    const matches = rows.filter(item => item.contentType === contentType)
    setContents(matches)
    return matches
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
    const selectedAtStart = draftRef.current?.id
    void api<PublisherContent[]>('contents').then(rows => {
      if (!live || draftRef.current?.id !== selectedAtStart) return
      const matches = rows.filter(item => item.contentType === contentType)
      setContents(matches)
      if (!draftRef.current) setServerDraft(matches[0])
      else {
        const persisted = matches.find(item => item.id === draftRef.current?.id)
        if (!persisted) setServerDraft(matches[0])
        else if (!dirtyRef.current && !saveTask.current && persisted.revision > draftRef.current.revision) setServerDraft(persisted)
      }
    }).catch(cause => { if (live) showError(errorMessage(cause)) })
    return () => { live = false }
  }, [contentType, active])
  useEffect(() => {
    if (!active) return
    let live = true
    void api<PublisherCapability>('capability').then(value => {
      if (live) setRuntimeCapability(value)
    }).catch(cause => { if (live) showError(errorMessage(cause)) })
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
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); clearTip()
    try { await task() } catch (cause) { showError(errorMessage(cause)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const selectDraft = (id: string) => void act(async () => {
    await flush()
    const selected = await api<PublisherContent>(`content/${id}`)
    if (selected.contentType !== contentType) throw new Error('草稿内容类型不匹配')
    setServerDraft(selected)
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
    const id = draftRef.current?.id
    if (!id || !window.confirm('删除这份本地草稿？已经提交的内容快照不受影响。')) return
    void act(async () => {
      // Explicit deletion discards unsaved edits, even when a previous autosave failed.
      try { if (saveTask.current) await saveTask.current } catch { /* discard failed save */ }
      const wasDirty = dirtyRef.current
      dirtyRef.current = false
      try { await api('content-delete', { id }) }
      catch (cause) { dirtyRef.current = wasDirty; throw cause }
      setServerDraft(undefined)
      const remaining = await refreshContents()
      setServerDraft(remaining[0])
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
    update({ body: text, title: draftRef.current!.title || file.name.replace(/\.(md|txt)$/iu, '').slice(0, TITLE_MAX) })
    showSuccess('已导入编辑器，草稿会自动保存。')
  })
  const addImages = (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    if (!selected.length) return
    void act(async () => {
      for (const file of selected) {
        if (file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('单张图片必须大于 0 且不超过 20MB')
        if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPEG、PNG、WebP 图片')
      }
      let current = await flush()
      const limit = Math.min(20, ...selectedAccounts.map(account =>
        capabilities.find(item => item.platform === account.platform)?.maxAssets?.[contentType] ?? 20))
      if ((current?.assets.length ?? 0) + selected.length > limit) throw new Error(`当前最多支持 ${limit} 张图片`)
      if (!current) {
        current = await api<PublisherContent>('contents', { contentType })
        setServerDraft(current)
        await refreshContents()
      }
      let uploaded = 0
      try {
        for (const file of selected) {
          current = await uploadAsset(current.id, file)
          setServerDraft(current)
          uploaded += 1
        }
      } catch (cause) {
        if (uploaded > 0) throw new Error(`已保存前 ${uploaded} 张图片，其余上传失败：${errorMessage(cause)}`)
        throw cause
      } finally {
        await refreshContents()
      }
    })
  }
  const removeImage = (assetId: string) => void act(async () => {
    const current = await flush()
    if (!current) return
    setServerDraft(await api<PublisherContent>('content-asset-delete', { id: current.id, assetId }))
    await refreshContents()
  })
  const moveAsset = (assetId: string, target: number) => void act(async () => {
    const current = await flush()
    if (!current) return
    const order = current.assets.map(asset => asset.id)
    const index = order.indexOf(assetId)
    if (index < 0 || target < 0 || target >= order.length || index === target) return
    order.splice(index, 1)
    order.splice(target, 0, assetId)
    setServerDraft(await api<PublisherContent>('content-save', {
      id: current.id, revision: current.revision, title: current.title, body: current.body,
      summary: current.summary, tags: current.tags, creativeStatement: current.creativeStatement,
      coverAssetId: current.coverAssetId, assetOrder: order, platformFields: current.platformFields,
    }))
    await refreshContents()
  })
  const reorder = (assetId: string, delta: number) => {
    const index = draftRef.current?.assets.findIndex(asset => asset.id === assetId) ?? -1
    if (index >= 0) moveAsset(assetId, index + delta)
  }

  const supportedPlatforms = useMemo(() => PLATFORMS.filter(platform =>
    capabilities.some(item => item.platform === platform && item.modes[contentType]?.length)), [capabilities, contentType])
  const selectedAccounts = supportedPlatforms.flatMap(platform => accounts.filter(account => account.id === selection[platform]))
  const submitReady = supportedPlatforms.length > 0 && selectedAccounts.length > 0
  const titleLimit = Math.min(TITLE_MAX, ...selectedAccounts.map(account =>
    capabilities.find(item => item.platform === account.platform)?.maxTitleLength?.[contentType] ?? TITLE_MAX))
  const assetLimit = Math.min(20, ...selectedAccounts.map(account =>
    capabilities.find(item => item.platform === account.platform)?.maxAssets?.[contentType] ?? 20))
  const enteredTags = [...new Set(tagsInput.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))]
  const validationError = draft && selectedAccounts.length > 0
    ? contentSubmissionError(draft, selectedAccounts, capabilities, mode) : undefined
  const requestConfirm = () => void act(async () => {
    const current = await flush()
    if (!current) throw new Error('请先创建草稿')
    const error = contentSubmissionError(current, selectedAccounts, capabilities, mode)
    if (error) throw new Error(error)
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
    {runtimeCapability && !runtimeCapability.supported && <div className="pub-error">{capabilityMessage(runtimeCapability)}。本地草稿仍可编辑。</div>}
    <DraftToolbar contents={contents} draft={draft} busy={busy} dirty={dirtyRef.current} saveError={saveError}
      onSelect={selectDraft} onCreate={create} onCopy={duplicate} onDelete={remove}/>
    {!draft ? <div className="pub-empty">点击“新建”开始编辑{contentType === 'article' ? '文章' : '图文'}。</div> : <div className="pub-grid">
      <div>
        <div className="pub-card"><h2>{contentType === 'article' ? '文章内容' : '图文内容'}</h2>
          <div className="pub-field"><label htmlFor={`pub-${contentType}-title`}>标题 <span className={draft.title.length > titleLimit ? 'pub-warn' : 'pub-muted'}>（{draft.title.length}/{titleLimit} 字）</span></label><input className="pub-input" id={`pub-${contentType}-title`} maxLength={TITLE_MAX} value={draft.title} onChange={event => update({ title: event.target.value })}/></div>
          {contentType === 'article' && <div className="pub-actions" style={{ marginBottom: 12 }}>
            <button className="pub-secondary" aria-pressed={!preview} onClick={() => setPreview(false)}>Markdown 编辑</button>
            <button className="pub-secondary" aria-pressed={preview} onClick={() => setPreview(true)}>简易预览</button>
            <label className="pub-secondary">导入 .md/.txt<input type="file" accept=".md,.txt,text/markdown,text/plain" style={{ display: 'none' }} onChange={event => { importText(event.target.files?.[0]); event.target.value = '' }}/></label>
          </div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-body`}>{contentType === 'article' ? '正文' : '正文 / 话题'}</label>
            {preview && contentType === 'article' ? <MarkdownPreview value={draft.body}/> : <textarea className={`pub-input ${contentType === 'article' ? 'pub-editor' : ''}`} id={`pub-${contentType}-body`} value={draft.body} onChange={event => update({ body: event.target.value })}/>}
          </div>
          {contentType === 'article' && preview && <p className="pub-muted">这里只预览基础 Markdown 排版；实际平台编辑器呈现可能不同，原始正文不会被预览修改。</p>}
          {contentType === 'article' && <div className="pub-field"><label htmlFor="pub-article-summary">摘要</label><textarea className="pub-input" id="pub-article-summary" maxLength={2000} value={draft.summary} onChange={event => update({ summary: event.target.value })}/></div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-tags`}>标签（{draft.tags.length}/{MAX_TAGS} 个，用空格或逗号分隔）</label><input className="pub-input" id={`pub-${contentType}-tags`} value={tagsInput} onChange={event => { setTagsInput(event.target.value); update({ tags: [...new Set(event.target.value.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))].slice(0, MAX_TAGS) }) }}/></div>
          {enteredTags.length > MAX_TAGS && <p className="pub-warn">超过 {MAX_TAGS} 个标签，超出的标签不会保存。</p>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-statement`}>AI 内容声明</label><select className="pub-input" id={`pub-${contentType}-statement`} value={draft.creativeStatement} onChange={event => update({ creativeStatement: event.target.value as PublisherContent['creativeStatement'] })}>{CREATIVE_STATEMENTS.map(value => <option key={value} value={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
        </div>
        <div className="pub-card"><h2>{contentType === 'article' ? '封面图片' : '图片素材与排序'}</h2>
          <label className="pub-secondary">添加图片<input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={event => { addImages(event.target.files); event.target.value = '' }}/></label>
          <p className="pub-muted">{draft.assets.length}/{assetLimit} 张 · 仅支持 JPEG / PNG / WebP，每张不超过 20MB。{contentType === 'image-note' ? '可拖动排序，也可使用 ↑ ↓ 按钮。' : ''}</p>
          {contentType === 'article' && <p className="pub-muted">首批文章平台目前只接受单张封面；正文插图仍在适配与验收中。</p>}
          <div className="pub-assets">{draft.assets.map((asset, index) => <div className={`pub-asset${draggedAssetId === asset.id ? ' pub-asset-dragging' : ''}`} key={asset.id}
            draggable={contentType === 'image-note' && !busy}
            onDragStart={event => { if (contentType === 'image-note') { event.dataTransfer.effectAllowed = 'move'; setDraggedAssetId(asset.id) } }}
            onDragOver={event => { if (contentType === 'image-note' && draggedAssetId) event.preventDefault() }}
            onDrop={event => { event.preventDefault(); if (draggedAssetId && draggedAssetId !== asset.id) moveAsset(draggedAssetId, index); setDraggedAssetId(undefined) }}
            onDragEnd={() => setDraggedAssetId(undefined)}>
            <img src={`${API}/content-asset/${draft.id}/${asset.id}`} alt={asset.name}/><small>{String(index + 1).padStart(2, '0')} · {asset.name}</small>
            {contentType === 'article' && <label><input type="radio" name={`cover-${draft.id}`} checked={draft.coverAssetId === asset.id} onChange={() => update({ coverAssetId: asset.id })}/>封面</label>}
            <div className="pub-actions"><button className="pub-secondary" disabled={index === 0 || busy} onClick={() => reorder(asset.id, -1)}>↑</button><button className="pub-secondary" disabled={index === draft.assets.length - 1 || busy} onClick={() => reorder(asset.id, 1)}>↓</button><button className="pub-danger" disabled={busy} onClick={() => removeImage(asset.id)}>删除</button></div>
          </div>)}</div>
        </div>
      </div>
      <div>
        <div className="pub-card"><h2>选择平台账号</h2>
          {supportedPlatforms.length === 0 ? <p className="pub-muted">{contentType === 'article' ? '掘金、B站专栏' : '小红书图文'}适配器仍在真实平台验收中。草稿可先编辑保存，验收通过前不能提交。</p> : supportedPlatforms.map(platform =>
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
        {validationError && <p className="pub-warn" role="status">提交前需补齐：{validationError}</p>}
        <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。</p>
      </div>
    </div>}
    {confirm && draft && <ConfirmDialog contentType={contentType} title={draft.title} mode={mode} accounts={selectedAccounts} busy={busy} onCancel={() => setConfirm(false)} onConfirm={submit}/>}
  </div>
}
