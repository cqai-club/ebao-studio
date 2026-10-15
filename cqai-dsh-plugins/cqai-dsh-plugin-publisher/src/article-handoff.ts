/** Durable source snapshots and creative briefs for independently owned Publisher content. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import MarkdownIt from 'markdown-it'
import { validAgentSessionId } from './agent-draft-binding.ts'
import {
  addAsset, CONTENT_ID, createContent, directoryFor, discardContent, MAX_ASSET_BYTES,
  MAX_ASSETS, MAX_BODY_BYTES, readAsset, readContent, saveContent,
} from './contents.ts'
import { PLATFORMS, TITLE_MAX, type Platform, type PublisherAsset, type PublisherContent } from './protocol.ts'
import { readSourceDocument, readSourceImage, registerSourceDocument } from './source-documents.ts'
import type {
  PreparePublisherArticleHandoff, PublisherArticleHandoff, PublisherArticleHandoffResult,
  PublisherArticleHandoffSource,
} from './article-handoff-protocol.ts'

export type { PreparePublisherArticleHandoff, PublisherArticleHandoff, PublisherArticleHandoffResult } from './article-handoff-protocol.ts'

const MAX_RECORD_BYTES = 8 * 1024 * 1024
const REVISION = /^[0-9a-f]{64}$/u
const markdown = new MarkdownIt({ html: false, linkify: false })

export interface PublisherArticleHandoffSession {
  header: { cwd?: string; origin?: string }
  snapshotEvents(): readonly SessionEvent[]
}

export interface PublisherArticleHandoffServices {
  session(id: string): PublisherArticleHandoffSession | undefined
  owns(id: string): boolean
}

interface SnapshotAsset {
  id: string
  reference: string
  name: string
  mime: PublisherAsset['mime']
  bytes: number
  sha256: string
}

interface StoredHandoff {
  version: 1
  handoffId: string
  source: PublisherArticleHandoffSource
  title: string
  body: string
  platforms: Platform[]
  instructions?: string
  contentType?: 'article' | 'image-note'
  assets: SnapshotAsset[]
  markdownPath?: string
  allowedRoot?: string
  registrationId?: string
  contentId?: string
  importedRevision?: string
}

function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }

function creationRevision(body: string, assets: readonly SnapshotAsset[]): string {
  return assets.length ? hash(JSON.stringify([body, assets.map(asset => [asset.sha256, asset.mime, asset.bytes, asset.name])])) : hash(body)
}

function imageMetadata(ref: ImageAttachmentRef): string {
  if (!ref || typeof ref.attachmentId !== 'string' || !/^sha256:[0-9a-f]{64}$/iu.test(ref.attachmentId)
    || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > MAX_ASSET_BYTES
    || !Number.isSafeInteger(ref.width) || ref.width < 1 || !Number.isSafeInteger(ref.height) || ref.height < 1
    || ref.name !== undefined && (!validText(ref.name, 255) || /[\u0000-\u001f\u007f]/u.test(ref.name))
    || ref.originalDimensions !== undefined && (!Number.isSafeInteger(ref.originalDimensions?.width)
      || ref.originalDimensions.width < 1 || !Number.isSafeInteger(ref.originalDimensions?.height)
      || ref.originalDimensions.height < 1)) throw new Error('创作任务图片附件引用无效，图片不能超过 20MB')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(ref.mediaType)) {
    throw new Error('创作任务图片只支持 JPEG、PNG、WebP，请转换图片后重新转交')
  }
  return JSON.stringify([ref.attachmentId.toLowerCase(), ref.mediaType, ref.bytes, ref.width, ref.height,
    ref.name ?? null, ref.originalDimensions ? [ref.originalDimensions.width, ref.originalDimensions.height] : null])
}

function imageMime(bytes: Buffer): PublisherAsset['mime'] | undefined {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function creationImages(refs: readonly ImageAttachmentRef[], input: PreparePublisherArticleHandoff['sourceImages'], handoffId: string): { asset: SnapshotAsset; bytes: Buffer }[] {
  if (refs.length > MAX_ASSETS) throw new Error(`创作任务最多 ${MAX_ASSETS} 张图片，请减少素材后重新转交`)
  if (input !== undefined && !Array.isArray(input)) throw new Error('创作任务图片素材无效')
  if ((input?.length ?? 0) !== refs.length) throw new Error('来源请求的图片素材未完整转交，请读取全部图片后重试')
  const loaded: { asset: SnapshotAsset; bytes: Buffer }[] = []
  const seen = new Set<string>()
  for (const [index, expected] of refs.entries()) {
    const expectedMetadata = imageMetadata(expected)
    const image = input![index]
    if (!image || imageMetadata(image.ref) !== expectedMetadata || !(image.data instanceof Uint8Array)) {
      throw new Error('图片素材不属于当前真实用户请求，请重新转交来源图片')
    }
    const bytes = Buffer.from(image.data)
    const digest = hash(bytes)
    if (bytes.length !== expected.bytes || expected.attachmentId.toLowerCase() !== `sha256:${digest}`
      || imageMime(bytes) !== expected.mediaType) throw new Error('创作任务图片字节与引用不一致，请重新读取来源图片')
    if (seen.has(digest)) continue
    seen.add(digest)
    const id = identity(`${handoffId}\0creation-image\0sha256:${digest}`)
    const extension = expected.mediaType === 'image/jpeg' ? '.jpg' : expected.mediaType === 'image/png' ? '.png' : '.webp'
    const name = basename(expected.name ?? `创作素材-${index + 1}${extension}`).slice(0, 160)
    if (!name || name === '.' || name === '..') throw new Error('创作任务图片名称无效')
    loaded.push({ asset: { id, reference: `source-image://${id}`, name, mime: expected.mediaType as PublisherAsset['mime'], bytes: bytes.length, sha256: digest }, bytes })
  }
  return loaded
}

function sourceInstructions(events: readonly SessionEvent[], before: number): string | undefined {
  for (let index = before - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
    if (!text) return undefined
    if (text.length <= 2000) return text
    const prefix = '来源要求节选；完整要求请查看原对话：\n'
    return prefix + text.slice(0, 2000 - prefix.length).replace(/[\uD800-\uDBFF]$/u, '')
  }
  return undefined
}

function identity(value: string): string {
  const bytes = createHash('sha256').update('publisher-article-handoff\0').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function requireId(value: string): string {
  if (!CONTENT_ID.test(value)) throw new Error('文章转交 ID 无效')
  return value
}

function directory(path: string, create = false): boolean {
  if (create && !existsSync(path)) mkdirSync(path, { mode: 0o700 })
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (!entry) return false
  if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(path) !== path) throw new Error('文章转交存储目录无效')
  return true
}

function rootFor(env: NodeJS.ProcessEnv, create = false): string {
  const home = resolveDshHome(undefined, env)
  if (create) mkdirSync(home, { recursive: true, mode: 0o700 })
  const canonical = existsSync(home) ? realpathSync(home) : resolve(home)
  const publisher = join(canonical, 'publisher')
  directory(publisher, create)
  const root = join(publisher, 'article-handoffs')
  directory(root, create)
  return root
}

function readJson(file: string): Record<string, unknown> {
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (!entry) throw new Error('文章转交记录不存在')
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_RECORD_BYTES) throw new Error('文章转交记录无效')
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* Stable storage error below. */ }
  throw new Error('文章转交记录无效')
}

function writeJson(file: string, value: object): void {
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new Error('文章转交记录无效')
  const serialized = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw new Error('文章转交记录过大')
  const pending = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(pending, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(pending, file)
  } finally { if (existsSync(pending)) rmSync(pending) }
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function recordPath(id: string, env: NodeJS.ProcessEnv): string { return join(rootFor(env), `${requireId(id)}.json`) }

function readRecord(id: string, env: NodeJS.ProcessEnv): StoredHandoff {
  const value = readJson(recordPath(id, env)) as unknown as StoredHandoff
  const source = value.source
  if (value.version !== 1 || value.handoffId !== id || !source || source.sourceId !== id
    || !['markdown', 'assistant-message', 'creation-brief'].includes(source.kind) || !REVISION.test(source.revision)
    || !validText(value.title, TITLE_MAX) || !value.title.trim() || typeof value.body !== 'string'
    || Buffer.byteLength(value.body, 'utf8') > MAX_BODY_BYTES || !Array.isArray(value.platforms)
    || value.platforms.some(platform => !(PLATFORMS as readonly string[]).includes(platform))
    || new Set(value.platforms).size !== value.platforms.length
    || value.instructions !== undefined && !validText(value.instructions, 2000)
    || value.contentType !== undefined && !['article', 'image-note'].includes(value.contentType)
    || value.contentId !== undefined && !CONTENT_ID.test(value.contentId)
    || value.importedRevision !== undefined && !REVISION.test(value.importedRevision)
    || !Array.isArray(value.assets) || value.assets.length > MAX_ASSETS) throw new Error('文章转交记录无效')
  validAgentSessionId(source.sessionId)
  if (value.assets.some(asset => !asset || !CONTENT_ID.test(asset.id) || !REVISION.test(asset.sha256)
    || !validText(asset.name, 160) || !asset.name || basename(asset.name) !== asset.name
    || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime)
    || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_ASSET_BYTES
    || asset.reference !== `source-image://${asset.id}`)) throw new Error('文章转交记录无效')
  if (source.kind === 'markdown') {
    if (typeof value.markdownPath !== 'string' || !isAbsolute(value.markdownPath) || resolve(value.markdownPath) !== value.markdownPath
      || typeof value.allowedRoot !== 'string' || !isAbsolute(value.allowedRoot) || resolve(value.allowedRoot) !== value.allowedRoot
      || !CONTENT_ID.test(value.registrationId ?? '') || source.fileName !== basename(value.markdownPath)
      || id !== identity(`${source.sessionId}\0markdown\0${value.markdownPath}`)) throw new Error('文章转交记录无效')
  } else if (source.kind === 'assistant-message') {
    validAgentSessionId(source.messageId)
    if (id !== identity(`${source.sessionId}\0assistant-message\0${source.messageId}`)) throw new Error('文章转交记录无效')
    if (value.registrationId !== undefined) {
      if (!CONTENT_ID.test(value.registrationId) || typeof value.allowedRoot !== 'string'
        || typeof value.markdownPath !== 'string' || !REVISION.test(basename(value.allowedRoot))
        || dirname(value.allowedRoot) !== join(rootFor(env), 'message-sources', id)
        || value.markdownPath !== join(value.allowedRoot, 'source.md')) throw new Error('文章转交记录无效')
    } else if (value.assets.length || value.markdownPath !== undefined || value.allowedRoot !== undefined) {
      throw new Error('文章转交记录无效')
    }
  } else {
    validAgentSessionId(source.requestId)
    if (!value.body.trim() || value.body.length > 8000 || value.source.revision !== creationRevision(value.body, value.assets)
      || value.markdownPath !== undefined || value.allowedRoot !== undefined || value.registrationId !== undefined
      || source.messageId !== undefined || source.fileName !== undefined
      || id !== identity(`${source.sessionId}\0creation-brief\0${source.requestId}\0${value.contentType ?? 'article'}`)) {
      throw new Error('创作任务转交记录无效')
    }
  }
  return value
}

function sourceState(record: StoredHandoff, env: NodeJS.ProcessEnv): { available: boolean; changed: boolean; updateReady: boolean } {
  if (record.source.kind === 'creation-brief') return { available: true, changed: false, updateReady: false }
  let currentRevision = record.source.revision
  let available = true
  if (record.registrationId) {
    try { currentRevision = readSourceDocument(record.registrationId!, env).revision }
    catch { available = false }
  }
  return { available, changed: currentRevision !== (record.importedRevision ?? record.source.revision)
    || Boolean(record.contentId && record.importedRevision !== record.source.revision),
    updateReady: available && currentRevision === record.source.revision
      && Boolean(record.contentId && record.importedRevision && record.importedRevision !== record.source.revision),
  }
}

function dto(record: StoredHandoff, env: NodeJS.ProcessEnv): PublisherArticleHandoff {
  const state = sourceState(record, env)
  return {
    handoffId: record.handoffId, title: record.title,
    excerpt: record.body.replace(/!\[[^\]]*\]\([^)]*\)/gu, '').replace(/[#*_`>]/gu, '').trim().slice(0, 400),
    platforms: [...record.platforms], ...(record.instructions ? { instructions: record.instructions } : {}),
    contentType: record.contentType ?? 'article',
    ...(record.source.kind === 'creation-brief' ? { creationBrief: record.body } : {}),
    source: { kind: record.source.kind, sessionId: record.source.sessionId, sourceId: record.source.sourceId,
      revision: record.source.revision,
      ...(record.source.kind === 'markdown' ? { fileName: record.source.fileName }
        : record.source.kind === 'assistant-message' ? { messageId: record.source.messageId } : { requestId: record.source.requestId }),
    }, ...(record.contentId ? { contentId: record.contentId } : {}),
    sourceChanged: state.changed, sourceAvailable: state.available, updateReady: state.updateReady,
  }
}

function snapshotDirectory(record: StoredHandoff, env: NodeJS.ProcessEnv, create = false): string {
  const root = rootFor(env, create)
  const assets = join(root, 'assets')
  directory(assets, create)
  const source = join(assets, record.handoffId)
  directory(source, create)
  const version = join(source, record.source.revision)
  directory(version, create)
  return version
}

function snapshotBytes(record: StoredHandoff, asset: SnapshotAsset, env: NodeJS.ProcessEnv): Buffer {
  const root = snapshotDirectory(record, env)
  const file = join(root, asset.id)
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.size !== asset.bytes || entry.size > MAX_ASSET_BYTES
    || realpathSync(file) !== file) throw new Error('转交配图快照无效，请重新转交文章')
  const data = readFileSync(file)
  if (data.length !== asset.bytes || hash(data) !== asset.sha256) throw new Error('转交配图快照已变化，请重新转交文章')
  return data
}

function replaceReferences(body: string, ids: Map<string, string>): string {
  let result = body
  for (const [reference, id] of ids) result = result.replaceAll(reference, `ebao-asset://${id}`)
  return result
}

function imageSources(body: string): string[] {
  const sources: string[] = []
  const visit = (tokens: ReturnType<typeof markdown.parse>) => {
    for (const token of tokens) {
      if (token.type === 'image') sources.push(token.attrGet('src') ?? '')
      if (token.children) visit(token.children)
    }
  }
  visit(markdown.parse(body, {}))
  return sources
}

/** Locate a parsed inline image's destination; preserve captions, titles, escaped paths and code examples. */
function inlineImage(body: string, start: number): { end: number; source: string; from: number; to: number } | undefined {
  let brackets = 1
  let cursor = start + 2
  while (cursor < body.length && brackets > 0) {
    if (body[cursor] === '\\') { cursor += 2; continue }
    if (body[cursor] === '[') brackets++
    if (body[cursor] === ']') brackets--
    cursor++
  }
  if (brackets !== 0 || body[cursor] !== '(') return undefined
  const opening = cursor++
  let depth = 1
  let angle = false
  let quote: string | undefined
  while (cursor < body.length && depth > 0) {
    const char = body[cursor]
    if (char === '\\') { cursor += 2; continue }
    if (angle) { if (char === '>') angle = false; cursor++; continue }
    if (char === '<') { angle = true; cursor++; continue }
    if (quote) { if (char === quote) quote = undefined; cursor++; continue }
    if (char === '"' || char === "'") { quote = char; cursor++; continue }
    if (char === '(') depth++
    if (char === ')') depth--
    cursor++
  }
  if (depth !== 0) return undefined
  const end = cursor
  const children = markdown.parseInline(body.slice(start, end), {})[0]?.children ?? []
  if (children.length !== 1 || children[0].type !== 'image') return undefined
  cursor = opening + 1
  while (/\s/u.test(body[cursor] ?? '') && cursor < end - 1) cursor++
  const angled = body[cursor] === '<'
  if (angled) cursor++
  const from = cursor
  if (angled) {
    while (cursor < end - 1 && body[cursor] !== '>') { if (body[cursor] === '\\') cursor++; cursor++ }
  } else {
    let nested = 0
    while (cursor < end - 1) {
      const char = body[cursor]
      if (char === '\\') { cursor += 2; continue }
      if (char === '(') nested++
      if (char === ')') { if (nested === 0) break; nested-- }
      if (/\s/u.test(char) && nested === 0) break
      cursor++
    }
  }
  return { end, source: children[0].attrGet('src') ?? '', from, to: cursor }
}

function rewriteMessageImages(body: string, replacements: Map<string, string>): string {
  const expected = imageSources(body)
  const lines = new Set<number>()
  for (const token of markdown.parse(body, {})) {
    if (token.type !== 'inline' || !token.map || !token.children?.some(child => child.type === 'image')) continue
    for (let line = token.map[0]; line < token.map[1]; line++) lines.add(line)
  }
  let output = ''
  let last = 0
  let line = 0
  let ticks = 0
  let matched = 0
  for (let cursor = 0; cursor < body.length;) {
    const char = body[cursor]
    if (char === '\n') { line++; if (!lines.has(line)) ticks = 0; cursor++; continue }
    if (!lines.has(line)) { cursor++; continue }
    if (char === '`') {
      let count = 1
      while (body[cursor + count] === '`') count++
      if (ticks === 0) ticks = count
      else if (ticks === count) ticks = 0
      cursor += count
      continue
    }
    if (ticks || char !== '!' || body[cursor + 1] !== '[') { cursor++; continue }
    let slashes = 0
    for (let previous = cursor - 1; body[previous] === '\\'; previous--) slashes++
    if (slashes % 2) { cursor++; continue }
    const image = inlineImage(body, cursor)
    if (!image) { cursor++; continue }
    const replacement = replacements.get(image.source)
    if (!replacement || image.source !== expected[matched]) throw new Error('回复图片请使用本地图片的普通 Markdown 行内写法，或改用 Markdown 文件转交')
    output += body.slice(last, image.from) + replacement
    last = image.to
    matched++
    cursor = image.end
  }
  if (matched !== expected.length) throw new Error('回复图片引用暂不支持，请用 Markdown 文件及本地配图重新转交')
  return output + body.slice(last)
}

function inside(root: string, child: string): boolean {
  const tail = relative(root, child)
  return tail !== '' && tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail)
}

function messagePhoto(path: string, cwd: string): { path: string; bytes: Buffer; sha256: string } {
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { throw new Error('回复图片路径无效，请改用 Markdown 文件转交') }
  if (/^file:/iu.test(decoded)) decoded = fileURLToPath(decoded)
  else if (/^[a-z][a-z0-9+.-]*:/iu.test(decoded) && !isAbsolute(decoded)) {
    throw new Error('回复包含云端或附件图片引用，请用 Markdown 文件及本地配图重新转交')
  }
  const candidate = resolve(cwd, decoded)
  const entry = lstatSync(candidate, { throwIfNoEntry: false })
  if (!inside(cwd, candidate) || !entry?.isFile() || entry.isSymbolicLink() || entry.size < 1
    || entry.size > MAX_ASSET_BYTES || realpathSync(candidate) !== candidate) {
    throw new Error('回复配图必须是当前工作区内的普通本地图片，请用 Markdown 文件及本地配图重新转交')
  }
  const bytes = readFileSync(candidate)
  if (bytes.length !== entry.size) throw new Error('回复配图在读取时发生变化，请重试')
  return { path: candidate, bytes, sha256: hash(bytes) }
}

function prepareMessagePhotos(body: string, handoffId: string, cwd: string, env: NodeJS.ProcessEnv) {
  const sources = [...new Set(imageSources(body))]
  if (sources.length > MAX_ASSETS) throw new Error(`每份转交文章最多 ${MAX_ASSETS} 张图片`)
  const photos = sources.map(source => ({ source, ...messagePhoto(source, cwd) }))
  const version = hash(body + '\0' + photos.map(photo => `${photo.source}\0${photo.sha256}`).join('\0'))
  const root = rootFor(env, true)
  const cache = join(root, 'message-sources')
  directory(cache, true)
  const sourceRoot = join(cache, handoffId)
  directory(sourceRoot, true)
  const target = join(sourceRoot, version)
  directory(target, true)
  const replacements = new Map<string, string>()
  const names = new Map<string, string>()
  const created: string[] = []
  try {
    for (const photo of photos) {
      const name = `${photo.sha256}.image`
      const file = join(target, name)
      replacements.set(photo.source, name)
      names.set(name, basename(photo.path).slice(0, 160))
      if (existsSync(file)) {
        const entry = lstatSync(file)
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== photo.bytes.length || hash(readFileSync(file)) !== photo.sha256) {
          throw new Error('文章转交图片缓存无效')
        }
      } else { writeFileSync(file, photo.bytes, { flag: 'wx', mode: 0o600 }); created.push(file) }
    }
    const rewritten = rewriteMessageImages(body, replacements)
    const path = join(target, 'source.md')
    if (existsSync(path)) {
      const entry = lstatSync(path)
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_BODY_BYTES || readFileSync(path, 'utf8') !== rewritten) throw new Error('文章转交正文缓存无效')
    } else { writeFileSync(path, rewritten, { flag: 'wx', mode: 0o600 }); created.push(path) }
    const source = registerSourceDocument(`article-handoff-message:${handoffId}`, path, env, { allowedRoot: target })
    return { source, path, allowedRoot: target, names }
  } catch (cause) { for (const file of created) rmSync(file, { force: true }); throw cause }
}

/** Origin reads need no live Agent or source conversation; no files are created or repaired. */
export function readPublisherArticleOrigin(contentId: string, env: NodeJS.ProcessEnv = process.env): PublisherArticleHandoff | null {
  try {
    requireId(contentId)
    const pointer = join(rootFor(env), `content-${contentId}.json`)
    if (!existsSync(pointer)) return null
    const value = readJson(pointer)
    if (Object.keys(value).sort().join(',') !== 'contentId,handoffId,version'
      || value.version !== 1 || value.contentId !== contentId || typeof value.handoffId !== 'string') return null
    const record = readRecord(value.handoffId, env)
    return record.contentId === contentId ? dto(record, env) : null
  } catch { return null }
}

export class PublisherArticleHandoffs {
  constructor(private readonly services: PublisherArticleHandoffServices, private readonly env: NodeJS.ProcessEnv = process.env) {}

  prepare(input: PreparePublisherArticleHandoff): PublisherArticleHandoff {
    const sessionId = validAgentSessionId(input.sessionId)
    const session = this.services.session(sessionId)
    if (!session || session.header.origin === 'subagent' || this.services.owns(sessionId)) throw new Error('文章转交需要当前普通主对话')
    if ([input.markdownPath, input.messageId, input.creationBrief].filter(value => value !== undefined).length !== 1) {
      throw new Error('请选择一个 Markdown 文件、一条文章回复或一个创作任务')
    }
    if (input.contentType !== undefined && !['article', 'image-note'].includes(input.contentType)) throw new Error('创作任务内容类型无效')
    if (input.creationBrief === undefined && input.contentType === 'image-note') throw new Error('已有原文转交使用文章类型；图文创作请转交创作任务')
    if (input.creationBrief === undefined && input.requestId !== undefined) throw new Error('原文转交不需要创作请求 ID')
    if (input.creationBrief === undefined && input.sourceImages !== undefined) throw new Error('来源请求图片只用于创作任务')
    if (input.title !== undefined && (!validText(input.title, TITLE_MAX) || !input.title.trim())) throw new Error('转交标题无效')
    if (input.instructions !== undefined && !validText(input.instructions, 2000)) throw new Error('发布要求不能超过 2000 字')
    if (input.defaultInstructions !== undefined && !validText(input.defaultInstructions, 2000)) throw new Error('默认发布要求不能超过 2000 字')
    const platforms = input.platforms ?? []
    if (!Array.isArray(platforms) || new Set(platforms).size !== platforms.length
      || platforms.some(platform => !(PLATFORMS as readonly string[]).includes(platform))) throw new Error('转交平台无效')
    let record: StoredHandoff
    const loaded: { asset: SnapshotAsset; bytes: Buffer }[] = []
    if (input.creationBrief !== undefined) {
      if (!validText(input.creationBrief, 8000) || !input.creationBrief.trim()) throw new Error('创作要求必须有内容且不能超过 8000 字')
      const requestId = validAgentSessionId(input.requestId)
      const events = session.snapshotEvents()
      const requestIndex = events.findIndex(event => event.type === 'user/message'
        && event.data.source.kind === 'user' && event.data.id === requestId)
      const request = events[requestIndex]
      if (!request || request.type !== 'user/message') throw new Error('创作任务需要当前对话中的真实用户请求')
      const contentType = input.contentType ?? 'article'
      const body = input.creationBrief.trim()
      const handoffId = identity(`${sessionId}\0creation-brief\0${requestId}\0${contentType}`)
      loaded.push(...creationImages(request.data.content.flatMap(block => block.type === 'image' ? [block.attachment] : []), input.sourceImages, handoffId))
      const assets = loaded.map(image => image.asset)
      record = { version: 1, handoffId, source: { kind: 'creation-brief', sessionId, sourceId: handoffId, revision: creationRevision(body, assets), requestId },
        title: input.title?.trim() ?? (body.split(/\r?\n/u).find(line => line.trim())?.replace(/^#+\s*/u, '').trim().slice(0, TITLE_MAX)
          || (contentType === 'image-note' ? '新图文创作' : '新文章创作')),
        body, contentType, platforms: [...platforms], assets,
      }
      if (input.instructions === undefined) {
        const instructions = sourceInstructions(events, requestIndex + 1)
        if (instructions) record.instructions = instructions
      }
    } else if (input.markdownPath !== undefined) {
      if (!session.header.cwd || !isAbsolute(session.header.cwd) || !isAbsolute(input.markdownPath)
        || input.markdownPath.length > 4096 || input.markdownPath.includes('\0')) throw new Error('请选择当前工作区中的 Markdown 文件')
      const path = realpathSync(input.markdownPath)
      if (lstatSync(input.markdownPath).isSymbolicLink()) throw new Error('Markdown 文件不能是符号链接')
      const allowedRoot = realpathSync(session.header.cwd)
      const handoffId = identity(`${sessionId}\0markdown\0${path}`)
      // This private reader identity does not replace an ordinary conversation's registered preview source.
      const source = registerSourceDocument(`article-handoff:${handoffId}`, path, this.env, { allowedRoot })
      if (source.images.length > MAX_ASSETS) throw new Error(`每份转交文章最多 ${MAX_ASSETS} 张图片`)
      const assets = source.images.map(image => {
        const imageBytes = readSourceImage(source.id, image.id, this.env)
        const asset: SnapshotAsset = { id: image.id, reference: image.src, name: image.name.slice(0, 160),
          mime: imageBytes.mime, bytes: imageBytes.data.length, sha256: hash(imageBytes.data) }
        loaded.push({ asset, bytes: imageBytes.data })
        return asset
      })
      if (readSourceDocument(source.id, this.env).revision !== source.revision) throw new Error('原文在转交时已更新，请重试')
      record = { version: 1, handoffId,
        source: { kind: 'markdown', sessionId, sourceId: handoffId, revision: source.revision, fileName: source.fileName },
        title: input.title?.trim() ?? source.title, body: source.body, platforms: [...platforms], assets,
        markdownPath: path, allowedRoot, registrationId: source.id,
      }
    } else {
      const messageId = validAgentSessionId(input.messageId)
      const events = session.snapshotEvents()
      const eventIndex = events.findIndex(event => event.type === 'assistant/message' && event.data.message.id === messageId)
      const event = events[eventIndex]
      if (!event || event.type !== 'assistant/message') throw new Error('这条文章回复不属于当前对话')
      if (event.data.message.content.some(block => block.type === 'image')) {
        throw new Error('回复含有附件图片，请让 Agent 将文章和配图保存为工作区 Markdown 文件后重新转交')
      }
      const body = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')
      if (!body.trim() || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('所选回复没有可转交的文章正文或正文过大')
      const handoffId = identity(`${sessionId}\0assistant-message\0${messageId}`)
      const title = input.title?.trim() ?? (body.split(/\r?\n/u).find(line => line.trim())?.replace(/^#+\s*/u, '').trim().slice(0, TITLE_MAX) || '转交文章')
      record = { version: 1, handoffId,
        source: { kind: 'assistant-message', sessionId, sourceId: handoffId, revision: hash(body), messageId },
        title, body, platforms: [...platforms], assets: [],
      }
      if (input.instructions === undefined) {
        const instructions = sourceInstructions(events, eventIndex)
        if (instructions) record.instructions = instructions
      }
      if (imageSources(body).length) {
        if (!session.header.cwd || !isAbsolute(session.header.cwd)) throw new Error('无法确定回复配图所在的工作区')
        const cached = prepareMessagePhotos(body, handoffId, realpathSync(session.header.cwd), this.env)
        record.body = cached.source.body
        record.source.revision = cached.source.revision
        record.markdownPath = cached.path
        record.allowedRoot = cached.allowedRoot
        record.registrationId = cached.source.id
        record.assets = cached.source.images.map(image => {
          const bytes = readSourceImage(cached.source.id, image.id, this.env)
          const asset: SnapshotAsset = { id: image.id, reference: image.src, name: cached.names.get(image.name) ?? image.name,
            mime: bytes.mime, bytes: bytes.data.length, sha256: hash(bytes.data) }
          loaded.push({ asset, bytes: bytes.data })
          return asset
        })
      }
    }
    if (input.instructions?.trim()) record.instructions = input.instructions.trim()
    const root = rootFor(this.env, true)
    const file = join(root, `${record.handoffId}.json`)
    if (existsSync(file)) {
      const existing = readRecord(record.handoffId, this.env)
      if (existing.source.sessionId !== sessionId) throw new Error('文章转交归属无效')
      if (existing.source.kind === 'creation-brief') {
        // One human request and content type own one reviewed, immutable brief.
        if (JSON.stringify(record.assets) !== JSON.stringify(existing.assets)) {
          throw new Error('创作任务的原始图片已变化，请通过新的用户请求重新转交')
        }
        record.body = existing.body
        record.source = { ...existing.source }
        record.contentType = existing.contentType ?? 'article'
        record.assets = existing.assets.map(asset => ({ ...asset }))
      }
      if (input.platforms === undefined) record.platforms = [...existing.platforms]
      if (input.instructions === undefined && existing.instructions) record.instructions = existing.instructions
      if (input.title === undefined && record.source.revision === existing.source.revision) record.title = existing.title
      if (existing.contentId) { record.contentId = existing.contentId; record.importedRevision = existing.importedRevision }
    }
    if (input.instructions === undefined && !record.instructions && input.defaultInstructions?.trim()) {
      record.instructions = input.defaultInstructions.trim()
    }
    const created: string[] = []
    try {
      if (loaded.length) {
        const target = snapshotDirectory(record, this.env, true)
        for (const { asset, bytes } of loaded) {
          const path = join(target, asset.id)
          if (existsSync(path)) { snapshotBytes(record, asset, this.env); continue }
          writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
          created.push(path)
        }
      }
      writeJson(file, record)
    } catch (cause) { for (const file of created) rmSync(file, { force: true }); throw cause }
    return dto(record, this.env)
  }

  private record(sessionId: string, id: string): StoredHandoff {
    validAgentSessionId(sessionId)
    const record = readRecord(id, this.env)
    if (record.source.sessionId !== sessionId || this.services.owns(sessionId)) throw new Error('文章转交不属于当前普通对话')
    if (this.services.session(sessionId)?.header.origin === 'subagent') throw new Error('文章转交需要普通主对话')
    return record
  }

  get(sessionId: string, id: string): PublisherArticleHandoff { return dto(this.record(sessionId, id), this.env) }

  open(sessionId: string, id: string): PublisherArticleHandoffResult {
    const record = this.record(sessionId, id)
    if (record.contentId) {
      const content = readContent(record.contentId, this.env)
      const handoff = dto(record, this.env)
      return { handoff, content, sourceChanged: handoff.sourceChanged }
    }
    // Validate every prepared byte before making a content record visible.
    const assets = record.assets.map(asset => ({ asset, bytes: snapshotBytes(record, asset, this.env) }))
    const created = createContent(record.contentType ?? 'article', this.env, record.title)
    try {
      let content = created
      const ids = new Map<string, string>()
      for (const { asset, bytes } of assets) {
        content = addAsset(content.id, asset.name, bytes, this.env, { expectedRevision: content.revision })
        ids.set(asset.reference, content.assets.at(-1)!.id)
      }
      content = saveContent(content.id, { ...content, revision: content.revision,
        title: record.title, body: record.source.kind === 'creation-brief' ? '' : replaceReferences(record.body, ids) }, this.env)
      const updated = { ...record, contentId: content.id, importedRevision: record.source.revision }
      writeJson(join(rootFor(this.env), `content-${content.id}.json`), { version: 1, contentId: content.id, handoffId: record.handoffId })
      writeJson(recordPath(record.handoffId, this.env), updated)
      const handoff = dto(updated, this.env)
      return { handoff, content, sourceChanged: handoff.sourceChanged }
    } catch (cause) {
      try { discardContent(created.id, this.env) } catch { /* Keep the original transfer error. */ }
      const pointer = join(rootFor(this.env), `content-${created.id}.json`)
      if (existsSync(pointer) && !lstatSync(pointer).isSymbolicLink()) rmSync(pointer)
      throw cause
    }
  }

  update(sessionId: string, id: string, expectedContentRevision: number): PublisherArticleHandoffResult {
    const record = this.record(sessionId, id)
    if (record.source.kind === 'creation-brief') throw new Error('创作要求不能覆盖稿件正文，请在发布专属对话中继续创作')
    if (!record.contentId) throw new Error('请先打开发布稿')
    const current = readContent(record.contentId, this.env)
    if (current.contentType !== 'article' || !Number.isSafeInteger(expectedContentRevision)
      || current.revision !== expectedContentRevision) throw new Error('发布稿已修改，请重新查看后再从原文更新')
    if (record.registrationId) {
      const source = readSourceDocument(record.registrationId!, this.env)
      if (source.revision !== record.source.revision) throw new Error('原文已更新，请重新转交并查看最新原文')
    }
    const incoming = record.assets.map(asset => ({ asset, bytes: snapshotBytes(record, asset, this.env) }))
    const ids = new Map<string, string>()
    const allAssets = [...current.assets]
    const files: { path: string; bytes: Buffer }[] = []
    const target = directoryFor(current.id, this.env)
    if (!directory(join(target, 'assets'))) throw new Error('发布稿素材目录无效')
    for (const { asset, bytes } of incoming) {
      const existing = allAssets.find(item => item.mime === asset.mime && item.bytes === asset.bytes && item.sha256 === asset.sha256)
      if (existing) {
        const prior = readAsset(current.id, existing.id, this.env)
        if (hash(prior.data) !== asset.sha256) throw new Error('发布稿已有配图已变化，请先重新上传或整理该图片')
        ids.set(asset.reference, existing.id)
        continue
      }
      if (allAssets.length >= MAX_ASSETS) throw new Error(`发布稿已达到 ${MAX_ASSETS} 张图片，请先整理素材再更新`)
      const next: PublisherAsset = { id: randomUUID(), name: asset.name, mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256 }
      allAssets.push(next)
      ids.set(asset.reference, next.id)
      files.push({ path: join(target, 'assets', next.id), bytes })
    }
    const next: PublisherContent = { ...current, title: record.title, body: replaceReferences(record.body, ids),
      assets: allAssets, revision: current.revision + 1, updatedAt: new Date().toISOString(),
      ...(current.coverAssetId || !allAssets.length ? {} : { coverAssetId: allAssets[0].id }),
    }
    const manifest = join(target, 'manifest.json')
    const before = readFileSync(manifest)
    const created: string[] = []
    let committed = false
    try {
      for (const file of files) { writeFileSync(file.path, file.bytes, { flag: 'wx', mode: 0o600 }); created.push(file.path) }
      if (readContent(current.id, this.env).revision !== current.revision) throw new Error('发布稿已修改，请重新查看后再更新')
      writeJson(manifest, next)
      committed = true
      const validated = readContent(current.id, this.env)
      const updated = { ...record, importedRevision: record.source.revision }
      writeJson(recordPath(record.handoffId, this.env), updated)
      const handoff = dto(updated, this.env)
      return { handoff, content: validated, sourceChanged: handoff.sourceChanged }
    } catch (cause) {
      if (committed) {
        try { writeJson(manifest, JSON.parse(before.toString('utf8')) as object) } catch { /* Preserve the original error. */ }
      }
      for (const file of created) rmSync(file, { force: true })
      throw cause
    }
  }

  origin(contentId: string): PublisherArticleHandoff | null { return readPublisherArticleOrigin(contentId, this.env) }
}
