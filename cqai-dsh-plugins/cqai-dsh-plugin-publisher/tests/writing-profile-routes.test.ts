import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import * as publisher from '../src/index.ts'
import { readWritingProfile, updateWritingProfile } from '../src/writing-profile.ts'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs() })

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'publisher-writing-profile-routes-'))
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
  const worker = vi.fn()
  ctx.provide('webServer', { register: (route: { handler: typeof handler }) => {
    handler = route.handler
    return () => { handler = undefined }
  } } as never)
  ctx.provide('desktopRuntime', { publisher: { request: worker } } as never)
  await ctx.plugin(publisher)
  const request = async (method: 'GET' | 'POST', body?: unknown, headers: Record<string, string> = {}, remoteAddress = '127.0.0.1') => {
    const req = Object.assign(Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []), {
      method, url: '/api/cqai-publisher/writing-profile',
      headers: { host: '127.0.0.1:43120', ...headers }, socket: { remoteAddress },
    }) as IncomingMessage
    let status = 0
    let payload = ''
    const res = { headersSent: false, destroyed: false,
      writeHead: (code: number) => { status = code }, end: (value: string) => { payload = value },
    } as unknown as ServerResponse
    if (!handler) throw new Error('Publisher route is unavailable')
    await handler(req, res)
    return { status, body: JSON.parse(payload) as Record<string, unknown> }
  }
  const file = join(home, 'publisher', 'writing-profile.json')
  return { home, file, request, worker }
}

describe('Publisher writing profile settings routes', () => {
  it('reads the stored rules even when disabled, edits both fields and preserves rules when toggling', async () => {
    const test = await fixture()
    expect(await test.request('GET')).toEqual({ status: 200, body: { revision: 0, instructions: null, enabled: true } })
    expect(existsSync(test.file)).toBe(false)
    expect(await test.request('POST', { expected_revision: 0, instructions: '先说结论，保留出处。', enabled: false }, { 'x-ejianbao': '1' }))
      .toEqual({ status: 200, body: { revision: 1, instructions: '先说结论，保留出处。', enabled: false } })
    expect(await test.request('GET')).toEqual({ status: 200, body: { revision: 1, instructions: '先说结论，保留出处。', enabled: false } })
    expect(await test.request('POST', { expected_revision: 1, enabled: true }, { 'x-ejianbao': '1' }))
      .toEqual({ status: 200, body: { revision: 2, instructions: '先说结论，保留出处。', enabled: true } })
    expect(await test.request('POST', { expected_revision: 2, instructions: null }, { 'x-ejianbao': '1' }))
      .toEqual({ status: 200, body: { revision: 3, instructions: null, enabled: true } })
    expect(test.worker).not.toHaveBeenCalled()
  })

  it('reads old version 1 rules without a write and reports concurrent settings or Agent edits as 409', async () => {
    const test = await fixture()
    mkdirSync(join(test.home, 'publisher'))
    const legacy = JSON.stringify({ version: 1, revision: 5, instructions: '保留旧规则。' })
    writeFileSync(test.file, legacy)
    expect(await test.request('GET')).toEqual({ status: 200, body: { revision: 5, instructions: '保留旧规则。', enabled: true } })
    expect(readFileSync(test.file, 'utf8')).toBe(legacy)
    updateWritingProfile({ expected_revision: 5, instructions: 'Agent 刚保存的新规则。' }, { DSH_HOME: test.home })
    const stale = await test.request('POST', { expected_revision: 5, instructions: '旧窗口覆盖', enabled: false }, { 'x-ejianbao': '1' })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('publisher-writing-profile-conflict')
    expect(readWritingProfile({ DSH_HOME: test.home })).toEqual({ revision: 6, instructions: 'Agent 刚保存的新规则。', enabled: true })
    const results = await Promise.all([true, false].map(enabled => test.request('POST', { expected_revision: 6, enabled }, { 'x-ejianbao': '1' })))
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    expect(readWritingProfile({ DSH_HOME: test.home }).revision).toBe(7)
  })

  it('rejects malformed updates with 400 and keeps the prior profile untouched', async () => {
    const test = await fixture()
    updateWritingProfile({ expected_revision: 0, instructions: '不得被无效输入覆盖。', enabled: false }, { DSH_HOME: test.home })
    const bytes = readFileSync(test.file, 'utf8')
    for (const invalid of [null, [], {}, { expected_revision: 1 }, { expected_revision: -1, enabled: true },
      { expected_revision: 1, enabled: 'false' }, { expected_revision: 1, enabled: null },
      { expected_revision: 1, instructions: 3 }, { expected_revision: 1, instructions: '长'.repeat(12_001) },
      { expected_revision: 1, enabled: false, global: true }]) {
      expect((await test.request('POST', invalid, { 'x-ejianbao': '1' })).status).toBe(400)
      expect(readFileSync(test.file, 'utf8')).toBe(bytes)
    }
    writeFileSync(test.file, '{broken')
    expect((await test.request('GET')).status).toBe(400)
    expect((await test.request('POST', { expected_revision: 1, instructions: null }, { 'x-ejianbao': '1' })).status).toBe(400)
    expect(readFileSync(test.file, 'utf8')).toBe('{broken')
  })

  it('keeps the same-origin, loopback and explicit mutation header boundary', async () => {
    const test = await fixture()
    const edit = { expected_revision: 0, instructions: '不允许写入。' }
    expect((await test.request('POST', edit)).status).toBe(403)
    expect((await test.request('POST', edit, { 'x-ejianbao': '1', origin: 'https://other.example' })).status).toBe(403)
    expect((await test.request('GET', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await test.request('GET', undefined, {}, '192.168.1.10')).status).toBe(403)
    expect(existsSync(test.file)).toBe(false)
    expect(test.worker).not.toHaveBeenCalled()
  })

  it('accepts valid instructions at the limit even when JSON escaping expands the request body', async () => {
    const test = await fixture()
    const instructions = '\u0000'.repeat(12_000)
    const body = { expected_revision: 0, instructions, enabled: true }
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(64 * 1024)
    expect(await test.request('POST', body, { 'x-ejianbao': '1' }))
      .toEqual({ status: 200, body: { revision: 1, instructions, enabled: true } })
  })
})
