import type { IncomingHttpHeaders } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  downloadProviderImage,
  isPublicAddress,
  type ResolvedAddress,
  type SecureDownloadResponse,
  type SecureImageDownloadInternals,
} from '../src/secure-image-download.ts'

const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }]
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function response(options: {
  status?: number
  headers?: IncomingHttpHeaders
  chunks?: Uint8Array[]
  cancelled?: () => void
} = {}): SecureDownloadResponse {
  const chunks = options.chunks ?? []
  return {
    statusCode: options.status ?? 200,
    headers: options.headers ?? { 'content-type': 'image/png' },
    body: (async function* () { yield* chunks })(),
    cancel: options.cancelled ?? (() => undefined),
  }
}

function internals(request: SecureImageDownloadInternals['request']): SecureImageDownloadInternals {
  return { resolve: async () => PUBLIC, request }
}

const base = {
  apiUrl: 'https://provider.example/v1',
  apiKey: 'secret',
}

describe('secure provider image downloads', () => {
  it('rejects loopback and link-local literal addresses before opening a socket', async () => {
    const request = vi.fn<SecureImageDownloadInternals['request']>()
    const deps = internals(request)
    await expect(downloadProviderImage({ ...base, url: 'http://127.0.0.1/private.png' }, deps))
      .rejects.toThrow('non-public address')
    await expect(downloadProviderImage({ ...base, url: 'http://169.254.169.254/latest/meta-data' }, deps))
      .rejects.toThrow('non-public address')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a hostname when DNS returns any private address', async () => {
    const request = vi.fn<SecureImageDownloadInternals['request']>()
    const deps: SecureImageDownloadInternals = {
      resolve: async () => [PUBLIC[0]!, { address: '10.0.0.7', family: 4 }],
      request,
    }
    await expect(downloadProviderImage({ ...base, url: 'https://mixed-dns.example/image' }, deps))
      .rejects.toThrow('non-public address')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a public response that redirects to a private address', async () => {
    const request = vi.fn<SecureImageDownloadInternals['request']>()
      .mockResolvedValueOnce(response({ status: 302, headers: { location: 'http://127.0.0.1/secret' } }))
    await expect(downloadProviderImage({ ...base, url: 'https://public.example/image' }, internals(request)))
      .rejects.toThrow('non-public address')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized stream before retaining the overflowing chunk', async () => {
    let cancelled = false
    const request = vi.fn<SecureImageDownloadInternals['request']>().mockResolvedValue(response({
      chunks: [PNG, new Uint8Array(8)],
      cancelled: () => { cancelled = true },
    }))
    await expect(downloadProviderImage({ ...base, url: 'https://public.example/image', maxBytes: PNG.byteLength }, internals(request)))
      .rejects.toThrow('size limit')
    expect(cancelled).toBe(true)
  })

  it('requires supported image MIME and encoded magic', async () => {
    const html = new TextEncoder().encode('<html>not an image</html>')
    const request = vi.fn<SecureImageDownloadInternals['request']>().mockResolvedValue(response({ chunks: [html] }))
    await expect(downloadProviderImage({ ...base, url: 'https://public.example/image' }, internals(request)))
      .rejects.toThrow('does not contain a supported image')

    const textRequest = vi.fn<SecureImageDownloadInternals['request']>().mockResolvedValue(response({
      headers: { 'content-type': 'text/html' }, chunks: [PNG],
    }))
    await expect(downloadProviderImage({ ...base, url: 'https://public.example/image' }, internals(textRequest)))
      .rejects.toThrow('not a supported image MIME type')
  })

  it('accepts a public PNG and forwards credentials only on the API origin', async () => {
    const request = vi.fn<SecureImageDownloadInternals['request']>().mockResolvedValue(response({ chunks: [PNG] }))
    const result = await downloadProviderImage({ ...base, url: 'https://provider.example/result.png' }, internals(request))
    expect(result.mime).toBe('image/png')
    expect(result.buffer).toEqual(Buffer.from(PNG))
    expect(request.mock.calls[0]?.[2]).toMatchObject({ authorization: 'Bearer secret' })
  })

  it('recognizes representative IPv4 and IPv6 special ranges', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('169.254.169.254')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })
})
