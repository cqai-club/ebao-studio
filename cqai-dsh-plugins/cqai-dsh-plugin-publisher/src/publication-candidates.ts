/** Conversation preview candidates are transient. A Publisher content record starts on the user's Publish click. */
import { randomUUID } from 'node:crypto'
import MarkdownIt from 'markdown-it'
import {
  MAX_TAGS, PLATFORMS, TITLE_MAX,
  type Platform, type PublisherPlatformVariant,
} from './protocol.ts'
import { CONTENT_ACCOUNT_PLATFORMS } from './content-targets.ts'
import { MAX_ASSETS } from './contents.ts'
import { readSourceDocument } from './source-documents.ts'

const markdown = new MarkdownIt({ html: false, linkify: false })
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_ACTIVE_CANDIDATES = 50
const candidates = new Map<string, PublicationCandidate>()

export interface PublicationCandidate {
  id: string
  sessionId: string
  sourceId: string
  sourceRevision: string
  contentType: 'article' | 'image-note'
  platforms: Platform[]
  title: string
  body: string
  summary: string
  tags: string[]
  platformVariants: Partial<Record<Platform, PublisherPlatformVariant>>
}

export interface PrepareCandidateInput {
  sourceId: string
  sourceRevision: string
  contentType: 'article' | 'image-note'
  platforms: Platform[]
  title?: string
  body?: string
  summary?: string
  tags?: string[]
  platformVariants?: Partial<Record<Platform, Pick<PublisherPlatformVariant, 'title' | 'body' | 'summary' | 'tags'>>>
}

function imageSources(body: string): string[] {
  const result: string[] = []
  const visit = (tokens: ReturnType<typeof markdown.parse>) => {
    for (const token of tokens) {
      if (token.type === 'image') result.push(token.attrGet('src') ?? '')
      if (token.children) visit(token.children)
    }
  }
  visit(markdown.parse(body, {}))
  return result
}

function checkText(value: string, label: string, max: number): void {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > max) throw new Error(`${label}过长或格式无效`)
}

function checkTitle(value: string, label: string): void {
  if (typeof value !== 'string' || value.length > TITLE_MAX || !value.trim()) throw new Error(`${label}过长或格式无效`)
}

function checkSummary(value: string): void {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('摘要过长或格式无效')
}

function checkTags(value: string[]): void {
  if (!Array.isArray(value) || value.length > MAX_TAGS || value.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 100)) {
    throw new Error('标签无效')
  }
}

/** Candidates may reuse source images; they cannot introduce arbitrary browser or host image URLs. */
function checkImages(body: string, sourceImageRefs: Set<string>): void {
  if (imageSources(body).some(src => !sourceImageRefs.has(src))) {
    throw new Error('候选预览只能引用原始 MD 中的图片，请先更新 MD 并重新登记')
  }
}

export function preparePublicationCandidate(
  sessionId: string,
  input: PrepareCandidateInput,
  env: NodeJS.ProcessEnv = process.env,
): PublicationCandidate {
  const source = readSourceDocument(input.sourceId, env)
  if (source.sessionId !== sessionId) throw new Error('原稿不属于当前会话')
  if (source.revision !== input.sourceRevision) throw new Error('原稿已变化，请重新预览后准备发布')
  if (input.contentType !== 'article' && input.contentType !== 'image-note') throw new Error('内容类型无效')
  if (!Array.isArray(input.platforms) || input.platforms.length === 0
    || input.platforms.some(platform => !(PLATFORMS as readonly string[]).includes(platform))
    || new Set(input.platforms).size !== input.platforms.length) throw new Error('请选择有效的发布平台')
  if (input.platforms.some(platform => !(CONTENT_ACCOUNT_PLATFORMS[input.contentType] as readonly string[]).includes(platform))) {
    throw new Error('所选平台不支持此内容类型')
  }
  const title = input.title ?? source.title
  const body = input.body ?? source.body
  const summary = input.summary ?? ''
  const tags = input.tags ?? []
  checkTitle(title, '标题')
  checkText(body, '正文', MAX_BODY_BYTES)
  checkSummary(summary)
  checkTags(tags)
  const refs = new Set(source.images.map(image => image.src))
  checkImages(body, refs)
  const platformVariants: PublicationCandidate['platformVariants'] = {}
  for (const [key, variant] of Object.entries(input.platformVariants ?? {})) {
    if (!input.platforms.includes(key as Platform) || !variant || typeof variant !== 'object' || Array.isArray(variant)) {
      throw new Error('平台版本不属于所选平台')
    }
    if (Object.keys(variant).some(field => !['title', 'body', 'summary', 'tags'].includes(field))) throw new Error('平台版本字段无效')
    if (variant.title !== undefined) checkTitle(variant.title, '平台标题')
    if (variant.body !== undefined) { checkText(variant.body, '平台正文', MAX_BODY_BYTES); checkImages(variant.body, refs) }
    if (variant.summary !== undefined) checkSummary(variant.summary)
    if (variant.tags !== undefined) checkTags(variant.tags)
    platformVariants[key as Platform] = { ...variant }
  }
  const selectedImages = new Set([
    ...imageSources(body),
    ...Object.values(platformVariants).flatMap(variant => variant?.body === undefined ? [] : imageSources(variant.body)),
  ])
  if (selectedImages.size > MAX_ASSETS) {
    throw new Error(`发布准备单最多支持 ${MAX_ASSETS} 张图片，请在候选正文中精简图片`)
  }
  if (input.contentType === 'image-note' && input.platforms.some(platform =>
    imageSources(platformVariants[platform]?.body ?? body).length === 0)) {
    throw new Error('图文预览的每个目标平台至少需要一张原稿图片')
  }
  if (input.contentType === 'article' && input.platforms.includes('wxmp')) {
    const selectedForWechat = new Set(imageSources(platformVariants.wxmp?.body ?? body))
    if (source.images.some(image => selectedForWechat.has(image.src) && image.mime === 'image/webp')) {
      throw new Error('微信公众号文章暂不支持 WebP 图片，请将选中的图片转为 JPEG 或 PNG，更新 MD 后重新预览')
    }
  }
  const candidate: PublicationCandidate = {
    id: randomUUID(), sessionId, sourceId: source.id, sourceRevision: source.revision,
    contentType: input.contentType, platforms: [...input.platforms], title, body, summary, tags: [...tags], platformVariants,
  }
  candidates.delete(sessionId)
  candidates.set(sessionId, candidate)
  if (candidates.size > MAX_ACTIVE_CANDIDATES) candidates.delete(candidates.keys().next().value!)
  return candidate
}

export function readPublicationCandidate(sessionId: string): PublicationCandidate | null {
  return candidates.get(sessionId) ?? null
}

export function validPublicationCandidate(sessionId: string, candidateId: string, env: NodeJS.ProcessEnv = process.env): PublicationCandidate {
  const candidate = candidates.get(sessionId)
  if (!candidate || candidate.id !== candidateId) throw new Error('发布候选已失效，请在对话中重新准备预览')
  const source = readSourceDocument(candidate.sourceId, env)
  if (source.sessionId !== sessionId || source.revision !== candidate.sourceRevision) {
    throw new Error('原稿已变化，请在对话中重新准备发布预览')
  }
  return candidate
}
