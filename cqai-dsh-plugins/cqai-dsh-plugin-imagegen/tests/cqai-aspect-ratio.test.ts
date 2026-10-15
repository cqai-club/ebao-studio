import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DsnAccountService } from '@cqaiclub/dsn-account'
import { CqaiImageProvider } from '../src/cqai-image-provider.ts'
import { generateImage } from '../src/engine.ts'
import { ImageGenerationRuntime } from '../src/generation-runtime.ts'
import type { GenerateRequest } from '../src/protocol.ts'

function fixture() {
  const request = vi.fn(async () => new Response(JSON.stringify({
    data: [{ b64_json: Buffer.from('fixture image').toString('base64') }],
  }), { headers: { 'content-type': 'application/json' } }))
  const provider = new CqaiImageProvider({ fetchAi: request } as unknown as DsnAccountService)
  return { request, channel: provider.channel() }
}

function portrait(model: string, changes: Partial<GenerateRequest> = {}): GenerateRequest {
  return { mode: 'text', model, prompt: 'a portrait for an image note', size: '3:4', quality: 'auto', n: 1, detail: '', ...changes }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('CQAI explicit 3:4 image requests', () => {
  it.each([
    ['gpt-image-2', '1152x1536'],
    ['gpt-image-2-2026-04-21', '1152x1536'],
    ['gpt-image-2.5', '1152x1536'],
    ['gpt-image-2.5-sunburst', '1152x1536'],
    ['nanobanana2', '1152x1536'],
    ['gemini-3.1-flash-image-preview', '1152x1536'],
    ['grok-imagine-image', '1152x1536'],
    ['customer-image-alias', '1152x1536'],
    ['image-01', '864x1152'],
    ['qwen-image', '1104x1472'],
    ['qwen-image-2.0-pro', '1728x2304'],
    ['qwen-image-3.0', '1728x2304'],
    ['seedream-5.0-pro', '1728x2304'],
    ['doubao-seedream-4-5-251128', '1728x2304'],
    ['imagen-4.0-generate-001', '3:4'],
  ])('keeps the requested ratio in the Relay size contract for %s', async (model, size) => {
    const test = fixture()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected native provider request') }))

    await generateImage(test.channel, portrait(model))

    expect(test.request).toHaveBeenCalledTimes(1)
    const [path, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/v1/images/generations')
    expect(JSON.parse(String(init.body))).toEqual({ prompt: 'a portrait for an image note', model, size })
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    if (size.includes('x')) {
      const [width, height] = size.split('x').map(Number)
      expect(width * 4).toBe(height * 3)
    }
  })

  it.each(['gpt-image-2', 'nanobanana2'])('uses a standard multipart 3:4 edit request for %s', async model => {
    const test = fixture()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected native provider request') }))

    await generateImage(test.channel, portrait(model, {
      mode: 'edit', image: 'data:image/png;base64,aW1hZ2U=',
    }))

    const [path, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/v1/images/edits')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('model')).toBe(model)
    expect(form.get('size')).toBe('1152x1536')
    expect(form.get('image')).toBeInstanceOf(Blob)
    expect(form.has('aspect_ratio')).toBe(false)
    expect(form.has('image_size')).toBe(false)
  })

  it.each(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'dall-e-2', 'dall-e-3'])(
    'rejects a known fixed-size model instead of silently requesting 2:3 or square: %s',
    async model => {
      const test = fixture()
      await expect(generateImage(test.channel, portrait(model))).rejects.toMatchObject({ code: 'size-unsupported' })
      expect(test.request).not.toHaveBeenCalled()
    },
  )

  it('checks the upstream model behind an alias before sending a fixed-size request', async () => {
    const test = fixture()
    await expect(generateImage(test.channel, portrait('my-image-model', { upstream: 'gpt-image-1.5' })))
      .rejects.toMatchObject({ code: 'size-unsupported' })
    expect(test.request).not.toHaveBeenCalled()
  })

  it.each([
    ['auto', undefined],
    ['1:1', '1024x1024'],
    ['2:3', '1024x1536'],
    ['4:3', '1536x1024'],
    ['16:9', '1792x1024'],
  ])('preserves existing CQAI behavior for %s', async (ratio, size) => {
    const test = fixture()
    await generateImage(test.channel, portrait('nanobanana2', { size: ratio }))
    const [, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'nanobanana2', prompt: 'a portrait for an image note', ...size === undefined ? {} : { size },
    })
  })

  it('keeps fixed-model supported square requests available', async () => {
    const test = fixture()
    await generateImage(test.channel, portrait('gpt-image-1', { size: '1:1' }))
    const [, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-image-1', size: '1024x1024' })
  })

  it('carries the CQAI policy through the shared runtime when CQAI is the default channel', async () => {
    const test = fixture()
    const append = vi.fn(async () => [])
    const runtime = new ImageGenerationRuntime(() => ({ channels: [test.channel], defaultChannelId: 'cqai' }), { append })
    await runtime.run(portrait('gpt-image-2'))
    const [, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ size: '1152x1536' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ size: '3:4' }))
  })

  it('returns server validation errors without retrying another size or Provider', async () => {
    const test = fixture()
    test.request.mockImplementationOnce(async () => new Response(JSON.stringify({
      error: { message: 'This model does not support 1152x1536' },
    }), { status: 400, headers: { 'content-type': 'application/json' } }))

    await expect(generateImage(test.channel, portrait('customer-image-alias'))).rejects.toThrow('does not support 1152x1536')
    expect(test.request).toHaveBeenCalledTimes(1)
  })
})

describe('third-party image contracts', () => {
  it('retains the native Nano Banana 3:4 parameter', async () => {
    const test = fixture()
    await generateImage({ ...test.channel, protocol: 'auto' }, portrait('nanobanana2'))
    const [, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'nanobanana2', prompt: 'a portrait for an image note', aspect_ratio: '3:4', response_format: 'b64_json',
    })
  })

  it.each([
    ['auto', 'gpt-image-2'], ['openai', 'gpt-image-2'],
    ['auto', 'gpt-image-2.5'], ['openai', 'gpt-image-2.5'],
  ] as const)('keeps portrait requests exact on a %s channel for %s', async (protocol, model) => {
    const test = fixture()
    await generateImage({ ...test.channel, protocol }, portrait(model))
    const [, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ size: '1152x1536' })
  })

  it('preserves the existing GPT Image 1 preset on a third-party OpenAI channel', async () => {
    const test = fixture()
    await generateImage({ ...test.channel, protocol: 'openai' }, portrait('gpt-image-1'))
    const [, init] = test.request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ size: '1024x1536' })
  })
})
