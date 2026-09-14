import type { GenerateRequest, GenerationTask, HistoryEntry } from '../protocol.ts'

/** Metadata shared by requests and persisted history for workspace routing. */
type GenerationOrigin = Pick<GenerateRequest, 'canvas' | 'workflow' | 'projectId' | 'slotKey'>

export interface NormalGenerationFilters {
  query: string
  model: string
  ratio: string
}

export type NormalGenerationStreamItem =
  | { kind: 'task'; key: string; createdAt: number; task: GenerationTask }
  | { kind: 'history'; key: string; createdAt: number; entry: HistoryEntry }

const LEGACY_SIZE_TO_RATIO: Record<string, string> = {
  '512x512': '1:1',
  '1024x1024': '1:1',
  '1536x1024': '3:2',
  '1024x1536': '2:3',
  '1792x1024': '16:9',
  '1024x1792': '9:16',
}

const CURRENT_RATIOS = new Set(['auto', '1:1', '3:4', '4:3', '9:16', '2:3', '3:2', '16:9', '21:9'])

export function normalizeSize(value: string): string {
  return CURRENT_RATIOS.has(value) ? value : LEGACY_SIZE_TO_RATIO[value] ?? 'auto'
}

/**
 * Ordinary image generation is the untagged workspace. Canvas and ecommerce
 * requests already carry durable origin metadata, while legacy untagged rows
 * naturally remain ordinary history.
 */
export function isNormalGeneration(origin: GenerationOrigin): boolean {
  return origin.canvas === undefined
    && origin.workflow !== 'ecommerce'
    && origin.projectId === undefined
    && origin.slotKey === undefined
}

function matchesFilters(
  value: Pick<GenerateRequest, 'prompt' | 'model' | 'size'>,
  filters: NormalGenerationFilters,
): boolean {
  const query = filters.query.trim().toLocaleLowerCase()
  return (query === '' || `${value.prompt} ${value.model}`.toLocaleLowerCase().includes(query))
    && (filters.model === 'all' || value.model === filters.model)
    && (filters.ratio === 'all' || normalizeSize(value.size) === filters.ratio)
}

/**
 * Merge live ordinary tasks with persisted ordinary history. A completed task
 * whose result already contains the updated history is represented by that
 * durable row only; completed results without history stay visible as a
 * session fallback so a persistence failure never hides a generated image.
 */
export function buildNormalGenerationStream(
  history: HistoryEntry[],
  tasks: GenerationTask[],
  filters: NormalGenerationFilters,
): NormalGenerationStreamItem[] {
  const historyItems: NormalGenerationStreamItem[] = history
    .filter(isNormalGeneration)
    .filter(entry => matchesFilters(entry, filters))
    .map(entry => ({ kind: 'history', key: `history:${entry.id}`, createdAt: entry.createdAt, entry }))

  const taskItems: NormalGenerationStreamItem[] = tasks
    .filter(task => isNormalGeneration(task.request))
    .filter(task => task.status !== 'completed' || task.result?.history === undefined)
    .filter(task => matchesFilters(task.request, filters))
    .map(task => ({ kind: 'task', key: `task:${task.id}`, createdAt: task.createdAt, task }))

  return [...taskItems, ...historyItems].sort((a, b) => b.createdAt - a.createdAt)
}
