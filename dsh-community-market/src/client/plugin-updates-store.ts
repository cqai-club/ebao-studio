import type { MarketOperationPreviewResponse, MarketPluginUpdate, MarketUpdatesResponse } from '../api-types.js'
import { executeMarketOperation, readMarketUpdates } from './api.js'

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
export const UPDATE_STARTUP_RETRY_MS = 30 * 1000
export const UPDATE_RESTART_TOKEN_TTL_MS = 5 * 60 * 1000

export interface CompletedPluginUpdate {
  readonly packageName: string
  readonly version: string
  readonly restartToken: string
  readonly completedAt: number
}

export interface PluginUpdatesSnapshot {
  readonly updates: readonly MarketPluginUpdate[]
  readonly checkedAt?: string
  readonly checking: boolean
  readonly checkFailed: boolean
  readonly noticeVisible: boolean
  readonly openRevision: number
  readonly requestedUpdatesView: boolean
  readonly operationPending: boolean
  readonly progress?: { readonly done: number; readonly total: number; readonly packageName: string } | undefined
  readonly completed: readonly CompletedPluginUpdate[]
  readonly operationFailure?: { readonly packageName: string; readonly message: string; readonly notStarted: readonly string[] } | undefined
}

interface UpdateStoreDependencies {
  readonly read?: (signal: AbortSignal, force: boolean) => Promise<MarketUpdatesResponse>
  readonly execute?: typeof executeMarketOperation
}

function initialSnapshot(): PluginUpdatesSnapshot {
  return {
    updates: [], checking: false, checkFailed: false, noticeVisible: false,
    openRevision: 0, requestedUpdatesView: false, operationPending: false, completed: [],
  }
}

/** Shared by the startup notice and every Market surface; checks never install code. */
export function createPluginUpdatesStore(dependencies: UpdateStoreDependencies = {}) {
  const read = dependencies.read ?? readMarketUpdates
  const execute = dependencies.execute ?? executeMarketOperation
  const listeners = new Set<() => void>()
  let snapshot = initialSnapshot()
  let dismissedKey: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let startupRetry: ReturnType<typeof setTimeout> | undefined
  let startupRetries = 0
  let checkController: AbortController | undefined
  let operationController: AbortController | undefined
  let pendingCheck: Promise<void> | undefined
  let disposed = false

  const publish = (patch: Partial<PluginUpdatesSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const updateKey = (updates: readonly MarketPluginUpdate[]) => updates
    .filter(update => update.updateAvailable && update.latestVersion !== undefined && update.error === undefined)
    .map(update => `${update.packageName}@${update.latestVersion}`)
    .sort().join('\n')

  const check = (force = false): Promise<void> => {
    if (disposed || snapshot.operationPending) return Promise.resolve()
    if (pendingCheck !== undefined) return pendingCheck
    const controller = new AbortController()
    checkController = controller
    publish({ checking: true, checkFailed: false })
    pendingCheck = (async () => {
      try {
        await Promise.resolve()
        if (disposed || controller.signal.aborted) return
        const response = await read(controller.signal, force)
        if (disposed || controller.signal.aborted || checkController !== controller) return
        const key = updateKey(response.updates)
        if (startupRetry !== undefined) clearTimeout(startupRetry)
        startupRetry = undefined
        publish({
          updates: response.updates,
          checkedAt: response.checkedAt,
          checkFailed: false,
          noticeVisible: key.length > 0 && key !== dismissedKey,
        })
      } catch {
        if (!disposed && !controller.signal.aborted && checkController === controller) {
          publish({ checkFailed: true, noticeVisible: false })
          // The Host may still be becoming available when the client starts.
          // Retry that initial failure briefly, then return to the normal cadence.
          if (snapshot.checkedAt === undefined && timer !== undefined && startupRetries < 2 && startupRetry === undefined) {
            const delay = UPDATE_STARTUP_RETRY_MS * ++startupRetries
            startupRetry = setTimeout(() => { startupRetry = undefined; void check() }, delay)
          }
        }
      } finally {
        if (checkController === controller) {
          checkController = undefined
          pendingCheck = undefined
          publish({ checking: false })
        }
      }
    })()
    return pendingCheck
  }

  /** Continue a reviewed batch in order, keeping successful changes if a later item fails. */
  const executeReviewed = async (previews: readonly MarketOperationPreviewResponse[]): Promise<void> => {
    if (disposed || snapshot.operationPending || previews.length === 0) return
    // Review requests must identify an exact update, never an install/uninstall token.
    if (previews.some(preview => preview.action !== 'update' || preview.version === undefined || preview.currentVersion === undefined)) return
    checkController?.abort()
    checkController = undefined
    pendingCheck = undefined
    const controller = new AbortController()
    operationController = controller
    publish({ operationPending: true, operationFailure: undefined, checking: false })
    try {
      for (const [index, preview] of previews.entries()) {
        if (disposed || controller.signal.aborted) break
        publish({ progress: { done: index, total: previews.length, packageName: preview.packageName } })
        try {
          const result = await execute(preview.previewId, controller.signal)
          if (disposed || controller.signal.aborted) break
          if (result.action !== 'update' || result.packageName !== preview.packageName || result.version !== preview.version) {
            throw new Error('The update result could not be verified.')
          }
          const completed = [...snapshot.completed.filter(item => item.packageName !== result.packageName), {
            packageName: result.packageName, version: result.version, restartToken: result.restartToken, completedAt: Date.now(),
          }]
          const updates = snapshot.updates.map(update => update.packageName === result.packageName
            ? { ...update, currentVersion: result.version, updateAvailable: false }
            : update)
          publish({ completed, updates, noticeVisible: updateKey(updates).length > 0 && updateKey(updates) !== dismissedKey })
        } catch (cause) {
          if (!disposed && !controller.signal.aborted) {
            publish({ operationFailure: {
              packageName: preview.packageName,
              message: cause instanceof Error ? cause.message : String(cause),
              notStarted: previews.slice(index + 1).map(item => item.packageName),
            } })
          }
          break
        }
      }
    } finally {
      if (operationController === controller) {
        operationController = undefined
        publish({ operationPending: false, progress: undefined })
        if (!disposed) await check(true)
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    check,
    executeReviewed,
    dismiss: () => {
      dismissedKey = updateKey(snapshot.updates)
      publish({ noticeVisible: false })
    },
    requestOpen: () => publish({ requestedUpdatesView: true, openRevision: snapshot.openRevision + 1 }),
    clearOpenRequest: () => publish({ requestedUpdatesView: false }),
    start: () => {
      disposed = false
      if (timer !== undefined) return
      void check()
      timer = setInterval(() => { void check() }, UPDATE_CHECK_INTERVAL_MS)
    },
    dispose: () => {
      disposed = true
      if (timer !== undefined) clearInterval(timer)
      if (startupRetry !== undefined) clearTimeout(startupRetry)
      timer = undefined
      startupRetry = undefined
      startupRetries = 0
      checkController?.abort()
      operationController?.abort()
      checkController = undefined
      operationController = undefined
      pendingCheck = undefined
      dismissedKey = undefined
      snapshot = initialSnapshot()
      publish({})
    },
  }
}

export type PluginUpdatesStore = ReturnType<typeof createPluginUpdatesStore>
export const pluginUpdatesStore = createPluginUpdatesStore()
