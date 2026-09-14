import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState } from 'react'
import { API, STAGES, LABELS, type Job, type Options, type UploadKind } from '../protocol.ts'
import { UPLOADS, uploadKinds, validateUpload } from '../uploads.ts'

export const inject = ['slots']
const PANEL = 'cqai-video' as MainPanelId
const defaults: Options = {title: '', text: '', duration: 60, mode: 'video', optimize: false, covers: false, studio: false}
const statusText: Record<Job['status'], string> = {draft: '待开始', running: '制作中', completed: '已完成', failed: '制作失败', cancelled: '已取消', interrupted: '已中断'}
async function api<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API}/${action}`, data === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json', 'x-ejianbao': '1'}, body: JSON.stringify(data)})
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('视频制作服务暂未就绪，请稍候或重启应用')
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result as T
}
function artifactUrl(job: Job, file: string, download = false): string {return `${API}/artifact?id=${job.id}&file=${encodeURIComponent(file)}${download ? '&download=1' : ''}`}
const css = `
.ejb{height:100%;overflow:auto;color:var(--foreground,#ededf0);background:var(--background,#151517);font-family:inherit;container-type:inline-size;box-sizing:border-box}.ejb *{box-sizing:border-box}.ejb button,.ejb input,.ejb textarea,.ejb select{font:inherit}.ejb button{cursor:pointer}.ejb button:disabled{opacity:.45;cursor:wait}.ejb-wrap{max-width:1260px;padding:28px 32px 48px;margin:auto}.ejb-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.ejb-head h1{font-size:26px;margin:0 0 8px;font-weight:700;letter-spacing:-1px}.ejb-muted{font-size:13px;color:#9b9ba4;line-height:1.7}.ejb-badge{color:#c4b5fd;background:#a78bfa16;border:1px solid #a78bfa35;border-radius:100px;padding:7px 12px;font-size:12px;white-space:nowrap}.ejb-tabs{display:flex;gap:8px;border-bottom:1px solid #ffffff16;padding-bottom:14px;margin-bottom:22px}.ejb-tab,.ejb-secondary{border:1px solid #ffffff24;background:#ffffff05;color:inherit;border-radius:9px;padding:9px 15px}.ejb-tab[aria-selected=true]{background:#a78bfa22;border-color:#a78bfa66;color:#d3c6ff}.ejb-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(270px,1fr);gap:20px}.ejb-card{border:1px solid #ffffff17;background:#ffffff03;border-radius:15px;padding:22px;margin-bottom:18px}.ejb-card h2{font-size:15px;margin:0 0 18px;display:flex;gap:10px;align-items:center}.ejb-num{color:#bca8fa;font:12px monospace;letter-spacing:1px}.ejb label{display:block;font-size:13px;margin-bottom:8px;color:#c9c9d0}.ejb-field{margin-bottom:18px}.ejb-input{display:block;width:100%;padding:11px 13px;border:1px solid #ffffff25;border-radius:9px;background:#08080c44;color:inherit;outline:none}.ejb-input:focus{border-color:#a78bfa}.ejb textarea{min-height:190px;resize:vertical;line-height:1.8}.ejb-modes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}.ejb-mode{border:1px solid #ffffff22;border-radius:10px;background:none;color:inherit;padding:13px 5px;font-size:13px!important}.ejb-mode[aria-pressed=true]{border-color:#a78bfa;background:#a78bfa18}.ejb-upload{position:relative;border:1px dashed #ffffff30;border-radius:11px;padding:17px;background:#ffffff02;margin:12px 0}.ejb-upload input{display:block;width:100%;margin-top:10px;font-size:12px;color:#9898a3}.ejb-upload strong{font-size:13px;font-weight:500}.ejb-check{display:flex!important;gap:10px;align-items:flex-start;margin:14px 0!important;line-height:1.5}.ejb-check input{accent-color:#a78bfa;margin-top:3px}.ejb-primary{width:100%;background:#b8a1ff;color:#191123;border:0;border-radius:10px;padding:13px 18px;font-weight:650!important;box-shadow:0 3px 18px #9b7bf322}.ejb-error{color:#ffb6b6;background:#ff666614;border:1px solid #ff66662a;border-radius:9px;padding:12px;margin:16px 0;white-space:pre-wrap;font-size:13px}.ejb-env{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin-top:12px}.ejb-env span{padding:4px 8px;border-radius:5px;background:#ffffff08;color:#acacb5}.ejb-env .ok{color:#8fd6b2}.ejb-flow{display:flex;flex-wrap:wrap;gap:7px}.ejb-step{border:1px solid #ffffff1a;border-radius:8px;padding:9px 11px;font-size:12px;color:#9797a2}.ejb-step.completed{color:#88d8b0;border-color:#88d8b044}.ejb-step.running{color:#cfbcff;border-color:#b99bff;background:#a78bfa16}.ejb-step.failed{color:#ffb0b0}.ejb-step.skipped{opacity:.5}.ejb-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}.ejb-actions .ejb-primary{width:auto}.ejb-log{white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;background:#0004;border-radius:8px;padding:13px;font:11px/1.7 Consolas,monospace;color:#b8b8c2}.ejb video{width:100%;max-height:480px;border-radius:11px;background:#000}.ejb-artifacts{display:grid;gap:8px;margin-top:15px}.ejb-artifacts a{padding:10px 12px;border:1px solid #ffffff18;border-radius:8px;text-decoration:none;color:#d2c2ff;font-size:12px;display:flex;justify-content:space-between;gap:12px}.ejb-job{display:flex;width:100%;align-items:center;justify-content:space-between;text-align:left;margin:0 0 10px;padding:15px;border:1px solid #ffffff1c;border-radius:10px;background:#ffffff04;color:inherit}.ejb-job strong{display:block;font-size:14px;margin-bottom:5px}.ejb-job small{color:#90909b}.ejb-empty{text-align:center;padding:40px 20px;border:1px dashed #ffffff22;border-radius:12px;color:#9f9fa9;font-size:13px;line-height:1.9}.ejb-summary{display:flex;justify-content:space-between;gap:15px;margin-bottom:16px}.ejb-summary h2{margin:0;font-size:17px}.ejb-covers{display:flex;gap:8px;margin-top:12px;overflow:auto}.ejb-covers img{height:100px;border-radius:7px}.ejb details summary{cursor:pointer;font-size:12px;color:#a6a6b2;margin:17px 0 8px}.ejb progress{width:100%;accent-color:#b8a1ff;height:6px}@container(max-width:750px){.ejb-wrap{padding:22px 18px}.ejb-grid{grid-template-columns:1fr}.ejb-head{align-items:flex-start}.ejb-badge{display:none}}
`
function Scissors({size = 20}: {size?: number}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20.2 3.8M14 14l-2-2"/></svg>}
function Studio() {
  const [options, setOptions] = useState(defaults)
  const [files, setFiles] = useState<Partial<Record<UploadKind, File>>>({})
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState<string>()
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [busy, setBusy] = useState('')
  const creating = useRef(false)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<Record<string, unknown>>()
  const job = jobs.find(j => j.id === selected)
  const refresh = () => api<Job[]>('jobs').then(setJobs)
  useEffect(() => {
    let live = true
    const poll = () => {api<Job[]>('jobs').then(data => {if (live) setJobs(data)}).catch(e => {if (live) setError(String(e.message))})}
    poll(); api<Record<string, unknown>>('health').then(data => {if (live) setHealth(data)}).catch(() => {})
    const timer = setInterval(poll, 2000); return () => {live = false; clearInterval(timer)}
  }, [])
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
      if (action === 'start' && job.options.mode === 'digitalhuman' && (!job.cloud || !job.cloud.submissionStarted && Date.parse(job.cloud.quote.expiresAt) <= Date.now())) {
        await api(`quote?id=${job.id}`, {})
      } else {await api(`${action}?id=${job.id}`, {})}
      await refresh()
    } catch (e) {setError(e instanceof Error ? e.message : '操作失败')} finally {setBusy('')}
  }
  const stageSummary = job && <div className="ejb-flow">{STAGES.map((stage, i) => <div key={stage} className={`ejb-step ${job.stages[stage] || ''}`}>{job.stages[stage] === 'completed' ? '✓' : String(i + 1).padStart(2, '0')}　{LABELS[stage]}{job.stages[stage] === 'skipped' ? ' · 跳过' : ''}</div>)}</div>
  return <section className="ejb" data-cqai-video-main=""><style>{css}</style><div className="ejb-wrap">
    <header className="ejb-head"><div><h1>e剪宝</h1><div className="ejb-muted">从口播素材到完整成片，让每一句话都有画面。</div></div><span className="ejb-badge">口播视频工作台</span></header>
    <nav className="ejb-tabs" aria-label="视频制作"><button className="ejb-tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>新建视频</button><button className="ejb-tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>制作记录 {jobs.length > 0 && `· ${jobs.length}`}</button></nav>
    {error && <div className="ejb-error" role="alert">{error}</div>}
    {tab === 'new' ? <div className="ejb-grid"><div>
      <div className="ejb-card"><h2><span className="ejb-num">01</span>选择制作方式</h2><div className="ejb-modes">{([['video', '已有口播视频'], ['digitalhuman', '数字人口播'], ['plan', '仅生成动效方案']] as const).map(([mode, label]) => <button key={mode} className="ejb-mode" aria-pressed={options.mode === mode} onClick={() => {update('mode', mode); if (mode === 'digitalhuman') setOptions(prev => ({...prev, mode, optimize: false, covers: false}))}}>{label}</button>)}</div>
        <div className="ejb-muted">{options.mode === 'video' ? '保留原声，自动添加字幕、内容卡片和画中画动效。' : options.mode === 'digitalhuman' ? '使用你有权使用的形象照与参考录音，通过产品账户生成口播视频，无需配置厂商密钥。先获取报价，确认后使用账户额度。' : '不生成视频，先整理文案并生成可编辑的 Remotion 动效组件包。'}</div>
        {options.mode === 'video' && uploadField('video', '口播视频', '.mp4,.mov,.webm,.mkv', 'MP4 / MOV / WEBM / MKV · 最大 1 GB')}
        {options.mode === 'digitalhuman' && <>{uploadField('avatar', '授权形象照', '.png,.jpg,.jpeg,.webp', '清晰正面照片')}{uploadField('voice', '参考录音', '.mp3,.m4a,.wav,.ogg', '建议 20 秒左右的干净人声')}</>}
      </div>
      <div className="ejb-card"><h2><span className="ejb-num">02</span>文案与主题</h2><div className="ejb-field"><label htmlFor="ejb-title">视频标题</label><input id="ejb-title" className="ejb-input" maxLength={120} placeholder="给这条视频起个名字" value={options.title} onChange={e => update('title', e.target.value)}/></div><label htmlFor="ejb-text">口播文案</label><textarea id="ejb-text" className="ejb-input" maxLength={50000} placeholder="粘贴你的口播稿，或在下方上传文案文件…" value={options.text} onChange={e => update('text', e.target.value)}/><div className="ejb-muted">{options.text.length} 字 · 同时填写和上传时，使用填写的文案</div>{uploadField('script', '文案文件（可选）', '.txt,.md,.docx', '支持 Word、Markdown 和纯文本')}</div>
    </div><div><div className="ejb-card"><h2><span className="ejb-num">03</span>制作设置</h2><label htmlFor="ejb-duration">{options.mode === 'video' ? '参考时长（实际以视频为准）' : '目标时长（秒）'}</label><input id="ejb-duration" type="number" min={2} max={1800} className="ejb-input" value={options.duration} onChange={e => update('duration', Number(e.target.value))}/>
      <label className="ejb-check"><input type="checkbox" checked={options.optimize} disabled={options.mode === 'digitalhuman'} onChange={e => update('optimize', e.target.checked)}/><span>AI 优化文案与标题<div className="ejb-muted">调用已配置的 DeepSeek API；会发送文案并消耗额度。</div></span></label>
      <label className="ejb-check"><input type="checkbox" checked={options.covers} disabled={options.mode === 'digitalhuman'} onChange={e => update('covers', e.target.checked)}/><span>生成三种尺寸的封面<div className="ejb-muted">调用已配置的通义万相 API，消耗图片生成额度。</div></span></label>
      <label className="ejb-check"><input type="checkbox" checked={options.studio} disabled={options.mode === 'plan'} onChange={e => update('studio', e.target.checked)}/><span>导入本地动效预览台<div className="ejb-muted">适用于已在本机启动的动效组件预览台。</div></span></label>
    </div><div className="ejb-card"><h2>你将得到</h2><div className="ejb-muted">{options.mode === 'plan' ? '整理后的口播稿、动效计划、可编辑 TSX 组件包与发布文案。' : '1080p 横版成片、原声与字幕、可编辑动效组件包、标题与发布素材。'}<br/>发布包生成后可先预览、下载，再自行发布。</div><div className="ejb-env">{health ? <><span className={health.python ? 'ok' : ''}>Python {health.python ? '✓' : '未就绪'}</span><span className={health.ffmpeg ? 'ok' : ''}>视频处理 {health.ffmpeg ? '✓' : '未就绪'}</span><span className={health.render ? 'ok' : ''}>渲染引擎 {health.render ? '✓' : '未就绪'}</span><span>字幕校准 · {health.semantic ? '语义级' : '停顿级'}</span></> : <span>正在检查制作环境…</span>}</div></div>
    <button className="ejb-primary" disabled={!!busy || health?.python === false || jobs.some(j => j.status === 'running')} onClick={() => void create()}>{busy || (options.mode === 'plan' ? '生成动效方案' : options.mode === 'digitalhuman' ? '获取账户报价' : '开始制作视频')}</button><p className="ejb-muted">任务保存在本机，失败后可继续。{options.mode !== 'plan' && '渲染期间请保持易宝工坊运行。'}</p></div></div> : <div className="ejb-grid"><div><div className="ejb-card"><h2>制作记录</h2>{jobs.length ? jobs.map(item => <button className="ejb-job" key={item.id} onClick={() => setSelected(item.id)}><span><strong>{item.options.title || '未命名视频'}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><span className="ejb-muted">{statusText[item.status]}</span></button>) : <div className="ejb-empty">还没有制作记录<br/>从一段口播文案开始你的第一条视频。</div>}</div></div><div>{job ? <div className="ejb-card"><div className="ejb-summary"><h2>{job.options.title || '未命名视频'}</h2><span className="ejb-muted">{statusText[job.status]}</span></div>{stageSummary}{job.cloud && <p className="ejb-muted">预计消耗：{job.cloud.quote.displayAmount || (job.cloud.quote.amount + ' ' + job.cloud.quote.unit)}。按实际输出时长结算，最终以账户账单为准。{job.cloud.submissionStarted && '云端任务已提交，关闭页面或停止本地等待不会取消生成。'}</p>}{job.status === 'running' && <p className="ejb-muted">正在{job.stage ? LABELS[job.stage] : '准备素材'}…</p>}{job.error && <div className="ejb-error">{job.error}</div>}<div className="ejb-actions">{job.status === 'running' ? <button className="ejb-secondary" disabled={!!busy} onClick={() => void control('cancel')}>{job.cloud?.submissionStarted ? '停止本地等待' : '取消任务'}</button> : job.status !== 'completed' && <button className="ejb-primary" disabled={!!busy} onClick={() => void control('start')}>{job.options.mode === 'digitalhuman' && !job.cloud?.submissionStarted ? job.cloud && Date.parse(job.cloud.quote.expiresAt) > Date.now() ? '确认报价并生成' : '获取账户报价' : '继续任务'}</button>}</div>
      {job.artifacts.some(a => a.file === 'final_video.mp4') ? <div style={{marginTop: 18}}><video controls preload="metadata" src={artifactUrl(job, 'final_video.mp4')} aria-label="成片预览"/></div> : <div className="ejb-empty" style={{marginTop: 18}}>{job.options.mode === 'plan' ? '动效方案生成后，可在下方下载文案和组件包。' : '成片完成后，将在这里显示预览。'}</div>}
      <div className="ejb-covers">{job.artifacts.filter(a => a.file.startsWith('cover_')).map(a => <img key={a.file} src={artifactUrl(job, a.file)} alt={a.name}/>)}</div><div className="ejb-artifacts">{job.artifacts.map(a => <a key={a.file} href={artifactUrl(job, a.file, true)} download={a.name}><span>↓ {a.name}</span><span>{a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)} MB` : `${Math.ceil(a.size / 1024)} KB`}</span></a>)}</div><details open={job.status === 'failed'}><summary>查看制作日志</summary><pre className="ejb-log">{job.logs.join('\n') || '等待任务开始'}</pre></details></div> : <div className="ejb-empty">选择一条制作记录，查看进度与产物。</div>}</div></div>}
  </div></section>
}
export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: PANEL}, Studio))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: PANEL, order: 41, label: 'e剪宝'}, ({size}: PropsRuntime<'sidebar.panellist'>) => <Scissors size={size}/>))
}
