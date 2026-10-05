/** Agent tools for the draft currently open in the Publisher editor drawer. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { AgentDraftBindings } from './agent-draft-binding.ts'
import { addAsset, insertArticleImage, readContent, removeAsset, saveContent } from './contents.ts'
import { listWorks, resolveWork } from './works.ts'
import { CREATIVE_STATEMENTS } from './protocol.ts'
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

export const AGENT_DRAFT_GUIDANCE = [
  '在多平台发布的编辑页 Agent 抽屉中，先调用 publisher_get_current_draft。返回非 null 时，只编辑绑定的当前草稿，不要修改外部 Markdown 原稿，也不要调用 publisher_register_source 或 publisher_prepare_preview。',
  '根据返回的 content_type 编辑：文章可修改标题、正文、摘要、标签、内容声明、封面并插入正文图片；图文可修改标题、正文、标签、内容声明、封面、图片顺序，并用 publisher_add_current_draft_image 添加附件图片或按明确要求删除图片；视频可修改标题、简介、短标题、标签、内容声明，并用 publisher_list_video_works / publisher_select_current_video_work 选择已有 e剪宝成片。视频画面剪辑和本地视频文件选择不由这些工具执行。',
  '每次写入都要先读取最新 revision 和 binding_token 并同时提交。若提示草稿更新或切换，重新读取并重新考虑用户要求。编辑工具只保存本地草稿。用户明确要求发布时，调用 publisher_request_publication 展示对话确认卡片，由用户选择账号、方式并点击确认提交；不能修改平台账号或绕过确认。',
].join('\n')

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
function asToolResult<T extends object>(value: T): Record<string, JsonValue> {
  return value as unknown as Record<string, JsonValue>
}

function sessionIdOf(agent: { id: string } | undefined): string {
  if (!agent || typeof agent.id !== 'string' || !agent.id) throw new Error('当前工具需要 Agent 会话')
  return agent.id
}

function snapshot(content: PublisherContent, bindingToken: string) {
  return {
    content_id: content.id,
    content_type: content.contentType,
    binding_token: bindingToken,
    revision: content.revision,
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

export function registerAgentDraftTools(ctx: Context, bindings: AgentDraftBindings): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'publisher_get_current_draft',
      description: 'Read the currently bound article, image-note, or video draft in the Publisher editor drawer. Returns null if this Agent conversation has no open draft. Use this before editing; it returns the content type, binding token, and latest revision required for a save.',
      parameters: {},
      output: { schema: { oneOf: [resultSchema, { type: 'null' }] } as const, render },
      async execute(_args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.current(sessionIdOf(exec.agent))
        if (!binding) return null
        return asToolResult(snapshot(requireContent(binding.contentId), binding.bindingToken))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_update_current_draft',
      description: 'Save main draft fields for the bound article, image-note, or video. Article/image-note support title, body, summary, tags, cover asset, and image order; video supports title, description, short title, and tags. All types support creative statement. Requires the exact draft ID, binding token, and revision from publisher_get_current_draft. Does not publish or change platform versions or settings.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        title: { type: 'string' },
        body: { type: 'string' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        short_title: { type: 'string' },
        creative_statement: { type: 'string', enum: [...CREATIVE_STATEMENTS] },
        cover_asset_id: { type: 'string' },
        asset_order: { type: 'array', items: { type: 'string' } },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        const current = requireContent(binding.contentId)
        if (current.revision !== args.expected_revision) throw new Error('草稿已在其他页面更新，请重新读取后再保存')
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
        const saved = saveContent(current.id, {
          revision: args.expected_revision,
          title: args.title ?? current.title,
          body: current.contentType === 'video' ? '' : args.body ?? current.body,
          summary: current.contentType === 'video' ? '' : args.summary ?? current.summary,
          tags: args.tags ?? current.tags,
          creativeStatement: args.creative_statement ?? current.creativeStatement,
          ...(current.articleTheme === undefined ? {} : { articleTheme: current.articleTheme }),
          ...((args.cover_asset_id ?? current.coverAssetId) === undefined
            ? {} : { coverAssetId: args.cover_asset_id ?? current.coverAssetId }),
          assetOrder: args.asset_order ?? current.assets.map(asset => asset.id),
          platformFields: current.platformFields,
          platformVariants: current.platformVariants,
          ...(current.contentType === 'video' ? {
            description: args.description ?? current.description ?? '',
            shortTitle: args.short_title ?? current.shortTitle ?? '',
            ...(current.videoSource ? { videoSource: current.videoSource } : {}),
          } : {}),
        })
        return asToolResult(snapshot(saved, binding.bindingToken))
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
        requireContent(initial.contentId, 'article')
        const { ref, bytes, digest } = await verifiedImage(ctx, args.source_image, exec.signal)
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireContent(binding.contentId, 'article')
        const extension = ref.mediaType === 'image/jpeg' ? 'jpg' : ref.mediaType === 'image/png' ? 'png' : 'webp'
        const saved = insertArticleImage(binding.contentId, args.expected_revision,
          ref.name ?? `agent-image-${digest.slice(0, 12)}.${extension}`, bytes, ref.mediaType as PublisherAsset['mime'],
          args.body_with_image_marker, args.alt)
        return asToolResult(snapshot(saved, binding.bindingToken))
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
        requireContent(initial.contentId, 'image-note')
        const { ref, bytes, digest } = await verifiedImage(ctx, args.source_image, exec.signal)
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        requireContent(binding.contentId, 'image-note')
        const extension = ref.mediaType === 'image/jpeg' ? 'jpg' : ref.mediaType === 'image/png' ? 'png' : 'webp'
        const saved = addAsset(binding.contentId, ref.name ?? `agent-image-${digest.slice(0, 12)}.${extension}`,
          bytes, process.env, { expectedRevision: args.expected_revision })
        return asToolResult(snapshot(saved, binding.bindingToken))
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
        requireContent(binding.contentId, 'image-note')
        const saved = removeAsset(binding.contentId, args.asset_id, process.env,
          { expectedRevision: args.expected_revision })
        return asToolResult(snapshot(saved, binding.bindingToken))
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
        if (current.revision !== args.expected_revision) throw new Error('草稿已在其他页面更新，请重新读取后再保存')
        const work = resolveWork(args.work_id)
        const saved = saveContent(current.id, {
          revision: args.expected_revision, title: current.title, body: '', summary: '', tags: current.tags,
          creativeStatement: current.creativeStatement, description: current.description ?? '',
          shortTitle: current.shortTitle ?? '', videoSource: { kind: 'work', workId: work.id },
          platformFields: current.platformFields, platformVariants: current.platformVariants,
        })
        return asToolResult(snapshot(saved, binding.bindingToken))
      },
    })),
    ctx.systemPrompt.section({ name: 'plugin:cqai-publisher:current-draft', order: 71, text: AGENT_DRAFT_GUIDANCE }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
