/**
 * Run-scoped OpenAI image bridge for local canvas skills.
 *
 * A local skill may understand only an OpenAI `base_url` + `api_key`.  Giving
 * it the CQAI OAuth grant would violate the account boundary, so the Host
 * issues a high-entropy bearer value that names one in-memory run grant.  The
 * bridge accepts only image generation/editing, pins the exact selected model,
 * forwards through `dsnAccount.fetchAi`, and revokes the grant when the run
 * ends, is cancelled, or expires.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

export const SKILL_IMAGE_BRIDGE_PREFIX = '/api/dsh-imagegen/skill-openai'
const DEFAULT_TTL_MS = 30 * 60_000
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 96 * 1024 * 1024

type ImagePath = '/v1/images/generations' | '/v1/images/edits'

export interface SkillImageBridgeGrant {
  /** OpenAI-compatible URL ending in `/v1`. */
  baseUrl: string
  /** Run-scoped bearer value; this is never a CQAI OAuth token or Relay key. */
  apiKey: string
  model: string
  expiresAt: number
  /** Idempotently revoke the run grant and abort an in-flight request. */
  revoke(): void
}

export interface SkillImageBridgeOptions {
  /** Narrow account-service request seam; it injects the real OAuth token. */
  fetchAi(path: ImagePath, init: RequestInit, signal?: AbortSignal): Promise<Response>
  ttlMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  now?: () => number
  token?: () => string
}

interface ActiveGrant {
  model: string
  expiresAt: number
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  externalSignal?: AbortSignal
  externalAbort?: () => void
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization
  if (typeof value !== 'string') return undefined
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(value.trim())
  return match?.[1]
}

function loopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.')
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function requestBody(req: IncomingMessage, cap: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += part.byteLength
    if (size > cap) throw new RangeError('request body is too large')
    parts.push(part)
  }
  return Buffer.concat(parts)
}

/** Read a Fetch response without allowing arrayBuffer() to allocate an
 * unbounded CQAI payload first. */
async function responseBody(response: Response, cap: number): Promise<Buffer> {
  const lengthValue = response.headers.get('content-length')
  if (lengthValue !== null && /^\d+$/.test(lengthValue.trim()) && Number(lengthValue) > cap) {
    await response.body?.cancel().catch(() => undefined)
    throw new RangeError('response body is too large')
  }
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const parts: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const entry = await reader.read()
      if (entry.done) break
      if (size + entry.value.byteLength > cap) {
        await reader.cancel().catch(() => undefined)
        throw new RangeError('response body is too large')
      }
      parts.push(Buffer.from(entry.value))
      size += entry.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(parts, size)
}

function imagePath(urlValue: string | undefined): ImagePath | undefined {
  const pathname = new URL(urlValue ?? '/', 'http://127.0.0.1').pathname
  const suffix = pathname.startsWith(SKILL_IMAGE_BRIDGE_PREFIX)
    ? pathname.slice(SKILL_IMAGE_BRIDGE_PREFIX.length)
    : ''
  return suffix === '/v1/images/generations' || suffix === '/v1/images/edits' ? suffix : undefined
}

async function requestedModel(path: ImagePath, contentType: string, body: Buffer): Promise<string> {
  if (/^application\/json(?:;|$)/i.test(contentType)) {
    let value: unknown
    try { value = JSON.parse(body.toString('utf8')) } catch { throw new TypeError('request JSON is invalid') }
    const model = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).model
      : undefined
    if (typeof model !== 'string' || model.trim() === '') throw new TypeError('request model is required')
    return model.trim()
  }
  if (path === '/v1/images/edits' && /^multipart\/form-data(?:;|$)/i.test(contentType)) {
    let form: FormData
    try {
      form = await new Request('http://127.0.0.1/', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: body as unknown as BodyInit,
      }).formData()
    } catch {
      throw new TypeError('request multipart body is invalid')
    }
    const model = form.get('model')
    if (typeof model !== 'string' || model.trim() === '') throw new TypeError('request model is required')
    return model.trim()
  }
  throw new TypeError(path === '/v1/images/edits'
    ? 'image edits require application/json or multipart/form-data'
    : 'image generations require application/json')
}

/** One Host route plus its run-grant registry. */
export class SkillImageBridge {
  private readonly grants = new Map<string, ActiveGrant>()
  private readonly ttlMs: number
  private readonly maxRequestBytes: number
  private readonly maxResponseBytes: number
  private readonly now: () => number
  private readonly makeToken: () => string

  constructor(private readonly options: SkillImageBridgeOptions) {
    this.ttlMs = Math.max(1_000, options.ttlMs ?? DEFAULT_TTL_MS)
    this.maxRequestBytes = Math.max(1_024, options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES)
    this.maxResponseBytes = Math.max(1_024, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
    this.now = options.now ?? Date.now
    this.makeToken = options.token ?? (() => randomBytes(32).toString('base64url'))
  }

  /** Register this route with `ctx.webServer`; it owns only its prefix. */
  route(): WebRoute {
    return { kind: 'prefix', path: SKILL_IMAGE_BRIDGE_PREFIX, handler: (req, res) => this.handle(req, res) }
  }

  /**
   * Create one run-bound credential.  `origin` must be the Host loopback
   * origin (`http://127.0.0.1:<webServer.port>`), never a public URL.
   */
  issue(options: { origin: string; model: string; signal?: AbortSignal; ttlMs?: number }): SkillImageBridgeGrant {
    const origin = new URL(options.origin)
    if (origin.protocol !== 'http:' || (origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost' && origin.hostname !== '[::1]')) {
      throw new TypeError('skill image bridge origin must be loopback HTTP')
    }
    const model = options.model.trim()
    if (model === '') throw new TypeError('skill image bridge requires one selected image model')
    let apiKey = this.makeToken()
    if (!/^[A-Za-z0-9_-]{32,}$/.test(apiKey)) throw new TypeError('skill image bridge token source returned an unsafe token')
    let hash = tokenHash(apiKey)
    while (this.grants.has(hash)) {
      apiKey = this.makeToken()
      if (!/^[A-Za-z0-9_-]{32,}$/.test(apiKey)) throw new TypeError('skill image bridge token source returned an unsafe token')
      hash = tokenHash(apiKey)
    }
    const ttlMs = Math.max(1_000, options.ttlMs ?? this.ttlMs)
    const grant: ActiveGrant = {
      model,
      expiresAt: this.now() + ttlMs,
      controller: new AbortController(),
      ...options.signal === undefined ? {} : { externalSignal: options.signal },
    }
    const revoke = (): void => { this.revoke(hash) }
    grant.timer = setTimeout(revoke, ttlMs)
    grant.timer.unref?.()
    this.grants.set(hash, grant)
    if (options.signal !== undefined) {
      grant.externalAbort = revoke
      if (options.signal.aborted) revoke()
      else options.signal.addEventListener('abort', revoke, { once: true })
    }
    return {
      baseUrl: `${origin.origin}${SKILL_IMAGE_BRIDGE_PREFIX}/v1`,
      apiKey,
      model,
      expiresAt: grant.expiresAt,
      revoke,
    }
  }

  /** Revoke every surviving run on plugin unload. */
  dispose(): void {
    for (const hash of [...this.grants.keys()]) this.revoke(hash)
  }

  private revoke(hash: string): void {
    const grant = this.grants.get(hash)
    if (grant === undefined) return
    this.grants.delete(hash)
    if (grant.timer !== undefined) clearTimeout(grant.timer)
    if (grant.externalSignal !== undefined && grant.externalAbort !== undefined) {
      grant.externalSignal.removeEventListener('abort', grant.externalAbort)
    }
    grant.controller.abort(new Error('skill image bridge grant revoked'))
  }

  private active(token: string): ActiveGrant | undefined {
    const hash = tokenHash(token)
    const grant = this.grants.get(hash)
    if (grant === undefined) return undefined
    if (grant.expiresAt <= this.now()) {
      this.revoke(hash)
      return undefined
    }
    return grant
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!loopback(req)) { writeJson(res, 403, { error: { message: 'loopback access required', type: 'forbidden' } }); return }
    const path = imagePath(req.url)
    if (path === undefined) { writeJson(res, 404, { error: { message: 'image endpoint not found', type: 'not_found' } }); return }
    if (req.method !== 'POST') { writeJson(res, 405, { error: { message: 'method not allowed', type: 'method_not_allowed' } }); return }
    const apiKey = bearer(req)
    const grant = apiKey === undefined ? undefined : this.active(apiKey)
    if (grant === undefined) { writeJson(res, 401, { error: { message: 'run credential is invalid or expired', type: 'invalid_api_key' } }); return }

    const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : ''
    let body: Buffer
    let model: string
    try {
      body = await requestBody(req, this.maxRequestBytes)
      model = await requestedModel(path, contentType, body)
    } catch (error) {
      writeJson(res, error instanceof RangeError ? 413 : 400, {
        error: { message: error instanceof Error ? error.message : String(error), type: 'invalid_request_error' },
      })
      return
    }
    if (model !== grant.model) {
      writeJson(res, 403, { error: { message: `run credential only allows model ${grant.model}`, type: 'model_forbidden' } })
      return
    }

    const requestController = new AbortController()
    const abort = (): void => requestController.abort(new Error('skill image request aborted'))
    grant.controller.signal.addEventListener('abort', abort, { once: true })
    req.once('aborted', abort)
    try {
      const upstream = await this.options.fetchAi(path, {
        method: 'POST',
        headers: {
          'content-type': contentType,
          accept: 'application/json',
        },
        body: body as unknown as BodyInit,
      }, requestController.signal)
      const response = await responseBody(upstream, this.maxResponseBytes)
      const upstreamType = upstream.headers.get('content-type') ?? ''
      const responseType = /^(application\/json|text\/json)(?:;|$)/i.test(upstreamType)
        ? upstreamType
        : 'application/octet-stream'
      res.writeHead(upstream.status, {
        'content-type': responseType,
        'content-length': response.byteLength,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(response)
    } catch (error) {
      if (!res.headersSent) {
        // Do not reflect an account-client exception: an implementation error
        // may carry request headers, while the local skill only needs a stable
        // retryable failure.
        writeJson(res, 502, {
          error: {
            message: error instanceof RangeError ? 'CQAI image response is too large' : 'CQAI image request failed',
            type: 'upstream_error',
          },
        })
      } else {
        res.end()
      }
    } finally {
      grant.controller.signal.removeEventListener('abort', abort)
      req.off('aborted', abort)
    }
  }
}
