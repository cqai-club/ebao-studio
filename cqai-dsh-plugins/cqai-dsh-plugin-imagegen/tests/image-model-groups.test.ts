import { describe, expect, it } from 'vitest'
import type { ChannelConfig, CqaiImageProviderView } from '../src/protocol.ts'
import { imageModelChoiceKey, imageModelGroups } from '../src/client/image-model-groups.ts'

const cqai: CqaiImageProviderView = {
  provider: 'cqai', immutable: true, state: 'signed-in',
  defaultModel: 'gpt-image-2',
  models: [
    { alias: 'glm-image', id: 'glm-image' },
    { alias: 'gpt-image-2', id: 'gpt-image-2' },
  ],
}
const channels: ChannelConfig[] = [{
  id: 'custom:images', preset: '', name: 'Other images', apiUrl: 'https://example.test/v1',
  models: [{ alias: 'gpt-image-2', id: 'gpt-image-2' }, { alias: 'grok-imagine-image', id: 'grok-imagine-image' }],
}]

describe('direct image model menu', () => {
  it('lists account and custom models in one grouped menu while keeping duplicate aliases route-specific', () => {
    expect(imageModelGroups(cqai, channels, false)).toEqual([
      { providerId: 'cqai', name: 'CQAI Club', models: ['gpt-image-2', 'glm-image'] },
      { providerId: 'custom:images', name: 'Other images', models: ['gpt-image-2', 'grok-imagine-image'] },
    ])
    expect(imageModelChoiceKey('cqai', 'gpt-image-2'))
      .not.toBe(imageModelChoiceKey('custom:images', 'gpt-image-2'))
  })

  it('omits models without editing support from every route', () => {
    expect(imageModelGroups(cqai, channels, true)[0]?.models).toEqual(['gpt-image-2'])
  })
})
