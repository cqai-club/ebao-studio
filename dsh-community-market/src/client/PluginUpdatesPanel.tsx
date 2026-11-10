import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconRefreshOutlineRegular, Modal, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketOperationPreviewResponse, MarketPluginUpdate } from '../api-types.js'
import { previewMarketOperation } from './api.js'
import type { MarketSettingsTabProps } from './MarketSettingsTab.js'
import type { PluginUpdatesStore } from './plugin-updates-store.js'

export function PluginUpdatesPanel({ store, t, disabled = false }: {
  readonly store: PluginUpdatesStore
  readonly t: MarketSettingsTabProps['t']
  readonly disabled?: boolean
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [review, setReview] = useState<readonly MarketOperationPreviewResponse[]>()
  const [preparing, setPreparing] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewRequest = useRef<AbortController>()
  const available = snapshot.updates.filter(update => update.updateAvailable && update.latestVersion !== undefined && update.error === undefined)
  const busy = disabled || snapshot.operationPending || snapshot.checking || preparing

  useEffect(() => {
    if (store.getSnapshot().checkedAt === undefined) void store.check()
    return () => { previewRequest.current?.abort() }
  }, [store])

  const prepare = async (updates: readonly MarketPluginUpdate[]) => {
    if (busy || previewRequest.current !== undefined || updates.length === 0) return
    const request = new AbortController()
    previewRequest.current = request
    setPreparing(true)
    setPreviewFailed(false)
    try {
      const previews: MarketOperationPreviewResponse[] = []
      for (const update of updates) {
        const preview = await previewMarketOperation({ action: 'update', packageName: update.packageName }, request.signal)
        if (request.signal.aborted) return
        if (preview.action !== 'update' || preview.packageName !== update.packageName
          || preview.version === undefined || preview.fromVersion === undefined) throw new Error('invalid update preview')
        previews.push(preview)
      }
      if (!request.signal.aborted) setReview(previews)
    } catch {
      if (!request.signal.aborted) setPreviewFailed(true)
    } finally {
      if (previewRequest.current === request) {
        previewRequest.current = undefined
        if (!request.signal.aborted) setPreparing(false)
      }
    }
  }

  return <section className="dshMarketContent dshMarketUpdates" aria-label={t('updates')} aria-busy={busy}>
    <div className="dshMarketSectionHead">
      <div><h2>{t('updates')} <Pill>{available.length}</Pill></h2><p>{t('updatesBody')}</p></div>
      <div className="dshMarketUpdateActions">
        <Button variant="outline" size="sm" disabled={busy} icon={<IconRefreshOutlineRegular />}
          onClick={() => { void store.check(true) }}>{snapshot.checking ? t('checkingUpdates') : t('checkUpdates')}</Button>
        {available.length > 0 && <Button variant="primary" size="sm" disabled={busy}
          onClick={() => { void prepare(available) }}>{preparing ? t('preparingUpdates') : t('updateAll')}</Button>}
      </div>
    </div>
    {snapshot.checking && <p className="dshMarketUpdateStatus" role="status"><StateDot state="ongoing" />{t('checkingUpdates')}</p>}
    {snapshot.checkFailed && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{t('updateCheckFailed')}</div>}
    {snapshot.checkedAt !== undefined && <p className="dshMarketUpdateStatus">{t('updatesCheckedAt')}: <time dateTime={snapshot.checkedAt}>{snapshot.checkedAt}</time></p>}
    {previewFailed && <div className="dshMarketBanner" role="alert"><StateDot state="error" />{t('updatePreviewFailed')}</div>}
    {snapshot.operationPending && snapshot.progress !== undefined && <div className="dshMarketBanner" role="status">
      <StateDot state="ongoing" />{t('updatingPlugins')} {snapshot.progress.packageName} ({snapshot.progress.done + 1}/{snapshot.progress.total})
    </div>}
    {snapshot.operationFailure !== undefined && <div className="dshMarketBanner dshMarketUpdateFailure" role="alert">
      <StateDot state="error" />
      <div><strong>{t('updateFailed')}: {snapshot.operationFailure.packageName}</strong><p>{t('updatePartialFailure')}</p>
        {snapshot.operationFailure.notStarted.length > 0 && <p>{t('updateNotStarted')}: {snapshot.operationFailure.notStarted.join(', ')}</p>}
        <details><summary>{t('verificationDetails')}</summary><p>{snapshot.operationFailure.message}</p></details></div>
    </div>}
    {snapshot.completed.length > 0 && <div className="dshMarketBanner dshMarketUpdateCompleted" role="status">
      <StateDot state="done" /><div><strong>{t('updatesCompleted')} ({snapshot.completed.length})</strong>
        <ul>{snapshot.completed.map(item => <li key={item.packageName}>{item.packageName} · {item.version}</li>)}</ul>
        {snapshot.completed.some(item => item.application === 'restart-required') && <p>{t('restartHint')}</p>}
        {snapshot.completed.some(item => item.application === 'overridden') && <p>{t('overriddenHint')}</p>}</div>
    </div>}
    {!snapshot.checking && !snapshot.checkFailed && snapshot.checkedAt !== undefined && available.length === 0
      && !snapshot.updates.some(update => update.error !== undefined) && <p className="dshMarketUpdateStatus" role="status">{t('pluginsUpToDate')}</p>}
    <div className="dshMarketReceipts">
      {snapshot.updates.map(update => <article className="dshMarketReceipt" key={update.bundleId}>
        <div className="dshMarketReceiptMain">
          <div className="dshMarketReceiptTitle"><h3>{update.packageName}</h3>
            {snapshot.operationFailure?.notStarted.includes(update.packageName) === true ? <Pill>{t('updateNotStarted')}</Pill>
              : snapshot.operationFailure?.packageName === update.packageName ? <Pill>{t('updateFailed')}</Pill>
              : update.error !== undefined || snapshot.checkFailed ? <Pill>{t('updateCheckItemFailed')}</Pill>
              : update.updateAvailable ? <Pill>{t('updateAvailable').replace('{version}', update.latestVersion ?? '')}</Pill> : <Pill>{t('pluginUpToDate')}</Pill>}
          </div>
          <div className="dshMarketReceiptMeta"><span>{update.currentVersion}
            {update.updateAvailable && update.latestVersion !== undefined ? ` → ${update.latestVersion}` : ''}</span></div>
          {update.error !== undefined && <p className="dshMarketUpdateStatus" role="status">{t('updateCheckItemFailed')}</p>}
        </div>
        {update.updateAvailable && update.latestVersion !== undefined && update.error === undefined && <Button variant="primary" size="sm"
          aria-label={`${t('update')}: ${update.packageName}`} disabled={busy}
          onClick={() => { void prepare([update]) }}>{t('update')}</Button>}
      </article>)}
    </div>
    <Modal open={review !== undefined} className="dshMarketModal dshMarketOperationModal" contentClassName="dshMarketModalContent"
      title={t('confirmUpdateTitle')} description={t('updatesBody')} closeLabel={t('cancel')}
      onClose={() => { if (!snapshot.operationPending) setReview(undefined) }}
      footer={<div className="dshMarketModalActions">
        <Button variant="ghost" disabled={snapshot.operationPending} onClick={() => setReview(undefined)}>{t('cancel')}</Button>
        <Button variant="primary" disabled={snapshot.operationPending || review === undefined} onClick={() => {
          const previews = review
          if (previews === undefined || store.getSnapshot().operationPending) return
          setReview(undefined)
          void store.executeReviewed(previews)
        }}>{t('confirmUpdate')}</Button>
      </div>}>
      <ul className="dshMarketUpdateReview">{review?.map(preview => <li key={preview.previewId}>
        <strong>{preview.packageName}</strong><span>{preview.fromVersion} → {preview.version}</span>
        <span>{t('profile')}: {preview.profileName}</span><span>{t('previewExpires')}: {preview.expiresAt}</span>
      </li>)}</ul>
    </Modal>
  </section>
}
