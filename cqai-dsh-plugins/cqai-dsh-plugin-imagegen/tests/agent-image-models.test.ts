import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerAgentImageTools, submitAgentImageEdit, type AgentImageToolConfig } from '../src/agent-image-tools.ts'
import type { ImageGenerationRuntime, RuntimeChannel } from '../src/generation-runtime.ts'
import type { CqaiImageProviderView, GenerateRequest } from '../src/protocol.ts'

const SOURCE = { attachment_id: 'uploaded-image', media_type: 'image/png', bytes: 3, width: 1, height: 1 }
const REFERENCE = { attachmentId: SOURCE.attachment_id, mediaType: 'image/png' as const, bytes: 3, width: 1, height: 1 }
const view = (models = [{ alias: 'fresh-image', id: 'fresh-upstream' }], defaultModel?: string): CqaiImageProviderView => ({
  provider: 'cqai', immutable: true, state: 'signed-in', models,
  ...defaultModel === undefined ? {} : { defaultModel },
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const tools = new Map<string, ToolDefinition>()
  const channels: RuntimeChannel[] = [
    { id: 'cqai', preset: 'cqai', name: 'CQAI', apiUrl: 'https://account.test/private', apiKey: '', models: [{ alias: 'cached-image', id: 'cached-upstream' }], request: vi.fn() },
    { id: 'custom:third', preset: 'custom', name: 'Third party', apiUrl: 'https://private-provider.test', apiKey: 'secret-custom-key', models: [{ alias: 'custom-image', id: 'custom-upstream' }] },
  ]
  const config: AgentImageToolConfig = {
    enabled: true, allowAgentImageGeneration: true, announceToAgent: false,
    channels, defaultChannelId: 'custom:third', describeCqai: vi.fn(async () => view()),
    resolveCqaiRequest: vi.fn(async request => ({ ...request, model: 'fresh-image', upstream: 'fresh-upstream', channelId: 'cqai', channel: 'CQAI' })),
  }
  const attachments = {
    readImage: vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), ref: REFERENCE })),
    saveImages: vi.fn(async () => []),
  }
  const submit = vi.fn((request: GenerateRequest) => ({ id: 'queued-task', request, status: 'queued', createdAt: 1 }))
  const runtime = { queue: { submit, list: vi.fn(() => []), subscribe: vi.fn(() => () => {}), cancel: vi.fn() } } as unknown as ImageGenerationRuntime
  const ctx = { tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } }, attachments } as unknown as Context
  const dispose = registerAgentImageTools(ctx, runtime, () => config)
  const call = (name: string, args: unknown = {}, signal = new AbortController().signal) => tools.get(name)!.execute(args, { signal } as never)
  return { tools, config, attachments, submit, runtime, dispose, call }
}

describe('Agent image model discovery', () => {
  it('refreshes the CQAI catalog on demand and exposes only the public provider projection', async () => {
    const test = fixture()
    const modelWithPrivateFields = { alias: 'first', id: 'upstream-first', apiKey: 'nested-secret' }
    const describeCqai = vi.fn().mockResolvedValueOnce({
      ...view([modelWithPrivateFields], 'upstream-first'),
      apiUrl: 'https://secret.test', apiKey: 'account-secret', warning: 'internal detail', request: vi.fn(),
    }).mockResolvedValueOnce(view([{ alias: 'second', id: 'upstream-second' }]))
    test.config.describeCqai = describeCqai
    const signal = new AbortController().signal
    expect(await test.call('list_image_generation_models', {}, signal)).toEqual({
      default_provider: 'cqai', providers: [
        { id: 'cqai', name: 'CQAI', configured: true, state: 'signed-in', models: [{ alias: 'first', id: 'upstream-first' }], selection: 'default', default_model: 'upstream-first' },
        { id: 'custom:third', name: 'Third party', configured: true, state: 'configured', models: [{ alias: 'custom-image', id: 'custom-upstream' }], selection: 'single' },
      ],
    })
    const next = await test.call('list_image_generation_models')
    expect((next as { providers: unknown[] }).providers[0]).toMatchObject({ models: [{ alias: 'second', id: 'upstream-second' }], selection: 'single' })
    expect(describeCqai).toHaveBeenCalledWith(signal)
    expect(describeCqai).toHaveBeenCalledTimes(2)
    expect(test.config.resolveCqaiRequest).not.toHaveBeenCalled()
    expect(test.submit).not.toHaveBeenCalled()
    expect(test.tools.size).toBe(5)
    test.dispose()
    expect(test.tools.size).toBe(0)
  })

  it.each([
    { models: [{ alias: 'a', id: 'a' }, { alias: 'b', id: 'b' }], defaultModel: 'gone', selection: 'choice-required' },
    { models: [{ alias: 'a', id: 'a' }], defaultModel: undefined, selection: 'single' },
    { models: [], defaultModel: undefined, selection: 'unavailable' },
  ])('reports $selection without changing or guessing the account default', async ({ models, defaultModel, selection }) => {
    const test = fixture()
    test.config.describeCqai = vi.fn(async () => view(models, defaultModel))
    const result = await test.call('list_image_generation_models')
    expect((result as { providers: unknown[] }).providers[0]).toMatchObject({ selection })
    expect((result as { providers: object[] }).providers[0]).not.toHaveProperty('default_model')
    expect(test.config.resolveCqaiRequest).not.toHaveBeenCalled()
    expect(test.submit).not.toHaveBeenCalled()
  })

  it('keeps CQAI as the default while signed out and marks incomplete custom channels unavailable', async () => {
    const test = fixture()
    test.config.describeCqai = vi.fn(async (): Promise<CqaiImageProviderView> => ({ ...view([]), state: 'signed-out' }))
    test.config.channels[1].apiKey = ''
    expect(await test.call('list_image_generation_models')).toMatchObject({
      default_provider: 'cqai', providers: [
        { id: 'cqai', configured: false, state: 'signed-out', selection: 'unavailable' },
        { id: 'custom:third', configured: false, state: 'unconfigured', selection: 'unavailable' },
      ],
    })
  })

  it('does not replace CQAI failures with a custom catalog or generation', async () => {
    const test = fixture()
    test.config.describeCqai = vi.fn(async () => { throw new Error('CQAI catalog unavailable') })
    await expect(test.call('list_image_generation_models')).rejects.toThrow('CQAI catalog unavailable')
    test.config.resolveCqaiRequest = vi.fn(async () => { throw new Error('CQAI model unavailable') })
    await expect(test.call('generate_image', { prompt: 'draw', wait_for_completion: false })).rejects.toThrow('CQAI model unavailable')
    expect(test.submit).not.toHaveBeenCalled()
  })

  it('uses CQAI for omitted providers and requires an explicit custom selection', async () => {
    const test = fixture()
    await test.call('generate_image', { prompt: 'draw', wait_for_completion: false })
    expect(test.submit).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 'cqai', model: 'fresh-image' }))
    await test.call('generate_image', { prompt: 'draw', provider: 'custom:third', model: 'custom-image', wait_for_completion: false })
    expect(test.submit).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 'custom:third', model: 'custom-image', upstream: 'custom-upstream' }))
    expect(test.config.resolveCqaiRequest).toHaveBeenCalledOnce()
  })

  it('supports legacy low-level callers without a CQAI discovery callback', async () => {
    const test = fixture()
    test.config.describeCqai = undefined
    const legacy = await test.call('list_image_generation_models')
    expect((legacy as { providers: unknown[] }).providers[0]).toMatchObject({
      id: 'cqai', state: 'unknown', models: [{ alias: 'cached-image', id: 'cached-upstream' }], selection: 'single',
    })
    test.config.channels = [test.config.channels[1]]
    expect(await test.call('list_image_generation_models')).toMatchObject({ default_provider: 'custom:third' })
  })

  it.each(['enabled', 'allowAgentImageGeneration'] as const)('rejects model discovery when %s is disabled', async setting => {
    const test = fixture()
    test.config[setting] = false
    await expect(test.call('list_image_generation_models')).rejects.toThrow('disabled')
    expect(test.config.describeCqai).not.toHaveBeenCalled()
    expect(test.submit).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'disable'] as const)('rejects a late catalog response after %s', async change => {
    const test = fixture()
    const gate = deferred()
    const entered = deferred()
    const controller = new AbortController()
    test.config.describeCqai = vi.fn(async signal => { expect(signal).toBe(controller.signal); entered.resolve(); await gate.promise; return view() })
    const pending = test.call('list_image_generation_models', {}, controller.signal)
    await entered.promise
    if (change === 'cancel') controller.abort(new Error('request canceled'))
    else test.config.enabled = false
    gate.resolve()
    await expect(pending).rejects.toThrow(change === 'cancel' ? 'request canceled' : 'disabled')
    expect(test.submit).not.toHaveBeenCalled()
  })
})

describe('Image generation preflight races', () => {
  it.each([
    ['generate', 'cancel'], ['generate', 'disable'], ['generate', 'deny-agent'],
    ['edit-attachment', 'cancel'], ['edit-attachment', 'disable'], ['edit-attachment', 'deny-agent'],
    ['edit-provider', 'cancel'], ['edit-provider', 'disable'],
    ['command-attachment', 'cancel'], ['command-attachment', 'disable'],
    ['command-provider', 'cancel'], ['command-provider', 'disable'],
  ] as const)('does not queue %s after %s during its asynchronous preflight', async (path, change) => {
    const test = fixture()
    const gate = deferred()
    const entered = deferred()
    const controller = new AbortController()
    if (path.endsWith('attachment')) {
      test.attachments.readImage.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return { data: new Uint8Array([1, 2, 3]), ref: REFERENCE } })
    } else {
      test.config.resolveCqaiRequest = vi.fn(async request => { entered.resolve(); await gate.promise; return { ...request, model: 'fresh-image', channelId: 'cqai' } })
    }
    const pending = path.startsWith('command')
      ? submitAgentImageEdit(test.attachments as never, test.runtime, () => test.config, { prompt: 'edit', sourceImage: REFERENCE as never, signal: controller.signal })
      : test.call(path === 'generate' ? 'generate_image' : 'edit_image', {
          prompt: 'draw', wait_for_completion: false, ...(path === 'generate' ? {} : { source_image: SOURCE }),
        }, controller.signal)
    await entered.promise
    if (change === 'cancel') controller.abort(new Error('request canceled'))
    else if (change === 'disable') test.config.enabled = false
    else test.config.allowAgentImageGeneration = false
    gate.resolve()
    await expect(pending).rejects.toThrow(change === 'cancel' ? 'request canceled' : 'disabled')
    expect(test.submit).not.toHaveBeenCalled()
    if (path.endsWith('attachment')) expect(test.config.resolveCqaiRequest).not.toHaveBeenCalled()
  })

  it('refuses an already canceled request before reading a reference or resolving models', async () => {
    const test = fixture()
    const controller = new AbortController()
    controller.abort(new Error('already canceled'))
    await expect(test.call('list_image_generation_models', {}, controller.signal)).rejects.toThrow('already canceled')
    await expect(test.call('generate_image', { prompt: 'draw' }, controller.signal)).rejects.toThrow('already canceled')
    await expect(test.call('edit_image', { prompt: 'edit', source_image: SOURCE }, controller.signal)).rejects.toThrow('already canceled')
    expect(test.attachments.readImage).not.toHaveBeenCalled()
    expect(test.config.resolveCqaiRequest).not.toHaveBeenCalled()
    expect(test.config.describeCqai).not.toHaveBeenCalled()
    expect(test.submit).not.toHaveBeenCalled()
  })
})
