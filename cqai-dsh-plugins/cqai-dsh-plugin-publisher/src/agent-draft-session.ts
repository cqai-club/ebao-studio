/** Durable article-to-Agent conversation association, separate from draft revisions. */
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { validAgentSessionId } from './agent-draft-binding.ts'
import { directoryFor, readContent } from './contents.ts'

const FILE_NAME = 'agent-session.json'
const MAX_FILE_BYTES = 1024

function articleDirectory(contentId: string, env: NodeJS.ProcessEnv): string {
  const directory = directoryFor(contentId, env)
  if (readContent(contentId, env).contentType !== 'article') throw new Error('当前 Agent 只支持编辑文章草稿')
  return directory
}

export function readAgentDraftSession(contentId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const file = join(articleDirectory(contentId, env), FILE_NAME)
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error('Agent 会话关联无效')
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) }
  catch { throw new Error('Agent 会话关联无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || (value as Record<string, unknown>).version !== 1) {
    throw new Error('Agent 会话关联无效')
  }
  try { return validAgentSessionId((value as Record<string, unknown>).sessionId) }
  catch { throw new Error('Agent 会话关联无效') }
}

export function writeAgentDraftSession(
  contentId: string, sessionId: string, env: NodeJS.ProcessEnv = process.env,
): void {
  const directory = articleDirectory(contentId, env)
  const validId = validAgentSessionId(sessionId)
  const file = join(directory, FILE_NAME)
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, sessionId: validId }), {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    })
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}
