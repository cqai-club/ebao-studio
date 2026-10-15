import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId,
  type Message,
} from '@deepseek-ai/dsh-llm'
import { renderSkillContent, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import { EDIT_DRAFT_SKILL, PUBLISHING_SKILL, WRITE_ARTICLE_SKILL } from '../src/agent-skills.ts'
import { publisherSkillsInHistory } from '../src/publisher-skill-history.ts'

function fixture(messages: Message[], header: { origin?: 'subagent'; parentSession?: string } = {}) {
  const deriveMessages = vi.fn(() => messages)
  const agent = { session: { header, deriveMessages,
    eventAt: () => { throw new Error('Use the current message projection') },
    snapshotEvents: () => { throw new Error('Use the current message projection') },
  } } as unknown as Agent
  return { agent, deriveMessages }
}

function call(skill = PUBLISHING_SKILL, id = 'skill-read', tool = 'skill', args = JSON.stringify({ name: skill.name })) {
  return createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{
    type: 'tool-call', id: ToolCallId(id), name: tool, arguments: args,
  }] })
}

function result(skill = PUBLISHING_SKILL, id = 'skill-read', options: { text?: string; isError?: boolean } = {}) {
  return createToolResultMessage({ callId: ToolCallId(id), isError: options.isError ?? false,
    content: [{ type: 'text', text: options.text ?? renderSkillContent(skill) }] })
}

function slash(skill: SkillDefinition) {
  return createUserMessage({ source: { kind: 'skill-invocation', name: skill.name, form: 'instructions' },
    content: [{ type: 'text', text: renderSkillContent(skill) }] })
}

describe('Publisher native Skill evidence in current Session history', () => {
  it('recovers a successful native Skill read from a cold Session projection', () => {
    const test = fixture([call(), result()])
    expect(publisherSkillsInHistory(test.agent)).toEqual([PUBLISHING_SKILL.name])
    expect(test.deriveMessages).toHaveBeenCalledOnce()
  })

  it('recovers native slash instructions and deduplicates mixed deliveries in order', () => {
    const test = fixture([slash(WRITE_ARTICLE_SKILL), call(), result(), slash(WRITE_ARTICLE_SKILL),
      call(EDIT_DRAFT_SKILL, 'edit'), result(EDIT_DRAFT_SKILL, 'edit')])
    expect(publisherSkillsInHistory(test.agent)).toEqual([
      WRITE_ARTICLE_SKILL.name, PUBLISHING_SKILL.name, EDIT_DRAFT_SKILL.name,
    ])
  })

  it('rejects pasted instructions, model prose, unpaired results and other tools including run_code', () => {
    const text = renderSkillContent(PUBLISHING_SKILL)
    const messages: Message[] = [
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
      createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text }] }),
      result(), call(PUBLISHING_SKILL, 'read', 'read'), result(PUBLISHING_SKILL, 'read'),
      call(PUBLISHING_SKILL, 'program', 'run_code'), result(PUBLISHING_SKILL, 'program'),
    ]
    expect(publisherSkillsInHistory(fixture(messages).agent)).toEqual([])
  })

  it('requires the exact call id and a preceding call rather than a later one', () => {
    const test = fixture([result(PUBLISHING_SKILL, 'later'), call(PUBLISHING_SKILL, 'later'),
      call(PUBLISHING_SKILL, 'actual'), result(PUBLISHING_SKILL, 'different')])
    expect(publisherSkillsInHistory(test.agent)).toEqual([])
  })

  it('rejects inconsistent result provenance even when its body matches', () => {
    const outcome = result()
    const inconsistent = { ...outcome, source: { ...outcome.source, callId: ToolCallId('another-call') } }
    expect(publisherSkillsInHistory(fixture([call(), inconsistent]).agent)).toEqual([])
  })

  it('rejects error results and consumes their call so a duplicate cannot revive it', () => {
    expect(publisherSkillsInHistory(fixture([call(), result(PUBLISHING_SKILL, 'skill-read', { isError: true }), result()]).agent)).toEqual([])
  })

  it.each(['not-json', 'null', '[]', '42', '{}', '{"name":42}', '{"name":"unrelated"}'])(
    'rejects malformed or unrelated Skill call arguments %s', args => {
      expect(publisherSkillsInHistory(fixture([call(PUBLISHING_SKILL, 'skill-read', 'skill', args), result()]).agent)).toEqual([])
    },
  )

  it('matches the requested Skill name and its current complete canonical content', () => {
    for (const text of [renderSkillContent(EDIT_DRAFT_SKILL), PUBLISHING_SKILL.content,
      renderSkillContent({ ...PUBLISHING_SKILL, provider: 'unrelated-provider' }),
      renderSkillContent({ ...PUBLISHING_SKILL, content: `${PUBLISHING_SKILL.content}\nOutdated instructions.` })]) {
      expect(publisherSkillsInHistory(fixture([call(), result(PUBLISHING_SKILL, 'skill-read', { text })]).agent)).toEqual([])
    }
  })

  it('requires native slash instruction provenance, form, name and unchanged body', () => {
    const original = slash(PUBLISHING_SKILL)
    const variants = [
      { ...original, source: { kind: 'user' } },
      { ...original, source: { ...original.source, form: 'notice' } },
      { ...original, source: { ...original.source, name: EDIT_DRAFT_SKILL.name } },
      { ...original, content: [{ type: 'text', text: `${PUBLISHING_SKILL.content}\nChanged.` }] },
    ] as Message[]
    expect(publisherSkillsInHistory(fixture(variants).agent)).toEqual([])
  })

  it('does not retain instruction evidence after compaction removes it from deriveMessages', () => {
    const messages: Message[] = [call(), result(), slash(EDIT_DRAFT_SKILL)]
    const test = fixture(messages)
    expect(publisherSkillsInHistory(test.agent)).toEqual([PUBLISHING_SKILL.name, EDIT_DRAFT_SKILL.name])
    messages.splice(0, messages.length,
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Previously loaded publishing instructions.' }] }))
    expect(publisherSkillsInHistory(test.agent)).toEqual([])
  })

  it.each([{ origin: 'subagent' as const }, { parentSession: 'parent-session' }])(
    'never recovers inherited grants for a subagent or fork %j', header => {
      const test = fixture([slash(PUBLISHING_SKILL), call(), result()], header)
      expect(publisherSkillsInHistory(test.agent)).toEqual([])
      expect(test.deriveMessages).not.toHaveBeenCalled()
    },
  )
})
