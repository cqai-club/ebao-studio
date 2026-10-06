/** Desktop Computer Use configuration through the official Plugins surface. */
import { useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChangeResult, PluginInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot, Switch, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopClientPlatform } from './environment.ts'

export const COMPUTER_USE_ITEM_ID = 'desktop-computer-use'
export const COMPUTER_USE_PROVIDER = '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
const NS = 'desktop.computerUse'

export const computerUseZh = {
  title: 'Computer Use',
  description: '读取屏幕截图，并操作鼠标和键盘。需要支持图片输入的模型。',
  enable: '启用 Computer Use',
  loading: '正在读取…',
  saving: '正在保存…',
  disabled: '已停用',
  running: '运行中',
  waiting: '等待加载',
  unloading: '正在停用…',
  failed: '加载失败',
  unavailable: '当前配置中不可用',
  readOnly: '当前配置中的此插件不可修改。',
  readError: '无法读取 Computer Use 状态。',
  changeError: '无法更改 Computer Use 状态。',
  retry: '重新读取',
  restart: '已保存，请重启后台服务以应用。',
  overridden: '已保存，但其他配置覆盖了此开关。',
  cancelled: '更改已取消。',
  macPermissions: 'macOS 使用前，请在系统设置中为运行 DSH 的桌面应用授予屏幕录制和辅助功能权限。',
}
export type ComputerUseLocaleKey = keyof typeof computerUseZh
export const computerUseEn: Record<ComputerUseLocaleKey, string> = {
  title: 'Computer Use',
  description: 'Read screenshots and control the mouse and keyboard. A model that accepts image input is required.',
  enable: 'Enable Computer Use',
  loading: 'Loading…',
  saving: 'Saving…',
  disabled: 'Disabled',
  running: 'Running',
  waiting: 'Waiting to load',
  unloading: 'Disabling…',
  failed: 'Failed to load',
  unavailable: 'Unavailable in this configuration',
  readOnly: 'This plugin cannot be changed in the current configuration.',
  readError: 'Could not read the Computer Use state.',
  changeError: 'Could not change the Computer Use state.',
  retry: 'Reload state',
  restart: 'Saved. Restart the background service to apply.',
  overridden: 'Saved, but another configuration overrides this switch.',
  cancelled: 'The change was cancelled.',
  macPermissions: 'Before using it on macOS, grant Screen Recording and Accessibility permissions in System Settings to the desktop app running DSH.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.computerUse': ComputerUseLocaleKey }
}

type Manager = Pick<ClientContext['remote']['pluginManager'], 'listPlugins' | 'setPluginEnabled'>
type Notice = 'restart' | 'overridden' | 'cancelled' | null
interface ComputerUseSnapshot {
  readonly row: PluginInfo | undefined
  readonly loading: boolean
  readonly busy: boolean
  readonly readError: string | null
  readonly changeError: string | null
  readonly notice: Notice
}

/** Share authoritative provider state between its detail body and header switch. */
export class ComputerUseController {
  private snapshot: ComputerUseSnapshot = {
    row: undefined, loading: true, busy: false, readError: null, changeError: null, notice: null,
  }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private disposed = false
  constructor(private readonly manager: Manager) {}
  readonly getSnapshot = (): ComputerUseSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<ComputerUseSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  /** Read only the shipped native provider; missing or ambiguous rows remain unavailable. */
  readonly refresh = async (): Promise<void> => {
    if (this.disposed) return
    const generation = ++this.generation
    this.publish({ loading: true, readError: null })
    try {
      const result = await this.manager.listPlugins()
      if (this.disposed || generation !== this.generation) return
      if (!result.ok) {
        this.publish({ row: undefined, loading: false, readError: result.error.message })
        return
      }
      const rows = result.value.filter(row => row.moduleName === COMPUTER_USE_PROVIDER)
      this.publish({ row: rows.length === 1 ? rows[0] : undefined, loading: false })
    } catch (failure) {
      if (generation !== this.generation) return
      this.publish({ row: undefined, loading: false, readError: failure instanceof Error ? failure.message : '' })
    }
  }
  /** Change the exact Host entry once, then reread the accepted state. */
  readonly setEnabled = async (enabled: boolean): Promise<void> => {
    const { row, loading, busy } = this.snapshot
    if (this.disposed || loading || busy || !row || row.readOnlyReason !== undefined) return
    this.publish({ busy: true, changeError: null, notice: null })
    try {
      const result = await this.manager.setPluginEnabled(row.entryId, enabled)
      if (!result.ok) this.publish({ changeError: result.error.message })
      else {
        const change: ChangeResult = result.value
        if (change.application === 'failed') this.publish({ changeError: change.error?.diagnostic ?? '' })
        if (change.application === 'restart-required') this.publish({ notice: 'restart' })
        if (change.application === 'overridden') this.publish({ notice: 'overridden' })
        if (change.application === 'cancelled') this.publish({ notice: 'cancelled' })
      }
    } catch (failure) {
      this.publish({ changeError: failure instanceof Error ? failure.message : '' })
    } finally {
      await this.refresh()
      this.publish({ busy: false })
    }
  }
  /** Ignore pending reads and writes when the client plugin unloads. */
  dispose(): void {
    this.disposed = true
    this.generation++
    this.listeners.clear()
  }
}

interface ComputerUseInjected {
  readonly controller: ComputerUseController
  readonly platform: DesktopClientPlatform
}
export type ComputerUseSettingsProps = PropsRuntime<'plugins.item'> & PropsLocale<typeof NS> & InjectFace<ComputerUseInjected>
export type ComputerUseActionsProps = PropsRuntime<'plugins.detail.actions'> & PropsLocale<typeof NS> & InjectFace<ComputerUseInjected>

/** Render a plain summary in the official ItemCard and live state on its detail page. */
export function ComputerUseSettings({ controller, platform, view, t }: ComputerUseSettingsProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (view === 'summary') return <>{t('description')}</>
  let status: ComputerUseLocaleKey = 'waiting'
  let dot: StateDotState = 'ongoing'
  if (state.busy) status = 'saving'
  else if (state.loading) status = 'loading'
  else if (!state.row) { status = 'unavailable'; dot = 'warning' }
  else if (state.row.fiberPhase === 'unloading') status = 'unloading'
  else if (!state.row.enabled) { status = 'disabled'; dot = 'idle' }
  else if (state.row.fiberPhase === 'failed') { status = 'failed'; dot = 'error' }
  else if (state.row.fiberPhase === 'active') { status = 'running'; dot = 'done' }
  const error = state.changeError ?? state.readError
  return <div aria-busy={state.loading || state.busy}>
    <p>{t('description')}</p>
    <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><StateDot state={dot} />{t(status)}</p>
    {platform === 'darwin' && <p className="dshDesktopSettingsHint">{t('macPermissions')}</p>}
    {state.row?.readOnlyReason !== undefined && <p className="dshDesktopSettingsHint">{t('readOnly')}</p>}
    {state.notice && <p role="status">{t(state.notice)}</p>}
    {error !== null && <div>
      <p role="alert">{t(state.changeError !== null ? 'changeError' : 'readError')}{error && ` ${error}`}</p>
      <Button variant="outline" size="sm" disabled={state.loading || state.busy} onClick={() => { void controller.refresh() }}>{t('retry')}</Button>
    </div>}
  </div>
}

/** Contribute only to the Computer Use item's native detail header. */
export function ComputerUseActions({ controller, subject, t }: ComputerUseActionsProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (subject.kind !== 'item' || subject.id !== COMPUTER_USE_ITEM_ID) return null
  return <div aria-busy={state.loading || state.busy}>
    <Switch label={t('enable')} checked={state.row?.enabled ?? false}
      disabled={state.loading || state.busy || !state.row || state.row.readOnlyReason !== undefined}
      title={state.row?.readOnlyReason !== undefined ? t('readOnly') : undefined}
      onChange={enabled => { void controller.setEnabled(enabled) }} />
  </div>
}

/** Register an official ItemCard in every Desktop shell mode; the Host owns its default-off row. */
export function registerDesktopComputerUse(ctx: ClientContext, platform: DesktopClientPlatform): void {
  // Namespace services mount independently of `remote`. Keep this child scoped
  // so the Desktop parent can provide layout before Plugin Manager becomes ready.
  ctx.inject(['remote.pluginManager'], (scope: ClientContext) => {
    const controller = new ComputerUseController(scope.remote.pluginManager)
    scope.effect(() => scope.locale.register(NS, { zh: computerUseZh, en: computerUseEn }), 'dsh-plugin-desktop: Computer Use dictionaries')
    scope.effect(() => {
      const reload = (): void => { void controller.refresh() }
      const off = scope.remote.$on('plugin-manager/changed', reload)
      const reset = scope.on('connection/reset', reload)
      window.addEventListener('focus', reload)
      reload()
      return () => { off(); reset(); window.removeEventListener('focus', reload); controller.dispose() }
    }, 'dsh-plugin-desktop: Computer Use provider state')
    scope.slots.inject('plugins.item', () => scope.slots.register({
      name: 'plugins.item', id: COMPUTER_USE_ITEM_ID, order: 100, locale: NS,
      label: () => scope.locale.bind(NS)('title'), inject: () => ({ controller, platform }),
    }, ComputerUseSettings))
    scope.slots.inject('plugins.detail.actions', () => scope.slots.register({
      name: 'plugins.detail.actions', id: 'desktop-computer-use-toggle', locale: NS,
      inject: () => ({ controller, platform }),
    }, ComputerUseActions))
  })
}
