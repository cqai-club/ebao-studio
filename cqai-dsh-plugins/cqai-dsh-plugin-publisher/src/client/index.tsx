import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useState } from 'react'
import {
  API, CLI_LOGIN_PLATFORMS, CREATIVE_STATEMENTS, MAX_TAGS, PLATFORM_LABELS, DESCRIPTION_MAX,
  SHORT_TITLE_RANGE, TITLE_MAX, VIDEO_PLATFORMS,
  type AccountRow, type CreativeStatement, type HistoryRow, type Platform, type PublishJob,
  type RuntimeStatus, type TargetState, type Work,
} from '../protocol.ts'

export const inject = ['slots']
const PANEL = 'cqai-publisher' as MainPanelId

/** Upstream's own wording for each creative statement, kept short for the select. */
const STATEMENT_LABELS: Record<CreativeStatement, string> = {
  none: '不声明',
  ai_generated: '内容由 AI 生成',
  fiction: '虚构演绎，仅供娱乐',
  marketing: '营销推广',
  personal_opinion: '个人观点，仅供参考',
  repost: '转载',
  self_made_no_repost: '自制，禁止转载（仅哔哩哔哩）',
}
const TARGET_TEXT: Record<TargetState, string> = {
  pending: '等待开始', running: '发布中', success: '已发布', scheduled: '已定时', draft: '已转草稿箱',
  failed: '失败', unknown: '待人工核对', cancelled: '已取消',
}

async function api<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API}/${action}`, data === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json', 'x-ejianbao': '1'}, body: JSON.stringify(data)})
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('一稿多发服务暂未就绪，请稍候或重启应用')
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result as T
}
const size = (bytes: number) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
/** `datetime-local` gives `YYYY-MM-DDTHH:mm`; upstream wants `YYYY-MM-DD HH:mm:ss`. */
const toPublishAt = (local: string) => local ? `${local.replace('T', ' ')}:00` : ''
const tagList = (raw: string) => raw.split(/[,，\s]+/u).map(tag => tag.replace(/^#+/u, '').trim()).filter(Boolean).slice(0, MAX_TAGS)

const css = `
.ejb{height:100%;overflow:auto;color:var(--foreground,#ededf0);background:var(--background,#151517);font-family:inherit;container-type:inline-size;box-sizing:border-box}.ejb *{box-sizing:border-box}.ejb button,.ejb input,.ejb textarea,.ejb select{font:inherit}.ejb button{cursor:pointer}.ejb button:disabled{opacity:.45;cursor:wait}.ejb-wrap{max-width:1260px;padding:28px 32px 48px;margin:auto}.ejb-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.ejb-head h1{font-size:26px;margin:0 0 8px;font-weight:700;letter-spacing:-1px}.ejb-muted{font-size:13px;color:#9b9ba4;line-height:1.7}.ejb-badge{color:#c4b5fd;background:#a78bfa16;border:1px solid #a78bfa35;border-radius:100px;padding:7px 12px;font-size:12px;white-space:nowrap}.ejb-tabs{display:flex;gap:8px;border-bottom:1px solid #ffffff16;padding-bottom:14px;margin-bottom:22px}.ejb-tab,.ejb-secondary{border:1px solid #ffffff24;background:#ffffff05;color:inherit;border-radius:9px;padding:9px 15px}.ejb-tab[aria-selected=true]{background:#a78bfa22;border-color:#a78bfa66;color:#d3c6ff}.ejb-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(270px,1fr);gap:20px}.ejb-card{border:1px solid #ffffff17;background:#ffffff03;border-radius:15px;padding:22px;margin-bottom:18px}.ejb-card h2{font-size:15px;margin:0 0 18px;display:flex;gap:10px;align-items:center}.ejb-num{color:#bca8fa;font:12px monospace;letter-spacing:1px}.ejb label{display:block;font-size:13px;margin-bottom:8px;color:#c9c9d0}.ejb-field{margin-bottom:18px}.ejb-input{display:block;width:100%;padding:11px 13px;border:1px solid #ffffff25;border-radius:9px;background:#08080c44;color:inherit;outline:none}.ejb-input:focus{border-color:#a78bfa}.ejb textarea{min-height:110px;resize:vertical;line-height:1.8}.ejb-plats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.ejb-plat{border:1px solid #ffffff22;border-radius:10px;background:none;color:inherit;padding:11px 12px;font-size:13px!important;text-align:left}.ejb-plat[aria-pressed=true]{border-color:#a78bfa;background:#a78bfa18;color:#d8ccff}.ejb-check{display:flex!important;gap:10px;align-items:flex-start;margin:14px 0!important;line-height:1.5}.ejb-check input{accent-color:#a78bfa;margin-top:3px}.ejb-primary{width:100%;background:#b8a1ff;color:#191123;border:0;border-radius:10px;padding:13px 18px;font-weight:650!important;box-shadow:0 3px 18px #9b7bf322}.ejb-error{color:#ffb6b6;background:#ff666614;border:1px solid #ff66662a;border-radius:9px;padding:12px;margin:16px 0;white-space:pre-wrap;font-size:13px}.ejb-ok{color:#8fd6b2}.ejb-card p.ejb-muted{margin:8px 0 0}.ejb-flow{display:grid;gap:8px}.ejb-step{display:flex;justify-content:space-between;gap:12px;border:1px solid #ffffff1a;border-radius:8px;padding:11px 13px;font-size:12px;color:#9797a2}.ejb-step.success,.ejb-step.scheduled,.ejb-step.draft{color:#8fd6b2;border-color:#8fd6b244}.ejb-step.running{color:#cfbcff;border-color:#b99bff;background:#a78bfa16}.ejb-step.failed{color:#ffb0b0;border-color:#ff66663a}.ejb-step.unknown{color:#ffd9a0;border-color:#ffb84d44}.ejb-step.cancelled{opacity:.55}.ejb-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}.ejb-actions .ejb-primary{width:auto}.ejb-log{white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;background:#0004;border-radius:8px;padding:13px;font:11px/1.7 Consolas,monospace;color:#b8b8c2}.ejb-job{display:flex;width:100%;align-items:center;justify-content:space-between;text-align:left;margin:0 0 10px;padding:15px;border:1px solid #ffffff1c;border-radius:10px;background:#ffffff04;color:inherit}.ejb-job strong{display:block;font-size:14px;margin-bottom:5px}.ejb-job small{color:#90909b}.ejb-empty{text-align:center;padding:40px 20px;border:1px dashed #ffffff22;border-radius:12px;color:#9f9fa9;font-size:13px;line-height:1.9}.ejb-row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #ffffff12;font-size:13px}.ejb-row:last-child{border-bottom:0}.ejb-row small{color:#90909b;display:block;margin-top:4px}.ejb-qr{display:block;width:220px;height:220px;margin:16px auto;background:#fff;border-radius:12px;padding:8px}.ejb details summary{cursor:pointer;font-size:12px;color:#a6a6b2;margin:17px 0 8px}.ejb-tag{display:inline-block;margin:0 6px 6px 0;padding:4px 9px;border-radius:100px;background:#a78bfa18;border:1px solid #a78bfa35;color:#cfc0ff;font-size:11px}@container(max-width:750px){.ejb-wrap{padding:22px 18px}.ejb-grid{grid-template-columns:1fr}.ejb-head{align-items:flex-start}.ejb-badge{display:none}}
`

function Send({size = 20}: {size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.5 2.5 11 13"/><path d="M21.5 2.5 15 21.5l-4-8.5-8.5-4z"/></svg>
}

function Publisher() {
  const [tab, setTab] = useState<'publish' | 'accounts' | 'history'>('publish')
  const [status, setStatus] = useState<RuntimeStatus>()
  const [works, setWorks] = useState<Work[]>([])
  const [file, setFile] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [shortTitle, setShortTitle] = useState('')
  const [tags, setTags] = useState('')
  const [statement, setStatement] = useState<CreativeStatement>('none')
  const [publishAt, setPublishAt] = useState('')
  const [draft, setDraft] = useState(false)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [jobs, setJobs] = useState<PublishJob[]>([])
  const [selected, setSelected] = useState('')
  const [login, setLogin] = useState<{id: string; qr: string; state: string; message: string}>()
  const [loginPlatform, setLoginPlatform] = useState<Platform>('dy')
  const [loginPhone, setLoginPhone] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const job = jobs.find(item => item.id === selected)
  const current = tags ? tagList(tags) : []

  useEffect(() => {
    let live = true
    const tick = () => {
      api<RuntimeStatus>('status').then(value => {if (live) setStatus(value)}).catch(() => {})
      api<PublishJob[]>('jobs').then(value => {if (live) setJobs(value)}).catch(() => {})
    }
    api<Work[]>('works').then(value => {if (live) setWorks(value)}).catch(() => {})
    tick(); const timer = setInterval(tick, 2000)
    return () => {live = false; clearInterval(timer)}
  }, [])
  useEffect(() => {
    if (tab === 'accounts') api<AccountRow[]>('accounts').then(setAccounts).catch(e => setError(e.message))
    if (tab === 'history') api<HistoryRow[]>('history').then(setHistory).catch(e => setError(e.message))
  }, [tab])
  useEffect(() => {
    if (!login || login.state !== 'pending') return
    const timer = setInterval(() => {
      api<{id: string; qr: string; state: string; message: string}>(`login?id=${login.id}`)
        .then(value => setLogin(value)).catch(e => {setError(e.message); setLogin(undefined)})
    }, 1500)
    return () => clearInterval(timer)
  }, [login])

  const toggle = (platform: Platform) => setPlatforms(prev => prev.includes(platform) ? prev.filter(item => item !== platform) : [...prev, platform])
  const pick = (work: Work) => {
    setFile(work.file)
    setTitle(prev => prev.trim() ? prev : work.title)
  }
  async function submit() {
    setError('')
    if (!file) {setError('请先选择要发布的一条成片'); return}
    if (!title.trim()) {setError('标题是必填项'); return}
    if (!platforms.length) {setError('请至少选择一个发布平台'); return}
    if (publishAt && Date.parse(publishAt) <= Date.now()) {setError('定时发布时间需要晚于当前时间'); return}
    setBusy('正在创建任务…')
    try {
      const created = await api<PublishJob>('jobs', {
        file, title, description, shortTitle, tags: current, creativeStatement: statement,
        publishAt: toPublishAt(publishAt), draft, targets: platforms.map(platform => ({platform, phone: ''})),
      })
      setSelected(created.id)
      await api(`start?id=${created.id}`, {})
      setBusy('')
    } catch (e) {setError(e instanceof Error ? e.message : '创建失败'); setBusy('')}
  }
  async function startLogin() {
    setError(''); setLogin(undefined)
    try {
      const session = await api<{id: string; qr: string; state: string; message: string}>('login', {platform: loginPlatform, phone: loginPhone})
      setLogin(session)
    } catch (e) {setError(e instanceof Error ? e.message : '无法开始扫码登录')}
  }
  return <section className="ejb" data-cqai-publisher-main=""><style>{css}</style><div className="ejb-wrap">
    <header className="ejb-head"><div><h1>一稿多发</h1><div className="ejb-muted">一条成片，一次投放到各个平台。</div></div><span className="ejb-badge">多平台分发</span></header>
    <nav className="ejb-tabs" aria-label="发布工作台">
      <button className="ejb-tab" aria-selected={tab === 'publish'} onClick={() => setTab('publish')}>发布</button>
      <button className="ejb-tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>账号</button>
      <button className="ejb-tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>平台记录</button>
    </nav>
    {error && <div className="ejb-error" role="alert">{error}</div>}
    <details className="ejb-card" open={status?.ready === false}><summary>发布环境 · {status ? status.ready ? `已就绪${status.version ? ` · ${status.version}` : ''}` : '未就绪' : '检查中…'}</summary>
      {status?.ready ? <div className="ejb-muted">矩媒运行体：{status.path}<br/>发布记录目录：{status.dataDir}</div>
        : <><div className="ejb-muted">{status?.message || '正在检查运行体…'}</div><div className="ejb-muted">来源：{status?.source || '—'}</div></>}
    </details>
    {tab === 'publish' && <div className="ejb-grid"><div>
      <div className="ejb-card"><h2><span className="ejb-num">01</span>选择成片</h2>
        {works.length ? works.map(work => <button className="ejb-job" key={work.id} onClick={() => pick(work)}><span><strong>{work.title}</strong><small>{new Date(work.createdAt).toLocaleString()} · {size(work.bytes)}</small></span><span className={file === work.file ? 'ejb-ok' : 'ejb-muted'}>{file === work.file ? '已选择' : '选择'}</span></button>)
          : <div className="ejb-empty">还没有可用于发布的成片<br/>先在 e剪宝里完成一条口播视频。</div>}
      </div>
      <div className="ejb-card"><h2><span className="ejb-num">02</span>文案</h2>
        <div className="ejb-field"><label htmlFor="ejb-title">标题</label><input id="ejb-title" className="ejb-input" maxLength={TITLE_MAX} placeholder="必填，各平台通用" value={title} onChange={e => setTitle(e.target.value)}/></div>
        <div className="ejb-field"><label htmlFor="ejb-desc">简介</label><textarea id="ejb-desc" className="ejb-input" maxLength={DESCRIPTION_MAX} placeholder="视频号、抖音、快手会把话题追加到简介末尾" value={description} onChange={e => setDescription(e.target.value)}/></div>
        <div className="ejb-field"><label htmlFor="ejb-tags">话题</label><input id="ejb-tags" className="ejb-input" placeholder="用空格或逗号分隔，最多 4 个，不用写 #" value={tags} onChange={e => setTags(e.target.value)}/>{current.length > 0 && <div style={{marginTop: 8}}>{current.map(tag => <span className="ejb-tag" key={tag}>#{tag}</span>)}</div>}</div>
        <div className="ejb-field"><label htmlFor="ejb-short">视频号短标题</label><input id="ejb-short" className="ejb-input" maxLength={SHORT_TITLE_RANGE[1]} placeholder={`留空则用标题前 ${SHORT_TITLE_RANGE[1]} 字（建议 6–16 字）`} value={shortTitle} onChange={e => setShortTitle(e.target.value)}/></div>
        <label htmlFor="ejb-cs">创作声明</label><select id="ejb-cs" className="ejb-input" value={statement} onChange={e => setStatement(e.target.value as CreativeStatement)}>{CREATIVE_STATEMENTS.map(value => <option key={value} value={value}>{STATEMENT_LABELS[value]}</option>)}</select>
      </div>
    </div><div>
      <div className="ejb-card"><h2><span className="ejb-num">03</span>发布平台</h2>
        <div className="ejb-plats">{VIDEO_PLATFORMS.map(platform => <button key={platform} className="ejb-plat" aria-pressed={platforms.includes(platform)} onClick={() => toggle(platform)}>{platforms.includes(platform) ? '✓ ' : ''}{PLATFORM_LABELS[platform]}</button>)}</div>
        <p className="ejb-muted">百家号和头条不支持话题，会自动忽略。</p>
      </div>
      <div className="ejb-card"><h2><span className="ejb-num">04</span>发布方式</h2>
        <div className="ejb-field"><label htmlFor="ejb-at">定时发布</label><input id="ejb-at" className="ejb-input" type="datetime-local" value={publishAt} onChange={e => setPublishAt(e.target.value)}/></div>
        <label className="ejb-check"><input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)}/><span>发布到草稿箱<div className="ejb-muted">不直接公开，先存进各平台草稿箱由你确认。</div></span></label>
      </div>
      <button className="ejb-primary" disabled={!!busy || status?.ready === false} onClick={() => void submit()}>{busy || '开始发布'}</button>
      <p className="ejb-muted">各平台按顺序逐个上传。发布期间请保持易宝工坊运行。</p>
      {job && <div className="ejb-card" style={{marginTop: 18}}><h2>当前任务 · {job.input.title}</h2>
        <div className="ejb-flow">{job.targets.map(target => <div key={`${target.platform}:${target.phone}`} className={`ejb-step ${target.state}`}><span>{PLATFORM_LABELS[target.platform] || target.platform}{target.phone ? ` · ${target.phone}` : ''}</span><span>{TARGET_TEXT[target.state]}{target.exitCode !== undefined ? ` · ${target.exitCode}` : ''}</span></div>)}</div>
        {job.error && <div className="ejb-error">{job.error}</div>}
        <div className="ejb-actions">{job.status === 'running' ? <button className="ejb-secondary" onClick={() => void api(`cancel?id=${job.id}`, {}).then(() => setJobs(prev => prev.map(item => item.id === job.id ? {...item, status: 'cancelled'} : item))).catch(e => setError(e.message))}>取消任务</button> : null}</div>
        <details><summary>查看发布日志</summary><pre className="ejb-log">{job.logs.join('\n') || '等待任务开始'}</pre></details>
      </div>}
      {jobs.length > 1 && <div className="ejb-card"><h2>最近任务</h2>{jobs.slice(0, 8).map(item => <button className="ejb-job" key={item.id} onClick={() => setSelected(item.id)}><span><strong>{item.input.title || '未命名发布'}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="ejb-muted">{item.targets.length} 个平台</span></button>)}</div>}
    </div></div>}
    {tab === 'accounts' && <div className="ejb-grid"><div><div className="ejb-card"><h2>已登录账号</h2>
      {accounts.length ? accounts.map(row => <div className="ejb-row" key={`${row.platform}:${row.phone}`}><span>{PLATFORM_LABELS[row.platform as Platform] || row.platform}<small>{row.phone || row.partition}</small></span><span className={row.loggedIn ? 'ejb-ok' : 'ejb-muted'}>{row.loggedIn ? '登录有效' : row.reason || '未登录'}</span></div>)
        : <div className="ejb-empty">还没有读到已登录的账号<br/>先在矩媒界面里登录一次，再回到这里刷新。</div>}
      <div className="ejb-actions"><button className="ejb-secondary" onClick={() => void api<AccountRow[]>('accounts').then(setAccounts).catch(e => setError(e.message))}>刷新账号</button></div>
    </div></div><div><div className="ejb-card"><h2>扫码登录</h2>
      <div className="ejb-field"><label htmlFor="ejb-lp">平台</label><select id="ejb-lp" className="ejb-input" value={loginPlatform} onChange={e => setLoginPlatform(e.target.value as Platform)}>{CLI_LOGIN_PLATFORMS.map(platform => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</select></div>
      <div className="ejb-field"><label htmlFor="ejb-lph">手机号（可选）</label><input id="ejb-lph" className="ejb-input" placeholder="多账号时用于指定账号" value={loginPhone} onChange={e => setLoginPhone(e.target.value)}/></div>
      {login?.qr && <img className="ejb-qr" src={login.qr} alt="登录二维码"/>}
      {login && <p className={login.state === 'ok' ? 'ejb-muted ejb-ok' : 'ejb-muted'}>{login.message}</p>}
      <div className="ejb-actions">
        <button className="ejb-primary" disabled={login?.state === 'pending'} onClick={() => void startLogin()}>{login?.qr ? '重新获取二维码' : '获取二维码'}</button>
        {login?.state === 'pending' && <button className="ejb-secondary" onClick={() => void api(`login-cancel?id=${login.id}`, {}).then(() => setLogin(undefined)).catch(e => setError(e.message))}>取消</button>}
        {login?.state === 'ok' && <button className="ejb-secondary" onClick={() => void api<AccountRow[]>('accounts').then(setAccounts).catch(e => setError(e.message))}>刷新账号</button>}
      </div>
      <p className="ejb-muted">只有抖音和视频号支持在面板里扫码；其余平台请在矩媒界面里登录，登录状态会被自动读取。</p>
    </div></div></div>}
    {tab === 'history' && <div className="ejb-card"><h2>平台发布记录</h2>
      {history.length ? history.map((row, index) => <div className="ejb-row" key={`${row.date}:${row.platform}:${row.phone}:${index}`}><span>{row.title || '（无标题）'}<small>{PLATFORM_LABELS[row.platform as Platform] || row.platform}{row.phone ? ` · ${row.phone}` : ''} · {new Date(row.lastAt || Date.parse(row.date)).toLocaleString()}</small></span><span style={{textAlign: 'right'}}><span className={row.status === 'success' ? 'ejb-ok' : row.status === 'failed' ? 'ejb-error' : 'ejb-muted'} style={{background: 'none', border: 0, padding: 0, margin: 0}}>{row.status === 'success' ? '已发布' : row.status === 'failed' ? '失败' : row.status === 'scheduled' ? '已定时' : row.status === 'expired' ? '已过期' : '发布中'}</span>{row.message && <small>{row.message}</small>}</span></div>)
        : <div className="ejb-empty">矩媒里还没有发布记录</div>}
      <div className="ejb-actions"><button className="ejb-secondary" onClick={() => void api<HistoryRow[]>('history').then(setHistory).catch(e => setError(e.message))}>刷新记录</button></div>
    </div>}
  </div></section>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: PANEL}, Publisher))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: PANEL, order: 42, label: '一稿多发'}, ({size}: PropsRuntime<'sidebar.panellist'>) => <Send size={size}/>))
}
