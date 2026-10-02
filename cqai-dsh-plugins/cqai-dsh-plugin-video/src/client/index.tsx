import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { MediaSettingsEditor, mountVideoWorkspace } from 'cqai-dsh-media-settings/client'
import type { EjianbaoWorkspaceOwner } from 'cqai-dsh-media-settings/contracts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { styles } from './styles.ts'
import pluginIcon from '../../assets/plugin-icon.svg'
import { API, STAGES, LABELS, type Job, type Options, type UploadKind } from '../protocol.ts'
import { UPLOADS, uploadKinds, validateUpload } from '../uploads.ts'

export const inject = ['slots']
const PANEL = 'cqai-video' as MainPanelId
const defaults: Options = {title: '', text: '', duration: 60, mode: 'video', optimize: false, covers: false, studio: false}
const statusText: Record<Job['status'], string> = {draft: '待开始', running: '制作中', completed: '已完成', failed: '制作失败', cancelled: '已取消', interrupted: '已中断'}
const statusTone: Record<Job['status'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {draft: 'neutral', running: 'info', completed: 'success', failed: 'danger', cancelled: 'neutral', interrupted: 'warning'}
async function api<T>(action: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}/${action}`, data === undefined ? {signal} : {signal, method: 'POST', headers: {'content-type': 'application/json', 'x-ejianbao': '1'}, body: JSON.stringify(data)})
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('视频制作服务暂未就绪，请稍候或重启应用')
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result as T
}
function artifactUrl(job: Job, file: string, download = false): string {return `${API}/artifact?id=${job.id}&file=${encodeURIComponent(file)}${download ? '&download=1' : ''}`}
function VideoPanelIcon({size = 20}: {size?: number}) {return <img className="cqai-plugin-panel-icon" src={pluginIcon} width={size} height={size} alt="" draggable={false}/>}
function Studio({active = true, onOpenSettings}: Partial<EjianbaoWorkspaceOwner>) {
  const [options, setOptions] = useState(defaults)
  const [files, setFiles] = useState<Partial<Record<UploadKind, File>>>({})
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState<string>()
  const [tab, setTab] = useState<'new' | 'history' | 'settings'>('new')
  const [busy, setBusy] = useState('')
  const creating = useRef(false)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<Record<string, unknown>>()
  const job = jobs.find(j => j.id === selected)
  const refresh = () => api<Job[]>('jobs').then(setJobs)
  useEffect(() => {
    if (!active) return
    let live = true
    const controller = new AbortController()
    const poll = () => {api<Job[]>('jobs', undefined, controller.signal).then(data => {if (live) setJobs(data)}).catch(e => {if (live) setError(String(e.message))})}
    poll(); api<Record<string, unknown>>('health', undefined, controller.signal).then(data => {if (live) setHealth(data)}).catch(() => {})
    const timer = setInterval(poll, 2000); return () => {live = false; controller.abort(); clearInterval(timer)}
  }, [active])
  const update = <K extends keyof Options>(key: K, value: Options[K]) => setOptions(prev => ({...prev, [key]: value}))
  const uploadField = (kind: UploadKind, label: string, accept: string, hint: string) => <div className="ejb-upload"><strong>{label}</strong><div className="ejb-muted">{files[kind] ? `${files[kind]!.name} · ${Math.ceil(files[kind]!.size / 1024)} KB` : hint}</div><input aria-label={label} disabled={!!busy} type="file" accept={accept} onChange={e => {
    const file = e.target.files?.[0]; if (!file) return
    try {validateUpload(kind, file); setFiles(prev => ({...prev, [kind]: file})); setError('')}
    catch (error) {e.target.value = ''; setFiles(prev => ({...prev, [kind]: undefined})); setError(error instanceof Error ? error.message : '无法选择文件')}
  }} /></div>
  async function create() {
    if (creating.current) return
    setError('')
    if (!options.text.trim() && !files.script) {setError('请先填写文案或上传文案文件'); return}
    if (options.mode === 'digitalhuman' && options.text.length > 5000) {setError('数字人口播文案最多 5000 个字符'); return}
    if (options.mode === 'video' && !files.video) {setError('请先上传已有口播视频'); return}
    if (options.mode === 'digitalhuman' && (!files.avatar || !files.voice)) {setError('请上传形象照和参考录音'); return}
    const kinds = uploadKinds(options)
    creating.current = true; setBusy('检查素材…')
    try {
      for (const kind of kinds) {
        const file = files[kind]; if (!file) continue
        validateUpload(kind, file)
        try {if (!(await file.slice(0, 1).arrayBuffer()).byteLength) throw new Error('empty')}
        catch {throw new Error(`${UPLOADS[kind].label}“${file.name}”无法读取，请重新选择本机文件`)}
      }
      setBusy('创建任务…')
      const next = await api<Job>('jobs', options); setSelected(next.id)
      for (const kind of kinds) {
        const file = files[kind]; if (!file) continue
        setBusy(`上传${file.name}…`)
        const response = await fetch(`${API}/upload?id=${next.id}&kind=${kind}&name=${encodeURIComponent(file.name)}`, {method: 'POST', headers: {'x-ejianbao': '1', 'content-type': 'application/octet-stream'}, body: file})
        if (!response.ok) throw new Error((await response.json()).error || '上传失败')
      }
      if (options.mode === 'digitalhuman') {
        setBusy('获取账户报价…'); await api(`quote?id=${next.id}`, {})
      } else {setBusy('启动制作…'); await api(`start?id=${next.id}`, {})}
      await refresh(); setTab('history')
    } catch (e) {setError(e instanceof Error ? e.message : '创建失败')} finally {creating.current = false; setBusy('')}
  }
  async function control(action: 'start' | 'cancel') {
    if (!job) return; setBusy('处理中…'); setError('')
    try {
      if (action === 'start' && job.options.mode === 'digitalhuman' && (!job.cloud || !job.cloud.submissionStarted && (job.cloud.quote.pricingSource !== 'relay' || Date.parse(job.cloud.quote.expiresAt) <= Date.now()))) {
        await api(`quote?id=${job.id}`, {})
      } else {await api(`${action}?id=${job.id}`, {})}
      await refresh()
    } catch (e) {setError(e instanceof Error ? e.message : '操作失败')} finally {setBusy('')}
  }
  const stageSummary = job && <div className="ejb-flow">{STAGES.map((stage, i) => <div key={stage} className={`ejb-step ${job.stages[stage] || ''}`}>{job.stages[stage] === 'completed' ? '✓' : String(i + 1).padStart(2, '0')}　{LABELS[stage]}{job.stages[stage] === 'skipped' ? ' · 跳过' : ''}</div>)}</div>
  return <section className="ejb" data-cqai-video-main=""><style>{styles}</style><div className="ejb-wrap">
    <header className="ejb-head"><div><h1>数字人视频制作</h1><div className="ejb-muted">从口播素材到完整成片，让每一句话都有画面。</div></div><Tag tone="neutral">数字人视频工作台</Tag></header>
    <nav className="ejb-tabs" aria-label="视频制作"><Button className="ejb-tab" aria-current={tab === 'new' ? 'page' : undefined} onClick={() => setTab('new')}>新建视频</Button><Button className="ejb-tab" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>制作记录 {jobs.length > 0 && `· ${jobs.length}`}</Button>{!onOpenSettings && <Button className="ejb-tab" onClick={() => setTab('settings')}>设置</Button>}</nav>
    {error && <div className="ejb-error" role="alert">{error}</div>}
    {tab === 'settings' ? <MediaSettingsEditor api={API}/> : tab === 'new' ? <div className="ejb-grid"><div>
      <div className="ejb-card"><h2><span className="ejb-num">01</span>选择制作方式</h2><div className="ejb-modes">{([['video', '已有口播视频'], ['digitalhuman', '数字人口播'], ['plan', '仅生成动效方案']] as const).map(([mode, label]) => <button key={mode} className="ejb-mode" aria-pressed={options.mode === mode} onClick={() => {update('mode', mode); if (mode === 'digitalhuman') setOptions(prev => ({...prev, mode, optimize: false, covers: false}))}}>{label}</button>)}</div>
        <div className="ejb-muted">{options.mode === 'video' ? '保留原声，自动添加字幕、内容卡片和画中画动效。' : options.mode === 'digitalhuman' ? '使用你有权使用的形象照与参考录音，通过产品账户分段生成口播视频。先获取报价，确认后使用账户额度。' : '不生成视频，先整理文案并生成可编辑的 Remotion 动效组件包。'}</div>
        {options.mode === 'video' && uploadField('video', '口播视频', '.mp4,.mov,.webm,.mkv', 'MP4 / MOV / WEBM / MKV · 最大 1 GB')}
        {options.mode === 'digitalhuman' && <>{uploadField('avatar', '授权形象照', '.png,.jpg,.jpeg,.webp', '清晰正面照片')}{uploadField('voice', '参考录音', '.mp3,.m4a,.wav,.ogg', '建议 20 秒左右的干净人声')}</>}
      </div>
      <div className="ejb-card"><h2><span className="ejb-num">02</span>文案与主题</h2><div className="ejb-field"><label htmlFor="ejb-title">视频标题</label><Input id="ejb-title" className="ejb-field-control" maxLength={120} placeholder="给这条视频起个名字" value={options.title} onChange={e => update('title', e.target.value)}/></div><label htmlFor="ejb-text">口播文案</label><textarea id="ejb-text" className="ejb-textarea" maxLength={options.mode === 'digitalhuman' ? 5000 : 50000} placeholder="粘贴你的口播稿，或在下方上传文案文件…" value={options.text} onChange={e => update('text', e.target.value)}/><div className="ejb-muted ejb-field-hint">{options.text.length} / {options.mode === 'digitalhuman' ? 5000 : 50000} 字 · 同时填写和上传时，使用填写的文案</div>{uploadField('script', '文案文件（可选）', '.txt,.md,.docx', '支持 Word、Markdown 和纯文本')}</div>
    </div><div><div className="ejb-card"><h2><span className="ejb-num">03</span>制作设置</h2><label htmlFor="ejb-duration">{options.mode === 'video' ? '参考时长（实际以视频为准）' : options.mode === 'digitalhuman' ? '后期参考时长（秒；云端按文案估算）' : '目标时长（秒）'}</label><Input id="ejb-duration" type="number" min={2} max={1800} className="ejb-field-control" value={options.duration} onChange={e => update('duration', Number(e.target.value))}/>
      <label className="ejb-check"><input type="checkbox" checked={options.optimize} disabled={options.mode === 'digitalhuman'} onChange={e => update('optimize', e.target.checked)}/><span>AI 优化文案与标题<div className="ejb-muted">调用已配置的 DeepSeek API；会发送文案并消耗额度。</div></span></label>
      <label className="ejb-check"><input type="checkbox" checked={options.covers} disabled={options.mode === 'digitalhuman'} onChange={e => update('covers', e.target.checked)}/><span>生成三种尺寸的封面<div className="ejb-muted">调用已配置的通义万相 API，消耗图片生成额度。</div></span></label>
      <label className="ejb-check"><input type="checkbox" checked={options.studio} disabled={options.mode === 'plan'} onChange={e => update('studio', e.target.checked)}/><span>导入本地动效预览台<div className="ejb-muted">适用于已在本机启动的动效组件预览台。</div></span></label>
    </div><div className="ejb-card"><h2>你将得到</h2><div className="ejb-muted">{options.mode === 'plan' ? '整理后的口播稿、动效计划、可编辑 TSX 组件包与发布文案。' : '1080p 横版成片、原声与字幕、可编辑动效组件包、标题与发布素材。'}<br/>发布包生成后可先预览、下载，再自行发布。</div><div className="ejb-env">{health ? <><Tag className="ejb-status" tone={health.python ? 'success' : 'warning'}>Python {health.python ? '✓' : '未就绪'}</Tag><Tag className="ejb-status" tone={health.ffmpeg ? 'success' : 'warning'}>视频处理 {health.ffmpeg ? '✓' : '未就绪'}</Tag><Tag className="ejb-status" tone={health.render ? 'success' : 'warning'}>渲染引擎 {health.render ? '✓' : '未就绪'}</Tag><Tag tone="neutral">字幕校准 · {health.semantic ? '语义级' : '停顿级'}</Tag></> : <Tag tone="neutral">正在检查制作环境…</Tag>}</div></div>
    <Button variant="primary" className="ejb-create-action" aria-busy={!!busy} disabled={!!busy || health?.python === false || jobs.some(j => j.status === 'running')} onClick={() => void create()}>{busy || (options.mode === 'plan' ? '生成动效方案' : options.mode === 'digitalhuman' ? '获取账户报价' : '开始制作视频')}</Button><p className="ejb-muted">任务保存在本机，失败后可继续。{options.mode !== 'plan' && '渲染期间请保持e宝工坊运行。'}</p></div></div> : <div className="ejb-grid"><div><div className="ejb-card"><h2>制作记录</h2>{jobs.length ? jobs.map(item => <button className="ejb-job" key={item.id} aria-current={selected === item.id ? true : undefined} onClick={() => setSelected(item.id)}><span><strong>{item.options.title || '未命名视频'}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><Tag className="ejb-status" tone={statusTone[item.status]}>{statusText[item.status]}</Tag></button>) : <div className="ejb-empty">还没有制作记录<br/>从一段口播文案开始你的第一条视频。</div>}</div></div><div>{job ? <div className="ejb-card"><div className="ejb-summary"><h2>{job.options.title || '未命名视频'}</h2><Tag className="ejb-status" tone={statusTone[job.status]}>{statusText[job.status]}</Tag></div>{stageSummary}{job.cloud && <p className="ejb-muted">{job.cloud.quote.pricingSource === 'relay' ? '预计预扣：' : '历史预估：'}{job.cloud.quote.displayAmount || (job.cloud.quote.amount + ' ' + job.cloud.quote.unit)}。{job.cloud.quote.estimatedSeconds ? `按约 ${job.cloud.quote.estimatedSeconds} 秒口播预扣；` : ''}{job.cloud.quote.pricingSource === 'relay' ? '按实际输出时长结算，最终以账户账单为准。' : '此报价未按当前 Relay 实际预扣计算；已提交任务以账户账单为准。'}{job.cloud.submissionStarted && '云端任务已提交，关闭页面或停止本地等待不会取消生成。'}</p>}{job.status === 'running' && <p className="ejb-muted">正在{job.stage ? LABELS[job.stage] : '准备素材'}…</p>}{job.error && <div className="ejb-error">{job.error}</div>}<div className="ejb-actions">{job.status === 'running' ? <Button variant="outline" disabled={!!busy} onClick={() => void control('cancel')}>{job.cloud?.submissionStarted ? '停止本地等待' : '取消任务'}</Button> : job.status !== 'completed' && <Button variant="primary" disabled={!!busy} onClick={() => void control('start')}>{job.options.mode === 'digitalhuman' && !job.cloud?.submissionStarted ? job.cloud?.quote.pricingSource === 'relay' && Date.parse(job.cloud.quote.expiresAt) > Date.now() ? '确认费用并生成' : '获取账户报价' : '继续任务'}</Button>}</div>
      {job.artifacts.some(a => a.file === 'final_video.mp4') ? <div style={{marginTop: 18}}><video controls preload="metadata" src={artifactUrl(job, 'final_video.mp4')} aria-label="成片预览"/></div> : <div className="ejb-empty" style={{marginTop: 18}}>{job.options.mode === 'plan' ? '动效方案生成后，可在下方下载文案和组件包。' : '成片完成后，将在这里显示预览。'}</div>}
      <div className="ejb-covers">{job.artifacts.filter(a => a.file.startsWith('cover_')).map(a => <img key={a.file} src={artifactUrl(job, a.file)} alt={a.name}/>)}</div><div className="ejb-artifacts">{job.artifacts.map(a => <a key={a.file} href={artifactUrl(job, a.file, true)} download={a.name}><span>↓ {a.name}</span><span>{a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)} MB` : `${Math.ceil(a.size / 1024)} KB`}</span></a>)}</div><details open={job.status === 'failed'}><summary>查看制作日志</summary><pre className="ejb-log">{job.logs.join('\n') || '等待任务开始'}</pre></details></div> : <div className="ejb-empty">选择一条制作记录，查看进度与产物。</div>}</div></div>}
  </div></section>
}
export function apply(ctx: Context): void {
  mountVideoWorkspace(ctx, {id: 'video', panelId: PANEL, label: '数字人视频制作', order: 41, icon: VideoPanelIcon, component: Studio})
}
