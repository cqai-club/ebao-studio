import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const LOOPBACK_HOST = '127.0.0.1'

export interface LoopbackCallbackServer {
  readonly redirectUri: string
  close(): Promise<void>
}

export type LoopbackCallbackHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>

/** Listen on an OS-assigned loopback port for one native-app OAuth callback. */
export async function openLoopbackCallbackServer(
  path: string,
  handler: LoopbackCallbackHandler,
  signal?: AbortSignal,
): Promise<LoopbackCallbackServer> {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new TypeError('OAuth callback path must be an absolute pathname')
  }

  let expectedHost = ''
  const server = createServer((request, response) => {
    if (!isExpectedRequest(request, expectedHost, path)) {
      rejectRequest(response, request.headers.host === expectedHost ? 404 : 403)
      return
    }
    void Promise.resolve(handler(request, response)).catch(() => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      rejectRequest(response, 500)
    })
  })
  server.maxHeadersCount = 32
  server.keepAliveTimeout = 1_000
  server.requestTimeout = 10_000

  await listen(server, signal)
  const address = server.address() as AddressInfo | null
  if (address === null || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    await closeServer(server)
    throw new Error('OAuth callback server did not bind to IPv4 loopback')
  }
  expectedHost = `${LOOPBACK_HOST}:${String(address.port)}`

  let closeTask: Promise<void> | undefined
  return {
    redirectUri: `http://${expectedHost}${path}`,
    close() {
      closeTask ??= closeServer(server)
      return closeTask
    },
  }
}

function listen(server: Server, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(signal.reason ?? new Error('aborted'))
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('error', failed)
      signal?.removeEventListener('abort', aborted)
    }
    const failed = (cause: Error) => {
      cleanup()
      reject(cause)
    }
    const aborted = () => {
      cleanup()
      server.close()
      reject(signal?.reason ?? new Error('aborted'))
    }
    server.once('error', failed)
    signal?.addEventListener('abort', aborted, { once: true })
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      cleanup()
      resolve()
    })
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((cause) => {
      if (cause === undefined) resolve()
      else reject(cause)
    })
  })
}

function isExpectedRequest(request: IncomingMessage, expectedHost: string, path: string): boolean {
  const remoteAddress = request.socket.remoteAddress
  if (remoteAddress !== LOOPBACK_HOST && remoteAddress !== `::ffff:${LOOPBACK_HOST}`) return false
  if (request.headers.host !== expectedHost) return false
  try {
    const base = `http://${expectedHost}`
    const target = new URL(request.url ?? '/', base)
    return target.origin === base && target.pathname === path
  } catch {
    return false
  }
}

function rejectRequest(response: ServerResponse, status: 403 | 404 | 500): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(status === 404 ? 'not found' : status === 403 ? 'forbidden' : 'internal error')
}
