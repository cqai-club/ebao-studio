/** Read-only access to conversation drafts created by the former Agent workflow. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readContent } from './contents.ts'
import type { PublisherSessionContent } from './protocol.ts'

const CONTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_ASSOCIATION_BYTES = 1024

export function sessionContentsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), 'publisher', 'session-contents')
}

export function readSessionContent(sessionId: string, env: NodeJS.ProcessEnv = process.env): PublisherSessionContent {
  if (typeof sessionId !== 'string' || !sessionId || Buffer.byteLength(sessionId, 'utf8') > 512
    || /[\u0000-\u001f\u007f]/u.test(sessionId)) throw new Error('会话 ID 无效')
  const file = join(sessionContentsRoot(env), `${createHash('sha256').update(sessionId).digest('hex')}.json`)
  if (!existsSync(file)) return { sessionId, contentId: null, revision: null, content: null }
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ASSOCIATION_BYTES) throw new Error('会话草稿关联无效')
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) as unknown }
  catch { throw new Error('会话草稿关联无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会话草稿关联无效')
  const link = value as Record<string, unknown>
  if (link.version !== 1 || link.sessionId !== sessionId || typeof link.contentId !== 'string'
    || !CONTENT_ID.test(link.contentId)) throw new Error('会话草稿关联无效')
  try {
    const content = readContent(link.contentId, env)
    if (content.contentType !== 'article' && content.contentType !== 'image-note') throw new Error('会话草稿内容类型无效')
    return { sessionId, contentId: content.id, revision: content.revision, content }
  } catch (error) {
    if (error instanceof Error && error.message === '草稿不存在') {
      return { sessionId, contentId: null, revision: null, content: null }
    }
    throw error
  }
}
