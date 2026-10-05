import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import * as plugin from '../src/index.ts'
import { contentsRoot, createContent, saveContent } from '../src/contents.ts'
import { ensureAgentWorkspace } from '../src/agent-workspace.ts'
import { ensureProjectWorkspace, readProjectSettings, saveProjectSettings } from '../src/project-workspace.ts'
import { readAgentDraftSession, writeAgentDraftSession } from '../src/agent-draft-session.ts'
import { readSessionContent, sessionContentsRoot } from '../src/session-contents.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'ebao-agent-workspace-'))
  homes.push(path)
  return path
}

describe('draft Agent project Workspace route', () => {
  it('uses each draft project directory for article, image-note, and video', () => {
    const root = home()
    const env = { DSH_HOME: root }
    const article = createContent('article', env, '重庆春日游')
    const imageNote = createContent('image-note', env, '山城图集')
    const video = createContent('video', env, '夜景视频')
    const first = ensureAgentWorkspace(article.id, env)
    expect(first).toBe(ensureProjectWorkspace(article.id, env).path)
    const projectsRoot = readProjectSettings(env).defaultRoot
    for (const [draft, prefix] of [[article, '文章-重庆春日游'], [imageNote, '图文-山城图集'], [video, '视频-夜景视频']] as const) {
      const path = ensureAgentWorkspace(draft.id, env)
      expect(path).toBe(realpathSync(path))
      expect(dirname(path)).toBe(join(projectsRoot, draft.contentType))
      expect(basename(path)).toMatch(new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{8}$`, 'u'))
      writeFileSync(join(path, 'Agent输出.md'), `# ${draft.title}`)
      expect(readFileSync(join(path, 'Agent输出.md'), 'utf8')).toBe(`# ${draft.title}`)
    }
  })

  it('reopens a v1 UUID workspace and keeps both historical session associations', () => {
    const env = { DSH_HOME: realpathSync(home()) }
    const draft = createContent('article', env, '历史文章')
    const projectsRoot = readProjectSettings(env).defaultRoot
    rmSync(ensureProjectWorkspace(draft.id, env).path, { recursive: true })
    const legacy = join(projectsRoot, 'article', draft.id)
    mkdirSync(legacy)
    writeFileSync(join(legacy, '旧对话原稿.md'), '# 保留历史资料')
    const binding = join(contentsRoot(env), draft.id, 'project-workspace.json')
    writeFileSync(binding, JSON.stringify({ version: 1, root: projectsRoot }))
    const bindingBefore = readFileSync(binding, 'utf8')

    const sessionId = 'historical-session'
    writeAgentDraftSession(draft.id, sessionId, env)
    const associations = sessionContentsRoot(env)
    mkdirSync(associations, { recursive: true })
    const association = join(associations, `${createHash('sha256').update(sessionId).digest('hex')}.json`)
    writeFileSync(association, JSON.stringify({ version: 1, sessionId, contentId: draft.id }))
    const associationBefore = readFileSync(association, 'utf8')
    saveProjectSettings(realpathSync(home()), env)
    const edited = saveContent(draft.id, {
      revision: draft.revision, title: '历史标题修改', body: '历史正文', summary: '', tags: [], creativeStatement: 'none',
    }, env)

    expect(ensureAgentWorkspace(draft.id, env)).toBe(legacy)
    expect(ensureProjectWorkspace(draft.id, env)).toEqual({ contentId: draft.id, path: legacy })
    expect(readFileSync(join(legacy, '旧对话原稿.md'), 'utf8')).toBe('# 保留历史资料')
    expect(readFileSync(binding, 'utf8')).toBe(bindingBefore)
    expect(readAgentDraftSession(draft.id, env)).toBe(sessionId)
    expect(readSessionContent(sessionId, env)).toEqual({ sessionId, contentId: draft.id, revision: edited.revision, content: edited })
    expect(readFileSync(association, 'utf8')).toBe(associationBefore)
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
      expect(await request('POST', { contentId: imageNote.id }, { 'x-ejianbao': '1' }))
        .toEqual({ status: 200, body: { path: ensureAgentWorkspace(imageNote.id) } })
      const opened = await request('POST', { contentId: article.id }, { 'x-ejianbao': '1' })
      expect(opened).toEqual({ status: 200, body: { path: ensureAgentWorkspace(article.id) } })
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
