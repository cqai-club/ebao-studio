/** Agent tools for a file-first conversation. No Publisher content record is created here. */
import { isAbsolute, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { PLATFORMS, type Platform, type PublisherPlatformVariant } from './protocol.ts'
import { preparePublicationCandidate } from './publication-candidates.ts'
import { readSessionSourceDocument, readSessionSourceDocumentPath, registerSourceDocument } from './source-documents.ts'
import { exportSourceImage } from './source-image-export.ts'

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
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
function asToolResult<T extends object>(value: T): Record<string, JsonValue> {
  // Both snapshots contain only validated scalar fields, arrays, and plain objects.
  return value as unknown as Record<string, JsonValue>
}

export const AGENT_SOURCE_GUIDANCE = [
  '如果用户是在多平台发布的文章、图文或视频编辑页 Agent 抽屉要求修改，先调用 publisher_get_current_draft；返回草稿时按 content_type 使用当前草稿工具直接保存，此时不要执行下列 Markdown 原稿流程。',
  '文章和图文先保存为真实的本地 Markdown (.md) 文件。原稿保留在你创建的位置；正文图片使用相对于 MD 文件的路径，或指向当前 Agent 工作目录内文件的绝对路径。用户上传或生图只提供附件引用时，用 publisher_export_image 把选中的图片保存到原稿旁，按其返回的相对路径写入 MD。写完并确认文件存在后调用 publisher_register_source，右侧通用预览将直接读取这份原稿及图片。修改原稿后再次登记。',
  '用户仅要求写作、修改或预览时，不准备平台版本，也不创建 Publisher 草稿。图片不要求来自当前会话的上传或生图事件，但必须是原稿实际引用且可读取的本地图片。',
  '只有用户明确要求发布到社交平台或多平台时，先读取已登记原稿，整理文章或图文类型、目标平台和所需的平台文案，然后调用 publisher_prepare_preview。文章可选掘金、B站专栏、头条、百家号、微信公众号；图文可选小红书、抖音、快手、微信公众号；公众号使用图片消息，按图片顺序展示、首图封面，正文为纯文本。头条不提供图文。平台候选中的图片仍引用原稿返回的 source-image:// 图片地址，不复制素材；候选主稿与平台版本合计最多选 20 张不同图片。文章平台不兼容的插图会在提交平台草稿时提示并移除；公众号仍需可用的 JPEG/PNG 封面。预览可供用户检查。',
  '用户明确要求发布时，准备候选预览后调用 publisher_request_publication，在当前对话展示确认卡片，由用户选择账号与发布方式并点击确认提交。此时才创建对应的本地发布准备单，原稿保持不变。预览中的多平台发布入口仍可打开发布页供手动编辑；不要把准备预览、确认卡片或排队受理描述为平台发布成功。',
].join('\n')

function sessionIdOf(agent: { id: string } | undefined): string {
  if (!agent || typeof agent.id !== 'string' || !agent.id) throw new Error('当前工具需要 Agent 会话')
  return agent.id
}

export function isAgentWorkspacePath(value: unknown, platform: NodeJS.Platform = process.platform): value is string {
  if (typeof value !== 'string') return false
  if (platform !== 'win32') return isAbsolute(value)
  const root = win32.parse(value).root
  // A leading slash alone still resolves against the process's current drive.
  return win32.isAbsolute(value) && root !== '\\' && root !== '/'
}

function workspaceOf(agent: unknown): string {
  const cwd = (agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  if (!isAgentWorkspacePath(cwd)) throw new Error('无法确定当前 Agent 工作目录')
  return cwd
}

function imageReference(value: {
  attachment_id: string; media_type: string; bytes: number; width: number; height: number; name?: string
}): ImageAttachmentRef {
  if (!/^sha256:[0-9a-f]{64}$/iu.test(value.attachment_id)
    || !['image/jpeg', 'image/png', 'image/webp'].includes(value.media_type)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1
    || !Number.isSafeInteger(value.width) || value.width < 1
    || !Number.isSafeInteger(value.height) || value.height < 1) throw new Error('图片附件引用无效')
  return {
    attachmentId: value.attachment_id as ImageAttachmentRef['attachmentId'],
    mediaType: value.media_type as ImageAttachmentRef['mediaType'],
    bytes: value.bytes, width: value.width, height: value.height,
    ...(value.name === undefined ? {} : { name: value.name }),
  }
}

export function registerAgentSourceTools(ctx: Context): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'publisher_export_image',
      description: 'Save one user-selected uploaded or generated image attachment next to an existing workspace Markdown file. Returns the relative image path to write in that MD. Requires the exact attachment reference; no conversation-event provenance check and no Publisher draft creation.',
      parameters: {
        markdown_path: { type: 'string', required: true, description: 'Existing Markdown file in the current Agent workspace.' },
        source_image: { ...imageRefSchema, required: true, description: 'Exact image attachment returned by upload or image generation.' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        relative_path: { type: 'string', required: true },
      } } as const, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const verified = await ctx.attachments.readImage(imageReference(args.source_image), exec.signal)
        exec.signal.throwIfAborted()
        return { relative_path: exportSourceImage(args.markdown_path, verified, workspaceOf(exec.agent)) }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_register_source',
      description: 'Register the real local Markdown file created for this conversation. Preview reads that original file and its local image references; no publishing record is created.',
      parameters: {
        markdown_path: { type: 'string', required: true, description: 'Absolute path of the existing .md file created by the Agent.' },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        return asToolResult(registerSourceDocument(sessionIdOf(exec.agent), args.markdown_path, process.env, {
          allowedRoot: workspaceOf(exec.agent),
        }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_get_source',
      description: 'Read the latest registered Markdown source, original file path, and revision in this conversation. Returns null when no source is registered.',
      parameters: {},
      output: { schema: { oneOf: [resultSchema, { type: 'null' }] } as const, render },
      async execute(_args, exec) {
        exec.signal.throwIfAborted()
        const sessionId = sessionIdOf(exec.agent)
        const source = readSessionSourceDocument(sessionId)
        const markdownPath = source ? readSessionSourceDocumentPath(sessionId) : null
        return source && markdownPath ? asToolResult({ ...source, markdown_path: markdownPath }) : null
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_prepare_preview',
      description: 'Only after the user explicitly asks for social or multi-platform publishing: prepare a transient, image-reference-only platform preview from the registered Markdown source. Article targets: juejin, blbl, tt, bjh, wxmp. Image-note targets: xhs, dy, ks, wxmp; tt image-note is unsupported. WeChat image-note uses ordered images with the first as cover and a plain-text description. This does not create a publication record or submit to a platform.',
      parameters: {
        source_revision: { type: 'string', required: true, description: 'The exact source revision returned by publisher_get_source or publisher_register_source.' },
        content_type: { type: 'string', enum: ['article', 'image-note'], required: true },
        platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORMS] }, required: true },
        title: { type: 'string', description: 'Optional formatted main title; defaults to the Markdown H1 or file name.' },
        body: { type: 'string', description: 'Optional formatted main Markdown body. Keep source-image:// references from the source snapshot for all images.' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        platform_variants: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            platform: { type: 'string', enum: [...PLATFORMS], required: true },
            title: { type: 'string' }, body: { type: 'string' }, summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        } },
      },
      output: { schema: resultSchema, render },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const sessionId = sessionIdOf(exec.agent)
        const source = readSessionSourceDocument(sessionId)
        if (!source) throw new Error('请先创建并登记 Markdown 原稿')
        const variants: Partial<Record<Platform, PublisherPlatformVariant>> = {}
        for (const row of args.platform_variants ?? []) {
          const platform = row.platform as Platform
          if (variants[platform]) throw new Error('同一平台只能有一个候选版本')
          variants[platform] = {
            ...(row.title === undefined ? {} : { title: row.title }),
            ...(row.body === undefined ? {} : { body: row.body }),
            ...(row.summary === undefined ? {} : { summary: row.summary }),
            ...(row.tags === undefined ? {} : { tags: row.tags }),
          }
        }
        return asToolResult(preparePublicationCandidate(sessionId, {
          sourceId: source.id,
          sourceRevision: args.source_revision,
          contentType: args.content_type,
          platforms: args.platforms as Platform[],
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          platformVariants: variants,
        }))
      },
    })),
    ctx.systemPrompt.section({ name: 'plugin:cqai-publisher:source', order: 70, text: AGENT_SOURCE_GUIDANCE }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
