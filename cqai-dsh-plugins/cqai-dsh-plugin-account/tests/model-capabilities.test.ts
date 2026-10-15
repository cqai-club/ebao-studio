import { describe, expect, it } from 'vitest'

import {
  isAudioModel,
  isChatModel,
  isEmbeddingModel,
  isImageGenerationModel,
  isModelInCategory,
  isRerankModel,
  isVideoCatalogEntry,
  isVideoModel,
  isVisionChatModel,
  modelCatalogCategories,
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

  it('recognizes Wan video aliases when the catalog omits output modalities', () => {
    const wan = model({
      id: 'wan3.0-video-480p',
      categories: ['other'],
      supportedEndpointTypes: ['openai-video'],
      architecture: { inputModalities: ['text'], outputModalities: [] },
    })

    expect(isVideoModel(wan)).toBe(true)
    expect(isVideoCatalogEntry(wan)).toBe(true)
    expect(isModelInCategory(wan, 'video')).toBe(true)
    expect(isVideoCatalogEntry({ ...wan, supportedEndpointTypes: [] })).toBe(true)
    expect(isVideoModel({ ...wan, supportedEndpointTypes: [] })).toBe(false)
    expect(isVideoModel({ ...wan, architecture: { inputModalities: ['text'], outputModalities: ['text'] } })).toBe(false)
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

  it('uses specialized endpoints before misleading text or image modalities', () => {
    const embedding = model({
      categories: ['text-multimodal', 'other'],
      supportedEndpointTypes: ['embeddings'],
      architecture: { inputModalities: ['text', 'image'], outputModalities: ['text'] },
    })
    const rerank = model({
      categories: ['text', 'other'],
      supportedEndpointTypes: ['jina-rerank'],
      architecture: { inputModalities: ['text'], outputModalities: ['text'] },
    })

    expect(isEmbeddingModel(embedding)).toBe(true)
    expect(isModelInCategory(embedding, 'embedding')).toBe(true)
    expect(isChatModel(embedding)).toBe(false)
    expect(isModelInCategory(embedding, 'other')).toBe(false)
    expect(modelCatalogCategories(embedding)).toEqual(['embedding'])
    expect(isRerankModel(rerank)).toBe(true)
    expect(isEmbeddingModel(rerank)).toBe(false)
    expect(isModelInCategory(rerank, 'other')).toBe(false)
    expect(modelCatalogCategories(rerank)).toEqual(['rerank'])
  })

  it('preserves declared chat and embedding capabilities on the same model', () => {
    const shared = model({
      supportedEndpointTypes: ['openai', 'embeddings', 'jina-rerank'],
      architecture: { inputModalities: ['text', 'image'], outputModalities: ['text'] },
    })

    expect(isChatModel(shared)).toBe(true)
    expect(isEmbeddingModel(shared)).toBe(true)
    expect(isRerankModel(shared)).toBe(true)
    expect(modelCatalogCategories(shared)).toEqual(['text-multimodal', 'embedding', 'rerank'])
  })

  it('keeps known catalog identities without inventing callable endpoints', () => {
    const embedding = model({
      architecture: { inputModalities: ['text'], outputModalities: ['embeddings'] },
    })
    const legacy = model({ categories: ['other', 'embedding', 'audio'] })
    const video = model({
      architecture: { inputModalities: ['text'], outputModalities: ['video'] },
    })

    expect(modelCatalogCategories(embedding)).toEqual(['embedding'])
    expect(isEmbeddingModel(embedding)).toBe(false)
    expect(modelCatalogCategories(legacy)).toEqual(['audio', 'embedding'])
    expect(isEmbeddingModel(legacy)).toBe(false)
    expect(modelCatalogCategories(video)).toEqual(['video'])
    expect(isVideoModel(video)).toBe(false)
    expect(modelCatalogCategories(model())).toEqual(['other'])
  })

  it('derives audio and video catalog labels from structured modalities', () => {
    const omni = model({
      categories: ['other'],
      supportedEndpointTypes: ['openai'],
      architecture: { inputModalities: ['text', 'audio'], outputModalities: ['text', 'audio'] },
    })
    const vision = model({
      categories: ['image', 'video'],
      supportedEndpointTypes: ['openai'],
      architecture: { inputModalities: ['text', 'image'], outputModalities: ['text'] },
    })

    expect(modelCatalogCategories(omni)).toEqual(['text-multimodal', 'audio'])
    expect(modelCatalogCategories(model({
      architecture: { inputModalities: ['audio'], outputModalities: ['text'] },
    }))).toEqual(['audio'])
    expect(modelCatalogCategories(vision)).toEqual(['text-multimodal'])
    expect(modelCatalogCategories(model({
      id: 'wan3.0-video-720p',
      architecture: { inputModalities: ['text'], outputModalities: [] },
    }))).toEqual(['video'])
  })

  it.each(['audio', 'speech', 'transcription'])('recognizes %s input and output audio metadata', modality => {
    expect(isAudioModel(model({
      architecture: { inputModalities: [modality], outputModalities: ['text'] },
    }))).toBe(true)
    expect(isAudioModel(model({
      architecture: { inputModalities: ['text'], outputModalities: [modality] },
    }))).toBe(true)
  })
})
