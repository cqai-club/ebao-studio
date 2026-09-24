import { useEffect, useId, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Button, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  API, type CreativeStatement, type Platform, PLATFORM_LABELS,
  type PublisherAccount, type PublisherCapability, type PublisherContent, type PublisherContentType,
} from '../protocol.ts'
import { imageNoteCarouselCss } from './image-note-carousel.tsx'

export const STATEMENT_LABELS: Record<CreativeStatement, string> = {
  none: '不声明',
  ai_generated: '内容由 AI 生成',
  fiction: '虚构演绎，仅供娱乐',
  marketing: '营销推广',
  personal_opinion: '个人观点，仅供参考',
  repost: '转载',
  self_made_no_repost: '自制，禁止转载（仅哔哩哔哩）',
}

export const CONTENT_LABELS: Record<PublisherContentType, string> = {
  article: '文章', 'image-note': '图文', video: '视频',
}

export async function api<T>(action: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API}/${action}`, data === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ejianbao': '1' },
    body: JSON.stringify(data),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('多平台发布服务暂未就绪，请稍候或重启应用')
  }
  const result = await response.json() as { error?: string }
  if (!response.ok) throw new Error(result.error || '请求失败')
  return result as T
}

export async function uploadAsset(contentId: string, file: File): Promise<import('../protocol.ts').PublisherContent> {
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20MB')
  const response = await fetch(`${API}/content-asset-upload/${contentId}`, {
    method: 'POST',
    headers: {
      'x-ejianbao': '1',
      'x-publisher-file-name': encodeURIComponent(file.name),
      'content-type': 'application/octet-stream',
    },
    body: file,
  })
  const result = await response.json() as { error?: string }
  if (!response.ok) throw new Error(result.error || '上传素材失败')
  return result as import('../protocol.ts').PublisherContent
}

export function capabilityMessage(capability: PublisherCapability | undefined): string {
  if (capability === undefined) return '正在检查发布能力…'
  if (capability.supported) return ''
  return capability.message || '当前设备不支持多平台发布'
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败'
}

export function ConfirmDialog({
  contentType, title, sourceName, mode, accounts, targetTitles, onCancel, onConfirm, busy,
}: {
  contentType: PublisherContentType
  title: string
  sourceName?: string
  mode: 'publish' | 'draft'
  accounts: PublisherAccount[]
  targetTitles?: Record<string, string>
  onCancel(): void
  onConfirm(): void
  busy: boolean
}) {
  const submitting = useRef(false)
  useEffect(() => { if (!busy) submitting.current = false }, [busy])
  const close = () => { if (!busy && !submitting.current) onCancel() }
  const submit = () => {
    if (busy || submitting.current) return
    submitting.current = true
    onConfirm()
  }
  return <PublisherModal open title="确认提交" closeLabel="关闭" onClose={close} className="pub-modal" contentClassName="pub-modal-content"
    footer={<>
      <Button variant="outline" data-pub-initial-focus disabled={busy} onClick={close}>返回修改</Button>
      <Button variant="primary" disabled={busy} onClick={submit}>{busy ? '正在校验并提交…' : '确认提交'}</Button>
    </>}>
    <dl className="pub-modal-summary">
      <div><dt>内容类型</dt><dd>{CONTENT_LABELS[contentType]}</dd></div>
      <div><dt>标题</dt><dd>{title}</dd></div>
      {sourceName && <div><dt>视频来源</dt><dd>{sourceName}</dd></div>}
      <div><dt>提交方式</dt><dd>{mode === 'publish' ? '立即发布' : '转存草稿'}</dd></div>
    </dl>
    <div className="pub-modal-target-title">目标账号</div>
    <ul className="pub-modal-accounts">{accounts.map(account => <li key={account.id}><Tag tone="neutral">{PLATFORM_LABELS[account.platform]}</Tag><span>{account.displayName}{targetTitles?.[account.id] && targetTitles[account.id] !== title ? ` · ${targetTitles[account.id]}` : ''}</span></li>)}</ul>
    <p className="pub-modal-copy">提交后请自行前往各平台后台确认结果。</p>
  </PublisherModal>
}

export interface PublisherConfirmation {
  contentId: string
  title: string
  mode: 'publish' | 'draft'
  accounts: PublisherAccount[]
  targetTitles?: Record<string, string>
  sourceName?: string
}

/** The upstream Modal supplies the visual shell; focus stays inside while it is open. */
export function PublisherModal(props: ComponentProps<typeof Modal>) {
  const marker = `pub-focus-${useId().replace(/[^a-z0-9_-]/giu, '')}`
  useLayoutEffect(() => {
    if (!props.open) return
    const dialog = document.getElementsByClassName(marker)[0] as HTMLElement | undefined
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0)
    const initial = dialog.querySelector<HTMLElement>('[data-pub-initial-focus]')
    const firstTarget = initial && !initial.matches(':disabled') ? initial : focusable()[0]
    firstTarget?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (elements.length === 0) { event.preventDefault(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusable()[0]?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      if (previous?.isConnected) previous.focus()
    }
  }, [props.open, marker])
  return <Modal {...props} className={`${props.className ?? ''} ${marker}`}/>
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="pub-card"><h2>{title}</h2>{children}</div>
}

export function DraftToolbar({ contents, draft, busy, dirty, saveError, onSelect, onCreate, onCopy, onDelete }: {
  contents: PublisherContent[]
  draft: PublisherContent | undefined
  busy: boolean
  dirty: boolean
  saveError: string
  onSelect(id: string): void
  onCreate(): void
  onCopy(): void
  onDelete(): void
}) {
  return <div className="pub-drafts">
    <select className="pub-input" aria-label="选择本地草稿" value={draft?.id ?? ''} onChange={event => { if (event.target.value) onSelect(event.target.value) }}>
      <option value="">选择本地草稿</option>
      {contents.map(item => <option key={item.id} value={item.id}>{item.title || '未命名草稿'} · {new Date(item.updatedAt).toLocaleString()}</option>)}
    </select>
    <Button variant="outline" disabled={busy} onClick={onCreate}>新建</Button>
    <Button variant="outline" disabled={busy || !draft} onClick={onCopy}>复制</Button>
    <Button variant="outline" className="pub-danger-action" disabled={busy || !draft} onClick={onDelete}>删除</Button>
    <span className={saveError ? 'pub-warn' : 'pub-muted'} role="status" aria-live="polite">{saveError ? '自动保存失败，请继续编辑以重试' : dirty ? '自动保存中…' : '本地草稿自动保存'}</span>
  </div>
}

export function PlatformAccountSelect({
  idPrefix, platform, accounts, value, onChange,
}: {
  idPrefix: string
  platform: Platform
  accounts: PublisherAccount[]
  value: string
  onChange(id: string): void
}) {
  const id = `pub-target-${idPrefix}-${platform}`
  return <div className="pub-platform"><label htmlFor={id}>{PLATFORM_LABELS[platform]}</label>
    <select className="pub-input" id={id} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">不发布</option>
      {accounts.filter(account => account.platform === platform).map(account =>
        <option key={account.id} value={account.id}>{account.displayName}{account.loginState === 'logged-in' ? '' : '（需检查登录）'}</option>)}
    </select>
  </div>
}

export const css = `
.pub {
  --pub-bg: var(--dsw-alias-bg-base, #fff);
  --pub-surface: var(--dsw-alias-bg-layer-1, #fff);
  --pub-soft: var(--dsw-alias-bg-module-platform, #f5f6f7);
  --pub-text: var(--dsw-alias-label-primary, #111318);
  --pub-secondary-text: var(--dsw-alias-label-secondary, #535961);
  --pub-tertiary-text: var(--dsw-alias-label-tertiary, #777d85);
  --pub-border: var(--dsw-alias-border-l2, #e4e6e9);
  height: 100%; overflow: auto; container-type: inline-size; box-sizing: border-box;
  background: var(--pub-bg); color: var(--pub-text); font-family: var(--dsw-font-family, inherit);
  font-size: 14px; line-height: 1.55;
}
.pub * { box-sizing: border-box; }
.pub :is(.pub-tab, .pub-type, .pub-work, .pub-input) { font: inherit; }
.pub :is(.pub-tab, .pub-type, .pub-work) { cursor: pointer; }
.pub :is(.pub-tab, .pub-type, .pub-work):disabled { opacity: .4; cursor: not-allowed; }
.pub :is(button, input, textarea, select):focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-wrap { max-width: 1200px; margin: auto; padding: 32px 36px 56px; }
.pub-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.pub-head h1 { margin: 0 0 7px; font-size: 24px; line-height: 1.35; font-weight: 600; letter-spacing: -.02em; }
.pub-head h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.4; font-weight: 600; }
.pub-head > .pub-actions { margin-top: 0; }
.pub-head > .pub-actions > select.pub-input { width: auto; min-width: 160px; }
.pub-history-head { display: block; }
.pub-history-head > .pub-history-tools { justify-content: flex-start; margin-top: 14px; }
.pub-history-search { flex: 0 1 320px; min-width: 180px; }
.pub-muted { color: var(--pub-tertiary-text); font-size: 13px; line-height: 1.65; }
.pub-tabs { display: flex; gap: 4px; padding-bottom: 10px; margin-bottom: 24px; border-bottom: 1px solid var(--pub-border); }
.pub-tab { flex: 0 0 auto; min-height: 36px; padding: 7px 14px; border: 0; border-radius: 18px; background: transparent; color: var(--pub-secondary-text); font-weight: 500; }
.pub-tab:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f3f5); color: var(--pub-text); }
.pub-tab[aria-selected=true] { background: var(--dsw-specific-sidebar-nav-item-active, #edf0f3); color: var(--pub-text); font-weight: 600; }
.pub-layout { display: block; min-width: 0; }
.pub-content-panels { min-width: 0; }
.pub-type-nav { display: flex; align-items: center; gap: 4px; width: max-content; max-width: 100%; margin-bottom: 18px; }
.pub-type { flex: 0 0 auto; min-height: 36px; padding: 7px 14px; text-align: center; white-space: nowrap; border: 0; border-radius: 18px; background: transparent; color: var(--pub-secondary-text); font-weight: 500; }
.pub-type:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f3f5); color: var(--pub-text); }
.pub-type[aria-selected=true] { background: var(--dsw-specific-sidebar-nav-item-active, #edf0f3); color: var(--pub-text); font-weight: 600; }
.pub-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .85fr); gap: 18px; }
.pub-grid > div { min-width: 0; }
.pub-card { min-width: 0; padding: 20px; margin-bottom: 18px; border: 1px solid var(--pub-border); border-radius: 16px; background: var(--pub-surface); }
.pub-card h2 { margin: 0 0 16px; font-size: 15px; line-height: 22px; font-weight: 600; }
.pub-card h3 { margin: 18px 0 10px; color: var(--pub-secondary-text); font-size: 13px; font-weight: 600; }
.pub-card h2 + h3 { margin-top: 0; }
.pub-field { margin-bottom: 16px; }
.pub-field label { display: block; margin-bottom: 7px; color: var(--pub-secondary-text); font-size: 13px; font-weight: 500; }
.pub-input { width: 100%; min-height: 36px; padding: 8px 11px; border: 1px solid var(--pub-border); border-radius: 8px; outline: none; background: var(--pub-surface); color: var(--pub-text); }
.pub-input-wrap, .pub-text-input { width: 100%; min-width: 0; }
.pub-input::placeholder { color: var(--pub-tertiary-text); }
.pub-input:focus { border-color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub textarea.pub-input { min-height: 110px; resize: vertical; line-height: 1.65; }
.pub-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.pub-error { padding: 12px 14px; margin-bottom: 16px; border: 1px solid var(--pub-border); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 8%, var(--pub-surface)); color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 13px; line-height: 1.6; }
.pub-tip { position: fixed; z-index: 1100; top: 24px; left: 50%; transform: translateX(-50%); width: max-content; max-width: min(480px, calc(100vw - 32px)); padding: 12px 16px; border: 1px solid var(--pub-border); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, var(--pub-surface)); box-shadow: var(--dsw-elevation-prominent, 0 14px 36px #0003); color: var(--pub-text); font-size: 13px; line-height: 1.6; text-align: center; overflow-wrap: anywhere; pointer-events: none; }
.pub-tip-success { border-color: var(--dsw-alias-state-success-primary, #16a34a); }
.pub-tip-error { border-color: var(--dsw-alias-state-error-primary, #dc2626); }
.pub-empty { padding: 30px 16px; border: 1px dashed var(--pub-border); border-radius: 10px; background: var(--pub-soft); color: var(--pub-tertiary-text); font-size: 13px; line-height: 1.8; text-align: center; }
.pub-submission strong, .pub-work strong { overflow-wrap: anywhere; }
.pub-status { white-space: nowrap; }
.pub-account-layout { grid-template-columns: minmax(0, 1.4fr) minmax(320px, .85fr); }
.pub-account-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; }
.pub-account-list-head h2 { margin: 0; font-size: 18px; font-weight: 600; }
.pub-account-list-head p { margin: 2px 0 0; }
.pub-account-cards { display: grid; gap: 12px; }
.pub-account-card { min-width: 0; padding: 17px 18px 14px; border: 1px solid var(--pub-border); border-radius: 14px; background: var(--pub-surface); }
.pub-account-card-head { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 12px; min-width: 0; }
.pub-account-icon { width: 44px; height: 44px; }
.pub-account-identity { display: grid; gap: 3px; min-width: 0; }
.pub-account-identity strong { color: var(--pub-text); font-size: 15px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.pub-account-identity span { color: var(--pub-tertiary-text); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.pub-account-card .pub-status { align-self: start; }
.pub-account-error { margin: 12px 0 0 56px; color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.pub-account-card-actions { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--pub-border); }
.pub-account-card-actions > :last-child { margin-left: auto; }
.pub-warn { color: var(--dsw-alias-state-warn-label, #b7790a); }
.pub-platform { display: grid; grid-template-columns: 95px minmax(0, 1fr); align-items: center; gap: 12px; margin-bottom: 12px; }
.pub-platform label { color: var(--pub-secondary-text); font-size: 13px; }
.pub-work { display: block; width: 100%; padding: 13px; margin-bottom: 9px; border: 1px solid var(--pub-border); border-radius: 10px; background: var(--pub-surface); color: var(--pub-text); text-align: left; }
.pub-work:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f3f5); }
.pub-work[aria-pressed=true] { border-color: var(--dsw-alias-state-business-primary, #4176e6); background: var(--dsw-alias-state-business-tertiary, #edf3fe); }
.pub-work strong, .pub-work small { display: block; }
.pub-work small { margin-top: 5px; color: var(--pub-tertiary-text); }
.pub-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.pub-mode { display: flex; gap: 10px; }
.pub-mode label { flex: 1; padding: 12px; border: 1px solid var(--pub-border); border-radius: 10px; font-size: 13px; cursor: pointer; }
.pub-mode label:has(input:checked) { border-color: var(--dsw-alias-state-business-primary, #4176e6); background: var(--dsw-alias-state-business-tertiary, #edf3fe); }
.pub-mode input { margin-right: 7px; accent-color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub-submit { width: 100%; min-height: 42px; }
.pub-submission { padding: 14px 0; border-bottom: 1px solid var(--pub-border); }
.pub-submission:last-child { border-bottom: 0; }
.pub-submission-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.pub-submission-head > div { min-width: 0; }
.pub-submission-head strong { display: block; }
.pub-submission-head small { display: block; margin-top: 4px; }
.pub-history-result { margin: 6px 0 0; overflow-wrap: anywhere; }
.pub-history-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pub-history-page-actions { display: flex; gap: 8px; }
.pub-history-acknowledge { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; cursor: pointer; }
.pub-history-acknowledge input { flex: none; margin: 3px 0 0; accent-color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub-targets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.pub-import { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--pub-border); }
.pub-count { margin-right: 8px; color: var(--dsw-alias-state-business-primary, #4176e6); font: 12px var(--ds-font-family-code, monospace); letter-spacing: .04em; }
.pub-modal, .pub-modal-account { width: min(480px, 100%); max-height: min(90vh, 640px); color: var(--dsw-alias-label-primary); }
.pub-modal-content { min-height: 0; overflow-y: auto; }
.pub-modal-summary { display: grid; gap: 10px; margin: 0 0 18px; }
.pub-modal-summary > div { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 10px; }
.pub-modal-summary dt, .pub-modal-target-title, .pub-modal-label { color: var(--dsw-alias-label-secondary); font-size: 13px; }
.pub-modal-summary dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.pub-modal-target-title { margin-bottom: 8px; }
.pub-modal-accounts { display: grid; gap: 8px; max-height: 180px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.pub-modal-accounts li { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pub-modal-accounts li span:last-child { overflow-wrap: anywhere; }
.pub-modal-copy { margin: 16px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.pub-modal-field { display: grid; gap: 8px; min-width: 0; }
.pub-modal-field > :last-child { width: 100%; }
.pub-danger-action { color: var(--dsw-alias-state-error-primary) !important; }
.pub-danger-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger) !important; }
.pub-modal :is(button, input):focus-visible, .pub-modal-account :is(button, input):focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.pub-drafts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.pub-drafts select { max-width: 280px; }
.pub-editor { min-height: 340px !important; font-family: var(--ds-font-family-code, monospace) !important; }
.pub-version-card { padding-bottom: 14px; }
.pub-version-card .pub-muted { margin: 10px 0 0; }
.pub-version-card > button { margin-top: 10px; }
.pub-version-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 3px; }
.pub-version-tab { flex: 0 0 auto; padding: 8px 12px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); color: var(--pub-secondary-text); font-size: 13px; cursor: pointer; }
.pub-version-tab[aria-pressed=true] { border-color: var(--dsw-alias-state-business-primary, #4176e6); background: var(--dsw-alias-state-business-tertiary, #edf3fe); color: var(--pub-text); font-weight: 600; }
.pub-version-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-content-view-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.pub-content-preview-shell { width: 100%; max-width: 460px; min-height: 500px; margin: 0 auto; padding: 26px 22px; border: 1px solid var(--pub-border); border-radius: 20px; background: var(--pub-surface); box-shadow: 0 12px 34px #0000000d; overflow-wrap: anywhere; }
.pub-content-preview-title { margin: 0 0 18px; color: var(--pub-text); font-size: 22px; line-height: 1.4; font-weight: 700; }
.pub-content-preview-cover { display: block; width: 100%; max-height: 320px; margin-bottom: 18px; border-radius: 12px; object-fit: cover; }
.pub-content-preview-note-images { display: grid; gap: 12px; margin-bottom: 20px; }
.pub-content-preview-image { display: block; width: 100%; max-height: 560px; border-radius: 12px; object-fit: contain; background: var(--pub-soft); }
.pub-content-preview-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; color: var(--dsw-alias-state-business-primary, #4176e6); font-size: 13px; }
.pub-content-preview-text { white-space: pre-wrap; line-height: 1.7; }
.pub-preview-summary { margin: 15px auto 0; max-width: 460px; padding: 12px; border-radius: 8px; background: var(--pub-soft); color: var(--pub-secondary-text); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.pub-preview-summary strong { color: var(--pub-text); }
.pub-content-preview-wechat { color: #252b32; font-size: 16px; line-height: 1.8; word-break: break-word; }
.pub-content-preview-wechat .pub-preview { line-height: 1.8; }
.pub-content-preview-wechat .pub-preview h1 { margin: 24px 0 14px; color: #1f2937; font-size: 24px; line-height: 1.4; font-weight: 700; }
.pub-content-preview-wechat .pub-preview h2 { margin: 22px 0 12px; color: #1f2937; font-size: 20px; line-height: 1.4; font-weight: 700; }
.pub-content-preview-wechat .pub-preview h3 { margin: 20px 0 10px; color: #1f2937; font-size: 18px; line-height: 1.4; font-weight: 700; }
.pub-content-preview-wechat .pub-preview p { margin: 0 0 16px; }
.pub-content-preview-wechat .pub-preview blockquote { margin: 16px 0; padding: 8px 12px; border-left: 3px solid #2c78e4; background: #f5f8fc; color: #5b6472; }
.pub-content-preview-wechat .pub-preview img { display: block; width: 100%; max-width: 100%; height: auto; margin: 16px auto; }
.pub-content-view-tabs .pub-actions { margin-top: 0; }
.pub-content-preview-shell .pub-preview { min-height: 0; padding: 0; border: 0; border-radius: 0; }
${imageNoteCarouselCss}
.pub-preview { min-height: 340px; padding: 14px; border: 1px solid var(--pub-border); border-radius: 9px; background: var(--pub-surface); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.pub-preview h1, .pub-preview h2, .pub-preview h3 { margin: 14px 0 8px; }
.pub-preview p { margin: 0 0 12px; }
.pub-preview code { padding: 1px 4px; border-radius: 4px; background: var(--dsw-alias-markdown-inline-code, #f4f4f5); }
.pub-preview pre { padding: 12px; overflow: auto; border-radius: 8px; background: var(--dsw-alias-markdown-code-block, #f9fafb); }
.pub-preview pre code { padding: 0; background: none; }
.pub-preview blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--pub-border); color: var(--pub-secondary-text); }
.pub-preview hr { margin: 18px 0; border: 0; border-top: 1px solid var(--pub-border); }
.pub-assets { display: flex; gap: 8px; flex-wrap: wrap; }
.pub-no-cover { display: inline-flex; align-items: center; gap: 5px; margin: 0 0 12px; color: var(--pub-secondary-text); font-size: 13px; }
.pub-asset { width: 130px; padding: 8px; border: 1px solid var(--pub-border); border-radius: 9px; }
.pub-asset[draggable=true] { cursor: grab; }
.pub-asset-dragging { opacity: .5; }
.pub-asset img { width: 100%; height: 95px; border-radius: 5px; object-fit: cover; }
.pub-asset small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pub-asset .pub-actions { margin-top: 5px; }
@container (max-width: 900px) { .pub-grid { grid-template-columns: 1fr; } }
@container (max-width: 640px) {
  .pub-wrap { padding: 20px 16px 40px; }
  .pub-type-nav { width: 100%; overflow-x: auto; }
  .pub-account-list-head { align-items: flex-start; }
  .pub-account-card-head { grid-template-columns: 44px minmax(0, 1fr); }
  .pub-account-card-head .pub-status { grid-column: 2; justify-self: start; }
  .pub-account-error { margin-left: 0; }
  .pub-platform { grid-template-columns: 80px minmax(0, 1fr); }
  .pub-tabs { overflow-x: auto; white-space: nowrap; }
  .pub-head { flex-wrap: wrap; }
  .pub-history-tools { width: 100%; }
  .pub-history-search { flex: 1 1 100%; min-width: 0; }
}
`
