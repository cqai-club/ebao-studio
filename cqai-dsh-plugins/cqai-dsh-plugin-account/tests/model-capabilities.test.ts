import { describe, expect, it } from 'vitest'

import {
  isAudioModel,
  isChatModel,
  isImageGenerationModel,
  isModelInCategory,
  isVideoModel,
  isVisionChatModel,
  type DsnModel,
} from '../src/protocol.ts'

function model(overrides: Partial<DsnModel> = {}): DsnModel {
  return {
    id: 'model',
    ownedBy: 'cqai',
    categories: ['other'],
    supportedEndpointTypes: [],
    ...overrides,
  }
}

describe('model capability predicates', () => {
  it('uses architecture before contradictory legacy categories', () => {
    const vision = model({
      categories: ['image'],
      supportedEndpointTypes: ['openai', 'image-generation'],
      architecture: {
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
      },
    })

    expect(isChatModel(vision)).toBe(true)
    expect(isVisionChatModel(vision)).toBe(true)
    expect(isImageGenerationModel(vision)).toBe(false)
    expect(isModelInCategory(vision, 'text-multimodal')).toBe(true)
  })

  it('recognizes output and audio modalities with their required endpoints', () => {
    const image = model({
      supportedEndpointTypes: ['image-generation'],
      architecture: { inputModalities: ['text'], outputModalities: ['image'] },
    })
    const video = model({
      supportedEndpointTypes: ['openai-video'],
      architecture: { inputModalities: ['text'], outputModalities: ['video'] },
    })
    const audio = model({
      architecture: { inputModalities: ['text'], outputModalities: ['speech'] },
    })

    expect(isImageGenerationModel(image)).toBe(true)
    expect(isVideoModel(video)).toBe(true)
    expect(isAudioModel(audio)).toBe(true)
  })

  it('falls back to one legacy category only when architecture is absent', () => {
    const legacyVision = model({
      categories: ['text-multimodal'],
      supportedEndpointTypes: ['openai'],
    })

    expect(isChatModel(legacyVision)).toBe(true)
    expect(isVisionChatModel(legacyVision)).toBe(true)
    expect(isModelInCategory(legacyVision, 'text-multimodal')).toBe(true)
  })
})
