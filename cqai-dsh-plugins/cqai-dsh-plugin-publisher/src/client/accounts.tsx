import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { PLATFORMS, PLATFORM_LABELS, type Platform, type PublisherAccount, type PublisherCapability, type PublisherImportPreview, type PublisherPlatformCapability } from '../protocol.ts'
import { api, capabilityMessage, CONTENT_LABELS, PublisherModal } from './shared.tsx'
import { PlatformIcon } from './platform-icon.tsx'
import { usePublisherTips } from './tips.tsx'

export function AccountsPage({ active }: { active: boolean }) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [capability, setCapability] = useState<PublisherCapability>()
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [platformCapabilities, setPlatformCapabilities] = useState<PublisherPlatformCapability[]>([])
  const [displayName, setDisplayName] = useState('')
  const [platform, setPlatform] = useState<Platform>('dy')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [preview, setPreview] = useState<PublisherImportPreview>()
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; account: PublisherAccount }>()
  const [nextName, setNextName] = useState('')

  const refresh = async () => {
    const rows = await api<PublisherAccount[]>('accounts')
    setAccounts(rows)
  }

  useEffect(() => {
    if (!active) return
    let live = true
    void api<PublisherCapability>('capability').then(async value => {
      if (!live) return
      setCapability(value)
      if (value.supported) {
        const [rows, supported] = await Promise.all([
          api<PublisherAccount[]>('accounts'),
          api<PublisherPlatformCapability[]>('platform-capabilities'),
        ])
        if (live) { setAccounts(rows); setPlatformCapabilities(supported) }
      }
    }).catch(cause => { if (live) showError(cause instanceof Error ? cause.message : '发布能力检查失败') })
    return () => { live = false }
  }, [active])

  // Returning from a native login window focuses e宝. Check once per focus;
  // there is deliberately no timer, QR polling, or background status loop.
  useEffect(() => {
    const checkOnFocus = () => {
      if (accounts.length === 0 || busy !== '') return
      void Promise.all(accounts.map(account => api<PublisherAccount>('account-check-login', { id: account.id })))
        .then(setAccounts)
        .catch(() => {})
    }
    window.addEventListener('focus', checkOnFocus)
    return () => window.removeEventListener('focus', checkOnFocus)
  }, [accounts, busy])

  const act = async (label: string, task: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label); clearTip()
    try { await task() } catch (cause) { showError(cause instanceof Error ? cause.message : '操作失败') }
    finally { busyRef.current = false; setBusy('') }
  }

  const create = () => act('正在创建账号…', async () => {
    if (platform === 'wxmp' && !displayName.trim()) throw new Error('请填写公众号名称')
    const account = await api<PublisherAccount>('accounts', {
      displayName, platform, ...(platform === 'wxmp' ? { appId, appSecret } : {}),
    })
    setDisplayName('')
    setAppId(''); setAppSecret('')
    if (platform !== 'wxmp') await api('account-open-login', { id: account.id })
    await refresh()
    showSuccess(platform === 'wxmp' ? '公众号已添加，请检查接口状态。' : '登录窗口已打开；完成登录后回到 e宝工坊检查状态和账号名称。')
  })

  const rename = (account: PublisherAccount) => {
    setNextName(account.displayName)
    setDialog({ kind: 'rename', account })
  }

  const remove = (account: PublisherAccount) => {
    setDialog({ kind: 'delete', account })
  }

  const closeDialog = () => { if (!busyRef.current) setDialog(undefined) }

  const saveRename = () => {
    if (busyRef.current || dialog?.kind !== 'rename') return
    const name = nextName.trim()
    if (!name || name === dialog.account.displayName) return
    const account = dialog.account
    void act('正在保存…', async () => {
      await api('account-update', { id: account.id, displayName: name })
      setDialog(undefined)
      await refresh()
    })
  }

  const confirmRemove = () => {
    if (busyRef.current || dialog?.kind !== 'delete') return
    const account = dialog.account
    void act('正在删除…', async () => {
      await api('account-delete', { id: account.id })
      setDialog(undefined)
      await refresh()
    })
  }

  const inspectImport = () => act('正在检查旧账号…', async () => {
    const result = await api<PublisherImportPreview>('import-preview')
    setPreview(result)
  })

  const applyImport = () => act('正在复制旧账号…', async () => {
    if (preview?.running) throw new Error('请先完全退出独立 MatrixMedia')
    await api('import-apply', {})
    setPreview(undefined)
    await refresh()
    showSuccess('导入完成。已复制旧 session，原 MatrixMedia 数据未移动或删除；请检查登录状态。')
  })

  const unavailable = capabilityMessage(capability)
  return <div>
    {unavailable && <div className="pub-error">{unavailable}</div>}
    <div className="pub-grid pub-account-layout">
      <div>
        <div className="pub-account-list-head">
          <div><h2>账号列表</h2><p className="pub-muted">已添加 {accounts.length} 个平台账号</p></div>
          {accounts.length > 0 && <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => void act('正在刷新…', refresh)}>刷新列表</Button>}
        </div>
        {accounts.length === 0
          ? <div className="pub-card pub-empty">还没有发布账号<br/>请添加账号并完成平台登录。</div>
          : <div className="pub-account-cards">{accounts.map(account => <article className="pub-account-card" key={account.id}>
            <div className="pub-account-card-head">
              <div className="pub-account-icon"><PlatformIcon platform={account.platform}/></div>
              <div className="pub-account-identity">
                <strong>{account.displayName}</strong>
                <span>{PLATFORM_LABELS[account.platform]} · 支持：{platformCapabilities.find(item => item.platform === account.platform)?.contentTypes.map(type => CONTENT_LABELS[type]).join('、') || '验收中'}</span>
              </div>
              <Tag className="pub-status" tone={account.loginState === 'logged-in' ? 'success' : account.loginState === 'logged-out' ? 'warning' : 'neutral'}>
                {account.platform === 'wxmp'
                  ? account.loginState === 'logged-in' ? '凭据有效' : account.loginState === 'logged-out' ? '凭据或网络异常' : '状态未知'
                  : account.loginState === 'logged-in' ? '已登录' : account.loginState === 'logged-out' ? '需要登录' : '状态未知'}
              </Tag>
            </div>
            {account.platform === 'wxmp' && account.loginError && <p className="pub-account-error">{account.loginError}</p>}
            <div className="pub-account-card-actions" role="group" aria-label={`${account.displayName}的账号操作`}>
              {account.platform !== 'wxmp' && <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => void act('正在打开登录页…', async () => { await api('account-open-login', { id: account.id }) })}>{account.loginState === 'logged-in' ? '重新登录' : '登录'}</Button>}
              <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => void act('正在检查…', async () => { const next = await api<PublisherAccount>('account-check-login', { id: account.id }); setAccounts(rows => rows.map(row => row.id === next.id ? next : row)) })}>检查状态</Button>
              <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => void act('正在打开后台…', async () => { await api('account-open-dashboard', { id: account.id }) })}>打开平台后台</Button>
              <Button variant="outline" size="sm" disabled={busy !== ''} onClick={() => rename(account)}>改名</Button>
              <Button variant="outline" size="sm" className="pub-danger-action" disabled={busy !== ''} onClick={() => remove(account)}>删除</Button>
            </div>
          </article>)}</div>}
      </div>
      <div><div className="pub-card"><h2>添加账号</h2>
        <div className="pub-field">
          <label htmlFor="pub-account-platform">平台</label>
          <select id="pub-account-platform" className="pub-input" value={platform} onChange={event => setPlatform(event.target.value as Platform)}>{PLATFORMS.map(value => <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>)}</select>
        </div>
        <div className="pub-field">
          <label htmlFor="pub-account-name">账号名称{platform === 'wxmp' ? '' : '（选填）'}</label>
          <Input id="pub-account-name" className="pub-input-wrap" maxLength={100} placeholder={platform === 'wxmp' ? '例如：品牌公众号' : '留空则在登录后尝试识别平台昵称'} value={displayName} onChange={event => setDisplayName(event.target.value)}/>
          {platform !== 'wxmp' && <small className="pub-muted">识别不到时可在账号列表中改名。</small>}
        </div>
        {platform === 'wxmp' && <>
          <div className="pub-field"><label htmlFor="pub-wxmp-app-id">公众号 AppID</label><Input id="pub-wxmp-app-id" className="pub-input-wrap" autoComplete="off" value={appId} onChange={event => setAppId(event.target.value)}/></div>
          <div className="pub-field"><label htmlFor="pub-wxmp-app-secret">公众号 AppSecret</label><Input id="pub-wxmp-app-secret" className="pub-input-wrap" type="password" autoComplete="new-password" value={appSecret} onChange={event => setAppSecret(event.target.value)}/></div>
          <p className="pub-muted">使用公众号官方接口；请在微信公众平台确认草稿与发布权限，并配置本机出口 IP 白名单。密钥在本机加密保存。</p>
        </>}
        <Button size="sm" variant="primary" disabled={busy !== '' || capability?.supported !== true} onClick={() => void create()}>{busy || (platform === 'wxmp' ? '添加公众号' : '添加并打开登录页')}</Button>
        {capability?.legacyAccountImportSupported === false && <p className="pub-muted">Windows 暂不支持导入独立 MatrixMedia 账号；请直接添加账号并登录。</p>}
        {capability?.legacyAccountImportSupported !== false && <div className="pub-import"><h2>导入 MatrixMedia 账号</h2><p className="pub-muted">只复制 macOS 默认目录里的账号和 session；不会移动或删除原数据。导入前必须完全退出独立 MatrixMedia。</p>
          <Button size="sm" variant="outline" disabled={busy !== '' || capability?.supported !== true} onClick={() => void inspectImport()}>预览可导入账号</Button>
          {preview && <div style={{ marginTop: 14 }}>
            {preview.accounts.length === 0
              ? <div className="pub-muted">没有发现可导入账号。</div>
              : <>
                <div className={preview.running ? 'pub-error' : 'pub-muted'}>{preview.running ? '检测到独立 MatrixMedia 仍在运行，请先退出。' : `发现 ${String(preview.accounts.length)} 个账号：`}</div>
                <div className="pub-tags">{preview.accounts.map((item, index) => <Tag tone="neutral" key={`${item.platform}:${item.displayName}:${String(index)}`}>{PLATFORM_LABELS[item.platform]} · {item.displayName}</Tag>)}</div>
                <div className="pub-actions"><Button size="sm" variant="primary" disabled={preview.running || busy !== ''} onClick={() => void applyImport()}>确认复制并导入</Button></div>
              </>}
          </div>}
        </div>}
      </div></div>
    </div>
    <PublisherModal
      open={dialog?.kind === 'rename'}
      onClose={closeDialog}
      title="修改账号名称"
      closeLabel="关闭"
      className="pub-modal-account"
      footer={<>
        <Button size="sm" variant="outline" disabled={busy !== ''} onClick={closeDialog}>取消</Button>
        <Button size="sm" variant="primary" type="submit" form="pub-account-rename-form" disabled={busy !== '' || !nextName.trim() || nextName.trim() === dialog?.account.displayName}>{busy || '保存名称'}</Button>
      </>}
    >
      <form id="pub-account-rename-form" className="pub-modal-field" onSubmit={event => { event.preventDefault(); saveRename() }}>
        <label className="pub-modal-label" htmlFor="pub-account-next-name">新的账号名称</label>
        <Input id="pub-account-next-name" className="pub-input-wrap" data-pub-initial-focus maxLength={100} value={nextName} disabled={busy !== ''} onChange={event => setNextName(event.target.value)}/>
      </form>
    </PublisherModal>
    <PublisherModal
      open={dialog?.kind === 'delete'}
      onClose={closeDialog}
      title="删除账号"
      description={dialog?.kind === 'delete' ? `删除“${dialog.account.displayName}”并清理其登录 session？` : ''}
      closeLabel="关闭"
      className="pub-modal-account"
      footer={<>
        <Button size="sm" variant="outline" data-pub-initial-focus disabled={busy !== ''} onClick={closeDialog}>取消</Button>
        <Button size="sm" variant="outline" className="pub-danger-action" disabled={busy !== ''} onClick={confirmRemove}>{busy || '确认删除'}</Button>
      </>}
    >
      <p className="pub-modal-copy">历史提交记录会保留账号名称快照。</p>
    </PublisherModal>
  </div>
}
