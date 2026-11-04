/** Desktop workspace-folder action, using the existing Host path opener. */
import { useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconFolderOpenRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

const NS = 'desktop.workspaceFolder'
export const workspaceFolderZh = {
  open: '打开工作区',
  opening: '正在打开…',
  errorTitle: '无法打开工作区',
  error: '无法打开工作区文件夹。请确认文件夹仍然存在且可以访问，然后重试。',
  unavailable: '当前主机暂时无法打开文件夹，请恢复连接后重试。',
  retry: '重试',
  close: '关闭',
}
type LocaleKey = keyof typeof workspaceFolderZh
export const workspaceFolderEn: Record<LocaleKey, string> = {
  open: 'Open workspace',
  opening: 'Opening…',
  errorTitle: 'Could not open workspace',
  error: 'Could not open the workspace folder. Check that it still exists and is accessible, then try again.',
  unavailable: 'The host cannot open folders right now. Restore the connection, then try again.',
  retry: 'Retry',
  close: 'Close',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.workspaceFolder': LocaleKey }
}

type Opener = Pick<ClientContext['remote']['session'], 'canOpenWorkspacePath' | 'openWorkspacePath'>
interface FolderState {
  readonly available: boolean | null
  readonly opening: WorkspaceId | null
  readonly failed: WorkspaceId | null
}

/** Keep operation feedback alive after the menu closes, and re-read paths on retry. */
export class WorkspaceFolderController {
  private state: FolderState = { available: null, opening: null, failed: null }
  private readonly listeners = new Set<() => void>()
  private readonly abort = new AbortController()
  private capabilityRequest = 0
  constructor(private readonly opener: Opener, private readonly pathFor: (id: WorkspaceId) => string | undefined) {}
  readonly getSnapshot = (): FolderState => this.state
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private update(patch: Partial<FolderState>): void {
    if (this.abort.signal.aborted) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  async refresh(): Promise<void> {
    const request = ++this.capabilityRequest
    this.update({ available: null })
    try {
      const result = await this.opener.canOpenWorkspacePath()
      if (request === this.capabilityRequest) this.update({ available: result.ok && result.value })
    } catch {
      if (request === this.capabilityRequest) this.update({ available: false })
    }
  }
  async open(workspaceId: WorkspaceId): Promise<void> {
    if (this.abort.signal.aborted || this.state.opening !== null || this.state.available !== true) return
    this.update({ opening: workspaceId, failed: null })
    try {
      const path = this.pathFor(workspaceId)
      if (!path) throw new Error('Workspace is no longer available')
      const result = await this.opener.openWorkspacePath({ path }, this.abort.signal)
      if (!result.ok || !result.value.opened) throw new Error('Workspace folder could not be opened')
    } catch { this.update({ failed: workspaceId }) }
    finally { this.update({ opening: null }) }
  }
  readonly dismiss = (): void => { this.update({ failed: null }) }
  dispose(): void { this.abort.abort(); this.listeners.clear() }
}

type FolderInjected = { controller: WorkspaceFolderController }
export type WorkspaceFolderMenuProps = PropsRuntime<'sidebar.workspaces.workspace.menu.item'> & InjectFace<FolderInjected> & PropsLocale<typeof NS>
export type WorkspaceFolderErrorProps = PropsRuntime<'shell.overlay'> & InjectFace<FolderInjected> & PropsLocale<typeof NS>

/** Join the owner's standard menu styling, focus walk, and dismissal state. */
export function WorkspaceFolderMenuItem({ workspaceId, controller, useMenuOpenState, t }: WorkspaceFolderMenuProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [, setMenuOpen] = useMenuOpenState()
  if (state.available === false) return null
  return <MenuItemButton icon={<IconFolderOpenRegular />} disabled={state.available !== true || state.opening !== null}
    onSelect={() => { setMenuOpen(false); void controller.open(workspaceId) }}>
    {t(state.opening === workspaceId ? 'opening' : 'open')}
  </MenuItemButton>
}

/** Menu entries unmount on selection; this root overlay owns retryable failure feedback. */
export function WorkspaceFolderError({ controller, t }: WorkspaceFolderErrorProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (state.failed === null) return null
  const workspaceId = state.failed
  return <Modal open title={t('errorTitle')} closeLabel={t('close')} onClose={controller.dismiss}
    footer={<>
      <Button variant="outline" onClick={controller.dismiss}>{t('close')}</Button>
      <Button variant="primary" disabled={state.available !== true || state.opening !== null}
        onClick={() => { void controller.open(workspaceId) }}>{t('retry')}</Button>
    </>}>
    <p role="alert">{t(state.available === false ? 'unavailable' : 'error')}</p>
  </Modal>
}

/** Compose the action in all Desktop modes without retaining any Session or Agent. */
export function registerDesktopWorkspaceFolder(ctx: ClientContext): void {
  ctx.inject(['remote.session', 'workspaces'], (scope: ClientContext) => {
    const controller = new WorkspaceFolderController(scope.remote.session,
      id => scope.workspaces.list.getSnapshot().items.find(item => item.workspaceId === id)?.path)
    scope.effect(() => scope.locale.register(NS, { zh: workspaceFolderZh, en: workspaceFolderEn }), 'dsh-plugin-desktop: workspace folder dictionaries')
    scope.effect(() => {
      const refresh = (): void => { void controller.refresh() }
      const off = scope.on('connection/reset', refresh)
      refresh()
      return () => { off(); controller.dispose() }
    }, 'dsh-plugin-desktop: workspace folder capability')
    scope.slots.inject('sidebar.workspaces.workspace.menu.item', () => scope.slots.register({
      name: 'sidebar.workspaces.workspace.menu.item', id: 'desktop-open-workspace', order: 100, locale: NS,
      inject: () => ({ controller }),
    }, WorkspaceFolderMenuItem))
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'desktop-workspace-folder-error', locale: NS,
      inject: () => ({ controller }),
    }, WorkspaceFolderError))
  })
}
