import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import { DsnAccountError } from './errors.ts'
import type { DsnTopUpResult } from './protocol.ts'

const PAYMENT_BRIDGE_TTL_MS = 2 * 60_000

export type PaymentLauncher = (target: string) => Promise<void>

export async function launchTopUpPayment(
  result: DsnTopUpResult,
  openExternal: PaymentLauncher,
): Promise<void> {
  const target = readPaymentTarget(result.paymentUrl)
  const fields = result.paymentFields === undefined
    ? []
    : Object.entries(result.paymentFields)

  if (fields.length === 0) {
    await openExternal(target.href)
    return
  }

  const bridge = await createPaymentFormBridge(target, fields)
  try {
    await openExternal(bridge.url)
  } catch (error) {
    bridge.close()
    throw error
  }
}

function readPaymentTarget(value: string | undefined): URL {
  if (value === undefined) {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', '支付服务未返回可打开的支付页面。')
  }

  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', '支付服务返回了无效支付页面。')
  }

  const localhost = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '[::1]'
  if (target.username || target.password || (target.protocol !== 'https:' && !(target.protocol === 'http:' && localhost))) {
    throw new DsnAccountError('DSN_PROTOCOL_ERROR', '支付服务返回了不安全的支付页面。')
  }
  return target
}

async function createPaymentFormBridge(
  target: URL,
  fields: ReadonlyArray<readonly [string, string]>,
): Promise<{ readonly url: string; close(): void }> {
  const path = `/cqaiclub-dsn-account/payment/${randomBytes(24).toString('base64url')}`
  let consumed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let server: Server

  const close = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (server.listening) server.close()
  }

  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (consumed || request.method !== 'GET' || requestUrl.pathname !== path || requestUrl.search || requestUrl.hash) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('Not found')
      return
    }

    consumed = true
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action https: http:; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    })
    response.once('finish', close)
    response.end(paymentFormHtml(target.href, fields))
  })

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    close()
    throw new DsnAccountError('DSN_ACCOUNT_UNAVAILABLE', '无法打开本机支付页面。', true)
  }

  timer = setTimeout(close, PAYMENT_BRIDGE_TTL_MS)
  timer.unref()
  return { url: `http://127.0.0.1:${address.port}${path}`, close }
}

function paymentFormHtml(target: string, fields: ReadonlyArray<readonly [string, string]>): string {
  const inputs = fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在打开支付页面</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#18202a;font:15px/1.6 system-ui,sans-serif}.card{max-width:420px;padding:28px;border-radius:16px;background:#fff;box-shadow:0 16px 45px rgba(26,44,72,.12);text-align:center}button{margin-top:14px;padding:10px 18px;border:0;border-radius:9px;background:#2868d7;color:#fff;font:inherit;cursor:pointer}</style></head><body><main class="card"><h1>正在打开支付页面…</h1><p>如果浏览器没有自动继续，请点击下方按钮。</p><form method="post" action="${escapeHtml(target)}">${inputs}<button type="submit">继续支付</button></form></main><script>document.forms[0].submit()</script></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
