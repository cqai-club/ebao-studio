/**
 * Shared host-side generation runtime. Both the browser routes and Agent tools
 * submit to this one queue so persisted history and cancellation semantics stay
 * identical regardless of where a request originated.
 *
 * Requests may carry a channel id (host-filled by the route/tool resolution).
 * Explicit ids are fail-closed if that channel has since been removed; only a
 * request without an id may pick the current default. This prevents retries
 * from silently changing Provider. A channel snapshot is kept on history so
 * usage counters and filters survive channel deletion.
 */

import { randomUUID } from 'node:crypto'
import { generateImage, ImageGenError, type UpstreamConfig } from './engine.ts'
import { appendHistory } from './history-store.ts'
import { GenerationTaskQueue } from './task-queue.ts'
import type { ChannelConfig, GenerateRequest, GenerateResult, HistoryEntry, HistoryEntryInput } from './protocol.ts'

/** A channel with its resolved API key (the settings doc holds the key
 *  separately so redacted reads never expose it). */
export interface RuntimeChannel extends ChannelConfig {
  apiKey: string
  /** Transport dialect. CQAI always uses Relay's OpenAI-compatible facade. */
  protocol?: UpstreamConfig['protocol']
  /** Host-only request bridge (used by CQAI to inject OAuth credentials). */
  request?: UpstreamConfig['request']
}

/** The resolved channels view the runtime picks upstream credentials from. */
export interface ChannelsView {
  channels: RuntimeChannel[]
  defaultChannelId: string
}

export interface HistorySink {
  append(entry: HistoryEntryInput): Promise<HistoryEntry[]>
}

export class ImageGenerationRuntime {
  readonly queue: GenerationTaskQueue

  constructor(
    private readonly resolve: () => ChannelsView,
    private readonly history: HistorySink = { append: appendHistory },
  ) {
    // Every task runs in parallel up to this small host-wide limit; a
    // four-model comparison fits within it in a single wave.
    this.queue = new GenerationTaskQueue((request, signal) => this.run(request, signal), 4)
  }

  async run(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    const view = this.resolve()
    const requestedChannelId = request.channelId?.trim() ?? ''
    const requestedChannel = requestedChannelId === ''
      ? undefined
      : view.channels.find(candidate => candidate.id === requestedChannelId)
    if (requestedChannelId !== '' && requestedChannel === undefined) {
      throw new ImageGenError(
        `Provider「${requestedChannelId}」未配置或已被删除；为避免使用错误渠道，本任务不会自动切换 Provider`,
        'provider-not-configured',
      )
    }
    const channel = requestedChannel
      ?? view.channels.find(candidate => candidate.id === view.defaultChannelId)
      ?? view.channels[0]
    if (channel === undefined) {
      throw new ImageGenError('尚未配置任何渠道：请先在「设置 → 插件 → e图宝」添加渠道并填写 API 地址与密钥', 'no-channels')
    }
    const upstream: UpstreamConfig = {
      apiUrl: channel.apiUrl,
      apiKey: channel.apiKey,
      ...channel.protocol === undefined ? {} : { protocol: channel.protocol },
      ...channel.request === undefined ? {} : { request: channel.request },
    }
    const result = await generateImage(upstream, request, { signal })
    try {
      const history = await this.history.append({
        id: randomUUID(),
        createdAt: Date.now(),
        mode: request.mode,
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        detail: request.detail,
        n: request.n,
        images: result.images,
        ...request.refName === undefined ? {} : { refName: request.refName },
        ...request.channelId === undefined ? {} : { channelId: request.channelId },
        ...request.channel === undefined ? {} : { channel: request.channel },
        ...request.comparisonId === undefined ? {} : { comparisonId: request.comparisonId },
        ...request.comparisonModels === undefined ? {} : { comparisonModels: request.comparisonModels },
        ...request.workflow === undefined ? {} : { workflow: request.workflow },
        ...request.projectId === undefined ? {} : { projectId: request.projectId },
        ...request.projectName === undefined ? {} : { projectName: request.projectName },
        ...request.slotKey === undefined ? {} : { slotKey: request.slotKey },
        ...request.slotLabel === undefined ? {} : { slotLabel: request.slotLabel },
        ...request.canvas === undefined ? {} : { canvas: request.canvas },
      })
      return { ...result, history }
    } catch (error) {
      return { ...result, historyError: error instanceof Error ? error.message : String(error) }
    }
  }
}
