/** A conversation's original Markdown file, kept separate from publication drafts. */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, linkify: false })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGES = 100
const MAX_METADATA_BYTES = 4096
const MAX_CACHE_ENTRIES = 8
const IMAGE_URI = 'source-image://'

export type SourceImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface SourceImage {
  id: string
  /** An opaque reference; neither the original nor resolved local path crosses the API. */
  src: string
  name: string
  mime: SourceImageMime
  bytes: number
}

export interface SourceSnapshot {
  id: string
  sessionId: string
  /** SHA-256 of the original path, Markdown bytes, and referenced image bytes. */
  revision: string
  fileName: string
  title: string
  /** The original body except that local image destinations are opaque references. */
  body: string
  images: SourceImage[]
}

export interface SourceImageBytes {
  data: Buffer
  mime: SourceImageMime
  name: string
}

interface SourceMetadata {
  version: 1
  id: string
  sessionId: string
  /** Host-only canonical path. Never serialize this object to the client. */
  markdownPath: string
  /** Canonical workspace authorization boundary for Agent-registered sources. */
  allowedRoot?: string
}

type FileIdentity = Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>

interface SourceReference {
  path: string
  canonicalPath: string
  id: string
}

interface CachedImage extends SourceReference {
  identity: FileIdentity
  digest: Buffer
  mime: SourceImageMime
  name: string
  bytes: number
}

interface CachedSource {
  markdownPath: string
  allowedRoot?: string
  markdownIdentity: FileIdentity
  markdownBytes: Buffer
  references: SourceReference[]
  images: Map<string, CachedImage>
  snapshot: SourceSnapshot
}

/** No image bytes are retained; cache entries only hold bounded MD and image digests. */
const sourceCache = new Map<string, CachedSource>()

export interface SourceRegistrationOptions {
  /** The calling Agent's workspace cwd. Files outside it need a separate approved picker flow. */
  allowedRoot?: string
}

function sourceRoot(env: NodeJS.ProcessEnv): string {
  return join(resolveDshHome(undefined, env), 'publisher', 'source-documents')
}

function stableId(namespace: string, value: string): string {
  const bytes = createHash('sha256').update(namespace).update('\0').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function sessionSourceId(sessionId: string): string {
  if (typeof sessionId !== 'string' || sessionId.length === 0
    || Buffer.byteLength(sessionId, 'utf8') > 512 || /[\u0000-\u001f\u007f]/u.test(sessionId)) {
    throw new Error('会话 ID 无效')
  }
  return stableId('publisher-source-session', sessionId)
}

function metadataPath(id: string, env: NodeJS.ProcessEnv): string {
  if (!UUID.test(id)) throw new Error('源文档 ID 无效')
  return join(sourceRoot(env), `${id}.json`)
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function requireAllowedPath(path: string, meta: SourceMetadata, label: string): string {
  let canonical: string
  try { canonical = realpathSync.native(path) }
  catch { throw new Error(`${label}不存在或无法读取`) }
  if (meta.allowedRoot && !inside(meta.allowedRoot, canonical)) {
    throw new Error('源文件或图片超出当前 Agent 工作目录，请将原稿和图片放在当前 Agent 工作目录内再登记')
  }
  return canonical
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

function fileIdentity(path: string, maxBytes: number, label: string): FileIdentity {
  try {
    const entry = lstatSync(path, { bigint: true })
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label}必须是普通文件，不能是符号链接`)
    if (entry.size > BigInt(maxBytes)) throw new Error(`${label}超过大小限制`)
    return entry
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(label)) throw cause
    throw new Error(`${label}不存在或无法读取`)
  }
}

function readRegularFile(path: string, maxBytes: number, label: string): Buffer {
  let descriptor: number | undefined
  try {
    const before = fileIdentity(path, maxBytes, label)
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || !sameIdentity(opened, before)) {
      throw new Error(`${label}在读取时发生变化`)
    }
    const data = readFileSync(descriptor)
    const after = fstatSync(descriptor, { bigint: true })
    if (data.length > maxBytes || BigInt(data.length) !== after.size || !sameIdentity(opened, after)) {
      throw new Error(`${label}在读取时发生变化`)
    }
    return data
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(label)) throw cause
    throw new Error(`${label}不存在或无法读取`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function imageMime(data: Buffer): SourceImageMime | undefined {
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function imageTokens(body: string): string[] {
  const sources: string[] = []
  const visit = (tokens: ReturnType<typeof markdown.parse>): void => {
    for (const token of tokens) {
      if (token.type === 'image') sources.push(token.attrGet('src') ?? '')
      if (token.children) visit(token.children)
    }
  }
  visit(markdown.parse(body, {}))
  return sources
}

interface ImageSyntax {
  start: number
  end: number
  destinationStart: number
  destinationEnd: number
}

function escaped(text: string, index: number): boolean {
  let slashes = 0
  while (index > slashes && text[index - slashes - 1] === '\\') slashes++
  return slashes % 2 === 1
}

/** Locate the source span for ordinary inline images, including balanced parentheses in bare destinations. */
function imageSyntaxAt(text: string, start: number, end: number): ImageSyntax | undefined {
  if (text[start] !== '!' || text[start + 1] !== '[' || escaped(text, start)) return undefined
  let cursor = start + 2
  let brackets = 1
  while (cursor < end && brackets > 0) {
    if (text[cursor] === '\\') { cursor += 2; continue }
    if (text[cursor] === '[') brackets++
    if (text[cursor] === ']') brackets--
    cursor++
  }
  if (brackets !== 0 || text[cursor] !== '(') return undefined
  cursor++
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor++
  const destinationStart = cursor
  if (text[cursor] === '<') {
    cursor++
    while (cursor < end && text[cursor] !== '\r' && text[cursor] !== '\n') {
      if (text[cursor] === '\\') { cursor += 2; continue }
      if (text[cursor++] === '>') break
    }
    if (text[cursor - 1] !== '>') return undefined
  } else {
    let parentheses = 0
    while (cursor < end && text[cursor] !== '\r' && text[cursor] !== '\n') {
      if (text[cursor] === '\\') { cursor += 2; continue }
      if (text[cursor] === '(') { parentheses++; cursor++; continue }
      if (text[cursor] === ')') {
        if (parentheses === 0) break
        parentheses--
        cursor++
        continue
      }
      if (parentheses === 0 && /[ \t]/u.test(text[cursor]!)) break
      cursor++
    }
    if (parentheses !== 0) return undefined
  }
  const destinationEnd = cursor
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor++
  if (text[cursor] === '"' || text[cursor] === "'" || text[cursor] === '(') {
    const closing = text[cursor] === '(' ? ')' : text[cursor]
    cursor++
    while (cursor < end && text[cursor] !== '\r' && text[cursor] !== '\n') {
      if (text[cursor] === '\\') { cursor += 2; continue }
      if (text[cursor++] === closing) break
    }
    if (text[cursor - 1] !== closing) return undefined
    while (text[cursor] === ' ' || text[cursor] === '\t') cursor++
  }
  if (text[cursor] !== ')') return undefined
  return { start, end: cursor + 1, destinationStart, destinationEnd }
}

function lineOffsets(text: string): number[] {
  const offsets = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') offsets.push(index + 1)
  }
  return offsets
}

function codeSpanEnd(text: string, index: number, end: number): number | undefined {
  if (text[index] !== '`' || escaped(text, index)) return undefined
  let ticks = 1
  while (text[index + ticks] === '`') ticks++
  const closing = text.indexOf('`'.repeat(ticks), index + ticks)
  return closing !== -1 && closing < end ? closing + ticks : index + ticks
}

function imageSyntaxInRange(text: string, start: number, end: number): ImageSyntax[] {
  const syntax: ImageSyntax[] = []
  for (let index = start; index < end;) {
    const afterCode = codeSpanEnd(text, index, end)
    if (afterCode !== undefined) { index = afterCode; continue }
    const match = imageSyntaxAt(text, index, end)
    if (match) { syntax.push(match); index = match.end; continue }
    index++
  }
  return syntax
}

function hasRawImageTag(text: string, start: number, end: number): boolean {
  for (let index = start; index < end;) {
    const afterCode = codeSpanEnd(text, index, end)
    if (afterCode !== undefined) { index = afterCode; continue }
    if (text[index] === '<' && /^<img\b/iu.test(text.slice(index, Math.min(end, index + 5)))) return true
    index++
  }
  return false
}

function imagePath(markdownPath: string, src: string): string {
  let decoded: string
  try { decoded = decodeURIComponent(src) } catch { throw new Error('Markdown 图片路径编码无效') }
  if (!decoded || decoded.includes('\0') || decoded.startsWith('//')
    || (!isAbsolute(decoded) && /^[a-z][a-z\d+.-]*:/iu.test(decoded))) {
    throw new Error('Markdown 图片只支持本地文件路径')
  }
  return resolve(dirname(markdownPath), decoded)
}

function titleAndBody(fileName: string, markdownText: string): { title: string; body: string } {
  const heading = /^(?:[ \t]*\r?\n)* {0,3}#[ \t]+([^\r\n]+)(?:\r?\n)?/u.exec(markdownText)
  if (!heading) return { title: fileName.slice(0, -extname(fileName).length), body: markdownText }
  return {
    title: heading[1]!.replace(/[ \t]+#+[ \t]*$/u, '').trim(),
    body: markdownText.slice(heading[0].length).replace(/^(?:[ \t]*\r?\n)*/u, ''),
  }
}

function parseSource(meta: SourceMetadata, markdownBytes: Buffer): {
  fileName: string; title: string; body: string; references: SourceReference[]
} {
  let markdownText: string
  try { markdownText = new TextDecoder('utf-8', { fatal: true }).decode(markdownBytes) }
  catch { throw new Error('Markdown 文件不是有效 UTF-8 文本') }
  const fileName = basename(meta.markdownPath)
  const { title, body } = titleAndBody(fileName, markdownText)
  if (/!\[[^\]]*\]\(/u.test(title)) throw new Error('Markdown 标题不能包含图片引用')
  const tokens = markdown.parse(body, {})
  const offsets = lineOffsets(body)
  const syntax: ImageSyntax[] = []
  const contexts: Array<{ start: number; end: number } | null> = []
  let imageCount = 0
  let inlineCursor = 0
  for (const token of tokens) {
    if (token.nesting === 1) {
      contexts.push(token.map
        ? { start: offsets[token.map[0]] ?? body.length, end: offsets[token.map[1]] ?? body.length }
        : null)
    }
    if (token.type !== 'inline') {
      if (token.nesting === -1) contexts.pop()
      continue
    }
    const parsed = token.children?.filter(child => child.type === 'image').map(child => child.attrGet('src') ?? '') ?? []
    imageCount += parsed.length
    if (imageCount > MAX_IMAGES) throw new Error(`Markdown 图片不能超过 ${MAX_IMAGES} 张`)
    const enclosing = [...contexts].reverse().find(context => context !== null)
    let start: number
    let end: number
    if (token.map) {
      start = offsets[token.map[0]] ?? body.length
      end = offsets[token.map[1]] ?? body.length
    } else if (enclosing) {
      const found = body.indexOf(token.content, Math.max(enclosing.start, inlineCursor))
      if (found < 0 || found + token.content.length > enclosing.end) {
        if (parsed.length > 0) throw new Error('Markdown 图片请使用普通内联写法 ![说明](本地路径)')
        continue
      }
      start = found
      end = found + token.content.length
    } else {
      if (parsed.length > 0) throw new Error('Markdown 图片请使用普通内联写法 ![说明](本地路径)')
      continue
    }
    inlineCursor = end
    if (hasRawImageTag(body, start, end)) throw new Error('Markdown 图片请使用 ![说明](本地路径) 写法')
    if (parsed.length === 0) continue
    const matches = imageSyntaxInRange(body, start, end)
    if (matches.length !== parsed.length || matches.some((match, index) =>
      imageTokens(body.slice(match.start, match.end))[0] !== parsed[index])) {
      throw new Error('Markdown 图片请使用普通内联写法 ![说明](本地路径)')
    }
    syntax.push(...matches)
  }
  const resolved: SourceReference[] = []
  let safeBody = ''
  let position = 0
  for (const match of syntax) {
    const expected = imageTokens(body.slice(match.start, match.end))[0]!
    const path = imagePath(meta.markdownPath, expected)
    const canonicalPath = requireAllowedPath(path, meta, `图片「${basename(path)}」`)
    const id = stableId('publisher-source-image', `${meta.id}\0${canonicalPath}`)
    const src = `${IMAGE_URI}${id}`
    resolved.push({ path, canonicalPath, id })
    safeBody += body.slice(position, match.destinationStart)
    safeBody += body[match.destinationStart] === '<' ? `<${src}>` : src
    position = match.destinationEnd
  }
  safeBody += body.slice(position)
  return { fileName, title, body: safeBody, references: resolved }
}

function copySnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  return { ...snapshot, images: snapshot.images.map(image => ({ ...image })) }
}

function cachePut(key: string, value: CachedSource): void {
  sourceCache.delete(key)
  sourceCache.set(key, value)
  if (sourceCache.size > MAX_CACHE_ENTRIES) sourceCache.delete(sourceCache.keys().next().value!)
}

function cacheMatches(meta: SourceMetadata, cached: CachedSource | undefined): cached is CachedSource {
  return cached?.markdownPath === meta.markdownPath && cached.allowedRoot === meta.allowedRoot
}

function inspect(meta: SourceMetadata, cacheKey: string): SourceSnapshot {
  requireAllowedPath(meta.markdownPath, meta, 'Markdown 文件')
  const markdownIdentity = fileIdentity(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件')
  const prior = sourceCache.get(cacheKey)
  const reusable = cacheMatches(meta, prior) ? prior : undefined
  const sameMarkdown = reusable !== undefined && sameIdentity(markdownIdentity, reusable.markdownIdentity)
  const markdownBytes = sameMarkdown ? reusable.markdownBytes
    : readRegularFile(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件')
  if (!sameIdentity(markdownIdentity, fileIdentity(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件'))) {
    throw new Error('Markdown 文件在读取时发生变化')
  }
  let parsed = sameMarkdown
    ? { fileName: reusable.snapshot.fileName, title: reusable.snapshot.title, body: reusable.snapshot.body, references: reusable.references }
    : parseSource(meta, markdownBytes)
  if (sameMarkdown && parsed.references.some(reference =>
    requireAllowedPath(reference.path, meta, `图片「${basename(reference.path)}」`) !== reference.canonicalPath)) {
    parsed = parseSource(meta, markdownBytes)
  }

  if (sameMarkdown && reusable && parsed.references === reusable.references) {
    const unchanged = parsed.references.every(reference => {
      const old = reusable.images.get(reference.id)
      return old !== undefined && sameIdentity(
        fileIdentity(reference.path, MAX_IMAGE_BYTES, `图片「${basename(reference.path)}」`), old.identity,
      )
    })
    if (unchanged) return copySnapshot(reusable.snapshot)
  }

  // Keep the old revision formula: canonical MD path, raw MD bytes, then each
  // referenced image ID and byte digest in Markdown order.
  const revision = createHash('sha256').update(meta.markdownPath).update('\0').update(markdownBytes)
  const images = new Map<string, SourceImage>()
  const cachedImages = new Map<string, CachedImage>()
  for (const reference of parsed.references) {
    const label = `图片「${basename(reference.path)}」`
    const canonicalPath = requireAllowedPath(reference.path, meta, label)
    if (canonicalPath !== reference.canonicalPath) throw new Error(`${label}在读取时发生变化`)
    const identity = fileIdentity(reference.path, MAX_IMAGE_BYTES, label)
    const old = reusable?.images.get(reference.id)
    let digest: Buffer
    let mime: SourceImageMime
    let bytes: number
    if (old && old.canonicalPath === canonicalPath && sameIdentity(identity, old.identity)) {
      digest = old.digest
      mime = old.mime
      bytes = old.bytes
    } else {
      const data = readRegularFile(reference.path, MAX_IMAGE_BYTES, label)
      if (data.length === 0) throw new Error('Markdown 图片不能为空')
      const detected = imageMime(data)
      if (!detected) throw new Error('Markdown 图片仅支持 JPEG、PNG、WebP 格式')
      if (!sameIdentity(identity, fileIdentity(reference.path, MAX_IMAGE_BYTES, label))) {
        throw new Error(`${label}在读取时发生变化`)
      }
      digest = createHash('sha256').update(data).digest()
      mime = detected
      bytes = data.length
    }
    const name = basename(canonicalPath)
    const item: CachedImage = { ...reference, identity, digest, mime, name, bytes }
    cachedImages.set(reference.id, item)
    if (!images.has(reference.id)) {
      images.set(reference.id, { id: reference.id, src: `${IMAGE_URI}${reference.id}`, name, mime, bytes })
    }
    revision.update(reference.id).update(digest)
  }
  const snapshot: SourceSnapshot = {
    id: meta.id, sessionId: meta.sessionId, revision: revision.digest('hex'),
    fileName: parsed.fileName, title: parsed.title, body: parsed.body, images: [...images.values()],
  }
  cachePut(cacheKey, {
    markdownPath: meta.markdownPath, allowedRoot: meta.allowedRoot,
    markdownIdentity, markdownBytes, references: parsed.references,
    images: cachedImages, snapshot: copySnapshot(snapshot),
  })
  return snapshot
}

function readMetadata(id: string, env: NodeJS.ProcessEnv): SourceMetadata {
  const path = metadataPath(id, env)
  if (!existsSync(path)) throw new Error('源文档不存在')
  const data = readRegularFile(path, MAX_METADATA_BYTES, '源文档元数据')
  let value: unknown
  try { value = JSON.parse(data.toString('utf8')) as unknown }
  catch { throw new Error('源文档元数据无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('源文档元数据无效')
  const meta = value as SourceMetadata
  if (meta.version !== 1 || meta.id !== id || sessionSourceId(meta.sessionId) !== id
    || typeof meta.markdownPath !== 'string' || !isAbsolute(meta.markdownPath)
    || !/\.md$/iu.test(meta.markdownPath)
    || (meta.allowedRoot !== undefined && (typeof meta.allowedRoot !== 'string' || !isAbsolute(meta.allowedRoot)))) {
    throw new Error('源文档元数据无效')
  }
  return meta
}

/** Register the exact original .md file for one Agent conversation. No Markdown copy is made. */
export function registerSourceDocument(
  sessionId: string, markdownPath: string, env: NodeJS.ProcessEnv = process.env,
  options: SourceRegistrationOptions = {},
): SourceSnapshot {
  const id = sessionSourceId(sessionId)
  if (typeof markdownPath !== 'string' || !isAbsolute(markdownPath) || !/\.md$/iu.test(markdownPath)) {
    throw new Error('请选择绝对路径的 .md 文件')
  }
  if (lstatSync(markdownPath).isSymbolicLink()) throw new Error('Markdown 文件不能是符号链接')
  const canonicalPath = realpathSync.native(markdownPath)
  if (!statSync(canonicalPath).isFile()) {
    throw new Error('Markdown 文件必须是普通文件，不能是符号链接')
  }
  const allowedRoot = options.allowedRoot === undefined ? undefined : realpathSync.native(options.allowedRoot)
  if (allowedRoot !== undefined && !statSync(allowedRoot).isDirectory()) throw new Error('Agent 工作目录无效')
  const meta: SourceMetadata = {
    version: 1, id, sessionId, markdownPath: canonicalPath,
    ...(allowedRoot === undefined ? {} : { allowedRoot }),
  }
  const snapshot = inspect(meta, metadataPath(id, env))
  const root = sourceRoot(env)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (lstatSync(root).isSymbolicLink()) throw new Error('源文档目录无效')
  const destination = metadataPath(id, env)
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error('源文档元数据无效')
  const temporary = join(root, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(meta), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
  return snapshot
}

export function readSessionSourceDocument(
  sessionId: string, env: NodeJS.ProcessEnv = process.env,
): SourceSnapshot | null {
  const id = sessionSourceId(sessionId)
  if (!existsSync(metadataPath(id, env))) return null
  return readSourceDocument(id, env)
}

/** Host-only lookup for an Agent editing its original file. Never include this path in a browser snapshot. */
export function readSessionSourceDocumentPath(
  sessionId: string, env: NodeJS.ProcessEnv = process.env,
): string | null {
  const id = sessionSourceId(sessionId)
  if (!existsSync(metadataPath(id, env))) return null
  const meta = readMetadata(id, env)
  requireAllowedPath(meta.markdownPath, meta, 'Markdown 文件')
  fileIdentity(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件')
  return meta.markdownPath
}

export function readSourceDocument(sourceId: string, env: NodeJS.ProcessEnv = process.env): SourceSnapshot {
  return inspect(readMetadata(sourceId, env), metadataPath(sourceId, env))
}

export function readSourceImage(
  sourceId: string, imageId: string, env: NodeJS.ProcessEnv = process.env,
): SourceImageBytes {
  if (!UUID.test(imageId)) throw new Error('源图片 ID 无效')
  const meta = readMetadata(sourceId, env)
  const key = metadataPath(sourceId, env)
  requireAllowedPath(meta.markdownPath, meta, 'Markdown 文件')
  const markdownIdentity = fileIdentity(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件')
  const cached = sourceCache.get(key)
  const references = cacheMatches(meta, cached) && sameIdentity(markdownIdentity, cached.markdownIdentity)
    ? cached.references
    : parseSource(meta, readRegularFile(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件')).references
  const reference = references.find(candidate => candidate.id === imageId)
  if (!reference) throw new Error('源图片不存在')
  const label = `图片「${basename(reference.path)}」`
  const canonicalPath = requireAllowedPath(reference.path, meta, label)
  if (canonicalPath !== reference.canonicalPath
    || stableId('publisher-source-image', `${meta.id}\0${canonicalPath}`) !== imageId) {
    sourceCache.delete(key)
    throw new Error('源图片路径已变化，请重新预览')
  }
  // A source-image GET reads only this image, even when its snapshot is cold.
  const imageIdentity = fileIdentity(reference.path, MAX_IMAGE_BYTES, label)
  const data = readRegularFile(reference.path, MAX_IMAGE_BYTES, label)
  if (data.length === 0) throw new Error('Markdown 图片不能为空')
  const mime = imageMime(data)
  if (!mime) throw new Error('Markdown 图片仅支持 JPEG、PNG、WebP 格式')
  if (!sameIdentity(imageIdentity, fileIdentity(reference.path, MAX_IMAGE_BYTES, label))
    || requireAllowedPath(reference.path, meta, label) !== canonicalPath) {
    sourceCache.delete(key)
    throw new Error(`${label}在读取时发生变化`)
  }
  if (!sameIdentity(markdownIdentity, fileIdentity(meta.markdownPath, MAX_MARKDOWN_BYTES, 'Markdown 文件'))) {
    sourceCache.delete(key)
    throw new Error('Markdown 文件在读取时发生变化')
  }
  const old = cached?.images.get(imageId)
  if (old && (!sameIdentity(imageIdentity, old.identity)
    || !createHash('sha256').update(data).digest().equals(old.digest))) sourceCache.delete(key)
  return { data, mime, name: basename(canonicalPath) }
}
