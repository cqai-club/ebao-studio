/** Agent tools for the draft currently open in the Publisher editor drawer. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { AgentDraftBindings, normalizeAgentDraftTarget, sameAgentDraftTarget, type AgentDraftTarget } from './agent-draft-binding.ts'
import { addAsset, insertArticleImage, patchContent, readContent, removeAsset } from './contents.ts'
import { listWorks, resolveWork } from './works.ts'
import { readPublisherArticleOrigin } from './article-handoff.ts'
import { CREATIVE_STATEMENTS, PLATFORMS, projectContentForPlatform } from './protocol.ts'
import type { PublisherAsset, PublisherContent } from './protocol.ts'

const resultSchema = { type: 'object', additionalProperties: true, properties: {} } as const
const render = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
const imageRefSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    attachment_id: { type: 'string', required: true },
    media_type: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
} as const

const targetSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['main', 'platform'] },
    platform: { type: 'string', enum: [...PLATFORMS] },
  },
} as const

function selectedTarget(value: unknown, bound: AgentDraftTarget, fallback: AgentDraftTarget = bound): AgentDraftTarget {
  const target = normalizeAgentDraftTarget(value ?? fallback)
  if (!sameAgentDraftTarget(target, bound)) throw new Error('草稿编辑目标已切换，请重新读取当前版本')
  return target
}

function requireMainTarget(target: AgentDraftTarget): void {
  if (target.kind !== 'main') throw new Error('图片素材操作只支持通用正文，请先切换到通用正文')
}



type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
function asToolResult<T extends object>(value: T): Record<string, JsonValue> {
  return value as unknown as Record<string, JsonValue>
}

function sessionIdOf(agent: { id: string } | undefined): string {
  if (!agent || typeof agent.id !== 'string' || !agent.id) throw new Error('当前工具需要 Agent 会话')
  return agent.id
}

function snapshot(source: PublisherContent, bindingToken: string, target: AgentDraftTarget = { kind: 'main' }) {
  const content = target.kind === 'platform' ? projectContentForPlatform(source, target.platform) : source
  const origin = content.contentType !== 'video' ? readPublisherArticleOrigin(content.id) : null
  return {
    content_id: content.id,
    content_type: content.contentType,
    ...(content.contentType === 'image-note' ? { image_generation_defaults: { size: '3:4' } } : {}),
    binding_token: bindingToken,
    revision: content.revision,
    target,
    ...(origin ? { article_source: origin } : {}),
    title: content.title,
    tags: content.tags,
    creative_statement: content.creativeStatement,
    ...(content.contentType === 'video'
      ? { description: content.description ?? '', short_title: content.shortTitle ?? '', video_source: content.videoSource ?? null }
      : {
          body: content.body, summary: content.summary,
          assets: content.assets.map(asset => ({ id: asset.id, name: asset.name, mime: asset.mime })),
          cover_asset_id: content.coverAssetId ?? null,
        }),
  }
}

function requireContent(contentId: string, expectedType?: PublisherContent['contentType']): PublisherContent {
  const content = readContent(contentId)
  if (expectedType && content.contentType !== expectedType) throw new Error('当前草稿内容类型不匹配')
  return content
}

function imageReference(value: {
  attachment_id: string; media_type: string; bytes: number; width: number; height: number; name?: string
}): ImageAttachmentRef {
  if (!/^sha256:[0-9a-f]{64}$/iu.test(value.attachment_id)
    || !['image/jpeg', 'image/png', 'image/webp'].includes(value.media_type)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 20 * 1024 * 1024
    || !Number.isSafeInteger(value.width) || value.width < 1
    || !Number.isSafeInteger(value.height) || value.height < 1
    || (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 255))) {
    throw new Error('图片附件引用无效')
  }
  return {
    attachmentId: value.attachment_id as ImageAttachmentRef['attachmentId'],
    mediaType: value.media_type as ImageAttachmentRef['mediaType'],
    bytes: value.bytes, width: value.width, height: value.height,
    ...(value.name === undefined ? {} : { name: value.name }),
  }
}

async function verifiedImage(ctx: Context, source: Parameters<typeof imageReference>[0], signal: AbortSignal) {
  const ref = imageReference(source)
  const verified = await ctx.attachments.readImage(ref, signal)
  signal.throwIfAborted()
  const bytes = Buffer.from(verified.data)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== ref.bytes || ref.attachmentId.toLowerCase() !== `sha256:${digest}`
    || verified.ref.mediaType !== ref.mediaType) throw new Error('图片附件字节与引用不一致')
  return { ref, bytes, digest }
}

function currentDraftTool(bindings: AgentDraftBindings) {
  return defineTool({
      name: 'publisher_get_current_draft',
      description: 'Read this conversation’s bound editor draft, binding token and current revision. Returns null when the editor is unbound.',
      parameters: { target: targetSchema },
      output: { schema: { oneOf: [resultSchema, { type: 'null' }] } as const, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.current(sessionIdOf(exec.agent))
        if (!binding) return null
        const target = selectedTarget(args.target, binding.target)
        return asToolResult(snapshot(requireContent(binding.contentId), binding.bindingToken, target))
      },
    })
}

export function registerAgentDraftReadTool(ctx: Context, bindings: AgentDraftBindings): () => void {
  return ctx.tools.register(currentDraftTool(bindings))
}

export function registerAgentDraftTools(ctx: Context, bindings: AgentDraftBindings): () => void {
  const disposers = [
    registerAgentDraftReadTool(ctx, bindings),
    ctx.tools.register(defineTool({
      name: 'publisher_update_current_draft',
      description: 'Patch only requested fields in the current main draft or selected platform version. Pass the target returned by publisher_get_current_draft, the binding token and observed revision. Merge into the latest saved draft; unrelated fields stay unchanged and the last successful save wins for a field. Does not publish.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        target: targetSchema,
        title: { type: 'string' },
        body: { type: 'string' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        short_title: { type: 'string' },
        creative_statement: { type: 'string', enum: [...CREATIVE_STATEMENTS] },
        cover_asset_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        asset_order: { type: 'array', items: { type: 'string' } },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        const current = requireContent(binding.contentId)
        const target = selectedTarget(args.target, binding.target, { kind: 'main' })
        if (args.title === undefined && args.body === undefined && args.summary === undefined && args.tags === undefined
          && args.description === undefined && args.short_title === undefined && args.creative_statement === undefined
          && args.cover_asset_id === undefined && args.asset_order === undefined) {
          throw new Error('请指定至少一个要修改的草稿字段')
        }
        if (current.contentType === 'video' && (args.body !== undefined || args.summary !== undefined
          || args.cover_asset_id !== undefined || args.asset_order !== undefined)) {
          throw new Error('视频草稿不能修改正文、摘要或图片素材')
        }
        if (current.contentType !== 'video' && (args.description !== undefined || args.short_title !== undefined)) {
          throw new Error('文章和图文草稿不能修改视频简介或短标题')
        }
        const textPatch = {
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          ...(args.cover_asset_id === undefined ? {} : { coverAssetId: args.cover_asset_id }),
          ...(args.asset_order === undefined ? {} : { assetOrder: args.asset_order }),
        }
        if (target.kind === 'platform' && args.creative_statement !== undefined) {
          throw new Error('内容声明属于通用正文，请切换到通用正文后修改')
        }
        const patch = target.kind === 'platform'
          ? { platformVariants: { [target.platform]: textPatch } }
          : { ...textPatch,
              ...(args.creative_statement === undefined ? {} : { creativeStatement: args.creative_statement }),
              ...(args.description === undefined ? {} : { description: args.description }),
              ...(args.short_title === undefined ? {} : { shortTitle: args.short_title }),
            }
        const saved = patchContent(current.id, { revision: args.expected_revision, patch })
        return asToolResult(snapshot(saved, binding.bindingToken, target))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_insert_current_draft_image',
      description: 'Article only: import one existing image attachment and save it in the main body. Provide the complete latest body with exactly one {{PUBLISHER_IMAGE}} marker at the desired insertion point. The attachment may come from generate_image. Requires the current binding token and revision. Does not publish.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        source_image: { ...imageRefSchema, required: true },
        body_with_image_marker: { type: 'string', required: true },
        alt: { type: 'string', required: true },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const initial = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireMainTarget(initial.target)
        requireContent(initial.contentId, 'article')
        const { ref, bytes, digest } = await verifiedImage(ctx, args.source_image, exec.signal)
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireMainTarget(binding.target)
        requireContent(binding.contentId, 'article')
        const extension = ref.mediaType === 'image/jpeg' ? 'jpg' : ref.mediaType === 'image/png' ? 'png' : 'webp'
        const saved = insertArticleImage(binding.contentId, args.expected_revision,
          ref.name ?? `agent-image-${digest.slice(0, 12)}.${extension}`, bytes, ref.mediaType as PublisherAsset['mime'],
          args.body_with_image_marker, args.alt)
        return asToolResult(snapshot(saved, binding.bindingToken, binding.target))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_add_current_draft_image',
      description: 'Image-note only: add one uploaded or generated image attachment to the bound local draft. Requires the current binding token and revision. Does not modify the Markdown source or publish.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        source_image: { ...imageRefSchema, required: true },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const initial = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireMainTarget(initial.target)
        requireContent(initial.contentId, 'image-note')
        const { ref, bytes, digest } = await verifiedImage(ctx, args.source_image, exec.signal)
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireMainTarget(binding.target)
        requireContent(binding.contentId, 'image-note')
        const extension = ref.mediaType === 'image/jpeg' ? 'jpg' : ref.mediaType === 'image/png' ? 'png' : 'webp'
        const saved = addAsset(binding.contentId, ref.name ?? `agent-image-${digest.slice(0, 12)}.${extension}`,
          bytes, process.env, { expectedRevision: args.expected_revision })
        return asToolResult(snapshot(saved, binding.bindingToken, binding.target))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_remove_current_draft_image',
      description: 'Image-note only: remove one managed image from the bound local draft when the user explicitly asks to delete it. This also removes its platform-copy references and cannot be undone. Requires the current binding token and revision.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        asset_id: { type: 'string', required: true },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireMainTarget(binding.target)
        requireContent(binding.contentId, 'image-note')
        const saved = removeAsset(binding.contentId, args.asset_id, process.env,
          { expectedRevision: args.expected_revision })
        return asToolResult(snapshot(saved, binding.bindingToken, binding.target))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_list_video_works',
      description: 'Video draft only: list up to 50 existing, completed e剪宝 video works that can be selected as the local draft video source. Returns IDs and safe metadata, never local file paths.',
      parameters: {},
      output: { schema: resultSchema, render },
      async execute(_args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.current(sessionIdOf(exec.agent))
        if (!binding) throw new Error('当前 Agent 没有绑定草稿')
        requireContent(binding.contentId, 'video')
        const works = listWorks()
        return asToolResult({ total: works.length, works: works.slice(0, 50) })
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_select_current_video_work',
      description: 'Video draft only: select an existing, completed e剪宝 work as this draft’s video source. The existing title, description, short title, tags, and declaration stay unchanged. Local video files must be selected with the editor’s native file picker.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        work_id: { type: 'string', required: true },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        const current = requireContent(binding.contentId, 'video')
        const work = resolveWork(args.work_id)
        const saved = patchContent(current.id, { revision: args.expected_revision,
          patch: { videoSource: { kind: 'work', workId: work.id } },
        })
        return asToolResult(snapshot(saved, binding.bindingToken, binding.target))
      },
    })),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
