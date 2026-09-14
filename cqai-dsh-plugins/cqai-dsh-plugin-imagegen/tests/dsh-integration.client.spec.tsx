// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerAttachment, InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { cleanup, render } from '@testing-library/react'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IMAGEGEN_PANEL_ID,
  IMAGEGEN_SESSION_SLOT,
  ImageGenConversationError,
  attachImageFile,
  registerImageGenStudio,
  type ConversationDraftService,
  type ImageGenConversationBridge,
} from '../src/client/dsh-integration.tsx'

afterEach(cleanup)

const SID = 'session-imagegen' as SessionId

function inputActions(overrides: Partial<InputActions> = {}): InputActions {
  return {
    setDraft: vi.fn(),
    addAttachments: vi.fn(() => true),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  }
}

function attachment(id = 'draft-image') {
  const file = new File([Uint8Array.of(1, 2, 3)], 'generated.png', { type: 'image/png' })
  return {
    kind: 'image' as const,
    id,
    file,
    previewUrl: `blob:${id}`,
  } as ComposerAttachment
}

function draftService(drafts: readonly ComposerAttachment[] = [attachment()]) {
  return {
    createDrafts: vi.fn(() => drafts),
    releaseDraftAttachments: vi.fn(),
  } satisfies ConversationDraftService
}

describe('native conversation attachment bridge', () => {
  it('rejects a missing Session without allocating a draft', () => {
    const conversation = draftService()
    try {
      attachImageFile(
        conversation,
        undefined,
        undefined,
        new File([], 'generated.png', { type: 'image/png' }),
      )
      throw new Error('expected attachImageFile to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ImageGenConversationError)
      expect((error as ImageGenConversationError).code).toBe('no-session')
    }
    expect(conversation.createDrafts).not.toHaveBeenCalled()
  })

  it('admits drafts through InputActions and supports an idempotent rollback', () => {
    const draft = attachment()
    const conversation = draftService([draft])
    const actions = inputActions()
    const file = new File([Uint8Array.of(7)], 'generated.png', { type: 'image/png' })

    const receipt = attachImageFile(conversation, SID, actions, file)

    expect(conversation.createDrafts).toHaveBeenCalledExactlyOnceWith(SID, [file])
    expect(actions.addAttachments).toHaveBeenCalledExactlyOnceWith([draft.id])
    expect(conversation.releaseDraftAttachments).not.toHaveBeenCalled()
    expect(receipt.attachmentIds).toEqual([draft.id])

    receipt.rollback()
    receipt.rollback()
    expect(actions.removeAttachment).toHaveBeenCalledExactlyOnceWith(draft.id)
    expect(conversation.releaseDraftAttachments).toHaveBeenCalledExactlyOnceWith([draft])
  })

  it('releases all drafts when the composer refuses admission', () => {
    const drafts = [attachment('draft-one'), attachment('draft-two')]
    const conversation = draftService(drafts)
    const actions = inputActions({ addAttachments: vi.fn(() => false) })

    try {
      attachImageFile(
        conversation,
        SID,
        actions,
        new File([], 'generated.png', { type: 'image/png' }),
      )
      throw new Error('expected attachImageFile to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ImageGenConversationError)
      expect((error as ImageGenConversationError).code).toBe('composer-busy')
    }
    expect(conversation.releaseDraftAttachments).toHaveBeenCalledExactlyOnceWith(drafts)
  })

  it('releases all drafts when InputActions throws', () => {
    const drafts = [attachment()]
    const conversation = draftService(drafts)
    const failure = new Error('input failed')
    const actions = inputActions({ addAttachments: vi.fn(() => { throw failure }) })

    expect(() => attachImageFile(
      conversation,
      SID,
      actions,
      new File([], 'generated.png', { type: 'image/png' }),
    )).toThrow(failure)
    expect(conversation.releaseDraftAttachments).toHaveBeenCalledExactlyOnceWith(drafts)
  })
})

describe('official main-panel integration', () => {
  interface CapturedEntry {
    options: Record<string, unknown>
    component: ComponentType<Record<string, unknown>>
  }

  function bench() {
    const conversation = draftService()
    const actions = inputActions()
    const entries: CapturedEntry[] = []
    const slots = {
      inject: (_name: string, factory: () => unknown) => {
        const result = factory()
        if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
          for (const _disposer of result as Iterable<unknown>) { /* exhaust registration generator */ }
        }
      },
      register: (options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
        entries.push({ options, component })
        return () => {}
      },
    }
    let latestBridge: ImageGenConversationBridge | undefined
    const ctx = {
      slots,
      get: (name: string) => name === 'conversation' ? conversation : undefined,
    } as unknown as Context
    registerImageGenStudio(ctx, {
      label: 'Image Studio',
      order: 42,
      renderStudio: ({ conversation: bridge }) => {
        latestBridge = bridge
        return <p>{bridge.available ? `session:${bridge.sessionId}` : 'no-session'}</p>
      },
    })
    const entry = (name: string) => entries.find(candidate => candidate.options.name === name)!
    return { actions, conversation, entries, entry, latestBridge: () => latestBridge }
  }

  it('registers a keyed main panel, matching sidebar row, and session-maybe child', () => {
    const { entries, entry } = bench()
    const main = entry('main')
    const sidebar = entry('sidebar.panellist')

    expect(entries).toHaveLength(3)
    expect(main.options).toMatchObject({
      key: IMAGEGEN_PANEL_ID,
      children: { [IMAGEGEN_SESSION_SLOT]: { kind: 'single', scope: 'session-maybe' } },
    })
    expect(sidebar.options).toMatchObject({ id: IMAGEGEN_PANEL_ID, label: 'Image Studio', order: 42 })

    const renderSlot = vi.fn((): ReactNode => <p>studio seat</p>)
    const mainView = render(createElement(main.component, { renderSlot }))
    expect(mainView.container.querySelector('[data-cqai-imagegen-main]')).not.toBeNull()
    expect(mainView.getByText('studio seat')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledExactlyOnceWith(IMAGEGEN_SESSION_SLOT, {})

    const iconView = render(createElement(sidebar.component, { size: 18, active: true }))
    expect(iconView.container.querySelector('[data-cqai-imagegen-panel-icon]')?.getAttribute('width')).toBe('18')
  })

  it('keeps the studio available without a Session but disables composer attachment', () => {
    const { entry, latestBridge } = bench()
    const seat = entry(IMAGEGEN_SESSION_SLOT)
    const view = render(createElement(seat.component, {
      sessionId: undefined,
      inputActions: undefined,
      useInput: () => undefined,
    }))

    expect(view.getByText('no-session')).toBeTruthy()
    expect(latestBridge()).toMatchObject({ available: false, sessionId: undefined })
  })

  it('receives sessionId and InputActions through the session-maybe child slot', () => {
    const { conversation, actions, entry, latestBridge } = bench()
    const seat = entry(IMAGEGEN_SESSION_SLOT)
    const view = render(createElement(seat.component, {
      sessionId: SID,
      inputActions: actions,
      useInput: (selector: (state: { draft: string }) => unknown) => selector({ draft: '' }),
    }))

    expect(view.getByText(`session:${SID}`)).toBeTruthy()
    const bridge = latestBridge()
    expect(bridge).toMatchObject({ available: true, sessionId: SID })

    const file = new File([Uint8Array.of(9)], 'result.png', { type: 'image/png' })
    bridge?.addFile(file)
    expect(conversation.createDrafts).toHaveBeenCalledExactlyOnceWith(SID, [file])
    expect(actions.addAttachments).toHaveBeenCalledExactlyOnceWith(['draft-image'])

    bridge?.setDraftIfEmpty(' describe this image ')
    expect(actions.setDraft).toHaveBeenCalledExactlyOnceWith('describe this image')
  })
})
