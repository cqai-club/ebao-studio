import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import * as plugin from '../src/index.ts'
import { permitted } from '../src/index.ts'
import { API, type PublisherAccount } from '../src/protocol.ts'
import { listWorks, resolveWork, worksRoot } from '../src/works.ts'

const WORK_ID = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const LOCAL_VIDEO_ID = '44444444-4444-4444-8444-444444444444'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function temp(): string { const root = mkdtempSync(join(tmpdir(), 'ebao-publisher-')); roots.push(root); return root }

function request(headers: Record<string, string>, method = 'POST'): IncomingMessage {
  return { method, headers: { host: '127.0.0.1:43120', ...headers }, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage
}

function writeWork(home: string, id = WORK_ID): string {
  const directory = join(worksRoot({ DSH_HOME: home }), id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'job.json'), JSON.stringify({
    id, createdAt: '2026-09-22T02:00:00.000Z', options: { title: '任务标题' },
  }))
  writeFileSync(join(directory, 'final_video.mp4'), Buffer.alloc(48, 1))
  writeFileSync(join(directory, 'publish_package_handoff.json'), JSON.stringify({
    video: '/tmp/untrusted.mp4', title: '发布标题', description: '发布简介',
    tags: ['AI', '#口播'], ai_generated_disclosure: '本视频包含 AI 生成内容',
  }))
  return directory
}

describe('the loopback gate', () => {
  it('allows same-origin reads and explicitly marked writes', () => {
    expect(permitted(request({ 'x-ejianbao': '1' }))).toBe(true)
    expect(permitted(request({}, 'GET'))).toBe(true)
    expect(permitted(request({ 'x-ejianbao': '1', origin: 'http://127.0.0.1:43120' }))).toBe(true)
    expect(permitted(request({ 'x-ejianbao': '1', origin: 'https://127.0.0.1:43120' }))).toBe(true)
    expect(permitted({ method: 'GET', headers: { host: '127.0.0.1:43120' }, socket: { remoteAddress: '::1' } } as IncomingMessage)).toBe(true)
  })

  it('refuses cross-site, remote, and unmarked writes', () => {
    expect(permitted(request({}))).toBe(false)
    expect(permitted(request({ 'x-ejianbao': '1', origin: 'https://evil.example' }))).toBe(false)
    expect(permitted(request({ 'x-ejianbao': '1', 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(permitted({ method: 'GET', headers: { host: '127.0.0.1:43120' }, socket: { remoteAddress: '10.0.0.7' } } as IncomingMessage)).toBe(false)
  })
})

describe('e剪宝 work resolution', () => {
  it('uses the canonical final_video.mp4 and exposes handoff metadata without a path', () => {
    const home = temp()
    const directory = writeWork(home)
    const work = resolveWork(WORK_ID, { DSH_HOME: home })
    expect(work.file).toBe(realpathSync(join(directory, 'final_video.mp4')))
    expect(work).toMatchObject({ title: '发布标题', description: '发布简介', tags: ['AI', '口播'], bytes: 48 })
    const listed = listWorks({ DSH_HOME: home })
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('file')
  })

  it('rejects invalid ids and a final video symlink escaping the job', () => {
    const home = temp()
    expect(() => resolveWork('../../etc/passwd', { DSH_HOME: home })).toThrow('作品 ID 无效')
    mkdirSync(worksRoot({ DSH_HOME: home }), { recursive: true })
    expect(() => resolveWork(WORK_ID, { DSH_HOME: home })).toThrow('作品成片不存在')
    const directory = join(worksRoot({ DSH_HOME: home }), WORK_ID)
    const outside = join(home, 'outside.mp4')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'job.json'), JSON.stringify({ id: WORK_ID }))
    writeFileSync(outside, 'video')
    symlinkSync(outside, join(directory, 'final_video.mp4'))
    expect(() => resolveWork(WORK_ID, { DSH_HOME: home })).toThrow('作品成片不存在')
    expect(listWorks({ DSH_HOME: home })).toEqual([])
  })
})

describe('the Host publisher route', () => {
  it('forwards only validated work ids and sanitizes Worker data', async () => {
    const home = temp()
    const directory = writeWork(home)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const calls: Array<{ method: string; params: unknown }> = []
    const account: PublisherAccount = {
      id: ACCOUNT_ID, displayName: '品牌主账号', platform: 'dy', loginState: 'logged-in',
    }
    const publisher = {
      status: () => ({ supported: true, running: false }),
      selectLocalVideo: async () => ({ id: LOCAL_VIDEO_ID, fileName: '本地视频.mp4', title: '本地视频', bytes: 123 }),
      request: async (method: string, params: unknown = {}) => {
        calls.push({ method, params })
        if (method === 'accounts.list') return [account]
        if (method === 'system.capabilities') return [{
          platform: 'dy', contentTypes: ['video'],
          modes: { video: ['publish', 'draft'] }, requiredFields: {},
        }]
        if (method === 'accounts.importPreview') return {
          sourceData: '/private/source', sourceProfile: '/private/profile', running: false,
          accounts: [{ displayName: '旧账号', platform: 'dy', platformName: '抖音', partition: 'secret' }],
        }
        if (method === 'submissions.list') return []
        if (method === 'submissions.create') return {
          accepted: true,
          submission: {
            id: '33333333-3333-4333-8333-333333333333', createdAt: '2026-09-22T03:00:00.000Z',
            contentId: WORK_ID, contentType: 'video', workId: WORK_ID, title: '发布标题', mode: 'draft',
            targets: [{ accountId: ACCOUNT_ID, platform: 'dy', accountName: '品牌主账号' }],
          },
        }
        return { ok: true }
      },
    }
    const ctx = new Context()
    try {
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      ctx.provide('desktopRuntime', { publisher } as never)
      await ctx.plugin(plugin)
      const base = `http://127.0.0.1:${String(ctx.webServer.port)}${API}`
      const send = (action: string, body?: unknown) => fetch(`${base}/${action}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-ejianbao': '1', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      expect(await (await send('capability')).json()).toEqual({ supported: true, running: false })
      const publicWorks = await (await send('works')).json() as unknown[]
      expect(publicWorks).toHaveLength(1)
      expect(publicWorks[0]).not.toHaveProperty('file')

      const preview = await (await send('import-preview')).json()
      expect(preview).toEqual({
        running: false,
        accounts: [{ displayName: '旧账号', platform: 'dy', platformName: '抖音' }],
      })

      const accepted = await send('submissions', {
        workId: WORK_ID, title: '发布标题', description: '简介', tags: ['AI'],
        creativeStatement: 'ai_generated', mode: 'draft', accountIds: [ACCOUNT_ID],
      })
      expect(accepted.status).toBe(202)
      const create = calls.find(call => call.method === 'submissions.create')
      expect(create?.params).toMatchObject({
        workId: WORK_ID, file: realpathSync(join(directory, 'final_video.mp4')), mode: 'draft', accountIds: [ACCOUNT_ID],
      })

      const chosen = await send('local-video-select', {})
      expect(chosen.status).toBe(200)
      expect(await chosen.json()).toEqual({ id: LOCAL_VIDEO_ID, fileName: '本地视频.mp4', title: '本地视频', bytes: 123 })
      const localAccepted = await send('submissions', {
        contentType: 'video', localVideoId: LOCAL_VIDEO_ID, title: '本地视频', mode: 'draft', accountIds: [ACCOUNT_ID],
      })
      expect(localAccepted.status).toBe(202)
      const localCreate = calls.filter(call => call.method === 'submissions.create').at(-1)?.params as Record<string, unknown>
      expect(localCreate).toMatchObject({ localVideoId: LOCAL_VIDEO_ID, title: '本地视频' })
      expect(localCreate).not.toHaveProperty('file')
      expect(localCreate).not.toHaveProperty('workId')

      const beforeRejected = calls.filter(call => call.method === 'submissions.create').length
      const rejected = await send('submissions', {
        workId: WORK_ID, file: '/tmp/attacker.mp4', title: '标题', mode: 'publish', accountIds: [ACCOUNT_ID],
      })
      expect(rejected.status).toBe(400)
      expect((await rejected.json()).error).toContain('不支持的字段')
      expect((await send('submissions', {
        workId: WORK_ID, localVideoId: LOCAL_VIDEO_ID, title: '标题', mode: 'draft', accountIds: [ACCOUNT_ID],
      })).status).toBe(400)
      expect((await send('submissions', {
        title: '标题', mode: 'draft', accountIds: [ACCOUNT_ID],
      })).status).toBe(400)
      expect((await send('local-video-select', { file: '/tmp/attacker.mp4' })).status).toBe(400)
      expect(calls.filter(call => call.method === 'submissions.create')).toHaveLength(beforeRejected)

      expect((await send('jobs')).status).toBe(404)
      expect((await send('history')).status).toBe(404)
      expect((await fetch(`${base}/capability`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
      expect((await fetch(`${base}/accounts`, { method: 'POST', body: '{}' })).status).toBe(403)
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  }, 30_000)

  it('owns draft files, previews binary assets and forwards only a resolved content package', async () => {
    const home = temp()
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const calls: Array<{ method: string; params: unknown }> = []
    let articleEnabled = true
    const account: PublisherAccount = {
      id: ACCOUNT_ID, displayName: '掘金主账号', platform: 'juejin', loginState: 'logged-in',
    }
    const publisher = {
      status: () => ({ supported: true, running: true }),
      request: async (method: string, params: unknown = {}) => {
        calls.push({ method, params })
        if (method === 'accounts.list') return [account]
        if (method === 'system.capabilities') return articleEnabled ? [{
          platform: 'juejin', contentTypes: ['article'],
          modes: { article: ['publish', 'draft'] }, requiredFields: { article: ['category'] },
        }] : []
        if (method === 'submissions.create') return {
          accepted: true, submission: {
            id: '33333333-3333-4333-8333-333333333333', contentId: (params as { contentId: string }).contentId,
            contentType: 'article', title: '文章', mode: 'draft', createdAt: new Date().toISOString(),
            targets: [{ accountId: ACCOUNT_ID, accountName: '掘金主账号', platform: 'juejin' }],
          },
        }
        return []
      },
    }
    const ctx = new Context()
    try {
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      ctx.provide('desktopRuntime', { publisher } as never)
      await ctx.plugin(plugin)
      const base = `http://127.0.0.1:${String(ctx.webServer.port)}${API}`
      const send = (action: string, body: unknown) => fetch(`${base}/${action}`, {
        method: 'POST', headers: { 'x-ejianbao': '1', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const created = await (await send('contents', { contentType: 'article' })).json() as { id: string; revision: number }
      const saved = await (await send('content-save', {
        id: created.id, revision: created.revision, title: '文章', body: '# 正文',
        summary: '', tags: ['AI'], creativeStatement: 'none',
        platformFields: { juejin: { category: '前端' } },
      })).json() as { revision: number }
      expect(saved.revision).toBe(2)
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
      const uploaded = await fetch(`${base}/content-asset-upload/${created.id}`, {
        method: 'POST', headers: {
          'x-ejianbao': '1', 'x-publisher-file-name': encodeURIComponent('封面.png'),
          'content-type': 'application/octet-stream',
        },
        body: png,
      })
      expect(uploaded.status).toBe(201)
      const withAsset = await uploaded.json() as { revision: number; assets: Array<{ id: string }> }
      const image = await fetch(`${base}/content-asset/${created.id}/${withAsset.assets[0]!.id}`)
      expect(image.headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(await image.arrayBuffer())).toEqual(png)
      const invalid = await send('submissions', {
        contentType: 'article', contentId: created.id, revision: saved.revision,
        mode: 'draft', accountIds: [ACCOUNT_ID],
      })
      expect(invalid.status).toBe(400)
      expect(calls.filter(call => call.method === 'submissions.create')).toHaveLength(0)
      const accepted = await send('submissions', {
        contentType: 'article', contentId: created.id, revision: withAsset.revision,
        mode: 'draft', accountIds: [ACCOUNT_ID],
      })
      expect(accepted.status).toBe(202)
      const forwarded = calls.find(call => call.method === 'submissions.create')?.params as Record<string, unknown>
      expect(forwarded).toMatchObject({ contentId: created.id, contentType: 'article', revision: withAsset.revision })
      expect(String(forwarded.contentDirectory)).toContain(join('publisher', 'contents', created.id))
      expect(forwarded).not.toHaveProperty('file')
      const attacker = await send('submissions', {
        contentType: 'article', contentId: created.id, revision: withAsset.revision,
        mode: 'draft', accountIds: [ACCOUNT_ID], contentDirectory: '/tmp/attacker',
      })
      expect(attacker.status).toBe(400)
      articleEnabled = false
      const disabled = await send('submissions', {
        contentType: 'article', contentId: created.id, revision: withAsset.revision,
        mode: 'draft', accountIds: [ACCOUNT_ID],
      })
      expect(disabled.status).toBe(400)
      expect(calls.filter(call => call.method === 'submissions.create')).toHaveLength(1)
      const malformed = await fetch(`${base}/content-save`, {
        method: 'POST', headers: { 'x-ejianbao': '1', 'content-type': 'application/json' }, body: '{bad',
      })
      expect(malformed.status).toBe(400)
      expect((await malformed.json() as { error: string }).error).toContain('JSON')
      const oversized = await fetch(`${base}/content-save`, {
        method: 'POST', headers: { 'x-ejianbao': '1', 'content-type': 'application/json' }, body: `{"body":"${'x'.repeat(4 * 1024 * 1024)}"}`,
      })
      expect(oversized.status).toBe(400)
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  }, 30_000)
})
