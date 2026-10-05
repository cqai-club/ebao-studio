import { describe, expect, it } from 'vitest'
import { ecommerceResultPrompt } from '../src/client/ecommerce-result-prompt.ts'
import type { EcommerceRunAttempt, EcommerceRunSlot } from '../src/ecommerce-run-protocol.ts'
import type { GenerateRequest, HistoryImageRef } from '../src/protocol.ts'

const image = (name: string): HistoryImageRef => ({ url: `/api/dsh-imagegen/ecommerce/asset/run/${name}.png`, mime: 'image/png' })
const request = (prompt: string): GenerateRequest => ({ mode: 'edit', model: 'model', prompt, size: '1:1', quality: '2k', detail: '', n: 1 })
const attempt = (number: number, prompt: string, images: HistoryImageRef[], status: EcommerceRunAttempt['status'] = 'completed'): EcommerceRunAttempt => ({ number, status, request: request(prompt), images })
function slot(patch: Partial<EcommerceRunSlot> = {}): EcommerceRunSlot {
  return { key: 'scene-1', label: '场景图', status: 'completed', attempt: 1, request: request('原计划：自然使用场景'), images: [image('first')], ...patch }
}

describe('prompt provenance for an ecommerce result image', () => {
  it('returns the actual recorded request for the matching image index, including its main anchor constraints', () => {
    const images = [image('first'), image('second')]
    const prompt = '场景图实际请求\n商品身份以上传的套图主图为锚点'
    const value = slot({ images, attempts: [attempt(1, prompt, images)] })
    expect(ecommerceResultPrompt(value, 1)).toEqual({ prompt, source: 'actual', attempt: 1 })
  })

  it('keeps the old image bound to its old prompt while a retry has a new running request', () => {
    const old = image('first')
    const value = slot({ status: 'running', attempt: 2, attempts: [attempt(1, '旧图的实际提示词', [old]), attempt(2, '新图正在生成的提示词', [old], 'running')] })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt: '旧图的实际提示词', source: 'actual', attempt: 1 })
  })

  it('uses the latest completed attempt when several attempts produced the same image URL', () => {
    const result = image('same-content')
    const value = slot({ attempt: 3, images: [result], attempts: [attempt(1, '第一版实际提示词', [result]), attempt(2, '第二版实际提示词', [result]), attempt(3, '尚未完成的新请求', [result], 'queued')] })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt: '第二版实际提示词', source: 'actual', attempt: 2 })
  })

  it('does not bind a matching URL from another image index or a conflicting MIME type', () => {
    const displayed = image('first')
    const value = slot({ attempts: [attempt(1, '另一索引的提示词', [image('other'), displayed]), attempt(2, '格式不符的提示词', [{ ...displayed, mime: 'image/jpeg' }])] })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt: value.request.prompt, source: 'planned' })
  })

  it('honestly falls back to the original plan when none of the completed attempts matches', () => {
    const value = slot({ attempts: [attempt(1, '其他结果的实际提示词', [image('different')]), attempt(2, '当前生成请求，不能冒充旧图', [image('first')], 'running')] })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt: value.request.prompt, source: 'planned' })
  })

  it('labels legacy text as saved instead of claiming it is a verified generation request', () => {
    const value = slot({ attempts: undefined, request: request('旧历史中保存的提示词') })
    expect(ecommerceResultPrompt(value, 0, { legacy: true })).toEqual({ prompt: '旧历史中保存的提示词', source: 'saved' })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt: '旧历史中保存的提示词', source: 'planned' })
  })

  it('does not substitute an older request when the newest matching completed attempt has no saved prompt', () => {
    const result = image('first')
    const value = slot({ attempts: [attempt(1, '较老提示词不能冒充最新版', [result]), attempt(2, '  ', [result])] })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt: value.request.prompt, source: 'planned' })
  })

  it('returns unavailable for missing images, invalid indexes or missing prompt text', () => {
    for (const index of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2]) {
      expect(ecommerceResultPrompt(slot(), index)).toEqual({ prompt: null, source: 'unavailable' })
    }
    expect(ecommerceResultPrompt(slot({ images: [] }), 0)).toEqual({ prompt: null, source: 'unavailable' })
    expect(ecommerceResultPrompt(slot({ request: request('  ') }), 0, { legacy: true })).toEqual({ prompt: null, source: 'unavailable' })
  })

  it('preserves exact request whitespace and uses the request rather than the provider revised prompt', () => {
    const prompt = '  实际提示词\n\n包含原始换行  '
    const result = { ...image('first'), revisedPrompt: '上游返回的改写文本' }
    const value = slot({ images: [result], attempts: [attempt(1, prompt, [result])] })
    expect(ecommerceResultPrompt(value, 0)).toEqual({ prompt, source: 'actual', attempt: 1 })
  })
})
