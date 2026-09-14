import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillImageBridge } from '../src/skill-image-bridge.ts'

const servers: Server[] = []

async function listen(bridge: SkillImageBridge): Promise<string> {
  const server = createServer(bridge.route().handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not listen')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('SkillImageBridge', () => {
  it('forwards an allowed JSON request without forwarding the run bearer', async () => {
    const calls: Array<{ path: string; init: RequestInit }> = []
    const bridge = new SkillImageBridge({
      fetchAi: async (path, init) => {
        calls.push({ path, init })
        return Response.json({ data: [{ b64_json: 'abc' }] })
      },
      token: () => 'a'.repeat(43),
    })
    const origin = await listen(bridge)
    const grant = bridge.issue({ origin, model: 'cqai-image-1' })
    const response = await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${grant.apiKey}`, 'content-type': 'application/json', cookie: 'never-forward-me=1' },
      body: JSON.stringify({ model: 'cqai-image-1', prompt: 'a cat' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ b64_json: 'abc' }] })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/v1/images/generations')
    expect(calls[0]?.init.headers).toEqual({ 'content-type': 'application/json', accept: 'application/json' })
    expect(JSON.parse(Buffer.from(calls[0]?.init.body as ArrayBuffer).toString('utf8'))).toMatchObject({ model: 'cqai-image-1' })
    bridge.dispose()
  })

  it('forwards multipart edits while enforcing the exact selected model', async () => {
    let forwardedModel = ''
    const bridge = new SkillImageBridge({
      fetchAi: async (_path, init) => {
        const headers = init.headers as Record<string, string>
        const form = await new Request('http://127.0.0.1/', {
          method: 'POST',
          headers,
          body: init.body,
        }).formData()
        forwardedModel = String(form.get('model'))
        return Response.json({ data: [] })
      },
      token: () => 'b'.repeat(43),
    })
    const origin = await listen(bridge)
    const grant = bridge.issue({ origin, model: 'cqai-edit-1' })
    const form = new FormData()
    form.set('model', 'cqai-edit-1')
    form.set('prompt', 'replace sky')
    form.set('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'in.png')
    const response = await fetch(`${grant.baseUrl}/images/edits`, {
      method: 'POST', headers: { authorization: `Bearer ${grant.apiKey}` }, body: form,
    })
    expect(response.status).toBe(200)
    expect(forwardedModel).toBe('cqai-edit-1')
    bridge.dispose()
  })

  it('rejects missing credentials, disallowed endpoints, methods and models before CQAI', async () => {
    let calls = 0
    const bridge = new SkillImageBridge({
      fetchAi: async () => { calls += 1; return Response.json({}) },
      token: () => 'c'.repeat(43),
    })
    const origin = await listen(bridge)
    const grant = bridge.issue({ origin, model: 'only-this-model' })
    const noAuth = await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'only-this-model' }),
    })
    const endpoint = await fetch(`${origin}/api/dsh-imagegen/skill-openai/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${grant.apiKey}`, 'content-type': 'application/json' }, body: '{}',
    })
    const method = await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'GET', headers: { authorization: `Bearer ${grant.apiKey}` },
    })
    const model = await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'POST', headers: { authorization: `Bearer ${grant.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'other-model' }),
    })
    expect([noAuth.status, endpoint.status, method.status, model.status]).toEqual([401, 404, 405, 403])
    expect(calls).toBe(0)
    bridge.dispose()
  })

  it('invalidates a run credential on revoke, cancellation and expiry', async () => {
    let now = 1_000
    let sequence = 0
    const bridge = new SkillImageBridge({
      fetchAi: async () => Response.json({ data: [] }),
      now: () => now,
      token: () => `${String(++sequence).padStart(32, '0')}xxxxxxxxxxxxxxxx`,
      ttlMs: 1_000,
    })
    const origin = await listen(bridge)
    const post = async (grant: { baseUrl: string; apiKey: string }): Promise<Response> => await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'POST', headers: { authorization: `Bearer ${grant.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'model-1' }),
    })

    const revoked = bridge.issue({ origin, model: 'model-1' })
    revoked.revoke()
    expect((await post(revoked)).status).toBe(401)

    const controller = new AbortController()
    const cancelled = bridge.issue({ origin, model: 'model-1', signal: controller.signal })
    controller.abort()
    expect((await post(cancelled)).status).toBe(401)

    const alreadyAbortedController = new AbortController()
    alreadyAbortedController.abort()
    const alreadyCancelled = bridge.issue({ origin, model: 'model-1', signal: alreadyAbortedController.signal })
    expect((await post(alreadyCancelled)).status).toBe(401)

    const expired = bridge.issue({ origin, model: 'model-1' })
    now = expired.expiresAt
    expect((await post(expired)).status).toBe(401)
    bridge.dispose()
  })

  it('does not reflect credential-bearing upstream exceptions to a skill', async () => {
    const bridge = new SkillImageBridge({
      fetchAi: async () => { throw new Error('Authorization: Bearer real-oauth-token') },
      token: () => 'z'.repeat(43),
    })
    const origin = await listen(bridge)
    const grant = bridge.issue({ origin, model: 'model-1' })
    const response = await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${grant.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'model-1', prompt: 'x' }),
    })
    const text = await response.text()
    expect(response.status).toBe(502)
    expect(text).toContain('CQAI image request failed')
    expect(text).not.toContain('real-oauth-token')
    bridge.dispose()
  })

  it('caps an upstream response while streaming instead of allocating it first', async () => {
    let cancelled = false
    const bridge = new SkillImageBridge({
      fetchAi: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(800))
          controller.enqueue(new Uint8Array(800))
        },
        cancel() { cancelled = true },
      }), { headers: { 'content-type': 'application/json' } }),
      maxResponseBytes: 1_024,
      token: () => 'y'.repeat(43),
    })
    const origin = await listen(bridge)
    const grant = bridge.issue({ origin, model: 'model-1' })
    const response = await fetch(`${grant.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${grant.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'model-1', prompt: 'x' }),
    })
    expect(response.status).toBe(502)
    expect(await response.text()).toContain('response is too large')
    expect(cancelled).toBe(true)
    bridge.dispose()
  })
})
