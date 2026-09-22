import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import * as plugin from '../src/index.ts'
import { permitted } from '../src/index.ts'
import { listWorks, worksRoot } from '../src/works.ts'
import { API } from '../src/protocol.ts'

const roots: string[] = []
afterEach(() => {for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})
function temp(): string {const root = mkdtempSync(join(tmpdir(), 'ejianbao-publisher-')); roots.push(root); return root}

/** A request shaped the way `permitted` reads one, with loopback defaults. */
function request(headers: Record<string, string>, method = 'POST'): IncomingMessage {
  return {method, headers: {host: '127.0.0.1:43120', ...headers}, socket: {remoteAddress: '127.0.0.1'}} as IncomingMessage
}

describe('the loopback gate', () => {
  it('lets the panel through', () => {
    expect(permitted(request({'x-ejianbao': '1'}))).toBe(true)
    expect(permitted(request({}, 'GET'))).toBe(true)
    expect(permitted(request({'x-ejianbao': '1', origin: 'http://127.0.0.1:43120'}))).toBe(true)
    expect(permitted(request({'x-ejianbao': '1', origin: 'https://127.0.0.1:43120'}))).toBe(true)
    expect(permitted(request({'x-ejianbao': '1', 'sec-fetch-site': 'same-origin'}))).toBe(true)
    expect(permitted({method: 'GET', headers: {host: '127.0.0.1:43120'}, socket: {remoteAddress: '::1'}} as IncomingMessage)).toBe(true)
  })

  it('refuses anything a page in the user’s own browser could reach', () => {
    // No header: a plain form POST from any local page would otherwise land here.
    expect(permitted(request({}))).toBe(false)
    expect(permitted(request({'x-ejianbao': '1', origin: 'https://evil.example'}))).toBe(false)
    expect(permitted(request({'x-ejianbao': '1', 'sec-fetch-site': 'cross-site'}))).toBe(false)
    expect(permitted({method: 'GET', headers: {host: '127.0.0.1:43120'}, socket: {remoteAddress: '10.0.0.7'}} as IncomingMessage)).toBe(false)
    expect(permitted({method: 'GET', headers: {host: '127.0.0.1:43120'}, socket: {}} as IncomingMessage)).toBe(false)
  })
})

describe('reading e剪宝’s finished videos', () => {
  it('offers only tasks that actually produced a 成片', () => {
    const home = temp()
    const written = join(worksRoot({DSH_HOME: home}), 'job-a')
    mkdirSync(written, {recursive: true})
    writeFileSync(join(written, 'job.json'), JSON.stringify({id: 'job-a', createdAt: '2026-09-22T02:00:00.000Z', options: {title: '口播第一条'}}))
    writeFileSync(join(written, 'final_video.mp4'), Buffer.alloc(48, 1))
    // A task still rendering, and a directory that is not a task at all.
    mkdirSync(join(worksRoot({DSH_HOME: home}), 'job-b'), {recursive: true})
    mkdirSync(join(worksRoot({DSH_HOME: home}), 'not-a-job'), {recursive: true})
    const works = listWorks({DSH_HOME: home})
    expect(works).toHaveLength(1)
    expect(works[0]).toMatchObject({id: 'job-a', title: '口播第一条', bytes: 48})
    expect(works[0].file).toContain('final_video.mp4')
    // A machine that has never run e剪宝 has no works root, and that is not an error.
    expect(listWorks({DSH_HOME: join(home, 'nothing-here')})).toEqual([])
  })

  it('falls back to a readable name when the task had no title', () => {
    const home = temp()
    const dir = join(worksRoot({DSH_HOME: home}), 'abcdef1234567890')
    mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'job.json'), JSON.stringify({id: 'abcdef1234567890'}))
    writeFileSync(join(dir, 'final_video.mp4'), Buffer.alloc(8, 1))
    expect(listWorks({DSH_HOME: home})[0].title).toBe('未命名视频 abcdef12')
  })
})

describe('the HTTP surface', () => {
  it('mounts on DSH’s own server and answers the panel’s actions', async () => {
    const home = temp()
    // A stand-in runtime: the environment override is what the desktop host sets,
    // so pointing it at an empty file exercises that path without a 162 MiB child.
    const runtimeDir = temp()
    writeFileSync(join(runtimeDir, 'matrixmedia.exe'), '')
    const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = home
    const previousRuntime = process.env.EJIANBAO_MATRIXMEDIA; process.env.EJIANBAO_MATRIXMEDIA = runtimeDir
    const ctx = new Context()
    try {
      await ctx.plugin(WebServer, {host: '127.0.0.1', port: 0})
      await ctx.plugin({...plugin, inject: ['webServer']})
      const base = `http://127.0.0.1:${String(ctx.webServer.port)}${API}`
      const send = (action: string, body?: unknown) => fetch(`${base}/${action}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {'x-ejianbao': '1', 'content-type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const status = await send('status')
      expect(status.status).toBe(200)
      const runtime = await status.json()
      expect(runtime.ready).toBe(true)
      expect(runtime.source).toBe('EJIANBAO_MATRIXMEDIA')
      expect(runtime.path).toBe(join(runtimeDir, 'matrixmedia.exe'))
      expect(runtime.dataDir).toContain('MatrixMedia')
      expect(await (await send('jobs')).json()).toEqual([])
      expect(await (await send('works')).json()).toEqual([])
      // Validation errors come back as 400 with a sentence the panel can show.
      const rejected = await send('jobs', {file: '成片.mp4', title: '标题', targets: [{platform: 'dy'}]})
      expect(rejected.status).toBe(400)
      expect((await rejected.json()).error).toBe('成片路径必须是绝对路径')
      expect((await send('job?id=missing')).status).toBe(400)
      expect((await send('不存在')).status).toBe(404)
      // The gate applies to the mounted route too, not only to the helper.
      expect((await fetch(`${base}/status`, {headers: {origin: 'https://evil.example'}})).status).toBe(403)
      expect((await fetch(`${base}/jobs`, {method: 'POST', body: '{}'})).status).toBe(403)
    } finally {
      await ctx.fiber.dispose()
      if (previousRuntime === undefined) delete process.env.EJIANBAO_MATRIXMEDIA; else process.env.EJIANBAO_MATRIXMEDIA = previousRuntime
      if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
    }
  }, 30000)
})
