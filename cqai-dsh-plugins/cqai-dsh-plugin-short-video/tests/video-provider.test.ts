import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVideoMaterial, validateVideoMaterialRequest } from '../src/video-provider.ts'
import { defaultParams, type Job } from '../src/protocol.ts'

const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
function job(): Job {
  return {
    id: '00000000-0000-0000-0000-000000000001', status: 'running', progress: 0,
    createdAt: '', updatedAt: '', textModel: '', imageModel: '', videoModel: 'wan3.0-video-480p',
    stopAt: 'materials', params: { ...defaultParams, video_subject: '城市', video_source: 'cqai_video' },
    logs: [], uploads: { material: [] }, artifacts: [],
  }
}

describe('CQAI video material', () => {
  it('validates one paid clip request before contacting the account', () => {
    expect(validateVideoMaterialRequest({ index: 0, prompt: '城市', seconds: 5 })).toEqual({ index: 0, prompt: '城市', seconds: 5 })
    expect(() => validateVideoMaterialRequest({ index: -1, prompt: '城市', seconds: 5 })).toThrow()
    expect(() => validateVideoMaterialRequest({ index: 0, prompt: '', seconds: 5 })).toThrow()
    expect(() => validateVideoMaterialRequest({ index: 0, prompt: '城市', seconds: 0 })).toThrow()
  })

  it('creates once, polls, downloads MP4, and reuses the saved clip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cqai-video-'))
    const active = job()
    const paths: string[] = []
    const snapshots: string[] = []
    const account = { async fetchAi(path: `/v1/${string}`, init?: RequestInit): Promise<Response> {
      paths.push(path)
      if (path === '/v1/videos') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ model: active.videoModel, prompt: '城市', seconds: 5 })
        return Response.json({ id: 'remote_1', status: 'queued' })
      }
      if (path === '/v1/videos/remote_1') return Response.json({ id: 'remote_1', status: 'completed' })
      return new Response(video, { headers: { 'content-type': 'video/mp4' } })
    } }
    const options = { account, job: active, storageRoot: root, save: async (value: Job) => { snapshots.push(JSON.stringify(value.videoTasks)) }, request: { index: 0, prompt: '城市', seconds: 5 }, pollIntervalMs: 0 }
    try {
      const result = await createVideoMaterial(options)
      expect(result.taskId).toBe('remote_1')
      expect(await readFile(result.path)).toEqual(video)
      expect(paths).toEqual(['/v1/videos', '/v1/videos/remote_1', '/v1/videos/remote_1/content'])
      expect(snapshots[0]).toContain('submitting')
      expect(snapshots[1]).toContain('remote_1')
      expect(active.videoTasks?.[0].status).toBe('completed')
      expect(await createVideoMaterial(options)).toEqual(result)
      expect(paths).toHaveLength(3)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('keeps an uncertain submission from being sent again', async () => {
    const active = job()
    let posts = 0
    const options = { account: { async fetchAi(): Promise<Response> { posts++; throw new Error('connection lost') } }, job: active, storageRoot: tmpdir(), save: async () => {}, request: { index: 0, prompt: '城市', seconds: 5 } }
    await expect(createVideoMaterial(options)).rejects.toThrow('提交结果不确定')
    await expect(createVideoMaterial(options)).rejects.toThrow('提交结果尚未确认')
    expect(posts).toBe(1)
    expect(active.videoTasks?.[0].status).toBe('submitting')
  })

  it('records a definite request rejection and does not resubmit it', async () => {
    const active = job()
    let posts = 0
    const options = { account: { async fetchAi(): Promise<Response> { posts++; return new Response('', { status: 400 }) } }, job: active, storageRoot: tmpdir(), save: async () => {}, request: { index: 0, prompt: '城市', seconds: 30 } }
    await expect(createVideoMaterial(options)).rejects.toThrow('HTTP 400')
    await expect(createVideoMaterial(options)).rejects.toThrow('已被服务端拒绝')
    expect(posts).toBe(1)
  })

  it('explains an unavailable submission endpoint without resubmitting the rejected clip', async () => {
    const active = job()
    let posts = 0
    const options = { account: { async fetchAi(): Promise<Response> { posts++; return new Response('', { status: 404 }) } }, job: active, storageRoot: tmpdir(), save: async () => {}, request: { index: 0, prompt: '城市', seconds: 5 } }
    await expect(createVideoMaterial(options)).rejects.toThrow('视频生成接口不可用 (HTTP 404)')
    expect(active.videoTasks?.[0].status).toBe('failed')
    await expect(createVideoMaterial(options)).rejects.toThrow('已被服务端拒绝')
    expect(posts).toBe(1)
  })

  it('resumes an accepted task after a failed download without creating another', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cqai-video-resume-'))
    const active = job()
    const paths: string[] = []
    let download = 0
    const options = { account: { async fetchAi(path: `/v1/${string}`): Promise<Response> {
      paths.push(path)
      if (path === '/v1/videos') return Response.json({ id: 'remote_2' })
      if (path === '/v1/videos/remote_2') return Response.json({ status: 'completed' })
      download++
      return download === 1 ? new Response('unavailable', { status: 503 }) : new Response(video, { headers: { 'content-type': 'video/mp4' } })
    } }, job: active, storageRoot: root, save: async () => {}, request: { index: 0, prompt: '城市', seconds: 5 }, pollIntervalMs: 0 }
    try {
      await expect(createVideoMaterial(options)).rejects.toThrow('视频下载失败')
      expect(active.videoTasks?.[0].id).toBe('remote_2')
      const reused = await createVideoMaterial({ ...options, request: { index: 0, prompt: '另一个关键词', seconds: 5 } })
      expect(reused.prompt).toBe('城市')
      expect(paths.filter(path => path === '/v1/videos')).toHaveLength(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
