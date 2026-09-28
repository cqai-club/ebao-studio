import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Candidate, Job } from './protocol.ts'
import type { JobStore } from './store.ts'
import type { Secrets } from './secrets.ts'

const allowed = (raw: string): boolean => {
  try {const u = new URL(raw); return u.protocol === 'https:' && (u.hostname === 'pexels.com' || u.hostname.endsWith('.pexels.com') || u.hostname === 'pixabay.com' || u.hostname.endsWith('.pixabay.com'))} catch {return false}
}
async function providerJson(url: string, headers?: HeadersInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, {headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error'})
  if (!response.ok) throw new Error(`素材接口返回 HTTP ${response.status}`)
  return await response.json() as Record<string, unknown>
}
const value = (x: unknown): string => typeof x === 'string' ? x : ''
const obj = (x: unknown): Record<string, unknown> => x && typeof x === 'object' ? x as Record<string, unknown> : {}

export async function searchCandidates(job: Job, secrets: Secrets, store: JobStore, requestedQueries?: string[], signal?: AbortSignal): Promise<void> {
  if (job.onlineSearch === false || job.uploads.filter(item => item.kind !== 'voice').length >= 2) {
    job.candidates = []
    store.persist(job)
    writeFileSync(store.file(job.id, 'media_candidates.json'), '[]\n')
    return
  }
  const keys = await secrets.read()
  const safeError = (error: unknown): string => {
    let detail = error instanceof Error ? error.message : '网络错误'
    for (const key of [keys.pexels, keys.pixabay].filter((key): key is string => !!key)) detail = detail.replaceAll(key, '[REDACTED]')
    return detail
  }
  const queries = [...new Set((requestedQueries?.length ? requestedQueries : [job.title || job.text]).map(query => query.trim().slice(0, 90)).filter(Boolean))].slice(0, 2)
  const orientation = job.aspect === '9:16' ? 'portrait' : 'landscape'
  const candidates: Candidate[] = []
  if (keys.pexels) {
    for (const query of queries) for (const [kind, endpoint] of [['video', 'videos/search'], ['image', 'search']] as const) {
      try {
        const url = `https://api.pexels.com/v1/${endpoint}?query=${encodeURIComponent(query)}&orientation=${orientation}&locale=zh-CN&per_page=4`
        const result = await providerJson(url, {Authorization: keys.pexels}, signal)
        const rows = (kind === 'video' ? result.videos : result.photos) as unknown[] | undefined
        for (const row of rows ?? []) {
          const item = obj(row)
          const files = (item.video_files as unknown[] | undefined)?.map(obj) ?? []
          const src = obj(item.src)
          const media = kind === 'video' ? value(files.find(f => f.quality === 'hd')?.link ?? files[0]?.link) : value(src.large2x ?? src.large)
          const preview = kind === 'video' ? value(item.image) : value(src.medium)
          if (!allowed(media) || !allowed(preview)) continue
          if (!candidates.some(candidate => candidate.id === `pexels-${kind}-${item.id}`)) candidates.push({id: `pexels-${kind}-${item.id}`, provider: 'Pexels', kind, url: media, preview, source: value(item.url), author: value(item.photographer ?? item.user), selected: false})
        }
      } catch (error) {if (signal?.aborted) throw error; store.log(job, `Pexels ${kind}检索失败：${safeError(error)}`)}
    }
  }
  if (keys.pixabay) {
    for (const query of queries) for (const kind of ['video', 'image'] as const) {
      try {
        const endpoint = kind === 'video' ? 'api/videos/' : 'api/'
        const url = `https://pixabay.com/${endpoint}?key=${encodeURIComponent(keys.pixabay)}&q=${encodeURIComponent(query)}&lang=zh&per_page=4&safesearch=true`
        const result = await providerJson(url, undefined, signal)
        for (const raw of (result.hits as unknown[] | undefined) ?? []) {
          const item = obj(raw), videos = obj(item.videos), medium = obj(videos.medium), large = obj(videos.large)
          const media = kind === 'video' ? value(medium.url || large.url) : value(item.largeImageURL)
          const preview = kind === 'video' ? value(medium.thumbnail ?? large.thumbnail) : value(item.previewURL)
          if (!allowed(media)) continue
          if (!candidates.some(candidate => candidate.id === `pixabay-${kind}-${item.id}`)) candidates.push({id: `pixabay-${kind}-${item.id}`, provider: 'Pixabay', kind, url: media, preview, source: value(item.pageURL), author: value(item.user), selected: false})
        }
      } catch (error) {if (signal?.aborted) throw error; store.log(job, `Pixabay ${kind}检索失败：${safeError(error)}`)}
    }
  }
  const firstVideo = candidates.find(item => item.kind === 'video')
  const firstImage = candidates.find(item => item.kind === 'image')
  for (const item of [firstVideo, firstImage].filter((item): item is Candidate => !!item)) item.selected = true
  if (!firstVideo || !firstImage) for (const item of candidates.slice(0, 2)) item.selected = true
  job.candidates = candidates
  store.persist(job)
  writeFileSync(store.file(job.id, 'media_candidates.json'), JSON.stringify(candidates, null, 2))
}

async function safeFetch(url: string, signal: AbortSignal): Promise<Response> {
  for (let hop = 0; hop < 3; hop++) {
    if (!allowed(url)) throw new Error('素材下载地址不受信任')
    const result = await fetch(url, {redirect: 'manual', signal})
    if (result.status < 300 || result.status >= 400) {if (!result.ok) throw new Error(`素材下载失败 HTTP ${result.status}`); return result}
    const next = result.headers.get('location')
    if (!next) throw new Error('素材重定向无目标')
    url = new URL(next, url).href
  }
  throw new Error('素材重定向过多')
}
export async function downloadSelected(job: Job, store: JobStore, signal: AbortSignal): Promise<void> {
  for (const item of job.candidates.filter(candidate => candidate.selected)) {
    const file = candidateLocalFile(item)
    const target = store.file(job.id, file)
    if (existsSync(target) && statSync(target).size > 0) continue
    mkdirSync(dirname(target), {recursive: true})
    const response = await safeFetch(item.url, signal)
    if (!response.body) throw new Error('素材响应没有内容')
    let total = 0
    const limiter = new Transform({transform(chunk, _encoding, callback) {total += chunk.length; callback(total > 250 * 1024 * 1024 ? new Error('素材超过 250 MB') : null, chunk)}})
    const pending = target + '.download'
    try {
      await pipeline(response.body as unknown as NodeJS.ReadableStream, limiter, createWriteStream(pending), {signal})
      if (!total) throw new Error('素材响应为空')
      renameSync(pending, target)
    } catch (error) {rmSync(pending, {force: true}); throw error}
    store.log(job, `已下载素材 ${item.provider} ${item.id}`)
  }
}

export function candidateLocalFile(item: Candidate): string {
  const ext = extname(new URL(item.url).pathname).toLowerCase()
  const suffix = ['.mp4', '.mov', '.webm', '.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : item.kind === 'video' ? '.mp4' : '.jpg'
  return `remotion/public/assets/${item.id}${suffix}`
}
