import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Work } from './protocol.ts'

interface VideoJobFile {
  id?: unknown
  createdAt?: unknown
  options?: { title?: unknown }
}

interface PublishHandoff {
  title?: unknown
  description?: unknown
  tags?: unknown
  ai_generated_disclosure?: unknown
}

export interface ResolvedWork extends Work {
  /** Host-only absolute path. Never serialize this object directly to the browser. */
  file: string
}

const WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_METADATA_BYTES = 1024 * 1024

/** Root shared with e剪宝 by storage convention, without a plugin import edge. */
export function worksRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), 'ejianbao', 'jobs')
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function jsonFile<T>(file: string): T | undefined {
  try {
    const stat = statSync(file)
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : undefined
  } catch {
    return undefined
  }
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.replace(/^#+/u, '').trim())
    .filter(Boolean)
    .slice(0, 8)
}

/** Resolve one e剪宝 id to a canonical final_video.mp4 and its handoff fields. */
export function resolveWork(id: string, env: NodeJS.ProcessEnv = process.env): ResolvedWork {
  if (!WORK_ID.test(id)) throw new Error('作品 ID 无效')
  const root = worksRoot(env)
  if (!existsSync(root)) throw new Error('作品不存在')
  let canonicalRoot: string
  let directory: string
  let video: string
  try {
    canonicalRoot = realpathSync(root)
    directory = realpathSync(join(canonicalRoot, id))
    video = realpathSync(join(directory, 'final_video.mp4'))
  } catch {
    throw new Error('作品成片不存在')
  }
  if (!inside(canonicalRoot, directory)) throw new Error('作品路径无效')
  if (!inside(directory, video) || dirname(video) !== directory || !statSync(video).isFile()) {
    throw new Error('作品成片不存在')
  }
  const job = jsonFile<VideoJobFile>(join(directory, 'job.json')) ?? {}
  if (typeof job.id === 'string' && job.id !== id) throw new Error('作品元数据不匹配')
  const handoff = jsonFile<PublishHandoff>(join(directory, 'publish_package_handoff.json')) ?? {}
  const fallbackTitle = typeof job.options?.title === 'string' ? job.options.title.trim() : ''
  const title = typeof handoff.title === 'string' ? handoff.title.trim() : fallbackTitle
  const description = typeof handoff.description === 'string' ? handoff.description.trim() : ''
  const aiGeneratedDisclosure = typeof handoff.ai_generated_disclosure === 'string'
    ? handoff.ai_generated_disclosure.trim()
    : ''
  const createdAt = typeof job.createdAt === 'string' && Number.isFinite(Date.parse(job.createdAt))
    ? job.createdAt
    : new Date(statSync(video).mtimeMs).toISOString()
  return {
    id,
    title: title || `未命名视频 ${id.slice(0, 8)}`,
    description,
    tags: cleanTags(handoff.tags),
    aiGeneratedDisclosure,
    createdAt,
    bytes: statSync(video).size,
    file: video,
  }
}

/** List only completed, structurally valid e剪宝 works; never expose local paths. */
export function listWorks(env: NodeJS.ProcessEnv = process.env): Work[] {
  const root = worksRoot(env)
  if (!existsSync(root)) return []
  const works: Work[] = []
  for (const id of readdirSync(root)) {
    if (!WORK_ID.test(id)) continue
    try {
      const { file: _file, ...work } = resolveWork(id, env)
      works.push(work)
    } catch {
      // Rendering and half-written task directories are intentionally absent.
    }
  }
  return works.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
