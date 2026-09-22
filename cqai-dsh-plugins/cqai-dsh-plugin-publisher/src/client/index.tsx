import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useMemo, useState } from 'react'
import {
  API, CREATIVE_STATEMENTS, DESCRIPTION_MAX, MAX_TAGS, PLATFORM_LABELS, TITLE_MAX, VIDEO_PLATFORMS,
  type CreateSubmissionResult, type CreativeStatement, type Platform, type PublisherAccount,
  type PublisherCapability, type PublisherImportPreview, type PublisherSubmission, type Work,
} from '../protocol.ts'

export const inject = ['slots']
const ACCOUNTS_PANEL = 'cqai-publisher-accounts' as MainPanelId
const PUBLISH_PANEL = 'cqai-publisher-submit' as MainPanelId

const STATEMENT_LABELS: Record<CreativeStatement, string> = {
  none: '不声明',
  ai_generated: '内容由 AI 生成',
  fiction: '虚构演绎，仅供娱乐',
  marketing: '营销推广',
  personal_opinion: '个人观点，仅供参考',
  repost: '转载',
  self_made_no_repost: '自制，禁止转载（仅哔哩哔哩）',
}

async function api<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API}/${action}`, data === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ejianbao': '1' },
    body: JSON.stringify(data),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('多平台发布服务暂未就绪，请稍候或重启应用')
  }
  const result = await response.json() as { error?: string }
  if (!response.ok) throw new Error(result.error || '请求失败')
  return result as T
}

const css = `
.pub{height:100%;overflow:auto;color:var(--foreground,#ededf0);background:var(--background,#151517);font-family:inherit;container-type:inline-size;box-sizing:border-box}.pub *{box-sizing:border-box}.pub button,.pub input,.pub textarea,.pub select{font:inherit}.pub button{cursor:pointer}.pub button:disabled{opacity:.45;cursor:not-allowed}.pub-wrap{max-width:1180px;margin:auto;padding:28px 32px 52px}.pub-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.pub-head h1{font-size:26px;margin:0 0 8px;letter-spacing:-1px}.pub-muted{font-size:13px;color:#9b9ba4;line-height:1.7}.pub-badge{padding:7px 12px;border-radius:99px;border:1px solid #a78bfa40;background:#a78bfa14;color:#c9baff;font-size:12px;white-space:nowrap}.pub-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.85fr);gap:18px}.pub-card{border:1px solid #ffffff18;background:#ffffff04;border-radius:15px;padding:20px;margin-bottom:18px}.pub-card h2{font-size:15px;margin:0 0 16px}.pub-field{margin-bottom:16px}.pub-field label{display:block;font-size:13px;margin-bottom:7px;color:#c9c9d0}.pub-input{width:100%;padding:10px 12px;border:1px solid #ffffff25;border-radius:9px;background:#08080c55;color:inherit;outline:none}.pub-input:focus{border-color:#a78bfa}.pub textarea.pub-input{min-height:110px;resize:vertical;line-height:1.7}.pub-primary,.pub-secondary,.pub-danger{border-radius:9px;padding:9px 13px}.pub-primary{border:0;background:#b8a1ff;color:#171020;font-weight:650}.pub-secondary{border:1px solid #ffffff24;background:#ffffff06;color:inherit}.pub-danger{border:1px solid #ff777744;background:#ff77770d;color:#ffb6b6}.pub-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.pub-error,.pub-notice{border-radius:9px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.6}.pub-error{color:#ffb6b6;background:#ff666614;border:1px solid #ff66662a}.pub-notice{color:#a8e2c4;background:#45b98112;border:1px solid #45b98135}.pub-empty{text-align:center;padding:30px 16px;border:1px dashed #ffffff24;border-radius:11px;color:#9f9fa9;font-size:13px;line-height:1.8}.pub-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #ffffff12}.pub-row:last-child{border-bottom:0}.pub-row strong{font-size:14px}.pub-row small{display:block;color:#92929c;margin-top:5px}.pub-status{font-size:12px;white-space:nowrap}.pub-ok{color:#83d2aa}.pub-warn{color:#f0c682}.pub-platform{display:grid;grid-template-columns:95px minmax(0,1fr);align-items:center;gap:12px;margin-bottom:12px}.pub-platform label{font-size:13px}.pub-work{display:block;width:100%;text-align:left;border:1px solid #ffffff1d;background:#ffffff04;color:inherit;border-radius:10px;padding:13px;margin-bottom:9px}.pub-work[aria-pressed=true]{border-color:#a78bfa88;background:#a78bfa14}.pub-work strong,.pub-work small{display:block}.pub-work small{color:#92929c;margin-top:5px}.pub-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pub-tag{padding:3px 8px;border:1px solid #a78bfa34;background:#a78bfa12;color:#cbbdff;border-radius:99px;font-size:11px}.pub-mode{display:flex;gap:10px}.pub-mode label{flex:1;border:1px solid #ffffff20;border-radius:10px;padding:12px;font-size:13px}.pub-mode input{accent-color:#a78bfa;margin-right:7px}.pub-submit{width:100%;padding:13px 18px}.pub-submission{padding:14px 0;border-bottom:1px solid #ffffff12}.pub-submission:last-child{border-bottom:0}.pub-targets{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.pub-target{font-size:11px;border:1px solid #ffffff20;border-radius:99px;padding:4px 8px;background:#ffffff04}.pub-import{margin-top:18px;border-top:1px solid #ffffff14;padding-top:18px}.pub-count{color:#bca8fa;font:12px monospace;letter-spacing:.5px;margin-right:8px}@container(max-width:760px){.pub-wrap{padding:21px 17px}.pub-grid{grid-template-columns:1fr}.pub-head{align-items:flex-start}.pub-badge{display:none}.pub-row{align-items:flex-start;flex-direction:column}.pub-platform{grid-template-columns:80px minmax(0,1fr)}}
`

function AccountsIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6"/><circle cx="17" cy="9" r="2.2"/><path d="M15.5 14c2.8-.5 4.6 1.1 5 4"/></svg>
}

function PublishIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/></svg>
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="pub"><style>{css}</style><div className="pub-wrap"><header className="pub-head"><div><h1>{title}</h1><div className="pub-muted">{subtitle}</div></div><span className="pub-badge">MatrixMedia Publisher Worker</span></header>{children}</div></section>
}

function capabilityMessage(capability: PublisherCapability | undefined): string {
  if (capability === undefined) return '正在检查发布能力…'
  if (capability.supported) return ''
  return capability.message || '当前设备不支持多平台发布'
}

function AccountsPage() {
  const [capability, setCapability] = useState<PublisherCapability>()
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [displayName, setDisplayName] = useState('')
  const [platform, setPlatform] = useState<Platform>('dy')
  const [preview, setPreview] = useState<PublisherImportPreview>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    const rows = await api<PublisherAccount[]>('accounts')
    setAccounts(rows)
  }

  useEffect(() => {
    let active = true
    void api<PublisherCapability>('capability').then(async value => {
      if (!active) return
      setCapability(value)
      if (value.supported) {
        const rows = await api<PublisherAccount[]>('accounts')
        if (active) setAccounts(rows)
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '发布能力检查失败') })
    return () => { active = false }
  }, [])

  // Returning from a native login window focuses e宝. Check once per focus;
  // there is deliberately no timer, QR polling, or background status loop.
  useEffect(() => {
    const checkOnFocus = () => {
      if (accounts.length === 0 || busy !== '') return
      void Promise.all(accounts.map(account => api<PublisherAccount>('account-check-login', { id: account.id })))
        .then(setAccounts)
        .catch(() => {})
    }
    window.addEventListener('focus', checkOnFocus)
    return () => window.removeEventListener('focus', checkOnFocus)
  }, [accounts, busy])

  const act = async (label: string, task: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('')
    try { await task() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') }
    finally { setBusy('') }
  }

  const create = () => act('正在创建账号…', async () => {
    if (!displayName.trim()) throw new Error('请填写账号名称')
    const account = await api<PublisherAccount>('accounts', { displayName, platform })
    setDisplayName('')
    await api('account-open-login', { id: account.id })
    await refresh()
    setNotice('登录窗口已打开；完成登录后回到 e宝工坊即可检查状态。')
  })

  const rename = (account: PublisherAccount) => {
    const next = window.prompt('新的账号名称', account.displayName)
    if (next === null || next.trim() === '' || next.trim() === account.displayName) return
    void act('正在保存…', async () => { await api('account-update', { id: account.id, displayName: next.trim() }); await refresh() })
  }

  const remove = (account: PublisherAccount) => {
    if (!window.confirm(`删除“${account.displayName}”并清理其登录 session？历史提交记录会保留账号名称快照。`)) return
    void act('正在删除…', async () => { await api('account-delete', { id: account.id }); await refresh() })
  }

  const inspectImport = () => act('正在检查旧账号…', async () => {
    const result = await api<PublisherImportPreview>('import-preview')
    setPreview(result)
  })

  const applyImport = () => act('正在复制旧账号…', async () => {
    if (preview?.running) throw new Error('请先完全退出独立 MatrixMedia')
    await api('import-apply', {})
    setPreview(undefined)
    await refresh()
    setNotice('导入完成。已复制旧 session，原 MatrixMedia 数据未移动或删除；请检查登录状态。')
  })

  const unavailable = capabilityMessage(capability)
  return <Shell title="多平台账号管理" subtitle="账号名称与登录 session 分离，改名不会丢失登录状态。">
    {error && <div className="pub-error" role="alert">{error}</div>}
    {notice && <div className="pub-notice">{notice}</div>}
    {unavailable && <div className="pub-error">{unavailable}</div>}
    <div className="pub-grid"><div><div className="pub-card"><h2>账号列表</h2>
      {accounts.length === 0 ? <div className="pub-empty">还没有发布账号<br/>请在右侧添加账号并完成平台登录。</div> : accounts.map(account => <div className="pub-row" key={account.id}><div><strong>{account.displayName}</strong><small>{PLATFORM_LABELS[account.platform]}</small></div><div><span className={`pub-status ${account.loginState === 'logged-in' ? 'pub-ok' : account.loginState === 'logged-out' ? 'pub-warn' : ''}`}>{account.loginState === 'logged-in' ? '已登录' : account.loginState === 'logged-out' ? '需要登录' : '状态未知'}</span><div className="pub-actions">
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在打开登录页…', async () => { await api('account-open-login', { id: account.id }) })}>{account.loginState === 'logged-in' ? '重新登录' : '登录'}</button>
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在检查…', async () => { const next = await api<PublisherAccount>('account-check-login', { id: account.id }); setAccounts(rows => rows.map(row => row.id === next.id ? next : row)) })}>检查状态</button>
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在打开后台…', async () => { await api('account-open-dashboard', { id: account.id }) })}>打开平台后台</button>
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => rename(account)}>改名</button>
        <button className="pub-danger" disabled={busy !== ''} onClick={() => remove(account)}>删除</button>
      </div></div></div>)}
      {accounts.length > 0 && <div className="pub-actions"><button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在刷新…', refresh)}>刷新列表</button></div>}
    </div></div><div><div className="pub-card"><h2>添加账号</h2>
      <div className="pub-field"><label htmlFor="pub-account-platform">平台</label><select id="pub-account-platform" className="pub-input" value={platform} onChange={event => setPlatform(event.target.value as Platform)}>{VIDEO_PLATFORMS.map(value => <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>)}</select></div>
      <div className="pub-field"><label htmlFor="pub-account-name">账号名称</label><input id="pub-account-name" className="pub-input" maxLength={100} placeholder="例如：品牌主账号" value={displayName} onChange={event => setDisplayName(event.target.value)}/></div>
      <button className="pub-primary" disabled={busy !== '' || capability?.supported !== true} onClick={() => void create()}>{busy || '添加并打开登录页'}</button>
      <div className="pub-import"><h2>导入 MatrixMedia 账号</h2><p className="pub-muted">只复制 macOS 默认目录里的账号和 session；不会移动或删除原数据。导入前必须完全退出独立 MatrixMedia。</p>
        <button className="pub-secondary" disabled={busy !== '' || capability?.supported !== true} onClick={() => void inspectImport()}>预览可导入账号</button>
        {preview && <div style={{marginTop: 14}}>{preview.accounts.length === 0 ? <div className="pub-muted">没有发现可导入账号。</div> : <><div className={preview.running ? 'pub-error' : 'pub-muted'}>{preview.running ? '检测到独立 MatrixMedia 仍在运行，请先退出。' : `发现 ${String(preview.accounts.length)} 个账号：`}</div><div className="pub-tags">{preview.accounts.map((item, index) => <span className="pub-tag" key={`${item.platform}:${item.displayName}:${String(index)}`}>{PLATFORM_LABELS[item.platform]} · {item.displayName}</span>)}</div><div className="pub-actions"><button className="pub-primary" disabled={preview.running || busy !== ''} onClick={() => void applyImport()}>确认复制并导入</button></div></>}</div>}
      </div>
    </div></div></div>
  </Shell>
}

function PublishPage() {
  const [capability, setCapability] = useState<PublisherCapability>()
  const [works, setWorks] = useState<Work[]>([])
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [submissions, setSubmissions] = useState<PublisherSubmission[]>([])
  const [workId, setWorkId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [shortTitle, setShortTitle] = useState('')
  const [tags, setTags] = useState('')
  const [statement, setStatement] = useState<CreativeStatement>('none')
  const [mode, setMode] = useState<'publish' | 'draft'>('publish')
  const [selection, setSelection] = useState<Partial<Record<Platform, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    const [accountRows, records] = await Promise.all([
      api<PublisherAccount[]>('accounts'), api<PublisherSubmission[]>('submissions'),
    ])
    setAccounts(accountRows)
    setSubmissions(records)
  }

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : '页面加载失败')) }, [])

  const chooseWork = (work: Work) => {
    setWorkId(work.id)
    setTitle(work.title)
    setDescription(work.description)
    setTags(work.tags.join(' '))
    setStatement(work.aiGeneratedDisclosure ? 'ai_generated' : 'none')
    setNotice('')
  }

  const tagList = () => [...new Set(tags.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean))].slice(0, MAX_TAGS)

  const submit = async () => {
    setError(''); setNotice('')
    if (!workId) { setError('请先选择一条 e剪宝成片'); return }
    if (!title.trim()) { setError('请填写标题'); return }
    if (selectedAccounts.length === 0) { setError('请至少选择一个发布账号'); return }
    const summary = selectedAccounts.map(account => `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`).join('\n')
    const verb = mode === 'publish' ? '立即发布' : '转存草稿'
    if (!window.confirm(`请最终确认：\n\n作品：${title.trim()}\n方式：${verb}\n账号：\n${summary}\n\n提交后请自行打开平台后台确认结果。`)) return
    setBusy(true)
    try {
      const result = await api<CreateSubmissionResult>('submissions', {
        workId, title: title.trim(), description, shortTitle, tags: tagList(),
        creativeStatement: statement, mode, accountIds: selectedAccounts.map(account => account.id),
      })
      setSubmissions(rows => [result.submission, ...rows.filter(row => row.id !== result.submission.id)])
      setNotice('已提交，请稍后到平台后台确认。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败')
    } finally { setBusy(false) }
  }

  const unavailable = capabilityMessage(capability)
  return <Shell title="多平台发布" subtitle="只提交 e剪宝已完成成片；发布结果请在对应平台后台确认。">
    {error && <div className="pub-error" role="alert">{error}</div>}
    {notice && <div className="pub-notice">{notice}</div>}
    {unavailable && <div className="pub-error">{unavailable}</div>}
    <div className="pub-grid"><div><div className="pub-card"><h2><span className="pub-count">01</span>选择 e剪宝成片</h2>
      {works.length === 0 ? <div className="pub-empty">暂无可发布成片<br/>请先在 e剪宝完成一条视频。</div> : works.map(work => <button className="pub-work" aria-pressed={work.id === workId} key={work.id} onClick={() => chooseWork(work)}><strong>{work.title}</strong><small>{new Date(work.createdAt).toLocaleString()} · {(work.bytes / 1048576).toFixed(1)} MB</small></button>)}
    </div><div className="pub-card"><h2><span className="pub-count">02</span>发布内容</h2>
      <div className="pub-field"><label htmlFor="pub-title">标题</label><input id="pub-title" className="pub-input" maxLength={TITLE_MAX} value={title} onChange={event => setTitle(event.target.value)}/></div>
      <div className="pub-field"><label htmlFor="pub-description">简介</label><textarea id="pub-description" className="pub-input" maxLength={DESCRIPTION_MAX} value={description} onChange={event => setDescription(event.target.value)}/></div>
      <div className="pub-field"><label htmlFor="pub-tags">话题（最多 {MAX_TAGS} 个）</label><input id="pub-tags" className="pub-input" value={tags} onChange={event => setTags(event.target.value)} placeholder="用空格或逗号分隔"/></div>
      <div className="pub-field"><label htmlFor="pub-short-title">视频号短标题</label><input id="pub-short-title" className="pub-input" maxLength={32} value={shortTitle} onChange={event => setShortTitle(event.target.value)}/></div>
      <div className="pub-field"><label htmlFor="pub-statement">内容声明</label><select id="pub-statement" className="pub-input" value={statement} onChange={event => setStatement(event.target.value as CreativeStatement)}>{CREATIVE_STATEMENTS.map(value => <option value={value} key={value}>{STATEMENT_LABELS[value]}</option>)}</select></div>
      <p className="pub-muted">一期不会自动上传 e剪宝生成的封面。</p>
    </div></div><div><div className="pub-card"><h2><span className="pub-count">03</span>选择平台账号</h2>
      {VIDEO_PLATFORMS.map(platform => <div className="pub-platform" key={platform}><label htmlFor={`pub-target-${platform}`}>{PLATFORM_LABELS[platform]}</label><select id={`pub-target-${platform}`} className="pub-input" value={selection[platform] ?? ''} onChange={event => setSelection(current => ({ ...current, [platform]: event.target.value || undefined }))}><option value="">不发布</option>{grouped[platform].map(account => <option key={account.id} value={account.id}>{account.displayName}{account.loginState === 'logged-in' ? '' : '（需检查登录）'}</option>)}</select></div>)}
      {accounts.length === 0 && <p className="pub-muted">请先到“多平台账号管理”添加并登录账号。</p>}
    </div><div className="pub-card"><h2><span className="pub-count">04</span>发布方式</h2><div className="pub-mode"><label><input type="radio" name="pub-mode" checked={mode === 'publish'} onChange={() => setMode('publish')}/>立即发布</label><label><input type="radio" name="pub-mode" checked={mode === 'draft'} onChange={() => setMode('draft')}/>转存草稿</label></div><p className="pub-muted">提交前会同步检查全部账号登录状态；任一目标无效则整单拒绝。</p></div>
      <button className="pub-primary pub-submit" disabled={busy || capability?.supported !== true} onClick={() => void submit()}>{busy ? '正在校验并提交…' : '确认发布清单'}</button>
      <p className="pub-muted">提交只表示任务已被本机发布队列接受，不代表平台发布成功。</p>
    </div></div>
    <div className="pub-card"><h2>提交记录</h2>{submissions.length === 0 ? <div className="pub-empty">暂无提交记录</div> : submissions.map(item => <div className="pub-submission" key={item.id}><strong>{item.title}</strong><small className="pub-muted">{new Date(item.createdAt).toLocaleString()} · {item.mode === 'publish' ? '立即发布' : '转存草稿'}</small><div className="pub-targets">{item.targets.map(target => <button className="pub-target" key={`${item.id}:${target.accountId}`} onClick={() => void api('account-open-dashboard', { id: target.accountId }).catch(cause => setError(cause instanceof Error ? cause.message : '无法打开平台后台'))}>{PLATFORM_LABELS[target.platform]} · {target.accountName} · 打开后台</button>)}</div></div>)}</div>
  </Shell>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ACCOUNTS_PANEL }, AccountsPage))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PUBLISH_PANEL }, PublishPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: ACCOUNTS_PANEL, order: 42, label: '多平台账号管理' }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <AccountsIcon size={size}/>))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PUBLISH_PANEL, order: 43, label: '多平台发布' }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <PublishIcon size={size}/>))
}
