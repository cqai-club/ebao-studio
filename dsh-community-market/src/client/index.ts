import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { MarketLocaleKey } from './locales.js'
import { MarketLauncher } from './MarketLauncher.js'
import { MarketOverlay } from './MarketOverlay.js'
import { MarketSettingsTab } from './MarketSettingsTab.js'
import { MarketUpdateNotice } from './MarketUpdateNotice.js'
import { PluginManagementMarket } from './PluginManagementMarket.js'
import { PluginUpdatesSummary } from './PluginUpdatesSummary.js'
import { pluginUpdatesStore } from './plugin-updates-store.js'
import { createMarketViewStore } from './market-view-store.js'
import { en, zh } from './locales.js'
import { installMarketStyles } from './styles.js'

export { MarketSurface } from './MarketSettingsTab.js'
export type { MarketSurfaceProps, MarketView } from './MarketSettingsTab.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'community-market': MarketLocaleKey
  }

  interface SlotMap {
    'cqai.pluginManagement.market': {
      kind: 'list'
      scope: 'root'
      owner: { onOpenInstalled?: () => void }
    }
    'cqai.pluginManagement.updates': {
      kind: 'list'
      scope: 'root'
      owner: { onOpenUpdates?: () => void }
    }
  }
}

export const inject = ['slots', 'locale']
export const NS = 'community-market'

function isCqaiPrimaryDesktop(): boolean {
  return (globalThis as typeof globalThis & { dshDesktop?: { cqaiPrimaryLogin?: unknown } })
    .dshDesktop?.cqaiPrimaryLogin === true
}

export function apply(ctx: ClientContext): void {
  const marketView = createMarketViewStore()
  const readLocale = () => ctx.locale.getLocale().active
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'community-market: dictionaries')
  ctx.effect(() => installMarketStyles(), 'community-market: styles')
  ctx.effect(() => {
    pluginUpdatesStore.start()
    return () => pluginUpdatesStore.dispose()
  }, 'community-market: plugin update checks')
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'community-market',
    order: 20,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: () => ({ readLocale }),
  }, MarketSettingsTab))
  if (isCqaiPrimaryDesktop()) {
    ctx.slots.inject('cqai.pluginManagement.market', () => ctx.slots.register({
      name: 'cqai.pluginManagement.market',
      id: 'community-market',
      order: 10,
      locale: NS,
      inject: () => ({ readLocale }),
    }, PluginManagementMarket))
    ctx.slots.inject('cqai.pluginManagement.updates', () => ctx.slots.register({
      name: 'cqai.pluginManagement.updates',
      id: 'community-market-updates',
      order: 10,
      locale: NS,
      inject: () => ({ updatesStore: pluginUpdatesStore }),
    }, PluginUpdatesSummary))
  } else {
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'community-market',
      order: 10,
      label: () => ctx.locale.bind(NS)('tab'),
      locale: NS,
      store: marketView,
    }, MarketLauncher))
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'community-market',
    order: 10,
    locale: NS,
    store: marketView,
    inject: () => ({ readLocale }),
  }, MarketOverlay))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'community-market-update-notice',
    order: 20,
    locale: NS,
    inject: () => ({
      updatesStore: pluginUpdatesStore,
      onOpenUpdates: () => {
        pluginUpdatesStore.requestOpen()
        pluginUpdatesStore.dismiss()
        window.dispatchEvent(new window.Event(isCqaiPrimaryDesktop() ? 'cqai-plugin-market-open-updates' : 'community-market:open-updates'))
      },
    }),
  }, MarketUpdateNotice))
}
