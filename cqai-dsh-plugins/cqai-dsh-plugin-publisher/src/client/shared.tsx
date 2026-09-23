import type { ReactNode } from 'react'
import {
  API, type CreativeStatement, type Platform, PLATFORM_LABELS,
  type PublisherAccount, type PublisherCapability, type PublisherContentType,
} from '../protocol.ts'

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
  contentType, title, sourceName, mode, accounts, onCancel, onConfirm, busy,
}: {
  contentType: PublisherContentType
  title: string
  sourceName?: string
  mode: 'publish' | 'draft'
  accounts: PublisherAccount[]
  onCancel(): void
  onConfirm(): void
  busy: boolean
}) {
  return <div className="pub-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <div className="pub-dialog" role="dialog" aria-modal="true" aria-label="确认提交">
      <h2>确认提交</h2>
      <p><strong>内容类型：</strong>{CONTENT_LABELS[contentType]}</p>
      <p><strong>标题：</strong>{title}</p>
      {sourceName && <p><strong>视频来源：</strong>{sourceName}</p>}
      <p><strong>提交方式：</strong>{mode === 'publish' ? '立即发布' : '转存草稿'}</p>
      <p><strong>目标账号：</strong></p>
      <ul>{accounts.map(account => <li key={account.id}>{PLATFORM_LABELS[account.platform]} · {account.displayName}</li>)}</ul>
      <p className="pub-muted">提交后请自行前往各平台后台确认结果。</p>
      <div className="pub-actions pub-dialog-actions">
        <button className="pub-secondary" disabled={busy} onClick={onCancel}>返回修改</button>
        <button className="pub-primary" disabled={busy} onClick={onConfirm}>{busy ? '正在校验并提交…' : '确认提交'}</button>
      </div>
    </div>
  </div>
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="pub-card"><h2>{title}</h2>{children}</div>
}

export function PlatformAccountSelect({
  platform, accounts, value, onChange,
}: {
  platform: Platform
  accounts: PublisherAccount[]
  value: string
  onChange(id: string): void
}) {
  return <div className="pub-platform"><label htmlFor={`pub-target-${platform}`}>{PLATFORM_LABELS[platform]}</label>
    <select className="pub-input" id={`pub-target-${platform}`} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">不发布</option>
      {accounts.filter(account => account.platform === platform).map(account =>
        <option key={account.id} value={account.id}>{account.displayName}{account.loginState === 'logged-in' ? '' : '（需检查登录）'}</option>)}
    </select>
  </div>
}

export const css = `
.pub{height:100%;overflow:auto;color:var(--foreground,#ededf0);background:var(--background,#151517);font-family:inherit;container-type:inline-size;box-sizing:border-box}
.pub *{box-sizing:border-box}.pub button,.pub input,.pub textarea,.pub select{font:inherit}.pub button{cursor:pointer}.pub button:disabled{opacity:.45;cursor:not-allowed}
.pub-wrap{max-width:1280px;margin:auto;padding:28px 32px 52px}.pub-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px}
.pub-head h1{font-size:26px;margin:0 0 8px;letter-spacing:-1px}.pub-muted{font-size:13px;color:#9b9ba4;line-height:1.7}
.pub-tabs{display:flex;gap:6px;border-bottom:1px solid #ffffff20;margin-bottom:22px}.pub-tab{border:0;background:none;color:#aaaab4;padding:12px 18px;border-bottom:2px solid transparent}.pub-tab[aria-selected=true]{color:#d6c7ff;border-bottom-color:#aa90fb;font-weight:650}
.pub-layout{display:grid;grid-template-columns:128px minmax(0,1fr);gap:20px}.pub-type-nav{display:flex;flex-direction:column;gap:6px}.pub-type{width:100%;text-align:left;border:1px solid transparent;background:none;color:#b9b9c2;padding:12px;border-radius:9px}.pub-type[aria-current=true]{border-color:#a78bfa50;background:#a78bfa16;color:#dbcfff;font-weight:650}
.pub-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.85fr);gap:18px}.pub-card{border:1px solid #ffffff18;background:#ffffff04;border-radius:15px;padding:20px;margin-bottom:18px}.pub-card h2{font-size:15px;margin:0 0 16px}.pub-card h3{font-size:13px;color:#c9c9d0;margin:18px 0 10px}.pub-card h2+h3{margin-top:0}
.pub-field{margin-bottom:16px}.pub-field label{display:block;font-size:13px;margin-bottom:7px;color:#c9c9d0}.pub-input{width:100%;padding:10px 12px;border:1px solid #ffffff25;border-radius:9px;background:#08080c55;color:inherit;outline:none}.pub-input:focus{border-color:#a78bfa}.pub textarea.pub-input{min-height:110px;resize:vertical;line-height:1.7}
.pub-primary,.pub-secondary,.pub-danger{border-radius:9px;padding:9px 13px}.pub-primary{border:0;background:#b8a1ff;color:#171020;font-weight:650}.pub-secondary{border:1px solid #ffffff24;background:#ffffff06;color:inherit}.pub-danger{border:1px solid #ff777744;background:#ff77770d;color:#ffb6b6}
.pub-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.pub-error{border-radius:9px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.6;color:#ffb6b6;background:#ff666614;border:1px solid #ff66662a}
.pub-tip{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:1100;width:max-content;max-width:min(480px,calc(100vw - 32px));padding:12px 16px;border-radius:10px;box-shadow:0 14px 36px #0007;font-size:13px;line-height:1.6;text-align:center;overflow-wrap:anywhere;pointer-events:none}.pub-tip-success{color:#def9e9;background:#23583f;border:1px solid #62ce95}.pub-tip-error{color:#ffe2e2;background:#6b2930;border:1px solid #f68c95}
.pub-empty{text-align:center;padding:30px 16px;border:1px dashed #ffffff24;border-radius:11px;color:#9f9fa9;font-size:13px;line-height:1.8}.pub-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #ffffff12}.pub-row:last-child{border-bottom:0}.pub-row strong{font-size:14px}.pub-row small{display:block;color:#92929c;margin-top:5px}
.pub-status{font-size:12px;white-space:nowrap}.pub-ok{color:#83d2aa}.pub-warn{color:#f0c682}.pub-platform{display:grid;grid-template-columns:95px minmax(0,1fr);align-items:center;gap:12px;margin-bottom:12px}
.pub-work{display:block;width:100%;text-align:left;border:1px solid #ffffff1d;background:#ffffff04;color:inherit;border-radius:10px;padding:13px;margin-bottom:9px}.pub-work[aria-pressed=true]{border-color:#a78bfa88;background:#a78bfa14}.pub-work strong,.pub-work small{display:block}.pub-work small{color:#92929c;margin-top:5px}
.pub-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pub-tag{padding:3px 8px;border:1px solid #a78bfa34;background:#a78bfa12;color:#cbbdff;border-radius:99px;font-size:11px}
.pub-mode{display:flex;gap:10px}.pub-mode label{flex:1;border:1px solid #ffffff20;border-radius:10px;padding:12px;font-size:13px}.pub-mode input{accent-color:#a78bfa;margin-right:7px}.pub-submit{width:100%;padding:13px 18px}
.pub-submission{padding:14px 0;border-bottom:1px solid #ffffff12}.pub-submission:last-child{border-bottom:0}.pub-targets{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.pub-target{font-size:11px;border:1px solid #ffffff20;border-radius:99px;padding:4px 8px;background:#ffffff04;color:inherit}.pub-import{margin-top:18px;border-top:1px solid #ffffff14;padding-top:18px}.pub-count{color:#bca8fa;font:12px monospace;letter-spacing:.5px;margin-right:8px}
.pub-dialog-backdrop{position:fixed;inset:0;z-index:1000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}.pub-dialog{width:min(480px,100%);max-height:90vh;overflow:auto;background:#232129;border:1px solid #ffffff30;border-radius:16px;padding:24px;box-shadow:0 20px 70px #0008}.pub-dialog h2{margin:0 0 18px}.pub-dialog p{margin:10px 0}.pub-dialog ul{padding-left:24px;max-height:180px;overflow:auto}.pub-dialog-actions{justify-content:flex-end}
.pub-drafts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.pub-drafts select{max-width:280px}.pub-editor{min-height:340px!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace!important}.pub-preview{min-height:340px;padding:14px;border:1px solid #ffffff20;border-radius:9px;white-space:pre-wrap;line-height:1.65;overflow-wrap:anywhere}.pub-preview h1,.pub-preview h2,.pub-preview h3{margin:14px 0 8px}.pub-preview p{margin:0 0 12px}.pub-preview pre{overflow:auto;background:#0005;padding:12px;border-radius:8px}.pub-assets{display:flex;gap:8px;flex-wrap:wrap}.pub-asset{width:130px;border:1px solid #ffffff20;padding:8px;border-radius:9px}.pub-asset img{width:100%;height:95px;object-fit:cover;border-radius:5px}.pub-asset small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pub-asset .pub-actions{margin-top:5px}.pub-asset button{padding:3px 6px;font-size:11px}
@container(max-width:900px){.pub-grid{grid-template-columns:1fr}}@container(max-width:640px){.pub-wrap{padding:20px 16px}.pub-layout{grid-template-columns:1fr}.pub-type-nav{flex-direction:row}.pub-type{width:auto}.pub-row{align-items:flex-start;flex-direction:column}.pub-platform{grid-template-columns:80px minmax(0,1fr)}.pub-tabs{overflow-x:auto;white-space:nowrap}}
`
