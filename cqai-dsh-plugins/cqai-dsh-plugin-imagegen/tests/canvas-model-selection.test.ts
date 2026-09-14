import { describe, expect, it } from 'vitest'
import { selectCanvasImageModel } from '../src/client/canvas-model-selection.ts'

describe('canvas image-model selection', () => {
  it('requires an explicit CQAI choice when several models have no account default', () => {
    const models = ['cqai-image-a', 'cqai-image-b']
    expect(selectCanvasImageModel('', models, true)).toBe('')
    expect(selectCanvasImageModel('removed-model', models, true)).toBe('')
    expect(selectCanvasImageModel('cqai-image-b', models, true)).toBe('cqai-image-b')
  })

  it('keeps the original first-model fallback for custom Providers', () => {
    expect(selectCanvasImageModel('', ['custom-image-a', 'custom-image-b'], false)).toBe('custom-image-a')
  })
})
