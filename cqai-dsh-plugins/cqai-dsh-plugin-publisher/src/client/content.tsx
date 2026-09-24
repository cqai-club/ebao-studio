import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  API, CREATIVE_STATEMENTS, MAX_TAGS, PLATFORM_LABELS, TITLE_MAX,
  type CreateSubmissionResult, type Platform, type PublisherAccount,
  type PublisherCapability, type PublisherContent, type PublisherPlatformCapability,
} from '../protocol.ts'
import { CONTENT_ACCOUNT_PLATFORMS, contentModeAvailable, selectedContentAccounts } from '../content-targets.ts'
import {
  api, capabilityMessage, ConfirmDialog, DraftToolbar, errorMessage, PlatformAccountSelect, PublisherModal, STATEMENT_LABELS, uploadAsset,
  type PublisherConfirmation,
} from './shared.tsx'
import { contentSubmissionError } from '../submission-validation.ts'
import { usePublisherTips } from './tips.tsx'
import { articleUploadFile } from './article-image.ts'

function MarkdownPreview({ value, content }: { value: string; content: PublisherContent }) {
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
    const image = /^!\[([^\]]*)\]\(ebao-asset:\/\/([0-9a-f-]{36})\)$/iu.exec(line.trim())
    if (image && content.assets.some(asset => asset.id === image[2])) {
      blocks.push(<figure key={index}><img src={`${API}/content-asset/${content.id}/${image[2]}`} alt={image[1]}/><figcaption>{image[1]}</figcaption></figure>)
      continue
    }
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
  const bodyInputRef = useRef<HTMLTextAreaElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const dirtyRef = useRef(false)
  const saveTask = useRef<Promise<void>>()
  const [editVersion, setEditVersion] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [capabilities, setCapabilities] = useState<PublisherPlatformCapability[]>([])
  const [accountsPending, setAccountsPending] = useState(true)
  const [capabilitiesPending, setCapabilitiesPending] = useState(true)
  const [accountsError, setAccountsError] = useState('')
  const [capabilitiesError, setCapabilitiesError] = useState('')
  const [selection, setSelection] = useState<Partial<Record<Platform, string>>>({})
  const [mode, setMode] = useState<Mode>('publish')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [confirm, setConfirm] = useState<PublisherConfirmation>()
  const [deleteDraftId, setDeleteDraftId] = useState<string>()
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
    setAccountsPending(true)
    setCapabilitiesPending(true)
    void api<PublisherCapability>('capability').then(value => {
      if (live) setRuntimeCapability(value)
    }).catch(cause => { if (live) showError(errorMessage(cause)) })
    void api<PublisherAccount[]>('accounts').then(rows => {
      if (live) { setAccounts(rows); setAccountsError(''); setAccountsPending(false) }
    }).catch(cause => {
      if (live) { setAccounts([]); setAccountsError(errorMessage(cause)); setAccountsPending(false) }
    })
    void api<PublisherPlatformCapability[]>('platform-capabilities').then(rows => {
      if (live) { setCapabilities(rows); setCapabilitiesError(''); setCapabilitiesPending(false) }
    }).catch(cause => {
      if (live) { setCapabilities([]); setCapabilitiesError(errorMessage(cause)); setCapabilitiesPending(false) }
    })
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
    if (id) setDeleteDraftId(id)
  }
  const confirmRemove = () => {
    const id = deleteDraftId
    if (!id) return
    void act(async () => {
      // Explicit deletion discards unsaved edits, even when a previous autosave failed.
      try { if (saveTask.current) await saveTask.current } catch { /* discard failed save */ }
      const wasDirty = dirtyRef.current
      dirtyRef.current = false
      try { await api('content-delete', { id }) }
      catch (cause) { dirtyRef.current = wasDirty; throw cause }
      setDeleteDraftId(undefined)
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
          current = await uploadAsset(current.id, contentType === 'article' ? await articleUploadFile(file) : file)
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
  const insertImage = (assetId: string, name: string) => {
    const current = draftRef.current
    if (!current || contentType !== 'article') return
    const textarea = bodyInputRef.current
    const start = textarea?.selectionStart ?? current.body.length
    const end = textarea?.selectionEnd ?? start
    const label = name.replace(/[\[\]\\\r\n]/gu, ' ').trim().slice(0, 80) || '图片'
    const marker = `![${label}](ebao-asset://${assetId})`
    const before = current.body.slice(0, start)
    const after = current.body.slice(end)
    const insertion = `${before && !before.endsWith('\n') ? '\n' : ''}${marker}${after && !after.startsWith('\n') ? '\n' : ''}`
    const cursor = before.length + insertion.length
    setPreview(false)
    update({ body: before + insertion + after })
    requestAnimationFrame(() => {
      bodyInputRef.current?.focus()
      bodyInputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
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

  const accountPlatforms = CONTENT_ACCOUNT_PLATFORMS[contentType]
  const selectedAccounts = selectedContentAccounts(contentType, accounts, selection)
  const unavailableTargets = selectedAccounts.filter(account =>
    !contentModeAvailable(account.platform, contentType, mode, capabilities))
  const submitReady = runtimeCapability?.supported === true && !accountsPending && !capabilitiesPending
    && selectedAccounts.length > 0 && unavailableTargets.length === 0
  const titleLimit = Math.min(TITLE_MAX, ...selectedAccounts.map(account =>
    capabilities.find(item => item.platform === account.platform)?.maxTitleLength?.[contentType] ?? TITLE_MAX))
  const assetLimit = Math.min(20, ...selectedAccounts.map(account =>
    capabilities.find(item => item.platform === account.platform)?.maxAssets?.[contentType] ?? 20))
  const enteredTags = [...new Set(tagsInput.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))]
  const skippedArticleTagTargets = contentType === 'article'
    ? selectedAccounts.filter(account => account.platform === 'wxmp' || account.platform === 'tt' || account.platform === 'bjh')
    : []
  const validationError = draft && selectedAccounts.length > 0 && !capabilitiesPending && !capabilitiesError
    ? contentSubmissionError(draft, selectedAccounts, capabilities, mode) : undefined
  const requestConfirm = () => void act(async () => {
    const current = await flush()
    if (!current) throw new Error('请先创建草稿')
    const error = contentSubmissionError(current, selectedAccounts, capabilities, mode)
    if (error) throw new Error(error)
    setConfirm({ contentId: current.id, title: current.title, mode, accounts: selectedAccounts })
  })
  const submit = () => void act(async () => {
    if (!confirm) return
    const current = await flush()
    if (!current || current.id !== confirm.contentId) throw new Error('草稿已切换，请重新检查后提交')
    await api<CreateSubmissionResult>('submissions', {
      contentType, contentId: current.id, revision: current.revision,
      mode: confirm.mode, accountIds: confirm.accounts.map(account => account.id),
    })
    setConfirm(undefined)
    showSuccess('已提交，请稍后到平台后台确认。')
  })

  return <div>
    {runtimeCapability && !runtimeCapability.supported && <div className="pub-error">{capabilityMessage(runtimeCapability)}。本地草稿仍可编辑。</div>}
    <DraftToolbar contents={contents} draft={draft} busy={busy} dirty={dirtyRef.current} saveError={saveError}
      onSelect={selectDraft} onCreate={create} onCopy={duplicate} onDelete={remove}/>
    {!draft ? <div className="pub-empty">点击“新建”开始编辑{contentType === 'article' ? '文章' : '图文'}。</div> : <div className="pub-grid">
      <div>
        <div className="pub-card"><h2>{contentType === 'article' ? '文章内容' : '图文内容'}</h2>
          <div className="pub-field"><label htmlFor={`pub-${contentType}-title`}>标题 <span className={draft.title.length > titleLimit ? 'pub-warn' : 'pub-muted'}>（{draft.title.length}/{titleLimit} 字）</span></label><Input className="pub-text-input" id={`pub-${contentType}-title`} maxLength={TITLE_MAX} value={draft.title} onChange={event => update({ title: event.target.value })}/></div>
          {contentType === 'article' && <div className="pub-actions" style={{ marginBottom: 12 }}>
            <Button variant={!preview ? 'primary' : 'outline'} size="sm" aria-pressed={!preview} onClick={() => setPreview(false)}>Markdown 编辑</Button>
            <Button variant={preview ? 'primary' : 'outline'} size="sm" aria-pressed={preview} onClick={() => setPreview(true)}>简易预览</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => importInputRef.current?.click()}>导入 .md/.txt</Button>
            <input ref={importInputRef} type="file" accept=".md,.txt,text/markdown,text/plain" style={{ display: 'none' }} onChange={event => { importText(event.target.files?.[0]); event.target.value = '' }}/>
          </div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-body`}>{contentType === 'article' ? '正文' : '正文 / 话题'}</label>
            {preview && contentType === 'article' ? <MarkdownPreview value={draft.body} content={draft}/> : <textarea ref={bodyInputRef} className={`pub-input ${contentType === 'article' ? 'pub-editor' : ''}`} id={`pub-${contentType}-body`} value={draft.body} onChange={event => update({ body: event.target.value })}/>}
          </div>
          {contentType === 'article' && preview && <p className="pub-muted">这里只预览基础 Markdown 排版；实际平台编辑器呈现可能不同，原始正文不会被预览修改。</p>}
          {contentType === 'article' && <div className="pub-field"><label htmlFor="pub-article-summary">摘要</label><textarea className="pub-input" id="pub-article-summary" maxLength={2000} value={draft.summary} onChange={event => update({ summary: event.target.value })}/>{selectedAccounts.some(account => account.platform === 'tt') && <p className="pub-muted">头条当前不能写入独立摘要；若要转存头条草稿，请先清空此栏。需要其他平台保留摘要时请分开提交。</p>}</div>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-tags`}>标签（{draft.tags.length}/{MAX_TAGS} 个，用空格或逗号分隔）</label><Input className="pub-text-input" id={`pub-${contentType}-tags`} value={tagsInput} onChange={event => { setTagsInput(event.target.value); update({ tags: [...new Set(event.target.value.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))].slice(0, MAX_TAGS) }) }}/></div>
          {draft.tags.length > 0 && skippedArticleTagTargets.length > 0 && <p className="pub-muted">{skippedArticleTagTargets.map(account => PLATFORM_LABELS[account.platform]).join('、')}文章暂不写入标签，本次提交会跳过；草稿标签仍保留供其他平台使用。</p>}
          {enteredTags.length > MAX_TAGS && <p className="pub-warn">超过 {MAX_TAGS} 个标签，超出的标签不会保存。</p>}
          <div className="pub-field"><label htmlFor={`pub-${contentType}-statement`}>AI 内容声明</label><select className="pub-input" id={`pub-${contentType}-statement`} value={draft.creativeStatement} onChange={event => update({ creativeStatement: event.target.value as PublisherContent['creativeStatement'] })}>{CREATIVE_STATEMENTS.map(value => <option key={value} value={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
        </div>
        <div className="pub-card"><h2>{contentType === 'article' ? '封面图片' : '图片素材与排序'}</h2>
          <Button variant="outline" disabled={busy} onClick={() => imageInputRef.current?.click()}>添加图片</Button>
          <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={event => { addImages(event.target.files); event.target.value = '' }}/>
          <p className="pub-muted">{draft.assets.length}/{assetLimit} 张 · 仅支持 JPEG / PNG / WebP，每张不超过 20MB。{contentType === 'image-note' ? '可拖动排序，也可使用 ↑ ↓ 按钮。' : ''}</p>
          {contentType === 'article' && <p className="pub-muted">WebP 文章图片上传时自动转为 JPEG，可作为微信公众号封面；透明区域会变成白色。头条、百家号素材可插入正文，也可单独设为封面；掘金、B站专栏暂只支持单张封面。导入 Markdown 时不会读取相对路径图片，请先上传素材再插入。</p>}
          <div className="pub-assets">{draft.assets.map((asset, index) => <div className={`pub-asset${draggedAssetId === asset.id ? ' pub-asset-dragging' : ''}`} key={asset.id}
            draggable={contentType === 'image-note' && !busy}
            onDragStart={event => { if (contentType === 'image-note') { event.dataTransfer.effectAllowed = 'move'; setDraggedAssetId(asset.id) } }}
            onDragOver={event => { if (contentType === 'image-note' && draggedAssetId) event.preventDefault() }}
            onDrop={event => { event.preventDefault(); if (draggedAssetId && draggedAssetId !== asset.id) moveAsset(draggedAssetId, index); setDraggedAssetId(undefined) }}
            onDragEnd={() => setDraggedAssetId(undefined)}>
            <img src={`${API}/content-asset/${draft.id}/${asset.id}`} alt={asset.name}/><small>{String(index + 1).padStart(2, '0')} · {asset.name}</small>
            {contentType === 'article' && <label><input type="radio" name={`cover-${draft.id}`} checked={draft.coverAssetId === asset.id} onChange={() => update({ coverAssetId: asset.id })}/>封面</label>}
            <div className="pub-actions">{contentType === 'article' && <Button variant="outline" size="sm" disabled={busy} onClick={() => insertImage(asset.id, asset.name)}>插入正文</Button>}<Button variant="outline" size="sm" aria-label="上移图片" disabled={index === 0 || busy} onClick={() => reorder(asset.id, -1)}>↑</Button><Button variant="outline" size="sm" aria-label="下移图片" disabled={index === draft.assets.length - 1 || busy} onClick={() => reorder(asset.id, 1)}>↓</Button><Button variant="outline" size="sm" className="pub-danger-action" disabled={busy} onClick={() => removeImage(asset.id)}>删除</Button></div>
          </div>)}</div>
        </div>
      </div>
      <div>
        <div className="pub-card"><h2>选择平台账号</h2>
          {accountPlatforms.map(platform => <div key={platform}>
            <PlatformAccountSelect idPrefix={contentType} platform={platform} accounts={accounts} value={selection[platform] ?? ''} onChange={id => setSelection(current => ({ ...current, [platform]: id || undefined }))}/>
            {!capabilitiesPending && !capabilitiesError && !contentModeAvailable(platform, contentType, mode, capabilities) && <p className="pub-muted">当前发布引擎未提供{PLATFORM_LABELS[platform]}{mode === 'publish' ? '立即发布' : '转存草稿'}能力；请完全退出应用并使用最新 Helper 重启。</p>}
          </div>)}
          {accountsPending && <p className="pub-muted">正在加载平台账号…</p>}
          {accountsError ? <p className="pub-warn" role="status">账号加载失败：{accountsError}</p>
            : !accountsPending && !accounts.some(account => accountPlatforms.some(platform => platform === account.platform)) && <p className="pub-muted">还没有适用于当前内容类型的账号，请先到“平台账号管理”添加并登录。</p>}
          {capabilitiesPending && <p className="pub-muted">正在检查平台提交能力…</p>}
          {capabilitiesError && <p className="pub-warn" role="status">平台能力加载失败：{capabilitiesError}</p>}
          {selectedAccounts.map(account => {
            const fields = capabilities.find(item => item.platform === account.platform)?.requiredFields[contentType] ?? []
            return fields.map(field => <div className="pub-field" key={`${account.platform}:${field}`}>
              <label htmlFor={`pub-field-${account.platform}-${field}`}>{PLATFORM_LABELS[account.platform]} · {FIELD_LABELS[field] || field}</label>
              <Input className="pub-text-input" id={`pub-field-${account.platform}-${field}`} value={draft.platformFields[account.platform]?.[field] ?? ''} onChange={event => update({ platformFields: { ...draft.platformFields, [account.platform]: { ...draft.platformFields[account.platform], [field]: event.target.value } } })}/>
            </div>)
          })}
        </div>
        <div className="pub-card"><h2>提交方式</h2><div className="pub-mode">
          <label><input type="radio" name={`pub-mode-${contentType}`} checked={mode === 'publish'} onChange={() => setMode('publish')}/>立即发布</label>
          <label><input type="radio" name={`pub-mode-${contentType}`} checked={mode === 'draft'} onChange={() => setMode('draft')}/>转存草稿</label>
        </div></div>
        <Button variant="primary" className="pub-submit" disabled={busy || !submitReady} onClick={requestConfirm}>检查并提交</Button>
        {!capabilitiesPending && !capabilitiesError && unavailableTargets.length > 0 ? <p className="pub-warn" role="status">当前发布引擎缺少所选平台的提交能力，请更新 Helper 并完全重启应用；本地草稿仍会保存。</p>
          : validationError && <p className="pub-warn" role="status">提交前请处理：{validationError}</p>}
        <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。文章/图文适配仍需实际平台验证，建议先转存草稿并到对应账号后台核对。</p>
      </div>
    </div>}
    {confirm && <ConfirmDialog contentType={contentType} title={confirm.title} mode={confirm.mode} accounts={confirm.accounts} busy={busy} onCancel={() => setConfirm(undefined)} onConfirm={submit}/>}
    <PublisherModal open={deleteDraftId !== undefined} title="删除本地草稿" closeLabel="关闭删除草稿确认" description="删除这份本地草稿？已经提交的内容快照不受影响。" className="pub-modal" onClose={() => { if (!busyRef.current) setDeleteDraftId(undefined) }} footer={<><Button variant="outline" data-pub-initial-focus disabled={busy} onClick={() => { if (!busyRef.current) setDeleteDraftId(undefined) }}>取消</Button><Button variant="outline" className="pub-danger-action" disabled={busy} onClick={confirmRemove}>{busy ? '正在删除…' : '删除草稿'}</Button></>}/>
  </div>
}
