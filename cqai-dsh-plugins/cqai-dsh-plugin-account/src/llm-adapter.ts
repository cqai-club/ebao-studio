import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  Message,
  PreparedAdapterCall,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'

import {
  isChatModel,
  isVisionChatModel,
  type DsnAccountService,
  type DsnModel,
} from './protocol.ts'

/** Provider route used by the DSH model selector and session headers. */
export const CQAI_PROVIDER = 'cqaiclub'

type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: WireUserContent }
  | { role: 'assistant'; content: string; reasoning_content?: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type WireTextContentPart = { type: 'text'; text: string }
type WireImageContentPart = { type: 'image_url'; image_url: { url: string } }
type WireUserContentPart = WireTextContentPart | WireImageContentPart
type WireUserContent = string | WireUserContentPart[]

type WireToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type WireTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type WireChunk = {
  choices?: WireChoice[]
  usage?: WireUsage | null
}

type WireChoice = {
  delta?: WireDelta
  finish_reason?: string | null
}

type WireDelta = {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: WireToolCallDelta[]
}

type WireToolCallDelta = {
  index: number
  id?: string | null
  function?: { name?: string | null; arguments?: string | null }
}

type WireUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

type OpenBlock = {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId?: string
  name?: string
}

export interface CqaiClubAdapterOptions {
  /** Resolve the current durable attachment service only when a request contains images. */
  resolveAttachments?: () => AttachmentStore | undefined
}

const CQAI_IMAGE_REQUEST_POLICY = {
  maxPixels: 640_000,
  maxBytes: 1024 * 1024,
} as const satisfies ImageRequestPolicy

const TOOL_RESULT_IMAGE_TEXT = 'Attached image(s) from tool result:'

/**
 * DSH adapter for CQAI Club's authenticated OpenAI-compatible gateway.
 *
 * The browser never receives the account token. Every model lookup and every
 * completion is delegated to the host-side DsnAccountService, which injects
 * the current Account Service bearer token server-side.
 */
export class CqaiClubAdapter extends LlmAdapter {
  constructor(
    private readonly account: DsnAccountService,
    private readonly options: CqaiClubAdapterOptions = {},
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'CQAI Club' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const catalog = await this.account.listModels()
    return catalog.models
      .filter(isChatModel)
      .map((model) => modelInfo(provider, model))
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return resolvedModelInfo(provider, model, await this.catalogModel(model, signal))
  }

  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const catalogModel = await this.catalogModel(model, signal)
    return {
      model: resolvedModelInfo(provider, model, catalogModel),
      stream: options => this.streamRequest(options, catalogModel),
    }
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithCatalog(options)
  }

  private async catalogModel(model: string, signal?: AbortSignal): Promise<DsnModel | undefined> {
    const catalog = await this.account.listModels({ signal })
    return catalog.models.find(entry => entry.id === model && isChatModel(entry))
  }

  private async * streamWithCatalog(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const catalogModel = await this.catalogModel(options.model, options.signal)
    yield* this.streamRequest(options, catalogModel)
  }

  private async * streamRequest(
    options: GenerateOptions,
    catalogModel: DsnModel | undefined,
  ): AsyncIterable<StreamChunk> {
    const hasImages = options.messages.some(message => contentHasImage(message.content))
    let messages: WireMessage[]
    if (hasImages) {
      if (catalogModel === undefined || !isVisionChatModel(catalogModel)) {
        throw new LlmError(
          `CQAI Club 模型 "${options.model}" 的目录元数据未声明 image 输入`,
          'UNSUPPORTED_CONTENT',
        )
      }
      const attachments = this.options.resolveAttachments?.()
      if (attachments === undefined) {
        throw new LlmError('CQAI Club 图片输入需要附件存储服务', 'UNSUPPORTED_CONTENT')
      }
      assertSupportedImageRoles(options.messages)
      const requestImages = await prepareRequestImages(options.messages, attachments, options.signal)
      messages = await serializeMessagesWithImages(options.system, options.messages, requestImages)
    } else {
      messages = serializeMessages(options.system, options.messages)
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...options.tools === undefined || options.tools.length === 0 ? {} : { tools: serializeTools(options.tools) },
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
      ...options.stop === undefined || options.stop.length === 0 ? {} : { stop: options.stop },
    }

    let response: Response
    try {
      response = await this.account.fetchAi(
        '/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'accept': 'text/event-stream',
            'content-type': 'application/json',
            ...attributionHeaders(),
          },
          body: JSON.stringify(body),
        },
        options.signal,
      )
    } catch (error) {
      if (error instanceof LlmError) throw error
      throw new LlmError('CQAI Club AI 请求失败', 'TRANSPORT', { cause: error })
    }

    if (!response.ok) throw await errorFromResponse(response)
    if (response.body === null) {
      throw new LlmError('CQAI Club AI 返回了空响应流', 'MALFORMED_RESPONSE', { status: response.status })
    }

    yield* translateStream(parseSse(response.body))
  }
}

function modelInfo(provider: string, model: DsnModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: modelInputModalities(model),
  }
}

function resolvedModelInfo(
  provider: string,
  model: string,
  catalogModel: DsnModel | undefined,
): LlmResolvedModelInfo {
  if (catalogModel !== undefined) return modelInfo(provider, catalogModel)
  // Exact ids remain routable even when absent from the advisory catalog, but
  // unknown capability must stay conservative so images are never sent blindly.
  return { provider, id: model, name: model, inputModalities: ['text'] }
}

function modelInputModalities(model: DsnModel): readonly ['text'] | readonly ['text', 'image'] {
  return isVisionChatModel(model) ? ['text', 'image'] : ['text']
}

function serializeAssistant(message: Message): Extract<WireMessage, { role: 'assistant' }> {
  const text: string[] = []
  const reasoning: string[] = []
  const toolCalls: WireToolCall[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text': text.push(block.text); break
      case 'reasoning': reasoning.push(block.text); break
      case 'tool-call':
        toolCalls.push({
          id: String(block.id),
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        })
        break
      default: assertTextOnly(block)
    }
  }
  return {
    role: 'assistant',
    content: text.join(''),
    ...reasoning.length === 0 ? {} : { reasoning_content: reasoning.join('') },
    ...toolCalls.length === 0 ? {} : { tool_calls: toolCalls },
  }
}

function serializeMessages(system: string | undefined, messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  if (system !== undefined && system.length > 0) wire.push({ role: 'system', content: system })

  for (const message of messages) {
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }

    const text: string[] = []
    const toolResults: Array<{ toolCallId: string; content: string }> = []
    for (const block of message.content) {
      if (block.type === 'tool-result') {
        toolResults.push({
          toolCallId: String(block.toolCallId),
          content: flattenText(block.content) || '(no output)',
        })
      } else if (block.type === 'text' || block.type === 'reasoning') {
        text.push(block.text)
      } else {
        assertTextOnly(block)
      }
    }
    if (text.length > 0 || toolResults.length === 0) wire.push({ role: 'user', content: text.join('') })
    for (const result of toolResults) {
      wire.push({ role: 'tool', tool_call_id: result.toolCallId, content: result.content })
    }
  }
  return wire
}

async function serializeMessagesWithImages(
  system: string | undefined,
  messages: readonly Message[],
  requestImages: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>,
): Promise<WireMessage[]> {
  const wire: WireMessage[] = []
  if (system !== undefined && system.length > 0) wire.push({ role: 'system', content: system })

  let pendingToolImages: WireImageContentPart[] = []
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return
    wire.push({
      role: 'user',
      content: [{ type: 'text', text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages],
    })
    pendingToolImages = []
  }

  for (const message of messages) {
    if (message.role === 'system') {
      flushToolImages()
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      flushToolImages()
      wire.push(serializeAssistant(message))
      continue
    }

    const regular = message.content.filter(block => block.type !== 'tool-result')
    const toolResults = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    const content = wireUserContent(imageContentParts(regular, requestImages))
    if (content.length > 0 || toolResults.length === 0) {
      flushToolImages()
      wire.push({ role: 'user', content })
    }
    for (const result of toolResults) {
      const parts = imageContentParts(result.content, requestImages)
      const images = parts.filter((part): part is WireImageContentPart => part.type === 'image_url')
      const text = parts.filter((part): part is WireTextContentPart => part.type === 'text')
        .map(part => part.text)
        .join('')
      wire.push({
        role: 'tool',
        tool_call_id: String(result.toolCallId),
        content: text || '(no output)',
      })
      pendingToolImages.push(...images)
    }
  }
  flushToolImages()
  return wire
}

function imageContentParts(
  blocks: readonly ContentBlock[],
  requestImages: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>,
): WireUserContentPart[] {
  const parts: WireUserContentPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const version = requestImages.get(block.attachment.attachmentId)
        if (version === undefined) {
          throw new LlmError(
            `CQAI Club 请求图片 ${block.attachment.attachmentId} 未完成准备`,
            'INVALID_REQUEST',
          )
        }
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`,
          },
        })
        break
      }
      case 'tool-result':
        parts.push(...imageContentParts(block.content, requestImages))
        break
      default:
        assertTextOnly(block)
    }
  }
  return parts
}

function wireUserContent(parts: readonly WireUserContentPart[]): WireUserContent {
  const text: string[] = []
  for (const part of parts) {
    if (part.type !== 'text') return [...parts]
    text.push(part.text)
  }
  return text.join('')
}

function assertSupportedImageRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `CQAI Club 无法在 ${message.role} 消息中表示图片输入`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

function collectImageRefs(
  blocks: readonly ContentBlock[],
  refs: Map<ImageAttachmentRef['attachmentId'], ImageAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

async function prepareRequestImages(
  messages: readonly Message[],
  attachments: AttachmentStore,
  signal?: AbortSignal,
): Promise<Map<ImageAttachmentRef['attachmentId'], RequestImageAttachment>> {
  const refs = new Map<ImageAttachmentRef['attachmentId'], ImageAttachmentRef>()
  for (const message of messages) collectImageRefs(message.content, refs)
  const orderedRefs = [...refs.values()]
  const projected = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, CQAI_IMAGE_REQUEST_POLICY, signal),
  ))
  return new Map(orderedRefs.map((ref, index) => (
    [ref.attachmentId, projected[index] as RequestImageAttachment]
  )))
}

function serializeTools(tools: ToolSchema[]): WireTool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function flattenText(blocks: ContentBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
      case 'reasoning': return block.text
      case 'tool-result': return flattenText(block.content)
      default: return assertTextOnly(block)
    }
  }).join('')
}

function assertTextOnly(block: ContentBlock): never {
  if (block.type === 'image') {
    throw new LlmError('CQAI Club 当前适配器暂不支持图片输入', 'UNSUPPORTED_CONTENT')
  }
  if (block.type === 'file') {
    throw new LlmError('CQAI Club 当前适配器暂不支持文件输入', 'UNSUPPORTED_CONTENT')
  }
  if (block.type === 'tool-call' || block.type === 'tool-result') {
    throw new LlmError('CQAI Club 收到了不支持的消息内容', 'UNSUPPORTED_CONTENT')
  }
  throw new LlmError('CQAI Club 收到了不支持的消息内容', 'UNSUPPORTED_CONTENT')
}

async function errorFromResponse(response: Response): Promise<LlmError> {
  let message = `CQAI Club AI 请求失败（HTTP ${response.status}）`
  try {
    const text = await response.text()
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        const nested = record.error
        const nestedMessage = nested !== null && typeof nested === 'object'
          ? (nested as Record<string, unknown>).message
          : undefined
        if (typeof nestedMessage === 'string') {
          message = nestedMessage
        } else if (typeof record.message === 'string') {
          message = record.message
        }
      }
    }
  } catch {
    // Keep the stable HTTP fallback when the gateway did not return JSON.
  }
  const code = response.status === 401
    ? 'AUTH'
    : response.status === 403
      ? 'FORBIDDEN'
      : response.status === 429
        ? 'RATE_LIMIT'
        : response.status >= 500
          ? 'UPSTREAM'
          : 'UPSTREAM_RESPONSE'
  return new LlmError(message, code, { status: response.status })
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let done = false

  try {
    while (!done) {
      const result = await reader.read()
      const text = decoder.decode(result.value, { stream: !result.done })
      buffer += text
      const payloads = consumeSseLines(buffer, dataLines)
      buffer = payloads.rest
      dataLines = payloads.dataLines
      for (const payload of payloads.events) {
        yield payload
        if (payload === '[DONE]') {
          done = true
          break
        }
      }
      if (result.done) break
    }
    if (!done) throw new LlmError('CQAI Club SSE 流在 [DONE] 前结束', 'STREAM_CLOSED')
  } finally {
    reader.releaseLock()
  }
}

function consumeSseLines(
  input: string,
  initialDataLines: string[],
): { rest: string; dataLines: string[]; events: string[] } {
  let rest = input
  const dataLines = initialDataLines
  const events: string[] = []
  while (true) {
    const newline = rest.indexOf('\n')
    if (newline < 0) break
    let line = rest.slice(0, newline)
    rest = rest.slice(newline + 1)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (line.length === 0) {
      if (dataLines.length > 0) {
        events.push(dataLines.join('\n'))
        dataLines.length = 0
      }
      continue
    }
    if (line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    const value = line.slice(5)
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
  }
  return { rest, dataLines, events }
}

async function* translateStream(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let finish: FinishReason | undefined
  let usage: TokenUsage | undefined

  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block = { index: nextIndex++, kind, text: '' } satisfies OpenBlock
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') {
      for (const block of order) yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      if (usage !== undefined) yield { type: 'usage', usage }
      yield { type: 'finish', reason: finish ?? { kind: 'stop' } }
      return
    }

    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload) as WireChunk
    } catch {
      throw new LlmError(`CQAI Club SSE 数据格式错误：${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta
      const reasoning = delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        reasoningBlock ??= open('reasoning')
        if (reasoningBlock.text.length === 0) yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        textBlock ??= open('text')
        if (textBlock.text.length === 0) yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }

      for (const call of delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index)
        if (block === undefined) {
          block = open('tool-call')
          toolBlocks.set(call.index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (typeof call.id === 'string' && call.id.length > 0) block.callId = call.id
        const name = call.function?.name
        if (typeof name === 'string' && name.length > 0) block.name = name
        const argumentsDelta = typeof call.function?.arguments === 'string' ? call.function.arguments : ''
        block.text += argumentsDelta
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: ToolCallId(block.callId ?? `call-${call.index}`),
          ...block.name === undefined ? {} : { name: block.name },
          argumentsDelta,
        }
      }

      if (typeof choice.finish_reason === 'string') finish = mapFinishReason(choice.finish_reason)
    }
    if (chunk.usage !== null && chunk.usage !== undefined) usage = mapUsage(chunk.usage)
  }
  throw new LlmError('CQAI Club SSE 数据流异常结束', 'STREAM_CLOSED')
}

function closeBlock(block: OpenBlock): ContentBlock {
  if (block.kind === 'text') return { type: 'text', text: block.text }
  if (block.kind === 'reasoning') return { type: 'reasoning', text: block.text }
  return {
    type: 'tool-call',
    id: ToolCallId(block.callId ?? `call-${block.index}`),
    name: block.name ?? '',
    arguments: block.text,
  }
}

function mapFinishReason(reason: string): FinishReason {
  if (reason === 'stop') return { kind: 'stop' }
  if (reason === 'tool_calls') return { kind: 'tool-calls' }
  if (reason === 'length') return { kind: 'max-tokens' }
  return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } }
}

function mapUsage(usage: WireUsage): TokenUsage {
  const inputTokens = integerOrZero(usage.prompt_tokens)
  const outputTokens = integerOrZero(usage.completion_tokens)
  const cacheReadTokens = positiveOrUndefined(usage.prompt_tokens_details?.cached_tokens)
  const total = inputTokens + outputTokens
  return {
    inputTokens: Math.max(0, inputTokens - (cacheReadTokens ?? 0)),
    outputTokens,
    ...Number.isSafeInteger(usage.total_tokens) && usage.total_tokens === total ? { totalTokens: total } : {},
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...positiveOrUndefined(usage.completion_tokens_details?.reasoning_tokens) === undefined
      ? {}
      : { reasoningTokens: positiveOrUndefined(usage.completion_tokens_details?.reasoning_tokens) },
  }
}

function integerOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function positiveOrUndefined(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
