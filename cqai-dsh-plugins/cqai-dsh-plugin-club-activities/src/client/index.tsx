import { useCallback, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClubExtensionProps } from '@cqaiclub/dsn-account/club-ui'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import { RPC_CHANNEL, type ActivityInput, type ActivitySnapshot, type ActivityView, type PluginSubmission, type PluginSubmissionInput } from '../protocol.ts'
import { applyClubMcpClient } from './mcp/index.tsx'

declare module '@deepseek-ai/cordis' {
  interface Context { connection: ConnectionHandle }
}

const NS = 'cqaiclub-activities' as const
const zh = { title: '俱乐部活动' }
const en = { title: 'Club activities' }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'cqaiclub-activities': keyof typeof zh }
}

type List<T> = { items: T[] }
type ManagedPage = List<ActivityView> & { total: number; page: number; totalPages: number }
type MyRegistration = { id: string; status: string; activity: ActivityView }
type Attendee = { id: string; displayName: string; registeredAt: string }
type View = 'upcoming' | 'mine' | 'submit' | 'manage'
type Form = Omit<ActivityInput, 'startsAt' | 'endsAt' | 'registrationOpensAt' | 'registrationClosesAt'> & {
  startsAt: string; endsAt: string; registrationOpensAt: string; registrationClosesAt: string
}
type SubmissionForm = Pick<PluginSubmissionInput,
  'packageName' | 'displayName' | 'summary' | 'description' | 'repositoryUrl' | 'homepageUrl'>
const emptySubmissionForm: SubmissionForm = {
  packageName: '', displayName: '', summary: '', description: '', repositoryUrl: '', homepageUrl: '',
}

const style = `
.cqaia{max-width:1060px;color:var(--dsw-alias-label-primary);font:inherit}
.cqaia *{box-sizing:border-box}
.cqaia h1{font-size:26px;margin:0 0 6px}.cqaia h2{font-size:19px;margin:0 0 12px}.cqaia h3{font-size:16px;margin:0 0 5px}
.cqaia p{line-height:1.55}.cqaia-muted{color:var(--dsw-alias-label-secondary)}
.cqaia-head,.cqaia-row,.cqaia-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cqaia-tabs{display:flex;gap:8px;margin:24px 0 20px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:10px}
.cqaia button,.cqaia a.cqaia-link{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;border-radius:9px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.cqaia button:hover,.cqaia button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}
.cqaia button:disabled{opacity:.55;cursor:default}.cqaia button.cqaia-primary{background:#385cdc;color:white;border-color:#385cdc}
.cqaia-card{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px;margin:0 0 12px;background:var(--dsw-alias-bg-layer-1)}
.cqaia-card p{margin:6px 0 12px}.cqaia-message{border-radius:9px;padding:10px 12px;background:var(--dsw-alias-interactive-bg-hover);margin:10px 0}
.cqaia-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.cqaia label{display:grid;gap:5px;font-size:13px}.cqaia input,.cqaia textarea,.cqaia select{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}
.cqaia textarea{min-height:110px}.cqaia-detail{white-space:pre-wrap}
.cqaia-form-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
`

async function rpc<T>(ctx: Context, endpoint: string, payload: unknown = {}): Promise<T> {
  const result = await ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload) as
    | { ok: true; value: T } | { ok: false; error: { message: string } }
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function datetime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
function localDate(iso: string): string {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function emptyForm(): Form {
  const start = Date.now() + 3 * 86_400_000
  return {
    title: '', summary: '', content: '', mode: 'offline', location: '', capacity: 30,
    startsAt: localDate(new Date(start).toISOString()),
    endsAt: localDate(new Date(start + 2 * 3_600_000).toISOString()),
    registrationOpensAt: localDate(new Date().toISOString()),
    registrationClosesAt: localDate(new Date(start - 3_600_000).toISOString()),
  }
}
function formOf(activity: ActivityView): Form {
  return {
    title: activity.title, summary: activity.summary, content: activity.content,
    mode: activity.mode, location: activity.location, capacity: activity.capacity,
    startsAt: localDate(activity.startsAt), endsAt: localDate(activity.endsAt),
    registrationOpensAt: localDate(activity.registrationOpensAt),
    registrationClosesAt: localDate(activity.registrationClosesAt),
  }
}
function isoInput(form: Form): ActivityInput {
  return {
    ...form,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    registrationOpensAt: new Date(form.registrationOpensAt).toISOString(),
    registrationClosesAt: new Date(form.registrationClosesAt).toISOString(),
  }
}

function ActivitiesPanel({ ctx, t }: ClubExtensionProps & PropsLocale<typeof NS> & { ctx: Context }) {
  const [view, setView] = useState<View>('upcoming')
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>({ state: 'signed-out' })
  const [activities, setActivities] = useState<ActivityView[]>([])
  const [mine, setMine] = useState<MyRegistration[]>([])
  const [managed, setManaged] = useState<ActivityView[]>([])
  const [managePage, setManagePage] = useState(1)
  const [manageTotal, setManageTotal] = useState(0)
  const [manageTotalPages, setManageTotalPages] = useState(0)
  const [manageLoading, setManageLoading] = useState(false)
  const [submissions, setSubmissions] = useState<PluginSubmission[]>([])
  const [submissionForm, setSubmissionForm] = useState<SubmissionForm>(emptySubmissionForm)
  const [submissionError, setSubmissionError] = useState('')
  const [attendees, setAttendees] = useState<{ id: string; items: Attendee[] } | null>(null)
  const [selected, setSelected] = useState<ActivityView | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async (requestedPage = managePage) => {
    const [auth, publicList] = await Promise.all([
      rpc<ActivitySnapshot>(ctx, 'auth/snapshot'),
      rpc<List<ActivityView>>(ctx, 'public/list'),
    ])
    setSnapshot(auth)
    setActivities(publicList.items)
    if (auth.state === 'signed-in') {
      const mineList = await rpc<List<MyRegistration>>(ctx, 'me/list')
      setMine(mineList.items)
      if (auth.canManage) {
        setManageLoading(true)
        try {
          let page = await rpc<ManagedPage>(ctx, 'manage/list', { page: requestedPage })
          if (requestedPage > 1 && requestedPage > Math.max(1, page.totalPages)) {
            const fallbackPage = Math.max(1, page.totalPages)
            page = await rpc<ManagedPage>(ctx, 'manage/list', { page: fallbackPage })
            setManagePage(fallbackPage)
          }
          setManaged(page.items)
          setManageTotal(page.total)
          setManageTotalPages(page.totalPages)
        } finally { setManageLoading(false) }
      } else {
        setManaged([]); setManagePage(1); setManageTotal(0); setManageTotalPages(0)
        setView(current => current === 'manage' ? 'upcoming' : current)
      }
      try {
        setSubmissions(await rpc<PluginSubmission[]>(ctx, 'submissions/list'))
        setSubmissionError('')
      } catch (caught) {
        setSubmissionError(caught instanceof Error ? caught.message : '无法读取插件投稿记录')
      }
    } else {
      setMine([]); setManaged([]); setSubmissions([]); setSubmissionError('')
      setManagePage(1); setManageTotal(0); setManageTotalPages(0)
      setView(current => current === 'manage' ? 'upcoming' : current)
    }
  }, [ctx, managePage])

  useEffect(() => { void refresh().catch(caught => setError(caught instanceof Error ? caught.message : '活动列表加载失败')) }, [refresh])
  useEffect(() => {
    if (snapshot.state !== 'authorizing') return
    const timer = setInterval(() => { void refresh().catch(caught => setError(caught instanceof Error ? caught.message : '活动列表加载失败')) }, 1500)
    return () => clearInterval(timer)
  }, [snapshot.state, refresh])

  async function run(operation: () => Promise<unknown>, success: string, options?: { managePage?: number }): Promise<void> {
    setBusy(true); setError(''); setMessage('')
    try {
      await operation()
      if (options?.managePage !== undefined) setManagePage(options.managePage)
      await refresh(options?.managePage)
      setMessage(success)
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败') }
    finally { setBusy(false) }
  }

  async function showAttendees(id: string): Promise<void> {
    await run(async () => {
      const list = await rpc<List<Attendee>>(ctx, 'manage/registrations', { id })
      setAttendees({ id, items: list.items })
    }, '已更新报名名单')
  }

  async function showDetail(id: string): Promise<void> {
    setBusy(true); setError('')
    try { setSelected(await rpc<ActivityView>(ctx, 'public/get', { id })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '活动详情加载失败') }
    finally { setBusy(false) }
  }

  function update<K extends keyof Form>(key: K, value: Form[K]): void {
    setForm(current => ({ ...current, [key]: value }))
  }
  function updateSubmission<K extends keyof SubmissionForm>(key: K, value: SubmissionForm[K]): void {
    setSubmissionForm(current => ({ ...current, [key]: value }))
  }

  const registered = selected ? mine.some(item => item.activity.id === selected.id && item.status === 'confirmed') : false
  const now = Date.now()
  const selectedOpen = selected?.status === 'published' &&
    Date.parse(selected.registrationOpensAt) <= now && Date.parse(selected.registrationClosesAt) > now &&
    Date.parse(selected.startsAt) > now && selected.registeredCount < selected.capacity

  return <div className="cqaia">
    <style>{style}</style>
    <header className="cqaia-head"><div><h1>{t('title')}</h1><p className="cqaia-muted">发现活动、报名参与，与 CQAI 社区一起交流。</p></div>
      {snapshot.state === 'signed-in'
        ? <span className="cqaia-muted">{snapshot.displayName ?? '已登录 CQAI Club'}</span>
        : <button type="button" className="cqaia-primary" disabled={busy || snapshot.state === 'authorizing'} onClick={() => { void run(() => rpc(ctx, 'auth/start'), '请在浏览器中完成 CQAI Club 登录') }}>
          {snapshot.state === 'reauth-required' ? '更新 CQAI Club 登录' : '登录 CQAI Club'}
        </button>}
    </header>
    {snapshot.message && <p className="cqaia-message" role="status">{snapshot.message}</p>}
    {snapshot.state === 'authorizing' && snapshot.authorizationUrl && <p><a className="cqaia-link" href={snapshot.authorizationUrl} target="_blank" rel="noreferrer">打开 CQAI Club 登录页面</a></p>}
    {error && <p className="cqaia-message" role="alert">{error}</p>}
    {message && <p className="cqaia-message" role="status">{message}</p>}
    <nav className="cqaia-tabs" aria-label="活动导航">
      {([['upcoming', '活动列表'], ['mine', '我的报名'], ['submit', '提交插件'], ...(snapshot.canManage ? [['manage', '活动管理']] : [])] as [View, string][]).map(([id, label]) =>
        <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}
      <button type="button" onClick={() => { void run(async () => undefined, '列表已刷新') }}>刷新</button>
    </nav>

    {view === 'upcoming' && <section>
      {activities.length === 0 ? <p className="cqaia-muted">暂无活动。</p> : activities.map(item => <article className="cqaia-card" key={item.id}>
        <div className="cqaia-row"><h3>{item.title}</h3><span className="cqaia-muted">{item.status === 'cancelled' ? '已取消' : `${item.registeredCount}/${item.capacity} 人`}</span></div>
        <p>{item.summary}</p><p className="cqaia-muted">{datetime(item.startsAt)} · {item.location}</p>
        <button type="button" disabled={busy} onClick={() => { void showDetail(item.id) }}>查看详情</button>
      </article>)}
      {selected && <div className="cqaia-card">
        <div className="cqaia-row"><h2>{selected.title}</h2><button type="button" onClick={() => setSelected(null)}>收起</button></div>
        <p className="cqaia-muted">{datetime(selected.startsAt)} 至 {datetime(selected.endsAt)} · {selected.location}</p>
        {selected.detailsChangedAt && <p className="cqaia-message">活动信息已有更新，请核对时间和地点。</p>}
        {selected.status === 'cancelled' && <p className="cqaia-message">该活动已取消。</p>}
        <p className="cqaia-detail">{selected.content}</p>
        {snapshot.state !== 'signed-in' ? <p className="cqaia-muted">登录 CQAI Club 后可报名；旧登录可能需要更新一次授权。</p> :
          <button type="button" className="cqaia-primary" disabled={busy || (!registered && !selectedOpen)}
            onClick={() => { void run(() => rpc(ctx, registered ? 'registration/delete' : 'registration/create', { id: selected.id }), registered ? '已取消报名' : '报名成功') }}>
            {registered ? '取消报名' : selectedOpen ? '立即报名' : '报名未开放或已满员'}
          </button>}
      </div>}
    </section>}

    {view === 'mine' && <section>
      {snapshot.state !== 'signed-in' ? <p className="cqaia-muted">请先登录 CQAI Club 查看报名记录。</p> :
        mine.length === 0 ? <p className="cqaia-muted">暂无报名记录。</p> : mine.map(item => <article key={item.id} className="cqaia-card">
          <div className="cqaia-row"><h3>{item.activity.title}</h3><span>{item.status === 'confirmed' ? '已报名' : '已取消报名'}</span></div>
          <p className="cqaia-muted">{datetime(item.activity.startsAt)} · {item.activity.deletedAt ? '活动已下架' : item.activity.status === 'cancelled' ? '活动已取消' : item.activity.location}</p>
          {item.status === 'confirmed' && <button disabled={busy} type="button" onClick={() => { void run(() => rpc(ctx, 'registration/delete', { id: item.activity.id }), '已取消报名') }}>取消报名</button>}
        </article>)}
    </section>}

    {view === 'submit' && <section>
      <h2>提交插件资料</h2>
      <p className="cqaia-muted">提交 npm 插件信息供俱乐部审核。这里不上传安装包，也不会自动发布或上架。</p>
      {snapshot.state !== 'signed-in' ? <p className="cqaia-message">请先登录 CQAI Club；已登录但授权较旧时，点击顶部按钮更新一次登录。</p> : <>
        <div className="cqaia-card">
          <div className="cqaia-grid">
            <label>npm 包名<input value={submissionForm.packageName} maxLength={214} placeholder="@作者/插件名" onChange={event => updateSubmission('packageName', event.target.value)} /></label>
            <label>展示名称<input value={submissionForm.displayName} maxLength={120} onChange={event => updateSubmission('displayName', event.target.value)} /></label>
            <label>简介<input value={submissionForm.summary} maxLength={1000} onChange={event => updateSubmission('summary', event.target.value)} /></label>
            <label>仓库地址<input type="url" value={submissionForm.repositoryUrl} placeholder="https://" onChange={event => updateSubmission('repositoryUrl', event.target.value)} /></label>
            <label>主页地址<input type="url" value={submissionForm.homepageUrl} placeholder="https://" onChange={event => updateSubmission('homepageUrl', event.target.value)} /></label>
          </div>
          <p><label>详细介绍<textarea value={submissionForm.description} maxLength={5000} onChange={event => updateSubmission('description', event.target.value)} /></label></p>
          <p className="cqaia-form-note">请确认 npm 包已可安装，包名和地址准确。提交后由管理员审核。</p>
          <button type="button" className="cqaia-primary" disabled={busy || !submissionForm.packageName.trim() || !submissionForm.displayName.trim() || !submissionForm.summary.trim()}
            onClick={() => {
              const input: PluginSubmissionInput = {
                packageName: submissionForm.packageName.trim(), displayName: submissionForm.displayName.trim(),
                summary: submissionForm.summary.trim(), description: submissionForm.description?.trim() ?? '',
                repositoryUrl: submissionForm.repositoryUrl?.trim() ?? '', homepageUrl: submissionForm.homepageUrl?.trim() ?? '',
              }
              if (!confirm(`确认提交以下插件资料供审核？\n\n${input.displayName}\n${input.packageName}\n${input.summary}`)) return
              void run(async () => { await rpc(ctx, 'submissions/create', { input }); setSubmissionForm(emptySubmissionForm) }, '插件资料已提交，等待管理员审核')
            }}>提交审核</button>
        </div>
        <h2>我的投稿</h2>
        {submissionError && <p className="cqaia-message" role="alert">{submissionError}</p>}
        {submissions.length === 0 ? <p className="cqaia-muted">暂无投稿记录。</p> : submissions.map(item => <article key={item.id} className="cqaia-card">
          <div className="cqaia-row"><h3>{item.displayName}</h3><span>{item.status === 'pending' ? '待审核' : item.status === 'approved' ? '已通过审核，待发布' : '未通过审核'}</span></div>
          <p>{item.packageName} · {item.summary}</p>
          <p className="cqaia-muted">提交于 {datetime(item.createdAt)}</p>
          {item.reviewNote && <p className="cqaia-message">审核说明：{item.reviewNote}</p>}
        </article>)}
      </>}
    </section>}

    {view === 'manage' && snapshot.canManage && <section>
      <div className="cqaia-row"><h2>全部活动</h2><button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>新建活动</button></div>
      <div className="cqaia-row cqaia-card" aria-label="活动管理分页">
        <span className="cqaia-muted">第 {managePage} / {Math.max(1, manageTotalPages)} 页 · 共 {manageTotal} 项</span>
        <div className="cqaia-actions">
          <button type="button" disabled={busy || manageLoading || managePage <= 1} onClick={() => setManagePage(page => Math.max(1, page - 1))}>上一页</button>
          <button type="button" disabled={busy || manageLoading || managePage >= manageTotalPages} onClick={() => setManagePage(page => Math.min(manageTotalPages, page + 1))}>下一页</button>
        </div>
      </div>
      {managed.length === 0 && <p className="cqaia-muted">当前页暂无活动。</p>}
      {managed.map(item => <article key={item.id} className="cqaia-card">
        <div className="cqaia-row"><h3>{item.title}</h3><span className="cqaia-muted">{item.status} · {item.registeredCount}/{item.capacity}</span></div>
        <p className="cqaia-muted">{datetime(item.startsAt)}</p><div className="cqaia-actions">
          {item.status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => { setEditingId(item.id); setForm(formOf(item)) }}>编辑</button>}
          {item.status === 'draft' && <button type="button" disabled={busy} onClick={() => { void run(() => rpc(ctx, 'activity/publish', { id: item.id }), '活动已发布') }}>发布</button>}
          {item.status === 'published' && <button type="button" disabled={busy} onClick={() => { if (confirm('确定取消该活动？')) void run(() => rpc(ctx, 'activity/cancel', { id: item.id }), '活动已取消') }}>取消活动</button>}
          <button type="button" disabled={busy} onClick={() => { void showAttendees(item.id) }}>报名名单</button>
          <button type="button" disabled={busy} onClick={() => { if (confirm('确定删除该活动？')) void run(() => rpc(ctx, 'activity/delete', { id: item.id }), '活动已删除') }}>删除</button>
        </div>
        {attendees?.id === item.id && <div><h3>已报名（{attendees.items.length}）</h3>
          {attendees.items.length === 0 ? <p>暂无报名</p> : <ul>{attendees.items.map(person => <li key={person.id}>{person.displayName} · {datetime(person.registeredAt)}</li>)}</ul>}
        </div>}
      </article>)}
      <div className="cqaia-card"><h2>{editingId ? '编辑活动' : '创建活动'}</h2>
        <div className="cqaia-grid">
          <label>标题<input value={form.title} maxLength={120} onChange={event => update('title', event.target.value)} /></label>
          <label>简介<input value={form.summary} maxLength={300} onChange={event => update('summary', event.target.value)} /></label>
          <label>形式<select value={form.mode} onChange={event => update('mode', event.target.value)}><option value="offline">线下</option><option value="online">线上</option></select></label>
          <label>地点或链接<input value={form.location} onChange={event => update('location', event.target.value)} /></label>
          <label>开始时间<input type="datetime-local" value={form.startsAt} onChange={event => update('startsAt', event.target.value)} /></label>
          <label>结束时间<input type="datetime-local" value={form.endsAt} onChange={event => update('endsAt', event.target.value)} /></label>
          <label>报名开放<input type="datetime-local" value={form.registrationOpensAt} onChange={event => update('registrationOpensAt', event.target.value)} /></label>
          <label>报名截止<input type="datetime-local" value={form.registrationClosesAt} onChange={event => update('registrationClosesAt', event.target.value)} /></label>
          <label>人数上限<input type="number" min={1} max={100000} value={form.capacity} onChange={event => update('capacity', Number(event.target.value))} /></label>
        </div>
        <p><label>活动详情<textarea value={form.content} maxLength={20000} onChange={event => update('content', event.target.value)} /></label></p>
        <button type="button" className="cqaia-primary" disabled={busy} onClick={() => { void run(async () => {
          const saved = await rpc<ActivityView>(ctx, editingId ? 'activity/update' : 'activity/create', { id: editingId, input: isoInput(form) })
          setEditingId(saved.id)
        }, '活动已保存', editingId ? undefined : { managePage: 1 }) }}>保存{editingId ? '修改' : '草稿'}</button>
      </div>
    </section>}
  </div>
}

export const inject = ['slots', 'locale', 'connection']
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cqaiclub-activities: dictionaries')
  ctx.slots.inject('cqaiclub.club.extension', () => ctx.slots.register({
    name: 'cqaiclub.club.extension', id: 'activities', order: 30, label: () => t('title'), locale: NS,
  }, (props: ClubExtensionProps & PropsLocale<typeof NS>) => <ActivitiesPanel {...props} ctx={ctx} />))
  applyClubMcpClient(ctx)
}
