import { expect, it, vi } from 'vitest'
import { ManagedVideoProvider, type AccountRequest } from '../src/managed-video.ts'

it('uses the account transport, sends a stable idempotency key and filters vendor details', async () => {
  const request = vi.fn<AccountRequest>().mockResolvedValue(Response.json({id: 'run_1', status: 'queued', progress: 0, upstreamKey: 'private', download_url: 'https://vendor.invalid/private'}))
  const provider = new ManagedVideoProvider(request)
  const result = await provider.create({requestId: 'local_job_1', quoteId: 'quote_1', script: '测试文案', avatar: new Blob(['photo']), voice: new Blob(['voice']), avatarName: '头像.png', voiceName: '录音.m4a'})
  expect(result).toEqual({id: 'run_1', status: 'queued', progress: 0})
  const [path, init] = request.mock.calls[0]
  expect(path).toBe('/v1/ejianbao/runs')
  expect(init?.headers).toEqual({'idempotency-key': 'local_job_1'})
  expect(init?.redirect).toBe('error')
  const form = init?.body as FormData
  expect(form.get('script')).toBe('测试文案')
  expect(await (form.get('voice') as File).text()).toBe('voice')
})

it('requires a nonexpired server quote with integer billing units', async () => {
  const request = vi.fn<AccountRequest>().mockResolvedValue(Response.json({id: 'q1', amount: 123, unit: '积分', expiresAt: new Date(Date.now() + 60000).toISOString()}))
  const provider = new ManagedVideoProvider(request)
  expect((await provider.quote('测试')).amount).toBe(123)
  request.mockResolvedValue(Response.json({id: 'q1', amount: 0.1, unit: '积分', expiresAt: '2000-01-01'}))
  await expect(provider.quote('测试')).rejects.toMatchObject({code: 'protocol'})
})

it('rejects path traversal before sending account credentials and downloads only through account service', async () => {
  const request = vi.fn<AccountRequest>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'video/mp4'}}))
  const provider = new ManagedVideoProvider(request)
  await expect(provider.status('../another-user')).rejects.toMatchObject({code: 'protocol'})
  expect(request).not.toHaveBeenCalled()
  expect(new Uint8Array(await new Response(await provider.download('run_1')).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  expect(request.mock.calls[0][0]).toBe('/v1/ejianbao/runs/run_1/video')
})

it('does not expose upstream errors or fall back to a local InferFlow key', async () => {
  const request = vi.fn<AccountRequest>()
  const provider = new ManagedVideoProvider(request)
  for (const [status, code] of [[401, 'auth'], [402, 'quota'], [404, 'unavailable'], [409, 'conflict']] as const) {
    request.mockResolvedValue(new Response('upstream secret', {status}))
    await expect(provider.status('run_1')).rejects.toMatchObject({code})
  }
  expect(request).toHaveBeenCalledTimes(4)
})
