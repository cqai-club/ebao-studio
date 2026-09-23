import { useEffect, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS, type Platform, type PublisherAccount, type PublisherCapability, type PublisherImportPreview, type PublisherPlatformCapability } from '../protocol.ts'
import { api, capabilityMessage, CONTENT_LABELS } from './shared.tsx'
import { usePublisherTips } from './tips.tsx'

export function AccountsPage({ active }: { active: boolean }) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [capability, setCapability] = useState<PublisherCapability>()
  const [accounts, setAccounts] = useState<PublisherAccount[]>([])
  const [platformCapabilities, setPlatformCapabilities] = useState<PublisherPlatformCapability[]>([])
  const [displayName, setDisplayName] = useState('')
  const [platform, setPlatform] = useState<Platform>('dy')
  const [preview, setPreview] = useState<PublisherImportPreview>()
  const [busy, setBusy] = useState('')

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
    setBusy(label); clearTip()
    try { await task() } catch (cause) { showError(cause instanceof Error ? cause.message : '操作失败') }
    finally { setBusy('') }
  }

  const create = () => act('正在创建账号…', async () => {
    if (!displayName.trim()) throw new Error('请填写账号名称')
    const account = await api<PublisherAccount>('accounts', { displayName, platform })
    setDisplayName('')
    await api('account-open-login', { id: account.id })
    await refresh()
    showSuccess('登录窗口已打开；完成登录后回到 e宝工坊即可检查状态。')
  })

  const rename = (account: PublisherAccount) => {
    const next = window.prompt('新的账号名称', account.displayName)
    if (next === null || next.trim() === '' || next.trim() === account.displayName) return
    void act('正在保存…', async () => { await api('account-update', { id: account.id, displayName: next.trim() }); await refresh() })
  }

  const remove = (account: PublisherAccount) => {
    if (!window.confirm(`删除“${account.displayName}”并清理其登录 session？历史提交记录会保留账号名称快照。`)) return
    void act('正在删除…', async () => { await api('account-delete', { id: account.id }); await refresh() })
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
    <div className="pub-grid"><div><div className="pub-card"><h2>账号列表</h2>
      {accounts.length === 0 ? <div className="pub-empty">还没有发布账号<br/>请在右侧添加账号并完成平台登录。</div> : accounts.map(account => <div className="pub-row" key={account.id}><div><strong>{account.displayName}</strong><small>{PLATFORM_LABELS[account.platform]} · 支持：{platformCapabilities.find(item => item.platform === account.platform)?.contentTypes.map(type => CONTENT_LABELS[type]).join('、') || '验收中'}</small></div><div><span className={`pub-status ${account.loginState === 'logged-in' ? 'pub-ok' : account.loginState === 'logged-out' ? 'pub-warn' : ''}`}>{account.loginState === 'logged-in' ? '已登录' : account.loginState === 'logged-out' ? '需要登录' : '状态未知'}</span><div className="pub-actions">
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在打开登录页…', async () => { await api('account-open-login', { id: account.id }) })}>{account.loginState === 'logged-in' ? '重新登录' : '登录'}</button>
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在检查…', async () => { const next = await api<PublisherAccount>('account-check-login', { id: account.id }); setAccounts(rows => rows.map(row => row.id === next.id ? next : row)) })}>检查状态</button>
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在打开后台…', async () => { await api('account-open-dashboard', { id: account.id }) })}>打开平台后台</button>
        <button className="pub-secondary" disabled={busy !== ''} onClick={() => rename(account)}>改名</button>
        <button className="pub-danger" disabled={busy !== ''} onClick={() => remove(account)}>删除</button>
      </div></div></div>)}
      {accounts.length > 0 && <div className="pub-actions"><button className="pub-secondary" disabled={busy !== ''} onClick={() => void act('正在刷新…', refresh)}>刷新列表</button></div>}
    </div></div><div><div className="pub-card"><h2>添加账号</h2>
      <div className="pub-field"><label htmlFor="pub-account-platform">平台</label><select id="pub-account-platform" className="pub-input" value={platform} onChange={event => setPlatform(event.target.value as Platform)}>{PLATFORMS.map(value => <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>)}</select></div>
      <div className="pub-field"><label htmlFor="pub-account-name">账号名称</label><input id="pub-account-name" className="pub-input" maxLength={100} placeholder="例如：品牌主账号" value={displayName} onChange={event => setDisplayName(event.target.value)}/></div>
      <button className="pub-primary" disabled={busy !== '' || capability?.supported !== true} onClick={() => void create()}>{busy || '添加并打开登录页'}</button>
      <div className="pub-import"><h2>导入 MatrixMedia 账号</h2><p className="pub-muted">只复制 macOS 默认目录里的账号和 session；不会移动或删除原数据。导入前必须完全退出独立 MatrixMedia。</p>
        <button className="pub-secondary" disabled={busy !== '' || capability?.supported !== true} onClick={() => void inspectImport()}>预览可导入账号</button>
        {preview && <div style={{marginTop: 14}}>{preview.accounts.length === 0 ? <div className="pub-muted">没有发现可导入账号。</div> : <><div className={preview.running ? 'pub-error' : 'pub-muted'}>{preview.running ? '检测到独立 MatrixMedia 仍在运行，请先退出。' : `发现 ${String(preview.accounts.length)} 个账号：`}</div><div className="pub-tags">{preview.accounts.map((item, index) => <span className="pub-tag" key={`${item.platform}:${item.displayName}:${String(index)}`}>{PLATFORM_LABELS[item.platform]} · {item.displayName}</span>)}</div><div className="pub-actions"><button className="pub-primary" disabled={preview.running || busy !== ''} onClick={() => void applyImport()}>确认复制并导入</button></div></>}</div>}
      </div>
    </div></div></div>
  </div>
}
