/** Read Portal routing headers without following its installer redirect. */

import { net } from 'electron'
import { DESKTOP_UPDATE_ROUTE_ENDPOINT } from './desktop-update-source.ts'
import type { UpdateRequest } from './update-checker.ts'

function responseHeaders(input: Readonly<Record<string, string | readonly string[]>>): Headers {
  const headers = new Headers()
  for (const [name, values] of Object.entries(input)) {
    for (const value of typeof values === 'string' ? [values] : values) headers.append(name, value)
  }
  return headers
}

/**
 * Electron's net.fetch rejects manual redirects before exposing their headers.
 * ClientRequest exposes them in its redirect event and retains system proxy use.
 */
export const requestDesktopUpdateRoute: UpdateRequest = async (url, init) => {
  if (url !== `${DESKTOP_UPDATE_ROUTE_ENDPOINT}?platform=windows`
    && url !== `${DESKTOP_UPDATE_ROUTE_ENDPOINT}?platform=macos`) {
    throw new Error('dsh-plugin-desktop: invalid update routing endpoint')
  }
  const signal = init.signal
  signal?.throwIfAborted()
  return await new Promise<Response>((resolve, reject) => {
    const request = net.request({ url, method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'manual' })
    let settled = false
    let bodyFinished = false
    const finish = (response: Response | undefined, error?: unknown): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (response === undefined) reject(error)
      else resolve(response)
      // Settle first: abort can synchronously emit error/close events.
      request.abort()
    }
    const abort = (): void => { finish(undefined, signal?.reason) }
    const headersReceived = (status: number, headers: Readonly<Record<string, string | readonly string[]>>): void => {
      try { finish(new Response(null, { status, headers: responseHeaders(headers) })) }
      catch (error) { finish(undefined, error) }
    }
    request.on('redirect', (status, _method, _redirectUrl, headers) => { headersReceived(status, headers) })
    request.on('response', response => { headersReceived(response.statusCode, response.headers) })
    request.on('error', error => { finish(undefined, error) })
    request.on('finish', () => { bodyFinished = true })
    request.on('close', () => {
      // Electron 44 can close its Writable after finish, before HTTP headers.
      // Keep awaiting the native response or caller-owned deadline in that case.
      if (!bodyFinished) finish(undefined, new Error('dsh-plugin-desktop: update routing closed before headers'))
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    try {
      // Probe requests never inherit installation IDs, credentials, or IP overrides.
      request.setHeader('Accept', 'application/json')
      request.end()
    } catch (error) { finish(undefined, error) }
  })
}
