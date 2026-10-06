/** Durable, session-owned publication cards. Only confirm() can dispatch a submission. */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { AgentDraftBindings, validAgentSessionId } from './agent-draft-binding.ts'
import { readContent } from './contents.ts'
import { readPublicationCandidate, validPublicationCandidate } from './publication-candidates.ts'
import { openPublicationFromSource } from './publication-preparation.ts'
import { readSessionSourceDocument, readSourceDocument } from './source-documents.ts'
import { articleSubmissionWarnings, contentSubmissionError } from './submission-validation.ts'
import { displayAdjustmentMessage, isOperationTimeout, isToutiaoOnly, projectSubmissionForDisplay } from './submission-display.ts'
import { createPublisherSubmission, validateSubmissionChoices, videoSubmissionError, type PublisherSubmissionRuntime } from './submission-service.ts'
import {
  PLATFORMS, PLATFORM_LABELS, type Platform, type PublisherAccount,
  type PublisherContent, type PublisherPlatformCapability, type PublisherSubmission,
} from './protocol.ts'
import type {
  AgentPublicationRequest, ConfirmAgentPublicationChoices, PrepareAgentPublicationOptions,
} from './agent-publication-protocol.ts'

export type { AgentPublicationRequest, ConfirmAgentPublicationChoices, PrepareAgentPublicationOptions } from './agent-publication-protocol.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const STATES = new Set(['awaiting-confirmation', 'submitting', 'submitted', 'uncertain', 'cancelled', 'stale'])
const MAX_RECORD_BYTES = 12 * 1024 * 1024
class StalePublicationError extends Error {}
type Origin = { kind: 'binding'; bindingToken: string } | { kind: 'source'; sourceId: string; sourceRevision: string; candidateId?: string }
interface StoredRequest extends AgentPublicationRequest {
  version: 1
  origin: Origin
  contentHash: string
  /** Only public account identity is captured; no cookies, partitions, credentials or local paths. */
  knownAccounts: PublisherAccount[]
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function clean(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim().slice(0, max) : ''
}
function validId(id: string): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('发布确认请求无效')
  return id.toLowerCase()
}
function requestId(sessionId: string, callId: string): string {
  if (typeof callId !== 'string' || !callId || Buffer.byteLength(callId, 'utf8') > 512
    || /[\u0000-\u001f\u007f]/u.test(callId)) throw new Error('Agent 工具调用 ID 无效')
  const hex = createHash('sha256').update(sessionId).update('\0').update(callId).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
function platformList(value: unknown): Platform[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > PLATFORMS.length
    || value.some(p => !(PLATFORMS as readonly unknown[]).includes(p)) || new Set(value).size !== value.length) {
    throw new Error('发布平台无效')
  }
  return [...value] as Platform[]
}
function publicAccounts(value: unknown): PublisherAccount[] {
  if (!Array.isArray(value)) throw new Error('发布账号列表无效')
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !UUID.test(raw.id)
      || !(PLATFORMS as readonly unknown[]).includes(raw.platform)) return []
    return [{ id: raw.id, platform: raw.platform as Platform, displayName: clean(raw.displayName, 100),
      loginState: raw.loginState === 'logged-in' || raw.loginState === 'logged-out' ? raw.loginState : 'unknown',
      ...(raw.loginError ? { loginError: '账号登录检查失败，请重新登录' } : {}),
      ...(typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? { expiresAt: raw.expiresAt } : {}),
    } satisfies PublisherAccount]
  })
}
function publicCapabilities(value: unknown): PublisherPlatformCapability[] {
  if (!Array.isArray(value)) throw new Error('发布能力列表无效')
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object' || !(PLATFORMS as readonly unknown[]).includes(raw.platform)) return []
    const modes: PublisherPlatformCapability['modes'] = {}
    const requiredFields: PublisherPlatformCapability['requiredFields'] = {}
    const maxAssets: NonNullable<PublisherPlatformCapability['maxAssets']> = {}
    const maxTitleLength: NonNullable<PublisherPlatformCapability['maxTitleLength']> = {}
    for (const type of ['article', 'image-note', 'video'] as const) {
      if (Array.isArray(raw.modes?.[type])) modes[type] = raw.modes[type].filter((m: unknown) => m === 'publish' || m === 'draft')
      if (Array.isArray(raw.requiredFields?.[type])) requiredFields[type] = raw.requiredFields[type]
        .filter((f: unknown) => typeof f === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(f as string))
      if (Number.isSafeInteger(raw.maxAssets?.[type]) && raw.maxAssets[type] >= 0) maxAssets[type] = raw.maxAssets[type]
      if (Number.isSafeInteger(raw.maxTitleLength?.[type]) && raw.maxTitleLength[type] > 0) maxTitleLength[type] = raw.maxTitleLength[type]
    }
    return [{ platform: raw.platform as Platform, contentTypes: Object.keys(modes) as PublisherPlatformCapability['contentTypes'],
      modes, requiredFields, maxAssets, maxTitleLength,
      ...(Number.isSafeInteger(raw.articleThemeVersion) ? { articleThemeVersion: raw.articleThemeVersion } : {}),
    }]
  })
}
function publicSubmission(value: unknown): PublisherSubmission {
  if (!value || typeof value !== 'object') throw new Error('发布结果无效')
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !UUID.test(raw.id) || typeof raw.contentId !== 'string'
    || !['article', 'image-note', 'video'].includes(String(raw.contentType))
    || raw.mode !== 'draft' && raw.mode !== 'publish' || !Array.isArray(raw.targets)) throw new Error('发布结果无效')
  const state = ['queued', 'running', 'completed', 'failed', 'unknown'].includes(String(raw.state))
    ? raw.state as PublisherSubmission['state'] : 'unknown'
  const targets: PublisherSubmission['targets'] = raw.targets.flatMap(target => {
    if (!target || typeof target.accountId !== 'string' || !UUID.test(target.accountId)
      || !(PLATFORMS as readonly unknown[]).includes(target.platform)) return []
    return [{ accountId: target.accountId, platform: target.platform as Platform, accountName: clean(target.accountName, 100) }]
  })
  const onlyToutiao = isToutiaoOnly(targets.map(target => target.platform))
  const adjustments = Array.isArray(raw.adjustments) ? raw.adjustments.flatMap(item => {
    if (!item || typeof item.accountId !== 'string' || !UUID.test(item.accountId) || !Array.isArray(item.messages)) return []
    const platform = targets.find(target => target.accountId === item.accountId)?.platform ?? (onlyToutiao ? 'tt' : undefined)
    const messages = item.messages.filter((message: unknown) => typeof message === 'string').slice(0, 12)
      .flatMap((message: string) => {
        const display = safeAdjustment(message, platform)
        return display ? [display] : []
      })
    return messages.length ? [{ accountId: item.accountId, messages }] : []
  }) : []
  return projectSubmissionForDisplay({ id: raw.id, createdAt: clean(raw.createdAt, 40), contentId: raw.contentId,
    contentType: raw.contentType as PublisherSubmission['contentType'], title: clean(raw.title, 120), mode: raw.mode,
    state, targets, ...(raw.requestedMode === 'publish' || raw.requestedMode === 'draft' ? { requestedMode: raw.requestedMode } : {}),
    ...(adjustments.length ? { adjustments } : {}),
    // Worker messages are intentionally not passed through: they may include native paths or credentials.
    ...(onlyToutiao && (state === 'unknown' || state === 'failed') && isOperationTimeout(raw.message)
      ? { message: '操作超时，任务未完成' }
      : state === 'unknown' ? { message: '平台结果尚未确认，请到平台后台核对，勿重复提交' }
      : state === 'failed' ? { message: '本次提交未全部成功，请到发布历史和平台后台核对' } : {}),
  })
}

/** Worker adjustments are generated notices, never arbitrary native diagnostics. */
function safeAdjustment(value: string, platform?: Platform): string | undefined {
  const text = displayAdjustmentMessage(platform, clean(value))
  if (!text) return undefined
  const allowed = [
    '已将所选第一张图片设为封面', '已清除不在所选素材中的封面',
    '掘金分类未填写，已使用默认分类「前端」', '已将第一张可用的 JPEG/PNG 图片设为公众号封面',
    '公众号标题已截为 64 字', '公众号摘要已截为 120 字', '已以首张图片作为头条封面参考',
    '头条封面不会自动上传，请在草稿窗口手动设置', '头条文章适配器暂不写入摘要；摘要仍保留在本地草稿',
    '该平台文章适配器暂不写入标签；标签仍保留在本地草稿',
    '头条封面需手动设置，请从发布历史打开草稿',
    '已以首张图片作为头条封面参考，请从发布历史打开草稿手动设置',
  ]
  // 兼容既有提交历史中两种头条图片占位说明。
  if (allowed.includes(text) || /^(?:已移除 \d+ 张(?:正文图片|非封面素材|无法用于该平台的正文图片)|已排除 \d+ 张未使用或不兼容的公众号素材|头条正文已保留 \d+ 处(?:无法自动上传的)?图片占位，请在草稿窗口手动上传|头条正文已保留 \d+ 处图片占位，请从发布历史打开草稿手动补图|公众号 \d+ 张图片将在上传前尝试压缩至接口限制，草稿需核对画质)$/u.test(text)) return text
  return '平台对本次提交内容作了调整，请到平台后台核对'
}

export class AgentPublications {
  private readonly env: NodeJS.ProcessEnv
  private readonly active = new Set<string>()

  constructor(private readonly runtime: PublisherSubmissionRuntime, private readonly bindings: AgentDraftBindings,
    options: { env?: NodeJS.ProcessEnv } = {}) { this.env = options.env ?? process.env }

  private root(): string {
    const publisher = join(resolveDshHome(undefined, this.env), 'publisher')
    const root = join(publisher, 'agent-publications')
    for (const directory of [publisher, root]) {
      if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) {
        throw new Error('发布确认请求目录无效')
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 })
    }
    return root
  }

  private path(id: string): string { return join(this.root(), `${validId(id)}.json`) }

  private readJson(file: string): unknown {
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) throw new Error('发布确认请求记录无效')
    return JSON.parse(readFileSync(file, 'utf8'))
  }

  private write(record: StoredRequest, exclusive = false): void {
    record.updatedAt = new Date().toISOString()
    const file = this.path(record.requestId)
    const temp = join(this.root(), `.${randomUUID()}.tmp`)
    const fd = openSync(temp, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd) } finally { closeSync(fd) }
    try {
      if (exclusive) linkSync(temp, file)
      else {
        if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('发布确认请求记录无效')
        renameSync(temp, file)
      }
      this.syncDirectory()
    } finally { if (existsSync(temp)) unlinkSync(temp) }
  }

  private syncDirectory(): void {
    // POSIX directory sync makes the dispatch claim durable across a power loss.
    if (process.platform === 'win32') return
    const fd = openSync(this.root(), 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }

  private claim(file: string, value: object): boolean {
    let fd: number
    try { fd = openSync(file, 'wx', 0o600) }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false; throw cause }
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
    this.syncDirectory()
    return true
  }

  private load(sessionId: string, id: string): StoredRequest {
    validAgentSessionId(sessionId)
    const file = this.path(id)
    if (!existsSync(file)) throw new Error('发布确认请求不存在')
    let raw: unknown
    try { raw = this.readJson(file) } catch { throw new Error('发布确认请求记录无效') }
    if (!raw || typeof raw !== 'object') throw new Error('发布确认请求记录无效')
    const record = raw as StoredRequest
    if (record.version !== 1 || record.requestId !== validId(id) || record.sessionId !== sessionId
      || !STATES.has(record.state) || !record.content || typeof record.content.id !== 'string'
      || !UUID.test(record.content.id) || !Number.isSafeInteger(record.content.revision)
      || !record.origin || !['binding', 'source'].includes(record.origin.kind)
      || typeof record.contentHash !== 'string' || !Array.isArray(record.knownAccounts)) {
      throw new Error('发布确认请求不属于当前会话或记录无效')
    }
    if (!this.active.has(record.requestId) && (record.state === 'submitting'
      || record.state === 'awaiting-confirmation' && existsSync(join(this.root(), `${record.requestId}.claim`)))) {
      record.state = 'uncertain'
      record.message = '上次提交未确认完成，请先查看发布历史和平台后台，勿重复提交'
      this.write(record)
    }
    return record
  }

  private assertSnapshot(record: StoredRequest): void {
    const content = readContent(record.content.id, this.env)
    if (content.revision !== record.content.revision || digest(content) !== record.contentHash) {
      throw new Error('草稿已更新，请在对话中重新准备发布确认')
    }
    if (record.origin.kind === 'binding') {
      this.bindings.require(record.sessionId, record.content.id, record.origin.bindingToken)
    } else {
      const source = readSourceDocument(record.origin.sourceId, this.env)
      if (source.sessionId !== record.sessionId || source.revision !== record.origin.sourceRevision) {
        throw new Error('原稿已更新，请在对话中重新准备发布确认')
      }
      const candidate = readPublicationCandidate(record.sessionId)
      if (record.origin.candidateId && candidate && candidate.id !== record.origin.candidateId) {
        throw new Error('发布候选已更新，请在对话中重新准备发布确认')
      }
    }
  }

  private async context(): Promise<{ accounts: PublisherAccount[]; capabilities: PublisherPlatformCapability[]; errors: string[] }> {
    if (!this.runtime.status().supported) return { accounts: [], capabilities: [], errors: ['当前发布引擎不可用，请检查桌面应用'] }
    try {
      const [accounts, capabilities] = await Promise.all([
        this.runtime.request('accounts.list'), this.runtime.request('system.capabilities'),
      ])
      return { accounts: publicAccounts(accounts), capabilities: publicCapabilities(capabilities), errors: [] }
    } catch { return { accounts: [], capabilities: [], errors: ['发布账号或能力检查失败，请刷新后重试'] } }
  }

  private selection(record: StoredRequest, accounts: PublisherAccount[], capabilities: PublisherPlatformCapability[], choices: ConfirmAgentPublicationChoices) {
    const selected = choices.accountIds.map(id => accounts.find(account => account.id === id)).filter((account): account is PublisherAccount => Boolean(account))
    const errors: string[] = []
    try { validateSubmissionChoices(choices.accountIds, choices.mode) } catch (cause) { errors.push((cause as Error).message) }
    if (selected.length !== choices.accountIds.length) errors.push('所选账号不存在，请刷新后重试')
    if (new Set(selected.map(account => account.platform)).size !== selected.length) errors.push('同一平台一次只能选择一个账号')
    for (const platform of record.requestedPlatforms) {
      if (!selected.some(account => account.platform === platform)) errors.push(`请为${PLATFORM_LABELS[platform]}选择发布账号`)
    }
    if (record.requestedPlatforms.length && selected.some(account => !record.requestedPlatforms.includes(account.platform))) {
      errors.push('所选账号不属于本次目标平台')
    }
    const warnings = articleSubmissionWarnings(record.content, selected, capabilities)
    const mode = record.content.contentType === 'article' && warnings.length ? 'draft' : choices.mode
    if (record.content.contentType === 'video') {
      const error = videoSubmissionError(record.content, selected, capabilities, mode)
      if (error) errors.push(error)
    } else {
      const error = contentSubmissionError(record.content, selected, capabilities, mode)
      if (error) errors.push(error)
    }
    for (const account of selected) if (account.loginState !== 'logged-in') errors.push(`${account.displayName}需要重新登录`)
    return { selected, warnings, errors: [...new Set(errors)], mode }
  }

  private view(record: StoredRequest, context: Awaited<ReturnType<AgentPublications['context']>>): AgentPublicationRequest {
    const accepted = record.submission && projectSubmissionForDisplay(record.submission)
    const validation = accepted ? undefined : this.selection(record, context.accounts, context.capabilities,
      { accountIds: record.accountIds, mode: record.mode })
    const accounts: PublisherAccount[] = accepted ? accepted.targets.map(target => ({
      id: target.accountId, platform: target.platform, displayName: target.accountName, loginState: 'unknown',
    })) : context.accounts
    const warnings = accepted ? (accepted.adjustments ?? []).flatMap(item => {
      const target = accepted.targets.find(target => target.accountId === item.accountId)
      return item.messages.map(message => `${target ? PLATFORM_LABELS[target.platform] : '平台'}：${message}`)
    }) : validation!.warnings
    return { requestId: record.requestId, sessionId: record.sessionId, callId: record.callId,
      createdAt: record.createdAt, updatedAt: record.updatedAt, state: record.state, content: record.content,
      accounts, capabilities: context.capabilities, requestedPlatforms: record.requestedPlatforms,
      accountIds: accepted ? accepted.targets.map(target => target.accountId) : record.accountIds,
      mode: accepted?.mode ?? validation!.mode, warnings,
      errors: context.errors,
      ...(accepted ? { submission: accepted } : {}), ...(record.message ? { message: record.message } : {}),
    }
  }

  async prepare(sessionId: string, callId: string, options: PrepareAgentPublicationOptions = {}): Promise<AgentPublicationRequest> {
    validAgentSessionId(sessionId)
    const id = requestId(sessionId, callId)
    if (existsSync(this.path(id))) return this.read(sessionId, id)
    if (options.mode !== undefined && options.mode !== 'publish' && options.mode !== 'draft') throw new Error('发布方式无效')
    const platforms = platformList(options.platforms)
    if (options.accountIds !== undefined) validateSubmissionChoices(options.accountIds, options.mode ?? 'publish')
    const binding = this.bindings.current(sessionId)
    let content: PublisherContent
    let origin: Origin
    if (binding) {
      if (options.candidateId !== undefined) throw new Error('当前草稿发布不能同时指定原稿候选')
      if (options.contentId !== undefined && options.contentId !== binding.contentId
        || options.bindingToken !== undefined && options.bindingToken !== binding.bindingToken) throw new Error('当前草稿已切换，请重新读取')
      content = readContent(binding.contentId, this.env)
      if (options.expectedRevision !== undefined && options.expectedRevision !== content.revision) throw new Error('草稿已更新，请重新读取')
      origin = { kind: 'binding', bindingToken: binding.bindingToken }
    } else {
      if (options.contentId !== undefined || options.bindingToken !== undefined || options.expectedRevision !== undefined) {
        throw new Error('当前会话没有绑定该草稿')
      }
      const candidate = readPublicationCandidate(sessionId)
      if (options.candidateId && candidate?.id !== options.candidateId) throw new Error('发布候选已失效，请重新准备')
      if (!candidate) throw new Error('请先在当前对话准备发布候选预览')
      const source = readSessionSourceDocument(sessionId, this.env)
      if (!source) throw new Error('当前会话没有可发布的草稿或原稿')
      const reviewed = validPublicationCandidate(sessionId, candidate.id, this.env)
      content = openPublicationFromSource(source.id, source.revision, reviewed.contentType, this.env, reviewed)
      origin = { kind: 'source', sourceId: source.id, sourceRevision: source.revision,
        candidateId: reviewed.id }
      if (!platforms.length) platforms.push(...reviewed.platforms)
    }
    const context = await this.context()
    const defaults = options.accountIds ?? platforms.flatMap(platform => {
      const matching = context.accounts.filter(account => account.platform === platform && account.loginState === 'logged-in')
      return matching.length === 1 ? [matching[0].id] : []
    })
    const timestamp = new Date().toISOString()
    const record: StoredRequest = { version: 1, requestId: id, sessionId, callId, createdAt: timestamp, updatedAt: timestamp,
      state: 'awaiting-confirmation', content, contentHash: digest(content), origin, knownAccounts: context.accounts,
      accounts: [], capabilities: [], requestedPlatforms: platforms, accountIds: [...defaults], mode: options.mode ?? 'publish', warnings: [], errors: [],
    }
    this.assertSnapshot(record)
    record.mode = this.selection(record, context.accounts, context.capabilities, { accountIds: record.accountIds, mode: record.mode }).mode
    try { this.write(record, true) }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return this.read(sessionId, id); throw cause }
    return this.view(record, context)
  }

  async read(sessionId: string, id: string): Promise<AgentPublicationRequest> {
    const record = this.load(sessionId, id)
    let statusError: string | undefined
    if (record.state === 'awaiting-confirmation') {
      try { this.assertSnapshot(record) }
      catch { record.state = 'stale'; record.message = '草稿、原稿或当前会话绑定已更新，请重新准备发布确认'; this.write(record) }
    }
    if (record.submission) {
      try {
        const rows = await this.runtime.request<unknown>('submissions.list')
        if (Array.isArray(rows)) {
          const match = rows.find(item => item?.id === record.submission!.id)
          if (match) { record.submission = publicSubmission(match); this.write(record) }
          else statusError = '当前发布历史未找到这条提交，请到平台后台核对；不要重复提交'
        } else statusError = '暂时无法读取提交状态，请刷新此确认卡片；不要重复提交'
      } catch { statusError = '暂时无法读取提交状态，请刷新此确认卡片；不要重复提交' }
    }
    const context = await this.context()
    if (statusError) context.errors.push(statusError)
    return this.view(record, context)
  }

  getStatus(sessionId: string, id: string): Promise<AgentPublicationRequest> { return this.read(sessionId, id) }

  async cancel(sessionId: string, id: string): Promise<AgentPublicationRequest> {
    const record = this.load(sessionId, id)
    if (record.state === 'awaiting-confirmation') {
      record.state = 'cancelled'; record.message = '已取消，尚未提交到平台'; this.write(record)
    }
    return this.read(sessionId, id)
  }

  async confirm(sessionId: string, id: string, choices: ConfirmAgentPublicationChoices): Promise<AgentPublicationRequest> {
    const record = this.load(sessionId, id)
    if (record.state !== 'awaiting-confirmation') return this.read(sessionId, id)
    validateSubmissionChoices(choices.accountIds, choices.mode)
    const claimFile = join(this.root(), `${record.requestId}.claim`)
    if (!this.claim(claimFile, { requestId: record.requestId })) return this.read(sessionId, id)
    this.active.add(record.requestId)
    record.state = 'submitting'
    let dispatched = false
    try {
      this.write(record)
      this.assertSnapshot(record)
      const context = await this.context()
      if (!context.errors.length) for (const accountId of choices.accountIds) {
        const current = context.accounts.find(item => item.id === accountId)
        const known = record.knownAccounts.find(item => item.id === accountId)
        if (!current || !known || known.platform !== current.platform || known.displayName !== current.displayName) {
          throw new StalePublicationError('发布账号新增、删除或身份已变化，请在对话中重新准备发布确认')
        }
      }
      const validation = this.selection(record, context.accounts, context.capabilities, choices)
      if (context.errors.length || validation.errors.length) throw new Error('请先解决发布账号或内容检查问题')
      for (const account of validation.selected) {
        const known = record.knownAccounts.find(item => item.id === account.id)
        if (known?.platform !== account.platform || known.displayName !== account.displayName) {
          throw new StalePublicationError('发布账号身份已变化，请在对话中重新准备发布确认')
        }
      }
      record.accountIds = [...choices.accountIds]; record.mode = validation.mode; record.warnings = validation.warnings
      if (validation.mode !== choices.mode) {
        record.state = 'awaiting-confirmation'; record.message = '文章需按平台要求调整，本批次将转存草稿，请重新核对并确认'
        this.write(record); unlinkSync(claimFile)
        return this.view(record, context)
      }
      for (const account of validation.selected) {
        const checked = publicAccounts([await this.runtime.request('accounts.checkLogin', { id: account.id })])[0]
        if (!checked || checked.id !== account.id || checked.platform !== account.platform || checked.displayName !== account.displayName) {
          throw new StalePublicationError('发布账号身份已变化，请在对话中重新准备发布确认')
        }
        if (checked.loginState !== 'logged-in') {
          throw new Error('所选账号需要重新登录，请登录后重新确认')
        }
      }
      this.assertSnapshot(record)
      const fingerprint = digest({ contentId: record.content.id, revision: record.content.revision,
        accountIds: [...choices.accountIds].sort(), mode: record.mode })
      const fingerprintFile = join(this.root(), `submitted-${fingerprint}.json`)
      const result = await createPublisherSubmission(this.runtime, {
        contentType: record.content.contentType, contentId: record.content.id,
        revision: record.content.revision, accountIds: [...choices.accountIds], mode: record.mode,
      }, undefined, this.env, finalContext => {
        this.assertSnapshot(record)
        const finalAccounts = publicAccounts(finalContext.accounts)
        const finalCapabilities = publicCapabilities(finalContext.capabilities)
        if (validation.selected.some(account => {
          const final = finalAccounts.find(item => item.id === account.id)
          return !final || final.platform !== account.platform || final.displayName !== account.displayName
        })) throw new StalePublicationError('发布检查期间账号身份已变化，请在对话中重新准备发布确认')
        const finalValidation = this.selection(record, finalAccounts, finalCapabilities, choices)
        if (finalValidation.errors.length || finalValidation.mode !== record.mode
          || digest(finalValidation.warnings) !== digest(validation.warnings)) {
          throw new Error('发布检查期间账号、能力或内容调整发生变化，请重新确认')
        }
        // Both the per-card and per-content dispatch claims precede the non-idempotent Worker call.
        if (!this.claim(fingerprintFile, { requestId: record.requestId, sessionId })) {
          throw new Error('duplicate-publication')
        }
        dispatched = true
        this.write(record)
      })
      if (!result?.accepted) throw new Error('发布结果无效')
      record.submission = publicSubmission(result.submission)
      record.mode = record.submission.mode
      record.state = 'submitted'; record.message = '已提交到发布队列，请查看执行结果；平台审核结果以平台后台为准'
      this.write(record)
    } catch (cause) {
      if ((cause as Error).message === 'duplicate-publication') {
        record.state = 'uncertain'; record.message = '这份内容已提交或正在确认结果，请查看已有发布历史，勿重复提交'
        this.write(record)
      } else if (dispatched) {
        record.state = 'uncertain'; record.message = '提交响应未确认，请先查看发布历史和平台后台，勿重复提交'
        this.write(record)
      } else {
        if (cause instanceof StalePublicationError) {
          record.state = 'stale'; record.message = cause.message
        } else {
          try { this.assertSnapshot(record); record.state = 'awaiting-confirmation' }
          catch { record.state = 'stale' }
          record.message = record.state === 'stale' ? '内容或会话绑定已变化，请重新准备发布确认'
            : '发布检查未通过，尚未提交；请核对账号登录、平台能力和内容后重试'
        }
        this.write(record)
        unlinkSync(claimFile)
      }
    } finally { this.active.delete(record.requestId) }
    return this.read(sessionId, id)
  }
}
