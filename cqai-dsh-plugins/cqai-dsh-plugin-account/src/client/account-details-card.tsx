import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DsnAccountSnapshot } from '../protocol.ts'
import { formatQuotaBalance, quotaDisplayUnit } from '../quota-display.ts'

export const accountDetailsZh = {
  pointsInfo: '积分信息',
  connectedAs: '当前账号',
  account: '账号',
  username: '用户名',
  email: '邮箱',
  quotaDescription: 'CQAI Club 可用额度',
  refresh: '刷新账号',
  refreshing: '刷新中…',
  logout: '退出登录',
} as const

type AccountDetailsKey = keyof typeof accountDetailsZh

export const accountDetailsEn: Record<AccountDetailsKey, string> = {
  pointsInfo: 'Points',
  connectedAs: 'Current account',
  account: 'Account',
  username: 'Username',
  email: 'Email',
  quotaDescription: 'Available CQAI Club quota',
  refresh: 'Refresh account',
  refreshing: 'Refreshing…',
  logout: 'Sign out',
}

export const cardStyle: CSSProperties = {
  overflow: 'hidden',
  border: '0.5px solid var(--dsw-alias-border-l2, #dfe3e8)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))',
  boxShadow: '0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary, #18202a) 7%, transparent)',
}

export const mutedTextStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary, #667180)',
  fontSize: 14,
  lineHeight: 1.6,
}

export const insetStyle: CSSProperties = {
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)',
}

export function RefreshIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7M17.9 15.5A7 7 0 0 1 5.2 17" /></svg>
}

type AccountDetailsCardProps = {
  readonly t: (key: AccountDetailsKey) => string
  readonly snapshot: Extract<DsnAccountSnapshot, { state: 'signed-in' }>
  readonly responsive: boolean
  readonly busy: boolean
  readonly refreshAccount: () => void | Promise<void>
  readonly logout?: () => void | Promise<void>
  readonly statusMessage?: string
  readonly actions?: ReactNode
}

export function AccountDetailsCard({ t, snapshot, responsive, busy, refreshAccount, logout, statusMessage, actions }: AccountDetailsCardProps) {
  const { account, remainingQuota } = snapshot
  const name = account.displayName ?? account.username ?? account.email ?? String(account.userId)
  return (
    <div style={cardStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: responsive ? 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' : 'minmax(0, 1fr) minmax(180px, .45fr)', gap: 20, alignItems: 'stretch', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, minWidth: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, flex: 'none', borderRadius: '50%', background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 13%, var(--dsw-alias-bg-base, #fff))', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 19, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ marginBottom: 4, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 12 }}>{t('connectedAs')}</div>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 17, whiteSpace: 'nowrap' }}>{name}</strong>
            <div style={{ ...mutedTextStyle, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, whiteSpace: 'nowrap' }}>{account.email ?? account.username ?? '—'}</div>
          </div>
        </div>
        <div style={{ ...insetStyle, display: 'grid', alignContent: 'center', padding: '16px 18px' }}>
          <span style={{ color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 12 }}>{t('quotaDescription')} · {quotaDisplayUnit(account)}</span>
          <strong style={{ marginTop: 3, fontSize: 25, lineHeight: 1.2, letterSpacing: '-0.03em', overflowWrap: 'anywhere' }}>{formatQuotaBalance(remainingQuota, account)}</strong>
          {statusMessage !== undefined && <span role="status" style={{ ...mutedTextStyle, marginTop: 4, fontSize: 12 }}>{statusMessage}</span>}
        </div>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1, margin: 0, borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', background: 'var(--dsw-alias-border-l1, #edf0f3)' }}>
        {[[t('account'), name], [t('username'), account.username ?? '—'], [t('email'), account.email ?? '—']].map(([label, value]) => (
          <div key={label} style={{ minWidth: 0, padding: '14px 18px', background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))' }}>
            <dt style={{ marginBottom: 5, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 11 }}>{label}</dt>
            <dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, whiteSpace: 'nowrap' }}>{value}</dd>
          </div>
        ))}
      </dl>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '16px 18px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)' }}>
        <Button variant="outline" icon={<RefreshIcon />} disabled={busy} onClick={() => { void refreshAccount() }}>{busy ? t('refreshing') : t('refresh')}</Button>
        {logout !== undefined && <Button variant="ghost" disabled={busy} onClick={() => { void logout() }}>{t('logout')}</Button>}
        {actions}
      </div>
    </div>
  )
}
