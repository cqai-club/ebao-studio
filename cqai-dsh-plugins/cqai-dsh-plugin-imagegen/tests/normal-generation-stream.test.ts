import { describe, expect, it } from 'vitest'

import type { GenerateRequest, GenerationTask, HistoryEntry } from '../src/protocol.ts'
import {
  buildNormalGenerationStream,
  isNormalGeneration,
} from '../src/client/normal-generation-stream.ts'

const ALL_FILTERS = { query: '', model: 'all', ratio: 'all' }

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    mode: 'text',
    model: 'gpt-image-2',
    prompt: 'ordinary prompt',
    size: '1:1',
    quality: 'auto',
    n: 1,
    detail: '',
    ...overrides,
  }
}

function task(
  id: string,
  status: GenerationTask['status'],
  createdAt: number,
  overrides: Partial<GenerationTask> = {},
): GenerationTask {
  return {
    id,
    request: request(),
    status,
    createdAt,
    ...overrides,
  }
}

function historyEntry(id: string, createdAt: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    createdAt,
    mode: 'text',
    model: 'gpt-image-2',
    prompt: 'ordinary prompt',
    size: '1:1',
    quality: 'auto',
    detail: '',
    n: 1,
    images: [],
    ...overrides,
  }
}

describe('normal generation stream', () => {
  it('keeps legacy unmarked history ordinary and excludes canvas, ecommerce, and defensive project metadata', () => {
    const entries = [
      historyEntry('legacy-normal', 50),
      historyEntry('canvas', 40, { canvas: { canvasId: 'canvas-1' } }),
      historyEntry('ecommerce', 30, { workflow: 'ecommerce', projectId: 'product-1' }),
      historyEntry('orphan-project', 20, { projectId: 'legacy-product' }),
      historyEntry('orphan-slot', 10, { slotKey: 'main-1' }),
    ]

    expect(isNormalGeneration({})).toBe(true)
    expect(buildNormalGenerationStream(entries, [], ALL_FILTERS).map(item => item.key)).toEqual([
      'history:legacy-normal',
    ])
  })

  it('keeps actionable tasks and completed fallbacks, but suppresses completed tasks already represented by history', () => {
    const persisted = historyEntry('persisted-result', 5)
    const tasks = [
      task('queued', 'queued', 60),
      task('running', 'running', 50),
      task('failed', 'failed', 40, { error: 'upstream failed' }),
      task('cancelled', 'cancelled', 30),
      task('completed-fallback', 'completed', 20, {
        result: { images: [{ b64: 'fallback', mime: 'image/png' }] },
      }),
      task('completed-persisted', 'completed', 10, {
        result: { images: [{ b64: 'durable', mime: 'image/png' }], history: [persisted] },
      }),
    ]

    const stream = buildNormalGenerationStream([], tasks, ALL_FILTERS)

    expect(stream.map(item => item.key)).toEqual([
      'task:queued',
      'task:running',
      'task:failed',
      'task:cancelled',
      'task:completed-fallback',
    ])
    expect(stream.every(item => item.kind === 'task')).toBe(true)
  })

  it('applies query, model, and normalized legacy-ratio filters before sorting newest first', () => {
    const entries = [
      historyEntry('legacy-ratio-match', 100, {
        prompt: 'Hero poster from history',
        size: '1536x1024',
      }),
      historyEntry('wrong-query', 500, {
        prompt: 'Quiet landscape',
        size: '3:2',
      }),
      historyEntry('wrong-model', 400, {
        model: 'seedream',
        prompt: 'Hero poster in another model',
        size: '3:2',
      }),
    ]
    const tasks = [
      task('current-ratio-match', 'running', 300, {
        request: request({ prompt: 'HERO campaign draft', size: '3:2' }),
      }),
      task('wrong-ratio', 'queued', 600, {
        request: request({ prompt: 'Hero square', size: '1024x1024' }),
      }),
    ]

    const stream = buildNormalGenerationStream(entries, tasks, {
      query: ' hero ',
      model: 'gpt-image-2',
      ratio: '3:2',
    })

    expect(stream.map(item => item.key)).toEqual([
      'task:current-ratio-match',
      'history:legacy-ratio-match',
    ])
    expect(stream.map(item => item.createdAt)).toEqual([300, 100])
  })
})
