import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Job } from './protocol.ts'

type Account = { fetchAi(path: `/v1/${string}`, init?: RequestInit, signal?: AbortSignal): Promise<Response> }
type VideoTask = NonNullable<Job['videoTasks']>[number]
const MAX_VIDEO_BYTES = 512 * 1024 * 1024
const TASK_ID = /^[A-Za-z0-9_.:-]{1,128}$/
const POLL_TIMEOUT_MS = 30 * 60 * 1000

export interface VideoMaterialRequest {
  index: number
  prompt: string
  seconds: number
}

export function validateVideoMaterialRequest(value: Record<string, unknown>): VideoMaterialRequest {
  const index = value.index
  const prompt = value.prompt
  const seconds = value.seconds
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 99) throw new Error('视频镜头序号无效')
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('视频提示词无效')
  if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > 30) throw new Error('视频镜头时长无效')
  return { index: index as number, prompt: prompt.trim(), seconds: seconds as number }
}

function fail(status: number, action: string): Error {
  if (status === 401) return new Error('CQAI Club 登录已失效，请重新登录后继续原任务')
  if (status === 402) return new Error('CQAI Club 账户额度不足')
  return new Error(`CQAI Club ${action}失败 (HTTP ${status})`)
}

async function responseObject(response: Response, action: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw fail(response.status, action)
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`CQAI Club ${action}返回无效数据`)
  return value as Record<string, unknown>
}

function taskPath(id: string): `/v1/${string}` {
  if (!TASK_ID.test(id)) throw new Error('CQAI Club 返回无效视频任务 ID')
  return `/v1/videos/${encodeURIComponent(id)}`
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已停止等待远端视频任务'))
    const timer = setTimeout(done, ms)
    function done() { signal?.removeEventListener('abort', abort); resolve() }
    function abort() { clearTimeout(timer); reject(new Error('已停止等待远端视频任务')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function createVideoMaterial(options: {
  account: Account
  job: Job
  storageRoot: string
  save: (job: Job) => Promise<void>
  request: VideoMaterialRequest
  signal?: AbortSignal
  pollIntervalMs?: number
}): Promise<{ path: string; taskId: string; seconds: number; prompt: string }> {
  const { account, job, storageRoot, save, request, signal } = options
  if (job.params.video_source !== 'cqai_video' || !job.videoModel) throw new Error('当前任务未选择 CQAI Club 视频生成')
  const key = String(request.index)
  const tasks = job.videoTasks ?? (job.videoTasks = [])
  let task: VideoTask | undefined = tasks.find(item => item.key === key)
  if (task && (task.model !== job.videoModel || task.seconds !== request.seconds)) {
    throw new Error('已提交的视频镜头参数与当前任务不一致，请新建制作任务')
  }
  const targetDir = join(storageRoot, job.id, 'cqai-materials')
  const target = join(targetDir, `clip-${key}.mp4`)
  if (task?.status === 'completed' && task.id && existsSync(target)) return { path: target, taskId: task.id, seconds: task.seconds, prompt: task.prompt }
  if (task?.status === 'submitting') throw new Error('视频提交结果尚未确认，可能已产生费用；请核对 CQAI Club 任务后再继续')
  if (task?.status === 'failed') throw new Error('该视频镜头已被服务端拒绝，请调整参数后新建任务')
  if (!task) {
    task = { key, model: job.videoModel, prompt: request.prompt, seconds: request.seconds, status: 'submitting' }
    tasks.push(task)
    await save(job)
    let response: Response
    try {
      response = await account.fetchAi('/v1/videos', {
        method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ model: job.videoModel, prompt: request.prompt, seconds: request.seconds }),
      }, requestSignal(signal, 90_000))
    } catch {
      throw new Error('视频提交结果不确定，可能已产生费用；请核对 CQAI Club 任务后再继续')
    }
    if (!response.ok && response.status >= 400 && response.status < 500) {
      task.status = 'failed'
      await save(job)
      throw fail(response.status, '视频提交')
    }
    let result: Record<string, unknown>
    try { result = await responseObject(response, '视频提交') }
    catch { throw new Error('视频提交结果不确定，可能已产生费用；请核对 CQAI Club 任务后再继续') }
    if (typeof result.id !== 'string' || !TASK_ID.test(result.id)) throw new Error('视频已提交但任务 ID 无效，请核对 CQAI Club 任务后再继续')
    task.id = result.id
    task.status = 'queued'
    await save(job)
  }
  const id = task.id
  if (!id) throw new Error('视频任务缺少远端 ID')
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let failures = 0
  let completed = false
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('已停止等待远端视频任务')
    let response: Response
    try { response = await account.fetchAi(taskPath(id), { method: 'GET', redirect: 'error' }, requestSignal(signal, 30_000)) }
    catch {
      if (++failures > 5) throw new Error(`视频状态暂时无法查询，远端任务 ${id} 可在原任务中继续`)
      await wait(options.pollIntervalMs ?? 5000, signal)
      continue
    }
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      if (++failures > 5) throw new Error(`视频状态暂时无法查询，远端任务 ${id} 可在原任务中继续`)
      await wait(options.pollIntervalMs ?? 5000, signal)
      continue
    }
    const result = await responseObject(response, '视频状态查询')
    failures = 0
    const status = String(result.status ?? '').toLowerCase()
    if (status === 'completed' || status === 'succeeded') { completed = true; break }
    if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status)) {
      task.status = 'failed'
      await save(job)
      throw new Error(`视频生成失败，远端任务 ${id}`)
    }
    if (!['pending', 'queued', 'in_progress', 'running'].includes(status)) throw new Error(`视频任务 ${id} 返回未知状态`)
    const nextStatus = status === 'running' || status === 'in_progress' ? 'in_progress' : 'queued'
    const progress = typeof result.progress === 'number' && Number.isFinite(result.progress) && result.progress >= 0 && result.progress <= 100 ? result.progress : undefined
    if (task.status !== nextStatus || task.progress !== progress) {
      task.status = nextStatus
      task.progress = progress
      await save(job)
    }
    await wait(options.pollIntervalMs ?? 5000, signal)
  }
  if (!completed) throw new Error(`视频生成仍在进行，远端任务 ${id} 可在原任务中继续`)
  const downloadSignal = requestSignal(signal, 10 * 60_000)
  const response = await account.fetchAi(`${taskPath(id)}/content`, { method: 'GET', redirect: 'error' }, downloadSignal)
  if (!response.ok) throw fail(response.status, '视频下载')
  if (!response.body || !['video/mp4', 'application/octet-stream'].includes((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase())) {
    await response.body?.cancel()
    throw new Error(`远端任务 ${id} 返回的不是 MP4 视频`)
  }
  await mkdir(targetDir, { recursive: true })
  let bytes = 0
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length
    callback(bytes > MAX_VIDEO_BYTES ? new Error('生成的视频文件过大') : null, chunk)
  } })
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limit, createWriteStream(target + '.download'), { signal: downloadSignal })
    const file = await open(target + '.download', 'r')
    let signature: Buffer
    try { signature = Buffer.alloc(8); await file.read(signature, 0, 8, 0) }
    finally { await file.close() }
    if (bytes < 12 || signature.subarray(4, 8).toString('ascii') !== 'ftyp') throw new Error('生成的视频不是有效 MP4 文件')
    await rename(target + '.download', target)
  } catch (error) {
    await rm(target + '.download', { force: true })
    throw error
  }
  task.status = 'completed'
  await save(job)
  return { path: target, taskId: id, seconds: task.seconds, prompt: task.prompt }
}
