/** Prevent the upstream and CQAI ImageGen runtimes from sharing one data root. */

import type { Context } from '@deepseek-ai/cordis'

export const IMAGEGEN_RUNTIME_NAME = 'imagegen'
export const IMAGEGEN_MOUNT_CONFLICT_MESSAGE = '检测到旧 @dickpy/dsh-imagegen 或另一个 ImageGen 实例；为保护 ~/.dsh/dsh-imagegen，两个插件不能同时挂载。'

function liveImagegenFibers(ctx: Context): number {
  const registry = (ctx as Context & { registry?: Context['registry'] }).registry
  if (registry === undefined || typeof registry.values !== 'function') return 1
  let count = 0
  for (const runtime of registry.values()) {
    if (runtime.name !== IMAGEGEN_RUNTIME_NAME) continue
    for (const fiber of runtime.fibers) {
      if (fiber.uid !== null) count += 1
    }
  }
  return count
}

/**
 * Fail before account setup, migration, routes or writers can start, then keep
 * a publication veto installed so a legacy plugin loaded later cannot race us.
 */
export function installImagegenMountGuard(ctx: Context): () => void {
  if (liveImagegenFibers(ctx) > 1) throw new Error(IMAGEGEN_MOUNT_CONFLICT_MESSAGE)
  const currentFiber = (ctx as Context & { fiber?: Context['fiber'] }).fiber
  if (currentFiber === undefined || typeof ctx.on !== 'function') return () => undefined
  return ctx.on('internal/plugin', (fiber) => {
    // Anonymous injected children inherit the parent's display name, so use
    // the child's own runtime name rather than `fiber.name`.
    if (fiber !== currentFiber && fiber.runtime?.name === IMAGEGEN_RUNTIME_NAME) {
      throw new Error(IMAGEGEN_MOUNT_CONFLICT_MESSAGE)
    }
  }, { global: true })
}
