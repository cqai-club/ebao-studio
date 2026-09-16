import { openAsBlob, createWriteStream, readFileSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { ManagedVideoError, ManagedVideoProvider, type AccountRequest } from './managed-video.ts'
import type { JobStore } from './jobs.ts'
import type { Job } from './protocol.ts'

export interface VideoAccount {fetchAi: AccountRequest; getAccount(): Promise<{userId: number}>}
export class ManagedJobs {
  private readonly provider: ManagedVideoProvider
  constructor(private readonly store: JobStore, private readonly account: VideoAccount) {
    this.provider = new ManagedVideoProvider((path, init, signal) => account.fetchAi(path, init, signal))
  }
  async quote(id: string): Promise<Job> {
    const job = this.store.get(id)
    if (job.options.mode !== 'digitalhuman') throw new Error('此报价仅用于数字人口播')
    if (job.cloud?.submissionStarted) throw new Error('任务已提交，请继续查询原任务')
    if (job.options.optimize || job.options.covers) throw new Error('产品账户数字人流程暂不支持附加文案优化或封面生成，请关闭这两项')
    const account = await this.account.getAccount()
    await this.store.prepare(id)
    const script = readFileSync(join(this.store.dir(id), 'script.txt'), 'utf8')
    const quote = await this.provider.quote(script)
    job.cloud = {quote, accountId: account.userId}; this.store.save(job)
    return job
  }
  async generate(job: Job, signal: AbortSignal): Promise<void> {
    if (!job.cloud) throw new Error('请先获取并确认报价')
    const assertAccount = async () => {
      if ((await this.account.getAccount()).userId !== job.cloud!.accountId) throw new Error('当前登录账户与制作任务不一致，请切回原账户')
    }
    await assertAccount()
    const dir = this.store.dir(job.id)
    if (!job.cloud.runId) {
      if (!job.cloud.submissionStarted && Date.parse(job.cloud.quote.expiresAt) <= Date.now()) throw new Error('报价已过期，请重新获取报价')
      const avatar = job.uploads.avatar!; const voice = job.uploads.voice!
      const script = readFileSync(join(dir, 'script.txt'), 'utf8')
      job.cloud.submissionStarted = true; this.store.save(job)
      try {
        const created = await this.provider.create({requestId: job.id, quoteId: job.cloud.quote.id, script,
          avatar: await openAsBlob(join(dir, avatar.file)), voice: await openAsBlob(join(dir, voice.file)), avatarName: avatar.name, voiceName: voice.name}, signal)
        job.cloud.runId = created.id; this.store.save(job)
      } catch (error) {
        // The server checks idempotency before expiry: this code guarantees no run was accepted.
        if (error instanceof ManagedVideoError && error.code === 'quote') {job.cloud = undefined; this.store.save(job)}
        throw error
      }
    }
    const deadline = Date.now() + 60 * 60 * 1000
    while (true) {
      signal.throwIfAborted(); await assertAccount()
      const status = await this.provider.status(job.cloud.runId, signal)
      if (status.status === 'completed') break
      if (status.status === 'failed' || status.status === 'cancelled') throw new Error('云端任务未完成，请查看账户服务的任务记录')
      if (Date.now() >= deadline) throw new Error('等待超时；云端任务继续运行，稍后点击继续任务查询')
      await delay(5000, undefined, {signal})
    }
    await assertAccount()
    const target = join(dir, 'digital_human/video.mp4'); await mkdir(join(dir, 'digital_human'), {recursive: true})
    let bytes = 0
    const limit = new Transform({transform(chunk, _encoding, callback) {bytes += chunk.length; callback(bytes > 1024 ** 3 ? new Error('云端视频过大') : null, chunk)}})
    try {
      const stream = await this.provider.download(job.cloud.runId, signal)
      await pipeline(Readable.fromWeb(stream as import('node:stream/web').ReadableStream), limit, createWriteStream(target + '.download'), {signal})
      if (!bytes) throw new Error('云端返回了空视频')
      await rename(target + '.download', target)
    } catch (error) {await rm(target + '.download', {force: true}); throw error}
  }
}
