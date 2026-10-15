import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../src/index.ts'
import { contentsRoot, createContent, deleteContent } from '../src/contents.ts'
import { retireAgentDraftSession, writeAgentDraftSession } from '../src/agent-draft-session.ts'
import { ensureAgentWorkspace } from '../src/agent-workspace.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'publisher-reverse-content-'))
  homes.push(home)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  const summaries: Array<{ sessionId: string; origin?: string; cwd?: string }> = []
  const archivedSessionIds: string[] = []
  const workspaces = new Map<string, { path: string }>()
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
  try {
    ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => { handler = undefined }
    } } as never)
    ctx.provide('desktopRuntime', { publisher: {} } as never)
    await ctx.plugin(SessionStore)
    await ctx.plugin({ name: 'reverse-content-services-fixture', apply(serviceCtx) {
      serviceCtx.provide('workspaceRegistry', { archivedSessionIds, get: (id: string) => workspaces.get(id) } as never)
      serviceCtx.provide('sessionController', { list: async () => ({ items: summaries }) } as never)
    } })
    await ctx.plugin(plugin)
    const request = async (sessionId: string, options: { raw?: boolean; remoteAddress?: string } = {}) => {
      const req = Readable.from([]) as IncomingMessage
      Object.assign(req, { method: 'GET',
        url: `/api/cqai-publisher/agent-draft-content/${options.raw ? sessionId : encodeURIComponent(sessionId)}`,
        headers: { host: '127.0.0.1:43120' }, socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' } })
      let status = 0
      let payload = ''
      const res = { headersSent: false, destroyed: false,
        writeHead: (code: number) => { status = code }, end: (value: string) => { payload = value },
      } as unknown as ServerResponse
      if (!handler) throw new Error('Publisher route was not registered')
      await handler(req, res)
      return { status, body: JSON.parse(payload) as Record<string, unknown> }
    }
    const owned = (type: 'article' | 'image-note' | 'video', sessionId: string) => {
      const content = createContent(type)
      const cwd = ensureAgentWorkspace(content.id)
      const workspaceId = 'publishing-workspace'
      workspaces.set(workspaceId, { path: cwd })
      writeAgentDraftSession(content.id, sessionId, process.env, { workspaceId })
      const summary = { sessionId, cwd }
      summaries.push(summary)
      return { content, summary }
    }
    return { request, owned, summaries, archivedSessionIds, workspaces, ctx, home,
      dispose: async () => { await ctx.fiber.dispose()
        if (previousHome === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = previousHome } }
  } catch (error) {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    throw error
  }
}

describe('sidebar publishing conversation reverse lookup', () => {
  it('returns current content for cold unbound publishing sessions of every content type', async () => {
    const test = await fixture()
    try {
      for (const type of ['article', 'image-note', 'video'] as const) {
        const sessionId = `sidebar/${type} 会话`
        const { content } = test.owned(type, sessionId)
        expect(test.ctx.sessions.get(SessionId(sessionId))).toBeUndefined()
        expect(await test.request(sessionId)).toEqual({ status: 200,
          body: { sessionId, contentId: content.id, contentType: type } })
      }
    } finally { await test.dispose() }
  })

  it('never resolves unrelated, unowned, retired, archived, legacy, trashed or subagent sessions', async () => {
    const test = await fixture()
    try {
      const excluded: string[] = ['ordinary', 'missing']
      test.summaries.push({ sessionId: 'ordinary', cwd: test.home })
      const unowned = createContent('article')
      writeFileSync(join(contentsRoot(), unowned.id, 'agent-session.json'), JSON.stringify({ version: 1, sessionId: 'source' }))
      test.summaries.push({ sessionId: 'source', cwd: ensureAgentWorkspace(unowned.id) })
      excluded.push('source')
      const retired = test.owned('article', 'retired')
      retireAgentDraftSession(retired.summary.sessionId)
      excluded.push('retired')
      test.owned('article', 'archived')
      test.archivedSessionIds.push('archived')
      excluded.push('archived')
      const legacy = test.owned('article', 'legacy')
      const manifest = join(contentsRoot(), legacy.content.id, 'manifest.json')
      const legacyContent = JSON.parse(readFileSync(manifest, 'utf8')) as { workflowVersion?: 2 }
      delete legacyContent.workflowVersion
      writeFileSync(manifest, JSON.stringify(legacyContent))
      excluded.push('legacy')
      const trash = test.owned('article', 'trash')
      deleteContent(trash.content.id)
      excluded.push('trash')
      const subagent = test.owned('article', 'subagent')
      Object.assign(subagent.summary, { origin: 'subagent' })
      excluded.push('subagent')
      const pending = test.owned('article', 'pending')
      writeFileSync(join(contentsRoot(), pending.content.id, 'content-lifecycle.json'), JSON.stringify({
        version: 1, operationId: 'test-operation', kind: 'restore', status: 'pending', sessionId: 'pending', restoreSession: true,
      }))
      excluded.push('pending')
      for (const sessionId of excluded) expect(await test.request(sessionId)).toEqual({ status: 200,
        body: { sessionId, contentId: null, contentType: null } })
    } finally { await test.dispose() }
  })

  it('rejects mismatched or unavailable workspace identity without repairing the association', async () => {
    const test = await fixture()
    try {
      const { content, summary } = test.owned('article', 'wrong-cwd')
      const association = join(contentsRoot(), content.id, 'agent-session.json')
      const before = readFileSync(association)
      summary.cwd = test.home
      expect(await test.request(summary.sessionId)).toMatchObject({ status: 200, body: { contentId: null } })
      summary.cwd = ensureAgentWorkspace(content.id)
      test.workspaces.clear()
      expect(await test.request(summary.sessionId)).toMatchObject({ status: 200, body: { contentId: null } })
      expect(readFileSync(association)).toEqual(before)
    } finally { await test.dispose() }
  })

  it('rejects malformed identifiers and remote access', async () => {
    const test = await fixture()
    try {
      expect((await test.request('%E0%A4%A', { raw: true })).status).toBe(400)
      expect((await test.request('bad/path', { raw: true })).status).toBe(400)
      expect((await test.request('bad\u0000id')).status).toBe(400)
      expect((await test.request('ordinary', { remoteAddress: '192.0.2.1' })).status).toBe(403)
    } finally { await test.dispose() }
  })
})
