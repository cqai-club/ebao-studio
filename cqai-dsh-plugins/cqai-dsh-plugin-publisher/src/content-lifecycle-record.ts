/** Shared read-only lifecycle metadata, independent of content storage and Host services. */
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ContentLifecycleIntent {
  version: 1
  operationId: string
  kind: 'trash' | 'restore'
  status: 'pending' | 'complete'
  sessionId: string | null
  restoreSession: boolean
}

export function readContentLifecycleRecord(directory: string): ContentLifecycleIntent | null {
  const file = join(directory, 'content-lifecycle.json')
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('内容回收操作记录无效')
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) }
  catch { throw new Error('内容回收操作记录无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内容回收操作记录无效')
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'kind,operationId,restoreSession,sessionId,status,version'
    || record.version !== 1 || typeof record.operationId !== 'string'
    || !['trash', 'restore'].includes(String(record.kind)) || !['pending', 'complete'].includes(String(record.status))
    || (record.sessionId !== null && typeof record.sessionId !== 'string')
    || typeof record.restoreSession !== 'boolean') throw new Error('内容回收操作记录无效')
  return record as unknown as ContentLifecycleIntent
}
