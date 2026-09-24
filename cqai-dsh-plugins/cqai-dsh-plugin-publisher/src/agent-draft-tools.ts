/** Model-facing conversation draft tools. None of these submit to the Publisher Worker. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { CREATIVE_STATEMENTS, PLATFORMS, type Platform } from './protocol.ts'
import { addSessionImage, readSessionContent, removeSessionImage, saveSessionDraft } from './session-contents.ts'
import type { PublisherSessionContent } from './protocol.ts'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function toolSnapshot(value: PublisherSessionContent) {
  // The Publisher manifest has already been validated as JSON by the content store.
  return {
    sessionId: value.sessionId,
    contentId: value.contentId,
    revision: value.revision,
    content: value.content as unknown as Record<string, JsonValue> | null,
  }
}

const sessionResultSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    contentId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    revision: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    content: { oneOf: [{ type: 'object', additionalProperties: true, properties: {} }, { type: 'null' }], required: true },
  },
} as const

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

export const AGENT_PUBLISHER_GUIDANCE = [
  '当用户想通过对话构思文章或图文并准备多平台发布时，可用 publisher_get_draft、publisher_save_draft、publisher_add_image 和 publisher_remove_image 维护当前会话的一份主草稿。',
  '先与用户讨论内容；只有标题、正文、摘要或标签形成明确的新版本后，调用 publisher_get_draft 读取当前修订，再用 publisher_save_draft 写入。首次保存选择 article 或 image-note；后续保持此类型。不要把尚在讨论的备选文案覆盖已定稿内容。',
  '用户明确要为某个平台调整标题、正文、摘要、标签、封面或图片选择与顺序时，先读取最新修订，再用 publisher_save_draft 的 platform_variant 只修改该平台版本；主草稿和其他平台版本保持不变。platform_variant.asset_order 可选择主稿图片的有序子集；该平台不需要封面时用 clear_cover=true。若用户要求恢复整个版本继承主稿，使用 reset_platform_variant。',
  '生成文章或图文标题时可使用中文、英文字母、数字、普通空格和常见中英文句读标点；不要使用话题符号、Markdown 符号、表情或换行。平台标题长度可能不同，发布前需逐个平台检查。若用户给出的已定标题含不支持的特殊字符，先提出改写供用户确认，不要擅自删字。',
  '每次修改都传入刚读取或上次工具返回的 expected_revision。若提示修订冲突，重新读取草稿并与用户核对，不要未经确认覆盖发布页中的手动修改。',
  '图片由用户上传或 generate_image/edit_image 产生后，只有用户明确选定要放入草稿，才调用 publisher_add_image。首次添加图片须选择 article 或 image-note，不能自行默认为图文。可传完整 source_image 附件引用；用户明确指最新图片时可省略，工具会从当前会话寻找最近图片。多张候选图应传所选图片的完整引用，不要自行批量导入。',
  'publisher_add_image 返回 Publisher 素材 ID。文章正文要插图时，在 body 的指定位置写 Markdown 图片 `![说明](ebao-asset://素材ID)`；封面使用 cover_asset_id，图文图片顺序使用 asset_order。先导入图片取得素材 ID，再带最新 expected_revision 保存正文或顺序。',
  '用户要求换图时先添加选定的新图，再用 publisher_remove_image 删除旧素材；删除会同时移除该图片的正文 Markdown 引用，若它是文章封面则自动回退到第一张剩余图片。用户明确要求不设封面时，调用 publisher_save_draft 并设置 clear_cover=true。',
  '这些工具只准备本地草稿，绝不执行发布。对话右侧可预览草稿；用户要发布时，引导其点击“发布”，到多平台发布页检查账号、模式及最终提交。',
].join('\n')

function sessionIdOf(agent: { id: string } | undefined): string {
  if (!agent || typeof agent.id !== 'string' || agent.id.length === 0) throw new Error('当前工具需要 Agent 会话')
  return agent.id
}

function imageRef(value: {
  attachment_id: string; media_type: string; bytes: number; width: number; height: number; name?: string
}): ImageAttachmentRef {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(value.media_type)
    || !/^sha256:[0-9a-f]{64}$/iu.test(value.attachment_id)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1
    || !Number.isSafeInteger(value.width) || value.width < 1
    || !Number.isSafeInteger(value.height) || value.height < 1) throw new Error('图片附件引用无效')
  return {
    attachmentId: value.attachment_id as ImageAttachmentRef['attachmentId'],
    mediaType: value.media_type as ImageAttachmentRef['mediaType'],
    bytes: value.bytes, width: value.width, height: value.height,
    ...value.name === undefined ? {} : { name: value.name },
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function storedImage(value: unknown): ImageAttachmentRef | undefined {
  const raw = record(value)
  if (!raw || typeof raw.attachmentId !== 'string' || typeof raw.mediaType !== 'string'
    || typeof raw.bytes !== 'number' || typeof raw.width !== 'number' || typeof raw.height !== 'number') return undefined
  try {
    return imageRef({
      attachment_id: raw.attachmentId, media_type: raw.mediaType,
      bytes: raw.bytes, width: raw.width, height: raw.height,
      ...typeof raw.name === 'string' ? { name: raw.name } : {},
    })
  } catch { return undefined }
}

function uploadedImages(content: unknown): ImageAttachmentRef[] {
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    const raw = record(block)
    const image = raw?.type === 'image' ? storedImage(raw.attachment) : undefined
    return image ? [image] : []
  })
}

const GENERATION_TOOLS = new Set(['generate_image', 'edit_image', 'get_image_generation_task'])

function generatedImages(content: unknown): ImageAttachmentRef[] {
  if (!Array.isArray(content)) return []
  const refs: ImageAttachmentRef[] = []
  for (const block of content) {
    const raw = record(block)
    if (raw?.type !== 'text' || typeof raw.text !== 'string' || raw.text.length > 32_000) continue
    try {
      const result = record(JSON.parse(raw.text) as unknown)
      if (result?.status !== 'completed' || !Array.isArray(result.images)) continue
      for (const value of result.images) {
        const image = record(value)
        if (!image || typeof image.attachment_id !== 'string' || typeof image.media_type !== 'string'
          || typeof image.bytes !== 'number' || typeof image.width !== 'number' || typeof image.height !== 'number') continue
        try {
          refs.push(imageRef({
            attachment_id: image.attachment_id, media_type: image.media_type,
            bytes: image.bytes, width: image.width, height: image.height,
            ...typeof image.name === 'string' ? { name: image.name } : {},
          }))
        } catch { /* Ignore an invalid tool-result image reference. */ }
      }
    } catch { /* Ignore non-JSON tool output. */ }
  }
  return refs
}

/** Only images carried by actual current-session upload and image-generation events are eligible. */
export function sessionImageReferences(events: readonly unknown[]): ImageAttachmentRef[] {
  const generationCalls = new Set<string>()
  const refs: ImageAttachmentRef[] = []
  for (const candidate of events) {
    const event = record(candidate)
    const data = record(event?.data)
    if (!event || !data) continue
    if (event.type === 'tool/call' && GENERATION_TOOLS.has(String(data.name)) && typeof data.callId === 'string') {
      generationCalls.add(data.callId)
      continue
    }
    if (event.type === 'user/message') {
      // SessionSnapshot stores the UserMessage directly in event.data.
      const message = data.role === 'user' ? data : record(data.message)
      if (message?.role === 'user' && record(message.source)?.kind === 'user') refs.push(...uploadedImages(message.content))
      continue
    }
    if (event.type === 'tool/result') {
      const message = record(data.message)
      const source = record(message?.source)
      if (message?.role !== 'user' || source?.kind !== 'tool' || typeof source.callId !== 'string'
        || !generationCalls.has(source.callId) || !Array.isArray(message.content)) continue
      const block = record(message.content[0])
      if (block?.type === 'tool-result' && block.toolCallId === source.callId && block.isError !== true) {
        refs.push(...generatedImages(block.content))
      }
      continue
    }
    if (event.type === 'tool/ptc-dispatch' && GENERATION_TOOLS.has(String(data.name)) && data.isError === false) {
      refs.push(...generatedImages(data.content))
    }
  }
  return refs
}

/** The no-argument image form selects the latest real image event in this Agent session. */
export function latestSessionImage(events: readonly unknown[]): ImageAttachmentRef | undefined {
  return sessionImageReferences(events).at(-1)
}

function eventsOf(agent: unknown): readonly unknown[] {
  const session = (agent as { session?: { snapshotEvents?: () => readonly unknown[] } } | undefined)?.session
  return session?.snapshotEvents?.() ?? []
}

function sameReference(left: ImageAttachmentRef, right: ImageAttachmentRef): boolean {
  return left.attachmentId === right.attachmentId && left.mediaType === right.mediaType
    && left.bytes === right.bytes && left.width === right.width && left.height === right.height
}

/** Register on the native Agent tool and prompt seams, with lifecycle disposal. */
export function registerAgentDraftTools(ctx: Context): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'publisher_get_draft',
      description: 'Read the one article or image-note draft associated with this Agent conversation. Use before saving and after a revision conflict. Returns null fields when no draft exists.',
      parameters: {},
      output: { schema: sessionResultSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(_args, exec) { return toolSnapshot(readSessionContent(sessionIdOf(exec.agent))) },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_save_draft',
      description: 'Save a clearly agreed article or image-note content version in this conversation. First call needs content_type and omits expected_revision. Later calls require the last observed expected_revision; omitted fields retain their current values. Never publishes.',
      parameters: {
        content_type: { type: 'string', enum: ['article', 'image-note'], description: 'Required on first save; existing conversation draft type cannot change.' },
        expected_revision: { type: 'integer', description: 'Last revision returned by publisher_get_draft or a previous Publisher tool call; required after the first save.' },
        title: { type: 'string', description: 'Agreed title using Han characters, ASCII letters/digits/spaces and ordinary sentence punctuation. No hashtag, Markdown symbols, emoji or line breaks. Omit to preserve the existing title.' },
        body: { type: 'string', description: 'Agreed complete Markdown article or image-note body. Omit to preserve.' },
        summary: { type: 'string', description: 'Agreed summary. Omit to preserve.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Complete agreed tag list. Omit to preserve.' },
        creative_statement: { type: 'string', enum: [...CREATIVE_STATEMENTS], description: 'AI/creative disclosure, if agreed.' },
        cover_asset_id: { type: 'string', description: 'Existing Publisher image asset ID to use as cover.' },
        clear_cover: { type: 'boolean', description: 'Set true only when the user explicitly wants no cover. Cannot be combined with cover_asset_id.' },
        asset_order: { type: 'array', items: { type: 'string' }, description: 'All Publisher image asset IDs in the desired order.' },
        platform_variant: {
          type: 'object', additionalProperties: false,
          description: 'Optional edits for one named platform. Supplied fields merge with that platform version; omitted fields stay unchanged.',
          properties: {
            platform: { type: 'string', enum: [...PLATFORMS], required: true },
            title: { type: 'string' }, body: { type: 'string' }, summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            cover_asset_id: { type: 'string' },
            clear_cover: { type: 'boolean', description: 'Set true to remove this platform cover, including an inherited primary cover. Cannot combine with cover_asset_id.' },
            asset_order: { type: 'array', items: { type: 'string' }, description: 'Selected Publisher image IDs in this platform order. May omit primary-draft images; empty means no images.' },
          },
        },
        reset_platform_variant: { type: 'string', enum: [...PLATFORMS], description: 'Remove all edits for one platform so it inherits the main draft.' },
      },
      output: { schema: sessionResultSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        if (args.platform_variant?.clear_cover === true && args.platform_variant.cover_asset_id !== undefined) {
          throw new Error('不能同时设置和清空平台封面')
        }
        return toolSnapshot(saveSessionDraft(sessionIdOf(exec.agent), {
          ...(args.content_type === undefined ? {} : { contentType: args.content_type }),
          ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }),
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          ...(args.creative_statement === undefined ? {} : { creativeStatement: args.creative_statement }),
          ...(args.cover_asset_id === undefined ? {} : { coverAssetId: args.cover_asset_id }),
          ...(args.clear_cover === undefined ? {} : { clearCover: args.clear_cover }),
          ...(args.asset_order === undefined ? {} : { assetOrder: args.asset_order }),
          ...(args.platform_variant === undefined ? {} : { platformVariant: {
            platform: args.platform_variant.platform as Platform,
            ...(args.platform_variant.title === undefined ? {} : { title: args.platform_variant.title }),
            ...(args.platform_variant.body === undefined ? {} : { body: args.platform_variant.body }),
            ...(args.platform_variant.summary === undefined ? {} : { summary: args.platform_variant.summary }),
            ...(args.platform_variant.tags === undefined ? {} : { tags: args.platform_variant.tags }),
            ...(args.platform_variant.clear_cover === true ? { coverAssetId: null }
              : args.platform_variant.cover_asset_id === undefined ? {} : { coverAssetId: args.platform_variant.cover_asset_id }),
            ...(args.platform_variant.asset_order === undefined ? {} : { assetOrder: args.platform_variant.asset_order }),
          } }),
          ...(args.reset_platform_variant === undefined ? {} : { resetPlatformVariant: args.reset_platform_variant as Platform }),
        }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_add_image',
      description: 'Add ONE image explicitly chosen by the user to this conversation draft. Pass source_image from generate_image/edit_image for an exact chosen candidate; omit it only when the user explicitly chose the latest image shown/uploaded in this conversation. On a first image, content_type is required. Existing drafts require expected_revision. The image is read and verified from the attachment store before any draft change. Never publishes.',
      parameters: {
        content_type: { type: 'string', enum: ['article', 'image-note'], description: 'Required when adding the first image before a draft exists. Existing draft type cannot change.' },
        expected_revision: { type: 'integer', description: 'Last observed Publisher draft revision. Omit only if this conversation has no draft.' },
        source_image: { ...imageRefSchema, description: 'Exact image attachment object returned by image generation. Omit to use the latest current-conversation image.' },
        set_as_cover: { type: 'boolean', description: 'Use this image as cover; otherwise an article without cover uses its first image.' },
      },
      output: { schema: sessionResultSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec.agent)
        const available = sessionImageReferences(eventsOf(exec.agent))
        const reference = args.source_image === undefined
          ? available.at(-1)
          : imageRef(args.source_image)
        if (!reference) throw new Error('当前会话未找到图片，请先上传、生成图片或提供选定图片的引用')
        if (!available.some(candidate => sameReference(candidate, reference))) {
          throw new Error('所选图片不在当前会话的上传或生图结果中，请在当前会话重新选择')
        }
        const verified = await ctx.attachments.readImage(reference, exec.signal)
        exec.signal.throwIfAborted()
        const suffix = verified.ref.mediaType === 'image/jpeg' ? 'jpg' : verified.ref.mediaType === 'image/webp' ? 'webp' : 'png'
        const name = verified.ref.name ?? `对话图片.${suffix}`
        return toolSnapshot(addSessionImage(
          sessionId, args.expected_revision, name, Buffer.from(verified.data), args.set_as_cover === true, args.content_type,
        ))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'publisher_remove_image',
      description: 'Remove ONE Publisher image asset explicitly rejected or replaced by the user in this conversation draft. Requires its asset ID and latest expected_revision. Also removes managed Markdown references to it from the body. An article cover falls back to the first remaining image. Never publishes.',
      parameters: {
        expected_revision: { type: 'integer', required: true, description: 'Latest revision returned by a Publisher draft tool.' },
        asset_id: { type: 'string', required: true, description: 'Publisher asset ID from the current conversation draft, not a DSH attachment ID.' },
      },
      output: { schema: sessionResultSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        return toolSnapshot(removeSessionImage(sessionIdOf(exec.agent), args.expected_revision, args.asset_id))
      },
    })),
    ctx.systemPrompt.section({ name: 'plugin:cqai-publisher:agent-draft', order: 70, text: AGENT_PUBLISHER_GUIDANCE }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
