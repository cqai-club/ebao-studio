import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { MediaSettingsEditor, mediaRequest } from 'cqai-dsh-media-settings/client'
import { EJIANBAO_WORKSPACES } from 'cqai-dsh-media-settings/contracts'

interface Setup {status: string; items?: {id: string; label: string; status: string; detail?: string}[]; logs?: string[]; updatedAt?: number}
type EnvironmentId = 'tools' | typeof EJIANBAO_WORKSPACES[number]['id']
interface EnvironmentState {health?: Record<string, unknown>; setup?: Setup; error?: string; checking?: boolean; installing?: boolean}
const targets = [{id: 'tools' as const, label: '公共制作工具', api: '/api/cqai-ejianbao', read: 'tools', setup: 'tools/setup'}, ...EJIANBAO_WORKSPACES.map(item => ({...item, read: 'health?refresh=1', setup: 'setup'}))]
const toolLabels = {python: 'Python 3.11', uv: '内置 uv', node: '宿主 Node.js', ffmpeg: 'FFmpeg', ffprobe: 'ffprobe'}
const engineLabels = {numpy: 'NumPy', render: '渲染引擎', renderer: '渲染引擎', remotion: 'Remotion 渲染', compositor: '视频合成', browser: '渲染浏览器', edgeTts: 'Edge 配音', asrModel: '语音识别模型', semantic: '语义字幕模型'}
const statusLabels: Record<string, string> = {idle: '待准备', pending: '待准备', ready: '就绪', running: '正在准备', completed: '完成', failed: '失败', skipped: '已跳过'}
const errorText = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试'

function SetupProgress({setup}: {setup?: Setup}) {
  if (!setup) return null
  return <>{setup.status === 'running' && <p role="status">正在准备依赖，请保持应用运行。</p>}{setup.status === 'completed' && <p role="status">准备完成，环境状态已重新检查。</p>}
    {setup.items?.map(item => <p className="ejianbao-muted" key={item.id}>{item.label} · {statusLabels[item.status] || item.status}{item.detail ? ` · ${item.detail}` : ''}</p>)}
    {setup.status === 'failed' && <p role="alert">准备失败，请查看日志后重试。</p>}
    {!!setup.logs?.length && <details className="ejianbao-muted"><summary>查看运行日志（{setup.logs.length} 行）</summary><pre className="ejianbao-log">{setup.logs.join('\n')}</pre></details>}</>
}
function packageReady(health: Record<string, unknown>, id: EnvironmentId): boolean | undefined {
  if (typeof health.pythonPackages === 'boolean') return health.pythonPackages
  if (id === 'video') return typeof health.python === 'boolean' && typeof health.numpy === 'boolean' ? health.python && health.numpy : undefined
  return typeof health.python === 'boolean' ? health.python : undefined
}

/** One setup completion refreshes public tools and every engine's health. */
function Environments() {
  const [states, setStates] = useState<Partial<Record<EnvironmentId, EnvironmentState>>>({})
  const mounted = useRef(false)
  const versions = useRef<Partial<Record<EnvironmentId, number>>>({})
  const update = useCallback((id: EnvironmentId, patch: Partial<EnvironmentState>) => {if (mounted.current) setStates(previous => ({...previous, [id]: {...previous[id], ...patch}}))}, [])
  const load = useCallback(async (target: typeof targets[number]) => {
    if (!mounted.current) return
    const version = (versions.current[target.id] || 0) + 1
    versions.current[target.id] = version
    update(target.id, {checking: true, error: ''})
    const results = await Promise.allSettled([mediaRequest<Record<string, unknown>>(target.api, target.read), ...(target.id === 'tools' ? [] : [mediaRequest<Setup>(target.api, target.setup)])])
    if (!mounted.current || versions.current[target.id] !== version) return
    const health = results[0], setup = results[1]
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => errorText(result.reason))
    update(target.id, {checking: false, error: [...new Set(errors)].join('；'), ...(health.status === 'fulfilled' ? {health: health.value as Record<string, unknown>, ...(target.id === 'tools' ? {setup: (health.value as {setup?: Setup}).setup} : {})} : {}), ...(setup?.status === 'fulfilled' ? {setup: setup.value as Setup} : {})})
  }, [update])
  const refreshAll = useCallback(async () => {await Promise.all(targets.map(load))}, [load])
  useEffect(() => {mounted.current = true; void refreshAll(); return () => {mounted.current = false}}, [refreshAll])
  const running = targets.filter(target => states[target.id]?.setup?.status === 'running').map(target => target.id).join(',')
  useEffect(() => {
    if (!running) return
    let live = true, polling = false
    const timer = setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const results = await Promise.all(targets.filter(target => running.split(',').includes(target.id)).map(async target => {
          const version = versions.current[target.id]
          try {return {target, version, setup: await mediaRequest<Setup>(target.api, target.setup)}} catch (error) {return {target, version, error: errorText(error)}}
        }))
        if (!live || !mounted.current) return
        let completed = false
        for (const result of results) {
          if (versions.current[result.target.id] !== result.version) continue
          if ('setup' in result && result.setup) {update(result.target.id, {setup: result.setup, error: ''}); if (result.setup.status !== 'running') completed = true}
          else update(result.target.id, {error: result.error})
        }
        if (completed) await refreshAll()
      } finally {polling = false}
    }, 2000)
    return () => {live = false; clearInterval(timer)}
  }, [running, refreshAll, update])
  const install = async (target: typeof targets[number]) => {
    update(target.id, {installing: true, error: ''})
    try {const setup = await mediaRequest<Setup>(target.api, target.setup, {}); update(target.id, {setup}); if (setup.status !== 'running') await refreshAll()} catch (error) {update(target.id, {error: errorText(error)})} finally {update(target.id, {installing: false})}
  }
  return <section data-ejianbao-environments=""><h2>制作环境</h2><p className="ejianbao-muted">公共工具统一准备，各功能保留独立的引擎包环境。任何安装完成后会重新检查全部状态。</p><div style={{display: 'grid', gap: 16}}>
    {[targets.slice(0, 1), targets.slice(1)].map((group, index) => <div className="ejianbao-environments" key={index}>{group.map(target => {
      const state = states[target.id] || {}, {health, setup, error} = state
      const isTools = target.id === 'tools', ready = health && !isTools ? packageReady(health, target.id) : undefined
      const busy = state.installing || setup?.status === 'running', labels = isTools ? toolLabels : engineLabels
      return <section key={target.id} className="ejianbao-setting-card" {...(isTools ? {'data-ejianbao-tools': ''} : {'data-ejianbao-engine': target.id})}><h3>{target.label}{!isTools && ' · 专属依赖'}</h3>
        <p className="ejianbao-muted">{isTools ? '共享 Python 3.11、FFmpeg 和 ffprobe，复用内置 uv 与宿主 Node.js。' : target.id === 'video' ? '复用公共工具，安装本功能的 Python 包；渲染依赖按下方说明单独准备。' : '复用公共工具，安装本功能的引擎包与制作所需依赖。'}</p>
        {!isTools && <p className="ejianbao-muted">缺少的公共工具会先自动准备，已就绪的工具会跳过。</p>}
        <div className="ejianbao-actions" data-environment-badges="">{health ? <>{!isTools && <Tag tone={ready === undefined ? 'neutral' : ready ? 'success' : 'warning'}>Python 包环境 · {ready === undefined ? '待检测' : ready ? '就绪' : '待准备'}</Tag>}{Object.entries(labels).filter(([key]) => isTools || typeof health[key] === 'boolean').map(([key, title]) => <Tag key={key} tone={typeof health[key] !== 'boolean' ? 'neutral' : health[key] ? 'success' : 'warning'}>{title} · {typeof health[key] !== 'boolean' ? '待检测' : health[key] ? '就绪' : '待准备'}</Tag>)}</> : <span role="status">{state.checking ? '正在检测…' : '环境状态未读取'}</span>}</div>
        {isTools && health && (typeof health.pythonVersion === 'string' || typeof health.ffmpegVersion === 'string') && <p className="ejianbao-muted">{typeof health.pythonVersion === 'string' && `Python ${health.pythonVersion}`}{typeof health.pythonVersion === 'string' && typeof health.ffmpegVersion === 'string' && ' · '}{typeof health.ffmpegVersion === 'string' && `FFmpeg ${health.ffmpegVersion}`}</p>}
        {typeof health?.error === 'string' && health.error && <p role="alert">{health.error}</p>}{error && <p role="alert">{error}</p>}
        <div className="ejianbao-actions"><Button disabled={!!state.checking || !!state.installing} onClick={() => void refreshAll()}>{state.checking ? '正在检查…' : error ? '重试检查' : '重新检查'}</Button><Button variant="primary" disabled={!!state.checking || !!busy} onClick={() => void install(target)}>{busy ? '正在准备…' : isTools ? setup?.status === 'failed' ? '重试安装 / 修复公共工具' : '安装 / 修复公共工具' : setup?.status === 'failed' ? '重试安装 / 修复专属依赖' : '安装 / 修复专属依赖'}</Button></div>
        {target.id === 'video' && <details className="ejianbao-muted"><summary>准备数字人视频渲染环境</summary><p>在数字人视频制作插件的 runtime/render-studio 目录运行 npm ci，准备现有 Remotion 渲染引擎。</p><p>需要使用指定工具时，可通过 EJIANBAO_PYTHON、FFMPEG_PATH 和 EJIANBAO_BROWSER_EXECUTABLE 配置 Python、FFmpeg 和渲染浏览器；配置完成后重新启动应用并检查。</p></details>}
        <SetupProgress setup={setup}/>
      </section>
    })}</div>)}
  </div></section>
}

function ShortVideoSettings() {
  const api = '/cqai-short-video'
  const [settings, setSettings] = useState<{subtitle_provider: 'edge' | 'whisper'; video_codec: string}>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {let live = true; void mediaRequest<typeof settings>(api, 'settings').then(next => {if (live) setSettings(next)}).catch(cause => {if (live) setError(cause.message)}); return () => {live = false}}, [])
  const save = async () => {if (!settings) return; setBusy(true); setError(''); setNotice(''); try {setSettings(await mediaRequest(api, 'settings', {subtitle_provider: settings.subtitle_provider, video_codec: settings.video_codec})); setNotice('短视频专属设置已保存')} catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败')} finally {setBusy(false)}}
  return <section className="ejianbao-setting-card"><h3>短视频专属设置</h3>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{settings && <><div className="ejb-settings-fields"><label className="ejb-settings-field">字幕引擎<select value={settings.subtitle_provider} onChange={event => setSettings({...settings, subtitle_provider: event.target.value as 'edge' | 'whisper'})}><option value="edge">Edge 时间戳</option><option value="whisper">Whisper 语音识别</option></select></label><label className="ejb-settings-field">编码器<select value={settings.video_codec} onChange={event => setSettings({...settings, video_codec: event.target.value})}><option value="libx264">CPU · H.264</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="h264_qsv">Intel QSV</option><option value="h264_amf">AMD AMF</option></select></label></div><div className="ejianbao-actions"><Button variant="primary" disabled={busy} onClick={() => void save()}>保存短视频设置</Button></div></>}</section>
}

function FishSettings() {
  const api = '/api/cqai-talkcraft'
  const [configured, setConfigured] = useState(false)
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {let live = true; void mediaRequest<{fish: boolean}>(api, 'settings').then(next => {if (live) setConfigured(next.fish)}).catch(cause => {if (live) setError(cause.message)}); return () => {live = false}}, [])
  const save = async (key: string) => {setBusy(true); setError(''); try {const result = await mediaRequest<{fish: boolean}>(api, 'settings', {name: 'fish', value: key}); setConfigured(result.fish); setValue(''); setEditing(false); setNotice(key ? 'Fish Audio 已连接' : 'Fish Audio 连接已清除')} catch (cause) {setError(cause instanceof Error ? cause.message : '保存失败')} finally {setBusy(false)}}
  return <section className="ejianbao-setting-card"><h3>口播专属 · Fish Audio 配音</h3><div className="ejianbao-actions"><Tag tone={configured ? 'success' : 'neutral'}>{configured ? '已配置' : '未配置'}</Tag><Button disabled={busy} onClick={() => {setEditing(!editing); setValue('')}}>{editing ? '取消' : configured ? '更换连接' : '配置连接'}</Button></div>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{editing && <><label className="ejb-settings-field" htmlFor="ejianbao-fish">Fish Audio API Key<Input id="ejianbao-fish" className="ejb-settings-input-control" type="password" autoComplete="new-password" value={value} onChange={event => setValue(event.target.value)}/></label><div className="ejianbao-actions"><Button variant="primary" disabled={busy || !value.trim()} onClick={() => void save(value.trim())}>保存连接</Button>{configured && <Button disabled={busy} onClick={() => void save('')}>清除连接</Button>}</div></>}</section>
}

export function Settings() {
  return <div className="ejianbao-settings"><h2>e剪宝设置</h2><MediaSettingsEditor api="/api/cqai-ejianbao" includeCoverr/><Environments/><ShortVideoSettings/><FishSettings/></div>
}
