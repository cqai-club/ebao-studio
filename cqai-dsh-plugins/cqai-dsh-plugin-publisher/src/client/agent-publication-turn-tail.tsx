import { useMemo, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot, ToolCallBlock, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { AgentPublicationCard, parseAgentPublicationRequestId } from './agent-publication-card.tsx'

/** Read official paired Tool results, including nested calls, without reconstructing the transcript. */
export function publicationRequestIds(rows: readonly ToolChatData[]): string[] {
  const ids = new Set<string>()
  const visit = (block: ToolCallBlock) => {
    if ('kind' in block && block.kind === 'tool-result' && block.call?.name === 'publisher_request_publication') {
      const requestId = parseAgentPublicationRequestId(block)
      if (requestId) ids.add(requestId)
    }
    block.subCalls.forEach(visit)
  }
  rows.forEach(row => visit(row.root))
  return [...ids]
}

/** The official Turn tail stays visible when a completed Turn's Tool process is folded. */
export function AgentPublicationTurnTail({ turn, sessionId, useChat }: PropsRuntime<'conversation.chat.turnTail'>) {
  const nodes: ChatSnapshot['nodes'] = useChat((snapshot: ChatSnapshot) => snapshot.nodes)
  const source = useMemo(() => nodes.turnDataSource(turn.turn, 'tool-call'), [nodes, turn.turn])
  const rows = useSyncExternalStore<readonly ToolChatData[]>(source.subscribe, source.getSnapshot, source.getSnapshot)
  const requestIds = publicationRequestIds(rows)
  if (requestIds.length === 0) return null
  return <div className="pub-agent-publication-tail" aria-label="本轮发布确认" style={{ display: 'grid', gap: 12, minWidth: 0, width: '100%' }}>
    {requestIds.map(requestId => <AgentPublicationCard key={`${sessionId}/${requestId}`} sessionId={sessionId} requestId={requestId}/>)}
  </div>
}
