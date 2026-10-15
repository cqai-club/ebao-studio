/** Route eBao updates using the Portal's existing visitor-IP download decision. */

import { DESKTOP_VERSION_ENDPOINT, type UpdateRequest } from './update-checker.ts'

export type DesktopUpdateSource = 'github' | 'gitcode'

export const DESKTOP_UPDATE_ROUTE_ENDPOINT = 'https://cqaiclub.asia/api/ebao-studio/download'
export const GITCODE_DESKTOP_VERSION_ENDPOINT = 'https://api.gitcode.com/api/v5/repos/g-dxw/ebao-studio/raw/release%2Fdesktop-version.json?ref=master'
export const DESKTOP_UPDATE_ROUTE_CACHE_MS = 5 * 60_000
const ROUTE_TIMEOUT_MS = 6_000

export interface DesktopUpdateRouting {
  source(signal?: AbortSignal): Promise<DesktopUpdateSource>
  request: UpdateRequest
}

/** Only the Portal's explicit mainland-CN decision selects GitCode. */
export function createDesktopUpdateRouting(
  request: UpdateRequest,
  platform: string,
  routeRequest: UpdateRequest = request,
): DesktopUpdateRouting {
  let cached: { source: DesktopUpdateSource, expires: number } | undefined
  const routeEndpoint = `${DESKTOP_UPDATE_ROUTE_ENDPOINT}?platform=${platform === 'darwin' ? 'macos' : 'windows'}`
  const source = async (signal?: AbortSignal): Promise<DesktopUpdateSource> => {
    signal?.throwIfAborted()
    if (cached !== undefined && Date.now() < cached.expires) return cached.source
    try {
      const response = await routeRequest(routeEndpoint, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        // No installation UUID, app version, channel, or IP override is sent.
        headers: { Accept: 'application/json' },
        signal: signal === undefined
          ? AbortSignal.timeout(ROUTE_TIMEOUT_MS)
          : AbortSignal.any([signal, AbortSignal.timeout(ROUTE_TIMEOUT_MS)]),
      })
      const selected = response.headers.get('X-Download-Source')
      // Never follow the installer redirect or consume an installer body.
      await response.body?.cancel().catch(() => undefined)
      signal?.throwIfAborted()
      if (response.status === 302 && (selected === 'gitcode' || selected === 'github')) {
        cached = { source: selected, expires: Date.now() + DESKTOP_UPDATE_ROUTE_CACHE_MS }
        return selected
      }
    } catch {
      signal?.throwIfAborted()
    }
    // Unknown region, service failure and timeout keep the original global source.
    return 'github'
  }
  return {
    source,
    request: async (url, init) => {
      if (url !== DESKTOP_VERSION_ENDPOINT) return request(url, init)
      const selected = await source(init.signal ?? undefined)
      return request(selected === 'gitcode' ? GITCODE_DESKTOP_VERSION_ENDPOINT : url, init)
    },
  }
}
