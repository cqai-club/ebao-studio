/** CQAI-backed image Provider shared by the workbench, queue and Agent tools. */

import type {
  DsnAccountService,
  DsnAccountSnapshot,
  DsnModel,
} from '@cqaiclub/dsn-account'
import { isChatModel, isImageGenerationModel } from '@cqaiclub/dsn-account'
import { ImageGenError } from './engine.ts'
import type { RuntimeChannel } from './generation-runtime.ts'
import { stripReasoning, type ChatOptions } from './prompt-enhancer.ts'
import type { CqaiImageProviderView, GenerateRequest, ModelMapping } from './protocol.ts'

/** ImageGen's stable task/provider id. It is intentionally independent from
 * the shared account plugin's ordinary chat-provider id (`cqaiclub`). */
export const CQAI_IMAGE_CHANNEL_ID = 'cqai'
export const CQAI_IMAGE_CHANNEL_NAME = 'CQAI'
const CQAI_ACCOUNT_PROVIDER_IDS = new Set(['cqaiclub', 'cqai'])
const CQAI_ACCOUNT_SERVICE_URL = 'https://account.cqaiclub.asia'

function isAccountProvider(provider: string): boolean {
  return CQAI_ACCOUNT_PROVIDER_IDS.has(provider.trim())
}

function accountFailure(error: unknown): ImageGenError {
  if (error instanceof ImageGenError) return error
  // Keep the consumer boundary structural. The shared service may be supplied
  // by a separately packaged host instance, so error mapping must not depend
  // on both plugins resolving the exact same class object.
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    switch (error.code) {
      case 'DSN_AUTH_REQUIRED':
        return new ImageGenError('请先登录 CQAI Club 后再生图。', 'cqai-auth-required')
      case 'DSN_REAUTH_REQUIRED':
      case 'DSN_LOGIN_EXPIRED':
        return new ImageGenError('CQAI Club 登录已失效，请重新登录后再试。', 'cqai-reauth-required')
      case 'DSN_MODEL_UNAVAILABLE':
        return new ImageGenError(error.message, 'cqai-model-unavailable')
      case 'DSN_ACCOUNT_UNAVAILABLE':
        return new ImageGenError(error.message, 'cqai-account-unavailable')
      default:
        return new ImageGenError(error.message, 'cqai-provider-failed')
    }
  }
  return new ImageGenError(error instanceof Error ? error.message : String(error), 'cqai-provider-failed')
}

function mappings(models: readonly DsnModel[]): ModelMapping[] {
  return models.filter(isImageGenerationModel).map(model => ({ alias: model.id, id: model.id }))
}

function responseMessage(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const error = record.error
    if (error !== null && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim() !== '') return message
    }
    if (typeof record.message === 'string' && record.message.trim() !== '') return record.message
  }
  return `CQAI 请求失败（HTTP ${status}）`
}

/**
 * CQAI is an immutable virtual channel. The only credential-bearing operation
 * is `dsnAccount.fetchAi`; callers receive a narrow request callback, never the
 * OAuth token or Relay key itself.
 */
export class CqaiImageProvider {
  private cachedModels: ModelMapping[] = []

  constructor(private readonly account: DsnAccountService) {}

  channel(): RuntimeChannel {
    return {
      id: CQAI_IMAGE_CHANNEL_ID,
      preset: CQAI_IMAGE_CHANNEL_ID,
      name: CQAI_IMAGE_CHANNEL_NAME,
      // fetchAi owns the real (and development-overridable) destination. This
      // URL is only transport metadata used while normalizing returned URLs.
      apiUrl: `${CQAI_ACCOUNT_SERVICE_URL}/v1`,
      apiKey: '',
      models: [...this.cachedModels],
      protocol: 'openai',
      request: async (path, init, signal) => {
        if (path !== '/v1/images/generations' && path !== '/v1/images/edits') {
          throw new ImageGenError(`CQAI Image Provider 不允许访问端点 ${path}`, 'cqai-endpoint-forbidden')
        }
        return this.account.fetchAi(path, init, signal)
      },
    }
  }

  async describe(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<CqaiImageProviderView> {
    const snapshot = await this.account.getStatus({ refreshAccount: options.refresh, signal: options.signal })
    return this.describeSnapshot(snapshot, options)
  }

  /**
   * Refresh the Provider view from an account event that already carries the
   * current snapshot. Do not call getStatus() from this path: getStatus emits
   * the same event, which would otherwise create an unbounded feedback loop.
   */
  async describeSnapshot(
    snapshot: DsnAccountSnapshot,
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<CqaiImageProviderView> {
    if (snapshot.state !== 'signed-in') {
      this.cachedModels = []
      return {
        provider: CQAI_IMAGE_CHANNEL_ID,
        immutable: true,
        state: snapshot.state,
        models: [],
        ...snapshot.state === 'reauth-required' ? { message: snapshot.reason } : {},
        ...snapshot.state === 'error' ? { message: snapshot.message } : {},
      }
    }
    try {
      const [catalog, defaults] = await Promise.all([
        this.account.listModels({ refresh: options.refresh, signal: options.signal }),
        this.account.getCategoryDefaultModels(),
      ])
      this.cachedModels = mappings(catalog.models)
      const selected = defaults.categories.image
      const defaultModel = selected !== undefined && isAccountProvider(selected.provider)
        && this.cachedModels.some(model => model.id === selected.model)
        ? selected.model
        : undefined
      return {
        provider: CQAI_IMAGE_CHANNEL_ID,
        immutable: true,
        state: 'signed-in',
        models: [...this.cachedModels],
        ...defaultModel === undefined ? {} : { defaultModel },
        ...catalog.stale ? { stale: true } : {},
        ...catalog.warning === undefined ? {} : { warning: catalog.warning },
      }
    } catch (error) {
      throw accountFailure(error)
    }
  }

  /** Apply the image-model selection rules before a task enters the queue. */
  async resolveRequest(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateRequest> {
    try {
      const view = await this.describe({ signal })
      if (view.state !== 'signed-in') {
        if (view.state === 'reauth-required') throw new ImageGenError('CQAI Club 登录已失效，请重新登录后再试。', 'cqai-reauth-required')
        if (view.state === 'error') {
          throw new ImageGenError(view.message ?? 'CQAI Account Service 暂时不可用，请稍后重试。', 'cqai-account-unavailable')
        }
        throw new ImageGenError('请先登录 CQAI Club 后再生图。', 'cqai-auth-required')
      }
      if (view.models.length === 0) {
        throw new ImageGenError('当前 CQAI 账号没有可用的图像生成模型。', 'cqai-no-image-models')
      }
      const wanted = request.model.trim()
      const selected = wanted === ''
        ? (view.defaultModel === undefined
            ? (view.models.length === 1 ? view.models[0] : undefined)
            : view.models.find(model => model.id === view.defaultModel))
        : view.models.find(model => model.alias === wanted || model.id === wanted)
      if (selected === undefined) {
        if (wanted !== '') {
          throw new ImageGenError(
            `CQAI 图像模型「${wanted}」当前不可用；可用模型：${view.models.map(model => model.alias).join('、')}`,
            'cqai-model-unavailable',
          )
        }
        throw new ImageGenError(
          `CQAI 有多个图像模型，请先选择一个：${view.models.map(model => model.alias).join('、')}`,
          'model-choice-required',
        )
      }
      return {
        ...request,
        model: selected.alias,
        upstream: selected.id,
        channelId: CQAI_IMAGE_CHANNEL_ID,
        channel: CQAI_IMAGE_CHANNEL_NAME,
      }
    } catch (error) {
      throw accountFailure(error)
    }
  }

  async listChatModels(signal?: AbortSignal): Promise<string[]> {
    try {
      const catalog = await this.account.listModels({ signal })
      return catalog.models.filter(isChatModel).map(model => model.id)
    } catch (error) {
      throw accountFailure(error)
    }
  }

  /** Prompt enhancement and light canvas skills share CQAI chat completions. */
  async complete(options: ChatOptions): Promise<string> {
    try {
      const catalog = await this.account.listModels({ signal: options.signal })
      const chatModels = catalog.models.filter(isChatModel)
      const defaultSelection = await this.account.getDefaultModel()
      const chosen = isAccountProvider(defaultSelection.provider)
        ? chatModels.find(model => model.id === defaultSelection.model)
        : undefined
      const model = chosen ?? (chatModels.length === 1 ? chatModels[0] : undefined)
      if (model === undefined) {
        throw new ImageGenError(
          chatModels.length === 0
            ? '当前 CQAI 账号没有可用于提示词增强的对话模型。'
            : '请先在 CQAI 账号设置中选择默认对话模型，再使用提示词增强。',
          'cqai-chat-model-required',
        )
      }
      const response = await this.account.fetchAi('/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model.id,
          temperature: options.temperature ?? 0.4,
          ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.content },
          ],
        }),
      }, options.signal)
      const body: unknown = await response.json().catch(() => undefined)
      if (!response.ok || body === null || typeof body !== 'object') {
        throw new ImageGenError(responseMessage(body, response.status), 'cqai-prompt-failed')
      }
      const choices = Array.isArray((body as Record<string, unknown>).choices)
        ? (body as { choices: unknown[] }).choices
        : []
      const content = choices[0] !== null && typeof choices[0] === 'object'
        ? (choices[0] as { message?: { content?: unknown } }).message?.content
        : undefined
      if (typeof content !== 'string' || content.trim() === '') {
        throw new ImageGenError('CQAI 对话模型返回了空内容。', 'cqai-prompt-empty')
      }
      const visible = stripReasoning(content)
      if (visible === '') throw new ImageGenError('CQAI 对话模型没有返回可见内容。', 'cqai-prompt-empty')
      return visible
    } catch (error) {
      throw accountFailure(error)
    }
  }
}
