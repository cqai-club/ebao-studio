import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Platform } from './protocol.ts'
import { API } from './protocol.ts'
import { MatrixMedia } from './runtime.ts'
import { Publisher } from './jobs.ts'
import { Logins } from './login.ts'
import { listWorks } from './works.ts'

export const name = 'cqai-publisher'
export const inject = ['webServer']

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
  res.end(JSON.stringify(data))
}

/**
 * Gate every request that reaches the port. The server is bound to loopback, but
 * a page in a browser on the same machine could still reach it, so the origin and
 * `sec-fetch-site` checks matter as much as the address check.
 */
export function permitted(req: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return req.method === 'GET' || req.headers['x-ejianbao'] === '1'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 200000) throw new Error('请求过大')
    chunks.push(Buffer.from(chunk))
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

export function apply(ctx: Context): void {
  const mm = new MatrixMedia()
  const publisher = new Publisher(mm)
  const logins = new Logins(mm)

  ctx.effect(() => {
    const unregister = ctx.webServer.register({kind: 'prefix', path: API, handler: async (req, res) => {
      if (!permitted(req)) return json(res, 403, {error: '仅允许本机应用访问'})
      try {
        const url = new URL(req.url!, 'http://localhost')
        const action = url.pathname.slice(API.length + 1)
        const id = url.searchParams.get('id') ?? ''
        if (req.method === 'GET' && action === 'status') return json(res, 200, await mm.status())
        if (req.method === 'GET' && action === 'works') return json(res, 200, listWorks())
        if (req.method === 'GET' && action === 'accounts') return json(res, 200, await publisher.accounts())
        if (req.method === 'GET' && action === 'history') return json(res, 200, await publisher.history(Number(url.searchParams.get('limit')) || 50))
        if (req.method === 'GET' && action === 'jobs') return json(res, 200, publisher.list())
        if (req.method === 'GET' && action === 'job') return json(res, 200, publisher.get(id))
        if (req.method === 'POST' && action === 'jobs') return json(res, 201, publisher.create(await readJson(req)))
        if (req.method === 'POST' && action === 'start') {
          // `guard` answers with a real error before the request returns; the
          // run itself is deliberately not awaited, so its failures have to be
          // parked on the job instead of becoming an unhandled rejection.
          publisher.guard(id)
          void publisher.start(id).catch((error: unknown) => {publisher.fail(id, error)})
          return json(res, 202, {ok: true})
        }
        if (req.method === 'POST' && action === 'cancel') return json(res, 200, await publisher.cancel(id))
        if (req.method === 'POST' && action === 'login') {
          const body = (await readJson(req)) as {platform?: Platform; phone?: string}
          const session = await logins.start(body.platform as Platform, String(body.phone ?? '').trim())
          return json(res, 200, {id: session.id, platform: session.platform, qr: session.qr, state: session.state, message: session.message})
        }
        if (req.method === 'GET' && action === 'login') {
          const session = logins.poll(id)
          logins.forget(id)
          return json(res, 200, {id: session.id, platform: session.platform, qr: session.qr, state: session.state, message: session.message})
        }
        if (req.method === 'POST' && action === 'login-cancel') {logins.cancel(id); return json(res, 200, {ok: true})}
        json(res, 404, {error: '接口不存在'})
      } catch (error) {
        if (!res.headersSent && !res.destroyed) json(res, 400, {error: error instanceof Error ? error.message : '操作失败'})
      }
    }})
    return async () => {unregister(); await logins.dispose()}
  }, '一稿多发与本地服务')
}
