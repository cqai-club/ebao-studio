import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import publishing from '../skills/multiplatform-publish/SKILL.md?raw'
import editing from '../skills/publisher-edit-draft/SKILL.md?raw'

export const PUBLISHER_SKILL_PROVIDER = 'cqai-publisher'

/** Bundle the reviewed Skill files so packaged Hosts need no source checkout. */
function definition(markdown: string): SkillDefinition {
  const file = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown)
  const name = file?.[1].match(/^name: (.+)$/m)?.[1].trim()
  const description = file?.[1].match(/^description: (.+)$/m)?.[1].trim()
  if (!file || !name || !description) throw new Error('Publisher Skill metadata is missing')
  return { name, description, content: file[2].trim(), source: 'runtime',
    provider: PUBLISHER_SKILL_PROVIDER, invocation: { modelInvocable: true, userInvocable: true } }
}

export const PUBLISHING_SKILL = definition(publishing)
export const EDIT_DRAFT_SKILL = definition(editing)

export function isPublisherSkill(value: unknown): value is SkillDefinition {
  if (typeof value !== 'object' || value === null) return false
  const skill = value as Partial<SkillDefinition>
  return [PUBLISHING_SKILL, EDIT_DRAFT_SKILL].some(owned =>
    skill.name === owned.name && skill.provider === owned.provider && skill.content === owned.content)
}
