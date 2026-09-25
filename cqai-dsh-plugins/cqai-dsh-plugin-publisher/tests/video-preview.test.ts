import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.ts'
import { API } from '../src/protocol.ts'
import { serveVideoPreview, videoRange } from '../src/video-preview.ts'
import { worksRoot } from '../src/works.ts'

const WORK_ID = '11111111-1111-4111-8111-111111111111'
const LOCAL_ID = '22222222-2222-4222-8222-222222222222'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('video preview ranges', () => {
  it('accepts a complete stream and single explicit, open, or suffix range', () => {
    expect(videoRange(undefined, 10)).toEqual({ start: 0, end: 9, status: 200 })
    expect(videoRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5, status: 206 })
    expect(videoRange('bytes=7-', 10)).toEqual({ start: 7, end: 9, status: 206 })
    expect(videoRange('bytes=-3', 10)).toEqual({ start: 7, end: 9, status: 206 })
    expect(videoRange('bytes=0-99', 10)).toEqual({ start: 0, end: 9, status: 206 })
  })

  it('rejects invalid or unsatisfiable ranges', () => {
    for (const value of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,2-3', 'items=0-1']) {
      expect(videoRange(value, 10), value).toBeNull()
    }
    expect(videoRange(undefined, 0)).toBeNull()
  })
})

it('streams a local video in bounded chunks without truncating the response', async () => {
  const chunkSize = 1024 * 1024
  const video = Buffer.alloc(chunkSize * 2 + 17, 0x5a)
  const reads: Array<{ offset: number; length: number }> = []
  const local = {
    readLocalVideoChunk: async (_id: string, offset: number, length: number) => {
      reads.push({ offset, length })
      return { ok: true as const, bytes: video.length, dataBase64: video.subarray(offset, offset + length).toString('base64') }
    },
  }
  const server = createServer((req, res) => {
    void serveVideoPreview(req, res, 'local', LOCAL_ID, local).catch(cause => res.destroy(cause))
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器端口无效')
    const response = await fetch(`http://127.0.0.1:${address.port}/video`)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(video)
    expect(reads).toEqual([
      { offset: 0, length: 0 },
      { offset: 0, length: chunkSize },
      { offset: chunkSize, length: chunkSize },
      { offset: chunkSize * 2, length: 17 },
    ])
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

it('streams only validated work and private local selections with seek support', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ebao-video-preview-'))
  roots.push(home)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const video = Buffer.from('0123456789abcdef')
  const directory = join(worksRoot({ DSH_HOME: home }), WORK_ID)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'job.json'), JSON.stringify({ id: WORK_ID }))
  writeFileSync(join(directory, 'final_video.mp4'), video)
  const reads: Array<{ id: string; offset: number; length: number }> = []
  let changed = false
  const publisher = {
    status: () => ({ supported: true, running: false }),
    selectLocalVideo: async () => null,
    request: async () => [],
    readLocalVideoChunk: async (id: string, offset: number, length: number) => {
      reads.push({ id, offset, length })
      if (changed) return { ok: false, code: 'video-file-changed', message: '/private/secret.mp4' }
      return { ok: true, bytes: video.length, dataBase64: video.subarray(offset, offset + length).toString('base64') }
    },
  }
  const ctx = new Context()
  try {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    ctx.provide('desktopRuntime', { publisher } as never)
    await ctx.plugin(plugin)
    const base = `http://127.0.0.1:${String(ctx.webServer.port)}${API}/video-preview`
    const work = await fetch(`${base}/work/${WORK_ID}`, { headers: { Range: 'bytes=2-5' } })
    expect(work.status).toBe(206)
    expect(work.headers.get('content-range')).toBe('bytes 2-5/16')
    expect(work.headers.get('accept-ranges')).toBe('bytes')
    expect(work.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await work.arrayBuffer())).toEqual(video.subarray(2, 6))

    const local = await fetch(`${base}/local/${LOCAL_ID}`)
    expect(local.status).toBe(200)
    expect(local.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await local.arrayBuffer())).toEqual(video)
    expect(reads[0]).toEqual({ id: LOCAL_ID, offset: 0, length: 0 })
    const suffix = await fetch(`${base}/local/${LOCAL_ID}`, { headers: { Range: 'bytes=-4' } })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-range')).toBe('bytes 12-15/16')
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(video.subarray(12))

    const invalid = await fetch(`${base}/local/${LOCAL_ID}`, { headers: { Range: 'bytes=20-' } })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */16')
    expect((await fetch(`${base}/work/${LOCAL_ID}`)).status).toBe(404)
    expect((await fetch(`${base}/local/${LOCAL_ID}`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    changed = true
    const stale = await fetch(`${base}/local/${LOCAL_ID}`)
    expect(stale.status).toBe(409)
    expect(await stale.text()).not.toContain('/private/secret.mp4')
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
}, 30_000)
