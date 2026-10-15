import { useSyncExternalStore } from 'react'
import { Button, IconRefreshOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginUpdatesStore } from './plugin-updates-store.js'

export type PluginUpdatesSummaryProps = PropsRuntime<'cqai.pluginManagement.updates'> & PropsLocale<'community-market'> & {
  readonly updatesStore: PluginUpdatesStore
}

/** Keeps the update entry visible on CQAI's native installed-plugin page. */
export function PluginUpdatesSummary({ updatesStore, onOpenUpdates, t }: PluginUpdatesSummaryProps) {
  const snapshot = useSyncExternalStore(updatesStore.subscribe, updatesStore.getSnapshot, updatesStore.getSnapshot)
  const count = snapshot.updates.filter(update => update.updateAvailable && update.latestVersion !== undefined && update.error === undefined).length
  const failed = snapshot.checkFailed || snapshot.updates.some(update => update.error !== undefined)
  const label = snapshot.checking ? t('checkingUpdates') : failed ? t('updateCheckFailed')
    : count > 0 ? `${t('pluginUpdatesAvailable')} (${count})` : snapshot.checkedAt === undefined ? t('updates') : t('pluginsUpToDate')
  return <div className="dshMarketBanner dshMarketUpdateSummary">
    <span className="dshMarketUpdateSummaryText" role="status"><StateDot state={snapshot.checking ? 'ongoing' : failed ? 'error' : count > 0 ? 'warning' : 'done'} />{label}</span>
    <div className="dshMarketUpdateActions">
      <Button variant="outline" size="sm" disabled={snapshot.checking || snapshot.operationPending} icon={<IconRefreshOutlineRegular />}
        onClick={() => { void updatesStore.check(true) }}>{t('checkUpdates')}</Button>
      <Button variant={count > 0 ? 'primary' : 'outline'} size="sm" onClick={() => {
        updatesStore.requestOpen()
        if (onOpenUpdates !== undefined) onOpenUpdates()
        else window.dispatchEvent(new window.Event('cqai-plugin-market-open-updates'))
      }}>{t('viewUpdates')}</Button>
    </div>
  </div>
}
