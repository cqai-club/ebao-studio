import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.ts'

const installation = vi.hoisted(() => ({status: 'idle' as 'idle' | 'running' | 'completed' | 'failed'}))
vi.mock('../src/runtime.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../src/runtime.ts')>()
  const snapshot = () => ({status: installation.status, items: [], logs: [], updatedAt: Date.now()})
  return {...original, createVideoSetup: () => ({snapshot, start: () => {installation.status = 'running'; return snapshot()}})}
})
afterEach(() => {installation.status = 'idle'; vi.unstubAllEnvs()})

it('keeps a draft unchanged while setup runs and permits the same task after setup finishes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cqai-video-setup-route-'))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  try {
    await ctx.plugin(WebServer, {host: '127.0.0.1', port: 0})
    await ctx.plugin({...plugin, inject: ['webServer']})
    const base = `http://127.0.0.1:${ctx.webServer.port}/api/cqai-video`, headers = {'content-type': 'application/json', 'x-ejianbao': '1'}
    const created = await fetch(base + '/jobs', {method: 'POST', headers, body: JSON.stringify({title: '安装期间草稿', text: '测试文案。', duration: 5, mode: 'plan', optimize: false, covers: false, studio: false})})
    expect(created.status).toBe(201)
    const draft = await created.json()
    expect((await fetch(base + '/setup', {method: 'POST', headers})).status).toBe(202)
    const blocked = await fetch(base + `/start?id=${draft.id}`, {method: 'POST', headers})
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toEqual({error: '环境正在准备，请完成后再制作'})
    const current = (await (await fetch(base + '/jobs')).json())[0]
    expect(current).toMatchObject({id: draft.id, status: 'draft', stages: {}, logs: []})
    installation.status = 'completed'
    const started = await fetch(base + `/start?id=${draft.id}`, {method: 'POST', headers})
    expect(started.status).toBe(200)
    expect(await started.json()).toMatchObject({id: draft.id})
    await expect.poll(async () => (await (await fetch(base + '/jobs')).json())[0].status, {timeout: 15000}).toBe('completed')
  } finally {await ctx.fiber.dispose(); await rm(home, {recursive: true, force: true})}
}, 20000)
