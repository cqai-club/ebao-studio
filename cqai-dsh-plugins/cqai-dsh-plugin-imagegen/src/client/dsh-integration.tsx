/**
 * DSH 0.1.5 UI integration for the CQAI image studio.
 *
 * The studio is a first-class global main panel.  Its root-scoped panel owns
 * one session-maybe child slot so the renderer, rather than DOM inspection,
 * supplies the current Session identity and composer actions.  The image
 * studio remains usable without a Session; only "add to conversation" is
 * unavailable in that state.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ComposerAttachment,
  ConversationController,
  InputActions,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  PropsRenderSlots,
  PropsRuntime,
  SlotLabel,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

// Pull the declaration merges that own the official slots and standard
// Session props.  These imports are intentionally type-only: the profile owns
// the concrete UI plugins and their load order.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Stable global-panel identity.  sidebar.panellist ids address main keys. */
export const IMAGEGEN_PANEL_ID = 'cqai-imagegen' as MainPanelId

/** Session-aware seat declared by the root-scoped image-generation panel. */
export const IMAGEGEN_SESSION_SLOT = 'cqai-imagegen.session' as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  // ui-session owns this runtime value.  Restating the standard prop here
  // keeps the independently installable plugin's type surface limited to the
  // slot contract instead of taking a direct package dependency on the scope
  // adapter implementation.
  interface SessionMaybeStandardProps {
    readonly sessionId: SessionId | undefined
  }

  interface SlotMap {
    /** Current-session bridge rendered inside the root-scoped image studio. */
    'cqai-imagegen.session': { kind: 'single'; scope: 'session-maybe' }
  }
}

/** The concrete draft methods intentionally omitted from IConversation. */
export type ConversationDraftService = Pick<
  ConversationController,
  'createDrafts' | 'releaseDraftAttachments'
>

export type ImageGenConversationErrorCode = 'no-session' | 'composer-busy'

/** Stable failures that the studio can translate into its existing notices. */
export class ImageGenConversationError extends Error {
  override readonly name = 'ImageGenConversationError'

  constructor(readonly code: ImageGenConversationErrorCode) {
    super(code === 'no-session'
      ? 'Select or create a conversation before adding an image.'
      : 'The conversation composer is busy. Try again after the current submission settles.')
  }
}

/**
 * A successful composer attachment. rollback lets the caller undo admission
 * if a later step in the same UI action fails.
 */
export interface ImageGenConversationAttachment {
  readonly attachmentIds: readonly ComposerAttachment['id'][]
  rollback(): void
}

/** Session-bound face handed to the image studio. */
export interface ImageGenConversationBridge {
  readonly sessionId: SessionId | undefined
  readonly available: boolean
  addFile(file: File): ImageGenConversationAttachment
  setDraftIfEmpty(text: string): void
}

/** Props supplied to the caller-owned studio renderer. */
export interface ImageGenStudioRenderProps {
  readonly conversation: ImageGenConversationBridge
}

export type ImageGenStudioRenderer = (props: ImageGenStudioRenderProps) => ReactNode

/** Registration options kept independent from the migrated studio itself. */
export interface ImageGenStudioRegistration {
  readonly renderStudio: ImageGenStudioRenderer
  readonly label?: SlotLabel
  readonly order?: number
}

/**
 * Register one browser File with the native DSH composer.
 *
 * Drafts remain ConversationController-owned after successful admission.  On
 * refusal or an exception, every newly created draft is released before the
 * error leaves this function.
 */
export function attachImageFile(
  conversation: ConversationDraftService,
  sessionId: SessionId | undefined,
  inputActions: InputActions | undefined,
  file: File,
): ImageGenConversationAttachment {
  if (sessionId === undefined || inputActions === undefined) {
    throw new ImageGenConversationError('no-session')
  }

  const attachments = conversation.createDrafts(sessionId, [file])
  try {
    if (!inputActions.addAttachments(attachments.map(attachment => attachment.id))) {
      throw new ImageGenConversationError('composer-busy')
    }
  } catch (error) {
    conversation.releaseDraftAttachments(attachments)
    throw error
  }

  let live = true
  return {
    attachmentIds: attachments.map(attachment => attachment.id),
    rollback: () => {
      if (!live) return
      live = false
      for (const attachment of attachments) inputActions.removeAttachment(attachment.id)
      conversation.releaseDraftAttachments(attachments)
    },
  }
}

/** Construct the render-facing facade for one session-maybe occurrence. */
export function createImageGenConversationBridge(
  conversation: ConversationDraftService,
  sessionId: SessionId | undefined,
  inputActions: InputActions | undefined,
  draft: string | undefined = undefined,
): ImageGenConversationBridge {
  return {
    sessionId,
    available: sessionId !== undefined && inputActions !== undefined,
    addFile: file => attachImageFile(conversation, sessionId, inputActions, file),
    setDraftIfEmpty: (text) => {
      if (inputActions !== undefined && draft?.trim() === '' && text.trim() !== '') {
        inputActions.setDraft(text.trim())
      }
    },
  }
}

function ImageGenPanelRoot({ renderSlot }: PropsRuntime<'main'> & PropsRenderSlots<typeof IMAGEGEN_SESSION_SLOT>) {
  return (
    <section
      data-cqai-imagegen-main=""
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
    >
      {renderSlot(IMAGEGEN_SESSION_SLOT, {})}
    </section>
  )
}

function ImageGenPanelIcon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg
      data-cqai-imagegen-panel-icon=""
      data-active={active ? '' : undefined}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="14" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6.1" cy="6.4" r="1.25" fill="currentColor" />
      <path d="m3.8 13 3.5-3.45 2.45 2.35 1.55-1.55 2.9 2.65" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.4 1v3.2M11.8 2.6H15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Add the official global-panel and sidebar contributions.
 *
 * The caller retains ownership of ImageGenPanel construction through
 * renderStudio, keeping this adapter testable and free of upstream UI state.
 */
export function registerImageGenStudio(
  ctx: ClientContext,
  options: ImageGenStudioRegistration,
): void {
  const conversation = ctx.get('conversation') as ConversationDraftService | undefined
  if (conversation === undefined) {
    throw new Error('cqai-imagegen: conversation service is required')
  }

  const StudioSeat = ({ sessionId, inputActions, useInput }: PropsRuntime<typeof IMAGEGEN_SESSION_SLOT>) => {
    const draft = useInput(state => state.draft)
    const bridge = useMemo(
      () => createImageGenConversationBridge(conversation, sessionId, inputActions, draft),
      [sessionId, inputActions, draft],
    )
    return options.renderStudio({ conversation: bridge })
  }

  // Register the declaring main entry first, then its session-maybe occupant
  // in the same injection generator (the official Conversation uses this
  // exact child-slot ownership pattern).
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: IMAGEGEN_PANEL_ID,
      children: {
        [IMAGEGEN_SESSION_SLOT]: { kind: 'single', scope: 'session-maybe' },
      },
    }, ImageGenPanelRoot)
    yield ctx.slots.register({ name: IMAGEGEN_SESSION_SLOT }, StudioSeat)
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: IMAGEGEN_PANEL_ID,
    order: options.order ?? 40,
    label: options.label ?? 'e图宝',
  }, ImageGenPanelIcon))
}
