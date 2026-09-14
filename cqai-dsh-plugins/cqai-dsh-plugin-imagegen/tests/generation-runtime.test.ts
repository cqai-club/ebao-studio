import { describe, expect, it, vi } from 'vitest'

import { ImageGenerationRuntime } from '../src/generation-runtime.ts'
import type { GenerateRequest } from '../src/protocol.ts'

const request: GenerateRequest = {
  mode: 'text',
  model: 'image-model',
  prompt: 'draw a test image',
  size: '1024x1024',
  quality: 'auto',
  n: 1,
  detail: '',
  channelId: 'custom:removed',
}

describe('ImageGenerationRuntime Provider selection', () => {
  it('fails closed when an explicitly selected Provider was removed', async () => {
    const fallbackRequest = vi.fn()
    const historyAppend = vi.fn()
    const runtime = new ImageGenerationRuntime(() => ({
      defaultChannelId: 'cqai',
      channels: [{
        id: 'cqai',
        preset: 'cqai',
        name: 'CQAI',
        apiUrl: 'https://account.cqaiclub.asia/v1',
        apiKey: '',
        models: [{ alias: 'image-model', id: 'image-model' }],
        request: fallbackRequest,
      }],
    }), { append: historyAppend })

    await expect(runtime.run(request)).rejects.toMatchObject({
      code: 'provider-not-configured',
    })
    expect(fallbackRequest).not.toHaveBeenCalled()
    expect(historyAppend).not.toHaveBeenCalled()
  })
})
