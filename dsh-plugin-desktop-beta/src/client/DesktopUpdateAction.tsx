/** Conditional sidebar entry for updates already discovered by the Desktop Host. */

import { Download, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './desktop-settings.ts'
import type { DesktopSettingsApi, DesktopUpdateStatus } from './desktop-settings-api.ts'

/** Local status and the existing interactive native update action. */
export interface DesktopUpdateActionInjected {
  readonly api: Pick<DesktopSettingsApi, 'readUpdateStatus' | 'checkForUpdates'>
}

/** Sidebar owner geometry, translated copy and launcher-owned operations. */
export type DesktopUpdateActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopUpdateActionInjected>

const STATUS_POLL_INTERVAL_MS = 15_000

/** Show a download shortcut without initiating a remote check on render. */
export function DesktopUpdateAction({ api, wide, t }: DesktopUpdateActionProps) {
  const [status, setStatus] = useState<DesktopUpdateStatus>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(false)
  const pending = useRef(false)
  const refresh = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let active = true
    let reading: Promise<void> | undefined
    mounted.current = true
    const read = (): Promise<void> => {
      if (!active || document.visibilityState === 'hidden') return Promise.resolve()
      if (reading) return reading
      reading = Promise.resolve().then(() => api.readUpdateStatus()).then(next => {
        if (active) setStatus(next)
      }).catch(() => {
        // Keep a known available update through a transient Host reconnect.
      }).finally(() => { reading = undefined })
      return reading
    }
    refresh.current = read
    void read()
    const timer = window.setInterval(() => { void read() }, STATUS_POLL_INTERVAL_MS)
    const onFocus = (): void => { void read() }
    const onVisibilityChange = (): void => { void read() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      mounted.current = false
      refresh.current = async () => {}
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [api])

  if (!status?.supported || status.availableVersion === null) return null
  const working = busy || status.checking || status.downloading
  const versionLabel = t('updateToVersion').replace('{version}', `v${status.availableVersion}`)
  const label = status.downloading ? t('downloadingDesktopUpdate')
    : working ? t('preparingDesktopUpdate') : versionLabel
  const title = failed ? `${t('desktopUpdateActionError')} ${versionLabel}` : label

  const update = async (): Promise<void> => {
    if (pending.current || working) return
    pending.current = true
    setBusy(true)
    setFailed(false)
    try {
      await api.checkForUpdates()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      await refresh.current()
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="dshDesktopUpdateAction" data-wide={wide}>
      <button
        className="dshDesktopUpdateButton"
        type="button"
        title={title}
        aria-label={label}
        aria-busy={working}
        disabled={working}
        onClick={() => { void update() }}
      >
        <span className="dshDesktopUpdateIcon" aria-hidden="true">
          {working
            ? <LoaderCircle className="dshDesktopUpdateSpinner" size={20} />
            : <Download size={20} />}
        </span>
        {wide && <span className="dshDesktopUpdateLabel">{working ? label : t('desktopUpdateAvailable')}</span>}
      </button>
      {failed && <span className="dshDesktopUpdateError" role="alert">{t('desktopUpdateActionError')}</span>}
    </div>
  )
}
