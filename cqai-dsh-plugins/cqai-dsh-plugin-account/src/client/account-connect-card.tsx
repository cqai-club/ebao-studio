import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { cardStyle, insetStyle, mutedTextStyle } from './account-details-card.tsx'

export const accountConnectZh = {
  login: '使用浏览器登录',
  openingBrowser: '正在打开浏览器…',
  connectTitle: '连接你的 CQAI Club 账号',
  connectDescription: '我们会打开系统默认浏览器完成安全登录。完成后，这里会自动更新。',
  browserStep: '在系统浏览器中验证身份',
  returnStep: '验证完成后自动返回桌面端',
  localSecurity: '登录凭据由桌面 Host 安全保存，不会发送到界面或业务插件。',
} as const

type AccountConnectKey = keyof typeof accountConnectZh

export const accountConnectEn: Record<AccountConnectKey, string> = {
  login: 'Continue in browser',
  openingBrowser: 'Opening browser…',
  connectTitle: 'Connect your CQAI Club account',
  connectDescription: 'Your default browser will open for secure sign-in. This page updates automatically when you finish.',
  browserStep: 'Verify your identity in the system browser',
  returnStep: 'Return automatically after authorization',
  localSecurity: 'Credentials stay in the desktop Host and are never sent to the interface or business plugins.',
}

export function BrowserIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3.6 9h16.8M8 3.9 9.5 9m6.5-5.1L14.5 9M9 14.5l3 1.8 3-1.8" /></svg>
}

function ShieldIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5.5 5.8v5.4c0 4.2 2.7 7.8 6.5 9.8 3.8-2 6.5-5.6 6.5-9.8V5.8L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
}

type AccountConnectCardProps = {
  readonly t: (key: AccountConnectKey) => string
  readonly busy: boolean
  readonly startSignIn: () => void | Promise<void>
}

export function AccountConnectCard({ t, busy, startSignIn }: AccountConnectCardProps) {
  return (
    <div style={cardStyle}>
      <div style={{ padding: '30px 30px 24px' }}>
        <h3 style={{ margin: 0, fontSize: 19, lineHeight: 1.35 }}>{t('connectTitle')}</h3>
        <p style={{ ...mutedTextStyle, maxWidth: 560, margin: '8px 0 22px' }}>{t('connectDescription')}</p>
        <div style={{ ...insetStyle, display: 'grid', gap: 12, padding: '15px 16px' }}>
          {[t('browserStep'), t('returnStep')].map((step, index) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13 }}>
              <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, flex: 'none', borderRadius: '50%', background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 11, fontWeight: 700 }}>{index + 1}</span>
              {step}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', padding: '17px 22px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 12, lineHeight: 1.5 }}><ShieldIcon />{t('localSecurity')}</span>
        <Button variant="primary" icon={<BrowserIcon />} disabled={busy} onClick={() => { void startSignIn() }}>{busy ? t('openingBrowser') : t('login')}</Button>
      </div>
    </div>
  )
}
