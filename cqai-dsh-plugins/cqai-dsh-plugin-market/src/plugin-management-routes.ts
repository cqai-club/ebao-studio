import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PRODUCT_PACKAGES } from './product-bundles.js'

const PREFIX = '/api/cqai-plugin-management'
const MAX_BODY_BYTES = 2_048

const PRODUCT_BUNDLES = new Set<string>(PRODUCT_PACKAGES)

interface Bundle {
  readonly bundleId: string
  readonly packageName: string
  readonly status: 'active' | 'disabled'
  readonly mutable: boolean
  readonly uninstallable: boolean
}

interface Preview {
  readonly previewId: string
  readonly packageName: string
  readonly expiresAt: string
}

export interface DesktopPlugins {
  list(): readonly Bundle[]
  loadedPackageNames(): readonly string[]
  previewDisable(bundleId: string): Preview
  executeDisable(previewId: string): Promise<unknown>
  previewEnable(bundleId: string): Preview
  executeEnable(previewId: string): Promise<unknown>
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function localRequest(req: IncomingMessage, port: number, mutation: boolean): boolean {
  const remote = req.socket.remoteAddress ?? ''
  if (remote !== '::1' && !remote.startsWith('127.') && !remote.startsWith('::ffff:127.')) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let authority: URL
  try { authority = new URL(`http://${host}`) } catch { return false }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname) || Number(authority.port) !== port
    || authority.username !== '' || authority.password !== '' || authority.pathname !== '/'
    || authority.search !== '' || authority.hash !== '') return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  if (!mutation) return true
  const origin = req.headers.origin
  if (typeof origin !== 'string') return false
  let source: URL
  try { source = new URL(origin) } catch { return false }
  return source.protocol === 'http:' && source.host === authority.host && source.pathname === '/'
    && source.search === '' && source.hash === ''
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += bytes.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('request-too-large')
    chunks.push(bytes)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-request')
  return parsed as Record<string, unknown>
}

function exactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(input).length === fields.length && fields.every(field => Object.hasOwn(input, field))
}

/** A narrow same-origin bridge for Desktop-shipped feature bundles. */
export function registerPluginManagementRoutes(ctx: Context, plugins: DesktopPlugins): () => void {
  const port = ctx.webServer.port
  const previews = new Map<string, { action: 'enable' | 'disable'; bundleId: string; packageName: string; expiresAt: number }>()
  const disposeList = ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/bundles`, handler: (req, res) => {
    if (req.method !== 'GET' || !localRequest(req, port, false)) {
      sendJson(res, 405, { error: 'local GET required' })
      return
    }
    try {
      const bundles = plugins.list().filter(bundle => PRODUCT_BUNDLES.has(bundle.packageName))
      const loadedPackageNames = plugins.loadedPackageNames().filter(name => PRODUCT_BUNDLES.has(name))
      sendJson(res, 200, { bundles, loadedPackageNames })
    } catch {
      sendJson(res, 503, { error: 'plugin inventory unavailable' })
    }
  } })
  const disposePreview = ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/preview`, handler: async (req, res) => {
    if (req.method !== 'POST' || !localRequest(req, port, true)) {
      sendJson(res, 405, { error: 'local POST required' })
      return
    }
    try {
      const input = await body(req)
      if (!exactFields(input, ['action', 'bundleId'])
        || (input.action !== 'enable' && input.action !== 'disable')
        || typeof input.bundleId !== 'string') throw new Error('invalid-request')
      const bundle = plugins.list().find(item => item.bundleId === input.bundleId)
      if (bundle === undefined || !PRODUCT_BUNDLES.has(bundle.packageName)
        || !bundle.mutable || bundle.uninstallable) throw new Error('invalid-target')
      const preview = input.action === 'enable'
        ? plugins.previewEnable(input.bundleId)
        : plugins.previewDisable(input.bundleId)
      const expiresAt = Date.parse(preview.expiresAt)
      if (preview.packageName !== bundle.packageName || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('invalid-preview')
      }
      previews.set(preview.previewId, {
        action: input.action, bundleId: bundle.bundleId, packageName: bundle.packageName,
        expiresAt,
      })
      if (previews.size > 256) previews.delete(previews.keys().next().value!)
      sendJson(res, 200, preview)
    } catch (cause) {
      sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'preview failed' })
    }
  } })
  const disposeExecute = ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/execute`, handler: async (req, res) => {
    if (req.method !== 'POST' || !localRequest(req, port, true)) {
      sendJson(res, 405, { error: 'local POST required' })
      return
    }
    try {
      const input = await body(req)
      if (!exactFields(input, ['action', 'previewId'])
        || (input.action !== 'enable' && input.action !== 'disable')
        || typeof input.previewId !== 'string' || input.previewId.length > 96) throw new Error('invalid-request')
      const issued = previews.get(input.previewId)
      previews.delete(input.previewId)
      const target = plugins.list().find(item => item.bundleId === issued?.bundleId)
      if (issued === undefined || issued.action !== input.action || issued.expiresAt <= Date.now()
        || target?.packageName !== issued.packageName || !PRODUCT_BUNDLES.has(issued.packageName)
        || !target.mutable || target.uninstallable) throw new Error('invalid-preview')
      const result = input.action === 'enable'
        ? await plugins.executeEnable(input.previewId)
        : await plugins.executeDisable(input.previewId)
      sendJson(res, 200, result)
    } catch (cause) {
      sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'change failed' })
    }
  } })
  return () => { previews.clear(); disposeExecute(); disposePreview(); disposeList() }
}
