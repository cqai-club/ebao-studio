/** Agent tools for a file-first conversation. No Publisher content record is created here. */
import { isAbsolute, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
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
      description: 'Save one selected image attachment beside a workspace Markdown source. Returns its relative path; does not create a draft or publish.',
      parameters: {
        markdown_path: { type: 'string', required: true, description: 'Existing Markdown file in the current Agent workspace.' },
        source_image: { ...imageRefSchema, required: true, description: 'Exact uploaded or generated image reference.' },
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
      description: 'Register an existing workspace Markdown source for this conversation. Reads the original file and local images; does not create a publication record.',
      parameters: {
        markdown_path: { type: 'string', required: true, description: 'Absolute path of an existing workspace .md file.' },
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
      description: 'Read this conversation’s registered Markdown source and current revision. Returns null when none is registered.',
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
      description: 'Prepare a platform preview from the registered source for an explicit publishing request. Returns a candidate for a confirmation card; does not create a publication record or submit.',
      parameters: {
        source_revision: { type: 'string', required: true, description: 'Current revision returned by the source tools.' },
        content_type: { type: 'string', enum: ['article', 'image-note'], required: true },
        platforms: { type: 'array', items: { type: 'string', enum: [...PLATFORMS] }, required: true },
        title: { type: 'string', description: 'Defaults to the source title.' },
        body: { type: 'string', description: 'Defaults to source Markdown; retain its source-image:// references.' },
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
        if (!source) throw new Error('当前对话没有登记原稿；请先用 publisher_register_source 登记现有 Markdown 文件')
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
        const candidate = preparePublicationCandidate(sessionId, {
          sourceId: source.id,
          sourceRevision: args.source_revision,
          contentType: args.content_type,
          platforms: args.platforms as Platform[],
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          platformVariants: variants,
        })
        return asToolResult({
          ...candidate, candidate_id: candidate.id, state: 'preview-ready', submitted: false,
          next_action: { tool: 'publisher_request_publication', arguments: {
            source: 'prepared-preview', candidate_id: candidate.id,
          } },
        })
      },
    })),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
