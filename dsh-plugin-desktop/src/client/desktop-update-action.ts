/** Desktop-owned update shortcut in the upstream sidebar footer slot. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DesktopUpdateAction } from './DesktopUpdateAction.tsx'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import { DESKTOP_SETTINGS_LOCALE_NAMESPACE } from './desktop-settings.ts'

const STYLE_ID = 'dsh-desktop-update-action-styles'
const CSS = `
.dshDesktopUpdateAction { flex: none; min-width: 0; position: relative; }
.dshDesktopUpdateAction[data-wide="true"] { width: 100%; }
.dshDesktopUpdateAction .dshDesktopUpdateButton {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  box-sizing: border-box; width: 44px; min-height: 44px; padding: 4px;
  border: 0; border-radius: 10px; background: transparent; color: inherit;
  font: inherit; font-size: 13px; cursor: pointer;
}
.dshDesktopUpdateAction[data-wide="true"] .dshDesktopUpdateButton { width: 100%; padding-inline: 0; justify-content: flex-start; text-align: start; }
.dshDesktopUpdateAction .dshDesktopUpdateIcon {
  display: flex; flex: none; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 50%; background: #3781fa; color: white;
  transition: background-color 150ms ease;
}
.dshDesktopUpdateAction .dshDesktopUpdateButton:hover:not(:disabled) .dshDesktopUpdateIcon { background: #2563eb; }
.dshDesktopUpdateAction .dshDesktopUpdateButton:focus-visible { outline: 2px solid #3781fa; outline-offset: -1px; }
.dshDesktopUpdateAction .dshDesktopUpdateButton:disabled { cursor: default; }
.dshDesktopUpdateAction .dshDesktopUpdateLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopUpdateAction .dshDesktopUpdateError { display: block; padding: 0 4px 4px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #dc2626); }
.dshDesktopUpdateAction[data-wide="false"] .dshDesktopUpdateError { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.dshDesktopUpdateSpinner { animation: dsh-desktop-update-spin 1s linear infinite; }
@keyframes dsh-desktop-update-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dshDesktopUpdateSpinner { animation: none; }
  .dshDesktopUpdateAction .dshDesktopUpdateIcon { transition: none; }
}
`

/** Install scoped button styling without touching the upstream sidebar layout. */
export function installDesktopUpdateActionStyles(): () => void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}

/** Seat the update action after plugin launchers and above the settings avatar. */
export function registerDesktopUpdateAction(ctx: ClientContext, api: DesktopSettingsApi): void {
  ctx.effect(() => installDesktopUpdateActionStyles(), 'dsh-plugin-desktop: update shortcut styles')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'desktop-update',
    order: 1000,
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    label: () => ctx.locale.bind(DESKTOP_SETTINGS_LOCALE_NAMESPACE)('desktopUpdateAvailable'),
    inject: () => ({ api }),
  }, DesktopUpdateAction))
}
