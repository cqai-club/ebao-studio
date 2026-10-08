import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClubMcpState, ClubMcpStatus, DsnAccountSnapshot } from '../../mcp/protocol.ts'
import { authorizeClubMcp, configureClubMcp, connectClubMcp, getClubMcpStatus, accountRpcCall } from './rpc.ts'

export const mcpSettingsZh = {
  mcpTitle: 'MCP 服务',
  mcpDescription: '连接 CQAI Club 官网，在 e宝工坊中使用当前账号获准使用的俱乐部工具。',
  mcpEnable: '启用官网 MCP 服务',
  mcpAccountHint: '使用现有 CQAI Club 账号；需要更多权限时，在浏览器中补充授权。',
  mcpDisabled: '未启用',
  mcpSignedOut: '需要登录',
  mcpReauthRequired: '需要补充授权',
  mcpDisconnected: '未连接',
  mcpConnecting: '正在连接…',
  mcpConnected: '已连接',
  mcpError: '连接失败',
  mcpLoading: '正在读取服务状态…',
  mcpUnavailable: '暂时无法读取 MCP 服务状态，请重试。',
  mcpTools: '可用工具',
  mcpSaving: '正在保存设置…',
  mcpSaved: 'MCP 服务设置已保存。',
  mcpConnect: '连接服务',
  mcpReconnect: '重新连接',
  mcpAuthorize: '补充授权',
  mcpLogin: '登录并授权',
  mcpOpeningBrowser: '正在打开浏览器…',
  mcpWaiting: '请在浏览器中完成授权，完成后会自动连接。',
  mcpReopenBrowser: '重新打开浏览器',
  mcpCancelAuthorization: '取消授权',
  mcpRefresh: '刷新状态',
  mcpRetry: '重试',
} as const

export type McpSettingsKey = keyof typeof mcpSettingsZh

export const mcpSettingsEn: Record<McpSettingsKey, string> = {
  mcpTitle: 'MCP service',
  mcpDescription: 'Connect to CQAI Club to use the club tools available to your current account in e宝工坊.',
  mcpEnable: 'Enable official MCP service',
  mcpAccountHint: 'Uses your existing CQAI Club account. Grant additional permissions in your browser when needed.',
  mcpDisabled: 'Disabled',
  mcpSignedOut: 'Sign-in required',
  mcpReauthRequired: 'Authorization required',
  mcpDisconnected: 'Disconnected',
  mcpConnecting: 'Connecting…',
  mcpConnected: 'Connected',
  mcpError: 'Connection failed',
  mcpLoading: 'Checking service status…',
  mcpUnavailable: 'MCP service status is temporarily unavailable. Please retry.',
  mcpTools: 'Available tools',
  mcpSaving: 'Saving settings…',
  mcpSaved: 'MCP service settings saved.',
  mcpConnect: 'Connect service',
  mcpReconnect: 'Reconnect',
  mcpAuthorize: 'Grant permissions',
  mcpLogin: 'Sign in and authorize',
  mcpOpeningBrowser: 'Opening browser…',
  mcpWaiting: 'Finish authorization in your browser. The service connects automatically afterward.',
  mcpReopenBrowser: 'Reopen browser',
  mcpCancelAuthorization: 'Cancel authorization',
  mcpRefresh: 'Refresh status',
  mcpRetry: 'Retry',
}

const statusLabels: Record<ClubMcpState, McpSettingsKey> = {
  disabled: 'mcpDisabled',
  'signed-out': 'mcpSignedOut',
  'reauth-required': 'mcpReauthRequired',
  disconnected: 'mcpDisconnected',
  connecting: 'mcpConnecting',
  connected: 'mcpConnected',
  error: 'mcpError',
}

const mutedStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 14,
  lineHeight: 1.6,
}

export function CqaiMcpSettingsPanel({ ctx, t }: {
  readonly ctx: ClientContext
  readonly t: (key: McpSettingsKey) => string
}) {
  const [status, setStatus] = useState<ClubMcpStatus>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'saving' | 'connecting' | 'authorizing' | 'canceling'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [authorization, setAuthorization] = useState<DsnAccountSnapshot>()
  const mounted = useRef(false)
  const revision = useRef(0)
  const statusRead = useRef(0)
  const busyRef = useRef(false)

  const reload = useCallback(async () => {
    if (busyRef.current) return
    const requestedRevision = revision.current
    const requestedRead = ++statusRead.current
    try {
      const next = await getClubMcpStatus(ctx)
      if (mounted.current && requestedRevision === revision.current && requestedRead === statusRead.current && !busyRef.current) {
        setStatus(next)
        setError(undefined)
      }
    } catch (cause) {
      if (mounted.current && requestedRevision === revision.current && requestedRead === statusRead.current && !busyRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (mounted.current && requestedRevision === revision.current && requestedRead === statusRead.current) setLoading(false)
    }
  }, [ctx])

  useEffect(() => {
    mounted.current = true
    void reload()
    const timer = window.setInterval(() => { void reload() }, 5000)
    const onFocus = () => { void reload() }
    const offReset = typeof ctx.on === 'function' ? ctx.on('connection/reset', onFocus) : undefined
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      revision.current++
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      offReset?.()
    }
  }, [ctx, reload])

  const perform = useCallback(async (
    operation: 'saving' | 'connecting' | 'authorizing' | 'canceling',
    action: () => Promise<void>,
  ) => {
    if (busyRef.current) return
    busyRef.current = true
    revision.current++
    setBusy(operation)
    setError(undefined)
    setNotice(undefined)
    try {
      await action()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(undefined)
    }
  }, [])

  const connect = useCallback(async (reconnect = false) => {
    const next = await connectClubMcp(ctx, reconnect)
    if (mounted.current) setStatus(next)
  }, [ctx])

  useEffect(() => {
    if (authorization?.state !== 'authorizing') return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling || busyRef.current) return
      polling = true
      const requestedRevision = revision.current
      try {
        const next = await accountRpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {})
        if (!active || !mounted.current || requestedRevision !== revision.current || next.state === 'authorizing') return
        active = false
        setAuthorization(next)
        if (next.state === 'signed-in') await perform('connecting', connect)
        else await reload()
      } catch (cause) {
        if (active && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
      } finally { polling = false }
    }
    const timer = window.setInterval(() => { void poll() }, 500)
    return () => { active = false; window.clearInterval(timer) }
  }, [authorization?.state, connect, ctx, perform, reload])

  const toggleEnabled = () => perform('saving', async () => {
    if (status === undefined) return
    const next = await configureClubMcp(ctx, !status.enabled)
    if (!mounted.current) return
    setStatus(next)
    setNotice(t('mcpSaved'))
    if (next.enabled) {
      setBusy('connecting')
      await connect()
    }
  })

  const authorize = () => perform('authorizing', async () => {
    const result = await authorizeClubMcp(ctx)
    if (!mounted.current) return
    setStatus(result.mcp)
    setAuthorization(result.snapshot)
    if (result.snapshot.state === 'signed-in') await connect()
  })

  const pendingAuthorization = authorization?.state === 'authorizing' ? authorization : undefined
  const unavailable = status === undefined
  const state = busy === 'connecting' ? 'connecting' : status?.state
  const needsAuthorization = state === 'signed-out' || state === 'reauth-required'
  const controlsDisabled = busy !== undefined || loading || unavailable || state === 'connecting'
  const statusError = error ?? (authorization?.state === 'error' ? authorization.message : undefined)
    ?? (state === 'error' ? status?.message : undefined)
  const dot = state === 'connected' ? 'done' : state === 'connecting' ? 'ongoing' : state === 'error' ? 'error'
    : state === 'reauth-required' || state === 'signed-out' ? 'warning' : 'idle'
  const tone = state === 'connected' ? 'success' : state === 'error' ? 'danger'
    : state === 'reauth-required' || state === 'signed-out' ? 'warning' : 'neutral'

  return (
    <div style={{ display: 'grid', gap: 20, padding: '8px 0 36px', maxWidth: 760 }}>
      <div>
        <h1 className="cqai-club-empty-title">{t('mcpTitle')}</h1>
        <p style={{ ...mutedStyle, margin: '8px 0 0' }}>{t('mcpDescription')}</p>
      </div>
      <div style={{ display: 'grid', gap: 20, padding: 22, border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 16, background: 'var(--dsw-alias-bg-layer-2)' }} aria-busy={busy !== undefined || loading}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: controlsDisabled ? 'default' : 'pointer' }}>
          <input type="checkbox" role="switch" checked={status?.enabled ?? false} disabled={controlsDisabled}
            aria-checked={status?.enabled ?? false}
            onChange={() => { void toggleEnabled() }} aria-label={t('mcpEnable')}
            style={{ width: 18, height: 18, flex: 'none', accentColor: 'var(--dsw-alias-state-business-primary)' }} />
          <strong style={{ fontSize: 15 }}>{t('mcpEnable')}</strong>
        </label>
        <p style={{ ...mutedStyle, margin: 0 }}>{t('mcpAccountHint')}</p>
        <div role="status" aria-live="polite" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag tone={tone}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><StateDot state={dot} />{loading ? t('mcpLoading') : state === undefined ? t('mcpUnavailable') : t(statusLabels[state])}</span></Tag>
          <span style={mutedStyle}>{t('mcpTools')}: {status?.toolCount ?? 0}</span>
        </div>
        {statusError !== undefined ? <div role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{statusError}</div> : null}
        {status?.message !== undefined && state !== 'error' && !pendingAuthorization ? <p style={{ ...mutedStyle, margin: 0, overflowWrap: 'anywhere' }}>{status.message}</p> : null}
        {notice !== undefined || busy === 'saving' ? <p role="status" style={{ ...mutedStyle, margin: 0 }}>{busy === 'saving' ? t('mcpSaving') : notice}</p> : null}
        {pendingAuthorization !== undefined ? (
          <div style={{ display: 'grid', gap: 12, padding: 16, borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }}>
            <p role="status" style={{ ...mutedStyle, margin: 0 }}>{t('mcpWaiting')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="outline" disabled={busy !== undefined} onClick={() => { window.open(pendingAuthorization.authorizationUrl, '_blank', 'noopener,noreferrer') }}>{t('mcpReopenBrowser')}</Button>
              <Button variant="ghost" disabled={busy !== undefined} onClick={() => { void perform('canceling', async () => {
                const next = await accountRpcCall<DsnAccountSnapshot>(ctx, 'authorization/cancel', { attemptId: pendingAuthorization.attemptId })
                if (mounted.current) setAuthorization(next)
                const mcp = await getClubMcpStatus(ctx)
                if (mounted.current) setStatus(mcp)
              }) }}>{t('mcpCancelAuthorization')}</Button>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {unavailable ? <Button variant="outline" disabled={loading || busy !== undefined} onClick={() => { setLoading(true); void reload() }}>{t('mcpRetry')}</Button> : <Button variant="ghost" disabled={controlsDisabled} onClick={() => { void reload() }}>{t('mcpRefresh')}</Button>}
          {status?.enabled && pendingAuthorization === undefined ? <>
            <Button variant={needsAuthorization ? 'primary' : 'outline'} disabled={controlsDisabled} onClick={() => { void authorize() }}>{busy === 'authorizing' ? t('mcpOpeningBrowser') : state === 'signed-out' ? t('mcpLogin') : t('mcpAuthorize')}</Button>
            {!needsAuthorization ? <Button variant="primary" disabled={controlsDisabled} onClick={() => { void perform('connecting', () => connect(state === 'connected')) }}>{state === 'connecting' ? t('mcpConnecting') : state === 'connected' ? t('mcpReconnect') : t('mcpConnect')}</Button> : null}
          </> : null}
        </div>
      </div>
    </div>
  )
}
