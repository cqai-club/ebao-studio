/** OpenAI-compatible chat helpers used by the optional prompt-enhancement UI. */

import { isLikelyImageModelId } from './model-catalog.ts'

export interface PromptModelConfig {
  apiUrl: string
  apiKey: string
  model: string
}

/** Credentials shared by OpenAI-compatible `/models` discovery. */
export interface ModelListConfig {
  apiUrl: string
  apiKey: string
}

function endpoint(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}${suffix}`
}

function headers(apiKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    ...apiKey.trim() === '' ? {} : { authorization: `Bearer ${apiKey.trim()}` },
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok || body === undefined || body === null || typeof body !== 'object') {
    const message = body !== null && typeof body === 'object' && typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
      ? (body as { error: { message: string } }).error.message
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return body as Record<string, unknown>
}

type ModelRecord = Record<string, unknown> & { id: string }

/** Resolve discovery paths independently of the generation protocol. */
function modelListUrls(config: ModelListConfig): string[] {
  const base = config.apiUrl.trim().replace(/\/+$/, '')
  if (base === '') throw new Error('API URL is required')
  let url: URL
  try { url = new URL(base) } catch { return [endpoint(base, '/models')] }
  const path = url.pathname.replace(/\/+$/, '')
  const discoveryBase = path.replace(/\/(?:chat\/completions|models)$/i, '')
  url.pathname = `${discoveryBase}/models`
  url.search = ''
  url.hash = ''
  const urls = [url.toString()]
  // A gateway homepage may return HTML at /models but expose its API at /v1.
  if (!/\/v\d+(?:[a-z0-9._-]*)?$/i.test(discoveryBase)) {
    url.pathname = `${discoveryBase}/v1/models`
    urls.push(url.toString())
  }
  return [...new Set(urls)]
}

function boundedMessage(value: string, limit = 320): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function modelErrorMessage(body: unknown, fallback: string): string {
  if (body === null || typeof body !== 'object') return fallback
  const record = body as Record<string, unknown>
  const error = record.error
  const nestedMessage = error !== null && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  const message = typeof nestedMessage === 'string' && nestedMessage.trim() !== '' ? nestedMessage : record.message
  return typeof message === 'string' && message.trim() !== '' ? boundedMessage(message) : fallback
}

function modelRecordsOf(body: unknown): ModelRecord[] | undefined {
  const record = body !== null && typeof body === 'object' ? body as Record<string, unknown> : undefined
  const candidate = Array.isArray(body) ? body : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : undefined
  if (candidate === undefined) return undefined
  return candidate.flatMap(item => {
    const id = typeof item === 'string' ? item.trim()
      : item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim() : ''
    return id === '' ? [] : [{ ...(item !== null && typeof item === 'object' ? item as Record<string, unknown> : {}), id }]
  })
}

async function listModelRecords(config: ModelListConfig): Promise<ModelRecord[]> {
  let lastError: Error | undefined
  for (const url of modelListUrls(config)) {
    let response: Response
    try {
      response = await fetch(url, { headers: headers(config.apiKey) })
    } catch (error) {
      lastError = new Error(boundedMessage(error instanceof Error ? error.message : String(error)))
      continue
    }
    const text = await response.text().catch(() => '')
    let body: unknown
    try { body = JSON.parse(text) as unknown } catch { body = undefined }
    if (!response.ok) {
      lastError = new Error(modelErrorMessage(body, `HTTP ${response.status}`))
      // Authentication failures and other service errors must not cause retries.
      if (response.status !== 404 && response.status !== 405) throw lastError
      continue
    }
    if (body === undefined) {
      const type = boundedMessage(response.headers.get('content-type') ?? 'unknown content-type', 80)
      const sample = boundedMessage(text, 160)
      lastError = new Error(`模型接口返回了非 JSON 响应（HTTP ${response.status}, ${type}）${sample === '' ? '' : `：${sample}`}`)
      continue
    }
    const records = modelRecordsOf(body)
    if (records !== undefined) return records
    lastError = new Error(modelErrorMessage(body, '模型接口响应中没有 data/models 列表'))
  }
  throw lastError ?? new Error('模型接口不可用')
}

function textOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function hasImageGenerationCapability(record: ModelRecord): boolean | undefined {
  const capability = record.capabilities
  if (capability !== null && typeof capability === 'object') {
    const values = capability as Record<string, unknown>
    for (const key of ['image_generation', 'imageGeneration', 'text_to_image', 'textToImage', 'image_gen']) {
      if (typeof values[key] === 'boolean') return values[key]
    }
    const serialized = JSON.stringify(values).toLowerCase()
    if (/image[ _-]?generation|text[ _-]?to[ _-]?image/.test(serialized)) return true
  }

  const taskText = [
    ...textOf(record.task),
    ...textOf(record.task_type),
    ...textOf(record.taskType),
    ...textOf(record.type),
    ...textOf(record.model_type),
    ...textOf(record.modelType),
    ...textOf(record.tasks),
    ...textOf(record.description),
  ].join(' ').toLowerCase()
  if (/image[ _-]?generation|text[ _-]?to[ _-]?image|image[ _-]?gen/.test(taskText)) return true
  if (/^image(?:[ _-]?generation)?$/.test(taskText.trim())) return true
  if (/embedding|rerank|moderation|transcri|speech|audio|video|chat[ _-]?completion/.test(taskText)) return false

  for (const key of ['output_modalities', 'outputModalities', 'supported_output_modalities']) {
    const modalities = textOf(record[key]).map(value => value.toLowerCase())
    if (modalities.length > 0) return modalities.includes('image')
  }
  return undefined
}

function isImageModelRecord(record: ModelRecord): boolean {
  return hasImageGenerationCapability(record) ?? isLikelyImageModelId(record.id)
}

/** List candidates exposed by an OpenAI-compatible endpoint. */
export async function listOpenAIModels(config: ModelListConfig): Promise<string[]> {
  return [...new Set((await listModelRecords(config)).map(record => record.id))]
    .sort((a, b) => a.localeCompare(b))
}

/** List only models that advertise or conventionally represent image generation. */
export async function listImageModels(config: ModelListConfig): Promise<string[]> {
  return [...new Set((await listModelRecords(config)).filter(isImageModelRecord).map(record => record.id))]
    .sort((a, b) => a.localeCompare(b))
}

/** List chat models exposed by an OpenAI-compatible endpoint. */
export async function listPromptModels(config: PromptModelConfig): Promise<string[]> {
  return listOpenAIModels(config)
}

/** Remove reasoning-model artifacts from a chat model's visible content:
 *  complete `<think>…</think>` blocks first, then anything from a dangling
 *  unclosed `<think>` to the end of the text. Reasoning models served through
 *  OpenAI-compatible endpoints (MiniMax M3, DeepSeek R1, Qwen QVQ, …) inline
 *  these blocks in `message.content`; leaking them into the prompt box both
 *  pollutes the prompt and can push it past image models' length limits. */
export function stripReasoning(text: string): string {
  const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const dangling = /<think>/i.exec(withoutClosed)
  return (dangling === null ? withoutClosed : withoutClosed.slice(0, dangling.index)).trim()
}

/** One OpenAI-style multimodal user part (`text` or an `image_url` data URL). */
export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

/** One chat-completion request over the configured OpenAI-compatible endpoint. */
export interface ChatOptions {
  system: string
  /** Either a plain string or multimodal parts. */
  content: string | ChatPart[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/**
 * Run one chat completion and return the cleaned visible answer.
 *
 * Shared by prompt enhancement, the canvas light-tier skill runner and the
 * layer analyzer: it owns the endpoint, auth, error shaping (an upstream
 * `error.message` is surfaced verbatim) and the reasoning-strip step, so every
 * caller sees the same behaviour.
 * @param config - endpoint, secret and model.
 * @param options - prompt parts plus optional sampling controls.
 * @returns the model's visible answer, with reasoning artifacts removed.
 */
export async function chatComplete(config: PromptModelConfig, options: ChatOptions): Promise<string> {
  if (config.apiUrl.trim() === '' || config.model.trim() === '') {
    throw new Error('chat model is not configured (Settings > Plugins > e图宝 > Prompt enhancement)')
  }
  const response = await fetch(endpoint(config.apiUrl, '/chat/completions'), {
    method: 'POST',
    headers: headers(config.apiKey),
    body: JSON.stringify({
      model: config.model.trim(),
      temperature: options.temperature ?? 0.4,
      ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
      messages: [
        { role: 'system', content: options.system },
        {
          role: 'user',
          content: typeof options.content === 'string' ? options.content : options.content,
        },
      ],
    }),
    ...options.signal === undefined ? {} : { signal: options.signal },
  })
  const body = await responseJson(response)
  const choices = Array.isArray(body.choices) ? body.choices : []
  const content = choices[0] !== null && typeof choices[0] === 'object'
    ? (choices[0] as { message?: { content?: unknown } }).message?.content
    : undefined
  if (typeof content !== 'string' || content.trim() === '') throw new Error('chat model returned an empty answer')
  const answer = stripReasoning(content)
  if (answer === '') throw new Error('chat model returned only reasoning content (empty <think> payload)')
  return answer
}

/** Strip a fenced code block and pull the outermost JSON object/array out. */
export function jsonPayload(content: string): unknown {
  const cleaned = stripReasoning(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  const useArray = arrayStart >= 0 && arrayEnd > arrayStart && (objectStart < 0 || arrayStart < objectStart)
  const start = useArray ? arrayStart : objectStart
  const end = useArray ? arrayEnd : objectEnd
  if (start < 0 || end <= start) return undefined
  try { return JSON.parse(cleaned.slice(start, end + 1)) as unknown } catch { return undefined }
}

/** Expand a concise image request into a production-ready image prompt. */
export async function enhancePrompt(config: PromptModelConfig, prompt: string): Promise<string> {
  return chatComplete(config, {
    temperature: 0.7,
    system: 'You are an expert image-prompt editor. Expand the user request into one vivid, specific image-generation prompt. Preserve intent and language. Add only useful visual detail: subject, composition, lighting, materials, color, camera/style and quality. Return only the finished prompt, with no preface or markdown.',
    content: prompt,
  })
}

/** Polish one existing generation prompt without changing its purpose. */
export async function polishPrompt(config: PromptModelConfig, prompt: string): Promise<string> {
  return chatComplete(config, {
    temperature: 0.35,
    system: '你是电商生图提示词编辑。请在保持图片用途、商品事实、平台、语言和原有结构不变的前提下，润色文字并补充可执行的视觉细节，减少重复和空泛表达。只输出最终提示词，不要解释、标题或 Markdown。',
    content: prompt,
  })
}
