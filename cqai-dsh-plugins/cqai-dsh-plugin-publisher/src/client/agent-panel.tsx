import type { Context } from '@deepseek-ai/cordis'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-agent/types'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationViewsProps, ConversationWidthControlsProps, InputState,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState } from 'react'
import type { PublisherContentType } from '../protocol.ts'

export const PUBLISHER_AGENT_SLOT = 'publisher.agent' as const
export const PUBLISHER_AGENT_REFERENCE_SOURCE = 'publisherView' as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Publisher's local conversation, addressed by an explicit owned reference. */
    'publisher.agent': { kind: 'single'; scope: 'session'; owner: { contentType: PublisherContentType } }
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { publisherView: unknown }
}

/** The main Publisher registration declares publisher.agent to receive these capabilities. */
export type PublisherAgentRenderProps = PropsRenderSlots<typeof PUBLISHER_AGENT_SLOT>
export type PublisherAgentPanelProps = PropsRuntime<typeof PUBLISHER_AGENT_SLOT> & PropsRenderFactories

type Shortcut = { label: string; detail: string; icon: 'write' | 'image' | 'video'; prompt: string }
const SHORTCUTS: Record<PublisherContentType, readonly Shortcut[]> = {
  article: [
    { label: '帮我写一篇文章', detail: '从选题、素材到完整草稿', icon: 'write', prompt: '/publisher-write-article 帮我写一篇文章。先读取当前草稿和写作偏好，结合已有内容；缺少选题、素材或受众时，先问我必要的信息，再创作并保存到当前稿件。' },
    { label: '整理素材成文', detail: '把笔记和资料整理成文章', icon: 'write', prompt: '/publisher-write-article 帮我把素材整理成文章。先读取当前草稿和已有素材；如果还没有素材，请让我提供笔记、资料或附件，再基于真实材料写作并保存到当前稿件。' },
    { label: '为文章配图', detail: '结合正文准备合适的图片', icon: 'image', prompt: '/publisher-illustrate-article 帮我为当前文章生成并插入合适的配图。先读取正文；如果还没有正文，先让我提供或完成文章，再根据内容配图。' },
  ],
  'image-note': [
    { label: '写小红书图文', detail: '整理标题、文案和分享重点', icon: 'write', prompt: '/publisher-write-article 帮我写一篇适合小红书分享的图文。先读取当前图文草稿和写作偏好，结合已有图片与素材；缺少主题或真实素材时先问我，再把标题和文案保存到当前编辑目标，不切换稿件或编辑目标。' },
    { label: '写抖音图文', detail: '突出开头和图文表达节奏', icon: 'write', prompt: '/publisher-write-article 帮我写一篇适合抖音发布的图文。先读取当前图文草稿和写作偏好，结合已有图片与素材；缺少主题或真实素材时先问我，再把标题和文案保存到当前编辑目标，不切换稿件或编辑目标。' },
    { label: '整理图文素材', detail: '梳理图片顺序和配套文字', icon: 'image', prompt: '/publisher-edit-draft 帮我整理当前图文稿件的图片顺序和配套文字。先读取当前草稿和已有素材；缺少图片或分享主题时先问我，确认内容后保存到当前编辑目标。' },
  ],
  video: [
    { label: '准备视频文案', detail: '起标题、写简介和话题', icon: 'write', prompt: '/publisher-edit-draft 帮我准备当前视频的标题、简介、短标题和话题。先读取当前视频草稿和已有成片信息；缺少视频内容或发布需求时先问我，再保存到当前编辑目标。' },
    { label: '选择已有成片', detail: '从已有视频作品中选择', icon: 'video', prompt: '/publisher-edit-draft 帮我为当前视频稿件选择已有成片。先读取当前草稿并列出可用的视频作品，让我选择后再关联到当前稿件；不要自动替换已关联的成片。' },
    { label: '整理发布信息', detail: '检查标题、封面和内容说明', icon: 'video', prompt: '/publisher-edit-draft 帮我检查和整理当前视频稿件的发布信息，包括标题、封面、简介、话题和内容声明。先读取当前草稿，说明还缺什么，结合我的补充更新当前编辑目标，只准备草稿，不提交发布。' },
  ],
}

function ShortcutIcon({ kind }: { kind: Shortcut['icon'] }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'write' ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M14 3v6h6M14 3l6 6M8 13h8M8 17h5"/></> : kind === 'image' ? <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/></> : <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/></>}
  </svg>
}

/** Shortcuts share the addressed Session's normal input and Skill admission. */
export type PublisherChatHistoryProps = SessionStandardProps & PropsRenderSlots<'conversation.session'> & { contentType: PublisherContentType }
export function PublisherChatHistory({ contentType, renderSlot, useSession, useChat, useInput, useProjection, inputActions }: PublisherChatHistoryProps) {
  const session = useSession((value: SessionSnapshot) => value)
  const chatEmpty = useChat((chat: ChatSnapshot) => chat.order.length === 0 && chat.nodes.values().length === 0 && chat.timeline.turnOrder.length === 0)
  const input = useInput((value: InputState) => value)
  const inboxEmpty = useProjection('inbox', inbox => Boolean(inbox && inbox['next-turn'].length === 0 && inbox['next-step'].length === 0))
  const empty = session.openState === 'open' && session.blank && !session.hasMore && !session.removed && !session.running && !session.awaitingFirstTurn && session.pendingSubmissions.length === 0 && chatEmpty && inboxEmpty
  const available = empty && input.phase === 'plain' && input.queue.length === 0 && !input.draft.trim() && input.attachmentIds.length === 0
  const starting = useRef(false)
  const [error, setError] = useState('')
  useEffect(() => { if (available) starting.current = false }, [available])
  const start = (shortcut: Shortcut) => {
    if (!available || starting.current) return
    starting.current = true
    setError('')
    try {
      inputActions.setDraft(shortcut.prompt)
      inputActions.submit()
    } catch {
      starting.current = false
      setError('暂时无法开始，请重试或在下方输入需求。')
    }
  }
  return <div className="pub-agent-history">
    {available && <nav className="pub-agent-shortcuts" aria-label="创作快捷方式" data-content-type={contentType}>
      <p className="pub-agent-shortcuts-hint">从这里开始，也可以直接告诉我你的需求</p>
      {SHORTCUTS[contentType].map(shortcut => <button type="button" className="pub-agent-shortcut" key={shortcut.label} onClick={() => start(shortcut)}>
        <span className="pub-agent-shortcut-icon"><ShortcutIcon kind={shortcut.icon}/></span>
        <span className="pub-agent-shortcut-copy"><span>{shortcut.label}</span><small>{shortcut.detail}</small></span>
        <span className="pub-agent-shortcut-arrow" aria-hidden="true">↗</span>
      </button>)}
    </nav>}
    {empty && error && <p className="pub-agent-shortcuts-error" role="alert">{error}</p>}
    {renderSlot('conversation.session', { view: 'chat' })}
  </div>
}

// Stable Factory overrides preserve the input and transcript across parent renders.
function ArticleChatHistory(props: ConversationViewsProps) { return <PublisherChatHistory key={props.sessionId} {...props} contentType="article"/> }
function ImageNoteChatHistory(props: ConversationViewsProps) { return <PublisherChatHistory key={props.sessionId} {...props} contentType="image-note"/> }
function VideoChatHistory(props: ConversationViewsProps) { return <PublisherChatHistory key={props.sessionId} {...props} contentType="video"/> }
const HISTORY_VIEWS = { article: ArticleChatHistory, 'image-note': ImageNoteChatHistory, video: VideoChatHistory }

function NoPublisherWidthControls(_props: ConversationWidthControlsProps) { return null }

/** Delegate input, transcript and pending interactions to DSH's public embedded Factory. */
export function PublisherAgentPanel({ contentType, renderFactorySlot }: PublisherAgentPanelProps) {
  return <section className="pub-agent-conversation" aria-label="稿件 Agent 对话" data-content-type={contentType}>
    {renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, {
      slots: { views: HISTORY_VIEWS[contentType], widthControls: NoPublisherWidthControls },
      fallback: <p role="status">Agent 输入组件尚未就绪，请稍后重试。</p>,
    })}
  </section>
}

/** Wait for the Publisher main entry's declaration; unload leaves the global Conversation intact. */
export function registerPublisherAgent(ctx: Context): () => void {
  return ctx.slots.inject(PUBLISHER_AGENT_SLOT, () => ctx.slots.register({ name: PUBLISHER_AGENT_SLOT }, PublisherAgentPanel))
}
