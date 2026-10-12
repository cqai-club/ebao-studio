import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { createContent, readContent, saveContent } from '../src/contents.ts'
import { API } from '../src/protocol.ts'
import {
  compressDouyinSummary, summaryCompressionRequest, type SummaryCompressionRequest, type SummaryCompressionServices,
} from '../src/summary-compression.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() })
const LONG = '文章介绍枪械八百年来从人工点火到扣动扳机的演变，解释点火、装填、供弹与连续射击环节如何逐步改变。'
const GENERATED = '八百年枪械演变：点火、装填与供弹如何简化'

function draft(summary = LONG) {
  const root = mkdtempSync(join(tmpdir(), 'ebao-summary-compress-'))
  roots.push(root)
  const env = { DSH_HOME: root }
  const created = createContent('article', env)
  const content = saveContent(created.id, {
    ...created, title: '枪械八百年', body: '原正文', summary,
    tags: ['历史'], creativeStatement: 'ai_generated', articleTheme: 'lapis',
    platformFields: { dy: { custom: '保留字段' } },
    platformVariants: { dy: { title: '抖音标题', body: '抖音正文', tags: ['抖音标签'] }, tt: { title: '头条标题' } },
  }, env)
  return { env, content, request: { id: content.id, revision: content.revision, platform: 'dy' } satisfies SummaryCompressionRequest }
}

function model(chunks: StreamChunk[] = [
  { type: 'text-delta', index: 0, text: GENERATED }, { type: 'finish', reason: { kind: 'stop' } },
]) {
  const selection = { provider: 'configured-provider', model: 'configured-text-model', reasoningEffort: 'high' as GenerateOptions['reasoningEffort'] }
  const stream = vi.fn(async function* (_options: GenerateOptions) { for (const chunk of chunks) yield chunk })
  const defaultModel = { currentSelection: vi.fn(() => selection) }
  return { services: { llm: { stream }, defaultModel } satisfies SummaryCompressionServices, stream, defaultModel, selection }
}

describe('stored Douyin summary compression', () => {
  it('uses the configured default model and changes only the Douyin summary override', async () => {
    const { env, content, request } = draft()
    const source = saveContent(content.id, {
      ...content, platformVariants: { ...content.platformVariants, dy: { ...content.platformVariants?.dy, summary: `${LONG}这是抖音专用摘要。` } },
    }, env)
    const fixture = model()
    const result = await compressDouyinSummary({ ...request, revision: source.revision }, fixture.services, { env })
    expect(result).toMatchObject({ generated: true, summary: GENERATED, content: { revision: source.revision + 1 } })
    expect(result.content.summary).toBe(LONG)
    expect(result.content.platformVariants).toEqual({ ...source.platformVariants, dy: { ...source.platformVariants?.dy, summary: GENERATED } })
    for (const key of ['title', 'body', 'summary', 'tags', 'creativeStatement', 'articleTheme', 'assets', 'platformFields', 'coverAssetId'] as const) {
      expect(result.content[key]).toEqual(source[key])
    }
    const options = fixture.stream.mock.calls[0][0]
    expect(options).toMatchObject({ ...fixture.selection, maxTokens: 2048 })
    expect(options.tools).toBeUndefined()
    expect(JSON.stringify(options.messages)).toContain(`${LONG}这是抖音专用摘要。`)
    expect(JSON.stringify(options.messages)).not.toContain('抖音正文')
    expect(readContent(content.id, env)).toEqual(result.content)
  })

  it.each(['', '短摘要', '摘'.repeat(30)])('does not call a model or change revision for an already valid summary: %s', async summary => {
    const { env, content, request } = draft(summary)
    const fixture = model()
    expect(await compressDouyinSummary(request, fixture.services, { env })).toEqual({ content, generated: false, summary })
    expect(fixture.stream).not.toHaveBeenCalled()
    expect(fixture.defaultModel.currentSelection).not.toHaveBeenCalled()
    expect(readContent(content.id, env)).toEqual(content)
  })

  it('validates exact input and stored revision before using a model', async () => {
    const { env, content, request } = draft()
    const fixture = model()
    expect(() => summaryCompressionRequest({ ...request, summary: 'client supplied text' })).toThrow('不支持的字段')
    expect(() => summaryCompressionRequest({ ...request, platform: 'tt' })).toThrow('仅支持抖音')
    expect(() => summaryCompressionRequest({ ...request, revision: 0 })).toThrow('修订号')
    await expect(compressDouyinSummary({ ...request, revision: content.revision - 1 }, fixture.services, { env })).rejects.toThrow('重新加载')
    expect(fixture.stream).not.toHaveBeenCalled()
  })

  it('refuses missing, unconfigured, or non-text models without saving or truncating', async () => {
    const { env, content, request } = draft()
    await expect(compressDouyinSummary(request, {}, { env })).rejects.toMatchObject({ code: 'summary-model-missing' })
    const fixture = model()
    fixture.defaultModel.currentSelection.mockReturnValue({ provider: '', model: '', reasoningEffort: undefined })
    await expect(compressDouyinSummary(request, fixture.services, { env })).rejects.toMatchObject({ code: 'summary-model-missing' })
    const image = model()
    const services: SummaryCompressionServices = { ...image.services, llm: {
      ...image.services.llm,
      resolveModelInfo: vi.fn(async () => ({ provider: image.selection.provider, id: image.selection.model,
        name: image.selection.model, inputModalities: ['image'], outputModalities: ['image'] })) as never,
    } }
    await expect(compressDouyinSummary(request, services, { env })).rejects.toMatchObject({ code: 'summary-model-not-text' })
    expect(image.stream).not.toHaveBeenCalled()
    expect(readContent(content.id, env)).toEqual(content)
  })

  it.each(['', '摘'.repeat(31), '第一段\n第二段', '😀'.repeat(16), '{"summary":"摘要"}', '```摘要```', '摘要：内容', '甲\u0000乙', '甲\uD800乙'])
  ('rejects invalid output instead of applying a fallback: %s', async output => {
    const { env, content, request } = draft()
    const fixture = model([{ type: 'text-delta', index: 0, text: output }, { type: 'finish', reason: { kind: 'stop' } }])
    await expect(compressDouyinSummary(request, fixture.services, { env })).rejects.toMatchObject({ code: 'summary-model-invalid' })
    expect(readContent(content.id, env)).toEqual(content)
  })

  it.each(([
    [{ type: 'text-delta', index: 0, text: '部分摘要' }],
    [{ type: 'text-delta', index: 0, text: '部分摘要' }, { type: 'finish', reason: { kind: 'max-tokens' } }],
    [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'finish', reason: { kind: 'stop' } }],
    [{ type: 'text-delta', index: 0, text: '完整摘要' }, { type: 'finish', reason: { kind: 'stop' } },
      { type: 'block-end', index: 0, block: { type: 'text', text: '结束后改动' } }],
  ] as StreamChunk[][]).map(chunks => ({ chunks })))('rejects partial or tool responses', async ({ chunks }) => {
    const { env, content, request } = draft()
    await expect(compressDouyinSummary(request, model(chunks).services, { env })).rejects.toMatchObject({ code: 'summary-model-incomplete' })
    expect(readContent(content.id, env)).toEqual(content)
  })

  it('reads authoritative completed text blocks and excludes reasoning', async () => {
    const { env, request } = draft()
    const fixture = model([
      { type: 'reasoning-delta', index: 0, text: '不应写入的思考' },
      { type: 'text-delta', index: 1, text: '不完整的流式文字' },
      { type: 'block-end', index: 1, block: { type: 'text', text: `  ${GENERATED}  ` } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect((await compressDouyinSummary(request, fixture.services, { env })).summary).toBe(GENERATED)
    const second = draft()
    const blockOnly = model([{ type: 'block-end', index: 0, block: { type: 'text', text: GENERATED } },
      { type: 'finish', reason: { kind: 'stop' } }])
    expect((await compressDouyinSummary(second.request, blockOnly.services, { env: second.env })).summary).toBe(GENERATED)
  })

  it('reports model failure without exposing provider details or changing the draft', async () => {
    const { env, content, request } = draft()
    const fixture = model()
    fixture.stream.mockImplementation(async function* () { throw new Error('provider secret response') })
    await expect(compressDouyinSummary(request, fixture.services, { env })).rejects.toMatchObject({ code: 'summary-model-failed' })
    expect(readContent(content.id, env)).toEqual(content)
  })

  it('rejects an edit made while the model runs', async () => {
    const { env, content, request } = draft()
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const fixture = model()
    fixture.stream.mockImplementation(async function* () {
      await waiting
      yield { type: 'text-delta', index: 0, text: GENERATED }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const compression = compressDouyinSummary(request, fixture.services, { env })
    const edited = saveContent(content.id, { ...content, title: '用户同时修改' }, env)
    release()
    await expect(compression).rejects.toThrow('重新加载')
    expect(readContent(content.id, env)).toEqual(edited)
  })

  it('checks the Agent source and binding guard before saving a model result', async () => {
    const { env, content, request } = draft()
    const fixture = model()
    const beforeSave = vi.fn(() => { throw new Error('原稿或对话绑定已更新') })
    await expect(compressDouyinSummary(request, fixture.services, { env, beforeSave })).rejects.toThrow('原稿或对话绑定已更新')
    expect(beforeSave).toHaveBeenCalledOnce()
    expect(readContent(content.id, env)).toEqual(content)
    const controller = new AbortController()
    await expect(compressDouyinSummary(request, fixture.services, { env, signal: controller.signal,
      beforeSave: () => controller.abort(),
    })).rejects.toMatchObject({ code: 'summary-compression-cancelled' })
    expect(readContent(content.id, env)).toEqual(content)
  })

  it.each(['cancel', 'timeout'])('aborts promptly and ignores a late model result: %s', async kind => {
    const { env, content, request } = draft()
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const fixture = model()
    fixture.stream.mockImplementation(async function* () {
      await waiting
      yield { type: 'text-delta', index: 0, text: GENERATED }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const controller = new AbortController()
    const compression = compressDouyinSummary(request, fixture.services, { env, signal: controller.signal,
      timeoutMs: kind === 'timeout' ? 5 : 5000 })
    if (kind === 'cancel') controller.abort()
    await expect(compression).rejects.toMatchObject({ code: kind === 'cancel' ? 'summary-compression-cancelled' : 'summary-compression-timeout' })
    expect(fixture.stream.mock.calls[0][0].signal?.aborted).toBe(true)
    release()
    await new Promise(resolve => setImmediate(resolve))
    expect(readContent(content.id, env)).toEqual(content)
  })
})

describe('summary compression API', () => {
  it('requires the local mutation gate and never creates a Worker submission', async () => {
    const { env, content, request } = draft()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = env.DSH_HOME
    const ctx = new Context()
    const fixture = model()
    const workerRequest = vi.fn()
    let handler!: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    try {
      ctx.provide('webServer', { register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } } as never)
      ctx.provide('desktopRuntime', { publisher: { request: workerRequest } } as never)
      ctx.provide('llm', fixture.services.llm as never)
      ctx.provide('agentDefaultModel', fixture.services.defaultModel as never)
      await ctx.plugin(plugin)
      const send = async (body: unknown, headers: Record<string, string> = { 'x-ejianbao': '1' }) => {
        const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
        Object.assign(req, { method: 'POST', url: `${API}/summary-compress`, headers: { host: '127.0.0.1:43120', ...headers },
          socket: { remoteAddress: '127.0.0.1' } })
        const res = new EventEmitter() as ServerResponse
        let status = 0, serialized = ''
        Object.assign(res, { headersSent: false, destroyed: false,
          writeHead: (code: number) => { status = code }, end: (value: string) => { serialized = value } })
        await handler(req, res)
        return { status, body: JSON.parse(serialized) as Record<string, unknown>, req, res }
      }
      expect((await send(request, {})).status).toBe(403)
      expect((await send(request, { 'x-ejianbao': '1', origin: 'https://evil.example' })).status).toBe(403)
      expect((await send({ ...request, summary: '任意摘要' })).status).toBe(400)
      const response = await send(request)
      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ generated: true, summary: GENERATED, content: { id: content.id, revision: content.revision + 1 } })
      expect(response.req.listenerCount('aborted')).toBe(0)
      expect(response.res.listenerCount('close')).toBe(0)
      expect(workerRequest).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it.each(['response-close', 'request-aborted', 'plugin-dispose'])('cancels on %s and preserves the stored draft', async kind => {
    const { env, content, request } = draft()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = env.DSH_HOME
    const ctx = new Context()
    const fixture = model()
    let started!: () => void, release!: () => void
    const running = new Promise<void>(resolve => { started = resolve })
    const waiting = new Promise<void>(resolve => { release = resolve })
    fixture.stream.mockImplementation(async function* () {
      started()
      await waiting
      yield { type: 'text-delta', index: 0, text: GENERATED }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    let handler!: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    try {
      ctx.provide('webServer', { register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } } as never)
      ctx.provide('desktopRuntime', { publisher: { request: vi.fn() } } as never)
      ctx.provide('llm', fixture.services.llm as never)
      ctx.provide('agentDefaultModel', fixture.services.defaultModel as never)
      await ctx.plugin(plugin)
      const req = Readable.from([Buffer.from(JSON.stringify(request))]) as IncomingMessage
      Object.assign(req, { method: 'POST', url: `${API}/summary-compress`, headers: { host: '127.0.0.1:43120', 'x-ejianbao': '1' },
        socket: { remoteAddress: '127.0.0.1' } })
      const res = new EventEmitter() as ServerResponse
      Object.assign(res, { headersSent: false, destroyed: false, writeHead: vi.fn(), end: vi.fn() })
      const operation = handler(req, res)
      await running
      if (kind === 'response-close') {
        Object.assign(res, { destroyed: true })
        res.emit('close')
      } else if (kind === 'request-aborted') req.emit('aborted')
      else await ctx.fiber.dispose()
      await operation
      expect(fixture.stream.mock.calls[0][0].signal?.aborted).toBe(true)
      release()
      await new Promise(resolve => setImmediate(resolve))
      expect(readContent(content.id, env)).toEqual(content)
      expect(req.listenerCount('aborted')).toBe(0)
      expect(res.listenerCount('close')).toBe(0)
    } finally {
      release?.()
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
