import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MarketSurface } from './MarketSettingsTab.js'

export type PluginManagementMarketProps = PropsRuntime<'cqai.pluginManagement.market'>
  & PropsLocale<'community-market'>
  & { readonly readLocale: () => string }

/** Supplies the existing storefront to the optional CQAI plugin-management slot. */
export function PluginManagementMarket({ onOpenInstalled, readLocale, t }: PluginManagementMarketProps) {
  return <MarketSurface
    readLocale={readLocale}
    t={t}
    showHeader={false}
    {...(onOpenInstalled === undefined ? {} : { onOpenInstalled })}
  />
}
