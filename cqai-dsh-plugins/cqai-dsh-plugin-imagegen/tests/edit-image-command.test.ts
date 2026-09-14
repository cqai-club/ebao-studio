import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentImageToolConfig } from '../src/agent-image-tools.ts'
import { parseEditImageCommandResult } from '../src/edit-image-command-result.ts'
import { registerEditImageCommand } from '../src/edit-image-command.ts'
import type { ImageGenerationRuntime } from '../src/generation-runtime.ts'
import type { GenerationTask } from '../src/protocol.ts'

const submitAgentImageEdit = vi.hoisted(() => vi.fn())

vi.mock('../src/agent-image-tools.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/agent-image-tools.ts')>('../src/agent-image-tools.ts')
  return { ...actual, submitAgentImageEdit }
})

const SOURCE = {
  attachmentId: 'source-image' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png' as const,
  bytes: 12,
  width: 4,
  height: 3,
  name: 'source.png',
}

const OUTPUT = {
  attachmentId: 'edited-image' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 1,
  height: 1,
  name: 'edited.png',
}

const completedTask: GenerationTask = {
  id: 'task-edit-1',
  request: {
    mode: 'edit',
    model: 'image-model',
    prompt: '改成夜景',
    size: 'auto',
    quality: 'auto',
    n: 1,
    detail: '',
    image: 'data:image/png;base64,AA==',
  },
  status: 'completed',
  createdAt: 1,
  finishedAt: 2,
  result: {
    images: [{
      b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      mime: 'image/png',
    }],
  },
}

describe('/edit_image command result', () => {
  beforeEach(() => { submitAgentImageEdit.mockReset() })

  it('persists completed images and returns a durable rich-command payload', async () => {
    let definition: CommandDefinition | undefined
    const saveImages = vi.fn(async (inputs: readonly SaveImageAttachment[]) => {
      expect(inputs).toHaveLength(1)
      expect(inputs[0]).toMatchObject({ mediaType: 'image/png', name: 'imagegen-task-edit-1-1.png' })
      expect(inputs[0]?.data).toBeInstanceOf(Uint8Array)
      return [OUTPUT]
    })
    const ctx = {
      attachments: { readImage: vi.fn(), saveImages },
      commands: {
        register: vi.fn((candidate: CommandDefinition) => {
          definition = candidate
          return () => {}
        }),
      },
    } as unknown as Context
    const runtime = {} as ImageGenerationRuntime
    const config = {} as AgentImageToolConfig
    submitAgentImageEdit.mockResolvedValue(completedTask)

    registerEditImageCommand(ctx, runtime, () => config)
    expect(definition?.name).toBe('edit_image')

    const signal = new AbortController().signal
    const result = await definition!.handler({
      commandId: 'command-edit-1',
      agent: { session: { deriveMessages: () => [] } },
      rawInput: '  改成夜景  ',
      attachments: [{ type: 'image', attachment: SOURCE }],
      signal,
    } as unknown as CommandInvocation)

    expect(submitAgentImageEdit).toHaveBeenCalledWith(
      ctx.attachments,
      runtime,
      expect.any(Function),
      { prompt: '改成夜景', sourceImage: SOURCE, signal },
    )
    expect(saveImages).toHaveBeenCalledOnce()
    expect(result.kind).toBe('success')
    const payload = parseEditImageCommandResult(result.text)
    expect(payload).toEqual({
      version: 1,
      taskId: completedTask.id,
      summary: '图片编辑已完成。',
      images: [OUTPUT],
    })
  })
})
