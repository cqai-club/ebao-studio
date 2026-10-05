import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { ECOMMERCE_API, type EcommerceRunSubmit } from './ecommerce-run-protocol.ts'
import { EcommerceRunError, EcommerceRunStore, type EcommerceRunStoreOptions } from './ecommerce-run-store.ts'

/** Match the parent API family's loopback + browser same-origin boundary. */
function guard(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (req.method !== method) { json(res, 405, { ok: false, code: 'method-not-allowed', message: 'method not allowed' }); return false }
  const address = req.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    json(res, 403, { ok: false, code: 'forbidden', message: 'loopback only' }); return false
  }
  try {
    const host = new URL(`http://${req.headers.host ?? ''}`)
    const origin = req.headers.origin
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)
      || req.headers['sec-fetch-site'] === 'cross-site'
      || (origin !== undefined && new URL(origin).host !== host.host)) throw new Error('origin')
  } catch {
    json(res, 403, { ok: false, code: 'forbidden', message: 'same-origin only' }); return false
  }
  return true
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 64 * 1024 * 1024) throw new EcommerceRunError('任务参数与素材超出 64 MB 限制', 'bad-request')
    chunks.push(bytes)
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('shape')
    return result as Record<string, unknown>
  } catch { throw new EcommerceRunError('任务参数格式无效', 'bad-request') }
}

const stores = new WeakMap<object, EcommerceRunStore>()

/** Unsubscribe before a plugin remount replaces its runtime. Awaiting the
 * already queued operations also prevents an old index write winning later. */
export async function disposeEcommerceRoutes(runtime: object): Promise<void> {
  const store = stores.get(runtime)
  if (!store) return
  stores.delete(runtime)
  await store.dispose()
}

/** Called once alongside the ordinary task routes; shares their runtime and
 * channel resolver, while keeping its own durable plan/image store. */
export function makeEcommerceRoutes(deps: EcommerceRunStoreOptions & { store?: EcommerceRunStore }): WebRoute[] {
  let store = deps.store ?? stores.get(deps.runtime)
  if (!store) { store = new EcommerceRunStore(deps); stores.set(deps.runtime, store) }
  else stores.set(deps.runtime, store)
  const runs = store
  const route = (path: string, method: 'GET' | 'POST', execute: (req: IncomingMessage) => Promise<unknown>): WebRoute => ({
    kind: 'exact', path,
    handler: async (req, res) => {
      if (!guard(req, res, method)) return
      try { json(res, 200, { ok: true, ...await execute(req) as object }) }
      catch (error) { json(res, 200, { ok: false, code: error instanceof EcommerceRunError ? error.code : 'ecommerce-failed', message: error instanceof Error ? error.message : String(error) }) }
    },
  })
  const requiredId = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) throw new EcommerceRunError('请提供任务 ID', 'bad-request')
    return value
  }
  return [
    route(ECOMMERCE_API.submit, 'POST', async req => ({ run: await runs.submit(await body(req) as unknown as EcommerceRunSubmit) })),
    route(ECOMMERCE_API.list, 'GET', async () => ({ runs: await runs.list() })),
    route(ECOMMERCE_API.get, 'GET', async req => {
      const id = requiredId(new URL(req.url ?? '', 'http://localhost').searchParams.get('id'))
      const run = await runs.get(id)
      if (!run) throw new EcommerceRunError('历史任务不存在', 'not-found')
      return { run }
    }),
    route(ECOMMERCE_API.remove, 'POST', async req => ({ runs: await runs.remove(requiredId((await body(req)).id)) })),
    route(ECOMMERCE_API.clear, 'POST', async () => ({ runs: await runs.clear() })),
    route(ECOMMERCE_API.cancel, 'POST', async req => ({ run: await runs.cancel(requiredId((await body(req)).id)) })),
    route(ECOMMERCE_API.retry, 'POST', async req => {
      const payload = await body(req)
      if (payload.slotKey !== undefined && typeof payload.slotKey !== 'string') throw new EcommerceRunError('图片位置无效', 'bad-request')
      return { run: await runs.retry(requiredId(payload.id), payload.slotKey as string | undefined) }
    }),
    {
      kind: 'prefix', path: ECOMMERCE_API.asset,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '', 'http://localhost')
        const suffix = url.pathname.slice(ECOMMERCE_API.asset.length + 1)
        const [id, file, extra] = suffix.split('/')
        if (!id || !file || extra !== undefined) { res.writeHead(404); res.end(); return }
        try {
          const image = await runs.readAsset(id, file)
          if (!image) { res.writeHead(404); res.end(); return }
          res.writeHead(200, { 'content-type': image.mime, 'content-length': image.data.length, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
          res.end(image.data)
        } catch (error) {
          json(res, 500, { ok: false, code: 'storage-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
