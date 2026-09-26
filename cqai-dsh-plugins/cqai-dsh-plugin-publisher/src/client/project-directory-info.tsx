import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutlineMedium, Menu, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, errorMessage } from './shared.tsx'

type ProjectWorkspace = { contentId: string; path: string }
type AvailableApps = { apps: string[] }

const APP_LABELS: Record<string, string> = {
  finder: '访达', explorer: '文件资源管理器', filemanager: '文件管理器',
  cursor: 'Cursor', vscode: 'VS Code', vscodeinsiders: 'VS Code Insiders', windsurf: 'Windsurf',
  zed: 'Zed', sublimetext: 'Sublime Text', xcode: 'Xcode', androidstudio: 'Android Studio',
  intellij: 'IntelliJ IDEA', pycharm: 'PyCharm', webstorm: 'WebStorm', phpstorm: 'PhpStorm',
  goland: 'GoLand', rider: 'Rider', rustrover: 'RustRover', fork: 'Fork',
  sourcetree: 'Sourcetree', github: 'GitHub Desktop', tower: 'Tower',
  gitkraken: 'GitKraken', smartgit: 'SmartGit', sublimemerge: 'Sublime Merge',
  ghostty: 'Ghostty', warp: 'Warp', iterm: 'iTerm', kitty: 'Kitty',
  terminal: '终端', windowsterminal: 'Windows Terminal', gitbash: 'Git Bash',
  gnometerminal: 'GNOME Terminal', konsole: 'Konsole',
}

function hostUrl(route: string): string {
  const origin = globalThis.location?.origin
  return new URL(route, origin && origin !== 'null' ? origin : 'http://dsh.internal').toString()
}

function AppIcon({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/></svg>
    : <img width="18" height="18" src={hostUrl(`/open-in-app/icon/${encodeURIComponent(id)}`)} alt="" aria-hidden="true" onError={() => setFailed(true)}/>
}

const style = `
.pub-project-directory { margin-bottom: 18px; }
.pub-project-directory-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.pub-project-directory-head h2 { margin: 0; }
.pub-project-directory-path { display: block; margin-top: 12px; color: var(--pub-secondary-text); font: 11px/1.5 var(--ds-font-family-code, monospace); overflow-wrap: anywhere; user-select: all; }
.pub-project-directory-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.pub-project-directory button { font: inherit; cursor: pointer; }
.pub-project-directory-copy, .pub-project-directory-retry { min-height: 28px; padding: 4px 9px; border: 1px solid var(--pub-border); border-radius: 7px; background: var(--pub-surface); color: var(--pub-text); font-size: 12px !important; }
.pub-project-directory-open { display: inline-flex; align-items: stretch; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); overflow: hidden; }
.pub-project-directory-open button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; padding: 4px 9px; border: 0; background: transparent; color: var(--pub-text); font-size: 12px; white-space: nowrap; }
.pub-project-directory-open button + button { padding-inline: 6px; border-left: 1px solid var(--pub-border); }
.pub-project-directory-open button:hover:not(:disabled), .pub-project-directory-copy:hover { background: var(--pub-soft); }
.pub-project-directory-open button:disabled { opacity: .45; cursor: not-allowed; }
.pub-project-directory-open img, .pub-project-directory-open svg { flex: none; object-fit: contain; }
.pub-project-directory-status { margin: 8px 0 0; color: var(--pub-tertiary-text); font-size: 12px; }
.pub-project-directory-error { margin: 8px 0 0; color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; overflow-wrap: anywhere; }
`

export function ProjectDirectoryInfo({ contentId }: { contentId: string }) {
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const [apps, setApps] = useState<string[] | null>(null)
  const [appsError, setAppsError] = useState('')
  const [selectedApp, setSelectedApp] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const openingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setPath('')
    setError('')
    setCopyStatus('')
    setOpenError('')
    void api<ProjectWorkspace>('project-workspace', { contentId }).then(result => {
      if (!cancelled) setPath(result.path)
    }).catch(cause => { if (!cancelled) setError(errorMessage(cause)) })
    return () => { cancelled = true }
  }, [contentId, retry])

  useEffect(() => {
    let cancelled = false
    void fetch(hostUrl('/open-in-app/apps'), { headers: { accept: 'application/json' } }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as AvailableApps
      if (!Array.isArray(result.apps)) throw new Error('应用列表格式无效')
      if (!cancelled) setApps(result.apps.filter(id => typeof id === 'string'))
    }).catch(cause => { if (!cancelled) { setApps([]); setAppsError(errorMessage(cause)) } })
    return () => { cancelled = true }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopyStatus('已复制路径')
    } catch { setCopyStatus('复制失败，请手动选中路径') }
  }

  const available = (apps ?? []).filter(id => APP_LABELS[id])
  const current = selectedApp && available.includes(selectedApp) ? selectedApp
    : available.find(id => id === 'finder' || id === 'explorer' || id === 'filemanager') ?? available[0]

  const openDirectory = async (appId: string) => {
    if (!path || openingRef.current) return
    openingRef.current = true
    setOpening(true)
    setOpenError('')
    try {
      const response = await fetch(hostUrl('/open-in-app/open'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: appId, path }),
      })
      if (!response.ok) throw new Error(`打开失败（HTTP ${response.status}）`)
    } catch (cause) { setOpenError(errorMessage(cause)) }
    finally { openingRef.current = false; setOpening(false) }
  }

  const items: MenuItem[] = available.map(id => ({ id, label: APP_LABELS[id], icon: <AppIcon id={id}/> }))

  return <div className="pub-card pub-project-directory"><style>{style}</style>
    <div className="pub-project-directory-head"><h2>项目目录</h2>
      {path && current && <Menu open={menuOpen} align="end" dense portal selection="fill" onClose={() => setMenuOpen(false)}
        items={items} selectedId={current} onSelect={id => {
          setMenuOpen(false)
          if (openingRef.current) return
          setSelectedApp(id)
          void openDirectory(id)
        }} anchor={<div className="pub-project-directory-open">
          <button type="button" aria-label={`在${APP_LABELS[current]}中打开项目目录`} disabled={opening} onClick={() => void openDirectory(current)}><AppIcon id={current}/><span>打开文件夹</span></button>
          <button type="button" aria-label="选择打开项目目录的应用" aria-haspopup="menu" aria-expanded={menuOpen} disabled={opening} onClick={() => setMenuOpen(value => !value)}><IconChevronDownOutlineMedium size={12}/></button>
        </div>}/>}
    </div>
    {error ? <p className="pub-project-directory-error" role="alert">项目目录不可用：{error} <button className="pub-project-directory-retry" type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>
      : path ? <><code className="pub-project-directory-path">{path}</code>
        <div className="pub-project-directory-actions"><button className="pub-project-directory-copy" type="button" onClick={() => void copy()}>复制路径</button>{copyStatus && <span role="status">{copyStatus}</span>}</div>
        {apps === null && <p className="pub-project-directory-status" role="status">正在检查可打开的应用…</p>}
        {apps !== null && !current && <p className="pub-project-directory-status" role="status">{appsError ? `暂时无法读取本机应用：${appsError}` : '本机没有可用的打开应用'}；仍可复制路径。</p>}
        {openError && <p className="pub-project-directory-error" role="alert">{openError}</p>}
      </> : <p className="pub-project-directory-status" role="status">正在读取项目目录…</p>}
  </div>
}
