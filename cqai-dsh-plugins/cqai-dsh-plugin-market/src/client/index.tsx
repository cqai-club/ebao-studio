import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from 'dsh-community-market/client'
import { useEffect, type ReactNode } from 'react'
import { PRODUCT_PACKAGES } from '../product-bundles.js'
import { createViewState, PluginManagementShell, ProductInstalledCards } from './PluginManagementShell.js'

const PANEL = 'plugins' as MainPanelId

interface AccountMenuAction {
  readonly id: string
  readonly label: () => string
  readonly icon?: ReactNode
  readonly onSelect: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'cqaiclub.account.menu.action': {
      kind: 'list'
      scope: 'root'
      owner: { registerAction: (action: AccountMenuAction) => () => void }
    }
    'cqai.pluginManagement.skills': { kind: 'list'; scope: 'root' }
    'cqai.pluginManagement.mcp': { kind: 'list'; scope: 'root' }
  }
}

function isCqaiDesktop(): boolean {
  return (globalThis as typeof globalThis & { dshDesktop?: { cqaiPrimaryLogin?: unknown } })
    .dshDesktop?.cqaiPrimaryLogin === true
}

function AccountAction({ registerAction, open, label }: PropsRuntime<'cqaiclub.account.menu.action'> & { open: () => void; label: () => string }) {
  useEffect(() => registerAction({
    id: 'cqai-plugin-management', label, onSelect: open,
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><rect x="2" y="3" width="20" height="18" rx="3"/></svg>,
  }), [registerAction, open, label])
  return null
}

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  if (!isCqaiDesktop()) return
  const viewState = createViewState()
  ctx.inject(['layout', 'remote', 'remote.pluginManager'], scope => {
    const open = () => { viewState.select('installed'); scope.layout.selectPanel(PANEL) }
    const label = () => scope.locale.getLocale().active.startsWith('zh') ? '插件管理' : 'Plugin management'
    scope.slots.inject('cqaiclub.account.menu.action', () => scope.slots.register({
      name: 'cqaiclub.account.menu.action', id: 'cqai-plugin-management', order: 10,
    }, (props: PropsRuntime<'cqaiclub.account.menu.action'>) => <AccountAction {...props} open={open} label={label} />))
    scope.slots.inject('plugins.shell', () => scope.slots.register({
      name: 'plugins.shell',
      children: {
        'cqai.pluginManagement.market': { kind: 'list', scope: 'root' },
        'cqai.pluginManagement.skills': { kind: 'list', scope: 'root' },
        'cqai.pluginManagement.mcp': { kind: 'list', scope: 'root' },
      },
    }, (props: PropsRuntime<'plugins.shell'> & PropsRenderSlots<'cqai.pluginManagement.market' | 'cqai.pluginManagement.skills' | 'cqai.pluginManagement.mcp'>) =>
      <PluginManagementShell {...props} ctx={scope} viewState={viewState} />))
    scope.slots.inject('plugins.installed.cards', () => scope.slots.register({
      name: 'plugins.installed.cards', id: 'cqai-product-bundles',
    }, (props: PropsRuntime<'plugins.installed.cards'>) => <ProductInstalledCards {...props} ctx={scope} />))
    for (const packageName of PRODUCT_PACKAGES) {
      scope.slots.inject('plugins.bundle.hidden', () => scope.slots.register({
        name: 'plugins.bundle.hidden', key: packageName,
      }, () => null))
    }
  })
}
