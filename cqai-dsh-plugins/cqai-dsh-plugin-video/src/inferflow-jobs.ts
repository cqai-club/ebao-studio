import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { JobStore } from './jobs.ts'
import type { Job } from './protocol.ts'

type Result = Record<string, any>
export type Bridge = (key: string, op: string, data?: Result, signal?: AbortSignal) => Promise<Result>
async function downloadVideo(address: string, key: string, signal: AbortSignal): Promise<Response> {
  let url = new URL(address, 'https://saas.inferflow.dev')
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('云端返回了不安全的下载地址')
    const response = await fetch(url, {signal, redirect: 'manual', headers: url.origin === 'https://saas.inferflow.dev' ? {'X-API-Key': key} : {}})
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('视频下载跳转缺少地址')
    url = new URL(location, url)
  }
  throw new Error('视频下载跳转次数过多')
}
export function pythonBridge(python: string, runtime: string): Bridge {
  return (key, op, data = {}, signal) => new Promise((resolve, reject) => {
    const child = spawn(python, ['-u', join(runtime, 'inferflow/bridge.py')], {windowsHide: true, signal,
      env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', INFERFLOW_API_KEY: ''}, stdio: ['pipe', 'pipe', 'pipe']})
    let output = ''
    const timer = setTimeout(() => child.kill(), 360000)
    child.stdin.on('error', () => {})
    child.stderr.resume()
    child.stdout.on('data', chunk => {output += chunk; if (output.length > 2000000) child.kill()})
    child.once('error', reject)
    child.once('close', () => {
      clearTimeout(timer)
      try {const value = JSON.parse(output); if (value.error) reject(new Error(String(value.error).replaceAll(key, '[redacted]'))); else resolve(value.result)}
      catch {reject(new Error('InferFlow 请求中断，请检查网络后继续原任务'))}
    })
    child.stdin.end(JSON.stringify({...data, key, op}))
  })
}

/** Keys stay in Host memory and must be entered again after restarting the portable app. */
export class InferFlowJobs {
  private key = ''
  constructor(private readonly store: JobStore, private readonly call: Bridge) {}
  settings() {return {connected: !!this.key}}
  async connect(value: unknown) {
    const key = (value as {key?: unknown})?.key
    if (typeof key !== 'string' || key.trim().length < 10 || key.length > 500) throw new Error('请输入有效的 InferFlow API Key')
    const result = await this.call(key.trim(), 'verify')
    this.key = key.trim()
    return {connected: true, credits: result.credits}
  }
  disconnect() {this.key = ''; return this.settings()}
  private credential() {if (!this.key) throw new Error('请先在上方连接自己的 InferFlow 账户'); return this.key}
  private identity(key: string) {return createHash('sha256').update(key).digest('hex')}
  private inputs(job: Job) {
    const dir = this.store.dir(job.id)
    return {avatar_image: join(dir, job.uploads.avatar!.file), voice_audio: join(dir, job.uploads.voice!.file),
      script_text: readFileSync(join(dir, 'script.txt'), 'utf8'), title: job.options.title || 'e剪宝数字人口播', segmentation_mode: 'fast_segments'}
  }
  async quote(id: string): Promise<Job> {
    const key = this.credential(); const job = this.store.get(id)
    if (job.options.mode !== 'digitalhuman') throw new Error('此估算仅用于数字人口播')
    if (job.cloud?.submissionStarted) throw new Error('任务已提交，请继续查询原任务')
    if (job.options.optimize || job.options.covers) throw new Error('请关闭附加文案优化和封面生成')
    await this.store.prepare(id)
    const estimate = await this.call(key, 'quote', {inputs: this.inputs(job)})
    if (!Number.isFinite(estimate.estimated_credits)) throw new Error('未收到有效的费用估算')
    job.cloud = {provider: 'inferflow', accountId: 0, credentialId: this.identity(key),
      quote: {id: randomUUID(), amount: estimate.estimated_credits, unit: 'InferFlow 积分',
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString()}}
    this.store.save(job); return job
  }
  async generate(job: Job, signal: AbortSignal): Promise<void> {
    const key = this.credential(); const cloud = job.cloud
    if (!cloud || cloud.provider !== 'inferflow') throw new Error('请重新获取个人 InferFlow 费用估算，旧平台任务不能混用')
    if (cloud.credentialId !== this.identity(key)) throw new Error('请连接创建此任务时使用的 InferFlow API Key')
    if (!cloud.runId) {
      if (cloud.submissionStarted) throw new Error('上次提交结果未知。请先到 InferFlow 任务记录核对，避免重复扣费')
      if (Date.parse(cloud.quote.expiresAt) <= Date.now()) throw new Error('费用估算已过期，请重新获取')
      const inputs = await this.call(key, 'prepare', {inputs: this.inputs(job)}, signal)
      signal.throwIfAborted()
      cloud.submissionStarted = true; this.store.save(job)
      // Persist the marker before creating any billable run. Unknown outcomes never auto-submit again.
      const created = await this.call(key, 'create', {inputs, requestId: job.id}, signal)
      if (typeof created.run_id !== 'string' || !created.run_id) throw new Error('服务未返回任务编号，请在 InferFlow 核对任务记录')
      cloud.runId = created.run_id; this.store.save(job)
    }
    const deadline = Date.now() + 3600000
    while (true) {
      signal.throwIfAborted()
      const status = await this.call(key, 'status', {runId: cloud.runId}, signal)
      if (status.status === 'completed' || status.status === 'partial_success') break
      if (['failed', 'cancelled', 'canceled'].includes(status.status)) throw new Error('InferFlow 任务未完成，请查看云端任务记录')
      if (Date.now() > deadline) throw new Error('等待超时，云端仍可能运行；稍后继续原任务即可')
      await delay(5000, undefined, {signal})
    }
    const outputs = await this.call(key, 'outputs', {runId: cloud.runId}, signal)
    const item = outputs.items?.find((v: Result) => v.type === 'file' && v.download_url && (v.format === 'mp4' || v.content_type === 'video/mp4' || v.mime_type === 'video/mp4' || /video|mp4/i.test(String(v.name))))
    if (!item) throw new Error('InferFlow 未返回可下载视频，请查看云端产物')
    // Signed object-storage URLs must not receive the user's API key.
    const response = await downloadVideo(item.download_url, key, signal)
    if (!response.ok || !response.body) throw new Error('视频下载失败，请稍后继续原任务')
    const dir = join(this.store.dir(job.id), 'digital_human'); await mkdir(dir, {recursive: true})
    const target = join(dir, 'video.mp4'); let bytes = 0
    const limit = new Transform({transform(chunk, _encoding, callback) {bytes += chunk.length; callback(bytes > 1024 ** 3 ? new Error('云端视频过大') : null, chunk)}})
    try {
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limit, createWriteStream(target + '.download'), {signal})
      if (!bytes) throw new Error('云端返回了空视频')
      await rename(target + '.download', target)
    } catch (error) {await rm(target + '.download', {force: true}); throw error}
  }
}
