import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Platform, TargetState, VerifyReason } from './protocol.ts'

/**
 * Upstream never documents a stdout success marker for `publish`; `CLI_SKILLS.md`
 * describes features only. What the bundle does guarantee is the dispatch
 * epilogue below, so the exit code it prints — not the process exit code alone —
 * is the strongest signal we get. Everything else is verification against
 * MatrixMedia's own record files.
 */
const EPILOGUE = /\[startup\] CLI 执行结束，退出码=(\d+)/
/** Upstream's `cli publish`/`cli accounts` exit codes, from their own help text. */
export const EXIT_CODES = {
  /** 单文件: 成功; 批量: 全部成功. */
  success: 0,
  /** 异常. */
  error: 1,
  /** 参数错误. */
  arguments: 2,
  /** 任务失败（上传未成功） / 批量部分失败. */
  taskFailure: 3,
  /** 已转存草稿需检查; 批量全部失败. */
  draft: 4,
} as const

/** Read upstream's own terminal exit code out of captured stdout. */
export function reportedExitCode(stdout: string): number | undefined {
  const match = EPILOGUE.exec(stdout)
  return match ? Number(match[1]) : undefined
}

/** One publish record inside a `pushData/YYYY-MM-DD.json` bucket. */
export interface PublishRecord {
  pt?: string
  phone?: string
  bt?: string
  bookName?: string
  publishStatus?: string
  publishAttemptCount?: number
  publishSuccessCount?: number
  publishFailCount?: number
  lastPublishMessage?: string
  lastPublishAt?: number
  createTime?: number
  id?: string
  data?: {bt1?: string}
}

/** A verification conclusion for one platform. */
export interface Verification {
  /** State the record files justify. */
  state: TargetState
  /** What was actually read, for the panel and for support. */
  reason: VerifyReason
  /** Upstream's own message when the record carried one. */
  message: string
  /** Record timestamp, when one was found. */
  publishedAt?: string
}

/** Status normalization copied from upstream's own `cli history` implementation. */
export function recordStatus(record: PublishRecord): string {
  const status = String(record.publishStatus ?? '').toLowerCase()
  if (status === 'success' || status === 'failed' || status === 'publishing'
    || status === 'scheduled' || status === 'expired') return status
  if (status === 'fail') return 'failed'
  if (Number(record.publishSuccessCount) > 0) return 'success'
  if (Number(record.publishFailCount) > 0) return 'failed'
  return 'publishing'
}

/** Read every record in the day buckets that could contain `since`. */
export function readRecords(dataDir: string, since: number, days = 3): PublishRecord[] {
  const dir = join(dataDir, 'pushData')
  if (!existsSync(dir)) return []
  const cutoff = new Date(since - 24 * 60 * 60 * 1000)
  const stamp = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  // The window is anchored on `since`, never on the wall clock: a job that ran
  // days ago must read that day's bucket, not today's, or the records it wrote
  // would be invisible. `days` covers a run that crosses midnight.
  const wanted = new Set<string>()
  for (let day = 0; day < days; day += 1) {
    wanted.add(`${stamp(new Date(cutoff.getTime() + day * 24 * 60 * 60 * 1000))}.json`)
  }
  const records: PublishRecord[] = []
  for (const file of readdirSync(dir)) {
    if (!wanted.has(file)) continue
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (Array.isArray(parsed)) records.push(...parsed as PublishRecord[])
    } catch { /* a half-written bucket is not a verification failure by itself */ }
  }
  return records
}

/**
 * Decide what really happened to one platform, preferring MatrixMedia's own
 * record over the child process's exit code. Success is only ever reported when
 * a record says so: an unreachable or silent data directory yields `unknown`,
 * never a fabricated success.
 * @param records - records read from the bucket files.
 * @param platform - CLI platform id to look for.
 * @param phone - account phone to disambiguate, when the user supplied one.
 * @param since - epoch ms before which records are ignored.
 * @param exitCode - the exit code upstream reported on stdout, when it did.
 * @param draft - whether the user asked for a draft-box publish.
 */
export function verifyTarget(
  records: readonly PublishRecord[],
  platform: Platform,
  phone: string | undefined,
  since: number,
  exitCode: number | undefined,
  draft: boolean,
): Verification {
  const candidates = records.filter(record => record.pt === platform
    && (!phone || String(record.phone ?? '') === phone)
    && Math.max(Number(record.lastPublishAt) || 0, Number(record.createTime) || 0) >= since)
  candidates.sort((left, right) => Math.max(Number(right.lastPublishAt) || 0, Number(right.createTime) || 0)
    - Math.max(Number(left.lastPublishAt) || 0, Number(left.createTime) || 0))
  const record = candidates[0]
  if (record) {
    const status = recordStatus(record)
    const at = Math.max(Number(record.lastPublishAt) || 0, Number(record.createTime) || 0)
    const publishedAt = at ? new Date(at).toISOString() : undefined
    const message = String(record.lastPublishMessage ?? '') || PLATFORM_STATE_TEXT[status] || status
    if (status === 'success') return {state: 'success', reason: 'ok', message, publishedAt}
    if (status === 'scheduled') return {state: 'scheduled', reason: 'scheduled', message, publishedAt}
    if (status === 'failed' || status === 'expired') return {state: 'failed', reason: 'record-failed', message, publishedAt}
    return {state: 'running', reason: 'record-pending', message, publishedAt}
  }
  // Exit 4 is upstream's own "转存草稿箱" (`EXIT_CODES.draft`), so it means a
  // draft whether or not the user asked for one. Exit 0 only means a draft when
  // `--draft` was the request; on its own it is not a publish.
  if (exitCode === EXIT_CODES.draft) return {state: 'draft', reason: 'draft', message: '已转入草稿箱，请在平台后台确认'}
  if (exitCode === EXIT_CODES.success) {
    return {state: draft ? 'draft' : 'unknown', reason: draft ? 'draft' : 'record-missing', message: draft ? '已转入草稿箱，请在平台后台确认' : '命令报告成功，但未在矩媒记录中找到这一条，请在矩媒界面核对'}
  }
  if (exitCode === EXIT_CODES.taskFailure) return {state: 'failed', reason: 'record-missing', message: '上传未成功（退出码 3）'}
  if (exitCode === undefined) return {state: 'unknown', reason: 'no-run', message: '未取得命令退出码，无法确认结果'}
  return {state: 'failed', reason: 'record-missing', message: `命令以退出码 ${String(exitCode)} 结束，且记录中没有这一条`}
}

const PLATFORM_STATE_TEXT: Record<string, string> = {
  success: '已发布', failed: '发布失败', publishing: '发布中', scheduled: '已定时，等待到点发布', expired: '已过期',
}
