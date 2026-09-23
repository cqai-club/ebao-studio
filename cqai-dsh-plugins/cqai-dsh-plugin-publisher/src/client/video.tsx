import { useEffect, useMemo, useState } from 'react'
import { CREATIVE_STATEMENTS, DESCRIPTION_MAX, MAX_TAGS, PLATFORM_LABELS, TITLE_MAX, VIDEO_PLATFORMS, type CreateSubmissionResult, type CreativeStatement, type Platform, type PublisherAccount, type PublisherCapability, type PublisherLocalVideo, type Work } from '../protocol.ts'
import { api, capabilityMessage, ConfirmDialog, STATEMENT_LABELS } from './shared.tsx'
import { usePublisherTips } from './tips.tsx'

export function VideoPage({ active }: { active: boolean }) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [capability, setCapability] = useState<PublisherCapability>()
  const [works, setWorks] = useState<Work[]>([])
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [workId, setWorkId] = useState('')
  const [localVideo, setLocalVideo] = useState<PublisherLocalVideo>()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [shortTitle, setShortTitle] = useState('')
  const [tags, setTags] = useState('')
  const [statement, setStatement] = useState<CreativeStatement>('none')
  const [mode, setMode] = useState<'publish' | 'draft'>('publish')
  const [selection, setSelection] = useState<Partial<Record<Platform, string>>>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const grouped = useMemo(() => Object.fromEntries(VIDEO_PLATFORMS.map(platform => [platform, accounts.filter(account => account.platform === platform)])) as Record<Platform, PublisherAccount[]>, [accounts])
  const selectedAccounts = VIDEO_PLATFORMS.flatMap(platform => {
    const id = selection[platform]
    return id ? accounts.filter(account => account.id === id) : []
  })

  const load = async () => {
    const value = await api<PublisherCapability>('capability')
    setCapability(value)
    const availableWorks = await api<Work[]>('works')
    setWorks(availableWorks)
    if (!value.supported) return
    const accountRows = await api<PublisherAccount[]>('accounts')
    setAccounts(accountRows)
  }

  useEffect(() => { if (active) void load().catch(cause => showError(cause instanceof Error ? cause.message : '页面加载失败')) }, [active])

  const chooseWork = (work: Work) => {
    setWorkId(work.id)
    setLocalVideo(undefined)
    setTitle(work.title)
    setDescription(work.description)
    setTags(work.tags.join(' '))
    setStatement(work.aiGeneratedDisclosure ? 'ai_generated' : 'none')
    clearTip()
  }

  const chooseLocalVideo = async () => {
    setBusy(true); clearTip()
    try {
      const selected = await api<PublisherLocalVideo | null>('local-video-select', {})
      if (!selected) return
      setLocalVideo(selected)
      setWorkId('')
      setTitle(selected.title)
      setDescription('')
      setShortTitle('')
      setTags('')
      setStatement('none')
    } catch (cause) { showError(cause instanceof Error ? cause.message : '选择本地视频失败') }
    finally { setBusy(false) }
  }

  const tagList = () => [...new Set(tags.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))].slice(0, MAX_TAGS)

  const requestConfirm = () => {
    clearTip()
    if (!workId && !localVideo) { showError('请先选择一条 e剪宝成片或一个本地视频'); return }
    if (!title.trim()) { showError('请填写标题'); return }
    if (selectedAccounts.length === 0) { showError('请至少选择一个发布账号'); return }
    setConfirm(true)
  }

  const submit = async () => {
    setBusy(true)
    try {
      await api<CreateSubmissionResult>('submissions', {
        contentType: 'video', ...(localVideo ? { localVideoId: localVideo.id } : { workId }),
        title: title.trim(), description, shortTitle, tags: tagList(),
        creativeStatement: statement, mode, accountIds: selectedAccounts.map(account => account.id),
      })
      setConfirm(false)
      showSuccess('已提交，请稍后到平台后台确认。')
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : '提交失败')
    } finally { setBusy(false) }
  }

  const unavailable = capabilityMessage(capability)
  return <div>
    {unavailable && <div className="pub-error">{unavailable}</div>}
    <div className="pub-grid"><div><div className="pub-card"><h2><span className="pub-count">01</span>选择视频素材</h2>
      <h3>e剪宝成片</h3>
      {works.length === 0 ? <p className="pub-muted">暂无 e剪宝成片，也可以直接选择本地视频。</p> : works.map(work => <button className="pub-work" aria-pressed={work.id === workId && !localVideo} key={work.id} onClick={() => chooseWork(work)}><strong>{work.title}</strong><small>{new Date(work.createdAt).toLocaleString()} · {(work.bytes / 1048576).toFixed(1)} MB</small></button>)}
      <h3>本地视频</h3>
      <button className="pub-secondary" disabled={busy || capability?.supported !== true} onClick={() => void chooseLocalVideo()}>选择本地文件…</button>
      {localVideo && <div className="pub-work" aria-label="已选择的本地视频"><strong>{localVideo.fileName}</strong><small>{(localVideo.bytes / 1048576).toFixed(1)} MB · 已选择</small></div>}
      <p className="pub-muted">目前支持 MP4；提交后请保留原文件，直到到平台后台确认。</p>
    </div><div className="pub-card"><h2><span className="pub-count">02</span>发布内容</h2>
      <div className="pub-field"><label htmlFor="pub-title">标题</label><input id="pub-title" className="pub-input" maxLength={TITLE_MAX} value={title} onChange={event => setTitle(event.target.value)}/></div>
      <div className="pub-field"><label htmlFor="pub-description">简介</label><textarea id="pub-description" className="pub-input" maxLength={DESCRIPTION_MAX} value={description} onChange={event => setDescription(event.target.value)}/></div>
      <div className="pub-field"><label htmlFor="pub-tags">话题（最多 {MAX_TAGS} 个）</label><input id="pub-tags" className="pub-input" value={tags} onChange={event => setTags(event.target.value)} placeholder="用空格或逗号分隔"/></div>
      <div className="pub-field"><label htmlFor="pub-short-title">视频号短标题</label><input id="pub-short-title" className="pub-input" maxLength={32} value={shortTitle} onChange={event => setShortTitle(event.target.value)}/></div>
      <div className="pub-field"><label htmlFor="pub-statement">内容声明</label><select id="pub-statement" className="pub-input" value={statement} onChange={event => setStatement(event.target.value as CreativeStatement)}>{CREATIVE_STATEMENTS.map(value => <option value={value} key={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
      <p className="pub-muted">一期不会自动上传视频封面。</p>
    </div></div><div><div className="pub-card"><h2><span className="pub-count">03</span>选择平台账号</h2>
      {VIDEO_PLATFORMS.map(platform => <div className="pub-platform" key={platform}><label htmlFor={`pub-target-${platform}`}>{PLATFORM_LABELS[platform]}</label><select id={`pub-target-${platform}`} className="pub-input" value={selection[platform] ?? ''} onChange={event => setSelection(current => ({ ...current, [platform]: event.target.value || undefined }))}><option value="">不发布</option>{grouped[platform].map(account => <option key={account.id} value={account.id}>{account.displayName}{account.loginState === 'logged-in' ? '' : '（需检查登录）'}</option>)}</select></div>)}
      {accounts.length === 0 && <p className="pub-muted">请先到“平台账号管理”添加并登录账号。</p>}
    </div><div className="pub-card"><h2><span className="pub-count">04</span>发布方式</h2><div className="pub-mode"><label><input type="radio" name="pub-mode" checked={mode === 'publish'} onChange={() => setMode('publish')}/>立即发布</label><label><input type="radio" name="pub-mode" checked={mode === 'draft'} onChange={() => setMode('draft')}/>转存草稿</label></div><p className="pub-muted">提交前会同步检查全部账号登录状态；任一目标无效则整单拒绝。</p></div>
      <button className="pub-primary pub-submit" disabled={busy || capability?.supported !== true} onClick={requestConfirm}>检查并提交</button>
      <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。</p>
    </div></div>
    {confirm && <ConfirmDialog contentType="video" title={title} sourceName={localVideo?.fileName ?? works.find(work => work.id === workId)?.title} mode={mode} accounts={selectedAccounts} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void submit()}/>}
  </div>
}
