import type { IncomingMessage, ServerResponse } from 'node:http'
import { createDocxBuffer, docxFileName } from './docx.ts'
import { databaseLabel, databaseStatuses } from './database-connectors.ts'
import {
  finalizeProject,
  generateEnglishSearchQuery,
  initialProject,
  ResearchGenerationError,
  streamResearchAssist,
  streamProjectDraft,
  type ResearchModelServices,
} from './generation.ts'
import { searchLiterature, type LiteratureSearchResult } from './literature.ts'
import {
  API,
  parseAssistRequest,
  isTaskKind,
  parseRunRequest,
  safeFileStem,
  type AssistEvent,
  type HealthResponse,
  type ScholarProject,
  type StreamEvent,
} from './protocol.ts'
import {
  listProjects,
  readProject,
  removeProject,
  replaceProject,
  saveProject,
  validProjectId,
} from './store.ts'

const MAX_JSON_BODY = 96 * 1024
const MAX_PROJECT_BODY = 512 * 1024
const LONG_JOB_TIMEOUT_MS = 12 * 60 * 1000

interface RoutesOptions {
  services: () => ResearchModelServices
  fetcher?: typeof fetch
  projectRoot?: string
  env?: NodeJS.ProcessEnv
}

class RouteError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'RouteError'
  }
}
function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function permitted(req: IncomingMessage, mutation: boolean): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false
  if (!sameOrigin(req)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (mutation && req.headers['x-eyanbao'] !== '1') return false
  return true
}

function json(res: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(body)
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) throw new RouteError('请求内容过大', 413, 'body-too-large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) throw new RouteError('请求体不能为空', 400, 'body-required')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RouteError('请求体不是有效 JSON', 400, 'invalid-json')
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function modelHealth(services: ResearchModelServices): HealthResponse {
  const selected = services.defaultModel?.currentSelection()
  const provider = typeof selected?.provider === 'string' ? selected.provider : undefined
  const model = typeof selected?.model === 'string' ? selected.model : undefined
  const ready = services.llm !== undefined && provider !== undefined && model !== undefined
    && provider.trim() !== '' && model.trim() !== ''
  return {
    ok: ready,
    modelReady: ready,
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...ready ? {} : { message: '请先在模型设置中配置默认文字模型。' },
  }
}

function searchText(project: ScholarProject): string {
  return [project.prompt, project.discipline].filter(Boolean).join(' ')
}

async function writeEvent(res: ServerResponse, event: StreamEvent | AssistEvent): Promise<void> {
  if (res.destroyed || res.writableEnded) return
  const canContinue = res.write(`${JSON.stringify(event)}\n`)
  if (!canContinue) {
    await new Promise<void>(resolve => {
      const done = () => {
        res.off('drain', done)
        res.off('close', done)
        resolve()
      }
      res.once('drain', done)
      res.once('close', done)
    })
  }
}

async function runAssist(
  req: IncomingMessage,
  res: ServerResponse,
  options: RoutesOptions,
): Promise<void> {
  const request = parseAssistRequest(await readJson(req, MAX_JSON_BODY))
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-accel-buffering': 'no',
  })
  res.flushHeaders()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('AI 辅助超时，请重试。')), 3 * 60 * 1000)
  timer.unref?.()
  const closed = () => {
    if (!res.writableEnded) controller.abort(new Error('AI 辅助已取消。'))
  }
  res.once('close', closed)
  try {
    await writeEvent(res, { type: 'status', message: '正在分析当前研究需求' })
    const text = await streamResearchAssist(
      request,
      options.services(),
      async text => writeEvent(res, { type: 'delta', text }),
      controller.signal,
    )
    await writeEvent(res, { type: 'result', text })
  } catch (error) {
    await writeEvent(res, { type: 'error', message: messageOf(error) })
  } finally {
    clearTimeout(timer)
    res.off('close', closed)
    if (!res.writableEnded) res.end()
  }
}

async function searchSources(
  project: ScholarProject,
  options: RoutesOptions,
  signal: AbortSignal,
): Promise<LiteratureSearchResult> {
  const scope = project.literatureScope ?? 'mixed'
  let queries = [searchText(project)]
  if (scope !== 'zh') {
    const english = await generateEnglishSearchQuery(searchText(project), options.services(), signal)
    if (english !== undefined) {
      queries = scope === 'foreign' ? [english, ...queries] : [...queries, english]
    }
  }
  return await searchLiterature(queries, {
    limit: project.sourceCount,
    ...project.yearFrom === undefined ? {} : { yearFrom: project.yearFrom },
    scope,
    journalQuality: scope === 'foreign' ? project.journalQuality : 'any',
    databases: project.databases ?? ['openalex', 'crossref'],
    env: options.env,
    signal,
    ...options.fetcher === undefined ? {} : { fetcher: options.fetcher },
  })
}

function searchStatus(project: ScholarProject, verify = false): string {
  const scope = project.literatureScope === 'foreign'
    ? '外文文献，必要时生成英文检索词'
    : project.literatureScope === 'zh'
      ? '中文文献'
      : '中外文文献，必要时生成英文检索词'
  const quality = project.literatureScope === 'foreign' && project.journalQuality !== 'any'
    ? `，${project.journalQuality === 'top-only' ? '仅限顶级期刊' : '顶刊优先'}`
    : ''
  const databases = (project.databases ?? ['openalex', 'crossref']).map(databaseLabel).join('、')
  return `正在检索${scope}${quality}${verify ? '，并核对来源' : ''}（${databases}）`
}

async function runProject(
  req: IncomingMessage,
  res: ServerResponse,
  options: RoutesOptions,
): Promise<void> {
  const request = parseRunRequest(await readJson(req, MAX_JSON_BODY))
  let project = initialProject(request)
  project.status = 'running'
  project = await saveProject(project, { root: options.projectRoot, env: options.env })
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-accel-buffering': 'no',
  })
  res.flushHeaders()
  await writeEvent(res, { type: 'project', project })

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new ResearchGenerationError('生成超时，已保留当前草稿。', 'timeout'))
  }, LONG_JOB_TIMEOUT_MS)
  timer.unref?.()
  const closed = () => {
    if (!res.writableEnded) controller.abort(new ResearchGenerationError('生成已取消。', 'cancelled'))
  }
  res.once('close', closed)
  let content = ''
  try {
    if (request.kind === 'search') {
      await writeEvent(res, { type: 'status', stage: 'search', message: searchStatus(project) })
      const result = await searchSources(project, options, controller.signal)
      project = {
        ...project,
        title: `${request.prompt.slice(0, 42)}${request.prompt.length > 42 ? '…' : ''} · 文献清单`,
        sources: result.sources,
        status: 'complete',
        content: result.sources.map((source, index) => {
          const authors = source.authors.join('、') || '佚名'
          return `### [${index + 1}] ${source.title}\n\n${authors}${source.language === undefined ? '' : ` · ${source.language}`}${source.topJournal === true ? ' · 顶级期刊' : ''}${source.year === undefined ? '' : ` · ${source.year}`}${
            source.venue === undefined ? '' : ` · ${source.venue}`
          }${source.citedBy === undefined ? '' : ` · 被引 ${source.citedBy}`}\n\n${
            source.abstract === undefined ? '暂无摘要。' : source.abstract
          }${source.doi === undefined ? '' : `\n\n[查看原文](https://doi.org/${source.doi})`}`
        }).join('\n\n---\n\n'),
        warning: result.warning,
      }
      project = await saveProject(project, { root: options.projectRoot, env: options.env })
      await writeEvent(res, { type: 'sources', sources: result.sources, ...result.warning === undefined ? {} : { warning: result.warning } })
      await writeEvent(res, { type: 'result', project })
      return
    }

    await writeEvent(res, { type: 'status', stage: 'search', message: searchStatus(project, true) })
    const result = await searchSources(project, options, controller.signal)
    project = {
      ...project,
      sources: result.sources,
      warning: result.warning,
    }
    project = await saveProject(project, { root: options.projectRoot, env: options.env })
    await writeEvent(res, { type: 'sources', sources: result.sources, ...result.warning === undefined ? {} : { warning: result.warning } })
    await writeEvent(res, { type: 'status', stage: 'evidence', message: '来源已就绪，正在整理证据链' })
    await writeEvent(res, { type: 'status', stage: 'write', message: '正在生成可编辑正文' })
    content = await streamProjectDraft(
      project,
      result.sources,
      options.services(),
      async text => {
        content += text
        await writeEvent(res, { type: 'delta', text })
      },
      controller.signal,
    )
    await writeEvent(res, { type: 'status', stage: 'polish', message: '正在校对结构与引用' })
    project = finalizeProject(project, content, result.sources)
    project = await saveProject(project, { root: options.projectRoot, env: options.env })
    await writeEvent(res, { type: 'result', project })
  } catch (error) {
    const cancelled = controller.signal.aborted
    const message = cancelled ? messageOf(controller.signal.reason) : messageOf(error)
    project = {
      ...project,
      content,
      status: content.trim() === '' ? 'error' : 'draft',
      error: message,
      warning: project.warning,
    }
    try {
      project = await saveProject(project, { root: options.projectRoot, env: options.env })
    } catch {
      // The stream can close while the app is shutting down; still try to report.
    }
    await writeEvent(res, { type: 'error', message, project })
  } finally {
    clearTimeout(timer)
    res.off('close', closed)
    if (!res.writableEnded) res.end()
  }
}

function patchProject(current: ScholarProject, body: unknown): ScholarProject {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new RouteError('项目修改格式无效', 400, 'invalid-project')
  const value = body as Record<string, unknown>
  const next = { ...current }
  if (value.title !== undefined) {
    if (typeof value.title !== 'string' || value.title.trim() === '' || value.title.length > 240) {
      throw new RouteError('项目标题无效', 400, 'invalid-title')
    }
    next.title = value.title.trim()
  }
  if (value.content !== undefined) {
    if (typeof value.content !== 'string' || value.content.length > 250_000) {
      throw new RouteError('正文内容无效或过长', 400, 'invalid-content')
    }
    next.content = value.content
  }
  if (value.abstract !== undefined) {
    if (typeof value.abstract !== 'string' || value.abstract.length > 8_000) {
      throw new RouteError('摘要内容无效或过长', 400, 'invalid-abstract')
    }
    next.abstract = value.abstract
  }
  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords) || value.keywords.length > 30
      || value.keywords.some(keyword => typeof keyword !== 'string' || keyword.length > 80)) {
      throw new RouteError('关键词格式无效', 400, 'invalid-keywords')
    }
    next.keywords = value.keywords.map(keyword => String(keyword).trim()).filter(Boolean)
  }
  if (value.layout !== undefined) {
    if (value.layout === null || typeof value.layout !== 'object' || Array.isArray(value.layout)) {
      throw new RouteError('排版设置格式无效', 400, 'invalid-layout')
    }
    const layout = value.layout as Record<string, unknown>
    const allowedTemplates = new Set(['journal', 'thesis'])
    const allowedDegrees = new Set(['undergraduate', 'master', 'doctoral'])
    const text = (key: string, max: number) => {
      const raw = layout[key]
      if (raw === undefined) return undefined
      if (typeof raw !== 'string' || raw.length > max) throw new RouteError(`排版字段 ${key} 无效`, 400, 'invalid-layout')
      return raw.trim()
    }
    const journalName = text('journalName', 120)
    const author = text('author', 80)
    const affiliation = text('affiliation', 160)
    if (layout.template !== undefined && (typeof layout.template !== 'string' || !allowedTemplates.has(layout.template))) {
      throw new RouteError('排版模板无效', 400, 'invalid-layout')
    }
    if (layout.degree !== undefined && (typeof layout.degree !== 'string' || !allowedDegrees.has(layout.degree))) {
      throw new RouteError('学位层次无效', 400, 'invalid-layout')
    }
    next.layout = {
      ...next.layout,
      ...journalName === undefined ? {} : { journalName },
      ...author === undefined ? {} : { author },
      ...affiliation === undefined ? {} : { affiliation },
      ...layout.template === undefined ? {} : { template: layout.template as 'journal' | 'thesis' },
      ...layout.degree === undefined ? {} : { degree: layout.degree as ScholarProject['layout']['degree'] },
    }
  }
  return next
}

export function createRouteHandler(options: RoutesOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const mutation = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE'
    if (!permitted(req, mutation)) {
      json(res, 403, { error: '仅允许 e研宝本机页面访问' })
      return
    }
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      json(res, 400, { error: '请求地址无效' })
      return
    }
    if (url.pathname === API || url.pathname === `${API}/`) {
      json(res, 404, { error: '接口不存在' })
      return
    }
    if (!url.pathname.startsWith(`${API}/`)) {
      json(res, 404, { error: '接口不存在' })
      return
    }
    const action = url.pathname.slice(API.length + 1)
    try {
      if (req.method === 'GET' && action === 'health') {
        json(res, 200, modelHealth(options.services()))
        return
      }
      if (req.method === 'GET' && action === 'databases') {
        json(res, 200, { databases: databaseStatuses(options.env ?? process.env) })
        return
      }
      if (req.method === 'GET' && action === 'projects') {
        json(res, 200, { projects: await listProjects({ root: options.projectRoot, env: options.env }) })
        return
      }
      if (req.method === 'POST' && action === 'run') {
        await runProject(req, res, options)
        return
      }
      if (req.method === 'POST' && action === 'assist') {
        await runAssist(req, res, options)
        return
      }
      const match = /^projects\/([^/]+)(?:\/(export\.docx|export\.md))?$/u.exec(action)
      if (match !== null) {
        const id = decodeURIComponent(match[1])
        if (!validProjectId(id)) throw new RouteError('项目 ID 无效', 400, 'invalid-id')
        if (req.method === 'GET' && match[2] === undefined) {
          const project = await readProject(id, { root: options.projectRoot, env: options.env })
          if (project === undefined) throw new RouteError('找不到研究项目', 404, 'not-found')
          json(res, 200, { project })
          return
        }
        if (req.method === 'GET' && match[2] === 'export.md') {
          const project = await readProject(id, { root: options.projectRoot, env: options.env })
          if (project === undefined) throw new RouteError('找不到研究项目', 404, 'not-found')
          const body = `# ${project.title}\n\n${project.abstract === '' ? '' : `> 摘要：${project.abstract}\n\n`}${
            project.keywords.length === 0 ? '' : `> 关键词：${project.keywords.join('；')}\n\n`
          }${project.content}\n`
          const encoded = encodeURIComponent(`${safeFileStem(project.title)}.md`)
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename*=UTF-8''${encoded}`,
            'cache-control': 'no-store',
          })
          res.end(body)
          return
        }
        if (req.method === 'GET' && match[2] === 'export.docx') {
          const project = await readProject(id, { root: options.projectRoot, env: options.env })
          if (project === undefined) throw new RouteError('找不到研究项目', 404, 'not-found')
          const buffer = await createDocxBuffer(project)
          const encoded = encodeURIComponent(docxFileName(project))
          res.writeHead(200, {
            'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'content-length': buffer.byteLength,
            'content-disposition': `attachment; filename*=UTF-8''${encoded}`,
            'cache-control': 'no-store',
          })
          res.end(buffer)
          return
        }
        if (req.method === 'PATCH' || req.method === 'POST') {
          const body = await readJson(req, MAX_PROJECT_BODY)
          const project = await replaceProject(id, current => patchProject(current, body), {
            root: options.projectRoot,
            env: options.env,
          })
          json(res, 200, { project })
          return
        }
        if (req.method === 'DELETE') {
          await removeProject(id, { root: options.projectRoot, env: options.env })
          json(res, 200, { ok: true })
          return
        }
      }
      json(res, 404, { error: '接口不存在' })
    } catch (error) {
      const status = error instanceof RouteError ? error.status : 400
      json(res, status, { error: messageOf(error) })
    }
  }
}
