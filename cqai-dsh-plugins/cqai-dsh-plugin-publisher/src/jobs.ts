import { existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  BLBL_ONLY_STATEMENTS, CREATIVE_STATEMENTS, DESCRIPTION_MAX, MAX_TAGS, PLATFORM_LABELS,
  TITLE_MAX, VIDEO_PLATFORMS,
  type AccountRow, type CreativeStatement, type HistoryRow, type JobStatus, type Platform,
  type PublishInput,
  type PublishJob, type PublishTarget, type TargetState,
} from './protocol.ts'
import { EXIT_CODES, readRecords, verifyTarget, type PublishRecord, type Verification } from './records.ts'
import { MatrixMedia, collect, launchChild, type CliResult, type Launcher } from './runtime.ts'

/** `YYYY-MM-DD HH:mm:ss`, the only shape `--publish-at` accepts. */
export const PUBLISH_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u
/** How many CLI lines the panel keeps per job. */
const LOG_LIMIT = 300

/** Reject anything upstream would reject, in language the panel can show. */
export function validateInput(raw: unknown): PublishInput {
  const value = (raw ?? {}) as Partial<PublishInput>
  const file = String(value.file ?? '').trim()
  if (!file) throw new Error('请先选择要发布的成片')
  if (!isAbsolute(file)) throw new Error('成片路径必须是绝对路径')
  if (!existsSync(file)) throw new Error(`找不到成片文件：${file}`)
  if (!statSync(file).isFile()) throw new Error('成片路径不是文件')
  const title = String(value.title ?? '').trim()
  if (!title) throw new Error('标题是必填项')
  if (title.length > TITLE_MAX) throw new Error(`标题不能超过 ${TITLE_MAX} 字`)
  const description = String(value.description ?? '').trim()
  if (description.length > DESCRIPTION_MAX) throw new Error(`简介不能超过 ${DESCRIPTION_MAX} 字`)
  const shortTitle = String(value.shortTitle ?? '').trim()
  // Upstream stores bare keywords, so a leading `#` — and any space before it —
  // is stripped however the user typed it.
  const tags = (Array.isArray(value.tags) ? value.tags : []).map(tag => String(tag).replace(/^[\s#]+/u, '').trim()).filter(Boolean)
  if (tags.length > MAX_TAGS) throw new Error(`话题最多 ${MAX_TAGS} 个`)
  const statement = String(value.creativeStatement ?? 'none') as CreativeStatement
  if (!CREATIVE_STATEMENTS.includes(statement)) throw new Error(`不支持的创作声明：${statement}`)
  const publishAt = String(value.publishAt ?? '').trim()
  if (publishAt && !PUBLISH_AT.test(publishAt)) throw new Error('定时发布时间需为「YYYY-MM-DD HH:mm:ss」')
  const rawTargets = Array.isArray(value.targets) ? value.targets : []
  if (!rawTargets.length) throw new Error('请至少选择一个发布平台')
  const seen = new Set<string>()
  const targets = rawTargets.map(entry => {
    const platform = String(entry?.platform ?? '') as Platform
    if (!VIDEO_PLATFORMS.includes(platform as typeof VIDEO_PLATFORMS[number])) throw new Error(`不支持的平台：${platform}`)
    const phone = String(entry?.phone ?? '').trim()
    const key = `${platform}:${phone}`
    if (seen.has(key)) throw new Error(`平台「${PLATFORM_LABELS[platform]}」重复选择`)
    seen.add(key)
    return {platform, phone}
  })
  if (BLBL_ONLY_STATEMENTS.includes(statement) && targets.some(target => target.platform !== 'blbl')) {
    throw new Error('「自制，禁止转载」仅哔哩哔哩支持')
  }
  return {file, title, description, shortTitle, tags, creativeStatement: statement, publishAt, draft: value.draft === true, targets}
}

/** Build the `cli publish` argument list for one platform. */
export function publishArgs(input: PublishInput, platform: Platform, phone: string): string[] {
  const args = ['cli', 'publish', '-p', platform, '-f', input.file, '-t', input.title]
  if (phone) args.push('--phone', phone)
  if (input.description) args.push('--description', input.description)
  if (input.tags?.length) args.push('--tags', input.tags.join(' '))
  if (input.creativeStatement && input.creativeStatement !== 'none') args.push('--cs', input.creativeStatement)
  if (input.publishAt) args.push('--publish-at', input.publishAt)
  if (input.draft) args.push('--draft')
  if (platform === 'sph') {
    // 视频号的短标题与「小说名称」都是后台必填；标题是最合理的默认。
    args.push('--short-title', input.shortTitle || input.title.slice(0, 16))
    args.push('--name', input.title.slice(0, 60))
  }
  if (platform === 'fqsp') args.push('--name', input.title.slice(0, 60))
  return args
}

/**
 * Map an upstream exit code to the best state it alone can justify.
 *
 * Exit 0 is deliberately **not** a success here: upstream prints it whenever the
 * command ran to the end, and the record file is what says whether anything was
 * published. Exit 4 is upstream's own draft transfer, which the caller refines.
 */
export function stateFromExit(code: number | undefined): TargetState {
  if (code === EXIT_CODES.success) return 'running'
  if (code === EXIT_CODES.draft) return 'draft'
  return 'failed'
}

/**
 * Supervise publish jobs. One job is one request; its platforms run **serially**,
 * one `cli publish` child at a time, because that is how these platforms expect
 * to be driven and it makes per-platform progress observable.
 *
 * A state is only ever `success` when MatrixMedia's own record file says so. The
 * exit code alone can promote a job to `running`/`draft`/`failed`, never to
 * `success` — a fabricated success is worse than an honest `unknown`.
 */
export class Publisher {
  private readonly jobs = new Map<string, PublishJob>()
  private running: {jobId: string; child: {kill(): boolean}} | undefined
  /** How per-platform children are started; injectable for tests. */
  private readonly launch: Launcher

  constructor(private readonly mm: MatrixMedia, launch: Launcher = launchChild) {
    this.launch = launch
  }

  /** Whether a child is running right now. */
  get busy(): boolean { return this.running !== undefined }

  /**
   * Whether {@link start} would run this job again. True for a job that never
   * ran, and for one that ended without anything landing — a job whose platforms
   * were all `unknown`/`failed` is exactly the one a person wants to retry. A
   * job that published something, or was cancelled, is finished for good.
   */
  restartable(job: PublishJob): boolean {
    if (job.status === 'queued') return true
    if (job.status !== 'failed') return false
    return !job.targets.some(target => target.state === 'success' || target.state === 'scheduled' || target.state === 'draft')
  }

  /** Every job, newest first, logs trimmed for transport. */
  list(): PublishJob[] {
    return [...this.jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(job => ({...job, logs: job.logs.slice(-40)}))
  }

  /** One job, or a clear error the panel can show. */
  get(id: string): PublishJob {
    const job = this.jobs.get(id)
    if (!job) throw new Error('任务不存在或已被清理')
    return job
  }

  /** Create a job in `queued`; nothing runs until {@link start}. */
  create(raw: unknown): PublishJob {
    const input = validateInput(raw)
    const job: PublishJob = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      input,
      status: 'queued',
      targets: input.targets.map(target => ({platform: target.platform, phone: target.phone ?? '', state: 'pending', message: '等待开始'})),
      logs: [],
    }
    this.jobs.set(job.id, job)
    return job
  }

  /**
   * Check a start request without running anything. Split out from
   * {@link start} so the local route can answer with a real error before it
   * hands control to a promise nobody awaits.
   */
  guard(id: string): PublishJob {
    const job = this.get(id)
    if (!this.restartable(job)) throw new Error('任务已经开始过了')
    if (this.running) throw new Error(`请等待「${this.jobs.get(this.running.jobId)?.input.title ?? '当前任务'}」结束`)
    return job
  }

  /**
   * Run the job's platforms one after another. Resolves when the job reaches a
   * terminal status; callers that do not want to wait should not await it.
   */
  async start(id: string): Promise<PublishJob> {
    const job = this.guard(id)
    job.status = 'running'
    delete job.error
    delete job.finishedAt
    const since = Date.now()
    for (const [index, target] of job.targets.entries()) {
      // `cancel` flips the status from another turn of the loop, which the
      // compiler cannot see from here; the read is deliberate, not a mistake.
      if ((job.status as JobStatus) === 'cancelled') {target.state = 'cancelled'; target.message = '已取消'; continue}
      target.state = 'running'
      target.message = '正在上传…'
      const args = publishArgs(job.input, target.platform, target.phone)
      this.log(job, `$ matrixmedia ${args.map(part => (part.includes(' ') ? `"${part}"` : part)).join(' ')}`)
      let result: CliResult
      try {
        result = await this.spawnJob(job, args)
      } catch (error) {
        target.state = 'failed'
        target.message = error instanceof Error ? error.message : '无法启动矩媒'
        job.status = 'failed'
        job.error = target.message
        break
      }
      target.exitCode = result.code
      await this.settle(job, target, since, result, index === job.targets.length - 1)
    }
    if (job.status === 'running') {
      const done = job.targets.filter(target => target.state === 'success' || target.state === 'scheduled' || target.state === 'draft').length
      const failed = job.targets.filter(target => target.state === 'failed').length
      // A job is only `completed` when something actually landed. Platforms
      // whose result could not be confirmed are a person's problem to check,
      // never a silent success.
      if (done) job.status = 'completed'
      else if (failed) job.status = 'failed'
      else {
        job.status = 'failed'
        job.error = '结果未能在矩媒记录中确认，请到矩媒界面核对'
      }
      job.error ??= job.targets.find(target => target.state === 'failed')?.message
    }
    job.finishedAt = new Date().toISOString()
    return job
  }

  /**
   * Record an unexpected failure on a job so it can never sit in `running`
   * forever. Used as the last-resort handler for a background {@link start}.
   */
  fail(id: string, error: unknown): void {
    const job = this.jobs.get(id)
    if (!job) return
    const message = error instanceof Error ? error.message : '任务异常结束'
    job.status = 'failed'
    job.error = message
    job.finishedAt = new Date().toISOString()
    for (const target of job.targets) {
      if (target.state === 'pending' || target.state === 'running') {target.state = 'unknown'; target.message = message}
    }
  }

  /** Best-effort cancel: kill the child and mark the untouched platforms. */
  async cancel(id: string): Promise<PublishJob> {
    const job = this.get(id)
    if (job.status === 'queued') {
      job.status = 'cancelled'
      for (const target of job.targets) {target.state = 'cancelled'; target.message = '已取消'}
      job.finishedAt = new Date().toISOString()
      return job
    }
    job.status = 'cancelled'
    this.running?.child.kill()
    for (const target of job.targets) {
      if (target.state === 'pending' || target.state === 'running') {target.state = 'cancelled'; target.message = '已取消'}
    }
    return job
  }

  /** Accounts as reported by upstream, with the friendly platform label added. */
  async accounts(): Promise<AccountRow[]> {
    return this.mm.accounts()
  }

  /** Merge upstream's own history with nothing else — the records are the truth. */
  async history(limit = 50): Promise<HistoryRow[]> {
    return this.mm.history(limit)
  }

  /** Decide what happened to one platform, preferring MatrixMedia's own record. */
  verify(
    job: PublishJob,
    target: PublishTarget,
    since: number,
    exitCode: number | undefined,
    records: readonly PublishRecord[] = readRecords(this.mm.dataDir, since),
  ): Verification {
    return verifyTarget(records, target.platform, target.phone || undefined, since, exitCode, job.input.draft === true)
  }

  /** Spawn one per-platform child and feed its lines into the job log. */
  private async spawnJob(job: PublishJob, args: readonly string[]): Promise<CliResult> {
    const child: ChildProcess = this.launch(this.mm.location.exe, args, this.mm.location.dir)
    this.running = {jobId: job.id, child}
    try {
      return await collect(child, 30 * 60 * 1000, line => this.log(job, line))
    } finally {
      this.running = undefined
    }
  }

  /** Turn one child result into a target state, preferring the record file. */
  private settle(job: PublishJob, target: PublishTarget, since: number, result: CliResult, last: boolean): void {
    if (job.status === 'cancelled') {target.state = 'cancelled'; target.message = '已取消'; return}
    // A child that died before printing its epilogue produced no answer at all.
    // Even a record stamped while it ran is not evidence of a *published* task —
    // it is only the queue entry upstream wrote on its way in — so a silent
    // death stays `unknown` and is handed to the person to check.
    if (result.code === undefined) {
      target.state = 'unknown'
      target.message = result.timedOut ? '超过等待上限，请在矩媒界面核对是否已发布' : '未取得矩媒退出码，无法确认结果'
      if (last) this.log(job, target.message)
      return
    }
    const state = stateFromExit(result.code)
    // A `publishing` record means upstream accepted the task but has not uploaded
    // yet — a real answer, and the reason we do not call exit code 0 a success.
    const verification = this.verify(job, target, since, result.code)
    target.state = verification.state === 'running' ? state : verification.state
    target.message = verification.message
    target.publishedAt = verification.publishedAt
    if (target.state === 'unknown' && last) this.log(job, '未能在矩媒记录中确认结果，请在矩媒界面核对')
  }

  private log(job: PublishJob, line: string): void {
    job.logs.push(line)
    if (job.logs.length > LOG_LIMIT) job.logs.splice(0, job.logs.length - LOG_LIMIT)
  }
}
