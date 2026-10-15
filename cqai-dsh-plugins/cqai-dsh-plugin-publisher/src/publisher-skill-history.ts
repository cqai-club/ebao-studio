/** Recover only still-visible, native Publisher Skill instruction deliveries. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { PUBLISHER_SKILL_CATALOG } from './agent-skills.ts'

export function publisherSkillsInHistory(agent: Agent): string[] {
  const { session } = agent
  // A fork can contain its parent's valid instructions without owning its grants.
  if (session.header.origin === 'subagent' || session.header.parentSession !== undefined) return []
  const instructions = new Map(PUBLISHER_SKILL_CATALOG.map(({ skill }) => [skill.name, renderSkillContent(skill)]))
  const contains = (content: readonly ContentBlock[], name: string): boolean => {
    const rendered = instructions.get(name)
    return rendered !== undefined && content.some(block => block.type === 'text' && block.text.includes(rendered))
  }
  const calls = new Map<string, string>()
  const loaded = new Set<string>()
  for (const message of session.deriveMessages()) {
    if (message.role === 'user' && message.source.kind === 'skill-invocation'
      && message.source.form === 'instructions' && contains(message.content, message.source.name)) {
      loaded.add(message.source.name)
    } else if (message.role === 'assistant' && message.source.kind === 'model') {
      for (const block of message.content) {
        if (block.type !== 'tool-call') continue
        calls.delete(block.id)
        if (block.name !== 'skill') continue
        try {
          const args: unknown = JSON.parse(block.arguments)
          if (typeof args !== 'object' || args === null) continue
          const name = (args as { name?: unknown }).name
          if (typeof name === 'string' && instructions.has(name)) calls.set(block.id, name)
        } catch { /* Malformed calls cannot prove a successful Skill read. */ }
      }
    } else if (message.role === 'tool') {
      const name = calls.get(message.toolCallId)
      calls.delete(message.toolCallId)
      if (name && message.source.kind === 'tool' && message.source.callId === message.toolCallId
        && !message.isError && contains(message.content, name)) loaded.add(name)
    }
  }
  return [...loaded]
}
