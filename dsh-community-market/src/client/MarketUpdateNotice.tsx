import { useSyncExternalStore } from 'react'
import { Button, IconCloseOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginUpdatesStore } from './plugin-updates-store.js'

export type MarketUpdateNoticeProps = PropsRuntime<'shell.overlay'> & PropsLocale<'community-market'> & {
  readonly updatesStore: PluginUpdatesStore
  readonly onOpenUpdates: () => void
}

export function MarketUpdateNotice({ updatesStore, onOpenUpdates, t }: MarketUpdateNoticeProps) {
  const snapshot = useSyncExternalStore(updatesStore.subscribe, updatesStore.getSnapshot, updatesStore.getSnapshot)
  const count = snapshot.updates.filter(update => update.updateAvailable && update.latestVersion !== undefined && update.error === undefined).length
  if (!snapshot.noticeVisible || count === 0) return null
  return <aside className="dshMarketUpdateNotice" aria-label={t('pluginUpdatesAvailable')}>
    <div role="status"><StateDot state="warning" /><span>{t('pluginUpdatesAvailable')} ({count})</span></div>
    <Button variant="primary" size="sm" onClick={onOpenUpdates}>{t('viewUpdates')}</Button>
    <Button variant="ghost" size="sm" aria-label={t('dismissUpdateNotice')} icon={<IconCloseOutlineRegular />}
      onClick={() => updatesStore.dismiss()} />
  </aside>
}
