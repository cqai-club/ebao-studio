import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClubExtensionProps } from '@cqaiclub/dsn-account/club-ui'
import { CqaiMcpSettingsPanel, mcpSettingsEn, mcpSettingsZh } from './mcp-settings.tsx'

const NS = 'cqaiclub-mcp' as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'cqaiclub-mcp': keyof typeof mcpSettingsZh
  }
}

export const inject = ['slots', 'locale', 'connection']

export function applyClubMcpClient(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh: mcpSettingsZh, en: mcpSettingsEn }), 'cqaiclub-mcp: dictionaries')
  ctx.slots.inject('cqaiclub.club.extension', () => ctx.slots.register({
    name: 'cqaiclub.club.extension', id: 'mcp', order: 40,
    label: () => t('mcpTitle'), locale: NS,
  }, (props: ClubExtensionProps & PropsLocale<typeof NS>) => <CqaiMcpSettingsPanel ctx={ctx} t={props.t} />))
}
