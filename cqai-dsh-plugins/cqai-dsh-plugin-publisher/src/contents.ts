import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  CREATIVE_STATEMENTS, DESCRIPTION_MAX, MAX_TAGS, PLATFORMS, TITLE_MAX,
  type Platform, type PublisherAsset, type PublisherContent, type PublisherContentType,
  type PublisherPlatformVariant, type PublisherVideoSource,
} from './protocol.ts'

export const CONTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const MAX_ASSET_BYTES = 20 * 1024 * 1024
export const MAX_ASSETS = 20
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

export function contentsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), 'publisher', 'contents')
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function requireId(id: string): void {
  if (!CONTENT_ID.test(id)) throw new Error('草稿 ID 无效')
}

function validVideoSource(value: unknown): value is PublisherVideoSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  if (source.kind === 'work') return Object.keys(source).length === 2 && typeof source.workId === 'string' && CONTENT_ID.test(source.workId)
  return source.kind === 'local' && Object.keys(source).length === 4
    && typeof source.localVideoId === 'string' && CONTENT_ID.test(source.localVideoId)
    && typeof source.fileName === 'string' && source.fileName.length > 0 && source.fileName.length <= 255
    && basename(source.fileName) === source.fileName && !source.fileName.includes('\\') && source.fileName.toLowerCase().endsWith('.mp4')
    && typeof source.bytes === 'number' && Number.isSafeInteger(source.bytes) && source.bytes > 0
}

function directoryFor(id: string, env: NodeJS.ProcessEnv = process.env): string {
  requireId(id)
  const root = contentsRoot(env)
  if (!existsSync(root)) throw new Error('草稿不存在')
  const canonicalRoot = realpathSync(root)
  const candidate = join(canonicalRoot, id)
  if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) throw new Error('草稿不存在')
  const directory = realpathSync(candidate)
  if (!inside(canonicalRoot, directory) || directory === canonicalRoot || !statSync(directory).isDirectory()) {
    throw new Error('草稿路径无效')
  }
  return directory
}

function readManifest(directory: string): PublisherContent {
  const file = join(directory, 'manifest.json')
  if (lstatSync(file).isSymbolicLink() || statSync(file).size > MAX_MANIFEST_BYTES) throw new Error('草稿数据无效')
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('草稿数据无效')
  const content = value as PublisherContent
  if (!CONTENT_ID.test(content.id) || content.id !== basename(directory)
    || !['article', 'image-note', 'video'].includes(content.contentType)
    || !Number.isSafeInteger(content.revision) || content.revision < 1
    || typeof content.createdAt !== 'string' || typeof content.updatedAt !== 'string'
    || typeof content.title !== 'string' || content.title.length > TITLE_MAX
    || typeof content.body !== 'string' || Buffer.byteLength(content.body, 'utf8') > MAX_BODY_BYTES
    || typeof content.summary !== 'string' || content.summary.length > 2000
    || !Array.isArray(content.tags) || content.tags.length > MAX_TAGS
    || content.tags.some(tag => typeof tag !== 'string' || tag.length > 100)
    || !(CREATIVE_STATEMENTS as readonly string[]).includes(content.creativeStatement)
    || !Array.isArray(content.assets) || content.assets.length > MAX_ASSETS
    || content.assets.some(asset => !asset || !CONTENT_ID.test(asset.id)
      || typeof asset.name !== 'string' || typeof asset.bytes !== 'number'
      || asset.bytes < 1 || asset.bytes > MAX_ASSET_BYTES
      || (asset.sha256 !== undefined && !/^[0-9a-f]{64}$/u.test(asset.sha256))
      || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime))
    || !content.platformFields || typeof content.platformFields !== 'object' || Array.isArray(content.platformFields)
    || (content.coverAssetId !== undefined && !content.assets.some(asset => asset.id === content.coverAssetId))
    || (content.contentType === 'video' && (content.body !== '' || content.summary !== ''
      || content.assets.length !== 0 || content.coverAssetId !== undefined
      || Object.keys(content.platformFields).length !== 0
      || (content.platformVariants !== undefined && (!content.platformVariants
        || typeof content.platformVariants !== 'object' || Array.isArray(content.platformVariants)
        || Object.keys(content.platformVariants).length !== 0))
      || typeof content.description !== 'string' || content.description.length > DESCRIPTION_MAX
      || typeof content.shortTitle !== 'string' || content.shortTitle.length > 32
      || (content.videoSource !== undefined && !validVideoSource(content.videoSource))))
    || (content.contentType !== 'video' && (content.videoSource !== undefined
      || content.description !== undefined || content.shortTitle !== undefined))) {
    throw new Error('草稿数据无效')
  }
  if (content.platformVariants !== undefined) {
    try { cleanVariants(content.platformVariants, content.assets.map(asset => asset.id)) }
    catch { throw new Error('草稿数据无效') }
  }
  return content
}

function writeManifest(directory: string, content: PublisherContent): void {
  const file = join(directory, 'manifest.json')
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  const serialized = JSON.stringify(content, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('草稿及平台版本总量过大')
  try {
    writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}

export function readContent(id: string, env: NodeJS.ProcessEnv = process.env): PublisherContent {
  return readManifest(directoryFor(id, env))
}

export function listContents(env: NodeJS.ProcessEnv = process.env): PublisherContent[] {
  const root = contentsRoot(env)
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap(id => {
    try { return [readContent(id, env)] } catch { return [] }
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function createContent(contentType: PublisherContentType, env: NodeJS.ProcessEnv = process.env): PublisherContent {
  if (!['article', 'image-note', 'video'].includes(contentType)) throw new Error('内容类型无效')
  const root = contentsRoot(env)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  const directory = join(realpathSync(root), id)
  mkdirSync(directory, { mode: 0o700 })
  mkdirSync(join(directory, 'assets'), { mode: 0o700 })
  const now = new Date().toISOString()
  const content: PublisherContent = {
    id, contentType, revision: 1, createdAt: now, updatedAt: now,
    title: '', body: '', summary: '', tags: [], creativeStatement: 'none',
    assets: [], platformFields: {}, platformVariants: {},
    ...(contentType === 'video' ? { description: '', shortTitle: '' } : {}),
  }
  writeManifest(directory, content)
  return content
}

export interface SaveContentInput {
  revision: number
  title: string
  body: string
  summary: string
  tags: string[]
  creativeStatement: PublisherContent['creativeStatement']
  coverAssetId?: string
  assetOrder?: string[]
  platformFields?: PublisherContent['platformFields']
  platformVariants?: PublisherContent['platformVariants']
  description?: string
  shortTitle?: string
  videoSource?: PublisherVideoSource
}

function cleanFields(value: PublisherContent['platformFields'] | undefined): PublisherContent['platformFields'] {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('平台字段无效')
  const result: PublisherContent['platformFields'] = {}
  for (const [platform, fields] of Object.entries(value)) {
    if (!(PLATFORMS as readonly string[]).includes(platform) || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new Error('平台字段无效')
    }
    if (Object.keys(fields).length > 12) throw new Error('平台字段过多')
    const row: Record<string, string> = {}
    for (const [key, text] of Object.entries(fields)) {
      if (!/^[a-z][a-zA-Z0-9]{0,39}$/u.test(key) || typeof text !== 'string' || text.length > 500) throw new Error('平台字段无效')
      row[key] = text.trim()
    }
    result[platform as Platform] = row
  }
  return result
}

function cleanVariants(value: PublisherContent['platformVariants'], assetIds: string[]): NonNullable<PublisherContent['platformVariants']> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('平台版本无效')
  const result: NonNullable<PublisherContent['platformVariants']> = {}
  for (const [platform, input] of Object.entries(value)) {
    if (!(PLATFORMS as readonly string[]).includes(platform) || !input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('平台版本无效')
    }
    const allowed = ['title', 'body', 'summary', 'tags', 'coverAssetId', 'assetOrder']
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('平台版本字段无效')
    const variant = input as PublisherPlatformVariant
    if ((variant.title !== undefined && (typeof variant.title !== 'string' || variant.title.length > TITLE_MAX))
      || (variant.body !== undefined && (typeof variant.body !== 'string' || Buffer.byteLength(variant.body, 'utf8') > MAX_BODY_BYTES))
      || (variant.summary !== undefined && (typeof variant.summary !== 'string' || variant.summary.length > 2000))) {
      throw new Error('平台版本文案无效')
    }
    if (variant.tags !== undefined && (!Array.isArray(variant.tags) || variant.tags.length > MAX_TAGS
      || variant.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100))) {
      throw new Error('平台版本标签无效')
    }
    const tags = variant.tags?.map(tag => tag.replace(/^#+/u, '').trim())
    if (tags?.some(tag => !tag)) throw new Error('平台版本标签无效')
    if (variant.coverAssetId !== undefined && variant.coverAssetId !== null
      && (typeof variant.coverAssetId !== 'string' || !assetIds.includes(variant.coverAssetId))) {
      throw new Error('平台版本封面无效')
    }
    if (variant.assetOrder !== undefined && (!Array.isArray(variant.assetOrder)
      || new Set(variant.assetOrder).size !== variant.assetOrder.length
      || variant.assetOrder.some(assetId => typeof assetId !== 'string' || !assetIds.includes(assetId)))) {
      throw new Error('平台版本素材顺序无效')
    }
    result[platform as Platform] = {
      ...(variant.title === undefined ? {} : { title: variant.title.trim() }),
      ...(variant.body === undefined ? {} : { body: variant.body }),
      ...(variant.summary === undefined ? {} : { summary: variant.summary.trim() }),
      ...(tags === undefined ? {} : { tags: [...new Set(tags)] }),
      ...(variant.coverAssetId === undefined ? {} : { coverAssetId: variant.coverAssetId }),
      ...(variant.assetOrder === undefined ? {} : { assetOrder: [...variant.assetOrder] }),
    }
  }
  return result
}

export function saveContent(id: string, input: SaveContentInput, env: NodeJS.ProcessEnv = process.env): PublisherContent {
  const directory = directoryFor(id, env)
  const current = readManifest(directory)
  if (input.revision !== current.revision) throw new Error('草稿已在其他页面更新，请重新加载后再保存')
  if (typeof input.title !== 'string' || input.title.length > TITLE_MAX
    || typeof input.body !== 'string' || Buffer.byteLength(input.body, 'utf8') > MAX_BODY_BYTES
    || typeof input.summary !== 'string' || input.summary.length > 2000) throw new Error('草稿内容过大或格式无效')
  if (!Array.isArray(input.tags) || input.tags.length > MAX_TAGS
    || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)) throw new Error('标签无效')
  if (!(CREATIVE_STATEMENTS as readonly string[]).includes(input.creativeStatement)) throw new Error('内容声明无效')
  if (current.contentType === 'video') {
    if (input.body !== '' || input.summary !== '' || input.coverAssetId !== undefined
      || (input.platformVariants !== undefined && (!input.platformVariants
        || typeof input.platformVariants !== 'object' || Array.isArray(input.platformVariants)
        || Object.keys(input.platformVariants).length !== 0))
      || (input.platformFields !== undefined && (!input.platformFields || typeof input.platformFields !== 'object'
        || Array.isArray(input.platformFields) || Object.keys(input.platformFields).length !== 0))
      || typeof input.description !== 'string' || input.description.length > DESCRIPTION_MAX
      || typeof input.shortTitle !== 'string' || input.shortTitle.length > 32
      || (input.videoSource !== undefined && !validVideoSource(input.videoSource))) throw new Error('视频草稿字段无效')
  } else if (input.description !== undefined || input.shortTitle !== undefined || input.videoSource !== undefined) {
    throw new Error('草稿内容类型不匹配')
  }
  const ids = current.assets.map(asset => asset.id)
  const assetOrder = input.assetOrder ?? ids
  if (!Array.isArray(assetOrder) || assetOrder.length !== ids.length
    || new Set(assetOrder).size !== ids.length || assetOrder.some(assetId => !ids.includes(assetId))) throw new Error('素材顺序无效')
  if (input.coverAssetId !== undefined && !ids.includes(input.coverAssetId)) throw new Error('封面素材无效')
  const byId = new Map(current.assets.map(asset => [asset.id, asset]))
  const next: PublisherContent = {
    ...current,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    title: input.title.trim(),
    body: input.body,
    summary: input.summary.trim(),
    tags: [...new Set(input.tags.map(tag => tag.replace(/^#+/u, '').trim()))],
    creativeStatement: input.creativeStatement,
    assets: assetOrder.map(assetId => byId.get(assetId)!),
    platformFields: cleanFields(input.platformFields),
    platformVariants: cleanVariants(input.platformVariants === undefined ? current.platformVariants : input.platformVariants, ids),
    ...(current.contentType === 'video' ? {
      description: input.description!.trim(), shortTitle: input.shortTitle!.trim(),
      ...(input.videoSource ? { videoSource: input.videoSource } : {}),
    } : {}),
  }
  if (current.contentType === 'video' && !input.videoSource) delete next.videoSource
  if (input.coverAssetId) next.coverAssetId = input.coverAssetId
  else delete next.coverAssetId
  writeManifest(directory, next)
  return next
}

export function duplicateContent(id: string, env: NodeJS.ProcessEnv = process.env): PublisherContent {
  const source = readContent(id, env)
  const created = createContent(source.contentType, env)
  const target = directoryFor(created.id, env)
  const origin = directoryFor(id, env)
  try {
    for (const asset of source.assets) {
      const sourceAsset = safeAssetPath(origin, asset.id)
      copyFileSync(sourceAsset, join(target, 'assets', asset.id))
    }
    const copy = { ...source, id: created.id, revision: 1, createdAt: created.createdAt, updatedAt: created.updatedAt, title: source.title ? `${source.title.slice(0, TITLE_MAX - 4)}（副本）` : '' }
    writeManifest(target, copy)
    return copy
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
}

export function deleteContent(id: string, env: NodeJS.ProcessEnv = process.env): void {
  rmSync(directoryFor(id, env), { recursive: true })
}

function imageType(data: Buffer): PublisherAsset['mime'] | undefined {
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function safeAssetPath(directory: string, id: string): string {
  requireId(id)
  const assets = join(directory, 'assets')
  if (lstatSync(assets).isSymbolicLink()) throw new Error('素材路径无效')
  const candidate = join(assets, id)
  if (lstatSync(candidate).isSymbolicLink()) throw new Error('素材路径无效')
  const resolved = realpathSync(candidate)
  if (!inside(realpathSync(assets), resolved) || !statSync(resolved).isFile()) throw new Error('素材路径无效')
  return resolved
}

export function addAsset(
  id: string, name: string, data: Buffer, env: NodeJS.ProcessEnv = process.env,
  options: { expectedRevision?: number; setAsCover?: boolean } = {},
): PublisherContent {
  const directory = directoryFor(id, env)
  const content = readManifest(directory)
  if (options.expectedRevision !== undefined && options.expectedRevision !== content.revision) {
    throw new Error('草稿已在其他页面更新，请重新加载后再添加图片')
  }
  if (content.contentType === 'video') throw new Error('视频草稿不支持图片素材')
  if (content.assets.length >= MAX_ASSETS) throw new Error(`每份内容最多 ${MAX_ASSETS} 个素材`)
  if (data.length < 1 || data.length > MAX_ASSET_BYTES) throw new Error('单张图片不能超过 20MB')
  const mime = imageType(data)
  if (!mime) throw new Error('仅支持 JPEG、PNG、WebP 图片')
  const safeName = basename(name).slice(0, 160)
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('素材名称无效')
  const asset: PublisherAsset = { id: randomUUID(), name: safeName, mime, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
  const file = join(directory, 'assets', asset.id)
  writeFileSync(file, data, { flag: 'wx', mode: 0o600 })
  try {
    const next: PublisherContent = {
      ...content, revision: content.revision + 1, updatedAt: new Date().toISOString(), assets: [...content.assets, asset],
      // An explicit platform subset is a deliberate selection; new images remain unselected there.
      platformVariants: content.platformVariants,
      ...(options.setAsCover || content.contentType === 'article' && !content.coverAssetId ? { coverAssetId: asset.id } : {}),
    }
    writeManifest(directory, next)
    return next
  } catch (error) {
    rmSync(file, { force: true })
    throw error
  }
}

export function removeAsset(
  id: string, assetId: string, env: NodeJS.ProcessEnv = process.env,
  options: { expectedRevision?: number } = {},
): PublisherContent {
  const directory = directoryFor(id, env)
  const content = readManifest(directory)
  if (options.expectedRevision !== undefined && options.expectedRevision !== content.revision) {
    throw new Error('草稿已在其他页面更新，请重新加载后再删除图片')
  }
  if (!content.assets.some(asset => asset.id === assetId)) throw new Error('素材不存在')
  const file = safeAssetPath(directory, assetId)
  // Remove the managed Markdown image in the same manifest revision as the asset.
  // Both the editor and Agent create this exact ![label](ebao-asset://id) form.
  const reference = new RegExp(`!\\[[^\\r\\n\\]]*\\]\\(ebao-asset:\\/\\/${assetId}\\)`, 'giu')
  const next = {
    ...content, revision: content.revision + 1, updatedAt: new Date().toISOString(),
    body: content.body.replace(reference, ''),
    assets: content.assets.filter(asset => asset.id !== assetId),
    platformVariants: Object.fromEntries(Object.entries(content.platformVariants ?? {}).map(([platform, variant]) => {
      const revised = { ...variant }
      if (revised.body !== undefined) revised.body = revised.body.replace(reference, '')
      if (revised.assetOrder !== undefined) revised.assetOrder = revised.assetOrder.filter(id => id !== assetId)
      if (revised.coverAssetId === assetId) delete revised.coverAssetId
      return [platform, revised]
    })),
  }
  if (next.coverAssetId === assetId) {
    delete next.coverAssetId
    if (content.contentType === 'article' && next.assets.length > 0) next.coverAssetId = next.assets[0]!.id
  }
  writeManifest(directory, next)
  rmSync(file)
  return next
}

export function readAsset(id: string, assetId: string, env: NodeJS.ProcessEnv = process.env): { data: Buffer; mime: PublisherAsset['mime'] } {
  const directory = directoryFor(id, env)
  const content = readManifest(directory)
  const asset = content.assets.find(item => item.id === assetId)
  if (!asset) throw new Error('素材不存在')
  const file = safeAssetPath(directory, assetId)
  if (statSync(file).size > MAX_ASSET_BYTES) throw new Error('素材过大')
  return { data: readFileSync(file), mime: asset.mime }
}

/** Host-only path passed to the trusted Worker for immutable submission capture. */
export function resolveContent(id: string, revision: number, env: NodeJS.ProcessEnv = process.env): { content: PublisherContent; directory: string } {
  const directory = directoryFor(id, env)
  const content = readManifest(directory)
  if (content.revision !== revision) throw new Error('草稿已更新，请确认最新内容后重新提交')
  for (const asset of content.assets) {
    const file = safeAssetPath(directory, asset.id)
    if (statSync(file).size !== asset.bytes) throw new Error('素材已改变，请重新上传')
    if (asset.sha256 && createHash('sha256').update(readFileSync(file)).digest('hex') !== asset.sha256) throw new Error('素材已改变，请重新上传')
  }
  return { content, directory }
}
