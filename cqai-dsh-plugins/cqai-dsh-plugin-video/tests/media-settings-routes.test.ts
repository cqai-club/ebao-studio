import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createMediaSettings, type CredentialsFace } from 'cqai-dsh-media-settings'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.ts'

afterEach(() => {vi.unstubAllEnvs()})

it('serves shared settings from the standalone video plugin without the aggregate shell', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cqai-video-settings-route-'))
  vi.stubEnv('DSH_HOME', home)
  const records = new Map<CredentialKey, CredentialRecord>()
  const credentials: CredentialsFace = {
    readRecord: async key => structuredClone(records.get(key)),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(structuredClone(records.get(key)))
      if (next) records.set(key, structuredClone(next))
      return structuredClone(records.get(key))
    },
  }
  const ctx = new Context()
  try {
    ctx.reflect.provide('credentials', credentials as Context['credentials'])
    await ctx.plugin(WebServer, {host: '127.0.0.1', port: 0})
    await ctx.plugin({...plugin, inject: ['webServer', 'credentials']})
    const url = `http://127.0.0.1:${ctx.webServer.port}/api/cqai-video/media-settings`
    const first = await fetch(url)
    expect(first.status).toBe(200)
    const state = await first.json()
    expect(state.defaults).toEqual({aspect: '9:16', edgeVoiceId: 'zh-CN-XiaoxiaoNeural'})
    const mutation = {operation: 'credential', expectedRevision: state.credentialRevision, provider: 'pexels', value: 'standalone-private-key'}
    expect((await fetch(url, {method: 'POST', body: JSON.stringify(mutation)})).status).toBe(403)
    const saved = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', 'x-ejianbao': '1'}, body: JSON.stringify(mutation)})
    expect(saved.status).toBe(200)
    const text = await saved.text()
    expect(JSON.parse(text).providers.pexels.configured).toBe(true)
    expect(text).not.toContain('standalone-private-key')
    const otherEngine = createMediaSettings({home, credentials})
    expect(await otherEngine.readCredential('pexels', 'shortVideo')).toBe('standalone-private-key')
    expect(await otherEngine.readCredential('pexels', 'talkcraft')).toBe('standalone-private-key')
    expect((await fetch(url, {headers: {origin: 'https://elsewhere.test'}})).status).toBe(403)
  } finally {await ctx.fiber.dispose(); await rm(home, {recursive: true, force: true})}
}, 10000)
