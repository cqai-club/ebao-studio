import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobStore } from '../src/jobs.ts'
import { InferFlowJobs, type Bridge } from '../src/inferflow-jobs.ts'

const roots: string[] = []
afterEach(() => {vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})
function fixture(createError = false) {
  const root = mkdtempSync(join(tmpdir(), 'inferflow-test-')); roots.push(root)
  const store = new JobStore(root, root)
  const job = store.create({title: 'test', text: '这是一条用于测试的口播文案。', duration: 10, mode: 'digitalhuman', optimize: false, covers: false, studio: false})
  job.uploads = {avatar: {file: 'avatar.png', name: 'avatar.png'}, voice: {file: 'voice.wav', name: 'voice.wav'}}
  writeFileSync(join(store.dir(job.id), 'script.txt'), job.options.text)
  vi.spyOn(store, 'prepare').mockResolvedValue(job)
  const call = vi.fn<Bridge>(async (_key, op) => {
    if (op === 'quote') return {estimated_credits: 130}
    if (op === 'create') {if (createError) throw new Error('network lost'); return {run_id: 'run-test'}}
    if (op === 'status') return {status: 'completed'}
    if (op === 'outputs') return {items: [{type: 'file', name: 'video', download_url: 'https://storage.example/video.mp4?signature=test'}]}
    return {}
  })
  return {store, job, call, service: new InferFlowJobs(store, call)}
}
it('requires personal credentials and never writes the key into job storage', async () => {
  const {service, store, job} = fixture()
  await expect(service.quote(job.id)).rejects.toThrow('连接')
  await service.connect({key: 'test-secret-personal'})
  await service.quote(job.id)
  expect(job.cloud?.provider).toBe('inferflow')
  expect(readFileSync(join(store.dir(job.id), 'job.json'), 'utf8')).not.toContain('test-secret-personal')
  service.disconnect()
  expect(service.settings()).toEqual({connected: false})
})
it('persists an ambiguous submission and refuses to create a second billable run', async () => {
  const {service, store, job, call} = fixture(true)
  await service.connect({key: 'test-secret-personal'}); await service.quote(job.id)
  await expect(service.generate(job, new AbortController().signal)).rejects.toThrow('network lost')
  const restored = new JobStore(store.root, store.runtime).get(job.id)
  await expect(service.generate(restored, new AbortController().signal)).rejects.toThrow('结果未知')
  expect(call.mock.calls.filter(v => v[1] === 'create')).toHaveLength(1)
})
it('resumes an existing run and never sends the key to object storage', async () => {
  const {service, job, call, store} = fixture()
  await service.connect({key: 'test-secret-personal'}); await service.quote(job.id)
  job.cloud!.runId = 'previous-run'; job.cloud!.submissionStarted = true
  const fetchMock = vi.fn(async () => new Response('video bytes'))
  vi.stubGlobal('fetch', fetchMock)
  await service.generate(job, new AbortController().signal)
  expect(call.mock.calls.some(v => v[1] === 'create')).toBe(false)
  expect(fetchMock.mock.calls[0]).not.toContain('test-secret-personal')
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('test-secret-personal')
  expect(readFileSync(join(store.dir(job.id), 'digital_human/video.mp4'), 'utf8')).toBe('video bytes')
})
it('blocks cross-account resume before any cloud submission', async () => {
  const {service, job, call} = fixture()
  await service.connect({key: 'first-secret-personal'}); await service.quote(job.id)
  await service.connect({key: 'second-secret-personal'})
  await expect(service.generate(job, new AbortController().signal)).rejects.toThrow('API Key')
  expect(call.mock.calls.some(v => v[1] === 'create')).toBe(false)
})
