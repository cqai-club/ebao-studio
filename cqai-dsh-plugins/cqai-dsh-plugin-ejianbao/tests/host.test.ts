import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { API, apply, inject } from '../src/index.ts'

const tools = vi.hoisted(() => ({health: vi.fn(), installed: vi.fn()}))
vi.mock('cqai-dsh-plugin-media-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('cqai-dsh-plugin-media-runtime')>()
  return {...actual, commonToolHealth: tools.health, commonToolSteps: () => [
    {id: 'mediaTools', label: '公共媒体工具', ready: async () => tools.installed.mock.calls.length > 0, run: tools.installed},
  ]}
})

const directories: string[] = []
afterEach(async () => {vi.clearAllMocks();await Promise.all(directories.splice(0).map(path => rm(path,{recursive:true,force:true})))})
describe('e剪宝 settings Host', () => {
  it('serves settings without requiring any video engine to be loaded', async () => {
    const home = await mkdtemp(join(tmpdir(),'cqai-ejianbao-host-')); directories.push(home)
    const previous = process.env.DSH_HOME; process.env.DSH_HOME = home
    const records = new Map<CredentialKey,CredentialRecord>()
    let handler: ((req: IncomingMessage,res: ServerResponse) => Promise<unknown>) | undefined
    let disposed = false
    const ctx = {
      credentials: {
        readRecord: async (key: CredentialKey) => structuredClone(records.get(key)),
        modifyRecord: async (key: CredentialKey, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {const next = await mutate(structuredClone(records.get(key)));if(next)records.set(key,structuredClone(next));return structuredClone(records.get(key))},
      },
      webServer: {register: (route: {path:string;handler:typeof handler}) => {expect(route.path).toBe(API);handler=route.handler;return () => {disposed=true}}},
      effect: (setup: () => (() => void)) => {const cleanup=setup(); expect(typeof cleanup).toBe('function')},
    } as unknown as Context
    try {
      expect(inject).toEqual(['webServer','credentials']); apply(ctx); expect(disposed).toBe(false)
      let status = 0, result = ''
      const req = Object.assign(Readable.from([]),{method:'GET',url:`${API}/media-settings`,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000'}}) as unknown as IncomingMessage
      const res = {writeHead:(value:number)=>{status=value},end:(value:string)=>{result=value}} as unknown as ServerResponse
      await handler!(req,res)
      expect(status).toBe(200); expect(JSON.parse(result).defaults.aspect).toBe('9:16')
    } finally {if(previous === undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous}
  })

  it('checks and installs shared tools without loading an engine, with the local request boundary', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cqai-ejianbao-tools-')); directories.push(home)
    const previous = process.env.DSH_HOME; process.env.DSH_HOME = home
    let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<unknown>) | undefined
    const ctx = {
      credentials: {},
      webServer: {register: (route: {handler: typeof handler}) => {handler = route.handler; return () => {}}},
      effect: (setup: () => (() => void)) => {setup()},
    } as unknown as Context
    const request = async (path: string, method = 'GET', headers: Record<string, string> = {}, remoteAddress = '127.0.0.1') => {
      let status = 0, result = '', responseHeaders: unknown
      const req = Object.assign(Readable.from([]), {method, url: `${API}/${path}`, socket: {remoteAddress}, headers: {host: '127.0.0.1:3000', ...headers}}) as unknown as IncomingMessage
      const res = {writeHead: (value: number, values: unknown) => {status = value; responseHeaders = values}, end: (value: string) => {result = value}} as unknown as ServerResponse
      await handler!(req, res)
      return {status, body: JSON.parse(result), headers: responseHeaders}
    }
    try {
      tools.health.mockResolvedValue({uv: true, node: true, python: false, ffmpeg: false, ffprobe: false})
      apply(ctx)
      const health = await request('tools')
      expect(health.status).toBe(200)
      expect(health.body).toMatchObject({node: true, python: false, setup: {status: 'idle'}})
      expect(health.headers).toMatchObject({'cache-control': 'no-store'})
      expect(tools.health).toHaveBeenCalledWith(home)
      expect((await request('tools/setup')).body.status).toBe('idle')
      expect((await request('tools/setup', 'POST')).status).toBe(403)
      expect((await request('tools/setup', 'POST', {'x-ejianbao': '1', origin: 'https://example.com'})).status).toBe(403)
      expect((await request('tools/setup', 'POST', {'x-ejianbao': '1', 'sec-fetch-site': 'cross-site'})).status).toBe(403)
      expect((await request('tools', 'GET', {host: 'attacker.example'})).status).toBe(403)
      expect((await request('tools', 'GET', {}, '192.168.1.2')).status).toBe(403)
      expect(tools.installed).not.toHaveBeenCalled()
      expect((await request('tools/setup', 'POST', {'x-ejianbao': '1'})).status).toBe(202)
      await vi.waitFor(() => expect(tools.installed).toHaveBeenCalledOnce())
      expect((await request('tools/setup')).body.status).toBe('completed')
      expect((await request('tools', 'DELETE', {'x-ejianbao': '1'})).status).toBe(405)
      tools.health.mockRejectedValueOnce(new Error('工具检查失败'))
      expect(await request('tools')).toMatchObject({status: 500, body: {error: '工具检查失败'}})
    } finally {if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous}
  })
})
