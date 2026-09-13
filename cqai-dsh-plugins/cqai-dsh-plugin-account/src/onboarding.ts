import {
  isChatModel,
  type DsnDefaultModelSelection,
  type DsnModel,
} from './protocol.ts'

const UPSTREAM_INITIAL_MODELS = new Set([
  'deepseek-flash',
  'deepseek-v4-flash',
])

const PREFERRED_CQAI_MODELS = [
  'deepseek/deepseek-v4-flash',
  'deepseek-v4-flash',
  'deepseek/deepseek-chat',
  'deepseek-chat',
] as const

/**
 * Whether first-run CQAI onboarding may replace the current product default.
 * Any explicit provider, model, or reasoning choice is preserved.
 */
export function mayAdoptCqaiOnboardingDefault(selection: DsnDefaultModelSelection): boolean {
  return selection.provider === 'deepseek-official'
    && UPSTREAM_INITIAL_MODELS.has(selection.model)
    && selection.reasoningEffort === undefined
}

/** Choose a deterministic CQAI chat model, falling back to catalog order. */
export function preferredCqaiOnboardingModel(models: readonly DsnModel[]): string | undefined {
  const chatModels = models.filter(isChatModel)
  for (const preferred of PREFERRED_CQAI_MODELS) {
    if (chatModels.some(model => model.id === preferred)) return preferred
  }
  return chatModels[0]?.id
}
