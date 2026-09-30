import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from 'dsh-community-market/client'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ProductPackage } from '../product-bundles.js'
import { changeProductBundle, readProductInventory, requestDesktopRestart, type ProductBundle, type ProductInventory } from './management-api.js'
import { styles } from './styles.js'

const PRODUCT_DETAILS: Readonly<Record<ProductPackage, { name: string; zh: string; en: string }>> = {
  'cqai-dsh-plugin-cqai-club-theme': { name: 'CQAI Club 主题', zh: '自定义桌面配色与背景。', en: 'Customize Desktop colors and background.' },
  'cqai-dsh-plugin-imagegen': { name: 'e图宝', zh: '生成、编辑和管理图片素材。', en: 'Generate, edit and manage images.' },
  'cqai-dsh-plugin-video': { name: 'e剪宝', zh: '制作口播短视频并预览成片。', en: 'Create and preview narrated videos.' },
  'cqai-dsh-plugin-publisher': { name: '多平台发布', zh: '管理草稿并向多个平台发布内容。', en: 'Manage drafts and publish to multiple platforms.' },
  'cqai-dsh-plugin-talkcraft': { name: '口播视频制作', zh: '制作和编辑口播视频。', en: 'Create and edit talking videos.' },
  'cqai-dsh-plugin-short-video': { name: '短视频制作', zh: '根据脚本与素材制作短视频。', en: 'Create short videos from scripts and media.' },
  'dsh-ppt-composer': { name: 'PPT 制作', zh: '创建和编辑演示文稿。', en: 'Create and edit presentations.' },
}

type View = 'installed' | 'market' | 'skills' | 'mcp'

export function createViewState() {
  let view: View = 'installed'
  const listeners = new Set<() => void>()
  return {
    get: () => view,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    select: (next: View) => {
      if (view === next) return
      view = next
      for (const listener of listeners) listener()
    },
  }
}

type ViewState = ReturnType<typeof createViewState>

function useLocale(ctx: Context): string {
  return useSyncExternalStore(
    listener => ctx.locale.subscribe(listener),
    () => ctx.locale.getLocale().active,
  )
}

function copy(locale: string) {
  return locale.startsWith('zh') ? {
    title: '插件管理', back: '返回', installed: '已安装插件', market: '插件市场', skills: '技能', mcp: 'MCP', marketIntro: '发现并安装插件',
    unavailable: '当前插件市场不可用。', unavailablePanel: '当前管理页面不可用。', loading: '正在读取预制插件…',
    enable: '启用', disable: '停用', current: '当前运行', disabled: '已停用',
    willDisable: '重启后停用', willEnable: '重启后启用', failed: '无法加载',
    pending: '更改将在重启后生效', later: '稍后重启', restart: '立即重启',
  } : {
    title: 'Plugin management', back: 'Back', installed: 'Installed plugins', market: 'Plugin market', skills: 'Skills', mcp: 'MCP', marketIntro: 'Discover and install plugins',
    unavailable: 'The plugin market is unavailable.', unavailablePanel: 'This management page is unavailable.', loading: 'Loading bundled plugins…',
    enable: 'Enable', disable: 'Disable', current: 'Running', disabled: 'Disabled',
    willDisable: 'Disables after restart', willEnable: 'Enables after restart', failed: 'Failed to load',
    pending: 'Changes take effect after restart', later: 'Restart later', restart: 'Restart now',
  }
}

type ShellProps = PropsRuntime<'plugins.shell'> & PropsRenderSlots<'cqai.pluginManagement.market' | 'cqai.pluginManagement.skills' | 'cqai.pluginManagement.mcp'> & {
  ctx: Context
  viewState: ViewState
}

/** The original plugin manager remains mounted in the right pane, retaining its forms and install flow. */
export function PluginManagementShell({ ctx, viewState, content, nativeView, showList, renderSlot }: ShellProps) {
  const view = useSyncExternalStore(viewState.subscribe, viewState.get, viewState.get)
  const t = copy(useLocale(ctx))

  useEffect(() => {
    let previous = ctx.layout.panelInfo.getSnapshot().activePanelId
    return ctx.layout.panelInfo.subscribe(() => {
      const current = ctx.layout.panelInfo.getSnapshot().activePanelId
      if (current === 'plugins' && previous !== 'plugins') viewState.select('installed')
      previous = current
    })
  }, [ctx, viewState])

  // An external plugin can open a native package detail while Market is selected.
  useEffect(() => {
    if (nativeView.kind !== 'list') viewState.select('installed')
  }, [nativeView.kind, viewState])

  const openInstalled = () => { showList(); viewState.select('installed') }
  return <div className="cqpm-shell">
    <style>{styles}</style>
    <nav className="cqpm-nav" aria-label={t.title}>
      <button className="cqpm-back" type="button" onClick={() => ctx.layout.selectPanel(null)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" /></svg>
        {t.back}
      </button>
      <button type="button" aria-current={view === 'installed' ? 'page' : undefined} onClick={openInstalled}>{t.installed}</button>
      <button type="button" aria-current={view === 'market' ? 'page' : undefined} onClick={() => viewState.select('market')}>{t.market}</button>
      <button type="button" aria-current={view === 'skills' ? 'page' : undefined} onClick={() => viewState.select('skills')}>{t.skills}</button>
      <button type="button" aria-current={view === 'mcp' ? 'page' : undefined} onClick={() => viewState.select('mcp')}>{t.mcp}</button>
    </nav>
    <div className="cqpm-native" hidden={view !== 'installed'}>{content}</div>
    {view === 'market' && <div className="cqpm-market">
      <header className="cqpm-market-head" data-window-drag><h1>{t.market}</h1><p>{t.marketIntro}</p></header>
      {renderSlot('cqai.pluginManagement.market', { onOpenInstalled: openInstalled }, {
        fallback: <p className="cqpm-message">{t.unavailable}</p>,
      })}
    </div>}
    {view === 'skills' && <div className="cqpm-external">{renderSlot('cqai.pluginManagement.skills', {}, {
      fallback: <p className="cqpm-message">{t.unavailablePanel}</p>,
    })}</div>}
    {view === 'mcp' && <div className="cqpm-external">{renderSlot('cqai.pluginManagement.mcp', {}, {
      fallback: <p className="cqpm-message">{t.unavailablePanel}</p>,
    })}</div>}
  </div>
}

type ProductProps = PropsRuntime<'plugins.installed.cards'> & { ctx: Context }

function productStatus(bundle: ProductBundle, inventory: ProductInventory, error?: BundleInfo['error']): 'failed' | 'current' | 'willDisable' | 'willEnable' | 'disabled' {
  if (error !== undefined) return 'failed'
  const loaded = inventory.loadedPackageNames.includes(bundle.packageName)
  if (loaded && bundle.status === 'active') return 'current'
  if (loaded) return 'willDisable'
  return bundle.status === 'active' ? 'willEnable' : 'disabled'
}

type RemoteAnswer<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } }

function unwrap<T>(answer: RemoteAnswer<T>): T {
  if (!answer.ok) throw new Error(answer.error.message)
  return answer.value
}

function Artwork({ src }: { src?: string }) {
  const [failedSource, setFailedSource] = useState<string>()
  if (src !== undefined && failedSource !== src) {
    return <img src={src} width="36" height="36" alt="" onError={() => setFailedSource(src)} />
  }
  return <svg className="cqpm-product-artwork" width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>
}

function Toggle({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled: boolean; onChange: () => void }) {
  return <button className="cqpm-product-switch" type="button" role="switch" aria-checked={checked} aria-label={label}
    disabled={disabled} onClick={onChange}><span /></button>
}

/** Only Desktop's shipped feature bundles use the private restart-based selection API. */
export function ProductInstalledCards({ ctx, reportCount }: ProductProps) {
  const locale = useLocale(ctx)
  const t = copy(locale)
  const [inventory, setInventory] = useState<ProductInventory>()
  const [bundles, setBundles] = useState<readonly BundleInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [expanded, setExpanded] = useState<string>()
  const [restartPromptDismissed, setRestartPromptDismissed] = useState(false)

  const refresh = useCallback(async () => {
    const [productResult, bundleResult] = await Promise.allSettled([
      readProductInventory(),
      ctx.remote.pluginManager.listBundles().then((answer: RemoteAnswer<BundleInfo[]>) => unwrap(answer)),
    ])
    if (productResult.status === 'fulfilled') { setInventory(productResult.value); setError(undefined) }
    else setError(productResult.reason instanceof Error ? productResult.reason.message : String(productResult.reason))
    if (bundleResult.status === 'fulfilled') setBundles(bundleResult.value)
    setLoading(false)
  }, [ctx])

  useEffect(() => {
    void refresh()
    const offChange = ctx.remote.$on('plugin-manager/changed', () => { void refresh() })
    return () => { offChange() }
  }, [ctx, refresh])

  const productBundles = inventory?.bundles ?? []
  useEffect(() => { reportCount(productBundles.length); return () => { reportCount(0) } }, [productBundles.length, reportCount])

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key); setNotice(undefined); setRestartPromptDismissed(false)
    try { await operation(); await refresh() }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(undefined) }
  }

  const changeProduct = (bundle: ProductBundle) => {
    const action = bundle.status === 'active' ? 'disable' : 'enable'
    const info = PRODUCT_DETAILS[bundle.packageName as ProductPackage]
    if (action === 'disable' && !window.confirm(locale.startsWith('zh')
      ? `停用 ${info?.name ?? bundle.packageName}？当前任务会继续到重启，重启可能中断未完成任务。`
      : `Disable ${info?.name ?? bundle.packageName}? Restarting may interrupt active tasks.`)) return
    void run(bundle.packageName, () => changeProductBundle(bundle, action))
  }

  const pending = productBundles.some(bundle => inventory!.loadedPackageNames.includes(bundle.packageName) !== (bundle.status === 'active'))
  return <>
    {loading && <li className="cqpm-product-message" role="status">{t.loading}</li>}
    {error && <li className="cqpm-product-message cqpm-product-error" role="alert">{error}</li>}
    {productBundles.map(bundle => {
      const info = PRODUCT_DETAILS[bundle.packageName as ProductPackage]
      const native = bundles.find(item => item.name === bundle.packageName)
      const status = productStatus(bundle, inventory!, native?.error)
      const name = info?.name ?? bundle.packageName
      return <li className="cqpm-product" key={bundle.packageName} data-product-bundle={bundle.packageName}>
        <div className="cqpm-product-head">
          <span className="cqpm-product-icon"><Artwork src={native?.meta?.icon} /></span>
          <div className="cqpm-product-main">
            <div className="cqpm-product-title-line"><button type="button" className="cqpm-product-title" aria-expanded={expanded === bundle.packageName}
              onClick={() => setExpanded(expanded === bundle.packageName ? undefined : bundle.packageName)}>{name}</button>
              {(status === 'willDisable' || status === 'willEnable' || status === 'failed') && <span className={`cqpm-product-tag ${status === 'failed' ? 'cqpm-product-tag-error' : ''}`}>{t[status]}</span>}
            </div>
            <p className="cqpm-product-description">{info?.[locale.startsWith('zh') ? 'zh' : 'en'] ?? bundle.packageName}</p>
          </div>
          {bundle.mutable && <Toggle checked={bundle.status === 'active'} label={`${bundle.status === 'active' ? t.disable : t.enable} ${name}`}
            disabled={busy !== undefined || status === 'failed'} onChange={() => changeProduct(bundle)} />}
        </div>
        {expanded === bundle.packageName && <p className="cqpm-product-detail">{bundle.packageName} · {t[status]}</p>}
      </li>
    })}
    {notice && <li className="cqpm-product-message" role="status">{notice}</li>}
    {pending && !restartPromptDismissed && <li className="cqpm-product-pending">
      <span>{t.pending}</span>
      <button type="button" onClick={() => setRestartPromptDismissed(true)}>{t.later}</button>
      <button type="button" disabled={busy !== undefined} onClick={() => {
        if (!window.confirm(locale.startsWith('zh') ? '立即重启可能中断当前任务，确定继续？' : 'Restart now? Active tasks may be interrupted.')) return
        void run('restart', requestDesktopRestart)
      }}>{t.restart}</button>
    </li>}
  </>
}
