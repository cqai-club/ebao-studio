import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { resolveWork } from './works.ts'

const MAX_CHUNK_BYTES = 1024 * 1024

export type LocalVideoChunkResult =
  | { ok: true; bytes: number; dataBase64: string }
  | { ok: false; code: 'invalid-video-selection' | 'video-selection-expired' | 'video-file-changed'; message: string }

export interface LocalVideoReader {
  readLocalVideoChunk(id: string, offset: number, length: number, signal?: AbortSignal): Promise<LocalVideoChunkResult>
}

export class VideoPreviewError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function videoRange(range: string | undefined, bytes: number): { start: number; end: number; status: 200 | 206 } | null {
  if (!Number.isSafeInteger(bytes) || bytes < 1) return null
  if (range === undefined) return { start: 0, end: bytes - 1, status: 200 }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range)
  if (!match || (!match[1] && !match[2])) return null
  const first = match[1] ? Number(match[1]) : undefined
  const last = match[2] ? Number(match[2]) : undefined
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) return null
  const start = first === undefined ? Math.max(0, bytes - last!) : first
  const end = first === undefined ? bytes - 1 : last === undefined ? bytes - 1 : Math.min(last, bytes - 1)
  if ((first === undefined && last === 0) || start >= bytes || start > end) return null
  return { start, end, status: 206 }
}

function localError(result: Extract<LocalVideoChunkResult, { ok: false }>): VideoPreviewError {
  return new VideoPreviewError(result.code === 'video-file-changed' ? 409 : 404,
    result.code === 'video-file-changed' ? '本地视频已发生变化，请重新选择文件' : '本地视频选择已失效，请重新选择文件')
}

function headers(bytes: number, range: { start: number; end: number; status: 200 | 206 }) {
  return {
    'content-type': 'video/mp4',
    'content-length': String(range.end - range.start + 1),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    ...(range.status === 206 ? { 'content-range': `bytes ${range.start}-${range.end}/${bytes}` } : {}),
  }
}

/** Stream an opaque video selection without returning either file path to the renderer. */
export async function serveVideoPreview(
  req: IncomingMessage, res: ServerResponse, kind: 'work' | 'local', id: string, local: LocalVideoReader,
): Promise<void> {
  const controller = new AbortController()
  const onClose = () => { if (!res.writableEnded) controller.abort() }
  req.once('aborted', onClose)
  res.once('close', onClose)
  try {
    let bytes: number
    let workFile: string | undefined
    if (kind === 'work') {
      try {
        const work = resolveWork(id)
        bytes = work.bytes
        workFile = work.file
      } catch { throw new VideoPreviewError(404, 'e剪宝成片不存在，请重新选择') }
    } else {
      const inspected = await local.readLocalVideoChunk(id, 0, 0, controller.signal)
      if (!inspected.ok) throw localError(inspected)
      bytes = inspected.bytes
    }
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new VideoPreviewError(404, '视频文件不存在或为空')
    const header = req.headers.range
    const range = videoRange(typeof header === 'string' ? header : header === undefined ? undefined : '', bytes)
    if (!range) {
      res.writeHead(416, {
        'content-range': `bytes */${bytes}`, 'accept-ranges': 'bytes',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      })
      res.end()
      return
    }
    const readLocalChunk = async (offset: number, length: number): Promise<Buffer> => {
      const result = await local.readLocalVideoChunk(id, offset, length, controller.signal)
      if (!result.ok) throw localError(result)
      if (result.bytes !== bytes) throw new VideoPreviewError(409, '本地视频已发生变化，请重新选择文件')
      const chunk = Buffer.from(result.dataBase64, 'base64')
      if (chunk.length < 1 || chunk.length > length) throw new VideoPreviewError(502, '视频读取失败，请重试')
      return chunk
    }
    const firstChunk = workFile ? undefined : await readLocalChunk(range.start, Math.min(MAX_CHUNK_BYTES, range.end - range.start + 1))
    res.writeHead(range.status, headers(bytes, range))
    if (workFile) {
      await pipeline(createReadStream(workFile, { start: range.start, end: range.end }), res, { signal: controller.signal })
      return
    }
    let offset = range.start
    if (firstChunk) {
      offset += firstChunk.length
      if (!res.write(firstChunk)) await once(res, 'drain', { signal: controller.signal })
    }
    for (; offset <= range.end && !controller.signal.aborted;) {
      const length = Math.min(MAX_CHUNK_BYTES, range.end - offset + 1)
      const chunk = await readLocalChunk(offset, length)
      offset += chunk.length
      if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal })
    }
    if (!controller.signal.aborted) res.end()
  } finally {
    req.off('aborted', onClose)
    res.off('close', onClose)
  }
}
