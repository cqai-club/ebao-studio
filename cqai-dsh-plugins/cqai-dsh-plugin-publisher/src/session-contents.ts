/** Durable, one-primary-draft association for each native Agent conversation. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  addAsset, createContent, deleteContent, readContent, removeAsset, saveContent,
  type SaveContentInput,
} from './contents.ts'
import type { PublisherContent, PublisherSessionContent } from './protocol.ts'

const CONTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_ASSOCIATION_BYTES = 1024

export interface SessionDraftPatch {
  contentType?: 'article' | 'image-note'
  expectedRevision?: number
  title?: string
  body?: string
  summary?: string
  tags?: string[]
  creativeStatement?: PublisherContent['creativeStatement']
  coverAssetId?: string
  clearCover?: boolean
  assetOrder?: string[]
}

function validSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId.length === 0
    || Buffer.byteLength(sessionId, 'utf8') > 512 || /[\u0000-\u001f\u007f]/u.test(sessionId)) {
    throw new Error('会话 ID 无效')
  }
}

export function sessionContentsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), 'publisher', 'session-contents')
}

function associationPath(sessionId: string, env: NodeJS.ProcessEnv): string {
  validSessionId(sessionId)
  return join(sessionContentsRoot(env), `${createHash('sha256').update(sessionId).digest('hex')}.json`)
}

function linkedContentId(sessionId: string, env: NodeJS.ProcessEnv): string | undefined {
  const file = associationPath(sessionId, env)
  if (!existsSync(file)) return undefined
  if (lstatSync(file).isSymbolicLink() || statSync(file).size > MAX_ASSOCIATION_BYTES) throw new Error('会话草稿关联无效')
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('会话草稿关联无效')
  const link = raw as Record<string, unknown>
  if (link.version !== 1 || link.sessionId !== sessionId || typeof link.contentId !== 'string'
    || !CONTENT_ID.test(link.contentId)) throw new Error('会话草稿关联无效')
  return link.contentId
}

function writeAssociation(sessionId: string, contentId: string, env: NodeJS.ProcessEnv): void {
  const root = sessionContentsRoot(env)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = associationPath(sessionId, env)
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('会话草稿关联无效')
  const temporary = join(root, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, sessionId, contentId }), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}

function existingContent(sessionId: string, env: NodeJS.ProcessEnv): PublisherContent | undefined {
  const id = linkedContentId(sessionId, env)
  if (id === undefined) return undefined
  try {
    const content = readContent(id, env)
    if (content.contentType === 'video') throw new Error('会话草稿内容类型无效')
    return content
  } catch (error) {
    // A deleted draft must not leave the conversation permanently bound to a missing ID.
    if (error instanceof Error && error.message === '草稿不存在') return undefined
    throw error
  }
}

export function readSessionContent(sessionId: string, env: NodeJS.ProcessEnv = process.env): PublisherSessionContent {
  const content = existingContent(sessionId, env) ?? null
  return { sessionId, contentId: content?.id ?? null, revision: content?.revision ?? null, content }
}

/** A first save creates a draft; every later save requires the revision last observed by the Agent. */
export function saveSessionDraft(sessionId: string, patch: SessionDraftPatch, env: NodeJS.ProcessEnv = process.env): PublisherSessionContent {
  const current = existingContent(sessionId, env)
  if (current === undefined && patch.expectedRevision !== undefined) throw new Error('会话尚无草稿，请重新读取后再保存')
  if (current !== undefined && patch.expectedRevision !== current.revision) {
    throw new Error('草稿已在其他页面更新，请重新读取并与用户确认后再保存')
  }
  if (current !== undefined && patch.contentType !== undefined && patch.contentType !== current.contentType) {
    throw new Error('会话主草稿内容类型不可更改')
  }
  if (current === undefined && patch.contentType === undefined) throw new Error('首次保存需选择文章或图文类型')
  if (patch.clearCover === true && patch.coverAssetId !== undefined) throw new Error('不能同时设置和清空封面')

  const created = current === undefined ? createContent(patch.contentType!, env) : undefined
  const source = current ?? created!
  const input: SaveContentInput = {
    revision: source.revision,
    title: patch.title ?? source.title,
    body: patch.body ?? source.body,
    summary: patch.summary ?? source.summary,
    tags: patch.tags ?? source.tags,
    creativeStatement: patch.creativeStatement ?? source.creativeStatement,
    coverAssetId: patch.clearCover === true ? undefined : patch.coverAssetId ?? source.coverAssetId,
    assetOrder: patch.assetOrder ?? source.assets.map(asset => asset.id),
    platformFields: source.platformFields,
  }
  try {
    const saved = saveContent(source.id, input, env)
    if (created !== undefined) writeAssociation(sessionId, saved.id, env)
    return { sessionId, contentId: saved.id, revision: saved.revision, content: saved }
  } catch (error) {
    if (created !== undefined) deleteContent(created.id, env)
    throw error
  }
}

/** Bytes are already validated by AttachmentStore; addAsset validates Publisher limits again. */
export function addSessionImage(
  sessionId: string, expectedRevision: number | undefined, name: string, data: Buffer,
  setAsCover = false, contentType?: 'article' | 'image-note', env: NodeJS.ProcessEnv = process.env,
): PublisherSessionContent {
  const current = existingContent(sessionId, env)
  if (current === undefined && expectedRevision !== undefined) throw new Error('会话尚无草稿，请重新读取后再添加图片')
  if (current === undefined && contentType === undefined) throw new Error('首次添加图片需选择文章或图文类型')
  if (current !== undefined && expectedRevision !== current.revision) {
    throw new Error('草稿已在其他页面更新，请重新读取并与用户确认后再添加图片')
  }
  if (current !== undefined && contentType !== undefined && contentType !== current.contentType) {
    throw new Error('会话主草稿内容类型不可更改')
  }
  if ((current?.contentType ?? contentType) === 'article'
    && data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    throw new Error('文章图片暂不支持 WebP，请选用 JPEG 或 PNG 图片')
  }
  const created = current === undefined ? createContent(contentType!, env) : undefined
  const source = current ?? created!
  try {
    const saved = addAsset(source.id, name, data, env, { expectedRevision: source.revision, setAsCover })
    if (created !== undefined) writeAssociation(sessionId, saved.id, env)
    return { sessionId, contentId: saved.id, revision: saved.revision, content: saved }
  } catch (error) {
    if (created !== undefined) deleteContent(created.id, env)
    throw error
  }
}

/** Remove one chosen image and all of its managed Markdown references in one revision. */
export function removeSessionImage(
  sessionId: string, expectedRevision: number, assetId: string, env: NodeJS.ProcessEnv = process.env,
): PublisherSessionContent {
  const current = existingContent(sessionId, env)
  if (current === undefined) throw new Error('会话尚无草稿，请重新读取后再删除图片')
  if (expectedRevision !== current.revision) throw new Error('草稿已在其他页面更新，请重新读取并与用户确认后再删除图片')
  const saved = removeAsset(current.id, assetId, env, { expectedRevision })
  return { sessionId, contentId: saved.id, revision: saved.revision, content: saved }
}
