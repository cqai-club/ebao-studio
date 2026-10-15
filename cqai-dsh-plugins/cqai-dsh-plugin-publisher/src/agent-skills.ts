import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import publishing from '../skills/multiplatform-publish/SKILL.md?raw'
import editing from '../skills/publisher-edit-draft/SKILL.md?raw'
import writing from '../skills/publisher-write-article/SKILL.md?raw'
import polishing from '../skills/publisher-polish-copy/SKILL.md?raw'
import voice from '../skills/publisher-learn-voice/SKILL.md?raw'
import adapting from '../skills/publisher-adapt-platform/SKILL.md?raw'
import illustrating from '../skills/publisher-illustrate-article/SKILL.md?raw'

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

export const WRITE_ARTICLE_SKILL = definition(writing)
export const POLISH_COPY_SKILL = definition(polishing)
export const LEARN_VOICE_SKILL = definition(voice)
export const ADAPT_PLATFORM_SKILL = definition(adapting)
export const ILLUSTRATE_ARTICLE_SKILL = definition(illustrating)

export const WRITING_SKILLS = [WRITE_ARTICLE_SKILL, POLISH_COPY_SKILL, LEARN_VOICE_SKILL, ADAPT_PLATFORM_SKILL] as const

export interface PublisherSkillEntry {
  skill: SkillDefinition
  capability: 'publish' | 'edit'
  /** Reading prose preferences never grants permission to replace them. */
  writingProfile?: 'read' | 'write'
}

/** Runtime discovery remains local to the content's currently bound owned Agent. */
export const PUBLISHER_SKILL_CATALOG: readonly PublisherSkillEntry[] = [
  { skill: PUBLISHING_SKILL, capability: 'publish' },
  { skill: EDIT_DRAFT_SKILL, capability: 'edit' },
  ...WRITING_SKILLS.map(skill => ({ skill, capability: 'edit' as const,
    writingProfile: skill === LEARN_VOICE_SKILL ? 'write' as const : 'read' as const })),
  { skill: ILLUSTRATE_ARTICLE_SKILL, capability: 'edit' },
]

export function isPublisherSkill(value: unknown): value is SkillDefinition {
  if (typeof value !== 'object' || value === null) return false
  const skill = value as Partial<SkillDefinition>
  return PUBLISHER_SKILL_CATALOG.map(entry => entry.skill).some(owned =>
    skill.name === owned.name && skill.provider === owned.provider && skill.content === owned.content)
}
