import type { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CanvasDocument } from '../src/protocol.ts'
import {
  DSH_IMAGEGEN_API_KEY,
  DSH_IMAGEGEN_BASE_URL,
  DSH_IMAGEGEN_MODEL,
  SkillRunner,
  type SkillRunnerBackend,
} from '../src/skill-runner.ts'
import { createCanvasSkillAgent, type CanvasSkillAgentOptions } from '../src/index.ts'
import { BUILTIN_PPT, EDITABLE_PPT_SKILL } from '../src/skills-catalog.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function documentOf(): CanvasDocument {
  return {
    version: 2,
    id: 'canvas-1',
    title: 'Canvas',
    revision: 1,
    viewport: { x: 0, y: 0, k: 1 },
    background: 'dots',
    nodes: [{
      id: 'image-1',
      type: 'image',
      title: 'Input',
      x: 0,
      y: 0,
      width: 320,
      height: 320,
      metadata: {
        model: 'node-model',
        asset: {
          assetId: 'asset-1',
          url: '/asset/asset-1.png',
          mime: 'image/png',
          bytes: 3,
          width: 1,
          height: 1,
          origin: 'upload',
          name: 'input.png',
        },
      },
    }],
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

async function settled(runner: SkillRunner, taskId: string): Promise<NonNullable<ReturnType<SkillRunner['task']>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = runner.task(taskId)
    if (task !== undefined && ['completed', 'failed', 'cancelled'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('skill task did not settle')
}

async function runnerWith(overrides: Partial<SkillRunnerBackend>): Promise<SkillRunner> {
  const root = await mkdtemp(path.join(tmpdir(), 'cqai-skill-runner-'))
  roots.push(root)
  const document = documentOf()
  const backend: SkillRunnerBackend = {
    canvas: {
      read: async id => id === document.id ? document : undefined,
      readAsset: async () => undefined,
      readAssets: async () => new Map(),
      materialize: async (_ref, target) => { await writeFile(target, new Uint8Array([1, 2, 3])) },
      putFile: async () => { throw new Error('not expected') },
    },
    registry: {
      list: async () => [],
      get: async name => name === EDITABLE_PPT_SKILL
        ? { name, content: '# Editable PPT\nUse the image backend when necessary.' }
        : undefined,
    },
    ...overrides,
  }
  return new SkillRunner({
    backend,
    enabled: () => true,
    heavyEnabled: () => true,
    allowlist: () => [],
    runRoot: () => root,
    heavyTimeoutMs: () => 30_000,
    dataRoot: () => root,
  })
}

describe('SkillRunner run-scoped image provider', () => {
  it('issues only for a compatible skill, keeps the credential out of prompts/tasks, and revokes in finally', async () => {
    const apiKey = 'run-only-secret-token'
    let issuedModel: string | undefined
    let revoked = false
    let created: Parameters<NonNullable<SkillRunnerBackend['agents']>['create']>[0] | undefined
    const runner = await runnerWith({
      skillConfig: {
        missing: async () => new Map(),
        note: async () => undefined,
        imageProvider: async name => name === EDITABLE_PPT_SKILL
          ? { protocol: 'openai-images-v1', model: 'manifest-model' }
          : undefined,
      },
      imageProvider: {
        issue: async ({ model }) => {
          issuedModel = model
          return {
            baseUrl: 'http://127.0.0.1:4567/api/dsh-imagegen/skill-openai/v1',
            apiKey,
            model: model ?? 'resolved-model',
            revoke: () => { revoked = true },
          }
        },
      },
      agents: {
        available: () => true,
        create: async options => {
          created = options
          return {
            session: { deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] },
            followup: () => {},
            whenIdle: async () => {},
            cancel: () => {},
            dispose: async () => {},
          }
        },
      },
    })

    const queued = await runner.run({
      canvasId: 'canvas-1',
      skillId: BUILTIN_PPT,
      nodeIds: ['image-1'],
      params: { imageProvider: 'cqai', imageModel: 'temporary-model' },
    })
    const task = await settled(runner, queued.id)

    expect(task.status).toBe('completed')
    expect(issuedModel).toBe('temporary-model')
    expect(created?.imageProvider).toEqual({
      baseUrl: 'http://127.0.0.1:4567/api/dsh-imagegen/skill-openai/v1',
      apiKey,
      model: 'temporary-model',
    })
    expect(created?.systemPrompt).toContain(DSH_IMAGEGEN_API_KEY)
    expect(created?.systemPrompt).not.toContain(apiKey)
    expect(created?.systemPrompt).not.toContain('http://127.0.0.1:4567')
    expect(JSON.stringify(task)).not.toContain(apiKey)
    expect(revoked).toBe(true)
  })

  it('fails clearly without issuing when the skill is incompatible or a third-party provider is requested', async () => {
    let issues = 0
    let agentCreates = 0
    const makeRunner = async (compatible: boolean): Promise<SkillRunner> => await runnerWith({
      skillConfig: {
        missing: async () => new Map(),
        note: async () => undefined,
        imageProvider: async () => compatible ? { protocol: 'openai-images-v1' } : undefined,
      },
      imageProvider: {
        issue: async () => {
          issues += 1
          throw new Error('must not issue')
        },
      },
      agents: {
        available: () => true,
        create: async () => {
          agentCreates += 1
          throw new Error('must not create')
        },
      },
    })

    const incompatible = await makeRunner(false)
    const incompatibleTask = await incompatible.run({
      canvasId: 'canvas-1',
      skillId: BUILTIN_PPT,
      nodeIds: ['image-1'],
      params: { imageProvider: 'cqai' },
    })
    expect((await settled(incompatible, incompatibleTask.id)).error).toContain('未声明兼容 OpenAI Images v1')

    const compatible = await makeRunner(true)
    const thirdPartyTask = await compatible.run({
      canvasId: 'canvas-1',
      skillId: BUILTIN_PPT,
      nodeIds: ['image-1'],
      params: { imageProvider: 'custom:other' },
    })
    expect((await settled(compatible, thirdPartyTask.id)).error).toContain('只支持 cqai')
    expect(issues).toBe(0)
    expect(agentCreates).toBe(0)
  })

  it('revokes the lease when agent composition fails', async () => {
    let revoked = false
    const runner = await runnerWith({
      skillConfig: {
        missing: async () => new Map(),
        note: async () => undefined,
        imageProvider: async () => ({ protocol: 'openai-images-v1' }),
      },
      imageProvider: {
        issue: async () => ({
          baseUrl: 'http://127.0.0.1:4567/api/dsh-imagegen/skill-openai/v1',
          apiKey: 'short-lived',
          model: 'resolved-model',
          revoke: () => { revoked = true },
        }),
      },
      agents: {
        available: () => true,
        create: async () => { throw new Error('agent composition failed') },
      },
    })
    const queued = await runner.run({
      canvasId: 'canvas-1',
      skillId: BUILTIN_PPT,
      nodeIds: ['image-1'],
    })
    const task = await settled(runner, queued.id)
    expect(task.status).toBe('failed')
    expect(task.error).toContain('agent composition failed')
    expect(revoked).toBe(true)
  })
})

describe('createCanvasSkillAgent image environment', () => {
  it('keeps run values inside the agent-scoped shell resolver', async () => {
    const secret = 'ephemeral-bridge-secret'
    let contributor: {
      name: string
      variables: Record<string, { description: string }>
      resolve: () => Record<string, string>
    } | undefined
    let sectionText = ''
    let factoryOptions: Parameters<CanvasSkillAgentOptions['agents']['create']>[0] | undefined
    const fakeContext = {
      get: (name: string) => name === 'shellEnv'
        ? {
            register: (next: typeof contributor) => {
              contributor = next
              return () => {}
            },
          }
        : undefined,
      systemPrompt: { section: ({ text }: { text: string }) => { sectionText = text } },
    } as unknown as Context
    const agents: CanvasSkillAgentOptions['agents'] = {
      create: async options => {
        factoryOptions = options
        await options.setup?.(fakeContext)
        return {
          agent: {
            session: { deriveMessages: () => [] },
            followup: () => {},
            whenIdle: async () => {},
            cancel: () => {},
          },
          dispose: async () => {},
        }
      },
    }

    await createCanvasSkillAgent({
      agents,
      defaultModel: { currentSelection: () => ({ provider: 'chat-provider', model: 'chat-model' }) },
      agentPreset: '',
      sessionId: 'skill-agent',
      cwd: '/tmp/skill-agent',
      systemPrompt: `Use ${DSH_IMAGEGEN_API_KEY}; never include its value.`,
      imageProvider: {
        baseUrl: 'http://127.0.0.1:9876/api/dsh-imagegen/skill-openai/v1',
        apiKey: secret,
        model: 'cqai-image-model',
      },
    })

    expect(JSON.stringify(factoryOptions)).not.toContain(secret)
    expect(sectionText).not.toContain(secret)
    expect(contributor?.name).toBe('cqai-imagegen-run')
    expect(Object.keys(contributor?.variables ?? {})).toEqual([
      DSH_IMAGEGEN_BASE_URL,
      DSH_IMAGEGEN_API_KEY,
      DSH_IMAGEGEN_MODEL,
    ])
    expect(JSON.stringify(contributor?.variables)).not.toContain(secret)
    expect(contributor?.resolve()).toEqual({
      [DSH_IMAGEGEN_BASE_URL]: 'http://127.0.0.1:9876/api/dsh-imagegen/skill-openai/v1',
      [DSH_IMAGEGEN_API_KEY]: secret,
      [DSH_IMAGEGEN_MODEL]: 'cqai-image-model',
    })
  })

  it('fails without exposing the credential when shellEnv is unavailable', async () => {
    const secret = 'must-not-appear-in-error'
    const agents: CanvasSkillAgentOptions['agents'] = {
      create: async options => {
        await options.setup?.({
          get: () => undefined,
          systemPrompt: { section: () => {} },
        } as unknown as Context)
        throw new Error('unreachable')
      },
    }
    await expect(createCanvasSkillAgent({
      agents,
      defaultModel: { currentSelection: () => ({ provider: 'chat-provider', model: 'chat-model' }) },
      agentPreset: '',
      sessionId: 'skill-agent',
      cwd: '/tmp/skill-agent',
      systemPrompt: 'safe prompt',
      imageProvider: {
        baseUrl: 'http://127.0.0.1:9876/api/dsh-imagegen/skill-openai/v1',
        apiKey: secret,
        model: 'cqai-image-model',
      },
    })).rejects.not.toThrow(secret)
  })
})
