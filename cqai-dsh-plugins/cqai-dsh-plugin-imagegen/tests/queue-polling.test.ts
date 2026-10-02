import { describe, expect, it, vi } from 'vitest'
import { GenerationTaskQueue } from '../src/task-queue.ts'
import { createTaskPollingState, mergeTaskSummaries } from '../src/client/generation-task-poll.ts'
import type { GenerateRequest, GenerateResult, GenerationTask, GenerationTaskSummary } from '../src/protocol.ts'

const request: GenerateRequest = { mode: 'edit', model: 'test-image', prompt: 'product', size: '1:1', quality: 'auto', detail: '', n: 1, image: 'large-reference', images: ['another-reference'] }
const result: GenerateResult = { images: [{ b64: 'large-generated-image', mime: 'image/png' }] }
const task = (id: string, status: GenerationTask['status'], createdAt = 1): GenerationTask => ({ id, status, createdAt, request, ...(status === 'completed' ? { result } : {}) })
const summary = (item: GenerationTask): GenerationTaskSummary => {
  const { result, request, ...metadata } = item
  const { image: _image, images: _images, ...smallRequest } = request
  return { ...metadata, request: smallRequest, resultAvailable: result !== undefined }
}

describe('lightweight generation queue', () => {
  it('keeps active tasks and caps terminal entries without sending image payloads', async () => {
    let finish!: (value: GenerateResult) => void
    const queue = new GenerationTaskQueue(input => input.prompt === 'wait'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve(result), 120)
    const active = queue.submit({ ...request, prompt: 'wait' })
    const done = Array.from({ length: 105 }, () => queue.submit(request))
    await vi.waitFor(() => expect(queue.get(done[0]!.id)?.status).toBe('completed'))
    const summaries = queue.summaries()
    expect(summaries).toHaveLength(101)
    expect(summaries.some(item => item.id === active.id && item.status === 'running')).toBe(true)
    expect(JSON.stringify(summaries)).not.toMatch(/large-reference|another-reference|large-generated-image/)
    expect(summaries.filter(item => item.resultAvailable)).toHaveLength(100)
    expect(queue.summaries(0).map(item => item.id)).toEqual([active.id])
    expect(queue.get(done[0]!.id)?.result).toEqual(result)
    expect(queue.get(done[0]!.id)?.request.image).toBe('large-reference')
    expect(queue.get('missing')).toBeUndefined()
    finish(result)
    await vi.waitFor(() => expect(queue.get(active.id)?.status).toBe('completed'))
    expect(queue.summaries().some(item => item.id === active.id && item.resultAvailable)).toBe(true)
  })
})

describe('client task result hydration', () => {
  it('does not download old completed tasks when opening the studio', async () => {
    const get = vi.fn()
    const state = createTaskPollingState(100)
    let previous: GenerationTask[] = []
    for (let poll = 0; poll < 3; poll++) {
      previous = (await mergeTaskSummaries([summary(task('old', 'completed'))], previous, get, state)).tasks
    }
    expect(get).not.toHaveBeenCalled()
    expect(previous[0]?.status).toBe('completed')
  })

  it('fetches observed completed results once and preserves them on later polls', async () => {
    const get = vi.fn(async () => task('current', 'completed'))
    const state = createTaskPollingState(100)
    const running = await mergeTaskSummaries([summary(task('current', 'running'))], [], get, state)
    const completed = await mergeTaskSummaries([summary(task('current', 'completed'))], running.tasks, get, state)
    const again = await mergeTaskSummaries([summary(task('current', 'completed'))], completed.tasks, get, state)
    expect(get).toHaveBeenCalledExactlyOnceWith('current')
    expect(completed.newlyCompleted.map(item => item.id)).toEqual(['current'])
    expect(again.newlyCompleted).toEqual([])
    expect(again.tasks[0]?.result).toEqual(result)
  })

  it('retries failed detail requests and handles fast tasks submitted between polls', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(task('fast', 'completed', 200))
    const state = createTaskPollingState(100)
    const first = await mergeTaskSummaries([summary(task('fast', 'completed', 200))], [], get, state)
    expect(first.newlyCompleted).toEqual([])
    expect(first.tasks[0]?.status).toBe('running')
    const second = await mergeTaskSummaries([summary(task('fast', 'completed', 200))], first.tasks, get, state)
    expect(second.newlyCompleted[0]?.id).toBe('fast')
    expect(second.tasks[0]?.status).toBe('completed')
    const third = await mergeTaskSummaries([summary(task('fast', 'completed', 200))], second.tasks, get, state)
    expect(third.newlyCompleted).toEqual([])
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('observes new task IDs after the first poll even with host clock skew', async () => {
    const state = createTaskPollingState(10_000)
    const get = vi.fn(async () => task('other-device', 'completed'))
    await mergeTaskSummaries([summary(task('old', 'completed'))], [], get, state)
    const updated = await mergeTaskSummaries([summary(task('other-device', 'completed')), summary(task('old', 'completed'))], [], get, state)
    expect(get).toHaveBeenCalledExactlyOnceWith('other-device')
    expect(updated.newlyCompleted[0]?.id).toBe('other-device')
  })
})
