/** Private Host-to-main bridge for the product's account and Publisher capabilities. */
import type { Context } from '@deepseek-ai/cordis'
import { isPublisherWorkerMethod, type DesktopPublisherRuntime, type PublisherRuntimeStatus } from '../../dsh-desktop-shared/src/publisher-runtime.ts'

const METHODS = ['show', 'openExternal', 'publisher.status', 'publisher.selectLocalVideo', 'publisher.readLocalVideoChunk', 'publisher.request'] as const
export type EbaoNativeMethod = typeof METHODS[number]
export interface EbaoNativeRequest { type: 'ebao-native'; requestId: number; method: EbaoNativeMethod; args: unknown[] }
export interface EbaoRuntimeInfo { publisher: PublisherRuntimeStatus; loginCompletionUrl?: string }
export type EbaoNativeHandler = (method: EbaoNativeMethod, args: unknown[], signal: AbortSignal) => Promise<{ value: unknown; publisher: PublisherRuntimeStatus }>

/** Validate method names and bounded request envelopes before they enter the main process. */
export function isEbaoNativeRequest(value: unknown): value is EbaoNativeRequest {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  try { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024) return false } catch { return false }
  return input.type === 'ebao-native' && Number.isSafeInteger(input.requestId) && (input.requestId as number) > 0
    && METHODS.includes(input.method as EbaoNativeMethod) && Array.isArray(input.args) && input.args.length <= 4
    && (input.method !== 'publisher.request' || isPublisherWorkerMethod(input.args[0]))
}

/** The account may open HTTPS sites and local development callbacks, never executable/file URLs. */
export function isEbaoExternalDestination(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 16 * 1024) return false
  try {
    const url = new URL(value)
    return !url.username && !url.password && (url.protocol === 'https:'
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  } catch { return false }
}

const HOST_STATE = Symbol.for('ebao.desktop.native-runtime-state')
interface HostNativeState { sequence: number; info?: Partial<EbaoRuntimeInfo> }

/** Node's process object survives module replacement and is shared by every Host plugin generation. */
function hostNativeState(): HostNativeState {
  const host = process as unknown as Record<symbol, HostNativeState | undefined>
  return host[HOST_STATE] ??= { sequence: 0 }
}

/** Provide native capability before account and Publisher plugins finish their service injections. */
export function installEbaoRuntime(ctx: Context): void {
  const host = hostNativeState()
  const info = host.info ??= JSON.parse(process.env.DSH_EBAO_RUNTIME ?? '{}') as Partial<EbaoRuntimeInfo>
  delete process.env.DSH_EBAO_RUNTIME
  let status: PublisherRuntimeStatus = info.publisher ?? { supported: false, running: false, reason: 'publisher-worker-missing' }
  let disposed = false
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const receive = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const result = value as { type?: unknown; requestId?: unknown; value?: unknown; error?: unknown; code?: unknown; publisher?: PublisherRuntimeStatus }
    if (result.type !== 'ebao-native-result' || !Number.isSafeInteger(result.requestId)) return
    const request = pending.get(result.requestId as number)
    if (!request) return
    pending.delete(result.requestId as number)
    if (result.publisher) { status = result.publisher; info.publisher = status }
    if (typeof result.error === 'string') request.reject(Object.assign(new Error(result.error), { code: result.code }))
    else request.resolve(result.value)
  }
  process.on('message', receive)
  const request = (method: EbaoNativeMethod, args: unknown[] = [], signal?: AbortSignal): Promise<unknown> => {
    if (disposed || !process.connected || !process.send) return Promise.reject(new Error('Desktop native capability is unavailable'))
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (!Number.isSafeInteger(host.sequence) || host.sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error('Desktop native request identity exhausted'))
    const requestId = ++host.sequence
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = (): void => {
      if (process.connected) process.send?.({ type: 'ebao-native-cancel', requestId }, () => {})
      pending.get(requestId)?.reject(signal?.reason ?? new Error('Desktop native request cancelled'))
    }
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      timer = setTimeout(() => { cancel(); reject(new Error('Desktop native request timed out')) }, 6 * 60_000)
      timer.unref()
      signal?.addEventListener('abort', cancel, { once: true })
      process.send!({ type: 'ebao-native', requestId, method, args }, error => { if (error) reject(error) })
    }).finally(() => { clearTimeout(timer); pending.delete(requestId); signal?.removeEventListener('abort', cancel) })
  }
  const publisher: DesktopPublisherRuntime = {
    status: () => ({ ...status }),
    selectLocalVideo: () => request('publisher.selectLocalVideo') as ReturnType<DesktopPublisherRuntime['selectLocalVideo']>,
    readLocalVideoChunk: (id, offset, length, signal) => request('publisher.readLocalVideoChunk', [id, offset, length], signal) as ReturnType<DesktopPublisherRuntime['readLocalVideoChunk']>,
    request: <T>(method: Parameters<DesktopPublisherRuntime['request']>[0], params?: unknown, signal?: AbortSignal) => request('publisher.request', [method, params ?? {}], signal) as Promise<T>,
  }
  ctx.provide('desktopRuntime', {
    publisher, loginCompletionUrl: info.loginCompletionUrl,
    show: () => { void request('show').catch(() => {}) },
    openExternal: (target: string) => request('openExternal', [target]).then(() => {}),
  })
  ctx.effect(() => () => {
    disposed = true
    process.removeListener('message', receive)
    for (const [requestId, item] of pending) {
      if (process.connected) process.send?.({ type: 'ebao-native-cancel', requestId }, () => {})
      item.reject(new Error('Desktop native capability disposed'))
    }
    pending.clear()
  }, 'e宝工坊 native account and Publisher capabilities')
}
