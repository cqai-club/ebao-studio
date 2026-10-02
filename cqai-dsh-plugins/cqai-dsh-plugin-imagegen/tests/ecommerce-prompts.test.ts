import { describe, expect, it } from 'vitest'
import { ecommerceSlotPrompt } from '../src/client/ecommerce-prompts.ts'
import type { ProductSetDraft, ProductSetSlot } from '../src/protocol.ts'

const draft: ProductSetDraft = { projectId: '', projectName: '', productName: '铝合金水杯', category: '家居', platform: '淘宝', language: 'custom', customLanguage: 'Deutsch', size: '1:1', promptInfo: '容量 500 ml，保留杯身 Logo', slots: [] }
const slot = (key: string): ProductSetSlot => ({ key, label: key, description: '商品视觉', count: 2, enabled: true, refRole: 'product' })

describe('ecommerce image prompts', () => {
  it('separates image purposes and differentiates repeated images', () => {
    const main = ecommerceSlotPrompt(draft, slot('main'), 0)
    const scene1 = ecommerceSlotPrompt(draft, slot('scene'), 0)
    const scene2 = ecommerceSlotPrompt(draft, slot('scene'), 1)
    const detail = ecommerceSlotPrompt(draft, slot('detail'), 0)
    expect(new Set([main, scene1, scene2, detail]).size).toBe(4)
    expect(main).toContain('完整展示商品主体')
    expect(scene1).toContain('室内或日常环境')
    expect(scene2).toContain('不同环境或使用时刻')
    expect(detail).toContain('微距特写')
    for (const prompt of [main, scene1, scene2, detail]) {
      for (const fact of ['铝合金水杯', '淘宝', 'Deutsch', '500 ml', '不得重新发明或替换商品']) expect(prompt).toContain(fact)
    }
  })

  it('keeps manual/polished overrides per image and restores blank overrides to defaults', () => {
    const edited = { ...draft, promptOverrides: { 'scene-1': 'Reviewed custom prompt', 'scene-2': ' ' } }
    expect(ecommerceSlotPrompt(edited, slot('scene'), 0)).toBe('Reviewed custom prompt')
    expect(ecommerceSlotPrompt(edited, slot('scene'), 1)).toBe(ecommerceSlotPrompt(draft, slot('scene'), 1))
    expect(ecommerceSlotPrompt(edited, slot('detail'), 0)).toContain('微距特写')
  })
})
