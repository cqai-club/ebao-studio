import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as publisher from '../src/index.ts'
import { API } from '../src/protocol.ts'
import { listContents } from '../src/contents.ts'
import { preparePublicationCandidate } from '../src/publication-candidates.ts'
import { registerSourceDocument } from '../src/source-documents.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('file-first conversation route', () => {
  it('imports a registered source into one reusable article draft without submitting, and rejects missing or stale sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ebao-source-import-'))
    roots.push(root)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, 'dsh')
    const markdown = join(root, 'article.md')
    writeFileSync(markdown, '# 原稿标题\n\n原稿正文')
    const calls: string[] = []
    const runtime = {
      status: () => ({ supported: true, running: true }),
      request: async (method: string) => { calls.push(method); return [] },
    }
    const ctx = new Context()
    try {
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      ctx.provide('desktopRuntime', { publisher: runtime } as never)
      await ctx.plugin(publisher)
      const base = `http://127.0.0.1:${String(ctx.webServer.port)}${API}`
      const openSource = (sessionId: string, sourceRevision: string) => fetch(`${base}/publication-open-source`, {
        method: 'POST', headers: { 'x-ejianbao': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, sourceRevision }),
      })

      const missing = await openSource('session-1', '0'.repeat(64))
      expect(missing.status).toBe(400)
      expect((await missing.json() as { error: string }).error).toMatch(/原稿|源文档/)
      expect(listContents(process.env)).toEqual([])

      const oldSource = registerSourceDocument('session-1', markdown, process.env, { allowedRoot: root })
      writeFileSync(markdown, '# 更新标题\n\n更新正文')
      const stale = await openSource('session-1', oldSource.revision)
      expect(stale.status).toBe(400)
      expect((await stale.json() as { error: string }).error).toMatch(/变化|更新|修订/)
      expect(listContents(process.env)).toEqual([])

      const source = registerSourceDocument('session-1', markdown, process.env, { allowedRoot: root })
      const first = await openSource('session-1', source.revision)
      expect(first.status).toBe(201)
      const article = await first.json() as { id: string; contentType: string; title: string; body: string }
      expect(article).toMatchObject({ contentType: 'article', title: '更新标题', body: '更新正文' })
      expect(listContents(process.env)).toHaveLength(1)

      const second = await openSource('session-1', source.revision)
      expect(second.status).toBe(201)
      expect((await second.json() as { id: string }).id).toBe(article.id)
      expect(listContents(process.env)).toHaveLength(1)

      writeFileSync(markdown, '# 再次更新\n\n新正文')
      const staleAfterImport = await openSource('session-1', source.revision)
      expect(staleAfterImport.status).toBe(400)
      expect((await staleAfterImport.json() as { error: string }).error).toMatch(/变化|更新|修订/)
      expect(listContents(process.env)).toHaveLength(1)
      expect(calls).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  }, 30_000)

  it('shows original MD and referenced images before creating a preparation on Publish', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ebao-source-route-'))
    roots.push(root)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, 'dsh')
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    writeFileSync(join(root, 'image.png'), image)
    const markdown = join(root, 'article.md')
    writeFileSync(markdown, '# 标题\n\n正文 ![图](image.png)')
    const calls: string[] = []
    const runtime = {
      status: () => ({ supported: true, running: true }),
      request: async (method: string) => { calls.push(method); return [] },
    }
    const ctx = new Context()
    try {
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      ctx.provide('desktopRuntime', { publisher: runtime } as never)
      await ctx.plugin(publisher)
      const base = `http://127.0.0.1:${String(ctx.webServer.port)}${API}`
      const readPreview = () => fetch(`${base}/session-preview/session-1`)
      expect(await (await readPreview()).json()).toEqual({ sessionId: 'session-1', source: null, candidate: null })
      const source = registerSourceDocument('session-1', markdown, process.env, { allowedRoot: root })
      const first = await (await readPreview()).json() as { source: { body: string; images: Array<{ id: string }> }; candidate: unknown }
      expect(first.source.body).toContain('source-image://')
      expect(JSON.stringify(first)).not.toContain(root)
      expect(first.candidate).toBeNull()
      const result = await fetch(`${base}/source-image/${source.id}/${source.images[0]!.id}`)
      expect(result.headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(await result.arrayBuffer())).toEqual(image)
      expect(listContents(process.env)).toEqual([])
      const candidate = preparePublicationCandidate('session-1', {
        sourceId: source.id, sourceRevision: source.revision, contentType: 'article', platforms: ['juejin'],
      }, process.env)
      const prepared = await (await readPreview()).json() as { candidate: { id: string } }
      expect(prepared.candidate.id).toBe(candidate.id)
      expect(listContents(process.env)).toEqual([])
      const open = () => fetch(`${base}/publication-open`, {
        method: 'POST', headers: { 'x-ejianbao': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-1', candidateId: candidate.id }),
      })
      const publication = await (await open()).json() as { id: string; body: string; assets: unknown[] }
      expect(publication.body).toContain('ebao-asset://')
      expect(publication.assets).toHaveLength(1)
      expect(listContents(process.env)).toHaveLength(1)
      expect((await (await open()).json() as { id: string }).id).toBe(publication.id)
      expect(calls).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  }, 30_000)
})
