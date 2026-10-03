import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { JobStore } from '../src/store.ts'
import { TalkCraftAgents } from '../src/agent.ts'
import { Pipeline } from '../src/pipeline.ts'
import { Workbench } from '../src/workbench.ts'
import { apply, inject, permitted } from '../src/index.ts'
import { createMediaSettings, type CredentialsFace } from 'cqai-dsh-media-settings'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { downloadSelected, searchCandidates } from '../src/media.ts'
import { Secrets } from '../src/secrets.ts'
import { normalizeEdgeVoices } from '../src/edge-voices.ts'
import { validateEdgePreview } from '../src/edge-preview.ts'
import { EDGE_VOICES } from '../src/protocol.ts'
import type { Job } from '../src/protocol.ts'
import type { IncomingMessage } from 'node:http'
import { createServer, type ServerResponse } from 'node:http'

const roots: string[] = []
const createStore = () => {const root = mkdtempSync(join(tmpdir(), 'talkcraft-test-')); roots.push(root); return new JobStore(root)}
const memoryCredentials = (): CredentialsFace => {
  const records = new Map<CredentialKey, CredentialRecord>()
  let pending = Promise.resolve()
  return {
    readRecord: async key => {await pending; return structuredClone(records.get(key))},
    modifyRecord: async (key, mutate) => {
      const next = pending.then(async () => {const value=await mutate(structuredClone(records.get(key)));if(value)records.set(key,structuredClone(value));return structuredClone(records.get(key))})
      pending=next.then(()=>{},()=>{});return next
    },
  }
}
afterEach(() => {vi.unstubAllGlobals(); for (const root of roots.splice(0)) {const target = resolve(root), base = resolve(tmpdir()); if (!target.startsWith(base + sep)) throw new Error('unsafe test cleanup'); rmSync(target, {recursive: true, force: true})}})

describe('独立任务目录', () => {
  it('records only this video’s Agent background steps while it is running', () => {
    const store = createStore()
    const first = store.create({text: '第一条视频。'})
    const second = store.create({text: '第二条视频。'})
    first.status = 'running'; first.stage = 'shotbook'; store.persist(first)
    second.status = 'running'; second.stage = 'sample'; store.persist(second)
    const pipeline = new Pipeline(store, {} as never, {} as never, 'unused')
    ;(pipeline as unknown as {trackAgentSession(job: Job, id: string): void}).trackAgentSession(first, 'agent-1')

    pipeline.recordBackgroundStep('other-plugin-agent', 'completed')
    pipeline.recordBackgroundStep('agent-1', 'completed')
    pipeline.recordBackgroundStep('agent-1', 'failed')
    expect(first.logs).toEqual([
      expect.stringContaining('分镜：后台步骤已完成，继续制作'),
      expect.stringContaining('分镜：后台步骤失败，正在检查'),
    ])
    expect(second.logs).toEqual([])

    first.status = 'awaiting-shotbook'
    pipeline.recordBackgroundStep('agent-1', 'completed')
    expect(first.logs).toHaveLength(2)
  })
  it('creates isolated projects and resumes running jobs as interrupted', () => {
    const store = createStore()
    const first = store.create({title: '甲', text: '第一句。第二句！', aspect: '9:16'})
    const second = store.create({title: '乙', text: '另一个任务。'})
    expect(first.id).not.toBe(second.id)
    expect(first.aspect).toBe('9:16')
    expect(JSON.parse(readFileSync(store.file(first.id, 'script.json'), 'utf8')).sentences).toEqual(['第一句。', '第二句！'])
    expect(() => store.file(first.id, '../escape')).toThrow('路径不在任务目录内')
    first.status = 'running'; store.persist(first)
    const reopened = new JobStore(store.root)
    expect(reopened.get(first.id).status).toBe('interrupted')
    expect(reopened.get(second.id).status).toBe('draft')
    expect(existsSync(reopened.file(second.id, 'script.json'))).toBe(true)
  })
  it('persists the selected Edge voice and requires an explicit retry after an uncertain request', () => {
    const store = createStore()
    expect(() => store.create({text: '一句话。', voiceSource: 'edge', edgeVoice: 'invalid'})).toThrow('Edge TTS 声音无效')
    expect(store.create({text: 'English narration.', voiceSource: 'edge', edgeVoice: 'en-US-AriaNeural'}).edgeVoice).toBe('en-US-AriaNeural')
    const job = store.create({text: '一句话。', voiceSource: 'edge', edgeVoice: 'zh-CN-YunxiNeural'})
    job.edgeSubmission = 'uncertain'; job.status = 'failed'; store.persist(job)
    const reopened = new JobStore(store.root)
    const restored = reopened.get(job.id)
    expect(restored).toMatchObject({voiceSource: 'edge', edgeVoice: 'zh-CN-YunxiNeural', edgeSubmission: 'uncertain', status: 'failed'})
    const pipeline = new Pipeline(reopened, {} as never, {} as never, 'unused')
    pipeline.retryEdge(job.id)
    expect(restored.edgeSubmission).toBeUndefined()
    expect(restored.status).toBe('interrupted')
    expect(() => pipeline.retryEdge(job.id)).toThrow('当前任务不需要重试')
    expect(store.create({text: '旧版任务。'}).voiceSource).toBeUndefined()
  })
  it('accepts current Edge catalog voices, discards invalid rows, and puts Chinese voices first', () => {
    const voices = normalizeEdgeVoices([
      {id: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female'},
      {id: 'zh-CN-XiaoyiNeural', locale: 'zh-CN', gender: 'Female'},
      {id: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female'},
      {id: '../bad', locale: 'en-US', gender: 'Male'},
      {id: 'de-DE-KatjaNeural', locale: 'en-US', gender: 'Female'},
    ])
    expect(voices.map(item => item.id)).toEqual(['zh-CN-XiaoyiNeural', 'en-US-AriaNeural'])
    expect(voices[0].label).toBe('晓伊')
  })
  it('keeps voice auditions short and rejects invalid input before synthesis', () => {
    expect(validateEdgePreview('zh-CN-XiaoxiaoNeural', '  大家好，欢迎收看。  ')).toEqual({voice: 'zh-CN-XiaoxiaoNeural', text: '大家好，欢迎收看。'})
    expect(() => validateEdgePreview('../bad', '大家好')).toThrow('音色')
    expect(() => validateEdgePreview('zh-CN-XiaoxiaoNeural', '')).toThrow('试听文案')
    expect(() => validateEdgePreview('zh-CN-XiaoxiaoNeural', '字'.repeat(81))).toThrow('试听文案')
    expect(validateEdgePreview('zh-CN-XiaoxiaoNeural', '🙂'.repeat(80)).text).toHaveLength(160)
  })
  it('reads only this job’s Markdown drafts before stage validation', () => {
    const store = createStore()
    const first = store.create({text: '第一条。'})
    const second = store.create({text: '第二条。'})
    writeFileSync(store.file(first.id, 'sources.md'), '# 素材来源\n- 我上传的照片')
    writeFileSync(store.file(first.id, 'SHOTBOOK.md'), '## 草稿分镜')
    writeFileSync(store.file(first.id, 'private.md'), 'do not expose')
    expect(store.documents(first.id).map(item => [item.file, item.text])).toEqual([
      ['sources.md', '# 素材来源\n- 我上传的照片'], ['SHOTBOOK.md', '## 草稿分镜'],
    ])
    expect(store.documents(second.id)).toEqual([])
    expect(first.artifacts).toEqual([])
    const outside = mkdtempSync(join(tmpdir(), 'talkcraft-document-test-')); roots.push(outside)
    writeFileSync(join(outside, 'secret.md'), 'outside')
    rmSync(store.file(first.id, 'SHOTBOOK.md'))
    try {symlinkSync(join(outside, 'secret.md'), store.file(first.id, 'SHOTBOOK.md'), 'file')}
    catch (error) {if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error}
    expect(store.documents(first.id).map(item => item.file)).toEqual(['sources.md'])
  })
  it('deletes only the selected job while preserving other jobs and linked runtime files', async () => {
    const store = createStore()
    const first = store.create({title: '待删除', text: '第一条。'})
    const second = store.create({title: '保留', text: '第二条。'})
    const outside = mkdtempSync(join(tmpdir(), 'talkcraft-runtime-test-')); roots.push(outside)
    writeFileSync(join(outside, 'keep.txt'), 'runtime')
    try {symlinkSync(outside, store.file(first.id, 'remotion/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error}
    expect(() => store.beginDelete('../other')).toThrow('任务不存在')
    store.beginDelete(first.id)
    try {
      expect(store.list().some(job => job.id === first.id)).toBe(false)
      await store.deleteJob(first.id)
    } finally {store.endDelete(first.id)}
    expect(existsSync(store.directory(first.id))).toBe(false)
    expect(() => store.get(first.id)).toThrow('任务不存在')
    expect(existsSync(store.file(second.id, 'script.txt'))).toBe(true)
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('runtime')
  })
  it('refuses to remove a job directory redirected outside the jobs root', async () => {
    const store = createStore(), job = store.create({text: '不能越界删除。'})
    const outside = mkdtempSync(join(tmpdir(), 'talkcraft-outside-test-')); roots.push(outside)
    writeFileSync(join(outside, 'keep.txt'), 'outside')
    const directory = store.directory(job.id)
    expect(resolve(directory).startsWith(resolve(store.root) + sep)).toBe(true)
    rmSync(directory, {recursive: true})
    try {symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir')}
    catch (error) {if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error}
    store.beginDelete(job.id)
    try {await expect(store.deleteJob(job.id)).rejects.toThrow('任务目录路径无效')}
    finally {store.endDelete(job.id)}
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('outside')
  })
  it('waits for a running producer to stop before deleting its files', async () => {
    const store = createStore(), job = store.create({text: '一条正在制作的视频。'})
    const pipeline = new Pipeline(store, {} as never, {} as never, 'unused')
    pipeline.diagnosis = async () => []
    let finish!: () => void
    let aborted = false
    ;(pipeline as unknown as {execute: (_job: Job, controller: AbortController) => Promise<void>}).execute = async (_job, controller) => {
      await new Promise<void>(resolve => {finish = resolve; controller.signal.addEventListener('abort', () => {aborted = true}, {once: true})})
    }
    await pipeline.start(job.id)
    const closeEditor = vi.fn(async () => {expect(existsSync(store.directory(job.id))).toBe(true)})
    const deleting = pipeline.delete(job.id, closeEditor)
    expect(aborted).toBe(true)
    expect(existsSync(store.directory(job.id))).toBe(true)
    expect(closeEditor).not.toHaveBeenCalled()
    await expect(pipeline.start(job.id)).rejects.toThrow('视频正在删除')
    finish()
    await deleting
    expect(closeEditor).toHaveBeenCalledOnce()
    expect(existsSync(store.directory(job.id))).toBe(false)
  })
  it('recovers a completed ASR file after a console encoding failure without rerunning ASR', async () => {
    const store = createStore(), job = store.create({text: '大家好。'})
    const upstream = mkdtempSync(join(tmpdir(), 'talkcraft-upstream-test-')); roots.push(upstream)
    mkdirSync(join(upstream, 'runtime', 'node_modules'), {recursive: true})
    writeFileSync(store.file(job.id, 'audio/full.wav'), 'wave')
    writeFileSync(store.file(job.id, 'audio/timestamps.pending.json'), JSON.stringify({sr: 24000, total: 1, sentences: [{i: 0, text: '大家好。', start: 0, end: 1, ok: false, words: []}]}))
    writeFileSync(store.file(job.id, 'inputs/picture.png'), 'image')
    store.upload(job, 'image', 'inputs/picture.png', 'picture.png')
    writeFileSync(store.file(job.id, 'media_candidates.json'), '[]')
    writeFileSync(store.file(job.id, 'asset_plan.json'), '{}')
    const agent = {run: vi.fn(async () => {throw new Error('ASR recovery should not call the Agent')})}
    const pipeline = new Pipeline(store, agent as never, {} as never, upstream) as unknown as {
      prepare(job: Job, signal: AbortSignal): Promise<void>;
      verified(job: Job, stage: 'prepare'): boolean;
    }
    const link = store.file(job.id, 'remotion/node_modules')
    try {
      await pipeline.prepare(job, new AbortController().signal)
      expect(pipeline.verified(job, 'prepare')).toBe(true)
      expect(job.artifacts).toContainEqual(expect.objectContaining({file: 'audio/full.wav', name: '配音音频'}))
      expect(existsSync(store.file(job.id, 'audio/timestamps.pending.json'))).toBe(false)
      expect(agent.run).not.toHaveBeenCalled()
    } finally {if (existsSync(link)) rmSync(link, {force: true})}
  })
  it('writes a resumable shot draft before asking the Agent to complete the full shotbook', async () => {
    const store = createStore(), job = store.create({text: '大家好。'})
    const agent = {run: vi.fn(async (_root: string, _system: string, prompt: string, _signal: AbortSignal,
      progress?: {resumeSessionId?: string; onSessionId?(id: string): void}) => {
      progress?.onSessionId?.(prompt.includes('此步只需可修改的草稿') ? 'draft-session' : 'full-session')
      if (prompt.includes('此步只需可修改的草稿')) {
        writeFileSync(store.file(job.id, 'remotion/shots.json'), '[{"id":"s01","start":0,"end":1}]')
        writeFileSync(store.file(job.id, 'SHOTBOOK.md'), '### S01 · 0–1\n- 素材：文\n## 未完成 / 未采集清单\n无')
      }
    })}
    const pipeline = new Pipeline(store, agent as never, {} as never, 'unused') as unknown as {
      agentStage(job: Job, stage: 'shotbook', signal: AbortSignal): Promise<void>
      checkShotbook(job: Job, signal: AbortSignal): Promise<void>
    }
    pipeline.checkShotbook = async () => {}
    await pipeline.agentStage(job, 'shotbook', new AbortController().signal)
    expect(agent.run).toHaveBeenCalledTimes(2)
    expect(job.shotbookDraftSession).toBe('draft-session')
    expect(agent.run.mock.calls[1]?.[4]?.resumeSessionId).toBeUndefined()
    expect(job.stageSessions?.shotbook).toBe('full-session')
    expect(job.artifacts).toContainEqual(expect.objectContaining({file: 'SHOTBOOK.md'}))
  })
  it('sends a concrete preflight failure to a dedicated repair session', async () => {
    const store = createStore(), job = store.create({text: '大家好。'})
    writeFileSync(store.file(job.id, 'remotion/shots.json'), '[{"id":"s01","start":0,"end":1}]')
    writeFileSync(store.file(job.id, 'SHOTBOOK.md'), '### S01 · 0–1\n- 素材：文\n## 未完成 / 未采集清单\n无')
    const agent = {run: vi.fn(async (_root: string, _system: string, _prompt: string, _signal: AbortSignal,
      progress?: {resumeSessionId?: string; onSessionId?(id: string): void}) => {progress?.onSessionId?.('shotbook-session')})}
    const pipeline = new Pipeline(store, agent as never, {} as never, 'unused') as unknown as {
      agentStage(job: Job, stage: 'shotbook', signal: AbortSignal): Promise<void>
      checkShotbook(job: Job, signal: AbortSignal): Promise<void>
    }
    let checks = 0
    pipeline.checkShotbook = async () => {if (++checks === 1) throw new Error('11 镜缺「素材：」行')}
    await pipeline.agentStage(job, 'shotbook', new AbortController().signal)
    expect(checks).toBe(2)
    expect(agent.run).toHaveBeenCalledTimes(2)
    expect(agent.run.mock.calls[1]?.[2]).toContain('11 镜缺「素材：」行')
    expect(agent.run.mock.calls[1]?.[4]?.resumeSessionId).toBeUndefined()
    expect(job.shotbookRepairSession).toBe('shotbook-session')
    expect(job.artifacts).toContainEqual(expect.objectContaining({file: 'SHOTBOOK.md'}))
  })
  it('requires both approval gates and resets changed media for a new shotbook', async () => {
    const store = createStore(), job = store.create({text: '一段文案。'})
    const pipeline = new Pipeline(store, new TalkCraftAgents(), {} as never, 'unused')
    pipeline.start = async id => store.get(id)
    job.status = 'awaiting-shotbook'; job.completedStages = ['prepare', 'shotbook']
    job.candidates = [{id: 'p-1', provider: 'Pexels', kind: 'image', url: 'https://images.pexels.com/x', preview: 'https://images.pexels.com/y', source: 'https://pexels.com/z', author: 'a', selected: false}]
    store.persist(job)
    await expect(pipeline.approve(job.id, 'sample', true, '')).rejects.toThrow('当前不在此确认阶段')
    await pipeline.approve(job.id, 'shotbook', true, '', ['p-1'])
    expect(job.approvedShotbook).toBe(false)
    expect(job.completedStages).not.toContain('prepare')
    expect(job.completedStages).not.toContain('shotbook')
    job.status = 'awaiting-shotbook'; job.completedStages = ['prepare', 'shotbook']; store.persist(job)
    await pipeline.approve(job.id, 'shotbook', true, '', ['p-1'])
    expect(job.approvedShotbook).toBe(true)
    await expect(new Workbench(store, 'unused').open(job.id)).rejects.toThrow('确认有声样板镜')
  })
  it('still stops at an unapproved shotbook after a restart', async () => {
    const store = createStore(), job = store.create({text: '一段文案。'})
    for (const [file, data] of [
      ['audio/full.wav', 'wave'], ['audio/timestamps.json', '{"sr":24000,"total":1,"sentences":[{"i":0,"text":"一段文案。","start":0,"end":1,"ok":true,"words":[]}]}'], ['media_candidates.json', '[]'],
      ['asset_plan.json', '{}'], ['sources.md', '# 素材来源'], ['SHOTBOOK.md', '### S01'],
      ['remotion/shots.json', '[{"id":"s01","start":0,"end":1}]'],
    ]) writeFileSync(store.file(job.id, file), data)
    job.completedStages = ['prepare', 'shotbook']; job.status = 'interrupted'; store.persist(job)
    const pipeline = new Pipeline(store, new TalkCraftAgents(), {} as never, 'unused') as unknown as {
      checkShotbook(): Promise<void>;
      execute(job: Job, controller: AbortController): Promise<void>;
    }
    pipeline.checkShotbook = async () => {}
    await pipeline.execute(job, new AbortController())
    expect(job.status).toBe('awaiting-shotbook')
    expect(job.approvedShotbook).toBeUndefined()
  })
})

describe('API boundary', () => {
  const request = (ip: string, method = 'POST', origin?: string, header?: string) => ({socket: {remoteAddress: ip}, method, headers: {host: '127.0.0.1:1234', ...(origin ? {origin} : {}), ...(header ? {'x-talkcraft': header} : {})}} as IncomingMessage)
  it('accepts Desktop same-origin requests and rejects remote or cross-origin writes', () => {
    expect(permitted(request('127.0.0.1', 'POST', 'http://127.0.0.1:1234', '1'))).toBe(true)
    expect(permitted(request('127.0.0.1', 'POST'))).toBe(false)
    expect(permitted(request('127.0.0.1', 'POST', 'https://evil.example', '1'))).toBe(false)
    expect(permitted(request('192.168.1.2', 'GET'))).toBe(false)
  })
  it('creates and uploads a task through its own loopback API while redacting settings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'talkcraft-http-test-')); roots.push(root)
    const before = process.env.DSH_HOME; process.env.DSH_HOME = root
    mkdirSync(join(root, 'talkcraft'), {recursive: true})
    writeFileSync(join(root, 'talkcraft', 'edge-voices.json'), JSON.stringify({savedAt: Date.now(), voices: EDGE_VOICES}))
    let handler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined
    let dispose: (() => Promise<void>) | undefined
    let credentialsReady = false
    const credentials = memoryCredentials()
    const ctx = {
      webServer: {register: (route: {handler: typeof handler}) => {handler = route.handler; return () => {handler = undefined}}},
      get credentials() {if (!credentialsReady) throw new Error('cannot get property "credentials" without inject'); return credentials},
      inject: () => {},
      effect: (fn: () => () => Promise<void>) => {dispose = fn()},
    }
    const server = createServer((req, res) => handler?.(req, res))
    try {
      expect(inject).toContain('credentials')
      credentialsReady = true
      apply(ctx as never)
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address')
      const base = `http://127.0.0.1:${address.port}/api/cqai-talkcraft/`
      const voiceList = await (await fetch(base + 'edge-voices')).json() as {source: string; voices: Array<{id: string}>}
      expect(voiceList.source).toBe('cache')
      expect(voiceList.voices.length).toBeGreaterThan(2)
      const post = async (action: string, value: unknown) => fetch(base + action, {method: 'POST', headers: {'content-type': 'application/json', 'x-talkcraft': '1'}, body: JSON.stringify(value)})
      expect((await post('edge-preview', {voice: '../bad', text: '大家好'})).status).toBe(400)
      expect((await post('edge-preview', {voice: 'zh-CN-XiaoxiaoNeural', text: ''})).status).toBe(400)
      expect((await fetch(base + 'edge-preview')).status).toBe(404)
      const setting = await post('settings', {name: 'fish', value: 'secret-http-test'})
      expect(setting.status).toBe(200)
      expect(await setting.json()).toEqual({fish: true, pexels: false, pixabay: false})
      const created = await post('jobs', {title: 'HTTP 任务', text: '第一句话。'})
      expect(created.status).toBe(201)
      const job = await created.json() as {id: string}
      const uploaded = await fetch(`${base}upload?id=${job.id}&kind=voice&name=voice.wav`, {method: 'POST', headers: {'x-talkcraft': '1', 'content-type': 'application/octet-stream'}, body: new Uint8Array([1, 2, 3])})
      expect(uploaded.status).toBe(200)
      const picture = await fetch(`${base}upload?id=${job.id}&kind=image&name=view.jpg`, {method: 'POST', headers: {'x-talkcraft': '1', 'content-type': 'application/octet-stream'}, body: new Uint8Array([4, 5, 6])})
      expect(picture.status).toBe(200)
      const jobs = await (await fetch(base + 'jobs')).json() as Array<{id: string; uploads: unknown[]}>
      expect(jobs[0].uploads).toHaveLength(2)
      writeFileSync(join(root, 'talkcraft', 'jobs', job.id, 'SHOTBOOK.md'), '## 制作中的分镜')
      const documents = await fetch(`${base}documents?id=${job.id}`)
      expect(documents.status).toBe(200)
      expect((await documents.json() as Array<{file: string; text: string}>).map(item => [item.file, item.text])).toEqual([['SHOTBOOK.md', '## 制作中的分镜']])
      expect((await fetch(`${base}documents?id=00000000-0000-4000-8000-000000000000`)).status).toBe(400)
      const imageFile = (jobs[0].uploads[1] as {file: string}).file
      const media = await fetch(`${base}media?id=${job.id}&file=${encodeURIComponent(imageFile)}`)
      expect(media.status).toBe(200)
      expect(media.headers.get('content-type')).toBe('image/jpeg')
      expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([4, 5, 6])
      expect((await fetch(`${base}media?id=${job.id}&file=script.txt`)).status).toBe(400)
      const denied = await fetch(base + 'jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})
      expect(denied.status).toBe(403)
      expect(readFileSync(join(root, 'talkcraft', 'jobs', job.id, 'job.json'), 'utf8')).not.toContain('secret-http-test')
      const deniedDelete = await fetch(`${base}jobs?id=${job.id}`, {method: 'DELETE'})
      expect(deniedDelete.status).toBe(403)
      const deleted = await fetch(`${base}jobs?id=${job.id}`, {method: 'DELETE', headers: {'x-talkcraft': '1'}})
      expect(deleted.status).toBe(200)
      expect(await deleted.json()).toEqual({ok: true})
      expect(existsSync(join(root, 'talkcraft', 'jobs', job.id))).toBe(false)
      expect(await (await fetch(base + 'jobs')).json()).toEqual([])
    } finally {
      await dispose?.()
      await new Promise<void>(resolve => server.close(() => resolve()))
      if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before
    }
  })
})

describe('素材与凭据', () => {
  it('skips remote material search when the creator turns it off', async () => {
    const store = createStore(), job = store.create({text: '一段文案。', onlineSearch: false})
    const read = vi.fn(async () => ({pexels: 'unused', pixabay: 'unused'}))
    await searchCandidates(job, {read} as never, store)
    expect(read).not.toHaveBeenCalled()
    expect(job.candidates).toEqual([])
    expect(readFileSync(store.file(job.id, 'media_candidates.json'), 'utf8')).toBe('[]\n')
  })
  it('records an empty remote candidate list when uploaded media is sufficient', async () => {
    const store = createStore(), job = store.create({text: '一段文案。'})
    store.upload(job, 'video', 'inputs/a.mp4', 'a.mp4')
    store.upload(job, 'image', 'inputs/b.jpg', 'b.jpg')
    await searchCandidates(job, {} as never, store)
    expect(readFileSync(store.file(job.id, 'media_candidates.json'), 'utf8')).toBe('[]\n')
  })
  it('collects Pexels and Pixabay video and image candidates with provenance', async () => {
    const store = createStore(), job = store.create({text: '一段文案。'})
    const fetchMock = vi.fn(async (url: string) => {
      let data: unknown
      if (url.includes('pexels.com/v1/videos/search')) data = {videos: [{id: 1, url: 'https://www.pexels.com/video/1', image: 'https://images.pexels.com/1.jpg', video_files: [{quality: 'hd', link: 'https://videos.pexels.com/1.mp4'}]}]}
      else if (url.includes('pexels.com/v1/search')) data = {photos: [{id: 2, url: 'https://www.pexels.com/photo/2', src: {large2x: 'https://images.pexels.com/2.jpg', medium: 'https://images.pexels.com/2-preview.jpg'}}]}
      else if (url.includes('pixabay.com/api/videos')) data = {hits: [{id: 3, pageURL: 'https://pixabay.com/videos/id-3/', videos: {medium: {url: 'https://cdn.pixabay.com/3.mp4', thumbnail: 'https://cdn.pixabay.com/3.jpg'}}}]}
      else data = {hits: [{id: 4, pageURL: 'https://pixabay.com/photos/id-4/', largeImageURL: 'https://cdn.pixabay.com/4.jpg', previewURL: 'https://cdn.pixabay.com/4-preview.jpg'}]}
      return new Response(JSON.stringify(data), {status: 200})
    })
    vi.stubGlobal('fetch', fetchMock)
    await searchCandidates(job, {read: async () => ({pexels: 'pexels-key', pixabay: 'pixabay-key'})} as never, store, ['画面素材'])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(job.candidates.map(item => item.provider)).toEqual(['Pexels', 'Pexels', 'Pixabay', 'Pixabay'])
    expect(job.candidates.filter(item => item.selected).map(item => item.kind)).toEqual(['video', 'image'])
    expect(job.candidates[2].preview).toBe('https://cdn.pixabay.com/3.jpg')
    expect(readFileSync(store.file(job.id, 'job.json'), 'utf8')).not.toContain('pixabay-key')
  })
  it('downloads an approved candidate into its own job once', async () => {
    const store = createStore(), job = store.create({text: '一段文案。'})
    job.candidates = [{id: 'pexels-image-1', provider: 'Pexels', kind: 'image', url: 'https://images.pexels.com/photos/1/photo.jpg', preview: 'https://images.pexels.com/preview.jpg', source: 'https://pexels.com/photo/1', author: 'author', selected: true}]
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {status: 200}))
    vi.stubGlobal('fetch', fetchMock)
    await downloadSelected(job, store, new AbortController().signal)
    await downloadSelected(job, store, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readFileSync(store.file(job.id, 'remotion/public/assets/pexels-image-1.jpg'))).toEqual(Buffer.from([1, 2, 3]))
  })
  it('keeps service keys in the DSH credential record instead of a job', async () => {
    const credentials = memoryCredentials()
    const store = createStore()
    const secrets = new Secrets(credentials, createMediaSettings({home:store.root,credentials}))
    await secrets.set('fish', 'secret-for-test')
    expect((await secrets.read()).fish).toBe('secret-for-test')
    expect(await secrets.publicState()).toEqual({fish: true, pexels: false, pixabay: false})
    const job = store.create({text: '一段文案。'})
    expect(readFileSync(store.file(job.id, 'job.json'), 'utf8')).not.toContain('secret-for-test')
  })
  it('reports a preset without file and terminal tools before starting', async () => {
    const agents = new TalkCraftAgents()
    agents.attach({agents: {create: async () => {throw new Error('must not start')}}, presets: {resolve: async () => ({id: 'minimal'}), mount: async () => undefined, readDocument: async () => ({content: 'empty'})}, defaultModel: {currentSelection: () => ({provider: 'p', model: 'm'})}})
    expect(await agents.preflight()).toEqual(['当前 Agent preset 没有终端工具', '当前 Agent preset 没有可写文件工具'])
    agents.attach({agents: {create: async () => {throw new Error('must not start')}}, presets: {resolve: async () => ({id: 'search-only'}), mount: async () => undefined, readDocument: async () => ({content: 'name: @deepseek-ai/dsh-tool-pwsh-persistent\nname: @deepseek-ai/dsh-tool-fs-search'})}, defaultModel: {currentSelection: () => ({provider: 'p', model: 'm'})}})
    expect(await agents.preflight()).toEqual(['当前 Agent preset 没有可写文件工具'])
  })
  it('submits Agent prompts with a V4 producer-owned source', async () => {
    const agents = new TalkCraftAgents()
    let submitted: unknown
    agents.attach({
      agents: {create: async () => ({agent: {followup: message => {submitted = message}, whenIdle: async () => {}, cancel: () => {}, session: {snapshotEvents: () => [{type: 'turn/end', data: {reason: {kind: 'completed'}}}]}}, dispose: async () => {}})},
      presets: {resolve: async () => ({id: 'code'}), mount: async () => {}},
      defaultModel: {currentSelection: () => ({provider: 'test', model: 'test'})},
    })
    await agents.run('C:\\talkcraft-job', 'system', '生成素材方案', new AbortController().signal)
    expect(submitted).toMatchObject({role: 'user', source: {kind: 'plugin:cqai-dsh-plugin-talkcraft'}})
  })
  it('reports a contained model failure instead of claiming the stage artifact was not generated', async () => {
    const agents = new TalkCraftAgents()
    agents.attach({
      agents: {create: async () => ({agent: {followup: () => {}, whenIdle: async () => {}, cancel: () => {},
        session: {snapshotEvents: () => [{type: 'turn/end', data: {reason: {kind: 'error', error: {code: 'UPSTREAM', status: 502}}}}]}}, dispose: async () => {}})},
      presets: {resolve: async () => ({id: 'code'}), mount: async () => {}},
      defaultModel: {currentSelection: () => ({provider: 'test', model: 'test'})},
    })
    await expect(agents.run('C:\\talkcraft-job', 'system', '生成分镜', new AbortController().signal))
      .rejects.toThrow(/Agent 执行失败（HTTP 502，UPSTREAM）；请稍后继续当前任务/)
  })
  it('continues the saved stage session after a contained model failure', async () => {
    const agents = new TalkCraftAgents()
    const create = vi.fn(async (options: {sessionId: string}) => ({agent: {followup: () => {}, whenIdle: async () => {}, cancel: () => {},
      session: {snapshotEvents: () => [{type: 'turn/end', data: {reason: {kind: 'error', error: {code: 'UPSTREAM', status: 502}}}}]}}, dispose: async () => {}}))
    let continuation: string | undefined
    const resume = vi.fn(async () => ({agent: {followup: (message: {content: Array<{text: string}>}) => {continuation = message.content[0]?.text}, whenIdle: async () => {}, cancel: () => {},
      session: {snapshotEvents: () => [{type: 'turn/end', data: {reason: {kind: 'completed'}}}]}}, dispose: async () => {}}))
    agents.attach({agents: {create, resume}, presets: {resolve: async () => ({id: 'code'}), mount: async () => {}},
      defaultModel: {currentSelection: () => ({provider: 'test', model: 'test'})}})
    let saved: string | undefined
    await expect(agents.run('C:\\talkcraft-job', 'system', '生成分镜', new AbortController().signal,
      {onSessionId: id => {saved = id}})).rejects.toThrow('HTTP 502')
    expect(saved).toBe(create.mock.calls[0]?.[0].sessionId)
    await agents.run('C:\\talkcraft-job', 'system', '生成分镜', new AbortController().signal,
      {resumeSessionId: saved, onSessionId: id => {saved = id}})
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({resumeSessionId: saved}))
    expect(create).toHaveBeenCalledTimes(1)
    expect(continuation).toContain('沿用本会话已读资料')
  })
})
