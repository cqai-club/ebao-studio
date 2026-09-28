/** One model menu over every configured image route. The provider id stays internal. */
import type { ChannelConfig, CqaiImageProviderView } from '../protocol.ts'
import { describeModel } from '../model-catalog.ts'

export interface ImageModelGroup {
  readonly providerId: string
  readonly name: string
  readonly models: readonly string[]
}

export function imageModelGroups(
  cqai: CqaiImageProviderView,
  channels: readonly ChannelConfig[],
  editing: boolean,
): ImageModelGroup[] {
  const eligible = (models: readonly string[]) => editing
    ? models.filter(model => describeModel(model).supportsEdit)
    : [...models]
  const cqaiModels = eligible([
    ...(cqai.defaultModel === undefined ? [] : [cqai.defaultModel]),
    ...cqai.models.map(model => model.alias).filter(model => model !== cqai.defaultModel),
  ])
  const groups: ImageModelGroup[] = cqaiModels.length === 0
    ? []
    : [{ providerId: 'cqai', name: 'CQAI Club', models: cqaiModels }]
  for (const channel of channels) {
    const models = eligible(channel.models.map(model => model.alias))
    if (models.length > 0) groups.push({ providerId: channel.id, name: channel.name || channel.id, models })
  }
  return groups
}

/** Distinguish equal model aliases on different routes without exposing a Provider step. */
export function imageModelChoiceKey(providerId: string, model: string): string {
  return JSON.stringify([providerId, model])
}
