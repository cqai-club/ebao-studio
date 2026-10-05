import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDraftBindings } from '../src/agent-draft-binding.ts'
import { AgentPublications } from '../src/agent-publication.ts'
import { addAsset, createContent, readContent, saveContent } from '../src/contents.ts'
import { registerSourceDocument } from '../src/source-documents.ts'
import { preparePublicationCandidate } from '../src/publication-candidates.ts'
import { createPublisherSubmission, type PublisherSubmissionRuntime } from '../src/submission-service.ts'
import type { PublisherAccount, PublisherContent, PublisherPlatformCapability } from '../src/protocol.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function setup(type: PublisherContent['contentType'] = 'article') {
  const home = mkdtempSync(join(realpathSync.native(tmpdir()), 'agent-publication-'))
  homes.push(home)
  const env = { DSH_HOME: home }
  const draft = createContent(type, env, '确认后的标题')
  const content = saveContent(draft.id, { revision: draft.revision, title: draft.title,
    body: type === 'article' ? '文章正文' : '', summary: '', tags: [], creativeStatement: 'none',
    ...(type === 'video' ? { description: '', shortTitle: '',
      videoSource: { kind: 'local' as const, localVideoId: randomUUID(), fileName: 'test.mp4', bytes: 10 } } : {}),
  }, env)
  const account: PublisherAccount = { id: randomUUID(), platform: 'bjh', displayName: '百家号测试账号', loginState: 'logged-in' }
  let accounts = [account]
  let capabilities: PublisherPlatformCapability[] = [{ platform: 'bjh', contentTypes: ['article', 'video'],
    modes: { article: ['publish', 'draft'], video: ['publish', 'draft'] }, requiredFields: {}, maxAssets: { article: 20 } }]
  let supported = true
  let listFailure = false
  let onCheck: (() => void) | undefined
  let onAccounts: (() => void) | undefined
  let onSubmit: (() => Promise<unknown>) | undefined
  const submissions: unknown[] = []
  const calls: { method: string; params: unknown }[] = []
  const runtime: PublisherSubmissionRuntime = {
    status: () => ({ supported, running: supported }),
    async request<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params })
      if (method === 'accounts.list') { onAccounts?.(); return accounts.map(item => ({ ...item, cookie: 'never-public-secret' })) as T }
      if (method === 'system.capabilities') return capabilities as T
      if (method === 'accounts.checkLogin') { onCheck?.(); return accounts.find(a => a.id === (params as { id: string }).id) as T }
      if (method === 'submissions.list') { if (listFailure) throw new Error('/secret/native/path credentials'); return submissions as T }
      if (method === 'submissions.create') {
        if (onSubmit) return await onSubmit() as T
        const input = params as { contentId?: string; contentType: string; mode: string; accountIds: string[] }
        const submission = { id: randomUUID(), createdAt: new Date().toISOString(), contentId: input.contentId ?? content.id,
          contentType: input.contentType, title: content.title, mode: input.mode, state: 'queued',
          targets: input.accountIds.map(id => ({ accountId: id, platform: accounts.find(a => a.id === id)!.platform, accountName: account.displayName })),
          partition: 'never-public-partition', file: '/secret/native/path',
        }
        submissions.push(submission)
        return { accepted: true, submission } as T
      }
      throw new Error(`Unexpected method: ${method}`)
    },
  }
  const bindings = new AgentDraftBindings()
  const binding = bindings.bind('session-test', content.id, env)!
  const manager = new AgentPublications(runtime, bindings, { env })
  const options = { contentId: content.id, expectedRevision: content.revision, bindingToken: binding.bindingToken,
    platforms: ['bjh' as const], accountIds: [account.id], mode: 'publish' as const }
  return { home, env, content, account, bindings, binding, manager, options, runtime, calls, submissions,
    choices: { accountIds: [account.id], mode: 'publish' as const },
    count: () => calls.filter(c => c.method === 'submissions.create').length,
    setSupported: (value: boolean) => { supported = value },
    setAccounts: (value: PublisherAccount[]) => { accounts = value },
    setCapabilities: (value: PublisherPlatformCapability[]) => { capabilities = value },
    setListFailure: () => { listFailure = true },
    onCheck: (callback: () => void) => { onCheck = callback },
    onAccounts: (callback: () => void) => { onAccounts = callback },
    onSubmit: (callback: () => Promise<unknown>) => { onSubmit = callback },
  }
}

describe('durable Agent publication confirmations', () => {
  it.each(['dy', 'wxmp'] as const)('queues %s image messages only after the user confirms the selected account', async platform => {
    const t = setup('image-note')
    const latest = addAsset(t.content.id, '验收.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), t.env)
    t.setAccounts([{ ...t.account, platform }])
    t.setCapabilities([{ platform, contentTypes: ['image-note'], modes: { 'image-note': ['draft', 'publish'] },
      requiredFields: {}, maxAssets: { 'image-note': 20 }, maxTitleLength: { 'image-note': 32 } }])
    const card = await t.manager.prepare('session-test', `image-note-${platform}`, {
      ...t.options, expectedRevision: latest.revision, platforms: [platform], mode: 'draft',
    })
    expect(card.errors).toEqual([])
    expect(card.content.contentType).toBe('image-note')
    expect(card.accounts.map(value => value.platform)).toEqual([platform])
    expect(t.count()).toBe(0)
    await t.manager.read('session-test', card.requestId)
    expect(t.count()).toBe(0)
    const choices = { ...t.choices, mode: 'draft' as const }
    expect((await t.manager.confirm('session-test', card.requestId, choices)).submission?.contentType).toBe('image-note')
    await t.manager.confirm('session-test', card.requestId, choices)
    expect(t.count()).toBe(1)
  })

  it('prepares and reads a session-owned card without submitting, then records exactly one accepted job', async () => {
    const t = setup()
    const card = await t.manager.prepare('session-test', 'call-1', t.options)
    expect(card.state).toBe('awaiting-confirmation')
    expect(t.count()).toBe(0)
    expect(JSON.stringify(card)).not.toContain('never-public-secret')
    expect(JSON.stringify(card)).not.toContain('bindingToken')
    await expect(t.manager.read('other-session', card.requestId)).rejects.toThrow('当前会话')
    expect((await t.manager.prepare('session-test', 'call-1', t.options)).requestId).toBe(card.requestId)
    const accepted = await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(accepted.state).toBe('submitted')
    expect(accepted.submission?.state).toBe('queued')
    expect(JSON.stringify(accepted)).not.toContain('never-public-partition')
    expect(JSON.stringify(accepted)).not.toContain('/secret/native/path')
    await t.manager.confirm('session-test', card.requestId, t.choices)
    await new AgentPublications(t.runtime, t.bindings, { env: t.env }).confirm('session-test', card.requestId, t.choices)
    expect(t.count()).toBe(1)
    const next = await t.manager.prepare('session-test', 'call-2', t.options)
    expect((await t.manager.confirm('session-test', next.requestId, t.choices)).state).toBe('uncertain')
    expect(t.count()).toBe(1)
    t.submissions.splice(0)
    expect((await t.manager.getStatus('session-test', card.requestId)).errors.join()).toContain('未找到这条提交')
    t.setListFailure()
    expect((await t.manager.getStatus('session-test', card.requestId)).errors.join()).toContain('暂时无法读取提交状态')
  })

  it('refuses arbitrary unbound content, stale revision, mixed candidate arguments and duplicate account IDs', async () => {
    const t = setup()
    await expect(t.manager.prepare('other-session', 'call', t.options)).rejects.toThrow('没有绑定')
    await expect(t.manager.prepare('session-test', 'stale', { ...t.options, expectedRevision: 1 })).rejects.toThrow('已更新')
    await expect(t.manager.prepare('session-test', 'mixed', { ...t.options, candidateId: randomUUID() })).rejects.toThrow('不能同时')
    await expect(t.manager.prepare('session-test', 'duplicate', { ...t.options, accountIds: [t.account.id, t.account.id] })).rejects.toThrow('不能重复')
    expect(t.count()).toBe(0)
  })

  it('does not submit a cancelled card or a card invalidated by a draft save or binding switch', async () => {
    const t = setup()
    const cancelled = await t.manager.prepare('session-test', 'cancel', t.options)
    expect((await t.manager.cancel('session-test', cancelled.requestId)).state).toBe('cancelled')
    await t.manager.confirm('session-test', cancelled.requestId, t.choices)
    const stale = await t.manager.prepare('session-test', 'stale', t.options)
    saveContent(t.content.id, { ...t.content, title: '已修改', revision: t.content.revision }, t.env)
    expect((await t.manager.confirm('session-test', stale.requestId, t.choices)).state).toBe('stale')
    const latest = readContent(t.content.id, t.env)
    const switched = await t.manager.prepare('session-test', 'switched', { ...t.options, expectedRevision: latest.revision })
    t.bindings.bind('session-test', latest.id, t.env)
    expect((await t.manager.confirm('session-test', switched.requestId, t.choices)).state).toBe('stale')
    expect(t.count()).toBe(0)
  })

  it('rechecks a revision after asynchronous login validation and final account identity before dispatch', async () => {
    const t = setup()
    const card = await t.manager.prepare('session-test', 'race', t.options)
    t.onCheck(() => saveContent(t.content.id, { ...t.content, revision: t.content.revision, body: '异步更新' }, t.env))
    expect((await t.manager.confirm('session-test', card.requestId, t.choices)).state).toBe('stale')
    expect(t.count()).toBe(0)
    const u = setup()
    const second = await u.manager.prepare('session-test', 'account-race', u.options)
    let lists = 0
    u.onAccounts(() => { lists += 1; if (lists === 2) u.setAccounts([{ ...u.account, displayName: '重新命名的账号' }]) })
    const changed = await u.manager.confirm('session-test', second.requestId, u.choices)
    expect(changed.state).toBe('stale')
    expect(changed.message).toContain('重新准备')
    expect(u.count()).toBe(0)
  })

  it('blocks unsupported and logged-out selections before any submission', async () => {
    const t = setup()
    const card = await t.manager.prepare('session-test', 'gates', t.options)
    t.setSupported(false)
    expect((await t.manager.confirm('session-test', card.requestId, t.choices)).state).toBe('awaiting-confirmation')
    t.setSupported(true)
    t.setAccounts([{ ...t.account, loginState: 'logged-out' }])
    await t.manager.confirm('session-test', card.requestId, t.choices)
    t.setAccounts([t.account])
    t.setCapabilities([])
    await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(t.count()).toBe(0)
  })

  it('shows article adjustments as draft before authorizing an immediate publication', async () => {
    const t = setup()
    t.setAccounts([{ ...t.account, platform: 'tt' }])
    t.setCapabilities([{ platform: 'tt', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} }])
    const current = saveContent(t.content.id, { ...t.content, revision: t.content.revision,
      body: '正文 ![图片](https://example.com/image.png)' }, t.env)
    const card = await t.manager.prepare('session-test', 'warnings', { ...t.options, expectedRevision: current.revision, platforms: ['tt'] })
    expect(card.mode).toBe('draft')
    expect(card.warnings.join()).toContain('从发布历史打开头条草稿手动补图')
    const requireReview = await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(requireReview.state).toBe('awaiting-confirmation')
    expect(t.count()).toBe(0)
    const accepted = await t.manager.confirm('session-test', card.requestId, { ...t.choices, mode: 'draft' })
    expect(accepted.submission?.mode).toBe('draft')
    expect(t.count()).toBe(1)
  })

  it('keeps immediate Toutiao publication available with local summary and tags', async () => {
    const t = setup()
    t.setAccounts([{ ...t.account, platform: 'tt' }])
    t.setCapabilities([{ platform: 'tt', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} }])
    const current = saveContent(t.content.id, { ...t.content, revision: t.content.revision,
      summary: '本地摘要', tags: ['本地标签'] }, t.env)
    const card = await t.manager.prepare('session-test', 'silent-information', {
      ...t.options, expectedRevision: current.revision, platforms: ['tt'],
    })
    expect(card.mode).toBe('publish')
    expect(card.warnings).toEqual([])
    expect(card.content).toMatchObject({ summary: '本地摘要', tags: ['本地标签'] })
    expect((await t.manager.confirm('session-test', card.requestId, t.choices)).submission?.mode).toBe('publish')
    expect(t.count()).toBe(1)
  })

  it('projects old Toutiao timeout and informational notices safely without changing the queue history', async () => {
    const t = setup()
    t.setAccounts([{ ...t.account, platform: 'tt' }])
    t.setCapabilities([{ platform: 'tt', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} }])
    const card = await t.manager.prepare('session-test', 'old-toutiao-history', { ...t.options, platforms: ['tt'] })
    await t.manager.confirm('session-test', card.requestId, t.choices)
    const job = t.submissions[0] as { state: string; mode: string; message: string; adjustments: unknown[] }
    job.state = 'unknown'
    job.mode = 'draft'
    job.message = 'Waiting failed: 45000ms exceeded /Users/private/credentials；窗口已保留；账号已锁定'
    job.adjustments = [{ accountId: t.account.id, messages: [
      '头条文章适配器暂不写入摘要；摘要仍保留在本地草稿',
      '该平台文章适配器暂不写入标签；标签仍保留在本地草稿',
      '头条正文已保留 1 处图片占位，请在草稿窗口手动上传',
    ] }]
    const original = JSON.stringify(job)
    const display = await t.manager.getStatus('session-test', card.requestId)
    expect(display.submission?.state).toBe('unknown')
    expect(display.submission?.message).toBe('操作超时，任务未完成')
    expect(display.submission?.adjustments?.[0]?.messages).toEqual([
      '头条正文已保留 1 处图片占位，请从发布历史打开草稿手动补图',
    ])
    expect(display.warnings.join()).not.toMatch(/摘要|标签|窗口|锁定/u)
    expect(JSON.stringify(display)).not.toContain('/Users/private/credentials')
    expect(JSON.stringify(job)).toBe(original)
    await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(t.count()).toBe(1)
  })

  it('never retries after an ambiguous Worker response, including another request and a restarted manager', async () => {
    const t = setup()
    t.onSubmit(async () => { throw new Error('Response timeout with /secret/path') })
    const card = await t.manager.prepare('session-test', 'timeout', t.options)
    expect((await t.manager.confirm('session-test', card.requestId, t.choices)).state).toBe('uncertain')
    const restarted = new AgentPublications(t.runtime, t.bindings, { env: t.env })
    await restarted.confirm('session-test', card.requestId, t.choices)
    const next = await restarted.prepare('session-test', 'new-call', t.options)
    await restarted.confirm('session-test', next.requestId, t.choices)
    expect(t.count()).toBe(1)
  })

  it('serializes concurrent clicks and treats a persisted in-flight claim after restart as uncertain', async () => {
    const t = setup()
    let release!: () => void
    let entered!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    t.onSubmit(() => { entered(); return new Promise(resolve => { release = () => resolve({ accepted: false }) }) })
    const card = await t.manager.prepare('session-test', 'concurrent', t.options)
    const first = t.manager.confirm('session-test', card.requestId, t.choices)
    await enteredPromise
    expect((await t.manager.confirm('session-test', card.requestId, t.choices)).state).toBe('submitting')
    const restarted = new AgentPublications(t.runtime, t.bindings, { env: t.env })
    expect((await restarted.confirm('session-test', card.requestId, t.choices)).state).toBe('uncertain')
    expect(t.count()).toBe(1)
    release()
    await first
    const file = join(t.home, 'publisher/agent-publications', `${card.requestId}.json`)
    expect(JSON.parse(readFileSync(file, 'utf8')).state).toBe('uncertain')
  })

  it('imports only the current session source and invalidates confirmation when the MD changes', async () => {
    const t = setup()
    t.bindings.bind('session-test', null, t.env)
    const workspace = join(t.home, 'workspace')
    mkdirSync(workspace)
    const file = join(workspace, 'article.md')
    writeFileSync(file, '# 原稿标题\n\n原稿正文')
    const source = registerSourceDocument('session-test', file, t.env)
    preparePublicationCandidate('session-test', { sourceId: source.id, sourceRevision: source.revision,
      contentType: 'article', platforms: ['bjh'] }, t.env)
    const card = await t.manager.prepare('session-test', 'source', { platforms: ['bjh'], accountIds: [t.account.id] })
    expect(card.content.title).toBe('原稿标题')
    expect(t.count()).toBe(0)
    writeFileSync(file, '# 原稿标题\n\n新的原稿正文')
    expect((await t.manager.confirm('session-test', card.requestId, t.choices)).state).toBe('stale')
    expect(t.count()).toBe(0)
  })

  it('routes a bound video using its opaque native selection and exact draft revision', async () => {
    const t = setup('video')
    const card = await t.manager.prepare('session-test', 'video', t.options)
    const accepted = await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(accepted.state).toBe('submitted')
    const input = t.calls.find(c => c.method === 'submissions.create')!.params
    expect(input).toMatchObject({ contentType: 'video', localVideoId: t.content.videoSource!.kind === 'local' ? t.content.videoSource!.localVideoId : '', title: t.content.title })
    expect(input).not.toHaveProperty('file')
    expect(t.count()).toBe(1)
  })

  it('enforces advertised video title limits in both shared page routing and Agent confirmation', async () => {
    const t = setup('video')
    t.setCapabilities([{ platform: 'bjh', contentTypes: ['video'], modes: { video: ['publish'] },
      requiredFields: {}, maxTitleLength: { video: 2 } }])
    const card = await t.manager.prepare('session-test', 'video-limit', t.options)
    const result = await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(result.state).toBe('awaiting-confirmation')
    await expect(createPublisherSubmission(t.runtime, { contentType: 'video', contentId: t.content.id,
      revision: t.content.revision, accountIds: [t.account.id], mode: 'publish' }, undefined, t.env)).rejects.toThrow('标题不能超过 2 字')
    expect(t.count()).toBe(0)
  })

  it('enforces advertised required video fields and allows a new reviewed revision once they are supplied', async () => {
    const t = setup('video')
    t.setCapabilities([{ platform: 'bjh', contentTypes: ['video'], modes: { video: ['publish'] },
      requiredFields: { video: ['shortTitle'] } }])
    const card = await t.manager.prepare('session-test', 'video-required', t.options)
    await t.manager.confirm('session-test', card.requestId, t.choices)
    await expect(createPublisherSubmission(t.runtime, { contentType: 'video', contentId: t.content.id,
      revision: t.content.revision, accountIds: [t.account.id], mode: 'publish' }, undefined, t.env)).rejects.toThrow('shortTitle')
    expect(t.count()).toBe(0)
    const current = saveContent(t.content.id, { ...t.content, revision: t.content.revision, shortTitle: '短标题' }, t.env)
    const reviewed = await t.manager.prepare('session-test', 'video-complete', { ...t.options, expectedRevision: current.revision })
    expect((await t.manager.confirm('session-test', reviewed.requestId, t.choices)).state).toBe('submitted')
    expect(t.count()).toBe(1)
  })

  it('requires a new card for a newly selected or deleted account identity', async () => {
    const t = setup()
    const card = await t.manager.prepare('session-test', 'new-account', t.options)
    const added = { ...t.account, id: randomUUID(), displayName: '新增账号' }
    t.setAccounts([t.account, added])
    const stale = await t.manager.confirm('session-test', card.requestId, { accountIds: [added.id], mode: 'publish' })
    expect(stale.state).toBe('stale')
    expect(stale.message).toContain('账号新增、删除或身份已变化')
    await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(t.count()).toBe(0)
    const deleted = await t.manager.prepare('session-test', 'deleted-account', t.options)
    t.setAccounts([])
    expect((await t.manager.confirm('session-test', deleted.requestId, t.choices)).state).toBe('stale')
    expect(t.count()).toBe(0)
  })

  it('keeps accepted mode, target names and adjustment notices authoritative after account and capability changes', async () => {
    const t = setup()
    const card = await t.manager.prepare('session-test', 'history', t.options)
    const accepted = await t.manager.confirm('session-test', card.requestId, t.choices)
    expect(accepted.mode).toBe('publish')
    t.setAccounts([{ ...t.account, displayName: '已改名' }])
    t.setCapabilities([{ platform: 'bjh', contentTypes: ['article'], modes: { article: ['draft'] },
      requiredFields: {}, maxTitleLength: { article: 1 } }])
    const history = await t.manager.getStatus('session-test', card.requestId)
    expect(history.mode).toBe('publish')
    expect(history.accounts[0]?.displayName).toBe(t.account.displayName)
    expect(history.warnings).toEqual([])
    const job = t.submissions[0] as { mode: string; adjustments: unknown[] }
    job.mode = 'draft'
    job.adjustments = [{ accountId: t.account.id, messages: ['公众号标题已截为 64 字', 'secret=/Users/private/credentials'] }]
    t.setAccounts([])
    const adjusted = await t.manager.getStatus('session-test', card.requestId)
    expect(adjusted.mode).toBe('draft')
    expect(adjusted.accountIds).toEqual([t.account.id])
    expect(adjusted.accounts[0]?.displayName).toBe(t.account.displayName)
    expect(adjusted.warnings.join()).toContain('公众号标题已截为 64 字')
    expect(JSON.stringify(adjusted)).not.toContain('/Users/private/credentials')
  })

  it.each([
    '头条正文已保留 2 处无法自动上传的图片占位，请在草稿窗口手动上传',
    '头条正文已保留 2 处图片占位，请在草稿窗口手动上传',
    '头条封面不会自动上传，请在草稿窗口手动设置',
  ])('preserves a generated current or historical Toutiao notice: %s', async message => {
    const t = setup()
    t.setAccounts([{ ...t.account, platform: 'tt' }])
    t.setCapabilities([{ platform: 'tt', contentTypes: ['article'], modes: { article: ['publish', 'draft'] }, requiredFields: {} }])
    const card = await t.manager.prepare('session-test', 'toutiao-notice', { ...t.options, platforms: ['tt'] })
    expect(card.mode).toBe('publish')
    expect(card.warnings).toEqual([])
    await t.manager.confirm('session-test', card.requestId, t.choices)
    const job = t.submissions[0] as { mode: string; adjustments: unknown[] }
    job.mode = 'draft'
    job.adjustments = [{ accountId: t.account.id, messages: [message, `${message} /Users/private/credentials`] }]
    const adjusted = await t.manager.getStatus('session-test', card.requestId)
    expect(adjusted.mode).toBe('draft')
    const display = message.startsWith('头条正文') ? '头条正文已保留 2 处图片占位，请从发布历史打开草稿手动补图'
      : '头条封面需手动设置，请从发布历史打开草稿'
    expect(adjusted.submission?.adjustments?.[0]?.messages).toEqual([
      display, '平台对本次提交内容作了调整，请到平台后台核对',
    ])
    expect(adjusted.warnings.join()).toContain(display)
    expect(JSON.stringify(adjusted)).not.toContain('/Users/private/credentials')
  })
})
