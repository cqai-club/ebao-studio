import {
  attributionHeaders,
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
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'

import { isChatModel, type DsnAccountService, type DsnModel } from './protocol.ts'

/** Provider route used by the DSH model selector and session headers. */
export const CQAI_PROVIDER = 'cqaiclub'

type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; reasoning_content?: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

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

/**
 * DSH adapter for CQAI Club's authenticated OpenAI-compatible gateway.
 *
 * The browser never receives the account token. Every model lookup and every
 * completion is delegated to the host-side DsnAccountService, which injects
 * the current Account Service bearer token server-side.
 */
export class CqaiClubAdapter extends LlmAdapter {
  constructor(private readonly account: DsnAccountService) {
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

  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    // The account catalog is advisory in DSH. Keeping exact-model resolution
    // side-effect free also lets the gateway accept a newly-added model before
    // the next catalog refresh has completed.
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
    })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamRequest(options)
  }

  private async * streamRequest(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: serializeMessages(options.system, options.messages),
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
    inputModalities: ['text'],
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
      wire.push({
        role: 'assistant',
        content: text.join(''),
        ...reasoning.length === 0 ? {} : { reasoning_content: reasoning.join('') },
        ...toolCalls.length === 0 ? {} : { tool_calls: toolCalls },
      })
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
