import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EXIT_CODES, readRecords, recordStatus, reportedExitCode, verifyTarget } from '../src/records.ts'
import { writeRecord } from './fixture.ts'

const roots: string[] = []
afterEach(() => {for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})
function temp(): string {const root = mkdtempSync(join(tmpdir(), 'ejianbao-records-')); roots.push(root); return root}

describe('upstream exit codes', () => {
  it('reads the code upstream prints, not the process code', () => {
    expect(reportedExitCode('banner\n[midway]\n[startup] CLI 执行结束，退出码=4\n')).toBe(EXIT_CODES.draft)
    expect(reportedExitCode('a child that died before its epilogue')).toBeUndefined()
    // If a transcript somehow carries two, the first is the one that ended the
    // run — and the one `collect` stops on.
    expect(reportedExitCode('[startup] CLI 执行结束，退出码=3\n[startup] CLI 执行结束，退出码=0')).toBe(EXIT_CODES.taskFailure)
  })
})

describe('record status normalization', () => {
  it('mirrors the normalization upstream applies to its own records', () => {
    expect(recordStatus({publishStatus: 'success'})).toBe('success')
    expect(recordStatus({publishStatus: 'FAIL'})).toBe('failed')
    expect(recordStatus({publishStatus: 'scheduled'})).toBe('scheduled')
    expect(recordStatus({publishStatus: 'something-new'})).toBe('publishing')
    expect(recordStatus({publishSuccessCount: 1})).toBe('success')
    expect(recordStatus({publishFailCount: 1})).toBe('failed')
    expect(recordStatus({})).toBe('publishing')
  })
})

describe('reading the day buckets', () => {
  it('ignores buckets that cannot contain the run', () => {
    const data = temp()
    writeRecord(data, {pt: 'dy', publishStatus: 'success'})
    expect(readRecords(data, Date.now())).toHaveLength(1)
    expect(readRecords(data, Date.now() + 30 * 24 * 60 * 60 * 1000)).toHaveLength(0)
  })

  it('finds a scheduled run whose publish time is still ahead of the clock', () => {
    // `--publish-at` makes upstream stamp `lastPublishAt` with the scheduled
    // moment, days in the future, while the bucket file is the day it was
    // written — so the bucket, not the stamp, is what has to be in range.
    const data = temp()
    const at = Date.now() + 5 * 24 * 60 * 60 * 1000
    writeRecord(data, {pt: 'dy', publishStatus: 'scheduled', lastPublishAt: at}, Date.now())
    const records = readRecords(data, Date.now())
    expect(records).toHaveLength(1)
    expect(verifyTarget(records, 'dy', undefined, Date.now(), EXIT_CODES.success, false).state).toBe('scheduled')
  })

  it('returns nothing for a machine where MatrixMedia has never run', () => {
    expect(readRecords(join(temp(), 'Documents/MatrixMedia/data'), Date.now())).toEqual([])
  })
})

describe('verification prefers MatrixMedia’s own record', () => {
  const since = Date.now()
  const at = since + 60_000

  it('calls a success a success even when the exit code said otherwise', () => {
    const result = verifyTarget([{pt: 'dy', publishStatus: 'success', lastPublishAt: at, lastPublishMessage: '发布成功'}],
      'dy', undefined, since, EXIT_CODES.taskFailure, false)
    expect(result.state).toBe('success')
    expect(result.reason).toBe('ok')
    expect(result.message).toBe('发布成功')
    expect(result.publishedAt).toBe(new Date(at).toISOString())
  })

  it('treats a still-publishing record as running, which is why exit 0 is not a success', () => {
    const result = verifyTarget([{pt: 'ks', publishStatus: 'publishing', lastPublishAt: at}], 'ks', undefined, since, EXIT_CODES.success, false)
    expect(result.state).toBe('running')
    expect(result.reason).toBe('record-pending')
  })

  it('reports a scheduled record as scheduled rather than published', () => {
    const result = verifyTarget([{pt: 'blbl', publishStatus: 'scheduled', lastPublishAt: at}], 'blbl', undefined, since, EXIT_CODES.success, false)
    expect(result.state).toBe('scheduled')
    expect(result.reason).toBe('scheduled')
  })

  it('reports failures and expiries from the record', () => {
    for (const status of ['failed', 'expired']) {
      const result = verifyTarget([{pt: 'bjh', publishStatus: status, lastPublishAt: at, lastPublishMessage: '上传超时'}],
        'bjh', undefined, since, EXIT_CODES.success, false)
      expect(result.state).toBe('failed')
      expect(result.reason).toBe('record-failed')
      expect(result.message).toBe('上传超时')
    }
  })

  it('separates two accounts on the same platform by phone', () => {
    const records = [{pt: 'dy', phone: '13800000000', publishStatus: 'failed', lastPublishAt: at},
      {pt: 'dy', phone: '13900000000', publishStatus: 'success', lastPublishAt: at}]
    expect(verifyTarget(records, 'dy', '13800000000', since, EXIT_CODES.success, false).state).toBe('failed')
    expect(verifyTarget(records, 'dy', '13900000000', since, EXIT_CODES.success, false).state).toBe('success')
  })

  it('never reads a record from before the run started', () => {
    const records = [{pt: 'dy', publishStatus: 'success', lastPublishAt: since - 60_000, createTime: since - 60_000}]
    expect(verifyTarget(records, 'dy', undefined, since, EXIT_CODES.success, false).reason).toBe('record-missing')
  })
})

describe('verification without a record never fabricates success', () => {
  const since = Date.now()

  it('leaves exit 0 unconfirmed instead of calling it published', () => {
    const result = verifyTarget([], 'dy', undefined, since, EXIT_CODES.success, false)
    expect(result.state).toBe('unknown')
    expect(result.reason).toBe('record-missing')
    expect(result.message).toContain('矩媒界面')
  })

  it('accepts a draft as a draft, because the user asked for one', () => {
    const result = verifyTarget([], 'dy', undefined, since, EXIT_CODES.success, true)
    expect(result.state).toBe('draft')
    expect(result.reason).toBe('draft')
  })

  it('reports exit 4 as a draft even without a record', () => {
    expect(verifyTarget([], 'dy', undefined, since, EXIT_CODES.draft, false).state).toBe('draft')
  })

  it('reports exit 3 as a failed upload', () => {
    const result = verifyTarget([], 'dy', undefined, since, EXIT_CODES.taskFailure, false)
    expect(result.state).toBe('failed')
    expect(result.message).toContain('退出码 3')
  })

  it('reports a missing epilogue as unknown, not as failure', () => {
    const result = verifyTarget([], 'dy', undefined, since, undefined, false)
    expect(result.state).toBe('unknown')
    expect(result.reason).toBe('no-run')
  })

  it('reports any other code as a failure and says which one', () => {
    for (const code of [EXIT_CODES.error, EXIT_CODES.arguments]) {
      const result = verifyTarget([], 'dy', undefined, since, code, false)
      expect(result.state).toBe('failed')
      expect(result.message).toContain(`退出码 ${code}`)
    }
  })
})
