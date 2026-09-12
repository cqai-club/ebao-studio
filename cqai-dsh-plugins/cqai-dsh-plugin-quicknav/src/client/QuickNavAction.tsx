import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CqaiQuicknavLocaleKey } from './locales.ts'

export interface QuickNavActionInjected {
  openWorkbench: () => void
}

export type QuickNavActionProps =
  & PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'cqai-quicknav'>
  & QuickNavActionInjected

/** Fixed launcher rendered in the DSH left sidebar footer. */
export function QuickNavAction({ wide, t, openWorkbench }: QuickNavActionProps) {
  return (
    <button
      type="button"
      aria-label={t('action')}
      title={t('action')}
      onClick={openWorkbench}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        minWidth: 0,
        minHeight: 34,
        padding: wide ? '0 10px' : 0,
        justifyContent: wide ? 'flex-start' : 'center',
        color: 'var(--dsw-alias-label-secondary, currentColor)',
        background: 'transparent',
        border: 0,
        borderRadius: 8,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>⚡</span>
      {wide && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('action')}</span>}
    </button>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'cqai-quicknav': CqaiQuicknavLocaleKey
  }
}
