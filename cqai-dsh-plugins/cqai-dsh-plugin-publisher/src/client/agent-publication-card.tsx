import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPublicationRequest, ConfirmAgentPublicationChoices } from '../agent-publication-protocol.ts'
import {
  API, PLATFORM_LABELS, projectContentForPlatform, type Platform, type PublisherAccount, type PublisherMode,
} from '../protocol.ts'
import { articleSubmissionWarnings, contentSubmissionError } from '../submission-validation.ts'
import { displayArticleWarnings, isOperationTimeout, isToutiaoOnly, projectSubmissionForDisplay } from '../submission-display.ts'
import { PublisherContentPreview } from './content-preview.tsx'
import { contentPreviewCss } from './content-preview-style.ts'
import { api, CONTENT_LABELS, errorMessage, STATEMENT_LABELS } from './shared.tsx'

type PublicationToolProps = PropsRuntime<'tool.call.toolview'>
type ResultEnvelope = { isError?: boolean; content: readonly { type: string; text?: string }[] }
const FIELD_LABELS: Record<string, string> = { category: '分类', topic: '话题', original: '原创声明' }
const STYLE_OWNER = 'cqai-dsh-plugin-publisher'
const STYLE_ID = `${STYLE_OWNER}/agent-publication-card`

/** A persisted tool result locates a request; the server owns its current state. */
export function parseAgentPublicationRequestId(result: ResultEnvelope): string | null {
  if (result.isError) return null
  for (const item of result.content) {
    if (item.type !== 'text' || typeof item.text !== 'string') continue
    try {
      const value: unknown = JSON.parse(item.text)
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      const id = record.request_id ?? record.requestId
      if (typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(id)) return id
    } catch { /* Other tool text does not authorize a publication card. */ }
  }
  return null
}

export function AgentPublicationToolView(props: PublicationToolProps) {
  if (props.phase !== 'result') return <div className="pub-agent-publication-wait" role="status">正在准备发布确认…</div>
  const requestId = parseAgentPublicationRequestId(props.block)
  if (!requestId) return <div className="pub-agent-publication-wait" role="alert">{props.block.isError
    ? '发布确认准备失败，请让 Agent 检查内容后重新准备。'
    : '未收到有效的发布确认请求，请让 Agent 重新准备。'}</div>
  return <div className="pub-agent-publication-wait" role="status">已准备发布确认，请在本轮回复下方核对后确认。</div>
}

function onlyToutiao(request: AgentPublicationRequest): boolean {
  return isToutiaoOnly(request.submission ? request.submission.targets.map(target => target.platform)
    : request.requestedPlatforms.length ? request.requestedPlatforms
      : request.accounts.filter(account => request.accountIds.includes(account.id)).map(account => account.platform))
}

function statusLabel(request: AgentPublicationRequest, uncertain: boolean, cancellation: boolean): string {
  if (uncertain) return onlyToutiao(request) ? cancellation ? '取消未完成' : '提交未完成'
    : cancellation ? '取消结果待确认' : '提交结果待确认'
  switch (request.state) {
    case 'awaiting-confirmation': return '待你确认'
    case 'submitting': return '正在提交'
    case 'cancelled': return '已取消本次发布'
    case 'stale': return '内容已更新，需重新准备'
    case 'uncertain': return onlyToutiao(request) ? '提交未完成' : '提交结果待确认'
    case 'submitted':
      switch (request.submission?.state) {
        case 'queued': return '已进入本机提交队列'
        case 'running': return '本机任务正在执行'
        case 'completed': return '本机执行完成，请到平台后台核对'
        case 'failed': return '本机执行失败'
        default: return onlyToutiao(request) ? '任务未完成' : '已受理，执行结果待确认'
      }
  }
}

function accountProblem(request: AgentPublicationRequest, account: PublisherAccount, mode: PublisherMode): string | undefined {
  if (account.loginState !== 'logged-in') return account.loginState === 'logged-out' ? '未登录' : '登录状态未确认'
  const warnings = articleSubmissionWarnings(request.content, [account], request.capabilities)
  const effectiveMode = request.content.contentType === 'article' && warnings.length > 0 ? 'draft' : mode
  const capability = request.capabilities.find(item => item.platform === account.platform)
  if (!capability?.contentTypes.includes(request.content.contentType)) return '暂不支持此内容类型'
  if (!capability.modes[request.content.contentType]?.includes(effectiveMode)) return '暂不支持此提交方式'
  return undefined
}

function initialAccountIds(request: AgentPublicationRequest): string[] {
  const platforms = new Set<Platform>()
  return request.accountIds.filter(id => {
    const account = request.accounts.find(item => item.id === id)
    if (!account || platforms.has(account.platform)) return false
    platforms.add(account.platform)
    return true
  })
}

function videoProblems(request: AgentPublicationRequest, accounts: PublisherAccount[]): string[] {
  const content = request.content
  const problems: string[] = []
  if (!content.title.trim()) problems.push('请填写标题')
  if (!content.videoSource) problems.push('请先选择一条 e剪宝成片或一个本地视频')
  if (accounts.length === 0) problems.push('请至少选择一个发布账号')
  for (const account of accounts) {
    const capability = request.capabilities.find(item => item.platform === account.platform)
    const limit = capability?.maxTitleLength?.video
    if (limit !== undefined && content.title.length > limit) problems.push(`${PLATFORM_LABELS[account.platform]}标题不能超过 ${limit} 字`)
    for (const field of capability?.requiredFields.video ?? []) {
      const value = content.platformFields[account.platform]?.[field]
        ?? (content as unknown as Record<string, unknown>)[field]
      if (typeof value !== 'string' || !value.trim()) problems.push(`请填写${PLATFORM_LABELS[account.platform]}的${FIELD_LABELS[field] ?? field}`)
    }
  }
  return problems
}

export function AgentPublicationCard({ sessionId, requestId }: { sessionId: string; requestId: string }) {
  const id = useId()
  const [request, setRequest] = useState<AgentPublicationRequest>()
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [mode, setMode] = useState<PublisherMode>('draft')
  const [preview, setPreview] = useState<'master' | Platform>('master')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [pendingAction, setPendingAction] = useState<'confirm' | 'cancel'>()
  const [error, setError] = useState('')
  const alive = useRef(false)
  const operation = useRef(false)
  const responseGeneration = useRef(0)
  const outcomePending = useRef(false)
  const requestRef = useRef<AgentPublicationRequest>()
  const receive = useCallback((value: AgentPublicationRequest, resetChoices: boolean) => {
    if (value.sessionId !== sessionId || value.requestId !== requestId) throw new Error('发布请求与当前对话不匹配')
    const display = { ...value, warnings: displayArticleWarnings(value.warnings),
      ...(value.submission ? { submission: projectSubmissionForDisplay(value.submission) } : {}) }
    requestRef.current = display
    setRequest(display)
    if (resetChoices || value.state !== 'awaiting-confirmation') {
      setAccountIds(initialAccountIds(value))
      setMode(value.mode)
    }
    setUncertain(false)
    setPendingAction(undefined)
    outcomePending.current = value.state !== 'awaiting-confirmation'
  }, [sessionId, requestId])
  const refresh = useCallback(async (initial = false) => {
    if (operation.current && !initial) return
    operation.current = true
    const generation = ++responseGeneration.current
    setLoading(true)
    setError('')
    try {
      const value = await api<AgentPublicationRequest>(`agent-publication/${encodeURIComponent(sessionId)}/${encodeURIComponent(requestId)}`)
      if (alive.current && generation === responseGeneration.current) receive(value, initial)
    } catch (cause) {
      if (alive.current && generation === responseGeneration.current) setError(errorMessage(cause))
    } finally {
      if (generation === responseGeneration.current) {
        operation.current = false
        if (alive.current) setLoading(false)
      }
    }
  }, [sessionId, requestId, receive])
  useEffect(() => {
    alive.current = true
    void refresh(true)
    return () => { alive.current = false; responseGeneration.current += 1 }
  }, [refresh])
  useEffect(() => {
    if (uncertain || request?.state !== 'submitted'
      || (request.submission?.state !== 'queued' && request.submission?.state !== 'running')) return
    const timer = setInterval(() => { void refresh() }, 4000)
    return () => clearInterval(timer)
  }, [request?.state, request?.submission?.state, uncertain, refresh])

  const selectedAccounts = request?.accounts.filter(account => accountIds.includes(account.id)) ?? []
  const warnings = request && !request.submission ? articleSubmissionWarnings(request.content, selectedAccounts, request.capabilities) : []
  const effectiveMode = request?.submission?.mode
    ?? (request?.content.contentType === 'article' && warnings.length > 0 ? 'draft' : mode)
  const problems = request ? [
    ...request.requestedPlatforms.filter(platform => !selectedAccounts.some(account => account.platform === platform))
      .map(platform => `请为${PLATFORM_LABELS[platform]}选择一个账号`),
    ...selectedAccounts.filter(account => request.requestedPlatforms.length > 0 && !request.requestedPlatforms.includes(account.platform))
      .map(account => `本次请求未包含${PLATFORM_LABELS[account.platform]}，请取消该账号或让 Agent 重新准备目标平台`),
    ...selectedAccounts.flatMap(account => {
      const problem = accountProblem(request, account, effectiveMode)
      return problem ? [`${PLATFORM_LABELS[account.platform]} · ${account.displayName}：${problem}`] : []
    }),
    ...(request.content.contentType === 'video' ? videoProblems(request, selectedAccounts)
      : [contentSubmissionError(request.content, selectedAccounts, request.capabilities, effectiveMode)].filter((value): value is string => !!value)),
  ] : []
  const editable = !!request && request.state === 'awaiting-confirmation' && !uncertain && !outcomePending.current && !busy && !loading
  const ready = editable && selectedAccounts.length > 0 && problems.length === 0
  const changeAccount = (platform: Platform, accountId: string) => {
    if (!editable) return
    setAccountIds(previous => [
      ...previous.filter(existing => request!.accounts.find(account => account.id === existing)?.platform !== platform),
      ...(accountId ? [accountId] : []),
    ])
    setError('')
  }
  const mutate = async (action: 'confirm' | 'cancel') => {
    if (operation.current || outcomePending.current || !requestRef.current || requestRef.current.state !== 'awaiting-confirmation') return
    if (action === 'confirm' && !ready) return
    operation.current = true
    outcomePending.current = true
    setBusy(true)
    setPendingAction(action)
    setError('')
    const choices: ConfirmAgentPublicationChoices = { accountIds: [...accountIds], mode: effectiveMode }
    const generation = ++responseGeneration.current
    try {
      const value = await api<AgentPublicationRequest>(`agent-publication-${action}`, {
        sessionId, requestId, ...(action === 'confirm' ? choices : {}),
      })
      if (alive.current && generation === responseGeneration.current) receive(value, true)
    } catch (cause) {
      if (alive.current && generation === responseGeneration.current) {
        setUncertain(true)
        setError(onlyToutiao(requestRef.current!)
          ? isOperationTimeout(errorMessage(cause)) ? '操作超时，任务未完成' : `${action === 'confirm' ? '提交' : '取消'}未完成：${errorMessage(cause)}。请从发布历史打开平台稿件核对。`
          : `${action === 'confirm' ? '提交' : '取消'}响应未确认：${errorMessage(cause)}。请刷新本次请求状态后核对。`)
      }
    } finally {
      if (generation === responseGeneration.current) {
        operation.current = false
        if (alive.current) setBusy(false)
      }
    }
  }

  if (!request) return <section className="pub-agent-publication" aria-label="Agent 发布确认" aria-busy={loading}>
    <style data-plugin={STYLE_OWNER} data-plugin-css={STYLE_ID}>{cardCss}</style><strong>发布确认</strong>
    {loading ? <p role="status">正在加载本次发布请求…</p> : <>
      <p className="pub-agent-publication-error" role="alert">无法加载发布请求：{error}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => void refresh(true)}>重新加载确认请求</Button>
    </>}
  </section>
  const submission = request.submission
  const platforms = [...new Set(submission ? submission.targets.map(target => target.platform)
    : request.requestedPlatforms.length > 0 ? request.requestedPlatforms : request.accounts.map(account => account.platform))]
  const previewPlatforms = [...new Set([...platforms, ...Object.keys(request.content.platformVariants ?? {}) as Platform[]])]
  const previewContent = preview === 'master' ? request.content : projectContentForPlatform(request.content, preview)
  const videoSource = previewContent.videoSource
  const videoPreviewUrl = videoSource && `${API}/video-preview/${videoSource.kind}/${encodeURIComponent(videoSource.kind === 'work' ? videoSource.workId : videoSource.localVideoId)}`
  const videoSourceName = videoSource?.kind === 'local' ? videoSource.fileName : videoSource ? 'e剪宝成片' : undefined
  const sameServerAccounts = [...accountIds].sort().join('\u0000') === [...request.accountIds].sort().join('\u0000')
  const allWarnings = [...new Set([...(sameServerAccounts ? request.warnings : []), ...warnings])]
  return <section className="pub-agent-publication" aria-label="Agent 发布确认" aria-busy={busy || loading}>
    <style data-plugin={STYLE_OWNER} data-plugin-css={STYLE_ID}>{cardCss}</style>
    <header><strong>发布确认</strong><span role="status" aria-live="polite">{busy
      ? pendingAction === 'cancel' ? '正在取消…' : '正在提交…'
      : statusLabel(request, uncertain, pendingAction === 'cancel')}</span></header>
    <p className="pub-agent-publication-title">{CONTENT_LABELS[request.content.contentType]} · {submission?.title || request.content.title || '未填写标题'}</p>
    <details className="pub-agent-publication-preview" open>
      <summary>内容预览 · 第 {request.content.revision} 版</summary>
      <p className="pub-agent-publication-notes">{submission
        ? '预览展示提交时的本地内容结构，已执行的平台调整见下方记录；最终以平台后台实际显示为准。'
        : '预览展示本地主稿和平台版本，下方列出的调整将在提交时处理；最终以平台后台实际显示为准。'}</p>
      <label htmlFor={`${id}-preview`}>预览版本</label>
      <select id={`${id}-preview`} value={preview} onChange={event => setPreview(event.target.value as 'master' | Platform)}>
        <option value="master">主稿</option>
        {previewPlatforms.map(platform => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}{request.content.platformVariants?.[platform] ? ' · 平台版本' : ' · 跟随主稿'}</option>)}
      </select>
      <div className="pub-agent-publication-preview-body"><PublisherContentPreview content={previewContent} platform={preview === 'master' ? undefined : preview}
        videoSourceName={videoSourceName} videoPreviewUrl={videoPreviewUrl}/></div>
      {preview !== 'tt' && previewContent.summary && <p className="pub-agent-publication-summary"><strong>摘要</strong>{previewContent.summary}</p>}
      <dl className="pub-agent-publication-metadata">
        <div><dt>内容声明</dt><dd>{STATEMENT_LABELS[previewContent.creativeStatement]}</dd></div>
        {previewContent.contentType === 'video' && <div><dt>视频号短标题</dt><dd>{previewContent.shortTitle || '未填写'}</dd></div>}
        <div><dt>图片素材</dt><dd>{previewContent.assets.length ? previewContent.assets.map(asset => asset.name).join('、') : '无'}</dd></div>
        {preview !== 'master' && Object.entries(previewContent.platformFields[preview] ?? {}).map(([field, value]) =>
          <div key={field}><dt>{FIELD_LABELS[field] ?? field}</dt><dd>{value || '未填写'}</dd></div>)}
      </dl>
    </details>
    {submission ? <section className="pub-agent-publication-targets" aria-label="已提交目标账号">
      <strong>已提交目标账号</strong>
      <ul>{submission.targets.map(target => <li key={target.accountId}>{PLATFORM_LABELS[target.platform]} · {target.accountName}</li>)}</ul>
    </section> : <fieldset disabled={!editable} className="pub-agent-publication-targets">
      <legend>目标账号（每个平台选择一个）</legend>
      {platforms.map(platform => <fieldset className="pub-agent-publication-platform" key={platform}>
        <legend>{PLATFORM_LABELS[platform]}</legend>
        <label><input type="radio" name={`${id}-account-${platform}`} checked={!selectedAccounts.some(account => account.platform === platform)}
          onChange={() => changeAccount(platform, '')}/><span>不提交到此平台</span></label>
        {request.accounts.filter(account => account.platform === platform).map(account => {
          const problem = accountProblem(request, account, mode)
          return <label key={account.id}><input type="radio" name={`${id}-account-${platform}`} value={account.id}
            checked={accountIds.includes(account.id)} disabled={!!problem} onChange={() => changeAccount(platform, account.id)}/>
            <span>{account.displayName}<small>{problem || '已登录'}{account.loginError ? ` · ${account.loginError}` : ''}</small></span></label>
        })}
        {!request.accounts.some(account => account.platform === platform) && <p>尚无账号，请登录该平台后让 Agent 重新准备。</p>}
      </fieldset>)}
      {platforms.length === 0 && <p>尚无发布账号，请先在平台账号管理中登录。</p>}
      <label className="pub-agent-publication-mode" htmlFor={`${id}-mode`}>提交方式</label>
      <select id={`${id}-mode`} value={mode} onChange={event => { setMode(event.target.value as PublisherMode); setError('') }}>
        <option value="publish">立即发布</option><option value="draft">转存草稿</option>
      </select>
    </fieldset>}
    <p className="pub-agent-publication-effective">本次实际提交方式：<strong>{effectiveMode === 'draft' ? '转存草稿' : '立即发布'}</strong>{!submission && effectiveMode !== mode && '。文章需要按平台要求调整，将整批转存草稿供你核对。'}{submission?.requestedMode === 'publish' && submission.mode === 'draft' && (!onlyToutiao(request) || !!submission.adjustments?.length) && '。本次已按平台要求转存草稿供你核对。'}</p>
    {allWarnings.length > 0 && <div className="pub-agent-publication-notes"><strong>{submission ? '提交时说明' : '提交前核对'}</strong><ul>{allWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
    {request.state === 'awaiting-confirmation' && problems.length > 0 && <ul className="pub-agent-publication-error" role="status">{[...new Set(problems)].map(problem => <li key={problem}>{problem}</li>)}</ul>}
    {request.errors.length > 0 && <details className="pub-agent-publication-notes"><summary>准备请求时发现的问题</summary><ul>{request.errors.map((problem, index) => <li key={`${index}-${problem}`}>{problem}</li>)}</ul></details>}
    {request.message && <p className="pub-agent-publication-notes">{onlyToutiao(request) && request.state === 'uncertain'
      ? '任务未完成，请从发布历史打开平台稿件核对，勿重复提交' : request.message}</p>}
    {submission?.message && <p className="pub-agent-publication-notes">{submission.message}</p>}
    {!!submission?.adjustments?.length && <ul className="pub-agent-publication-notes" aria-label="已提交平台调整">{submission.adjustments.flatMap(adjustment => adjustment.messages.map(message =>
      <li key={`${adjustment.accountId}-${message}`}>{submission.targets.find(target => target.accountId === adjustment.accountId)?.accountName ?? '目标账号'}：{message}</li>))}</ul>}
    {request.state === 'stale' && <p role="status">请让 Agent 根据最新内容重新生成发布确认卡片。</p>}
    {(uncertain || request.state === 'uncertain' || submission?.state === 'unknown') && <p role="status">{onlyToutiao(request)
      ? '任务未完成，请从发布历史打开平台稿件核对，勿重复提交。' : '本次结果尚未确认，请刷新状态并到平台后台核对。'}</p>}
    {error && <p className="pub-agent-publication-error" role="alert">{error}</p>}
    <div className="pub-agent-publication-actions">
      {request.state === 'awaiting-confirmation' && !uncertain && <>
        <Button type="button" size="sm" variant="outline" disabled={!editable} onClick={() => void mutate('cancel')}>取消本次发布</Button>
        <Button type="button" size="sm" variant="primary" disabled={!ready} onClick={() => void mutate('confirm')}>确认{effectiveMode === 'draft' ? '转存草稿' : '发布'}</Button>
      </>}
      <Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void refresh()}>{loading ? '正在刷新…' : '刷新状态'}</Button>
    </div>
    <p className="pub-agent-publication-footnote">提交队列和本机执行状态不代表平台最终发布成功，请到各平台后台核对。</p>
  </section>
}

const cardCss = `${contentPreviewCss}
.pub-agent-publication { --pub-border: var(--dsw-alias-border-l2, #e4e6e9); --pub-surface: var(--dsw-alias-bg-layer-1, #fff); --pub-soft: var(--dsw-alias-bg-module-platform, #f5f6f7); --pub-text: var(--dsw-alias-label-primary, #111318); --pub-secondary-text: var(--dsw-alias-label-secondary, #535961); display: grid; gap: 12px; width: 100%; min-width: 0; padding: 14px; border: 1px solid var(--pub-border); border-radius: 12px; background: var(--pub-surface); color: var(--pub-text); font: inherit; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.pub-agent-publication * { box-sizing: border-box; }
.pub-agent-publication p, .pub-agent-publication ul, .pub-agent-publication dl { margin: 0; }
.pub-agent-publication header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; }
.pub-agent-publication header > strong { font-size: 14px; }
.pub-agent-publication header > span, .pub-agent-publication-footnote, .pub-agent-publication-notes { color: var(--pub-secondary-text); }
.pub-agent-publication-title { font-weight: 600; }
.pub-agent-publication summary { cursor: pointer; font-weight: 500; }
.pub-agent-publication select { width: 100%; min-width: 0; min-height: 34px; padding: 5px 8px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); color: inherit; font: inherit; }
.pub-agent-publication :is(button, input, select, summary):focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-agent-publication-preview > :is(label, select) { display: block; margin-top: 8px; }
.pub-agent-publication-preview-body { max-height: 420px; margin-top: 10px; overflow: auto; min-width: 0; }
.pub-agent-publication .pub-content-preview-shell { min-height: 0; max-width: 100%; border-radius: 8px; padding: 16px; box-shadow: none; }
.pub-agent-publication .pub-content-preview-wechat { padding: 0; }
.pub-agent-publication :is(.pub-content-preview-title, .pub-wechat-preview-title) { font-size: 18px; }
.pub-agent-publication-summary { padding-top: 10px; }
.pub-agent-publication-summary > strong { display: block; }
.pub-agent-publication .pub-agent-publication-metadata { display: grid; gap: 6px; padding-top: 10px; color: var(--pub-secondary-text); }
.pub-agent-publication-metadata > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; }
.pub-agent-publication-metadata dd { min-width: 0; margin: 0; }
.pub-agent-publication fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.pub-agent-publication-targets > legend { margin-bottom: 8px; font-weight: 600; }
.pub-agent-publication-targets > ul { padding-left: 18px; margin-top: 8px; }
.pub-agent-publication .pub-agent-publication-platform { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--pub-border); border-radius: 8px; }
.pub-agent-publication-platform legend { padding: 0 4px; }
.pub-agent-publication-platform label { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 8px; padding: 6px 0; cursor: pointer; }
.pub-agent-publication input { margin: 4px 0 0; accent-color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub-agent-publication-platform small { display: block; color: var(--pub-secondary-text); }
.pub-agent-publication-platform label:has(input:disabled) { cursor: default; }
.pub-agent-publication-mode { display: block; margin: 12px 0 6px; }
.pub-agent-publication-notes ul, ul.pub-agent-publication-notes { padding-left: 18px; }
.pub-agent-publication-error { color: var(--dsw-alias-state-error-primary, #dc2626); }
ul.pub-agent-publication-error { padding-left: 18px; }
.pub-agent-publication-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pub-agent-publication-actions > button { flex: 1 1 100px; min-height: 32px; }
.pub-agent-publication-footnote { font-size: 12px; }
`
