import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_VERSION_ENDPOINT, type UpdateRequest } from '../src/update-checker.ts'
import {
  createDesktopUpdateRouting,
  DESKTOP_UPDATE_ROUTE_CACHE_MS,
  DESKTOP_UPDATE_ROUTE_ENDPOINT,
  GITCODE_DESKTOP_VERSION_ENDPOINT,
} from '../src/desktop-update-source.ts'

function route(source: string, status = 302): Response {
  return new Response(null, { status, headers: {
    'X-Download-Source': source, Location: 'https://example.test/installer.exe',
  } })
}
afterEach(() => { vi.restoreAllMocks() })

describe('visitor-IP Desktop update routing', () => {
  it.each(['win32', 'darwin'])('uses only the explicit mainland route on %s without following its installer redirect', async platform => {
    const manifest = Response.json({ channel: 'stable', version: '2.1.0' })
    const request = vi.fn<UpdateRequest>().mockResolvedValueOnce(route('gitcode')).mockResolvedValueOnce(manifest)
    const routing = createDesktopUpdateRouting(request, platform)
    const init: RequestInit = { headers: { 'X-DSH-Desktop-Installation-Id': 'private-id' }, redirect: 'error' }
    await expect(routing.request(DESKTOP_VERSION_ENDPOINT, init)).resolves.toBe(manifest)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenNthCalledWith(1,
      `${DESKTOP_UPDATE_ROUTE_ENDPOINT}?platform=${platform === 'darwin' ? 'macos' : 'windows'}`,
      expect.objectContaining({ method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit' }),
    )
    const probe = request.mock.calls[0]![1]
    expect(Object.fromEntries(new Headers(probe.headers))).toEqual({ accept: 'application/json' })
    expect(probe.body).toBeUndefined()
    expect(probe.signal).toBeInstanceOf(AbortSignal)
    expect(request).toHaveBeenNthCalledWith(2, GITCODE_DESKTOP_VERSION_ENDPOINT, init)
    await expect(routing.source()).resolves.toBe('gitcode')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('uses the native probe transport separately from the version-request transport', async () => {
    const request = vi.fn<UpdateRequest>().mockResolvedValue(Response.json({ version: '2.1.0' }))
    const probe = vi.fn<UpdateRequest>().mockResolvedValue(route('gitcode'))
    const routing = createDesktopUpdateRouting(request, 'win32', probe)
    await routing.request(DESKTOP_VERSION_ENDPOINT, {})
    expect(probe).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledExactlyOnceWith(GITCODE_DESKTOP_VERSION_ENDPOINT, {})
  })
  it('keeps GitHub for the Portal global or unknown-country decision', async () => {
    const manifest = Response.json({ version: '2.1.0' })
    const request = vi.fn<UpdateRequest>().mockResolvedValueOnce(route('github')).mockResolvedValueOnce(manifest)
    const routing = createDesktopUpdateRouting(request, 'win32')
    await expect(routing.request(DESKTOP_VERSION_ENDPOINT, {})).resolves.toBe(manifest)
    expect(request).toHaveBeenLastCalledWith(DESKTOP_VERSION_ENDPOINT, {})
    await expect(routing.source()).resolves.toBe('github')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each(['', 'CN', 'GitCode', 'other'])('keeps GitHub for invalid header %j and retries next time', async selected => {
    const request = vi.fn<UpdateRequest>().mockResolvedValueOnce(route(selected)).mockResolvedValueOnce(route('gitcode'))
    const routing = createDesktopUpdateRouting(request, 'win32')
    await expect(routing.source()).resolves.toBe('github')
    await expect(routing.source()).resolves.toBe('gitcode')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it.each([200, 301, 307, 404, 500])('ignores a mainland header on HTTP %s', async status => {
    const request = vi.fn<UpdateRequest>().mockResolvedValue(route('gitcode', status))
    await expect(createDesktopUpdateRouting(request, 'win32').source()).resolves.toBe('github')
  })
  it.each(['network', 'timeout'])('defaults to GitHub on %s failure without caching it', async failure => {
    const request = vi.fn<UpdateRequest>().mockRejectedValueOnce(new Error(failure)).mockResolvedValueOnce(route('gitcode'))
    const routing = createDesktopUpdateRouting(request, 'win32')
    await expect(routing.source()).resolves.toBe('github')
    await expect(routing.source()).resolves.toBe('gitcode')
  })
  it('refreshes after five minutes and switches back to GitHub when the IP decision changes', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const request = vi.fn<UpdateRequest>().mockResolvedValueOnce(route('gitcode')).mockResolvedValueOnce(route('github'))
    const routing = createDesktopUpdateRouting(request, 'win32')
    await expect(routing.source()).resolves.toBe('gitcode')
    now += DESKTOP_UPDATE_ROUTE_CACHE_MS - 1
    await expect(routing.source()).resolves.toBe('gitcode')
    expect(request).toHaveBeenCalledOnce()
    now += 1
    await expect(routing.source()).resolves.toBe('github')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('passes Next and other explicit version endpoints through', async () => {
    const response = Response.json({ version: '2.1.0-next.1' })
    const request = vi.fn<UpdateRequest>().mockResolvedValue(response)
    const endpoint = 'https://www.dshdesktop.cn/api/desktop/version'
    await expect(createDesktopUpdateRouting(request, 'win32').request(endpoint, {})).resolves.toBe(response)
    expect(request).toHaveBeenCalledExactlyOnceWith(endpoint, {})
  })
  it('cancels the probe body without requesting the installer URL', async () => {
    const response = route('gitcode')
    const cancel = vi.fn(async () => {})
    Object.defineProperty(response, 'body', { value: { cancel } })
    const request = vi.fn<UpdateRequest>().mockResolvedValue(response)
    await expect(createDesktopUpdateRouting(request, 'win32').source()).resolves.toBe('gitcode')
    expect(cancel).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
  })
  it('honors cancellation before probing or using a cached decision', async () => {
    const request = vi.fn<UpdateRequest>().mockResolvedValue(route('gitcode'))
    const routing = createDesktopUpdateRouting(request, 'win32')
    const controller = new AbortController()
    controller.abort()
    await expect(routing.source(controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    await routing.source()
    await expect(routing.source(controller.signal)).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
  })
  it('preserves cancellation during probing instead of treating it as an unknown IP', async () => {
    const controller = new AbortController()
    const request = vi.fn<UpdateRequest>().mockImplementation(async () => {
      controller.abort()
      throw new Error('cancelled')
    })
    await expect(createDesktopUpdateRouting(request, 'win32').source(controller.signal)).rejects.toThrow()
  })
})
