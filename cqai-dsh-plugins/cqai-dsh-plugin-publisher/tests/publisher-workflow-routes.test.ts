import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as plugin from '../src/index.ts'
import { createContent, readContent, readStoredContent } from '../src/contents.ts'
import { readAgentDraftSession, readPublisherSessionOwnership } from '../src/agent-draft-session.ts'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'ebao-publisher-workflow-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
  const workspaces = new Map<string, { id: string; path: string }>()
  const sessions = new Map<string, { sessionId: string; cwd: string }>()
  const archivedSessionIds: string[] = []
  let uncertainCreate = false
  let failArchive = false
  ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
    handler = route.handler
    return () => { handler = undefined }
  } } as never)
  ctx.provide('desktopRuntime', { publisher: {} } as never)
  await ctx.plugin({ name: 'publisher-workflow-host-fixture', apply(serviceCtx) {
    const publishArchive = () => {
      const emit = ctx as unknown as { emit(name: string, change: unknown): void }
      emit.emit('domain/changed', { domain: 'workspace', table: '', operation: 'put',
        value: { archivedSessionIds: [...archivedSessionIds] } })
    }
    serviceCtx.provide('workspaceRegistry', {
      archivedSessionIds,
      list: () => [...workspaces.values()].map(workspace => ({ ...workspace,
        sessionIds: [...sessions.values()].filter(session => session.cwd === workspace.path).map(session => session.sessionId),
      })),
      create: async (path: string, title: string) => {
        expect(title).toBe('多平台发布')
        if (!workspaces.has(path)) workspaces.set(path, { id: 'publisher-workspace', path })
        return workspaces.get(path)
      },
      archiveSession: async (id: string, options: { stopActivity: boolean }) => {
        expect(options.stopActivity).toBe(true)
        if (failArchive) throw new Error('归档暂时失败')
        if (!archivedSessionIds.includes(id)) archivedSessionIds.push(id)
        publishArchive()
      },
      unarchiveSession: async (id: string) => {
        const index = archivedSessionIds.indexOf(id)
        if (index !== -1) archivedSessionIds.splice(index, 1)
        publishArchive()
      },
    } as never)
    serviceCtx.provide('sessionController', {
      list: async () => ({ items: [...sessions.values()] }),
      create: async ({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) => {
        const workspace = [...workspaces.values()].find(item => item.id === workspaceId)!
        sessions.set(sessionId, { sessionId, cwd: workspace.path })
        if (uncertainCreate) { uncertainCreate = false; throw new Error('创建回复暂时中断') }
        return { sessionId }
      },
      rename: async () => {},
    } as never)
  } })
  await ctx.plugin(plugin)
  disposers.push(async () => {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  })
  const request = async (action: string, body?: unknown) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as IncomingMessage
    Object.assign(req, { method: body === undefined ? 'GET' : 'POST', url: `/api/cqai-publisher/${action}`,
      headers: { host: '127.0.0.1:43120', ...(body === undefined ? {} : { 'x-ejianbao': '1' }) },
      socket: { remoteAddress: '127.0.0.1' } })
    let status = 0
    let payload = ''
    const res = { headersSent: false, destroyed: false, writeHead: (code: number) => { status = code },
      end: (value: string) => { payload = value } } as unknown as ServerResponse
    await handler!(req, res)
    return { status, body: JSON.parse(payload) }
  }
  return { ctx, request, workspaces, sessions, archivedSessionIds,
    uncertainCreate: () => { uncertainCreate = true }, failArchive: (value: boolean) => { failArchive = value } }
}

describe('Publisher owned-content Host workflow', () => {
  it('exposes internal visibility without removing backing data or ordinary workspace rows', async () => {
    const host = await fixture()
    expect(await host.request('internal-workspace-visibility')).toEqual({ status: 200, body: { workspaceIds: [], sessionIds: [] } })
    const ids: string[] = []
    for (const type of ['article', 'image-note', 'video'] as const) {
      const content = createContent(type)
      const opened = await host.request('agent-draft-session', { contentId: content.id })
      ids.push(opened.body.sessionId)
      expect(readContent(content.id).id).toBe(content.id)
    }
    host.workspaces.set('ordinary-path', { id: 'ordinary-workspace', path: 'ordinary-path' })
    host.sessions.set('ordinary-session', { sessionId: 'ordinary-session', cwd: 'ordinary-path' })
    const metadata = await host.request('internal-workspace-visibility')
    expect(metadata.status).toBe(200)
    expect(metadata.body.workspaceIds).toEqual(['publisher-workspace'])
    expect(metadata.body.sessionIds.sort()).toEqual(ids.sort())
    expect(host.workspaces.size).toBe(2)
    expect(host.sessions.size).toBe(4)
    expect(metadata.body.sessionIds).not.toContain('ordinary-session')
  })
  it('opens every type in one workspace and reuses a reserved conversation after an uncertain creation', async () => {
    const host = await fixture()
    const article = createContent('article')
    host.uncertainCreate()
    expect((await host.request('agent-draft-session', { contentId: article.id })).status).toBe(400)
    const reserved = readAgentDraftSession(article.id)
    const [first, second] = await Promise.all([
      host.request('agent-draft-session', { contentId: article.id }),
      host.request('agent-draft-session', { contentId: article.id }),
    ])
    expect(first.status).toBe(200)
    expect(second.body.sessionId).toBe(reserved)
    expect(first.body.sessionId).toBe(reserved)
    for (const type of ['image-note', 'video'] as const) {
      const content = createContent(type)
      const opened = await host.request('agent-draft-session', { contentId: content.id })
      expect(opened.status).toBe(200)
      expect(opened.body.workspaceId).toBe(first.body.workspaceId)
      expect(opened.body.path).toBe(first.body.path)
      expect(opened.body.sessionId).not.toBe(reserved)
    }
    expect(host.workspaces.size).toBe(1)
    expect(host.sessions.size).toBe(3)
  })

  it('recycles content and its own chat together, but a standalone chat removal keeps the draft', async () => {
    const host = await fixture()
    const article = createContent('article')
    const opened = await host.request('agent-draft-session', { contentId: article.id })
    const sessionId = opened.body.sessionId as string
    expect((await host.request('agent-draft-bind', { contentId: article.id, sessionId })).status).toBe(200)
    expect((await host.request('content-delete', { id: article.id })).status).toBe(200)
    expect(readStoredContent(article.id).trashedAt).toBeTruthy()
    expect(host.archivedSessionIds).toContain(sessionId)
    expect(readPublisherSessionOwnership(sessionId)?.status).toBe('current')
    expect((await host.request('content-restore', { id: article.id })).status).toBe(200)
    expect(host.archivedSessionIds).not.toContain(sessionId)
    expect(readContent(article.id).trashedAt).toBeUndefined()
    expect((await host.request('agent-draft-session', { contentId: article.id })).body.sessionId).toBe(sessionId)
    expect((await host.request('agent-draft-session-delete', { contentId: article.id })).status).toBe(200)
    expect(readContent(article.id).id).toBe(article.id)
    expect(readPublisherSessionOwnership(sessionId)?.status).toBe('retired')
    const next = await host.request('agent-draft-session', { contentId: article.id })
    expect(next.body.sessionId).not.toBe(sessionId)
    expect((await host.request('agent-draft-bind', { contentId: article.id, sessionId })).status).toBe(400)
  })

  it('keeps a failed recycle closed and retryable; field patches preserve concurrent edits', async () => {
    const host = await fixture()
    const article = createContent('article')
    const first = await host.request('content-patch', { id: article.id, revision: article.revision, patch: { title: '手动标题' } })
    expect(first.status).toBe(200)
    const second = await host.request('content-patch', { id: article.id, revision: article.revision, patch: { body: 'Agent 正文' } })
    expect(second.body).toMatchObject({ title: '手动标题', body: 'Agent 正文' })
    const last = await host.request('content-patch', { id: article.id, revision: article.revision, patch: { title: '最后保存的标题' } })
    expect(last.body).toMatchObject({ title: '最后保存的标题', body: 'Agent 正文' })
    await host.request('agent-draft-session', { contentId: article.id })
    host.failArchive(true)
    expect((await host.request('content-delete', { id: article.id })).status).toBe(400)
    expect((await host.request('agent-draft-session', { contentId: article.id })).status).toBe(400)
    expect((await host.request('content-patch', { id: article.id, revision: last.body.revision, patch: { body: '迟到覆盖' } })).status).toBe(400)
    host.failArchive(false)
    expect((await host.request('content-delete', { id: article.id })).status).toBe(200)
    expect((await host.request('content-restore', { id: article.id })).body.body).toBe('Agent 正文')
  })

  it('does not resurrect a conversation removed while its content is in the recycle bin', async () => {
    const host = await fixture()
    const article = createContent('article')
    const opened = await host.request('agent-draft-session', { contentId: article.id })
    const sessionId = opened.body.sessionId
    expect((await host.request('content-delete', { id: article.id })).status).toBe(200)
    expect((await host.request('agent-draft-session-delete', { contentId: article.id })).status).toBe(200)
    expect(readPublisherSessionOwnership(sessionId)?.status).toBe('retired')
    expect((await host.request('content-restore', { id: article.id })).status).toBe(200)
    expect(host.archivedSessionIds).toContain(sessionId)
    expect(readContent(article.id).id).toBe(article.id)
    const reopened = await host.request('agent-draft-session', { contentId: article.id })
    expect(reopened.body.sessionId).not.toBe(sessionId)
  })
})
