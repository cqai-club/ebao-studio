import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  API, CREATIVE_STATEMENTS, DESCRIPTION_MAX, MAX_TAGS, PLATFORM_LABELS, TITLE_MAX, VIDEO_PLATFORMS,
  type CreateSubmissionResult, type Platform, type PublisherAccount, type PublisherCapability,
  type PublisherContent, type PublisherLocalVideo, type Work,
} from '../protocol.ts'
import { api, capabilityMessage, ConfirmDialog, DraftToolbar, errorMessage, PublisherModal, STATEMENT_LABELS, type PublisherConfirmation } from './shared.tsx'
import { usePublisherTips } from './tips.tsx'
import { PublisherContentPreview } from './content-preview.tsx'

export function VideoPage({ active }: { active: boolean }) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [capability, setCapability] = useState<PublisherCapability>()
  const [works, setWorks] = useState<Work[]>([])
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [contents, setContents] = useState<PublisherContent[]>([])
  const [draft, setDraft] = useState<PublisherContent>()
  const draftRef = useRef<PublisherContent>()
  const dirtyRef = useRef(false)
  const saveTask = useRef<Promise<void>>()
  const [editVersion, setEditVersion] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [saveError, setSaveError] = useState('')
  const [mode, setMode] = useState<'publish' | 'draft'>('draft')
  const [selection, setSelection] = useState<Partial<Record<Platform, string>>>({})
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [confirm, setConfirm] = useState<PublisherConfirmation>()
  const [deleteDraftId, setDeleteDraftId] = useState<string>()

  const grouped = useMemo(() => Object.fromEntries(VIDEO_PLATFORMS.map(platform => [platform, accounts.filter(account => account.platform === platform)])) as Record<Platform, PublisherAccount[]>, [accounts])
  const selectedAccounts = VIDEO_PLATFORMS.flatMap(platform => {
    const id = selection[platform]
    return id ? accounts.filter(account => account.id === id) : []
  })

  const setServerDraft = (value: PublisherContent | undefined) => {
    draftRef.current = value
    dirtyRef.current = false
    setSaveError('')
    setDraft(value)
    setTagsInput(value?.tags.join(' ') ?? '')
  }
  const refreshContents = async (): Promise<PublisherContent[]> => {
    const rows = await api<PublisherContent[]>('contents')
    const matches = rows.filter(item => item.contentType === 'video')
    setContents(matches)
    return matches
  }

  useEffect(() => {
    if (!active) return
    let live = true
    void (async () => {
      const [value, availableWorks, rows] = await Promise.all([
        api<PublisherCapability>('capability'), api<Work[]>('works'), api<PublisherContent[]>('contents'),
      ])
      if (!live) return
      setCapability(value)
      setWorks(availableWorks)
      const drafts = rows.filter(item => item.contentType === 'video')
      setContents(drafts)
      if (!draftRef.current) setServerDraft(drafts[0])
      if (value.supported) {
        const accountRows = await api<PublisherAccount[]>('accounts')
        if (live) setAccounts(accountRows)
      }
    })().catch(cause => { if (live) showError(errorMessage(cause)) })
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
          id: current.id, revision: current.revision, title: current.title,
          body: '', summary: '', tags: current.tags, creativeStatement: current.creativeStatement,
          description: current.description ?? '', shortTitle: current.shortTitle ?? '',
          videoSource: current.videoSource,
        })
        if (draftRef.current?.id === current.id) {
          const merged = { ...draftRef.current, revision: saved.revision, updatedAt: saved.updatedAt }
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
    const next = await api<PublisherContent>(`content/${id}`)
    if (next.contentType !== 'video') throw new Error('草稿内容类型不匹配')
    setServerDraft(next)
  })
  const create = () => void act(async () => {
    await flush()
    setServerDraft(await api<PublisherContent>('contents', { contentType: 'video' }))
    await refreshContents()
  })
  const duplicate = () => void act(async () => {
    const current = await flush()
    if (!current) return
    setServerDraft(await api<PublisherContent>('content-copy', { id: current.id }))
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

  const chooseWork = (work: Work) => {
    update({ videoSource: { kind: 'work', workId: work.id }, title: work.title,
      description: work.description, shortTitle: '', tags: work.tags,
      creativeStatement: work.aiGeneratedDisclosure ? 'ai_generated' : 'none' })
    setTagsInput(work.tags.join(' '))
    clearTip()
  }
  const chooseLocalVideo = () => void act(async () => {
    const selected = await api<PublisherLocalVideo | null>('local-video-select', {})
    if (!selected) return
    update({ videoSource: { kind: 'local', localVideoId: selected.id, fileName: selected.fileName, bytes: selected.bytes },
      title: selected.title, description: '', shortTitle: '', tags: [], creativeStatement: 'none' })
    setTagsInput('')
  })

  const requestConfirm = () => void act(async () => {
    const current = await flush()
    if (!current?.videoSource) throw new Error('请先选择一条 e剪宝成片或一个本地视频')
    if (!current.title.trim()) throw new Error('请填写标题')
    if (selectedAccounts.length === 0) throw new Error('请至少选择一个发布账号')
    const videoSource = current.videoSource
    setConfirm({ contentId: current.id, title: current.title, mode, accounts: selectedAccounts,
      sourceName: videoSource.kind === 'local' ? videoSource.fileName
        : works.find(work => work.id === videoSource.workId)?.title })
  })
  const submit = () => void act(async () => {
    if (!confirm) return
    const current = await flush()
    if (!current || current.id !== confirm.contentId) throw new Error('草稿已切换，请重新检查后提交')
    await api<CreateSubmissionResult>('submissions', {
      contentType: 'video', contentId: current.id, revision: current.revision,
      mode: confirm.mode, accountIds: confirm.accounts.map(account => account.id),
    })
    setConfirm(undefined)
    showSuccess('已提交，请稍后到平台后台确认。')
  })

  const source = draft?.videoSource
  const videoPreviewUrl = source && `${API}/video-preview/${source.kind}/${encodeURIComponent(source.kind === 'work' ? source.workId : source.localVideoId)}`
  const videoSourceName = source?.kind === 'local' ? source.fileName
    : source?.kind === 'work' ? works.find(work => work.id === source.workId)?.title ?? 'e剪宝成片' : undefined
  const unavailable = capabilityMessage(capability)
  return <div>
    {unavailable && <div className="pub-error">{unavailable}</div>}
    <DraftToolbar contents={contents} draft={draft} busy={busy} dirty={dirtyRef.current} saveError={saveError}
      onSelect={selectDraft} onCreate={create} onCopy={duplicate} onDelete={remove}/>
    {!draft ? <div className="pub-empty">点击“新建”开始编辑视频发布内容。</div> : <div className="pub-grid"><div><div className="pub-card"><h2><span className="pub-count">01</span>选择视频素材</h2>
      <h3>e剪宝成片</h3>
      {works.length === 0 ? <p className="pub-muted">暂无 e剪宝成片，也可以直接选择本地视频。</p> : works.map(work => <button className="pub-work" aria-pressed={source?.kind === 'work' && source.workId === work.id} key={work.id} onClick={() => chooseWork(work)}><strong>{work.title}</strong><small>{new Date(work.createdAt).toLocaleString()} · {(work.bytes / 1048576).toFixed(1)} MB</small></button>)}
      {source?.kind === 'work' && !works.some(work => work.id === source.workId) && <p className="pub-warn">原 e剪宝成片已不可用，请重新选择。</p>}
      <h3>本地视频</h3>
      <Button variant="outline" disabled={busy || capability?.supported !== true} onClick={chooseLocalVideo}>选择本地文件…</Button>
      {source?.kind === 'local' && <div className="pub-work" aria-label="已选择的本地视频"><strong>{source.fileName}</strong><small>{(source.bytes / 1048576).toFixed(1)} MB · 已选择</small></div>}
      <p className="pub-muted">目前支持 MP4；本地草稿只保存文件引用，不复制视频。提交后请保留原文件，直到平台后台确认。</p>
    </div><div className="pub-card"><h2>内容预览</h2><PublisherContentPreview content={draft} videoSourceName={videoSourceName} videoPreviewUrl={videoPreviewUrl}/></div><div className="pub-card"><h2><span className="pub-count">02</span>发布内容</h2>
      <div className="pub-field"><label htmlFor="pub-title">标题</label><Input id="pub-title" className="pub-text-input" maxLength={TITLE_MAX} value={draft.title} onChange={event => update({ title: event.target.value })}/></div>
      <div className="pub-field"><label htmlFor="pub-description">简介</label><textarea id="pub-description" className="pub-input" maxLength={DESCRIPTION_MAX} value={draft.description ?? ''} onChange={event => update({ description: event.target.value })}/></div>
      <div className="pub-field"><label htmlFor="pub-tags">话题（最多 {MAX_TAGS} 个）</label><Input id="pub-tags" className="pub-text-input" value={tagsInput} onChange={event => { setTagsInput(event.target.value); update({ tags: [...new Set(event.target.value.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))].slice(0, MAX_TAGS) }) }} placeholder="用空格或逗号分隔"/></div>
      <div className="pub-field"><label htmlFor="pub-short-title">视频号短标题</label><Input id="pub-short-title" className="pub-text-input" maxLength={32} value={draft.shortTitle ?? ''} onChange={event => update({ shortTitle: event.target.value })}/></div>
      <div className="pub-field"><label htmlFor="pub-statement">内容声明</label><select id="pub-statement" className="pub-input" value={draft.creativeStatement} onChange={event => update({ creativeStatement: event.target.value as PublisherContent['creativeStatement'] })}>{CREATIVE_STATEMENTS.map(value => <option value={value} key={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
      <p className="pub-muted">一期不会自动上传视频封面。</p>
    </div></div><div><div className="pub-card"><h2><span className="pub-count">03</span>选择平台账号</h2>
      {VIDEO_PLATFORMS.map(platform => <div className="pub-platform" key={platform}><label htmlFor={`pub-target-${platform}`}>{PLATFORM_LABELS[platform]}</label><select id={`pub-target-${platform}`} className="pub-input" value={selection[platform] ?? ''} onChange={event => setSelection(current => ({ ...current, [platform]: event.target.value || undefined }))}><option value="">不发布</option>{grouped[platform].map(account => <option key={account.id} value={account.id}>{account.displayName}{account.loginState === 'logged-in' ? '' : '（需检查登录）'}</option>)}</select></div>)}
      {accounts.length === 0 && <p className="pub-muted">请先到“平台账号管理”添加并登录账号。</p>}
    </div><div className="pub-card"><h2><span className="pub-count">04</span>发布方式</h2><div className="pub-mode"><label><input type="radio" name="pub-mode" checked={mode === 'publish'} onChange={() => setMode('publish')}/>立即发布</label><label><input type="radio" name="pub-mode" checked={mode === 'draft'} onChange={() => setMode('draft')}/>转存草稿</label></div><p className="pub-muted">提交前会同步检查全部账号登录状态；任一目标无效则整单拒绝。</p></div>
      <Button variant="primary" className="pub-submit" disabled={busy || capability?.supported !== true} onClick={requestConfirm}>检查并提交</Button>
      <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。</p>
    </div></div>}
    {confirm && <ConfirmDialog contentType="video" title={confirm.title} sourceName={confirm.sourceName} mode={confirm.mode} accounts={confirm.accounts} busy={busy} onCancel={() => setConfirm(undefined)} onConfirm={submit}/>}
    <PublisherModal open={deleteDraftId !== undefined} title="删除本地视频草稿" closeLabel="关闭删除视频草稿确认" description="删除这份本地视频草稿？已经提交的记录不受影响。" className="pub-modal" onClose={() => { if (!busyRef.current) setDeleteDraftId(undefined) }} footer={<><Button variant="outline" data-pub-initial-focus disabled={busy} onClick={() => { if (!busyRef.current) setDeleteDraftId(undefined) }}>取消</Button><Button variant="outline" className="pub-danger-action" disabled={busy} onClick={confirmRemove}>{busy ? '正在删除…' : '删除草稿'}</Button></>}/></div>
}
