import { describe, expect, it } from 'vitest'

import {
  mayAdoptCqaiOnboardingDefault,
  preferredCqaiOnboardingModel,
} from '../src/onboarding.ts'
import type { DsnModel } from '../src/protocol.ts'

function model(id: string, categories: DsnModel['categories'] = ['text']): DsnModel {
  return {
    id,
    ownedBy: 'cqai',
    categories,
    supportedEndpointTypes: categories.includes('image') ? ['image-generation'] : ['openai'],
  }
}

describe('CQAI account onboarding policy', () => {
  it('only replaces the untouched upstream default model', () => {
    expect(mayAdoptCqaiOnboardingDefault({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
    })).toBe(true)
    expect(mayAdoptCqaiOnboardingDefault({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })).toBe(true)
    expect(mayAdoptCqaiOnboardingDefault({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })).toBe(false)
    expect(mayAdoptCqaiOnboardingDefault({
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
    })).toBe(false)
    expect(mayAdoptCqaiOnboardingDefault({
      provider: 'another-provider',
      model: 'custom-model',
    })).toBe(false)
  })

  it('prefers the product CQAI model and otherwise follows chat catalog order', () => {
    expect(preferredCqaiOnboardingModel([
      model('fallback-chat'),
      model('deepseek/deepseek-v4-flash'),
    ])).toBe('deepseek/deepseek-v4-flash')

    expect(preferredCqaiOnboardingModel([
      model('image-only', ['image']),
      model('fallback-chat'),
    ])).toBe('fallback-chat')

    expect(preferredCqaiOnboardingModel([
      model('image-only', ['image']),
    ])).toBeUndefined()
  })
})
