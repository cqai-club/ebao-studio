import { describe, expect, it, vi } from 'vitest'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'

import { CqaiClubAdapter, CQAI_PROVIDER } from '../src/llm-adapter.ts'
import type { DsnAccountService, DsnModel } from '../src/protocol.ts'

const textModel: DsnModel = {
  id: 'text-model',
  ownedBy: 'cqai',
  categories: ['text'],
  supportedEndpointTypes: ['openai'],
}

const multimodalModel: DsnModel = {
  id: 'vision-model',
  ownedBy: 'cqai',
  categories: ['text-multimodal'],
  supportedEndpointTypes: ['openai'],
}

function accountService(response: Response, models: DsnModel[] = [textModel, multimodalModel]): DsnAccountService & {
  fetchAi: ReturnType<typeof vi.fn>
} {
  return {
    getStatus: vi.fn(),
    getAccount: vi.fn(),
    listModels: vi.fn(async () => ({ models, fetchedAt: Date.now(), stale: false })),
    getDefaultModel: vi.fn(),
    setDefaultModel: vi.fn(),
    getCategoryDefaultModels: vi.fn(),
    setCategoryDefaultModel: vi.fn(),
    getTopUpInfo: vi.fn(),
    listTopUps: vi.fn(),
    createTopUp: vi.fn(),
    fetchAi: vi.fn(async () => response),
  }
}

describe('CqaiClubAdapter', () => {
  it('publishes logged-in chat models through the DSH provider catalog', async () => {
    const service = accountService(new Response(''))
    const adapter = new CqaiClubAdapter(service)

    await expect(adapter.listModels(CQAI_PROVIDER)).resolves.toEqual([
      { provider: CQAI_PROVIDER, id: 'text-model', name: 'text-model', inputModalities: ['text'] },
      { provider: CQAI_PROVIDER, id: 'vision-model', name: 'vision-model', inputModalities: ['text'] },
    ])
  })

  it('keeps image-only models out of the ordinary conversation selector', async () => {
    const imageOnly: DsnModel = {
      id: 'image-model',
      ownedBy: 'cqai',
      categories: ['image'],
      supportedEndpointTypes: ['openai', 'image-generation'],
    }
    const adapter = new CqaiClubAdapter(accountService(new Response(''), [imageOnly]))

    await expect(adapter.listModels(CQAI_PROVIDER)).resolves.toEqual([])
  })

  it('routes selected model calls through the host account service and translates SSE', async () => {
    const response = new Response([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { headers: { 'content-type': 'text/event-stream' } })
    const service = accountService(response)
    const adapter = new CqaiClubAdapter(service)
    const message: Message = createUserMessage({
      content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user' },
    })

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: CQAI_PROVIDER,
      model: textModel.id,
      messages: [message],
      temperature: 0.2,
    })) chunks.push(chunk)

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '你好' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '你好' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    expect(service.fetchAi).toHaveBeenCalledTimes(1)
    const [path, init] = service.fetchAi.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      accept: 'text/event-stream',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: textModel.id,
      stream: true,
      temperature: 0.2,
      messages: [{ role: 'user', content: '你好' }],
    })
  })
})
