import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { createClientState } from 'cqai-dsh-media-settings/client'
import { EJIANBAO_PANEL, EJIANBAO_WORKSPACES, type EjianbaoUi, type EjianbaoWorkspaceId } from 'cqai-dsh-media-settings/contracts'
import icon from '../../assets/plugin-icon.svg'
import { Settings } from './Settings.tsx'

export const inject = ['slots', 'layout']
export interface WorkspaceView {workspace: EjianbaoWorkspaceId; settings: boolean}
export function createWorkspaceNavigation(select: () => void) {
  const state = createClientState<WorkspaceView>({workspace: 'video', settings: false})
  let returnFocus: HTMLElement | null = null
  let enabled = true
  const service: EjianbaoUi = {
    open(workspace) {if (!enabled) return; state.set({workspace, settings: false}); select()},
    openSettings(from) {if (!enabled) return; returnFocus = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null; state.set({workspace: from, settings: true}); select()},
  }
  return {state, service, returnFocus: () => returnFocus, activate: () => {enabled = true}, deactivate: () => {enabled = false}}
}
type Navigation = ReturnType<typeof createWorkspaceNavigation>
const styles = `.ejianbao{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font-family:inherit}.ejianbao-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.ejianbao-header h1{font-size:20px;line-height:1.4;margin:0}.ejianbao-tabs{display:flex;flex-wrap:wrap;gap:8px}.ejianbao-tabs button{min-height:40px;padding:8px 14px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.ejianbao-tabs button[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1)}.ejianbao button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.ejianbao-content{min-height:0;flex:1;position:relative;overflow:hidden}.ejianbao-workspace{height:100%;min-height:0}.ejianbao-workspace[hidden]{display:none!important}.ejianbao-empty{padding:32px;line-height:1.7}.ejianbao-settings{height:100%;overflow:auto;box-sizing:border-box;padding:24px;display:grid;align-content:start;gap:24px}.ejianbao-settings h2{font-size:19px;margin:0 0 12px}.ejianbao-setting-card{padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}.ejianbao-setting-card h3{margin:0 0 12px;font-size:16px}.ejianbao-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}.ejianbao-muted{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}.ejianbao-log{max-height:220px;overflow:auto;font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.ejianbao-environments{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}@media(max-width:700px){.ejianbao-header{padding:12px 16px}.ejianbao-tabs{order:3;width:100%}.ejianbao-tabs button{flex:1;padding:8px;font-size:13px}.ejianbao-settings{padding:16px}}`

export function Workspace({renderSlot, navigation, ctx}: PropsRenderSlots<'ejianbao.workspace'> & {navigation: Navigation; ctx: Context}) {
  const view = useSyncExternalStore(navigation.state.subscribe, navigation.state.getSnapshot, navigation.state.getSnapshot)
  const [visited, setVisited] = useState<EjianbaoWorkspaceId[]>([view.workspace])
  const [revision, setRevision] = useState(0)
  const tabs = useRef<Partial<Record<EjianbaoWorkspaceId, HTMLButtonElement>>>({})
  const settingsReturn = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousSettings = useRef(view.settings)
  useEffect(() => {setVisited(previous => previous.includes(view.workspace) ? previous : [...previous, view.workspace])}, [view.workspace])
  useEffect(() => ctx.slots.subscribe('ejianbao.workspace', () => setRevision(value => value + 1)), [ctx])
  useEffect(() => {
    if (view.settings && !previousSettings.current) settingsReturn.current = navigation.returnFocus()
    if (!view.settings && previousSettings.current) {
      const target = settingsReturn.current
      if (target?.isConnected && !target.closest('[hidden]')) target.focus()
      else tabs.current[view.workspace]?.focus()
    }
    previousSettings.current = view.settings
  }, [view.settings, view.workspace])
  useEffect(() => {for (const media of contentRef.current?.querySelectorAll<HTMLMediaElement>('[hidden] audio,[hidden] video') || []) media.pause()}, [view.workspace, view.settings])
  const available = new Set(ctx.slots.entriesOfSlot('ejianbao.workspace').map(entry => entry.options.key))
  const availableKey = EJIANBAO_WORKSPACES.filter(item => available.has(item.id)).map(item => item.id).join(',')
  useEffect(() => {
    if (available.has(view.workspace)) return
    const first = EJIANBAO_WORKSPACES.find(item => available.has(item.id))
    if (first) navigation.service.open(first.id)
  }, [availableKey, view.workspace, navigation])
  const selectTab = (id: EjianbaoWorkspaceId) => {if (available.has(id)) navigation.service.open(id)}
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = EJIANBAO_WORKSPACES.filter(item => available.has(item.id))
    if (!enabled.length) return
    const current = enabled.findIndex(item => item.id === EJIANBAO_WORKSPACES[index].id)
    let next: number
    if (event.key === 'ArrowRight') next = (current + 1) % enabled.length
    else if (event.key === 'ArrowLeft') next = (current + enabled.length - 1) % enabled.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = enabled.length - 1
    else return
    event.preventDefault(); const id = enabled[next].id; selectTab(id); tabs.current[id]?.focus()
  }
  void revision
  return <section className="ejianbao" data-ejianbao-main=""><style>{styles}</style><header className="ejianbao-header"><h1>e剪宝</h1><div className="ejianbao-tabs" role="tablist" aria-label="视频制作功能">{EJIANBAO_WORKSPACES.map((item, index) => <button key={item.id} ref={element => {if (element) tabs.current[item.id] = element}} type="button" id={`ejianbao-tab-${item.id}`} role="tab" disabled={!available.has(item.id)} aria-selected={view.workspace === item.id && !view.settings} aria-controls={`ejianbao-workspace-${item.id}`} tabIndex={view.workspace === item.id ? 0 : -1} onKeyDown={event => onKey(event, index)} onClick={() => selectTab(item.id)}>{item.label}{!available.has(item.id)&&' · 未启用'}</button>)}</div><Button onClick={() => view.settings ? navigation.service.open(view.workspace) : navigation.service.openSettings(view.workspace)}>{view.settings ? '返回制作' : '设置'}</Button></header><div className="ejianbao-content" ref={contentRef}>
    {EJIANBAO_WORKSPACES.filter(item => visited.includes(item.id) || item.id === view.workspace).map(item => {const active = item.id === view.workspace && !view.settings; return <div key={item.id} id={`ejianbao-workspace-${item.id}`} className="ejianbao-workspace" role="tabpanel" aria-labelledby={`ejianbao-tab-${item.id}`} hidden={!active} {...(!active ? {inert: ''} : {})}>{available.has(item.id) ? renderSlot('ejianbao.workspace', {active, containerPanelId: EJIANBAO_PANEL, onOpenSettings: () => navigation.service.openSettings(item.id)}, {entryKey: item.id}) : <div className="ejianbao-empty"><h2>{item.label}尚未启用</h2><p>请在插件管理中启用对应制作功能，然后返回此页。其他视频功能仍可使用。</p></div>}</div>})}
    {view.settings && <Settings/>}
  </div></section>
}

export function apply(ctx: Context): void {
  const navigation = createWorkspaceNavigation(() => ctx.layout.selectPanel(EJIANBAO_PANEL))
  ctx.slots.inject('main', function* () {
    navigation.activate()
    yield ctx.slots.register({name: 'main', key: EJIANBAO_PANEL, children: {'ejianbao.workspace': {kind: 'keyed', scope: 'root'}}}, (props: PropsRuntime<'main'> & PropsRenderSlots<'ejianbao.workspace'>) => <Workspace {...props} navigation={navigation} ctx={ctx}/>)
    yield ctx.reflect.provide('ejianbaoUi', navigation.service)
    // Navigate before the main registration is removed, when all legacy engines still exist.
    yield () => {
      // A legacy wrapper may still observe this service during Cordis teardown.
      navigation.deactivate()
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== EJIANBAO_PANEL) return
      const main = new Set(ctx.slots.entriesOfSlot('main').map(entry => entry.options.key))
      const destination = EJIANBAO_WORKSPACES.find(item => item.id === navigation.state.getSnapshot().workspace && main.has(item.panelId)) || EJIANBAO_WORKSPACES.find(item => main.has(item.panelId))
      ctx.layout.selectPanel(destination ? destination.panelId as MainPanelId : null)
    }
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: EJIANBAO_PANEL, order: 41, label: 'e剪宝'}, ({size}: PropsRuntime<'sidebar.panellist'>) => <img className="cqai-plugin-panel-icon" src={icon} width={size} height={size} alt="" draggable={false}/>))
}
