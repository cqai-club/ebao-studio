import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.ts'
import { createContent } from '../src/contents.ts'
import { writeAgentDraftSession } from '../src/agent-draft-session.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

describe('article Agent drawer binding route', () => {
  it('resolves cold sessions and archive state from sibling Cordis services', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ebao-agent-sibling-route-'))
    homes.push(home)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    try {
      const sessionId = 'publisher-cold-sibling-session'
      const archivedSessionIds: string[] = []
      let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
      ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
        handler = route.handler
        return () => { handler = undefined }
      } } as never)
      ctx.provide('desktopRuntime', { publisher: {} } as never)
      await ctx.plugin(SessionStore)
      // These are sibling plugin services, as they are in the shipped Host.
      // Root-level ctx.provide would bypass Cordis's inject guard in this test.
      await ctx.plugin({
        name: 'publisher-sibling-services-fixture',
        apply(serviceCtx) {
          serviceCtx.provide('workspaceRegistry', { archivedSessionIds } as never)
          serviceCtx.provide('sessionController', {
            list: async () => ({ items: [{ sessionId }] }),
          } as never)
        },
      })
      await ctx.plugin(plugin)
      const article = createContent('article')
      writeAgentDraftSession(article.id, sessionId)
      expect(ctx.sessions.get(SessionId(sessionId))).toBeUndefined()

      const request = async (method: 'GET' | 'POST') => {
        const body = method === 'POST' ? Buffer.from(JSON.stringify({ sessionId, contentId: article.id })) : null
        const req = Readable.from(body ? [body] : []) as IncomingMessage
        Object.assign(req, {
          method,
          url: method === 'GET'
            ? `/api/cqai-publisher/agent-draft-session/${article.id}`
            : '/api/cqai-publisher/agent-draft-bind',
          headers: { host: '127.0.0.1:43120', ...(body ? {
            'x-ejianbao': '1', 'content-type': 'application/json',
          } : {}) },
          socket: { remoteAddress: '127.0.0.1' },
        })
        let status = 0
        let payload = ''
        const res = { headersSent: false, destroyed: false,
          writeHead: (code: number) => { status = code },
          end: (value: string) => { payload = value },
        } as unknown as ServerResponse
        if (!handler) throw new Error('Publisher route was not registered')
        await handler(req, res)
        return { status, body: JSON.parse(payload) as Record<string, unknown> }
      }

      expect(await request('GET')).toEqual({ status: 200,
        body: { contentId: article.id, sessionId } })
      expect(await request('POST')).toMatchObject({ status: 200,
        body: { contentId: article.id, sessionId } })
      archivedSessionIds.push(sessionId)
      expect(await request('GET')).toEqual({ status: 200,
        body: { contentId: article.id, sessionId: null } })
      expect(await request('POST')).toMatchObject({ status: 400,
        body: { error: '当前 Agent 会话不存在或不可用于编辑' } })
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('uses a persisted top-level session and invalidates the previous binding', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ebao-agent-bind-route-'))
    homes.push(home)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    try {
      const sessionId = 'publisher-agent-session'
      const coldSessionId = 'publisher-cold-session'
      const visibleSessionIds = new Set([sessionId, coldSessionId])
      let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
      ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
        handler = route.handler
        return () => { handler = undefined }
      } } as never)
      const archivedSessionIds: string[] = []
      ctx.provide('workspaceRegistry', { archivedSessionIds } as never)
      ctx.provide('sessionController', {
        list: async () => ({ items: [...visibleSessionIds].map(id => ({ sessionId: id })) }),
      } as never)
      await ctx.plugin(SessionStore)
      ctx.provide('desktopRuntime', { publisher: {} } as never)
      await ctx.plugin(plugin)
      ctx.sessions.create(SessionId(sessionId))
      const article = createContent('article')
      const second = createContent('article')
      const coldArticle = createContent('article')
      const imageNote = createContent('image-note')
      const bind = async (body: unknown) => {
        const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
        Object.assign(req, { method: 'POST', url: '/api/cqai-publisher/agent-draft-bind',
          headers: { host: '127.0.0.1:43120', 'x-ejianbao': '1', 'content-type': 'application/json' },
          socket: { remoteAddress: '127.0.0.1' } })
        let status = 0
        let payload = ''
        const res = { headersSent: false, destroyed: false,
          writeHead: (code: number) => { status = code },
          end: (value: string) => { payload = value },
        } as unknown as ServerResponse
        if (!handler) throw new Error('Publisher route was not registered')
        await handler(req, res)
        return { status, body: JSON.parse(payload) as Record<string, unknown> }
      }
      const associated = async (contentId: string) => {
        const req = Readable.from([]) as IncomingMessage
        Object.assign(req, { method: 'GET', url: `/api/cqai-publisher/agent-draft-session/${contentId}`,
          headers: { host: '127.0.0.1:43120' }, socket: { remoteAddress: '127.0.0.1' } })
        let status = 0
        let payload = ''
        const res = { headersSent: false, destroyed: false,
          writeHead: (code: number) => { status = code },
          end: (value: string) => { payload = value },
        } as unknown as ServerResponse
        if (!handler) throw new Error('Publisher route was not registered')
        await handler(req, res)
        return { status, body: JSON.parse(payload) as Record<string, unknown> }
      }
      expect(await associated(article.id)).toEqual({ status: 200, body: { contentId: article.id, sessionId: null } })
      expect(await bind({ sessionId: 'missing', contentId: article.id })).toMatchObject({
        status: 400, body: { error: '当前 Agent 会话不存在或不可用于编辑' },
      })
      expect(await bind({ sessionId, contentId: imageNote.id })).toMatchObject({
        status: 400, body: { error: '当前 Agent 只支持编辑文章草稿' },
      })
      const first = await bind({ sessionId, contentId: article.id })
      expect(first).toMatchObject({ status: 200, body: { sessionId, contentId: article.id } })
      expect(first.body.bindingToken).toMatch(/^[0-9a-f-]{36}$/u)
      expect(await associated(article.id)).toEqual({ status: 200, body: { contentId: article.id, sessionId } })
      const switched = await bind({ sessionId, contentId: second.id })
      expect(switched).toMatchObject({ status: 200, body: { sessionId, contentId: second.id } })
      expect(switched.body.bindingToken).not.toBe(first.body.bindingToken)
      expect(await associated(second.id)).toEqual({ status: 200, body: { contentId: second.id, sessionId } })
      // A persisted conversation need not be attached to the live Session Store.
      writeAgentDraftSession(coldArticle.id, coldSessionId)
      expect(ctx.sessions.get(SessionId(coldSessionId))).toBeUndefined()
      expect(await associated(coldArticle.id)).toEqual({ status: 200,
        body: { contentId: coldArticle.id, sessionId: coldSessionId } })
      expect(await bind({ sessionId: coldSessionId, contentId: coldArticle.id })).toMatchObject({ status: 200,
        body: { contentId: coldArticle.id, sessionId: coldSessionId } })
      archivedSessionIds.push(sessionId)
      expect(await associated(second.id)).toEqual({ status: 200, body: { contentId: second.id, sessionId: null } })
      expect(await bind({ sessionId, contentId: article.id })).toMatchObject({ status: 400,
        body: { error: '当前 Agent 会话不存在或不可用于编辑' } })
      archivedSessionIds.pop()
      writeAgentDraftSession(article.id, 'missing')
      expect(await associated(article.id)).toEqual({ status: 200, body: { contentId: article.id, sessionId: null } })
      expect(await bind({ sessionId, contentId: null })).toMatchObject({ status: 400 })
      expect(await bind({ sessionId, contentId: null, bindingToken: first.body.bindingToken })).toEqual({
        status: 200, body: { sessionId, contentId: null, bindingToken: null },
      })
      expect(await bind({ sessionId, contentId: null, bindingToken: switched.body.bindingToken })).toEqual({
        status: 200, body: { sessionId, contentId: null, bindingToken: null },
      })
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })
})
