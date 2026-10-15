import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_UPDATE_ROUTE_ENDPOINT } from '../src/desktop-update-source.ts'
import { requestDesktopUpdateRoute } from '../src/electron-update-route.ts'

const native = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('electron', () => ({ net: { request: native.request } }))

const endpoint = `${DESKTOP_UPDATE_ROUTE_ENDPOINT}?platform=windows`

function client() {
  const events = new EventEmitter()
  return Object.assign(events, {
    setHeader: vi.fn(),
    end: vi.fn(),
    followRedirect: vi.fn(),
    abort: vi.fn(() => {
      events.emit('error', new Error('Redirect was cancelled'))
      events.emit('close')
    }),
  })
}

beforeEach(() => { native.request.mockReset() })

describe('native Electron update routing transport', () => {
  it('captures redirect headers and immediately aborts without inheriting caller metadata', async () => {
    const request = client()
    native.request.mockReturnValue(request)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = requestDesktopUpdateRoute(endpoint, {
      signal: controller.signal,
      headers: { 'X-DSH-Desktop-Installation-ID': 'private-id', 'X-Real-IP': '223.5.5.5' },
    })

    request.emit('redirect', 302, 'GET', 'https://gitcode.com/installer.exe', {
      'x-download-source': ['gitcode'], 'cache-control': ['private, no-store'],
    })
    expect(request.abort).toHaveBeenCalledOnce()
    const response = await pending

    expect(native.request).toHaveBeenCalledExactlyOnceWith({
      url: endpoint, method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'manual',
    })
    expect(request.setHeader).toHaveBeenCalledExactlyOnceWith('Accept', 'application/json')
    expect(request.end).toHaveBeenCalledOnce()
    expect(request.followRedirect).not.toHaveBeenCalled()
    expect(response.status).toBe(302)
    expect(response.headers.get('X-Download-Source')).toBe('gitcode')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.body).toBeNull()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
    expect(request.abort).toHaveBeenCalledOnce()
  })

  it('preserves separate header values so conflicting routing decisions remain invalid', async () => {
    const request = client()
    native.request.mockReturnValue(request)
    const pending = requestDesktopUpdateRoute(`${DESKTOP_UPDATE_ROUTE_ENDPOINT}?platform=macos`, {})

    request.emit('redirect', 302, 'GET', 'https://example.test/installer', {
      'x-download-source': ['gitcode', 'github'],
    })

    expect((await pending).headers.get('X-Download-Source')).toBe('gitcode, github')
    expect(request.followRedirect).not.toHaveBeenCalled()
  })

  it('returns nonredirect status and headers without reading an installer body', async () => {
    const request = client()
    native.request.mockReturnValue(request)
    const pending = requestDesktopUpdateRoute(endpoint, {})
    const responseEvents = new EventEmitter()
    request.emit('response', Object.assign(responseEvents, {
      statusCode: 200, headers: { 'x-download-source': 'gitcode', 'content-length': '999999999' },
    }))

    const response = await pending
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(responseEvents.listenerCount('data')).toBe(0)
    expect(request.abort).toHaveBeenCalledOnce()
  })

  it('waits for HTTP headers when Electron closes its finished Writable first', async () => {
    const request = client()
    native.request.mockReturnValue(request)
    const pending = requestDesktopUpdateRoute(endpoint, {})

    request.emit('finish')
    request.emit('close')
    expect(request.abort).not.toHaveBeenCalled()
    request.emit('redirect', 302, 'GET', 'https://gitcode.com/installer.exe', { 'x-download-source': ['gitcode'] })

    expect((await pending).headers.get('X-Download-Source')).toBe('gitcode')
    expect(request.abort).toHaveBeenCalledOnce()
  })

  it.each(['error', 'close'])('rejects an early native %s and cleans up cancellation', async event => {
    const request = client()
    native.request.mockReturnValue(request)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = requestDesktopUpdateRoute(endpoint, { signal: controller.signal })

    request.emit(event, new Error('offline'))

    await expect(pending).rejects.toThrow(event === 'error' ? 'offline' : 'closed before headers')
    expect(request.abort).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('rejects cancellation before creating or during a native request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled before request'))
    await expect(requestDesktopUpdateRoute(endpoint, { signal: controller.signal })).rejects.toThrow('cancelled before request')
    expect(native.request).not.toHaveBeenCalled()

    const request = client()
    native.request.mockReturnValue(request)
    const active = new AbortController()
    const remove = vi.spyOn(active.signal, 'removeEventListener')
    const pending = requestDesktopUpdateRoute(endpoint, { signal: active.signal })
    active.abort(new Error('cancelled in flight'))

    await expect(pending).rejects.toThrow('cancelled in flight')
    expect(request.abort).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('rejects invalid response headers without leaving the request open', async () => {
    const request = client()
    native.request.mockReturnValue(request)
    const pending = requestDesktopUpdateRoute(endpoint, {})
    request.emit('redirect', 302, 'GET', 'https://example.test/installer', { 'invalid\nname': ['value'] })

    await expect(pending).rejects.toThrow()
    expect(request.abort).toHaveBeenCalledOnce()
  })

  it.each([
    'https://example.test/api/ebao-studio/download?platform=windows',
    `${endpoint}&source=gitcode`, `${endpoint}#fragment`, DESKTOP_UPDATE_ROUTE_ENDPOINT,
  ])('rejects a noncanonical routing URL %s before network work', async url => {
    await expect(requestDesktopUpdateRoute(url, {})).rejects.toThrow('invalid update routing endpoint')
    expect(native.request).not.toHaveBeenCalled()
  })
})
