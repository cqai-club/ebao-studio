/** Agent tools for the article currently open in the Publisher editor drawer. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { AgentDraftBindings } from './agent-draft-binding.ts'
import { insertArticleImage, readContent, saveContent } from './contents.ts'
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
  '在多平台发布的文章编辑页右侧 Agent 抽屉中，先调用 publisher_get_current_draft。返回非 null 时，只编辑绑定的当前文章草稿；不要读取、创建或修改外部 Markdown 原稿，也不要调用 publisher_export_image、publisher_register_source 或 publisher_prepare_preview。',
  '可用 publisher_update_current_draft 修改主稿标题、正文、摘要、标签；用 publisher_insert_current_draft_image 将已上传或 generate_image 生成的图片附件插入正文。先读取最新 revision 和 binding_token；写入时同时提交它们。若提示草稿更新或文章切换，重新读取并重新考虑用户要求。',
  '这些工具直接保存本地草稿，不能提交到平台、修改平台账号或发布设置。完成后说明已保存，不要声称已发布。',
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
    binding_token: bindingToken,
    revision: content.revision,
    title: content.title,
    body: content.body,
    summary: content.summary,
    tags: content.tags,
    assets: content.assets.map(asset => ({ id: asset.id, name: asset.name, mime: asset.mime })),
  }
}

function requireArticle(contentId: string): PublisherContent {
  const content = readContent(contentId)
  if (content.contentType !== 'article') throw new Error('当前 Agent 只支持编辑文章草稿')
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

export function registerAgentDraftTools(ctx: Context, bindings: AgentDraftBindings): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'publisher_get_current_draft',
      description: 'Read the currently bound article draft in the Publisher editor drawer. Returns null if this Agent conversation has no open article. Use this before editing; it returns the binding token and latest revision required for a save.',
      parameters: {},
      output: { schema: { oneOf: [resultSchema, { type: 'null' }] } as const, render },
      async execute(_args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.current(sessionIdOf(exec.agent))
        if (!binding) return null
        return asToolResult(snapshot(requireArticle(binding.contentId), binding.bindingToken))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_update_current_draft',
      description: 'Save only the main article draft fields title, body, summary, and tags. Requires the exact article ID, binding token, and revision from publisher_get_current_draft. Does not publish or change platform versions or settings.',
      parameters: {
        content_id: { type: 'string', required: true },
        binding_token: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        title: { type: 'string' },
        body: { type: 'string' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        const current = requireArticle(binding.contentId)
        if (current.revision !== args.expected_revision) throw new Error('草稿已在其他页面更新，请重新读取后再保存')
        if (args.title === undefined && args.body === undefined && args.summary === undefined && args.tags === undefined) {
          throw new Error('请指定至少一个要修改的文章字段')
        }
        const saved = saveContent(current.id, {
          revision: args.expected_revision,
          title: args.title ?? current.title,
          body: args.body ?? current.body,
          summary: args.summary ?? current.summary,
          tags: args.tags ?? current.tags,
          creativeStatement: current.creativeStatement,
          ...(current.articleTheme === undefined ? {} : { articleTheme: current.articleTheme }),
          ...(current.coverAssetId === undefined ? {} : { coverAssetId: current.coverAssetId }),
          assetOrder: current.assets.map(asset => asset.id),
          platformFields: current.platformFields,
          platformVariants: current.platformVariants,
        })
        return asToolResult(snapshot(saved, binding.bindingToken))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_insert_current_draft_image',
      description: 'Import one existing image attachment into the currently bound article and save it in the main body. Provide the complete latest body with exactly one {{PUBLISHER_IMAGE}} marker at the desired insertion point. The attachment may come from generate_image. Requires the current binding token and revision. Does not publish.',
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
        bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        const ref = imageReference(args.source_image)
        const verified = await ctx.attachments.readImage(ref, exec.signal)
        exec.signal.throwIfAborted()
        const binding = bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
        const bytes = Buffer.from(verified.data)
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (bytes.length !== ref.bytes || ref.attachmentId.toLowerCase() !== `sha256:${digest}`
          || verified.ref.mediaType !== ref.mediaType) throw new Error('图片附件字节与引用不一致')
        const extension = ref.mediaType === 'image/jpeg' ? 'jpg' : ref.mediaType === 'image/png' ? 'png' : 'webp'
        const saved = insertArticleImage(binding.contentId, args.expected_revision,
          ref.name ?? `agent-image-${digest.slice(0, 12)}.${extension}`, bytes, ref.mediaType as PublisherAsset['mime'],
          args.body_with_image_marker, args.alt)
        return asToolResult(snapshot(saved, binding.bindingToken))
      },
    })),
    ctx.systemPrompt.section({ name: 'plugin:cqai-publisher:current-draft', order: 71, text: AGENT_DRAFT_GUIDANCE }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
