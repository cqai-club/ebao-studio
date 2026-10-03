import type { GenerationTask, GenerationTaskSummary } from '../protocol.ts'

export interface TaskPollingState {
  startedAt: number
  initialized: boolean
  seenIds: Set<string>
  observedIds: Set<string>
}

export function createTaskPollingState(startedAt = Date.now()): TaskPollingState {
  return { startedAt, initialized: false, seenIds: new Set(), observedIds: new Set() }
}

/** Hydrate completed tasks once; an old completed queue never downloads on open. */
export async function mergeTaskSummaries(
  summaries: readonly GenerationTaskSummary[],
  previous: readonly GenerationTask[],
  getTask: (id: string) => Promise<GenerationTask>,
  state: TaskPollingState,
): Promise<{ tasks: GenerationTask[]; newlyCompleted: GenerationTask[] }> {
  const byId = new Map(previous.map(task => [task.id, task]))
  for (const summary of summaries) {
    if (summary.status === 'queued' || summary.status === 'running'
      || byId.has(summary.id) && !state.seenIds.has(summary.id)
      || summary.createdAt >= state.startedAt
      || state.initialized && !state.seenIds.has(summary.id)) state.observedIds.add(summary.id)
    state.seenIds.add(summary.id)
  }
  state.initialized = true
  const newlyCompleted: GenerationTask[] = []
  const tasks = await Promise.all(summaries.map(async (summary): Promise<GenerationTask> => {
    const current = byId.get(summary.id)
    const { resultAvailable, ...metadata } = summary
    const task: GenerationTask = {
      ...metadata,
      request: { ...current?.request, ...summary.request },
      ...(current?.result === undefined ? {} : { result: current.result }),
    }
    if (summary.status !== 'completed' || !resultAvailable || task.result !== undefined || !state.observedIds.has(summary.id)) return task
    try {
      const detailed = await getTask(summary.id)
      if (detailed.status === 'completed' && detailed.result !== undefined) {
        newlyCompleted.push(detailed)
        return detailed
      }
      if (detailed.status !== 'completed') return detailed
    } catch { /* Leave it eligible for the next poll when a detail request fails. */ }
    // Consumers must not treat a successful task as terminal before its result
    // is available. Keep the pending state until a later detail request works.
    return { ...task, status: current?.status === 'queued' ? 'queued' : 'running' }
  }))
  // Keep newest-first order regardless of detail-response completion order.
  return { tasks, newlyCompleted: tasks.filter(task => newlyCompleted.some(item => item.id === task.id)) }
}
