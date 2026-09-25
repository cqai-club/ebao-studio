/** Turn a reviewed Markdown source into one editable Publisher preparation. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { addAsset, createContent, deleteContent, readContent, saveContent } from './contents.ts'
import { readSourceDocument, readSourceImage, type SourceSnapshot } from './source-documents.ts'
import type { Platform, PublisherContent, PublisherPlatformVariant } from './protocol.ts'

const markdown = new MarkdownIt({ html: false, linkify: false })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REVISION = /^[0-9a-f]{64}$/iu
const MAX_LINK_BYTES = 2048

export interface PublicationCandidate {
  id: string
  platforms: Platform[]
  title?: string
  body?: string
  summary?: string
  tags?: string[]
  platformVariants?: Partial<Record<Platform, PublisherPlatformVariant>>
}

interface PreparationLink {
  version: 1
  sourceId: string
  sourceRevision: string
  contentType: 'article' | 'image-note'
  candidateId?: string
  contentId: string
}

function preparationsRoot(env: NodeJS.ProcessEnv): string {
  const root = join(resolveDshHome(undefined, env), 'publisher', 'preparations')
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error('发布准备单目录无效')
  return root
}

function linkPath(sourceId: string, revision: string, contentType: 'article' | 'image-note', env: NodeJS.ProcessEnv, candidateId?: string): string {
  // Keep the historical key for direct source imports without a preview candidate.
  const identity = `${sourceId}\0${revision}\0${contentType}${candidateId === undefined ? '' : `\0${candidateId}`}`
  const key = createHash('sha256').update(identity).digest('hex')
  return join(preparationsRoot(env), `${key}.json`)
}

function existingPreparation(file: string, key: Omit<PreparationLink, 'version' | 'contentId'>, env: NodeJS.ProcessEnv): PublisherContent | undefined {
  if (!existsSync(file)) return undefined
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LINK_BYTES) throw new Error('发布准备单关联无效')
  let value: unknown
  try { value = JSON.parse(readFileSync(file, 'utf8')) }
  catch { throw new Error('发布准备单关联无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('发布准备单关联无效')
  const link = value as Record<string, unknown>
  if (link.version !== 1 || link.sourceId !== key.sourceId || link.sourceRevision !== key.sourceRevision
    || link.contentType !== key.contentType || link.candidateId !== key.candidateId
    || typeof link.contentId !== 'string' || !UUID.test(link.contentId)) {
    throw new Error('发布准备单关联无效')
  }
  try {
    const content = readContent(link.contentId, env)
    if (content.contentType !== key.contentType) throw new Error('发布准备单内容类型无效')
    return content
  } catch (error) {
    // Deleting a preparation must not prevent opening this source revision again.
    if (error instanceof Error && error.message === '草稿不存在') return undefined
    throw error
  }
}

function imageSources(body: string): string[] {
  const sources: string[] = []
  const visit = (tokens: Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'image') sources.push(token.attrGet('src') ?? '')
      if (token.children) visit(token.children)
    }
  }
  visit(markdown.parse(body, {}))
  return sources
}

function hasImage(tokens: Token[]): boolean {
  return tokens.some(token => token.type === 'image' || token.children !== null && hasImage(token.children))
}

/** Find an ordinary inline image and its URL span without changing alt text or title. */
function inlineImageAt(body: string, start: number): { end: number; source: string; urlStart: number; urlEnd: number } | undefined {
  if (body.slice(start, start + 2) !== '![') return undefined
  let bracketDepth = 1
  let cursor = start + 2
  while (cursor < body.length && bracketDepth > 0) {
    if (body[cursor] === '\\') { cursor += 2; continue }
    if (body[cursor] === '[') bracketDepth += 1
    if (body[cursor] === ']') bracketDepth -= 1
    cursor += 1
  }
  if (bracketDepth !== 0 || body[cursor] !== '(') return undefined
  const openParen = cursor
  cursor += 1
  let depth = 1
  let angle = false
  let quote: string | undefined
  while (cursor < body.length && depth > 0) {
    const char = body[cursor]
    if (char === '\\') { cursor += 2; continue }
    if (angle) { if (char === '>') angle = false; cursor += 1; continue }
    if (char === '<') { angle = true; cursor += 1; continue }
    if (quote) { if (char === quote) quote = undefined; cursor += 1; continue }
    if (char === '"' || char === "'") { quote = char; cursor += 1; continue }
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    cursor += 1
  }
  if (depth !== 0) return undefined
  const end = cursor
  const candidate = body.slice(start, end)
  const children = markdown.parseInline(candidate, {})[0]?.children ?? []
  if (children.length !== 1 || children[0]?.type !== 'image') return undefined
  const source = children[0].attrGet('src') ?? ''
  cursor = openParen + 1
  while (/\s/u.test(body[cursor] ?? '') && cursor < end - 1) cursor += 1
  const angled = body[cursor] === '<'
  if (angled) cursor += 1
  const urlStart = cursor
  if (angled) {
    while (cursor < end - 1 && body[cursor] !== '>') {
      if (body[cursor] === '\\') cursor += 1
      cursor += 1
    }
  } else {
    let nested = 0
    while (cursor < end - 1) {
      const char = body[cursor]
      if (char === '\\') { cursor += 2; continue }
      if (char === '(') nested += 1
      if (char === ')') { if (nested === 0) break; nested -= 1 }
      if (/\s/u.test(char) && nested === 0) break
      cursor += 1
    }
  }
  return { end, source, urlStart, urlEnd: cursor }
}

function rewriteImages(body: string, assetBySource: Map<string, string>, contentType: 'article' | 'image-note'): string {
  const expected = imageSources(body)
  if (expected.length === 0) return body
  const eligibleLines = new Set<number>()
  for (const block of markdown.parse(body, {})) {
    if (block.type !== 'inline' || !block.children || !hasImage(block.children) || !block.map) continue
    for (let line = block.map[0]; line < block.map[1]; line += 1) eligibleLines.add(line)
  }
  let output = ''
  let last = 0
  let line = 0
  let codeTicks = 0
  let matched = 0
  for (let index = 0; index < body.length;) {
    const char = body[index]
    if (char === '\n') { line += 1; if (!eligibleLines.has(line)) codeTicks = 0; index += 1; continue }
    if (!eligibleLines.has(line)) { index += 1; continue }
    if (char === '`') {
      let count = 1
      while (body[index + count] === '`') count += 1
      if (codeTicks === 0) codeTicks = count
      else if (codeTicks === count) codeTicks = 0
      index += count
      continue
    }
    if (codeTicks !== 0 || char !== '!' || body[index + 1] !== '[') { index += 1; continue }
    let slashCount = 0
    for (let offset = index - 1; body[offset] === '\\'; offset -= 1) slashCount += 1
    if (slashCount % 2 === 1) { index += 1; continue }
    const image = inlineImageAt(body, index)
    if (!image) { index += 1; continue }
    const assetId = assetBySource.get(image.source)
    if (!assetId || expected[matched] !== image.source) throw new Error('仅支持已登记的行内 Markdown 图片引用')
    if (contentType === 'image-note') {
      // Image-note Workers upload ordered assets separately and treat body as
      // plain description text. Never send managed Markdown image syntax there.
      output += body.slice(last, index)
      last = image.end
    } else {
      output += body.slice(last, image.urlStart) + `ebao-asset://${assetId}`
      last = image.urlEnd
    }
    matched += 1
    line += (body.slice(index, image.end).match(/\n/gu) ?? []).length
    index = image.end
  }
  if (matched !== expected.length) throw new Error('仅支持已登记的行内 Markdown 图片引用')
  return output + body.slice(last)
}

function assertSourceUnchanged(source: SourceSnapshot, env: NodeJS.ProcessEnv): void {
  const current = readSourceDocument(source.id, env)
  if (current.revision !== source.revision) throw new Error('内容源已更新，请重新预览后发布')
}

/** Create a preparation only on the first publish action for this source revision. */
export function openPublicationFromSource(
  sourceId: string,
  expectedRevision: string,
  contentType: 'article' | 'image-note',
  env: NodeJS.ProcessEnv = process.env,
  candidate?: PublicationCandidate,
): PublisherContent {
  if (contentType !== 'article' && contentType !== 'image-note') throw new Error('发布内容类型无效')
  if (!REVISION.test(expectedRevision)) throw new Error('内容源修订号无效')
  if (candidate && (!UUID.test(candidate.id))) throw new Error('发布候选 ID 无效')
  const key = { sourceId, sourceRevision: expectedRevision, contentType,
    ...(candidate ? { candidateId: candidate.id } : {}) }
  const file = linkPath(sourceId, expectedRevision, contentType, env, candidate?.id)
  const existing = existingPreparation(file, key, env)
  if (existing) return existing
  const source = readSourceDocument(sourceId, env)
  if (source.revision !== expectedRevision) throw new Error('内容源已更新，请重新预览后发布')
  if (source.id !== sourceId) throw new Error('内容源 ID 不匹配')
  if (candidate && (!Array.isArray(candidate.platforms) || candidate.platforms.length === 0
    || new Set(candidate.platforms).size !== candidate.platforms.length)) throw new Error('发布目标平台无效')
  const mainBody = candidate?.body ?? source.body
  const targetPlatforms = candidate?.platforms ?? []
  if (candidate && Object.keys(candidate.platformVariants ?? {}).some(platform => !targetPlatforms.includes(platform as Platform))) {
    throw new Error('平台版本不属于所选平台')
  }
  // The editable master owns the union. Each target later gets its own exact
  // selection, so an image removed from a platform body is not uploaded there.
  const bodies = candidate
    ? [mainBody, ...targetPlatforms.map(platform => candidate.platformVariants?.[platform]?.body).filter((value): value is string => value !== undefined)]
    : [source.body]
  const imageBySource = new Map(source.images.map(image => [image.src, image]))
  const orderedSources = [...new Set(bodies.flatMap(body => imageSources(body)))]
  for (const imageSource of orderedSources) {
    if (!imageBySource.has(imageSource)) throw new Error('正文图片不属于当前内容源，请重新预览')
  }
  if (orderedSources.length > 20) throw new Error('每份发布内容最多 20 张图片，请先精简内容源')

  const created = createContent(contentType, env)
  try {
    let current = created
    const assetBySource = new Map<string, string>()
    for (const imageSource of orderedSources) {
      const image = imageBySource.get(imageSource)!
      const loaded = readSourceImage(source.id, image.id, env)
      if (loaded.mime !== image.mime || loaded.data.length !== image.bytes) throw new Error('内容源图片已变化，请重新预览')
      current = addAsset(current.id, image.name, loaded.data, env, { expectedRevision: current.revision })
      const assetId = current.assets[current.assets.length - 1]!.id
      assetBySource.set(imageSource, assetId)
    }
    const variants = Object.fromEntries(targetPlatforms.map(platform => {
      const variant = candidate!.platformVariants?.[platform]
      const effectiveBody = variant?.body ?? mainBody
      const selected = [...new Set(imageSources(effectiveBody))].map(src => assetBySource.get(src)!)
      return [platform, {
        ...variant,
        ...(variant?.body === undefined ? {} : { body: rewriteImages(variant.body, assetBySource, contentType) }),
        assetOrder: selected,
        coverAssetId: selected[0] ?? null,
      }]
    })) as Partial<Record<Platform, PublisherPlatformVariant>>
    current = saveContent(current.id, {
      revision: current.revision,
      title: candidate?.title ?? source.title,
      body: rewriteImages(mainBody, assetBySource, contentType),
      summary: candidate?.summary ?? '',
      tags: candidate?.tags ?? [],
      creativeStatement: 'none',
      coverAssetId: current.coverAssetId,
      platformVariants: variants,
    }, env)
    assertSourceUnchanged(source, env)
    const root = preparationsRoot(env)
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('发布准备单关联无效')
    const temporary = join(root, `.${randomUUID()}.tmp`)
    try {
      const link: PreparationLink = { version: 1, ...key, contentId: current.id }
      writeFileSync(temporary, JSON.stringify(link), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, file)
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true })
    }
    return current
  } catch (error) {
    try { deleteContent(created.id, env) } catch { /* Preserve the import failure. */ }
    throw error
  }
}
