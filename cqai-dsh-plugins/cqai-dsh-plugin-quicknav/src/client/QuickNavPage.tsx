import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import type { CqaiQuicknavLocaleKey } from './locales.ts'

interface QuickNavPageProps extends TabComponentProps {
  t: (key: CqaiQuicknavLocaleKey) => string
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  padding: 14,
  border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .25))',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2, transparent)',
}

/** CQAI's initial workbench page; cards can later become separate Tab plugins. */
export function QuickNavPage({ ctx, scope, t }: QuickNavPageProps) {
  const open = (type: string) => { ctx.betterSidebar.openTab({ type }, scope) }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20, minHeight: '100%', boxSizing: 'border-box' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, lineHeight: 1.4 }}>{t('pageTitle')}</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary, #888)', lineHeight: 1.5 }}>{t('pageDescription')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <button type="button" onClick={() => { open('editor') }} style={cardStyle}>
          <strong>{t('files')}</strong>
          <span style={{ color: 'var(--dsw-alias-label-secondary, #888)' }}>Editor / Explorer</span>
        </button>
        <button type="button" onClick={() => { open('terminal') }} style={cardStyle}>
          <strong>{t('terminal')}</strong>
          <span style={{ color: 'var(--dsw-alias-label-secondary, #888)' }}>Shell workspace</span>
        </button>
        <button type="button" onClick={() => { open('git') }} style={cardStyle}>
          <strong>{t('git')}</strong>
          <span style={{ color: 'var(--dsw-alias-label-secondary, #888)' }}>Changes and history</span>
        </button>
        <button type="button" onClick={() => { open('subagent') }} style={cardStyle}>
          <strong>{t('subagents')}</strong>
          <span style={{ color: 'var(--dsw-alias-label-secondary, #888)' }}>Background tasks</span>
        </button>
      </div>

      <p style={{ margin: 0, color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: 13 }}>{t('comingSoon')}</p>
    </section>
  )
}
