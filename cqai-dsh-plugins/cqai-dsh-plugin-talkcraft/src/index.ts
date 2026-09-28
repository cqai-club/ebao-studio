import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-jobs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createReadStream, createWriteStream, existsSync, realpathSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { extname, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transform } from 'node:stream'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { API, type UploadKind } from './protocol.ts'
import { JobStore } from './store.ts'
import { EdgeVoiceCatalog } from './edge-voices.ts'
import { EdgeVoicePreview } from './edge-preview.ts'
import { TalkCraftAgents, type AgentServices } from './agent.ts'
import { Secrets, type SecretName } from './secrets.ts'
import { Pipeline } from './pipeline.ts'
import { Workbench } from './workbench.ts'
import { health } from './runtime.ts'

export const name = 'cqai-talkcraft'
export const inject = ['webServer', 'credentials']
const json = (res: ServerResponse, code: number, value: unknown) => {res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(value))}
export function permitted(req: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return req.method === 'GET' || req.headers['x-talkcraft'] === '1'
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let size = 0
  for await (const chunk of req) {size += chunk.length; if (size > 50000) throw new Error('请求内容过大'); parts.push(Buffer.from(chunk))}
  const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式无效')
  return value as Record<string, unknown>
}
function serveFile(req: IncomingMessage, res: ServerResponse, path: string, download: boolean): void {
  const size = statSync(path).size
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  const suffix = range && !range[1] && range[2] ? Number(range[2]) : 0
  const start = suffix ? Math.max(0, size - suffix) : range?.[1] ? Number(range[1]) : 0
  const end = suffix ? size - 1 : range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  if ((req.headers.range && !range) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (range && !range[1] && !range[2])) {res.writeHead(416, {'content-range': `bytes */${size}`}); res.end(); return}
  const mime: Record<string, string> = {'.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf'}
  res.writeHead(range ? 206 : 200, {'content-type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', ...(range ? {'content-range': `bytes ${start}-${end}/${size}`} : {}), ...(download ? {'content-disposition': `attachment; filename="${path.split(/[\\/]/).pop()}"`} : {})})
  const stream = createReadStream(path, {start, end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
}

export function apply(ctx: Context): void {
  const upstream = fileURLToPath(new URL('../upstream/', import.meta.url))
  const home = join(resolveDshHome(), 'talkcraft')
  const store = new JobStore(join(home, 'jobs'))
  const edgeVoices = new EdgeVoiceCatalog(upstream, join(home, 'edge-voices.json'))
  const edgePreview = new EdgeVoicePreview(upstream, join(home, 'previews'))
  const secrets = new Secrets({
    readRecord: key => ctx.credentials.readRecord(key),
    modifyRecord: (key, mutate) => ctx.credentials.modifyRecord(key, mutate),
  })
  const agents = new TalkCraftAgents()
  const work = new Pipeline(store, agents, secrets, upstream)
  const editor = new Workbench(store, upstream)
  ctx.inject(['jobs'], jobsCtx => {
    jobsCtx.effect(() => jobsCtx.jobs.events.subscribe({owners: 'all'}, event => {
      if (event.type === 'settled' && event.job.owner !== undefined)
        work.recordBackgroundStep(String(event.job.owner), event.job.status)
    }), 'TalkCraft 制作步骤记录')
  })
  ctx.inject(['agents', 'agentPresets', 'agentDefaultModel'], sctx => {
    agents.attach({agents: sctx.get('agents'), presets: sctx.get('agentPresets'), defaultModel: sctx.get('agentDefaultModel')} as AgentServices)
    const diagnosis = agents.diagnosis()
    console.info(`cqai-talkcraft: Agent service ${diagnosis.length ? diagnosis.join('；') : 'ready'}`)
    sctx.effect(() => () => agents.detach(), 'TalkCraft Agent 服务')
  })
  ctx.effect(() => {
    const activeUploads = new Set<string>()
    const unregister = ctx.webServer.register({kind: 'prefix', path: API, handler: async (req, res) => {
      if (!permitted(req)) return json(res, 403, {error: '仅允许本机 Desktop 页面访问'})
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const action = url.pathname.slice(API.length + 1)
        const id = url.searchParams.get('id') ?? ''
        if (req.method === 'GET' && action === 'health') return json(res, 200, {...await health(upstream), agents: agents.diagnosis()})
        if (req.method === 'GET' && action === 'edge-voices') return json(res, 200, await edgeVoices.list(url.searchParams.get('refresh') === '1'))
        if (req.method === 'POST' && action === 'edge-preview') {
          const input = await body(req)
          const controller = new AbortController()
          const abort = () => controller.abort()
          res.once('close', abort)
          try {
            const audio = await edgePreview.generate(input.voice, input.text, controller.signal)
            if (!res.destroyed) {
              res.writeHead(200, {'content-type': 'audio/mpeg', 'content-length': String(audio.length), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
              res.end(audio)
            }
          } finally {res.off('close', abort)}
          return
        }
        if (req.method === 'GET' && action === 'settings') return json(res, 200, await secrets.publicState())
        if (req.method === 'POST' && action === 'settings') {
          const input = await body(req); const key = input.name as SecretName
          if (!['fish', 'pexels', 'pixabay'].includes(key) || typeof input.value !== 'string' || input.value.length > 1000) throw new Error('设置字段无效')
          await secrets.set(key, input.value); return json(res, 200, await secrets.publicState())
        }
        if (req.method === 'GET' && action === 'jobs') return json(res, 200, store.list())
        if (req.method === 'GET' && action === 'documents') return json(res, 200, store.documents(id))
        if (req.method === 'POST' && action === 'jobs') return json(res, 201, store.create(await body(req)))
        if (req.method === 'DELETE' && action === 'jobs') {
          if (activeUploads.has(id)) throw new Error('素材仍在上传，请稍后再删除')
          await work.delete(id, () => editor.close(id))
          return json(res, 200, {ok: true})
        }
        if (req.method === 'POST' && action === 'start') return json(res, 200, await work.start(id))
        if (req.method === 'POST' && action === 'retry-edge') return json(res, 200, work.retryEdge(id))
        if (req.method === 'POST' && action === 'cancel') return json(res, 200, await work.cancel(id))
        if (req.method === 'POST' && action === 'approve') {
          const input = await body(req)
          if (input.gate !== 'shotbook' && input.gate !== 'sample') throw new Error('确认阶段无效')
          return json(res, 200, await work.approve(id, input.gate, input.accepted === true, String(input.feedback ?? ''), Array.isArray(input.selected) ? input.selected as string[] : undefined))
        }
        if (req.method === 'POST' && action === 'upload') {
          if (activeUploads.has(id)) throw new Error('该视频的素材正在上传')
          const job = store.get(id)
          if (job.status !== 'draft' && !(['failed', 'interrupted', 'cancelled'].includes(job.status) && (job.fishSubmission === 'uncertain' || job.edgeSubmission === 'uncertain'))) throw new Error('仅可在开始前上传素材')
          const kind = url.searchParams.get('kind') as UploadKind
          const filename = url.searchParams.get('name') ?? ''
          const ext = extname(filename).toLowerCase()
          const allowed: Record<UploadKind, string[]> = {voice: ['.wav', '.mp3', '.m4a', '.aac', '.ogg'], video: ['.mp4', '.mov', '.webm'], image: ['.png', '.jpg', '.jpeg', '.webp']}
          if (!allowed[kind]?.includes(ext)) throw new Error('不支持的素材格式')
          activeUploads.add(id)
          try {
            const relative = `inputs/${kind}-${randomUUID()}${ext}`
            const target = store.file(id, relative)
            await mkdir(dirname(target), {recursive: true})
            const limit = kind === 'voice' ? 250 * 1024 * 1024 : 1024 * 1024 * 1024
            let size = 0
            const limiter = new Transform({transform(chunk, _encoding, callback) {size += chunk.length; callback(size > limit ? new Error('素材文件过大') : null, chunk)}})
            try {await streamPipeline(req, limiter, createWriteStream(target + '.upload')); if (!size) throw new Error('素材为空'); await rename(target + '.upload', target)}
            catch (error) {await rm(target + '.upload', {force: true}); throw error}
            if (kind === 'voice' && (job.fishSubmission === 'uncertain' || job.edgeSubmission === 'uncertain')) {
              await rm(store.file(id, 'audio/full.wav'), {force: true}); await rm(store.file(id, 'audio/timestamps.json'), {force: true})
              job.fishSubmission = undefined; job.edgeSubmission = undefined; job.status = 'draft'; job.completedStages = []
            }
            store.upload(job, kind, relative, filename.slice(0, 200))
            return json(res, 200, job)
          } finally {activeUploads.delete(id)}
        }
        if (req.method === 'GET' && action === 'artifact') {
          const job = store.get(id), file = url.searchParams.get('file') ?? ''
          if (!job.artifacts.some(item => item.file === file)) throw new Error('文件不在任务产物中')
          const root = realpathSync(store.directory(id)), path = realpathSync(store.file(id, file))
          if (!path.startsWith(root + sep) || !existsSync(path)) throw new Error('产物路径无效')
          serveFile(req, res, path, url.searchParams.get('download') === '1'); return
        }
        if (req.method === 'GET' && action === 'media') {
          const job = store.get(id), file = url.searchParams.get('file') ?? ''
          if (!job.uploads.some(item => item.file === file)) throw new Error('素材不在当前任务中')
          const root = realpathSync(store.directory(id)), path = realpathSync(store.file(id, file))
          if (!path.startsWith(root + sep) || !existsSync(path)) throw new Error('素材路径无效')
          serveFile(req, res, path, false); return
        }
        if (req.method === 'POST' && action === 'editor/open') return json(res, 200, {url: await editor.open(id)})
        if (req.method === 'POST' && action === 'editor/close') {await editor.close(id || undefined); return json(res, 200, {ok: true})}
        if (req.method === 'GET' && action === 'editor/state') return json(res, 200, editor.current())
        json(res, 404, {error: '接口不存在'})
      } catch (error) {if (!res.headersSent && !res.destroyed) json(res, 400, {error: error instanceof Error ? error.message : '操作失败'})}
    }})
    return async () => {unregister(); work.dispose(); await editor.close()}
  }, 'TalkCraft 独立任务服务')
}
