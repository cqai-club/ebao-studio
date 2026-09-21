import { it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobStore } from '../src/jobs.ts'
import { ManagedJobs } from '../src/managed-jobs.ts'
import type { AccountRequest } from '../src/managed-video.ts'

it('refuses to resume a legacy personal-account job through the product account', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ejb-managed-'))
  const store = new JobStore(root, root)
  const job = store.create({mode: 'digitalhuman', title: 'legacy', text: '测试', duration: 6, optimize: false, covers: false, studio: false})
  job.cloud = {provider: 'inferflow', credentialId: 'legacy', accountId: 0, submissionStarted: true,
    quote: {id: 'legacy-quote', amount: 10, unit: '积分', expiresAt: new Date(Date.now() + 60000).toISOString()}}
  const managed = new ManagedJobs(store, {getAccount: async () => ({userId: 7}), fetchAi: vi.fn()})
  try {
    await expect(managed.generate(job, new AbortController().signal)).rejects.toThrow('旧版个人 InferFlow 任务')
  } finally {await store.dispose(); rmSync(root, {recursive: true, force: true})}
})

it('resumes a lost submission acknowledgement with the same request key, then downloads once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ejb-managed-'))
  const store = new JobStore(root, root)
  const job = store.create({mode: 'digitalhuman', title: 'test', text: '测试', duration: 6, optimize: false, covers: false, studio: false})
  const dir = store.dir(job.id)
  for (const file of ['avatar.png', 'voice.m4a', 'script.txt']) writeFileSync(join(dir, file), 'fixture')
  job.uploads = {avatar: {file: 'avatar.png', name: 'avatar.png'}, voice: {file: 'voice.m4a', name: 'voice.m4a'}}
  job.cloud = {accountId: 7, quote: {id: 'quote1', amount: 10, unit: '积分', expiresAt: new Date(Date.now() + 60000).toISOString()}}
  let failFirst = true
  const keys: string[] = []
  const request = vi.fn<AccountRequest>(async (path, init) => {
    if (path.endsWith('/runs')) {
      keys.push(new Headers(init?.headers).get('idempotency-key')!)
      if (failFirst) {failFirst = false; throw new Error('lost acknowledgement')}
      return Response.json({id: 'run1', status: 'queued', progress: 0})
    }
    if (path.endsWith('/video')) return new Response('fixture-video', {headers: {'content-type': 'video/mp4'}})
    return Response.json({id: 'run1', status: 'completed', progress: 100})
  })
  const getAccount = vi.fn(async () => ({userId: 7}))
  const managed = new ManagedJobs(store, {getAccount, fetchAi: request})
  try {
    await expect(managed.generate(job, new AbortController().signal)).rejects.toMatchObject({code: 'network'})
    expect(job.cloud?.submissionStarted).toBe(true)
    const resumed = new JobStore(root, root).get(job.id)
    await managed.generate(resumed, new AbortController().signal)
    expect(keys).toEqual([job.id, job.id])
    expect(resumed.cloud?.runId).toBe('run1')
    expect(readFileSync(join(dir, 'digital_human/video.mp4'), 'utf8')).toBe('fixture-video')
    const calls = request.mock.calls.length
    getAccount.mockResolvedValue({userId: 8})
    await expect(managed.generate(resumed, new AbortController().signal)).rejects.toThrow('不一致')
    expect(request).toHaveBeenCalledTimes(calls)
  } finally {await store.dispose(); rmSync(root, {recursive: true, force: true})}
})
