import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition as BaseToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClubMcpClient, type ClubMcpClientUpdate } from '../src/mcp/mcp-client.ts'
import { DEFAULT_CLUB_MCP_URL } from '../src/mcp/protocol.ts'

type ToolDefinition = BaseToolDefinition & { name: string }

const cleanups: Array<() => Promise<void>> = []
const nativeFetch = globalThis.fetch.bind(globalThis)

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function registry() {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        if (tools.has(definition.name)) throw new Error('duplicate registry name')
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      }),
    },
  } as unknown as Context
  return { ctx, tools }
}

type Rpc = { jsonrpc: '2.0'; id?: string | number; method: string; params?: Record<string, unknown> }
const tool = (name: string) => ({ name, description: name, inputSchema: { type: 'object', properties: { id: { type: 'string' } } } })

/** A local HTTP fixture exercises the SDK's real handshake and wire transport. */
async function endpoint() {
  const requests: Array<{ method: string; body?: Rpc; authorization?: string }> = []
  const streams = new Set<ServerResponse>()
  let pages = [[tool('club_get_activity')], [tool('club_my_registrations')]]
  let callStatus = 200
  let callResult: unknown = { content: [{ type: 'text', text: '真实 MCP 工具结果' }], structuredContent: { id: 'activity-44' } }
  let failList = false
  let pauseList: Promise<void> | undefined
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const source = Buffer.concat(chunks).toString()
    const body = source === '' ? undefined : JSON.parse(source) as Rpc
    requests.push({ method: request.method ?? '', body, authorization: request.headers.authorization })
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write(': connected\n\n')
      streams.add(response)
      response.on('close', () => { streams.delete(response) })
      return
    }
    if (request.method === 'DELETE') {
      response.writeHead(200).end()
      return
    }
    const send = (result: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body?.id, result }))
    }
    switch (body?.method) {
      case 'server/discover':
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }))
        break
      case 'initialize':
        send({ protocolVersion: '2025-11-25', serverInfo: { name: 'cqai-club-test', version: '1' }, capabilities: { tools: { listChanged: true } } })
        break
      case 'notifications/initialized':
      case 'notifications/cancelled':
        response.writeHead(202).end()
        break
      case 'tools/list': {
        if (pauseList !== undefined) await pauseList
        if (failList) {
          response.writeHead(503).end('unavailable')
          break
        }
        const index = Number(body.params?.cursor ?? 0)
        send({ tools: pages[index] ?? [], ...(index + 1 < pages.length ? { nextCursor: String(index + 1) } : {}) })
        break
      }
      case 'tools/call':
        if (callStatus === 401) {
          response.writeHead(401, { 'www-authenticate': 'Bearer', 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'invalid_token' }))
        } else send(callResult, callStatus)
        break
      default:
        response.writeHead(400).end('unexpected test request')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock HTTP endpoint missing')
  const url = `http://127.0.0.1:${address.port}/mcp`
  cleanups.push(async () => {
    for (const stream of streams) stream.end()
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  })
  const fetchImpl: typeof fetch = async (input, init) => {
    expect(String(input)).toBe(DEFAULT_CLUB_MCP_URL)
    expect(init?.redirect).toBe('error')
    const response = await nativeFetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: 'Bearer account-owned-mcp-token' },
    })
    // The account proxy requests the fixed production URL; this fixture maps
    // that URL locally without returning a different response URL to the SDK.
    return new Response(response.body, { status: response.status, headers: response.headers })
  }
  return {
    requests, fetchImpl,
    setPages: (next: typeof pages) => { pages = next },
    setCallStatus: (status: number) => { callStatus = status },
    setCallResult: (result: unknown) => { callResult = result },
    failList: () => { failList = true },
    pauseList: (pending: Promise<void>) => { pauseList = pending },
    notifyToolsChanged: () => {
      for (const stream of streams) stream.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\n`)
    },
    streams,
  }
}

function makeClient(ctx: Context, fetchImpl: typeof fetch, updates: ClubMcpClientUpdate[] = []) {
  const client = new ClubMcpClient({ ctx, fetchImpl, timeoutMs: 2000, onStatusChange: (update) => updates.push(update) })
  cleanups.push(() => client.close())
  return client
}

async function call(definition: ToolDefinition, signal = new AbortController().signal) {
  const args = { id: 'activity-44' }
  return definition.execute(args, { callId: 'call-44', rootCallId: 'call-44', name: definition.name, arguments: args, signal, token: Symbol('execution'), deferContext: () => undefined, concludeTurn: () => undefined } as unknown as ToolRunContext)
}

describe('CQAI Club Host MCP adapter', () => {
  it('handshakes with the real SDK, discovers every page, registers and executes actual Host tools', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    const client = makeClient(ctx, http.fetchImpl)
    await expect(client.connect()).resolves.toEqual({ toolCount: 2 })
    expect([...tools.keys()]).toEqual(['mcp__cqai_club__club_get_activity', 'mcp__cqai_club__club_my_registrations'])
    const definition = tools.get('mcp__cqai_club__club_get_activity')!
    await expect(call(definition)).resolves.toMatchObject({ content: [{ type: 'text', text: '真实 MCP 工具结果' }], structuredContent: { id: 'activity-44' } })
    expect(http.requests.some((request) => request.body?.method === 'initialize')).toBe(true)
    expect(http.requests.some((request) => request.body?.method === 'notifications/initialized')).toBe(true)
    expect(http.requests.find((request) => request.body?.method === 'tools/call')?.body?.params).toMatchObject({ name: 'club_get_activity', arguments: { id: 'activity-44' } })
    expect(http.requests.every((request) => request.authorization === 'Bearer account-owned-mcp-token')).toBe(true)
  })

  it('updates registry tools after real tools/list_changed notifications', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    const updates: ClubMcpClientUpdate[] = []
    const client = makeClient(ctx, http.fetchImpl, updates)
    await client.connect()
    await vi.waitFor(() => expect(http.streams.size).toBe(1))
    http.setPages([[tool('club_validate_plugin_package')]])
    http.notifyToolsChanged()
    await vi.waitFor(() => expect([...tools.keys()]).toEqual(['mcp__cqai_club__club_validate_plugin_package']))
    expect(updates.at(-1)).toMatchObject({ state: 'connected', toolCount: 1 })
    http.failList()
    http.notifyToolsChanged()
    await vi.waitFor(() => expect(tools.size).toBe(0))
    expect(updates.at(-1)).toMatchObject({ state: 'error', toolCount: 0 })
  })

  it('removes all tools on logout/disable and allows an explicit reconnect', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    const client = makeClient(ctx, http.fetchImpl)
    await client.connect()
    const stale = tools.get('mcp__cqai_club__club_get_activity')!
    const closing = client.close()
    expect(tools.size).toBe(0)
    await closing
    await expect(call(stale)).rejects.toThrow('已断开')
    await expect(client.connect()).resolves.toEqual({ toolCount: 2 })
    expect(tools.size).toBe(2)
  })

  it('does not bind subsequent Agent calls to a completed connect RPC signal', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    const client = makeClient(ctx, http.fetchImpl)
    const request = new AbortController()
    await client.connect(request.signal)
    request.abort()
    await expect(call(tools.get('mcp__cqai_club__club_get_activity')!)).resolves.toBeDefined()
    expect(tools.size).toBe(2)
  })

  it('surfaces a business tool error while retaining the working connection', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    const client = makeClient(ctx, http.fetchImpl)
    await client.connect()
    http.setCallResult({ isError: true, content: [{ type: 'text', text: '活动报名已关闭' }] })
    await expect(call(tools.get('mcp__cqai_club__club_get_activity')!)).rejects.toThrow('活动报名已关闭')
    expect(tools.size).toBe(2)
  })

  it('retains the connected registry for HTTP argument and per-tool permission errors', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    const client = makeClient(ctx, http.fetchImpl)
    await client.connect()
    const definition = tools.get('mcp__cqai_club__club_get_activity')!
    for (const status of [400, 403]) {
      http.setCallStatus(status)
      await expect(call(definition)).rejects.toThrow()
      expect(tools.size).toBe(2)
    }
    http.setCallStatus(200)
    await expect(call(definition)).resolves.toBeDefined()
  })

  it('keeps refresh solely in the account proxy and does not add a second 401 retry', async () => {
    const http = await endpoint()
    const { ctx, tools } = registry()
    let refreshes = 0
    const proxy: typeof fetch = async (input, init) => {
      const response = await http.fetchImpl(input, init)
      if (response.status !== 401) return response
      refreshes += 1
      http.setCallStatus(200)
      return http.fetchImpl(input, init)
    }
    const client = makeClient(ctx, proxy)
    await client.connect()
    http.setCallStatus(401)
    await expect(call(tools.get('mcp__cqai_club__club_get_activity')!)).resolves.toMatchObject({ structuredContent: { id: 'activity-44' } })
    expect(refreshes).toBe(1)
    expect(http.requests.filter((request) => request.body?.method === 'tools/call')).toHaveLength(2)
    http.setCallStatus(401)
    // With an exhausted account retry, the SDK must surface the 401 unchanged.
    const exhausted = makeClient(ctx, http.fetchImpl)
    await client.close()
    await exhausted.connect()
    const definition = tools.get('mcp__cqai_club__club_get_activity')!
    await expect(call(definition)).rejects.toThrow()
    expect(http.requests.filter((request) => request.body?.method === 'tools/call')).toHaveLength(3)
    expect(tools.size).toBe(0)
  })

  it('never replays a failed write request and can recover on explicit reconnect', async () => {
    const http = await endpoint()
    http.setPages([[tool('club_publish_activity')]])
    const { ctx, tools } = registry()
    const updates: ClubMcpClientUpdate[] = []
    let writes = 0
    let fail = true
    const proxy: typeof fetch = async (input, init) => {
      if (typeof init?.body === 'string' && JSON.parse(init.body).method === 'tools/call') {
        writes += 1
        if (fail) throw new TypeError('unknown remote result')
      }
      return http.fetchImpl(input, init)
    }
    const client = makeClient(ctx, proxy, updates)
    await client.connect()
    await expect(call(tools.get('mcp__cqai_club__club_publish_activity')!)).rejects.toThrow()
    expect(writes).toBe(1)
    expect(tools.size).toBe(0)
    expect(updates.at(-1)).toMatchObject({ state: 'error' })
    fail = false
    await client.connect()
    await expect(call(tools.get('mcp__cqai_club__club_publish_activity')!)).resolves.toBeDefined()
    expect(writes).toBe(2)
  })

  it('does not register late tools after close while initial discovery is pending', async () => {
    const http = await endpoint()
    let resume!: () => void
    http.pauseList(new Promise<void>((resolve) => { resume = resolve }))
    const { ctx, tools } = registry()
    const client = makeClient(ctx, http.fetchImpl)
    const connecting = client.connect()
    const failed = expect(connecting).rejects.toThrow()
    await vi.waitFor(() => expect(http.requests.some((request) => request.body?.method === 'tools/list')).toBe(true))
    await client.close()
    resume()
    await failed
    expect(tools.size).toBe(0)
  })

  it('rejects arbitrary endpoints, redirects and registry collisions without partial tool registration', async () => {
    const { ctx, tools } = registry()
    expect(() => new ClubMcpClient({ ctx, fetchImpl: nativeFetch, timeoutMs: 1000, url: 'https://other.test/mcp' })).toThrow('仅支持')
    const redirect = makeClient(ctx, async () => new Response(null, { status: 302, headers: { location: 'https://other.test/mcp' } }))
    await expect(redirect.connect()).rejects.toThrow('重定向')
    expect(tools.size).toBe(0)
    const http = await endpoint()
    const foreign = { name: 'mcp__cqai_club__club_my_registrations' } as unknown as ToolDefinition
    tools.set(foreign.name, foreign)
    const client = makeClient(ctx, http.fetchImpl)
    await expect(client.connect()).rejects.toThrow('duplicate registry')
    expect([...tools.values()]).toEqual([foreign])
  })
})
