/** CQAI account transport for the managed-video backend.
 * This module never reads InferFlow credentials or follows upstream download URLs.
 */
export type AccountRequest = (path: `/v1/${string}`, init?: RequestInit, signal?: AbortSignal) => Promise<Response>
const BASE = '/v1/ejianbao' as const
const ID = /^[A-Za-z0-9_-]{1,128}$/
export interface VideoQuote {id: string; amount: number; unit: string; expiresAt: string; displayAmount?: string}
export interface ManagedRun {
  id: string
  status: 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled'
  progress: number
  billedAmount?: number
}
export class ManagedVideoError extends Error {
  constructor(readonly code: string, message: string) {super(message); this.name = 'ManagedVideoError'}
}
function protocol(): never {throw new ManagedVideoError('protocol', '视频服务返回了无效数据，请稍后重试')}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return protocol()
  return value as Record<string, unknown>
}
function id(value: unknown): string {if (typeof value !== 'string' || !ID.test(value)) return protocol(); return value}
function amount(value: unknown): number {if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return protocol(); return value}
function failure(status: number, code?: unknown): ManagedVideoError {
  // Do not echo vendor response bodies: they may contain credentials or internal URLs.
  if (code === 'VIDEO_SUBMISSION_UNKNOWN') return new ManagedVideoError('reconciliation', '云端可能已受理，请勿新建重复任务。请联系管理员核对当前任务的生成和扣费记录。')
  if (code === 'VIDEO_PREPARATION_INTERRUPTED') return new ManagedVideoError('interrupted', '服务端素材准备已中断，请联系管理员检查当前任务')
  if (code === 'VIDEO_SUBMISSION_REJECTED') return new ManagedVideoError('rejected', '平台未受理生成任务，请联系管理员检查服务配置')
  if (code === 'VIDEO_UPLOAD_FAILED') return new ManagedVideoError('upload', '云端素材上传失败，请联系管理员检查素材格式或平台素材容量')
  if (code === 'VIDEO_QUOTE_EXPIRED') return new ManagedVideoError('quote', '报价已过期或文案已变化，请重新获取报价')
  if (status === 401) return new ManagedVideoError('auth', '请先登录 CQAI Club，或重新登录后继续')
  if (status === 402) return new ManagedVideoError('quota', '账户额度不足，请充值后再试')
  if (status === 403) return new ManagedVideoError('forbidden', '当前账户无权访问此视频任务')
  if (status === 404 || status === 501 || status === 503) return new ManagedVideoError('unavailable', '产品视频服务尚未开通，请联系管理员')
  if (status === 409) return new ManagedVideoError('conflict', '任务状态或报价已变化，请刷新后重试')
  if (status === 413) return new ManagedVideoError('size', '素材超出服务允许的大小')
  if (status === 429) return new ManagedVideoError('busy', '视频服务繁忙，请稍后重试')
  return new ManagedVideoError('service', '视频服务请求失败，请稍后重试')
}
export class ManagedVideoProvider {
  constructor(private readonly request: AccountRequest) {}
  private async call(path: `/v1/${string}`, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let response: Response
    try {response = await this.request(path, {...init, redirect: 'error'}, signal)}
    catch {
      if (signal?.aborted) throw new ManagedVideoError('aborted', '已停止等待；云端任务状态请在制作记录中查询')
      throw new ManagedVideoError('network', '无法连接产品视频服务，请检查网络或登录状态')
    }
    if (!response.ok) {
      // Read only a bounded code; untrusted provider messages are never surfaced.
      let code: unknown
      const reader = response.body?.getReader()
      if (reader) {
        try {
          const chunks: Uint8Array[] = []; let size = 0
          while (size <= 8192) {const next = await reader.read(); if (next.done) break; size += next.value.length; if (size <= 8192) chunks.push(next.value)}
          if (size <= 8192) {const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length}; code = JSON.parse(new TextDecoder().decode(bytes)).code}
        } catch { /* Fall back to the HTTP status. */ }
        finally {await reader.cancel()}
      }
      throw failure(response.status, code)
    }
    return response
  }
  private async json(path: `/v1/${string}`, init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.call(path, init, signal)
    try {return record(await response.json())} catch {return protocol()}
  }
  async quote(script: string, signal?: AbortSignal): Promise<VideoQuote> {
    const data = await this.json(`${BASE}/quotes`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({script, mode: 'digitalhuman'})}, signal)
    if (typeof data.unit !== 'string' || data.unit.length > 24 || !data.unit.trim()
      || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) return protocol()
    return {id: id(data.id), amount: amount(data.amount), unit: data.unit, expiresAt: data.expiresAt,
      ...(typeof data.displayAmount === 'string' && /^(?:[¥$]\d+\.\d{4}|\d+\.\d{4} 积分)$/.test(data.displayAmount) ? {displayAmount: data.displayAmount} : {})}
  }
  async create(input: {requestId: string; quoteId: string; script: string; avatar: Blob; voice: Blob; avatarName: string; voiceName: string}, signal?: AbortSignal): Promise<ManagedRun> {
    const form = new FormData()
    form.set('quoteId', id(input.quoteId)); form.set('script', input.script)
    form.set('avatar', input.avatar, input.avatarName); form.set('voice', input.voice, input.voiceName)
    const data = await this.json(`${BASE}/runs`, {method: 'POST', headers: {'idempotency-key': id(input.requestId)}, body: form}, signal)
    return this.parseRun(data)
  }
  async status(runId: string, signal?: AbortSignal): Promise<ManagedRun> {
    return this.parseRun(await this.json(`${BASE}/runs/${id(runId)}`, {method: 'GET'}, signal))
  }
  async cancel(runId: string, signal?: AbortSignal): Promise<ManagedRun> {
    return this.parseRun(await this.json(`${BASE}/runs/${id(runId)}/cancel`, {method: 'POST'}, signal))
  }
  async download(runId: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await this.call(`${BASE}/runs/${id(runId)}/video`, {method: 'GET'}, signal)
    if (!response.headers.get('content-type')?.startsWith('video/mp4') || !response.body) {await response.body?.cancel(); return protocol()}
    return response.body
  }
  private parseRun(data: Record<string, unknown>): ManagedRun {
    if (!['queued', 'generating', 'completed', 'failed', 'cancelled'].includes(String(data.status))
      || typeof data.progress !== 'number' || !Number.isFinite(data.progress) || data.progress < 0 || data.progress > 100) return protocol()
    return {id: id(data.id), status: data.status as ManagedRun['status'], progress: data.progress,
      ...(data.billedAmount === undefined ? {} : {billedAmount: amount(data.billedAmount)})}
  }
}
