import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useId, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EjianbaoUi, EjianbaoWorkspaceId, EjianbaoWorkspaceOwner, MediaDefaults, MediaEngine, MediaProvider, MediaSettingsMutation, MediaSettingsPublic } from './contracts.ts'

export function createClientState<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener)}},
    set: (next: T) => {if (next === value) return; value = next; for (const listener of listeners) listener()},
  }
}

export interface VideoWorkspaceRegistration {
  id: EjianbaoWorkspaceId
  panelId: MainPanelId
  label: string
  order: number
  icon: ComponentType<{size?: number}>
  component: ComponentType<Partial<EjianbaoWorkspaceOwner>>
}

/** Each engine contributes its own public page. The optional shell owns navigation only. */
export function mountVideoWorkspace(ctx: Context, registration: VideoWorkspaceRegistration): void {
  const navigation = createClientState<EjianbaoUi | undefined>(undefined)
  let stopped = false
  const Page = registration.component
  const Icon = registration.icon
  function Standalone() {
    const shell = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
    useEffect(() => {shell?.open(registration.id)}, [shell])
    return shell ? <p role="status">正在打开 e剪宝…</p> : <Page active containerPanelId={registration.panelId}/>
  }
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: registration.panelId}, Standalone))
  ctx.slots.inject('ejianbao.workspace', () => ctx.slots.register({name: 'ejianbao.workspace', key: registration.id}, (props: PropsRuntime<'ejianbao.workspace'>) => <Page {...props}/>))
  ctx.slots.inject('sidebar.panellist', () => {
    let sidebar: (() => void) | undefined
    const sync = () => {
      if (stopped) return
      if (navigation.getSnapshot()) {sidebar?.(); sidebar = undefined}
      else if (!sidebar) sidebar = ctx.slots.register({name: 'sidebar.panellist', id: registration.panelId, order: registration.order, label: registration.label}, ({size}: PropsRuntime<'sidebar.panellist'>) => <Icon size={size}/>)
    }
    const unsubscribe = navigation.subscribe(sync)
    sync()
    return () => {unsubscribe(); sidebar?.(); sidebar = undefined}
  })
  ctx.inject(['ejianbaoUi'], scope => {
    scope.effect(() => {
      navigation.set(scope.ejianbaoUi)
      return () => {if (!stopped) navigation.set(undefined)}
    }, 'e剪宝 optional navigation')
  })
  // Cordis tears effects down in reverse order. Prevent re-registration during engine unload.
  ctx.effect(() => () => {stopped = true}, 'e剪宝 workspace lifetime')
}

export function mediaMutationHeaders(api: string): Record<string, string> {
  return {'content-type': 'application/json', [api.includes('short-video') ? 'x-short-video' : api.includes('talkcraft') ? 'x-talkcraft' : 'x-ejianbao']: '1'}
}

export async function mediaRequest<T>(api: string, action: string, data?: unknown): Promise<T> {
  const response = await fetch(`${api}/${action}`, {credentials: 'same-origin', cache: 'no-store', ...(data === undefined ? {} : {method: 'POST', headers: action === 'media-settings' ? {'content-type': 'application/json', 'x-ejianbao': '1'} : mediaMutationHeaders(api), body: JSON.stringify(data)})})
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('制作服务尚未就绪，请重新检查')
  const result = await response.json() as T & {error?: string}
  if (!response.ok) throw new Error(result.error || '请求失败，请重试')
  return result
}

const engineLabels: Record<MediaEngine, string> = {shortVideo: '短视频制作', talkcraft: '口播视频制作'}
const links: Record<MediaProvider, string> = {pexels: 'https://www.pexels.com/api/key/', pixabay: 'https://pixabay.com/api/docs/', coverr: 'https://coverr.co/developers'}
const editorStyles = `
.ejb-settings-editor{display:grid;gap:20px}
.ejb-settings-editor h3{margin:0 0 12px}
.ejb-settings-box{padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.ejb-settings-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.ejb-settings-field{display:grid;gap:8px}
.ejb-settings-field select{width:100%;min-height:40px;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px}
.ejb-settings-input-control{display:flex;width:100%;height:40px;box-sizing:border-box;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ejb-settings-input-control:focus-within{border-color:var(--dsw-alias-state-business-primary);outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.ejb-settings-input-control > input{flex:1;min-width:0;min-height:0;width:100%;padding:0;border:0;border-radius:0;background:transparent;outline:none}
.ejb-settings-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.ejb-settings-editor p{line-height:1.6}
.ejb-settings-editor button:focus-visible,.ejb-settings-field select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.ejb-settings-input-control > input:focus-visible{outline:none}
.ejb-settings-editor a{color:var(--dsw-alias-brand-primary)}
.ejb-settings-error{color:var(--dsw-alias-danger-primary,var(--dsw-alias-label-primary))}
.ejb-settings-note{color:var(--dsw-alias-label-secondary);font-size:13px}`

/** This editor never receives saved plaintext credentials; inputs are only replacement drafts. */
export function MediaSettingsEditor({api, engine, includeCoverr = engine === 'shortVideo', onChange}: {api: string; engine?: MediaEngine; includeCoverr?: boolean; onChange?: (value: MediaSettingsPublic) => void}) {
  const id = useId()
  const [settings, setSettings] = useState<MediaSettingsPublic>()
  const [defaults, setDefaults] = useState<MediaDefaults>({aspect: '9:16', edgeVoiceId: 'zh-CN-XiaoxiaoNeural'})
  const [values, setValues] = useState<Partial<Record<MediaProvider, string>>>({})
  const [editing, setEditing] = useState<MediaProvider>()
  const [target, setTarget] = useState<MediaEngine | undefined>(engine)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const unavailable = busy || loading || !loaded
  const refresh = async () => {
    setLoading(true); setLoaded(false)
    try {
      const next = await mediaRequest<MediaSettingsPublic>(api, 'media-settings')
      setSettings(next)
      setDefaults({...next.defaults, ...(target ? next.overrides[target] : {})})
      setLoaded(true)
      return next
    } finally {setLoading(false)}
  }
  useEffect(() => {
    let live = true
    setLoading(true); setLoaded(false)
    void mediaRequest<MediaSettingsPublic>(api, 'media-settings').then(next => {
      if (!live) return
      setSettings(next); setDefaults({...next.defaults, ...(target ? next.overrides[target] : {})}); setLoaded(true)
    }).catch(cause => {if (live) setError(String(cause.message))}).finally(() => {if (live) setLoading(false)})
    return () => {live = false}
  }, [api, target])
  const selectTarget = (next: MediaEngine | undefined) => {
    if (busy || loading) return
    setTarget(next)
    if (settings) setDefaults({...settings.defaults, ...(next ? settings.overrides[next] : {})})
    setValues({}); setEditing(undefined); setError(''); setNotice('')
    setLoading(true); setLoaded(false)
  }
  const mutate = async (mutation: MediaSettingsMutation) => {
    if (unavailable) return
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await mediaRequest<MediaSettingsPublic>(api, 'media-settings', mutation)
      setSettings(next)
      if (mutation.operation === 'defaults' || mutation.operation === 'clearOverride' && (mutation.field === 'aspect' || mutation.field === 'edgeVoiceId')) setDefaults({...next.defaults, ...(target ? next.overrides[target] : {})})
      onChange?.(next)
      setValues({}); setEditing(undefined); setNotice('设置已保存。新任务使用更新后的默认值。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
      // A conflict is reviewable against the latest redacted state; retain the user's replacement draft.
      await refresh().catch(() => {})
    } finally {setBusy(false)}
  }
  const baseline = settings ? {...settings.defaults, ...(target ? settings.overrides[target] : {})} : undefined
  const changedDefaults: Partial<MediaDefaults> = baseline ? {...(baseline.aspect !== defaults.aspect ? {aspect: defaults.aspect} : {}), ...(baseline.edgeVoiceId !== defaults.edgeVoiceId ? {edgeVoiceId: defaults.edgeVoiceId} : {})} : {}
  return <div className="ejb-settings-editor" aria-busy={busy || loading}><style>{editorStyles}</style>
    {error && <p className="ejb-settings-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {settings && loading && <p role="status">正在读取公共设置…</p>}
    {settings && !loaded && !loading && <Button onClick={() => void refresh().catch(cause => setError(cause.message))}>重新读取</Button>}
    {!settings ? <div className="ejb-settings-actions"><span role="status">正在读取公共设置…</span><Button disabled={loading || busy} onClick={() => void refresh().catch(cause => setError(cause.message))}>重新读取</Button></div> : <>
      <section className="ejb-settings-box"><h3>制作默认值</h3><p className="ejb-settings-note">只影响新建短视频与口播任务；已有草稿、历史任务和数字人视频制作的横版输出保留原参数。</p>
        {!engine && <label className="ejb-settings-field" htmlFor={`${id}-target`}>应用到<select id={`${id}-target`} value={target || ''} disabled={unavailable || loading} onChange={event => selectTarget(event.target.value as MediaEngine || undefined)}><option value="">所有功能的公共默认</option><option value="shortVideo">短视频制作覆盖值</option><option value="talkcraft">口播视频制作覆盖值</option></select></label>}
        <div className="ejb-settings-fields"><label className="ejb-settings-field" htmlFor={`${id}-aspect`}>默认画幅<select id={`${id}-aspect`} value={defaults.aspect} disabled={unavailable} onChange={event => setDefaults({...defaults, aspect: event.target.value as MediaDefaults['aspect']})}><option value="9:16">竖屏 · 9:16</option><option value="16:9">横屏 · 16:9</option></select></label><label className="ejb-settings-field" htmlFor={`${id}-voice`}>Edge 默认音色<Input id={`${id}-voice`} className="ejb-settings-input-control" value={defaults.edgeVoiceId} disabled={unavailable} onChange={event => setDefaults({...defaults, edgeVoiceId: event.target.value})}/></label></div>
        <div className="ejb-settings-actions"><Button variant="primary" disabled={unavailable || !defaults.edgeVoiceId.trim() || !Object.keys(changedDefaults).length} onClick={() => void mutate({operation: 'defaults', expectedRevision: settings.revision, set: changedDefaults, ...(target ? {engine: target} : {})})}>保存默认值</Button>{target && (['aspect', 'edgeVoiceId'] as const).filter(field => settings.overrides[target]?.[field] !== undefined).map(field => <Button key={field} disabled={unavailable} onClick={() => void mutate({operation: 'clearOverride', expectedRevision: settings.revision, engine: target, field})}>{field === 'aspect' ? '画幅' : '音色'}恢复公共默认</Button>)}</div>
      </section>
      <section className="ejb-settings-box"><h3>素材平台连接</h3><p className="ejb-settings-note">Pexels 与 Pixabay 公共连接供短视频和口播视频使用；有旧配置差异时保留对应功能覆盖。密钥保存在 Credentials 中。</p>
        {(['pexels', 'pixabay', ...(includeCoverr ? ['coverr'] : [])] as MediaProvider[]).map(provider => {
          const entry = provider === 'coverr' ? undefined : settings.providers[provider]
          const configured = provider === 'coverr' ? settings.coverrConfigured : target && entry?.overrides[target] !== undefined ? entry.overrides[target] : entry?.configured
          const revision = provider === 'coverr' ? settings.coverrRevision : settings.credentialRevision
          return <div key={provider} className="ejb-settings-field"><div className="ejb-settings-actions"><strong>{provider === 'pexels' ? 'Pexels' : provider === 'pixabay' ? 'Pixabay' : 'Coverr（短视频）'}</strong><Tag tone={configured ? 'success' : 'neutral'}>{configured ? '已配置' : '未配置'}</Tag>{entry?.conflict && <Tag tone="warning">存在功能覆盖</Tag>}<a href={links[provider]} target="_blank" rel="noopener noreferrer">获取 API Key ↗</a><Button disabled={unavailable} onClick={() => {setEditing(editing === provider ? undefined : provider); setValues({...values, [provider]: ''})}}>{editing === provider ? '取消' : configured ? '更换连接' : '配置连接'}</Button></div>
            {editing === provider && <><label htmlFor={`${id}-${provider}`}>{target ? `${engineLabels[target]}专用` : '公共'} API Key</label><Input id={`${id}-${provider}`} className="ejb-settings-input-control" type="password" autoComplete="new-password" value={values[provider] || ''} disabled={unavailable} onChange={event => setValues({...values, [provider]: event.target.value})}/><div className="ejb-settings-actions"><Button variant="primary" disabled={unavailable || !values[provider]?.trim()} onClick={() => void mutate({operation: 'credential', expectedRevision: revision, provider, value: values[provider]!.trim(), ...(target && provider !== 'coverr' ? {engine: target} : {})})}>保存连接</Button>{configured && <Button disabled={unavailable} onClick={() => void mutate({operation: 'credential', expectedRevision: revision, provider, value: null, ...(target && provider !== 'coverr' ? {engine: target} : {})})}>清除连接</Button>}</div></>}
            {entry && <div className="ejb-settings-actions">{(Object.entries(entry.overrides) as [MediaEngine, boolean][]).map(([overrideEngine, enabled]) => <span key={overrideEngine}>{engineLabels[overrideEngine]}：{enabled ? '专用连接' : '专用停用'} <Button disabled={unavailable} onClick={() => void mutate({operation: 'clearOverride', expectedRevision: settings.credentialRevision, engine: overrideEngine, field: provider as 'pexels' | 'pixabay'})}>使用公共连接</Button></span>)}</div>}
          </div>
        })}
      </section>
    </>}
  </div>
}
