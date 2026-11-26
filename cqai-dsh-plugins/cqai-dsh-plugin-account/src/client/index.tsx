import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type ReactNode, type RefObject } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../club-ui.ts'
import {
  Button,
  IconSettingsOutlineMedium,
  IconUserOutlineMedium,
  Menu,
  Modal,
  StateDot,
  Tag,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DsnAccountSnapshot } from '../protocol.ts'
import { AccountConnectCard, BrowserIcon, accountConnectEn, accountConnectZh } from './account-connect-card.tsx'
import { AccountDetailsCard, accountDetailsEn, accountDetailsZh, cardStyle, insetStyle, mutedTextStyle } from './account-details-card.tsx'
import { BillingPanel, billingEn, billingZh } from './billing-panel.tsx'
import {
  CqaiModelsSettingsCard,
  modelsSettingsEn,
  modelsSettingsZh,
} from './models-settings-card.tsx'
import { rpcCall } from './rpc.ts'

const NS = 'cqaiclub-dsn-account' as const
const CLUB_PANEL = 'cqai-club' as MainPanelId

function isCqaiPrimaryDesktop(): boolean {
  return (globalThis as typeof globalThis & { dshDesktop?: { cqaiPrimaryLogin?: unknown } })
    .dshDesktop?.cqaiPrimaryLogin === true
}

/** The current Desktop shell keeps the official settings launcher intact. */
function isModernDesktop(): boolean {
  return typeof (globalThis as typeof globalThis & { desktopNext?: { state?: unknown } }).desktopNext?.state === 'function'
}

const zh = {
  ...accountConnectZh,
  ...accountDetailsZh,
  ...billingZh,
  tab: 'CQAI Club',
  back: '返回',
  eyebrow: '账户与云服务',
  title: 'CQAI Club',
  description: '连接会员账号，在桌面端共享模型、额度与服务。',
  signedOut: '未连接',
  authorizing: '等待浏览器',
  openLogin: '重新打开浏览器',
  cancel: '取消登录',
  signedIn: '已连接',
  loading: '正在读取账号状态…',
  waitingTitle: '请在浏览器中完成登录',
  waitingDescription: '此窗口可以保持打开，CQAI Club 会在授权完成后自动连接。',
  quota: '剩余额度',
  membershipInfo: '会员信息',
  clubActivities: '俱乐部活动',
  launcherMenu: 'CQAI Club 账号菜单',
  launcherSignIn: '登录 CQAI Club',
  launcherOpenSettings: '打开设置',
  launcherAccountUnavailable: '账号状态暂时不可用',
  launcherNeedsAttention: '账号需要处理',
  accountTab: '账户',
  configurationError: '当前插件尚未完成管理员配置。',
  unavailable: '账号服务暂时不可用。',
  onboardingTitle: '登录 CQAI Club',
  onboardingDescription: '优先连接 CQAI Club，登录后会自动加载会员模型与额度。仅当你仍在使用出厂默认模型时，才会切换到推荐的 CQAI 模型。',
  onboardingCloudModels: '使用 CQAI Club 账号提供的模型与额度',
  onboardingPreserveChoice: '保留你已经设置的其他默认模型',
  onboardingLater: '稍后登录',
  onboardingPreparing: '正在准备 CQAI Club 模型…',
  onboardingReady: '登录成功，正在进入应用…',
  onboardingRetry: '重试模型准备',
  onboardingContinue: '继续使用其他模型',
  ...modelsSettingsZh,
} as const

const en: Record<keyof typeof zh, string> = {
  ...accountConnectEn,
  ...accountDetailsEn,
  ...billingEn,
  tab: 'CQAI Club',
  back: 'Back',
  eyebrow: 'ACCOUNT & CLOUD',
  title: 'CQAI Club',
  description: 'Connect your membership to share models, quota, and services on desktop.',
  signedOut: 'Not connected',
  authorizing: 'Waiting for browser',
  openLogin: 'Reopen browser',
  cancel: 'Cancel sign-in',
  signedIn: 'Connected',
  loading: 'Checking account status…',
  waitingTitle: 'Finish signing in in your browser',
  waitingDescription: 'Keep this window open. CQAI Club connects automatically when authorization finishes.',
  quota: 'Remaining quota',
  membershipInfo: 'Membership',
  clubActivities: 'Club activities',
  launcherMenu: 'CQAI Club account menu',
  launcherSignIn: 'Sign in to CQAI Club',
  launcherOpenSettings: 'Open settings',
  launcherAccountUnavailable: 'Account status is temporarily unavailable',
  launcherNeedsAttention: 'Account needs attention',
  accountTab: 'Account',
  configurationError: 'The administrator has not finished configuring this plugin.',
  unavailable: 'The account service is temporarily unavailable.',
  onboardingTitle: 'Sign in to CQAI Club',
  onboardingDescription: 'Connect CQAI Club first to load your membership models and quota. The recommended CQAI model replaces only the untouched factory default.',
  onboardingCloudModels: 'Use models and quota provided by your CQAI Club account',
  onboardingPreserveChoice: 'Keep any other default model you already selected',
  onboardingLater: 'Sign in later',
  onboardingPreparing: 'Preparing CQAI Club models…',
  onboardingReady: 'Signed in. Opening the app…',
  onboardingRetry: 'Retry model setup',
  onboardingContinue: 'Continue with another model',
  ...modelsSettingsEn,
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'cqaiclub-dsn-account': keyof typeof zh
  }

  interface SlotMap {
    'cqaiclub.club.activities': {
      kind: 'list'
      scope: 'root'
      owner: {}
    }
    'cqaiclub.account.menu.action': {
      kind: 'list'
      scope: 'root'
      owner: { registerAction: (action: AccountMenuAction) => () => void }
    }
  }
}

interface AccountMenuAction {
  readonly id: string
  readonly label: () => string
  readonly icon?: ReactNode
  readonly onSelect: () => void
}

type ClubRenderProps = PropsRenderSlots<'cqaiclub.club.extension' | 'cqaiclub.club.activities'>
type AccountSettingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & ClubRenderProps & {
  readonly accountContext: ClientContext
}
type AccountOnboardingProps = PropsRuntime<'settings.onboarding'> & PropsLocale<typeof NS> & {
  readonly accountContext: ClientContext
}
type AccountLauncherProps = PropsRuntime<'settings.launcher'> & PropsRenderSlots<'cqaiclub.account.menu.action'> & PropsLocale<typeof NS> & {
  readonly accountContext: ClientContext
  readonly openClub: () => void
}
type AccountTranslator = AccountSettingsSectionProps['t']
type ExtensionSection = `extension:${string}`
type ClubSection = 'points' | 'membership' | ExtensionSection

type ClubExtension = { readonly id: string; readonly label: string; readonly legacy?: boolean }

function useClubExtensions(ctx: ClientContext, t: AccountTranslator): readonly ClubExtension[] {
  const subscribe = useCallback((listener: () => void) => {
    const offExtensions = ctx.slots.subscribe('cqaiclub.club.extension', listener)
    const offActivities = ctx.slots.subscribe('cqaiclub.club.activities', listener)
    return () => { offExtensions(); offActivities() }
  }, [ctx])
  const getSnapshot = useCallback(() => `${ctx.slots.getVersion('cqaiclub.club.extension')}:${ctx.slots.getVersion('cqaiclub.club.activities')}`, [ctx])
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const extensions: Array<ClubExtension & { order: number }> = ctx.slots.entriesOfSlot('cqaiclub.club.extension')
    .map(entry => ({ id: entry.options.id!, label: resolveSlotLabel(entry.options.label) ?? entry.options.id!, order: entry.options.order ?? 0 }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  if (!extensions.some(entry => entry.id === 'activities') && ctx.slots.entriesOfSlot('cqaiclub.club.activities').length > 0) {
    extensions.push({ id: 'legacy-activities', label: t('clubActivities'), order: 30, legacy: true })
    extensions.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  }
  return extensions.map(({ order: _order, ...entry }) => entry)
}

function renderClubExtension(extension: ClubExtension, renderSlot: ClubRenderProps['renderSlot']) {
  return extension.legacy
    ? renderSlot('cqaiclub.club.activities', {})
    : renderSlot('cqaiclub.club.extension', {}, { only: extension.id })
}

/** Restore focus only when the focused element disappears with the selected page. */
function useRemovedSectionFocus(active: string, visible: string) {
  const fallbackButton = useRef<HTMLButtonElement>(null)
  const focusedElement = useRef<HTMLElement>()
  useLayoutEffect(() => {
    const element = focusedElement.current
    if (active !== visible && element !== undefined && !element.isConnected
      && element.ownerDocument.activeElement === element.ownerDocument.body) {
      fallbackButton.current?.focus()
    }
  }, [active, visible])
  return {
    fallbackButton,
    onFocusCapture: (event: FocusEvent<HTMLElement>) => { focusedElement.current = event.target },
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) {
        focusedElement.current = undefined
      }
    },
  }
}

function createClubViewState() {
  let active: ClubSection = 'points'
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => active,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    select: (section: ClubSection) => {
      if (active === section) return
      active = section
      for (const listener of listeners) listener()
    },
  }
}

type ClubViewState = ReturnType<typeof createClubViewState>
type ClubPageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & ClubRenderProps & {
  readonly accountContext: ClientContext
  readonly viewState: ClubViewState
  readonly onBack: () => void
}

const clubPageStyles = `
.cqai-club-shell{display:flex;width:100%;height:100%;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.cqai-club-shell *{box-sizing:border-box}
.cqai-club-nav{position:relative;display:flex;flex:none;flex-direction:column;gap:4px;width:184px;padding:max(60px,calc(28px + var(--dsh-frame-top-clearance,0px))) 12px 20px;border-right:1px solid var(--dsw-alias-border-l2)}
.cqai-club-nav button{width:100%;padding:10px 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;text-align:left;cursor:pointer;-webkit-app-region:no-drag}
.cqai-club-nav .cqai-club-back{position:absolute;top:18px;left:16px;display:inline-flex;align-items:center;gap:6px;width:auto;min-height:24px;padding:2px 4px;color:var(--dsw-alias-label-primary);font-weight:500;line-height:20px}
.cqai-club-nav button:hover,.cqai-club-nav button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}
.cqai-club-nav button[aria-current=page]{color:var(--dsw-alias-label-primary);font-weight:600}
.cqai-club-nav button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.cqai-club-content{flex:1;min-width:0;min-height:0;overflow:auto;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) clamp(24px,4vw,48px) 48px}
.cqai-club-content-inner{max-width:760px;margin:0 auto}
.cqai-club-empty-title{margin:8px 0 0;font-size:22px;font-weight:600;line-height:1.3}
@media(max-width:700px){.cqai-club-nav{width:150px}.cqai-club-content{padding-left:20px;padding-right:20px}}
@media(max-width:520px){.cqai-club-nav{width:120px;padding-left:6px;padding-right:6px}.cqai-club-content{padding-left:14px;padding-right:14px}}
`
const panelStyle: CSSProperties = {
  display: 'grid',
  gap: 20,
  maxWidth: 760,
  padding: '8px 0 36px',
  color: 'var(--dsw-alias-label-primary, #18202a)',
}

function snapshotMessage(snapshot: DsnAccountSnapshot | undefined, t: AccountSettingsSectionProps['t']): string | undefined {
  if (snapshot?.state === 'error') {
    if (snapshot.code === 'DSN_CONFIG_INVALID') return t('configurationError')
    return snapshot.message || t('unavailable')
  }
  if (snapshot?.state === 'reauth-required') return snapshot.reason
  return undefined
}

type SignedInSection = 'account' | 'billing' | ExtensionSection

function SignedInTabs({ active, setActive, t, hasAccount, extensions, accountButtonRef }: {
  readonly active: SignedInSection
  readonly setActive: (section: SignedInSection) => void
  readonly t: AccountTranslator
  readonly hasAccount: boolean
  readonly extensions: readonly ClubExtension[]
  readonly accountButtonRef: RefObject<HTMLButtonElement>
}) {
  const tabs: readonly { readonly id: SignedInSection; readonly label: string }[] = [
    { id: 'account', label: t('accountTab') },
    ...(hasAccount ? [{ id: 'billing', label: t('billingTab') }] as const : []),
    ...extensions.map(extension => ({ id: `extension:${extension.id}` as const, label: extension.label })),
  ]
  return (
    <div role="tablist" aria-label={t('tab')} style={{ display: 'flex', gap: 5, width: 'fit-content', maxWidth: '100%', padding: 4, overflowX: 'auto', borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)' }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          ref={tab.id === 'account' ? accountButtonRef : undefined}
          aria-selected={active === tab.id}
          onClick={() => setActive(tab.id)}
          role="tab"
          style={{ minHeight: 34, padding: '7px 14px', border: 0, borderRadius: 9, background: active === tab.id ? 'var(--dsw-alias-bg-layer-2, #fff)' : 'transparent', boxShadow: active === tab.id ? '0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary, #18202a) 12%, transparent)' : 'none', color: active === tab.id ? 'var(--dsw-alias-label-primary, #18202a)' : 'var(--dsw-alias-label-secondary, #667180)', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: active === tab.id ? 650 : 500, whiteSpace: 'nowrap' }}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function statusPresentation(snapshot: DsnAccountSnapshot | undefined): {
  dot: 'done' | 'warning' | 'ongoing' | 'error' | 'idle'
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  key: 'signedIn' | 'authorizing' | 'signedOut'
} {
  if (snapshot?.state === 'signed-in') return { dot: 'done', tone: 'success', key: 'signedIn' }
  if (snapshot?.state === 'authorizing') return { dot: 'ongoing', tone: 'warning', key: 'authorizing' }
  if (snapshot?.state === 'error') return { dot: 'error', tone: 'danger', key: 'signedOut' }
  return { dot: 'idle', tone: 'neutral', key: 'signedOut' }
}

const ignoreOnboardingDismiss = (): void => {}

function CqaiAccountOnboarding({ complete, explicit, t, accountContext: ctx }: AccountOnboardingProps) {
  const [snapshot, setSnapshot] = useState<DsnAccountSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const completed = useRef(false)
  const loginStarted = useRef(false)
  const preparing = useRef(false)
  const autoPrepareStarted = useRef(false)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const onboardingVisible = snapshot !== undefined

  const completeStep = useCallback(() => {
    if (completed.current) return
    completed.current = true
    complete()
  }, [complete])

  useEffect(() => {
    // Stable/Beta complete account setup in their native first-run flow. Keep
    // this slot for explicit re-entry and for Web/Next, which own other flows.
    if (!explicit && isCqaiPrimaryDesktop()) {
      completeStep()
      return
    }
    const controller = new AbortController()
    void rpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {}, controller.signal).then((next) => {
      if (!controller.signal.aborted) setSnapshot(next)
    }).catch(() => {
      // A missing Host RPC must not indefinitely own the ordered onboarding
      // slot. Continue to the next model setup step without painting chrome.
      if (!controller.signal.aborted) completeStep()
    })
    return () => { controller.abort() }
  }, [completeStep, ctx, explicit])

  useEffect(() => {
    if (snapshot?.state !== 'authorizing') return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await rpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {})
        if (active) {
          setSnapshot(next)
          setError(undefined)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (active) timer = window.setTimeout(() => { void poll() }, 500)
      }
    }
    void poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ctx, snapshot?.state])

  useEffect(() => {
    if (!onboardingVisible) return
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [onboardingVisible])

  useEffect(() => {
    if (onboardingVisible) titleRef.current?.focus()
  }, [onboardingVisible])

  const prepareSignedInAccount = useCallback(async () => {
    if (preparing.current || completed.current) return
    preparing.current = true
    setBusy(true)
    setError(undefined)
    let finished = false
    try {
      if (loginStarted.current) {
        await rpcCall(ctx, 'models/default/adopt-onboarding', {})
      }
      finished = true
      completeStep()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      preparing.current = false
      if (!finished) setBusy(false)
    }
  }, [completeStep, ctx])

  useEffect(() => {
    if (snapshot?.state !== 'signed-in' || autoPrepareStarted.current) return
    autoPrepareStarted.current = true
    void prepareSignedInAccount()
  }, [prepareSignedInAccount, snapshot?.state])

  if (snapshot === undefined) return null

  const startLogin = async () => {
    loginStarted.current = true
    autoPrepareStarted.current = false
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await rpcCall<DsnAccountSnapshot>(ctx, 'authorization/start', {}))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancelLogin = async (leaveOnboarding: boolean) => {
    if (snapshot.state !== 'authorizing') {
      if (leaveOnboarding) completeStep()
      return
    }
    setBusy(true)
    setError(undefined)
    let finished = false
    try {
      const next = await rpcCall<DsnAccountSnapshot>(ctx, 'authorization/cancel', { attemptId: snapshot.attemptId })
      setSnapshot(next)
      if (leaveOnboarding) {
        finished = true
        completeStep()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!finished) setBusy(false)
    }
  }

  const authorizationUrl = snapshot.state === 'authorizing' ? snapshot.authorizationUrl : undefined
  const displayError = error ?? snapshotMessage(snapshot, t)
  const signedIn = snapshot.state === 'signed-in'

  return (
    <Modal open title={t('onboardingTitle')} onClose={ignoreOnboardingDismiss} headless>
      <div style={{ display: 'grid', gap: 20, padding: '28px 28px 4px', color: 'var(--dsw-alias-label-primary, #18202a)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 48, height: 48, flex: 'none', borderRadius: 15, background: 'linear-gradient(145deg, #1268dc, #6047c9)', color: '#fff', boxShadow: '0 8px 22px rgba(40, 91, 200, .24)', fontSize: 15, fontWeight: 750 }}>CQ</div>
          <div>
            <h2 ref={titleRef} tabIndex={-1} style={{ margin: 0, outline: 'none', fontSize: 20, lineHeight: 1.3 }}>{t('onboardingTitle')}</h2>
            <p style={{ ...mutedTextStyle, margin: '5px 0 0', fontSize: 13 }}>{t('onboardingDescription')}</p>
          </div>
        </div>

        {snapshot.state === 'authorizing' ? (
          <div style={{ ...insetStyle, display: 'grid', justifyItems: 'center', gap: 9, padding: 20, textAlign: 'center' }}>
            <StateDot state="ongoing" size={20} />
            <strong style={{ fontSize: 14 }}>{t('waitingTitle')}</strong>
            <span style={{ ...mutedTextStyle, fontSize: 12 }}>{t('waitingDescription')}</span>
          </div>
        ) : signedIn ? (
          <div style={{ ...insetStyle, display: 'flex', alignItems: 'center', gap: 10, padding: 16 }} role="status">
            <StateDot state={displayError === undefined ? 'ongoing' : 'warning'} />
            <span style={{ ...mutedTextStyle, fontSize: 13 }}>{busy ? t('onboardingPreparing') : t('onboardingReady')}</span>
          </div>
        ) : (
          <div style={{ ...insetStyle, display: 'grid', gap: 12, padding: '15px 16px' }}>
            {[t('onboardingCloudModels'), t('onboardingPreserveChoice')].map((item, index) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13 }}>
                <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, flex: 'none', borderRadius: '50%', background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 11, fontWeight: 700 }}>{index + 1}</span>
                {item}
              </div>
            ))}
          </div>
        )}

        {displayError !== undefined ? (
          <div role="alert" style={{ padding: '10px 12px', borderRadius: 9, background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #c63131) 8%, transparent)', color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13, lineHeight: 1.5 }}>{displayError}</div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {snapshot.state === 'authorizing' ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => { void cancelLogin(true) }}>{t('onboardingLater')}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { void cancelLogin(false) }}>{t('cancel')}</Button>
              <Button variant="primary" icon={<BrowserIcon />} disabled={busy || authorizationUrl === undefined} onClick={() => { if (authorizationUrl !== undefined) void window.open(authorizationUrl, '_blank', 'noopener,noreferrer') }}>{t('openLogin')}</Button>
            </>
          ) : signedIn && displayError !== undefined ? (
            <>
              <Button variant="outline" disabled={busy} onClick={completeStep}>{t('onboardingContinue')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { void prepareSignedInAccount() }}>{t('onboardingRetry')}</Button>
            </>
          ) : signedIn ? null : (
            <>
              <Button variant="ghost" disabled={busy} onClick={completeStep}>{t('onboardingLater')}</Button>
              <Button variant="primary" icon={<BrowserIcon />} disabled={busy} onClick={() => { void startLogin() }}>{busy ? t('openingBrowser') : t('login')}</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** The sidebar owns no credential state; every action goes through the account Host RPC. */
function CqaiAccountLauncher({
  wide, settingsOpen, settingsShortcut, openSettings, openClub, renderSlot, t, accountContext: ctx,
}: AccountLauncherProps) {
  const [snapshot, setSnapshot] = useState<DsnAccountSnapshot>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [menuActions, setMenuActions] = useState<readonly AccountMenuAction[]>([])
  const trigger = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  const requestVersion = useRef(0)
  const settingsWasOpen = useRef(false)

  const registerMenuAction = useCallback((action: AccountMenuAction) => {
    setMenuActions(current => [...current.filter(item => item.id !== action.id), action])
    return () => setMenuActions(current => current.filter(item => item !== action))
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (busyRef.current) return
    const version = ++requestVersion.current
    try {
      const next = await rpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {}, signal)
      if (!signal?.aborted && version === requestVersion.current) {
        setSnapshot(next)
        setError(undefined)
      }
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : t('launcherAccountUnavailable'))
      }
    }
  }, [ctx, t])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const interval = window.setInterval(() => { void refresh(controller.signal) }, snapshot?.state === 'authorizing' ? 500 : 5000)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [refresh, snapshot?.state])

  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refresh()
    settingsWasOpen.current = settingsOpen
  }, [refresh, settingsOpen])

  const run = async (endpoint: string, payload: unknown, unwrap: (result: unknown) => DsnAccountSnapshot) => {
    if (busyRef.current) return
    busyRef.current = true
    requestVersion.current += 1
    setBusy(true)
    setError(undefined)
    try {
      const result = await rpcCall<unknown>(ctx, endpoint, payload)
      setSnapshot(unwrap(result))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('launcherAccountUnavailable'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const signedIn = snapshot?.state === 'signed-in'
  const authorizing = snapshot?.state === 'authorizing'
  const accountName = signedIn
    ? snapshot.account.displayName ?? snapshot.account.username ?? snapshot.account.email ?? 'CQAI Club'
    : undefined
  const feedback = error ?? (snapshot?.state === 'error' ? snapshot.message
    : snapshot?.state === 'reauth-required' ? snapshot.reason : undefined)
  const label = accountName ?? (feedback === undefined
    ? authorizing ? t('authorizing') : t('launcherSignIn')
    : t('launcherNeedsAttention'))
  const items: MenuEntry[] = []
  if (feedback !== undefined) items.push({ type: 'label', id: 'account-feedback', text: feedback })
  if (authorizing) {
    items.push({ id: 'open-login', label: t('openLogin'), icon: <IconUserOutlineMedium size={16} /> })
    items.push({ id: 'cancel-login', label: t('cancel'), disabled: busy })
  } else if (!signedIn) {
    items.push({ id: 'login', label: t('launcherSignIn'), icon: <IconUserOutlineMedium size={16} />, disabled: busy })
  }
  items.push({ id: 'cqaiclub-open-page', label: t('title'), icon: <IconUserOutlineMedium size={16} /> })
  items.push(...menuActions.map(action => ({ id: action.id, label: action.label(), icon: action.icon })))
  items.push({
    id: 'open-settings', label: t('launcherOpenSettings'),
    icon: <IconSettingsOutlineMedium size={16} />,
    ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }),
  })
  if (signedIn) items.push({ id: 'logout', label: t('logout'), danger: true, disabled: busy })

  return (
    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
      {renderSlot('cqaiclub.account.menu.action', { registerAction: registerMenuAction })}
      <Menu
        open={open}
        side="top"
        portal
        autoFocus
        anchor={(
          <button
            ref={trigger}
            type="button"
            aria-label={`${t('launcherMenu')}: ${label}${feedback === undefined ? '' : `. ${feedback}`}`}
            aria-haspopup="menu"
            aria-expanded={open}
            title={!wide ? `${label}${feedback === undefined ? '' : `: ${feedback}`}` : undefined}
            onClick={() => { setOpen(value => !value); if (!open) void refresh() }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center',
              gap: 8, width: wide ? 180 : 36, height: wide ? 42 : 36,
              padding: wide ? '0 8px' : 0, boxSizing: 'border-box', border: 0,
              borderRadius: 12, background: 'transparent', color: 'var(--dsw-alias-label-primary)',
              font: 'inherit', fontSize: 14, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: 'none', width: 24, height: 24, borderRadius: '50%', background: 'var(--dsw-alias-bg-skeleton, #e6e9ee)', color: 'var(--dsw-alias-label-primary, #18202a)', fontSize: 10, fontWeight: 750 }}>CQ</span>
            {wide ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span> : null}
          </button>
        )}
        items={items}
        onClose={() => { setOpen(false) }}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'cqaiclub-open-page') openClub()
          else if (id === 'open-settings') { trigger.current?.focus(); openSettings() }
          else if (id === 'login') void run('authorization/start', {}, result => result as DsnAccountSnapshot)
          else if (id === 'cancel-login' && snapshot?.state === 'authorizing') {
            void run('authorization/cancel', { attemptId: snapshot.attemptId }, result => result as DsnAccountSnapshot)
          } else if (id === 'open-login' && snapshot?.state === 'authorizing') {
            void window.open(snapshot.authorizationUrl, '_blank', 'noopener,noreferrer')
          } else if (id === 'logout') {
            void run('session/logout', {}, result => (result as { snapshot: DsnAccountSnapshot }).snapshot)
          } else {
            menuActions.find(action => action.id === id)?.onSelect()
          }
        }}
      />
    </div>
  )
}

function AccountSettingsTab({ t, accountContext: ctx, clubView = false, renderSlot }: Pick<AccountSettingsSectionProps, 't' | 'accountContext'> & Partial<ClubRenderProps> & { readonly clubView?: boolean }) {
  const [snapshot, setSnapshot] = useState<DsnAccountSnapshot>()
  const [activeSection, setActiveSection] = useState<SignedInSection>('account')
  const extensions = useClubExtensions(ctx, t)
  const activeExtension = extensions.find(extension => activeSection === `extension:${extension.id}`)
  const visibleSection = activeSection.startsWith('extension:') && activeExtension === undefined ? 'account' : activeSection
  const sectionFocus = useRemovedSectionFocus(activeSection, visibleSection)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const call = useCallback(async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    return rpcCall<T>(ctx, endpoint, payload)
  }, [ctx])

  useEffect(() => {
    if (activeSection !== visibleSection) setActiveSection(visibleSection)
  }, [activeSection, visibleSection])

  useEffect(() => {
    if (ctx === undefined) return
    let active = true
    const poll = async () => {
      try {
        const next = await rpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {})
        if (active) {
          setSnapshot(next)
          setError(undefined)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, snapshot?.state === 'authorizing' ? 500 : 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [ctx, snapshot?.state])

  const identity = snapshot?.state === 'signed-in'
    ? snapshot.account.platform + ':' + snapshot.account.userId
    : undefined

  useEffect(() => {
    if (identity !== undefined) {
      setActiveSection(active => active.startsWith('extension:') ? active : 'account')
    }
  }, [identity])

  const startLogin = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await call<DsnAccountSnapshot>('authorization/start', {}))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancelLogin = async () => {
    if (snapshot?.state !== 'authorizing') return
    setBusy(true)
    try {
      setSnapshot(await call<DsnAccountSnapshot>('authorization/cancel', { attemptId: snapshot.attemptId }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const refreshAccount = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await call<DsnAccountSnapshot>('account/refresh', {}))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [call])

  const logout = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await call<{ snapshot: DsnAccountSnapshot }>('session/logout', {})
      setSnapshot(result.snapshot)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const message = snapshotMessage(snapshot, t)
  const signedIn = snapshot?.state === 'signed-in' ? snapshot : undefined
  const authorizationUrl = snapshot?.state === 'authorizing' ? snapshot.authorizationUrl : undefined
  const status = statusPresentation(snapshot)
  const openAuthorizationUrl = () => {
    if (authorizationUrl === undefined) return
    void window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={panelStyle} onFocusCapture={sectionFocus.onFocusCapture} onBlurCapture={sectionFocus.onBlurCapture}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, ...(clubView ? { flexWrap: 'wrap' } : {}) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 46, height: 46, flex: 'none', borderRadius: 14, background: 'linear-gradient(145deg, #1268dc, #6047c9)', color: '#fff', boxShadow: '0 8px 22px rgba(40, 91, 200, .24)', fontSize: 15, fontWeight: 750, letterSpacing: '-0.04em' }}>CQ</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ marginBottom: 4, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 11, fontWeight: 650, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{clubView ? t('title') : t('eyebrow')}</div>
            {clubView
              ? <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{t('pointsInfo')}</h1>
              : <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{t('title')}</h2>}
            <p style={{ ...mutedTextStyle, margin: '5px 0 0' }}>{t('description')}</p>
          </div>
        </div>
        <Tag tone={status.tone}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <StateDot state={status.dot} />
            {t(status.key)}
          </span>
        </Tag>
      </div>
      {error !== undefined ? (
        <div role="alert" style={{ padding: '11px 13px', border: '0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #c63131) 35%, transparent)', borderRadius: 10, background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #c63131) 8%, transparent)', color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13, lineHeight: 1.5 }}>{error}</div>
      ) : null}
      {message !== undefined ? (
        <div role="status" style={{ padding: '11px 13px', borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)', color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13, lineHeight: 1.5 }}>{message}</div>
      ) : null}
      {signedIn !== undefined || (!clubView && snapshot !== undefined) ? <SignedInTabs active={visibleSection} setActive={setActiveSection} t={t} hasAccount={signedIn !== undefined} extensions={clubView ? [] : extensions} accountButtonRef={sectionFocus.fallbackButton} /> : null}
      {activeExtension !== undefined && !clubView && renderSlot !== undefined ? renderClubExtension(activeExtension, renderSlot) : snapshot?.state === 'authorizing' ? (
        <div style={cardStyle}>
          <div style={{ display: 'grid', justifyItems: 'center', padding: '38px 30px 26px', textAlign: 'center' }}>
            <div style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, marginBottom: 18, borderRadius: 18, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 11%, transparent)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)' }}><StateDot state="ongoing" size={22} /></div>
            <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.35 }}>{t('waitingTitle')}</h3>
            <p style={{ ...mutedTextStyle, maxWidth: 470, margin: '8px 0 0' }}>{t('waitingDescription')}</p>
            <p style={{ ...mutedTextStyle, maxWidth: 470, margin: '8px 0 0', fontSize: 12 }}>{snapshot.message}</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: '18px 24px', borderTop: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
            <Button variant="primary" icon={<BrowserIcon />} disabled={busy} onClick={openAuthorizationUrl}>{t('openLogin')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { void cancelLogin() }}>{t('cancel')}</Button>
          </div>
        </div>
      ) : signedIn !== undefined && visibleSection === 'account' ? (
        <AccountDetailsCard t={t} snapshot={signedIn} responsive={clubView} busy={busy} refreshAccount={refreshAccount} logout={logout} />
      ) : signedIn !== undefined && visibleSection === 'billing' ? (
        <BillingPanel ctx={ctx} t={t} account={signedIn.account} refreshAccount={refreshAccount} />
      ) : snapshot === undefined ? (
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 150, padding: 28 }} role="status">
          <StateDot state={error === undefined ? 'ongoing' : 'error'} size={14} />
          <span style={mutedTextStyle}>{t(error === undefined ? 'loading' : 'unavailable')}</span>
        </div>
      ) : (
        <AccountConnectCard t={t} busy={busy} startSignIn={startLogin} />
      )}
    </div>
  )
}

function CqaiClubPage({ t, accountContext, viewState, onBack, renderSlot }: ClubPageProps) {
  const active = useSyncExternalStore(viewState.subscribe, viewState.getSnapshot, viewState.getSnapshot)
  const extensions = useClubExtensions(accountContext, t)
  const sections: readonly { readonly id: ClubSection; readonly label: string }[] = [
    { id: 'points', label: t('pointsInfo') },
    { id: 'membership', label: t('membershipInfo') },
    ...extensions.map(extension => ({ id: `extension:${extension.id}` as const, label: extension.label })),
  ]
  const visibleSection = sections.find(section => section.id === active) ?? sections[0]!
  const activeExtension = extensions.find(extension => visibleSection.id === `extension:${extension.id}`)
  const sectionFocus = useRemovedSectionFocus(active, visibleSection.id)
  useEffect(() => {
    if (active !== visibleSection.id) viewState.select(visibleSection.id)
  }, [active, visibleSection.id, viewState])

  return (
    <div className="cqai-club-shell" onFocusCapture={sectionFocus.onFocusCapture} onBlurCapture={sectionFocus.onBlurCapture}>
      <style>{clubPageStyles}</style>
      <nav className="cqai-club-nav" aria-label={t('title')}>
        <button className="cqai-club-back" type="button" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" /></svg>
          {t('back')}
        </button>
        {sections.map(section => (
          <button className="cqai-club-section" key={section.id} type="button" aria-current={visibleSection.id === section.id ? 'page' : undefined}
            ref={section.id === 'points' ? sectionFocus.fallbackButton : undefined}
            onClick={() => viewState.select(section.id)}>{section.label}</button>
        ))}
      </nav>
      <section className="cqai-club-content" aria-label={visibleSection.label}>
        <div className="cqai-club-content-inner">
          {visibleSection.id === 'points'
            ? <AccountSettingsTab t={t} accountContext={accountContext} clubView />
            : activeExtension !== undefined
              ? renderClubExtension(activeExtension, renderSlot)
              : <h1 className="cqai-club-empty-title">{visibleSection.label}</h1>}
        </div>
      </section>
    </div>
  )
}

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cqaiclub-dsn-account: dictionaries')

  const primaryDesktop = isCqaiPrimaryDesktop()
  const modernDesktop = isModernDesktop()
  if (primaryDesktop || modernDesktop) {
    const viewState = createClubViewState()
    ctx.inject(['layout'], scope => {
      scope.slots.inject('main', () => scope.slots.register({
        name: 'main',
        key: CLUB_PANEL,
        locale: NS,
        inject: () => ({ accountContext: ctx, viewState, onBack: () => scope.layout.selectPanel(null) }),
        children: {
          'cqaiclub.club.extension': { kind: 'list', scope: 'root' },
          'cqaiclub.club.activities': { kind: 'list', scope: 'root' },
        },
      }, (props) => <CqaiClubPage {...props} />))
      if (primaryDesktop) scope.slots.inject('settings.launcher', () => scope.slots.register({
        name: 'settings.launcher',
        locale: NS,
        inject: () => ({
          accountContext: ctx,
          openClub: () => { viewState.select('points'); scope.layout.selectPanel(CLUB_PANEL) },
        }),
        children: { 'cqaiclub.account.menu.action': { kind: 'list', scope: 'root' } },
      }, (props) => <CqaiAccountLauncher {...props} />))
      else scope.slots.inject('sidebar.panellist', () => scope.slots.register({
        name: 'sidebar.panellist', id: CLUB_PANEL, order: 45,
        label: () => t('tab'), locale: NS,
      }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <IconUserOutlineMedium size={size} />))
    })
  }
  if (!primaryDesktop) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: NS,
      order: 30,
      label: () => t('tab'),
      locale: NS,
      inject: () => ({ accountContext: ctx }),
      // Modern Desktop already declares these children on its Club panel.
      // The renderer rejects two owners for the same root-scoped slot.
      ...(!modernDesktop ? { children: {
        'cqaiclub.club.extension': { kind: 'list', scope: 'root' },
        'cqaiclub.club.activities': { kind: 'list', scope: 'root' },
      } as const } : {}),
    }, (props) => <AccountSettingsTab {...props} />))
  }

  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'cqaiclub-account',
    order: -50,
    locale: NS,
    inject: () => ({ accountContext: ctx }),
  }, (props) => <CqaiAccountOnboarding {...props} />))

  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'cqaiclub-models',
    order: 10,
  }, () => <CqaiModelsSettingsCard ctx={ctx} t={t} />))
}
