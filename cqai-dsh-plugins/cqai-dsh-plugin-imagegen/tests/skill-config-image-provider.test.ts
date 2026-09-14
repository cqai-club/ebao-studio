import { describe, expect, it } from 'vitest'
import { configView, parseSkillConfigManifest, type SkillConfigDeclaration } from '../src/skill-config.ts'
import { recipeFor } from '../src/skill-config-recipes.ts'
import { EDITABLE_PPT_SKILL } from '../src/skills-catalog.ts'

describe('skill image provider declarations', () => {
  it('accepts only an explicit OpenAI Images v1 declaration', () => {
    const compatible = parseSkillConfigManifest({
      version: 1,
      fields: [{ id: 'image-model', type: 'string' }],
      imageProvider: { protocol: 'openai-images-v1', modelField: 'image-model' },
    })
    expect(compatible.issue).toBeUndefined()
    expect(compatible.manifest?.imageProvider).toEqual({
      protocol: 'openai-images-v1',
      modelField: 'image-model',
    })
    const declaration = { manifest: compatible.manifest!, source: 'skill' } satisfies SkillConfigDeclaration
    expect(configView(declaration, new Map())?.imageProvider).toEqual({
      protocol: 'openai-images-v1',
      modelField: 'image-model',
    })

    expect(parseSkillConfigManifest({
      version: 1,
      imageProvider: { protocol: 'openai-compatible' },
    })).toEqual({ issue: 'empty' })
  })

  it('refuses a secret or undeclared model selector without enabling the bridge', () => {
    const secretModel = parseSkillConfigManifest({
      version: 1,
      fields: [{ id: 'model-secret', type: 'secret' }],
      imageProvider: { protocol: 'openai-images-v1', modelField: 'model-secret' },
    })
    expect(secretModel.manifest?.fields).toHaveLength(1)
    expect(secretModel.manifest?.imageProvider).toBeUndefined()

    const missingModel = parseSkillConfigManifest({
      version: 1,
      fields: [{ id: 'other', type: 'string' }],
      imageProvider: { protocol: 'openai-images-v1', modelField: 'image-model' },
    })
    expect(missingModel.manifest?.imageProvider).toBeUndefined()
  })

  it('marks the editable-PPT recipe compatible without persisting an image key', () => {
    const recipe = recipeFor(EDITABLE_PPT_SKILL)
    expect(recipe?.manifest.imageProvider).toEqual({ protocol: 'openai-images-v1' })
    expect(recipe?.manifest.fields.map(field => field.id)).toEqual(['paddle-ocr-token'])
    expect(recipe?.manifest.fields.some(field => field.id.includes('image-api-key'))).toBe(false)
  })
})
