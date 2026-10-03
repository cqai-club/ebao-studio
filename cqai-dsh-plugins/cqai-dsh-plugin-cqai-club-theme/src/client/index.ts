import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { tokensForAccent } from './accent.ts'
import { ThemeSettingsRow } from './ThemeSettingsRow.tsx'
import { en, zh, type ClubThemeLocaleKey } from './locales.ts'
import { ClubThemePreferenceStore } from './preferences.ts'
import { installSettingsStyles } from './settings-styles.ts'
import { installHomeWallpaper } from './wallpaper.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'cqai-club-theme': ClubThemeLocaleKey
  }
}

export const inject = ['theme', 'slots', 'locale']

/** The theme remains a removable Client layer over the native DSH palette. */
export function apply(ctx: Context): void {
  const mode = new URLSearchParams(window.location.search).get('dsh-desktop-mode')
  if (mode !== 'extended' && mode !== 'advanced') return

  const preferences = new ClubThemePreferenceStore()
  ctx.effect(() => preferences.listenForStorageChanges(), 'cqai-club-theme: preference sync')
  ctx.effect(() => ctx.locale.register('cqai-club-theme', { zh, en }), 'cqai-club-theme: dictionaries')
  ctx.effect(installSettingsStyles, 'cqai-club-theme: settings styles')
  ctx.effect(
    () => {
      let { accent, preset } = preferences.getSnapshot()
      let dispose = ctx.theme.overrideTokens('cqai-club-theme', tokensForAccent(accent, preset))
      const unsubscribe = preferences.subscribe(() => {
        const next = preferences.getSnapshot()
        if (next.accent === accent && next.preset === preset) return
        accent = next.accent
        preset = next.preset
        dispose = ctx.theme.overrideTokens('cqai-club-theme', tokensForAccent(accent, preset))
      })
      return () => { unsubscribe(); dispose() }
    },
    'cqai-club-theme: palette override',
  )
  ctx.effect(() => installHomeWallpaper(preferences), 'cqai-club-theme: home wallpaper')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'cqai-club-theme',
    order: 12,
    locale: 'cqai-club-theme',
    inject: () => ({ preferences }),
  }, ThemeSettingsRow))
}
