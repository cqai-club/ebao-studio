import { createPreparationPlan } from './prepare-cqai-account.mjs'
import { prepareProductPluginRuntime } from './prepare-ebao-product-plugins.mjs'
import { existingPublisherWorker } from './publisher-worker-paths.mjs'

export async function prepareEbaoDevelopment(runtime) {
  const plan = createPreparationPlan({ environment: {} })
  await prepareProductPluginRuntime(plan, runtime, { development: true })
  const worker = existingPublisherWorker(plan.root, process.platform)
  if (worker !== undefined) process.env.EBAO_PUBLISHER_WORKER = worker
  delete process.env.EBAO_DESKTOP_DEVELOPMENT
}
