import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import markdown from '../skills/ebao-imagegen/SKILL.md?raw'

const file = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown)
const name = file?.[1].match(/^name: (.+)$/m)?.[1].trim()
const description = file?.[1].match(/^description: (.+)$/m)?.[1].trim()
if (!file || !name || !description) throw new Error('e图宝 Skill metadata is missing')

/** Embedded in the Host bundle so installed apps need no source checkout. */
export const AGENT_IMAGE_SKILL: SkillDefinition = {
  name, description, content: file[2].trim(), source: 'runtime', provider: 'cqai-imagegen',
  invocation: { modelInvocable: true, userInvocable: true },
}

export function isAgentImageSkill(value: unknown): value is SkillDefinition {
  if (typeof value !== 'object' || value === null) return false
  const skill = value as Partial<SkillDefinition>
  return skill.name === AGENT_IMAGE_SKILL.name && skill.provider === AGENT_IMAGE_SKILL.provider
    && skill.content === AGENT_IMAGE_SKILL.content
}
