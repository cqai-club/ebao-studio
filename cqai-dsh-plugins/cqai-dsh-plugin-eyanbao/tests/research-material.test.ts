import { describe, expect, it } from 'vitest'
import { streamProjectDraft, type ResearchModelServices } from '../src/generation.ts'
import { project, source } from './fixtures.ts'

describe('author material', () => {
  it('only includes supplied material in the draft model request', async () => {
    let captured: unknown
    const services: ResearchModelServices = {
      defaultModel: { currentSelection: () => ({ provider: 'demo', model: 'demo' }) },
      llm: { stream: async function* (request: unknown) {
        captured = request
        yield { type: 'text-delta', text: '草稿' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } } as unknown as ResearchModelServices['llm'],
    }
    const text = await streamProjectDraft(project(), [source], services, () => {}, new AbortController().signal, '作者访谈材料：真实结果待补充')
    expect(text).toBe('草稿')
    expect(JSON.stringify(captured)).toContain('作者访谈材料：真实结果待补充')
    expect(JSON.stringify(captured)).toContain('未经系统验证')
  })
})
