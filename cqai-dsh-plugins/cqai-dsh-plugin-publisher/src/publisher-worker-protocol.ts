/** Narrow protocol for the embedded MatrixMedia Publisher Worker. */

/** RPC methods the DSH Host is allowed to send to the Publisher Worker. */
export const PUBLISHER_WORKER_METHODS = [
  'system.health',
  'system.capabilities',
  'accounts.list',
  'accounts.create',
  'accounts.update',
  'accounts.delete',
  'accounts.openLogin',
  'accounts.checkLogin',
  'accounts.openDashboard',
  'accounts.importPreview',
  'accounts.importApply',
  'submissions.create',
  'submissions.list',
  'submissions.delete',
  'submissions.openTarget',
] as const

/** One method exposed by the Worker to the DSH Host. */
export type PublisherWorkerMethod = typeof PUBLISHER_WORKER_METHODS[number]

export function isPublisherWorkerMethod(value: unknown): value is PublisherWorkerMethod {
  return typeof value === 'string' && (PUBLISHER_WORKER_METHODS as readonly string[]).includes(value)
}

/** Error retaining the Worker's stable code. */
export class PublisherWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PublisherWorkerError'
  }
}
