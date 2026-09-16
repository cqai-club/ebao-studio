import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.ts'

it('mounts real DSH routes and completes an offline task through HTTP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ejianbao-http-'))
  const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = root
  const ctx = new Context()
  try {
    await ctx.plugin(WebServer, {host: '127.0.0.1', port: 0})
    await ctx.plugin({...plugin, inject: ['webServer']})
    const base = `http://127.0.0.1:${ctx.webServer.port}/api/cqai-video`
    expect((await fetch(base + '/jobs')).status).toBe(200)
    const response = await fetch(base + '/jobs', {method: 'POST', headers: {'content-type': 'application/json', 'x-ejianbao': '1'}, body: JSON.stringify({title: 'HTTP 本地验收', text: '第一句测试。第二句说明。', duration: 6, mode: 'plan', optimize: false, covers: false, studio: false})})
    expect(response.status).toBe(201)
    const job = await response.json()
    const content = '上传的文案。第二句测试。'
    const upload = await fetch(base + `/upload?id=${job.id}&kind=script&name=script.txt`, {method: 'POST', headers: {'x-ejianbao': '1'}, body: new Blob([content], {type: 'text/plain'})})
    expect(await upload.json()).not.toHaveProperty('error')
    expect(upload.status).toBe(200)
    expect(readFileSync(join(root, 'ejianbao/jobs', job.id, 'inputs/script.txt'), 'utf8')).toBe(content)
    const empty = await fetch(base + `/upload?id=${job.id}&kind=script&name=empty.txt`, {method: 'POST', headers: {'x-ejianbao': '1'}, body: new Blob([])})
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toContain('empty.txt')
    expect(readFileSync(join(root, 'ejianbao/jobs', job.id, 'inputs/script.txt'), 'utf8')).toBe(content)
    // Binary image and M4A uploads must survive the real HTTP route unchanged.
    // Only upload: never invoke the paid digital-human service in this test.
    for (const [kind, name] of [['avatar', '照片.png'], ['voice', '参考录音.m4a']]) {
      const bytes = new Uint8Array([0, 255, 128, 1, 0, 10, 13, 42])
      const binary = await fetch(base + `/upload?id=${job.id}&kind=${kind}&name=${encodeURIComponent(name)}`, {method: 'POST', headers: {'x-ejianbao': '1', 'content-type': 'application/octet-stream'}, body: new File([bytes], name)})
      expect(binary.status).toBe(200)
      const updated = await binary.json()
      expect(new Uint8Array(readFileSync(join(root, 'ejianbao/jobs', job.id, updated.uploads[kind].file)))).toEqual(bytes)
    }
    const start = await fetch(base + `/start?id=${job.id}`, {method: 'POST', headers: {'x-ejianbao': '1'}})
    expect(start.status).toBe(200)
    await expect.poll(async () => (await (await fetch(base + '/jobs')).json())[0].status, {timeout: 20000}).toBe('completed')
    const result = (await (await fetch(base + '/jobs')).json())[0]
    expect(result.artifacts.map((a: {file: string}) => a.file)).toContain('motion/MotionPackage.tsx')
    const script = await fetch(base + `/artifact?id=${job.id}&file=script.txt`)
    expect(await script.text()).toContain('第一句测试')
    expect((await fetch(base + `/artifact?id=${job.id}&file=../../secret`)).status).toBe(400)
    expect((await fetch(base + '/jobs', {method: 'POST', headers: {origin: 'https://elsewhere.test', 'x-ejianbao': '1'}, body: '{}'})).status).toBe(403)
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
    rmSync(root, {recursive: true, force: true})
  }
}, 30000)
