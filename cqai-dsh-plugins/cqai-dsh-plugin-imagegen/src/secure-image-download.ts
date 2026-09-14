/**
 * SSRF-safe downloader for image URLs returned by an untrusted provider.
 *
 * Every URL (including every redirect target) is parsed and resolved before a
 * connection is opened.  The connection is then pinned to one of those exact
 * public addresses, closing the DNS-rebinding gap between validation and the
 * socket connect.  Bodies are capped while streaming and accepted only when
 * their declared type and encoded magic describe one of our raster formats.
 */

import { lookup } from 'node:dns/promises'
import { request as requestHttp, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as requestHttps } from 'node:https'
import { isIP } from 'node:net'
import { detectImageMime, type SupportedImageMime } from './image-format.ts'

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SUPPORTED_CONTENT_TYPES = new Set<SupportedImageMime>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export interface SecureDownloadResponse {
  statusCode: number
  headers: IncomingHttpHeaders
  body: AsyncIterable<Uint8Array | string>
  /** Stop reading and close the upstream socket. */
  cancel(): void
}

/** Internal transport seam used by focused tests. Generation never exposes it. */
export interface SecureImageDownloadInternals {
  resolve(hostname: string): Promise<ResolvedAddress[]>
  request(
    url: URL,
    addresses: readonly ResolvedAddress[],
    headers: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<SecureDownloadResponse>
}

export interface SecureImageDownloadOptions {
  url: string
  apiUrl: string
  apiKey: string
  signal?: AbortSignal
  maxBytes?: number
  maxRedirects?: number
}

export interface SecureImageDownloadResult {
  buffer: Buffer
  mime: SupportedImageMime
}

function ipv4Bytes(value: string): readonly number[] | undefined {
  const pieces = value.split('.')
  if (pieces.length !== 4) return undefined
  const bytes = pieces.map(piece => /^\d{1,3}$/.test(piece) ? Number(piece) : Number.NaN)
  if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return undefined
  return bytes
}

function parseIpv6(value: string): Uint8Array | undefined {
  let input = value.toLowerCase()
  const zone = input.indexOf('%')
  if (zone !== -1) input = input.slice(0, zone)

  let ipv4Tail: readonly number[] | undefined
  const lastColon = input.lastIndexOf(':')
  const possibleIpv4 = lastColon === -1 ? input : input.slice(lastColon + 1)
  if (possibleIpv4.includes('.')) {
    ipv4Tail = ipv4Bytes(possibleIpv4)
    if (ipv4Tail === undefined) return undefined
    input = `${input.slice(0, lastColon)}:${((ipv4Tail[0]! << 8) | ipv4Tail[1]!).toString(16)}:${((ipv4Tail[2]! << 8) | ipv4Tail[3]!).toString(16)}`
  }

  const halves = input.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] === '' ? [] : halves[0]!.split(':')
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1]!.split(':')
  const compressed = halves.length === 2
  if ((!compressed && left.length !== 8) || (compressed && left.length + right.length >= 8)) return undefined
  const fill = compressed ? 8 - left.length - right.length : 0
  const words = [...left, ...Array.from({ length: fill }, () => '0'), ...right]
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return undefined
  const bytes = new Uint8Array(16)
  words.forEach((word, index) => {
    const number = Number.parseInt(word, 16)
    bytes[index * 2] = number >>> 8
    bytes[index * 2 + 1] = number & 0xff
  })
  return bytes
}

/** Accept only globally routable unicast addresses. */
export function isPublicAddress(value: string): boolean {
  const family = isIP(value)
  if (family === 4) {
    const bytes = ipv4Bytes(value)
    if (bytes === undefined) return false
    const [a, b, c] = bytes
    if (a === 0 || a === 10 || a === 127 || a! >= 224) return false
    if (a === 100 && b! >= 64 && b! <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b! >= 16 && b! <= 31) return false
    if (a === 192 && b === 0 && c === 0) return false
    if (a === 192 && b === 0 && c === 2) return false
    if (a === 192 && b === 88 && c === 99) return false
    if (a === 192 && b === 168) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if (a === 198 && b === 51 && c === 100) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (family !== 6) return false
  const bytes = parseIpv6(value)
  if (bytes === undefined) return false
  // Only global-unicast 2000::/3. This excludes loopback, unspecified,
  // link-local, unique-local, multicast, IPv4-mapped, and NAT64 addresses.
  if ((bytes[0]! & 0xe0) !== 0x20) return false
  // Documentation, Teredo, and 6to4 addresses are not safe direct origins.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false
  return true
}

function normalizedHostname(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
}

async function resolvePublic(url: URL, resolve: SecureImageDownloadInternals['resolve']): Promise<ResolvedAddress[]> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('generated image URL must use HTTP or HTTPS')
  }
  if (url.username !== '' || url.password !== '') throw new TypeError('generated image URL must not contain credentials')
  const hostname = normalizedHostname(url)
  if (hostname === '') throw new TypeError('generated image URL has no hostname')
  const literalFamily = isIP(hostname)
  const addresses = literalFamily === 0
    ? await resolve(hostname)
    : [{ address: hostname, family: literalFamily as 4 | 6 }]
  if (addresses.length === 0) throw new TypeError('generated image hostname did not resolve')
  if (addresses.some(item => (item.family !== 4 && item.family !== 6) || !isPublicAddress(item.address))) {
    throw new TypeError('generated image URL resolves to a non-public address')
  }
  return addresses
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function declaredMime(headers: IncomingHttpHeaders): string | undefined {
  const value = headerValue(headers, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  return value === '' ? undefined : value
}

function contentLength(headers: IncomingHttpHeaders): number | undefined {
  const value = headerValue(headers, 'content-length')
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

async function readCapped(response: SecureDownloadResponse, maxBytes: number): Promise<Buffer> {
  const declared = contentLength(response.headers)
  if (declared !== undefined && declared > maxBytes) {
    response.cancel()
    throw new RangeError('generated image exceeds the download size limit')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const value of response.body) {
    const length = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
    if (total + length > maxBytes) {
      response.cancel()
      throw new RangeError('generated image exceeds the download size limit')
    }
    const chunk = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)
    chunks.push(chunk)
    total += chunk.byteLength
  }
  return Buffer.concat(chunks, total)
}

function isPresignedUrl(url: URL): boolean {
  const params = new Set(Array.from(url.searchParams.keys(), key => key.toLowerCase()))
  if (params.has('x-goog-signature') || params.has('x-goog-credential')) return true
  if (params.has('x-amz-signature') || params.has('x-amz-credential')) return true
  return params.has('signature') && (
    params.has('expires') || params.has('googleaccessid') || params.has('awsaccesskeyid')
  )
}

function authorization(url: URL, apiUrl: URL, apiKey: string): string | undefined {
  if (apiKey === '' || isPresignedUrl(url) || url.origin !== apiUrl.origin) return undefined
  return `Bearer ${apiKey}`
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  return addresses.map(item => ({ address: item.address, family: item.family as 4 | 6 }))
}

async function defaultRequest(
  url: URL,
  addresses: readonly ResolvedAddress[],
  headers: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<SecureDownloadResponse> {
  const selected = addresses[0]!
  const hostname = normalizedHostname(url)
  const request = url.protocol === 'https:' ? requestHttps : requestHttp
  return await new Promise<SecureDownloadResponse>((resolve, reject) => {
    const outgoing = request({
      protocol: url.protocol,
      hostname: selected.address,
      ...url.port === '' ? {} : { port: url.port },
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, host: url.host },
      ...url.protocol === 'https:' && isIP(hostname) === 0 ? { servername: hostname } : {},
      ...signal === undefined ? {} : { signal },
    }, (incoming: IncomingMessage) => {
      resolve({
        statusCode: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body: incoming,
        cancel: () => { incoming.destroy() },
      })
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

const defaultInternals: SecureImageDownloadInternals = { resolve: defaultResolve, request: defaultRequest }

/** Download and validate one provider-supplied image URL. */
export async function downloadProviderImage(
  options: SecureImageDownloadOptions,
  internals: SecureImageDownloadInternals = defaultInternals,
): Promise<SecureImageDownloadResult> {
  const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES)
  const maxRedirects = Math.max(0, options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)
  let current: URL
  let apiUrl: URL
  try {
    current = new URL(options.url)
    apiUrl = new URL(options.apiUrl)
  } catch {
    throw new TypeError('generated image URL is invalid')
  }

  for (let redirects = 0; ; redirects += 1) {
    const addresses = await resolvePublic(current, internals.resolve)
    const bearer = authorization(current, apiUrl, options.apiKey)
    const response = await internals.request(current, addresses, {
      accept: 'image/png, image/jpeg, image/webp, image/gif',
      ...bearer === undefined ? {} : { authorization: bearer },
    }, options.signal)

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      response.cancel()
      if (redirects >= maxRedirects) throw new TypeError('generated image URL has too many redirects')
      const location = headerValue(response.headers, 'location')
      if (location === undefined || location === '') throw new TypeError('generated image redirect has no location')
      try { current = new URL(location, current) } catch { throw new TypeError('generated image redirect location is invalid') }
      continue
    }
    if (response.statusCode < 200 || response.statusCode > 299) {
      response.cancel()
      throw new TypeError(`generated image download returned HTTP ${response.statusCode}`)
    }

    const declared = declaredMime(response.headers)
    if (declared !== undefined && declared !== 'application/octet-stream' && !SUPPORTED_CONTENT_TYPES.has(declared as SupportedImageMime)) {
      response.cancel()
      throw new TypeError('generated image response is not a supported image MIME type')
    }
    const buffer = await readCapped(response, maxBytes)
    const mime = detectImageMime(buffer)
    if (mime === undefined) throw new TypeError('generated image response does not contain a supported image')
    if (declared !== undefined && declared !== 'application/octet-stream' && declared !== mime) {
      throw new TypeError('generated image MIME type does not match its encoded data')
    }
    return { buffer, mime }
  }
}
