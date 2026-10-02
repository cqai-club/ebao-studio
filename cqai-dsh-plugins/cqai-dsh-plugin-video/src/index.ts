import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createMediaSettings, createMediaSettingsHandler } from 'cqai-dsh-media-settings'
import { createReadStream, createWriteStream, realpathSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join, extname, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { API, type UploadKind } from './protocol.ts'
import { JobStore, validateOptions } from './jobs.ts'
import { UPLOADS, validateUpload } from './uploads.ts'
import { ManagedJobs, type VideoAccount } from './managed-jobs.ts'
import { checkVideoHealth, createVideoHealth, createVideoSetup, videoEnvironment, videoPython, videoRuntime } from './runtime.ts'

export const name = 'cqai-video'
export const inject = ['webServer', 'dsnAccount', 'credentials']
function json(res: ServerResponse, code: number, data: unknown) {res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(data))}
export function permitted(req: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return req.method === 'GET' || req.headers['x-ejianbao'] === '1'
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) {size += chunk.length; if (size > 200000) throw new Error('请求过大'); chunks.push(Buffer.from(chunk))}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function serveArtifact(req: IncomingMessage, res: ServerResponse, path: string, download: boolean) {
  const size = statSync(path).size; let start = 0; let end = size - 1; let status = 200
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (!m || (!m[1] && !m[2])) {res.writeHead(416, {'content-range': `bytes */${size}`}); res.end(); return}
    start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start > end || start >= size) {res.writeHead(416, {'content-range': `bytes */${size}`}); res.end(); return}
    status = 206
  }
  const types: Record<string, string> = {'.mp4': 'video/mp4', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8'}
  res.writeHead(status, {'content-type': types[extname(path)] ?? 'application/octet-stream', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', ...(status === 206 ? {'content-range': `bytes ${start}-${end}/${size}`} : {}), ...(download ? {'content-disposition': `attachment; filename="${path.split(/[\\/]/).pop()}"`} : {})})
  const stream = createReadStream(path, {start, end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
}
export function apply(ctx: Context): void {
  const dshHome = resolveDshHome()
  const mediaSettings = createMediaSettings({home: dshHome, credentials: {
    readRecord: key => ctx.credentials.readRecord(key),
    modifyRecord: (key, mutate) => ctx.credentials.modifyRecord(key, mutate),
  }})
  const handleMediaSettings = createMediaSettingsHandler(mediaSettings, {path: `${API}/media-settings`})
  const source = fileURLToPath(new URL('../runtime/', import.meta.url))
  const runtime = videoRuntime(source)
  const store = new JobStore(join(dshHome, 'ejianbao', 'jobs'), runtime, () => videoPython(dshHome), () => videoEnvironment(dshHome))
  const account = () => (ctx as Context & {dsnAccount: VideoAccount}).dsnAccount
  const managed = new ManagedJobs(store, {
    fetchAi: (path, init, signal) => account().fetchAi(path, init, signal),
    getAccount: () => account().getAccount(),
  })
  store.managedGenerate = (job, signal) => managed.generate(job, signal)
  const health = createVideoHealth(() => checkVideoHealth(runtime, store.python, videoEnvironment(dshHome)))
  const setup = createVideoSetup(dshHome, runtime)
  let setupFinishedAt = 0
  const setupSnapshot = () => {
    const state = setup.snapshot()
    if (state.status !== 'idle' && state.status !== 'running' && state.updatedAt !== setupFinishedAt) {setupFinishedAt = state.updatedAt; health.invalidate()}
    return state
  }
  ctx.effect(() => {
    const unregister = ctx.webServer.register({kind: 'prefix', path: API, handler: async (req, res) => {
      if (await handleMediaSettings(req, res)) return
      if (!permitted(req)) return json(res, 403, {error: '仅允许本机应用访问'})
      try {
        const url = new URL(req.url!, 'http://localhost'); const action = url.pathname.slice(API.length + 1)
        const id = url.searchParams.get('id') ?? ''
        if (req.method === 'GET' && action === 'health') {const state = setupSnapshot(); return json(res, 200, {...await health.read(url.searchParams.get('refresh') === '1'), setup: state})}
        if (req.method === 'GET' && action === 'setup') return json(res, 200, setupSnapshot())
        if (req.method === 'POST' && action === 'setup') {if ([...store.jobs.values()].some(job => job.status === 'running')) throw new Error('正在制作，请等待当前任务完成后修复环境'); health.invalidate(); return json(res, 202, setup.start())}
        if (req.method === 'GET' && action === 'jobs') return json(res, 200, [...store.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(j => ({...j, logs: j.logs.slice(-40)})))
        if (req.method === 'POST' && action === 'jobs') return json(res, 201, store.create(validateOptions(await readJson(req))))
        if (req.method === 'POST' && action === 'quote') return json(res, 200, await managed.quote(id))
        if (req.method === 'POST' && action === 'start') {if (setup.snapshot().status === 'running') throw new Error('环境正在准备，请完成后再制作'); return json(res, 200, store.start(id))}
        if (req.method === 'POST' && action === 'cancel') {await store.cancel(id); return json(res, 200, store.get(id))}
        if (req.method === 'POST' && action === 'upload') {
          const job = store.get(id); if (job.status !== 'draft') throw new Error('只能修改尚未开始的任务素材')
          const kind = url.searchParams.get('kind') as UploadKind; const filename = url.searchParams.get('name') ?? ''; const ext = extname(filename).toLowerCase()
          validateUpload(kind, {name: filename})
          const file = `inputs/${kind}${ext}`; const dest = join(store.dir(id), file); await mkdir(dirname(dest), {recursive: true})
          const max = UPLOADS[kind].max; let size = 0
          const limiter = new Transform({transform(chunk, _encoding, callback) {size += chunk.length; callback(size > max ? new Error('素材文件过大') : null, chunk)}})
          try {await pipeline(req, limiter, createWriteStream(dest + '.upload')); if (!size) throw new Error(`${UPLOADS[kind].label}“${filename}”未收到文件内容，请重新选择该文件后上传`); await rename(dest + '.upload', dest)}
          catch (error) {await rm(dest + '.upload', {force: true}); throw error}
          job.uploads[kind] = {file, name: filename.slice(0, 200)}; store.save(job); return json(res, 200, job)
        }
        if (req.method === 'GET' && action === 'artifact') {
          const job = store.get(id); const file = url.searchParams.get('file') ?? ''
          if (!job.artifacts.some(a => a.file === file)) throw new Error('文件不在任务产物中')
          const path = realpathSync(join(store.dir(id), file)); const root = realpathSync(store.dir(id))
          if (!path.startsWith(root + sep)) throw new Error('非法文件路径')
          serveArtifact(req, res, path, url.searchParams.get('download') === '1'); return
        }
        json(res, 404, {error: '接口不存在'})
      } catch (error) {if (!res.headersSent && !res.destroyed) json(res, 400, {error: error instanceof Error ? error.message : '操作失败'})}
    }})
    return async () => {unregister(); await store.dispose()}
  }, 'e剪宝任务与本地服务')
}
