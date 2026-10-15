import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import {
  PUBLISHER_AGENT_SLOT, PublisherAgentPanel, PublisherChatHistory, registerPublisherAgent, type PublisherChatHistoryProps,
} from '../src/client/agent-panel.tsx'

function historyProps(renderSlot: (key: string, owner: unknown) => unknown): PublisherChatHistoryProps {
  return {
    contentType: 'article', renderSlot,
    useSession: () => ({ openState: 'open', blank: false }),
    useChat: (select: (value: unknown) => unknown) => select({ order: [], nodes: { values: () => [] }, timeline: { turnOrder: [] } }),
    useInput: () => ({ phase: 'plain', queue: [], draft: '', attachmentIds: [] }),
    useProjection: (_key: string, select: (value: unknown) => unknown) => select({ 'next-turn': [], 'next-step': [] }),
  } as unknown as PublisherChatHistoryProps
}

describe('Publisher embedded Conversation contract', () => {
  it('uses its own strict Session seat and leaves the ordinary Conversation registration intact', () => {
    const core = new SlotCore()
    const unmount = core.register({ name: 'root', children: {
      'main.conversation': { kind: 'single', scope: 'session-maybe' },
      'publisher.agent': { kind: 'single', scope: 'session' },
    } }, (_props: PropsRenderSlots<'main.conversation' | 'publisher.agent'>) => null)
    const ordinary = () => null
    core.register({ name: 'main.conversation' }, ordinary)
    const ctx = { slots: {
      inject: (slot: typeof PUBLISHER_AGENT_SLOT, install: () => () => void) => {
        expect(core.spec(slot)?.scope).toBe('session')
        return install()
      },
      register: core.register.bind(core),
    } } as unknown as Context
    const dispose = registerPublisherAgent(ctx)
    expect(core.entriesOfSlot(PUBLISHER_AGENT_SLOT)[0]?.component).toBe(PublisherAgentPanel)
    expect(core.entriesOfSlot('main.conversation')[0]?.component).toBe(ordinary)
    dispose()
    expect(core.entriesOfSlot(PUBLISHER_AGENT_SLOT)).toHaveLength(0)
    expect(core.entriesOfSlot('main.conversation')[0]?.component).toBe(ordinary)
    unmount()
  })

  it('keeps the history region present when the empty DS transcript returns null', () => {
    const markup = renderToStaticMarkup(<PublisherChatHistory {...historyProps(() => null)}/> )
    expect(markup).toBe('<div class="pub-agent-history"></div>')
  })
  it('delegates the transcript to Chat without invoking any global remembered-View action', () => {
    const calls: unknown[] = []
    const markup = renderToStaticMarkup(<PublisherChatHistory {...historyProps((key: string, owner: unknown) => {
        calls.push({ key, owner })
        return <article data-history-session="publisher-owned">Persisted user and Agent messages</article>
      })}/> )
    expect(calls).toEqual([{ key: 'conversation.session', owner: { view: 'chat' } }])
    expect(markup).toContain('<div class="pub-agent-history"><article data-history-session="publisher-owned">Persisted user and Agent messages</article></div>')
    expect(markup).toContain('data-history-session="publisher-owned"')
  })
})
