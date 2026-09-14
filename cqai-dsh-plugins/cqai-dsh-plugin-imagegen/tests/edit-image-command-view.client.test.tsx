// @vitest-environment jsdom
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageEditCommandView } from '../src/client/image-toolview.tsx'
import { serializeEditImageCommandResult } from '../src/edit-image-command-result.ts'

const IMAGE = {
  attachmentId: 'edited-image' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 1,
  height: 1,
  name: 'edited.png',
}

const SESSION_ID = 'session-edit-image' as SessionId

function commandNode(text: string): CommandNode {
  return {
    kind: 'command',
    seq: 1,
    time: 1,
    commandId: 'command-edit-image' as CommandNode['commandId'],
    name: 'edit_image',
    args: ' 改成夜景',
    outcome: { kind: 'success', text },
  }
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/edit_image command view', () => {
  it('renders the persisted attachment inline and hides its wire envelope', async () => {
    const text = serializeEditImageCommandResult('task-edit-1', [IMAGE])
    const loadImage = vi.fn(async () => 'blob:edited-image')

    render(<ImageEditCommandView
      node={commandNode(text)}
      sessionId={SESSION_ID}
      loadImage={loadImage}
    />)

    const image = await screen.findByRole('img', { name: 'edited.png' })
    expect(image.getAttribute('src')).toBe('blob:edited-image')
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(SESSION_ID, IMAGE)
    expect(screen.getByText('图片编辑已完成。')).not.toBeNull()
    expect(screen.queryByText(/cqai-dsh-imagegen\/edit-command-result/)).toBeNull()
  })
})
