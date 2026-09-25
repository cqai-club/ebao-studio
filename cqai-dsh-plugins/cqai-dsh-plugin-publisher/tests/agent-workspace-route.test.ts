import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../src/index.ts'
import { createContent } from '../src/contents.ts'
import { ensureAgentWorkspace } from '../src/agent-workspace.ts'
import { ensureProjectWorkspace } from '../src/project-workspace.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'ebao-agent-workspace-'))
  homes.push(path)
  return path
}

describe('article Agent project Workspace route', () => {
  it('uses the article project directory and rejects image-note drafts', () => {
    const root = home()
    const env = { DSH_HOME: root }
    const article = createContent('article', env)
    const imageNote = createContent('image-note', env)
    const first = ensureAgentWorkspace(article.id, env)
    expect(first).toBe(ensureProjectWorkspace(article.id, env).path)
    expect(first).toBe(realpathSync(join(root, 'publisher', 'projects', 'article', article.id)))
    expect(() => ensureAgentWorkspace(imageNote.id, env)).toThrow('只支持编辑文章草稿')
  })

  it('requires the content ID and same-origin mutation header', async () => {
    const root = home()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const article = createContent('article')
    const imageNote = createContent('image-note')
    const ctx = new Context()
    try {
      let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
      ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
        handler = route.handler
        return () => { handler = undefined }
      } } as never)
      ctx.provide('desktopRuntime', { publisher: {} } as never)
      await ctx.plugin(plugin)
      const request = async (method: 'GET' | 'POST', body: unknown = {}, headers: Record<string, string> = {}) => {
        const req = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []) as IncomingMessage
        Object.assign(req, {
          method, url: '/api/cqai-publisher/agent-workspace',
          headers: { host: '127.0.0.1:43120', ...headers },
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
      expect((await request('GET')).status).toBe(404)
      expect((await request('POST', { contentId: article.id })).status).toBe(403)
      expect((await request('POST', { contentId: article.id },
        { 'x-ejianbao': '1', origin: 'https://evil.example' })).status).toBe(403)
      expect((await request('POST', {}, { 'x-ejianbao': '1' })).status).toBe(400)
      expect((await request('POST', { contentId: imageNote.id }, { 'x-ejianbao': '1' })).status).toBe(400)
      const opened = await request('POST', { contentId: article.id }, { 'x-ejianbao': '1' })
      expect(opened).toEqual({ status: 200, body: { path: ensureAgentWorkspace(article.id) } })
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
