import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Work } from './protocol.ts'

/**
 * e剪宝's own finished videos. The two plugins deliberately do not import each
 * other; they agree on one directory instead — `<DSH home>/ejianbao/jobs/<id>/`,
 * where `<id>/job.json` describes the task and `<id>/final_video.mp4` is the 成片.
 * Reading the JSON structurally keeps the publisher working against any video
 * plugin version that still writes that file.
 */

/** Shape we rely on inside `<job>/job.json`; everything else is ignored. */
interface VideoJobFile {
  id?: string
  createdAt?: string
  status?: string
  options?: {title?: string}
}

/** Root of e剪宝's own task storage, shared with the video plugin by convention. */
export function worksRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), 'ejianbao', 'jobs')
}

/**
 * List every task that actually produced a 成片, newest first.
 * @param env - environment, so a redirected DSH home is honoured.
 */
export function listWorks(env: NodeJS.ProcessEnv = process.env): Work[] {
  const root = worksRoot(env)
  if (!existsSync(root)) return []
  const works: Work[] = []
  for (const id of readdirSync(root)) {
    const dir = join(root, id)
    const video = join(dir, 'final_video.mp4')
    try {
      if (!existsSync(video) || !statSync(video).isFile()) continue
      const meta: VideoJobFile = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')) as VideoJobFile
      const title = String(meta.options?.title ?? '').trim()
      works.push({
        id,
        title: title || `未命名视频 ${id.slice(0, 8)}`,
        file: video,
        createdAt: String(meta.createdAt ?? new Date(statSync(video).mtimeMs).toISOString()),
        bytes: statSync(video).size,
      })
    } catch { /* a half-written task directory is not a work */ }
  }
  return works.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
