/** Narrow native bridge for the embedded MatrixMedia Publisher Worker. */

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
] as const

/** One method exposed across Electron main -> DSH Host. */
export type PublisherWorkerMethod = typeof PUBLISHER_WORKER_METHODS[number]

/** Capability answer rendered by the publisher pages without starting a process. */
export interface PublisherRuntimeStatus {
  /** Only macOS packages containing the Universal helper are supported in v1. */
  supported: boolean
  /** Whether the helper process is currently alive. */
  running: boolean
  /** Stable machine-readable reason when unsupported. */
  reason?: 'publisher-not-supported' | 'publisher-worker-missing'
  /** Human-readable diagnostic safe to expose to the local web client. */
  message?: string
}

/** Native-picked file metadata; the absolute path stays in Electron main. */
export interface PublisherLocalVideo {
  id: string
  fileName: string
  title: string
  bytes: number
}

/** Electron-main capability projected into the isolated DSH Host. */
export interface DesktopPublisherRuntime {
  /** Return a side-effect-free support snapshot. */
  status(): PublisherRuntimeStatus
  /** Open the native file chooser and return an opaque selection ID. */
  selectLocalVideo(): Promise<PublisherLocalVideo | null>
  /** Forward one explicitly allowed RPC method. */
  request<T = unknown>(method: PublisherWorkerMethod, params?: unknown, signal?: AbortSignal): Promise<T>
}

/** Reject arbitrary methods before they can cross a process boundary. */
export function isPublisherWorkerMethod(value: unknown): value is PublisherWorkerMethod {
  return typeof value === 'string' && (PUBLISHER_WORKER_METHODS as readonly string[]).includes(value)
}
