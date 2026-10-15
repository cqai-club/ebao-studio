import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import markdown from '../skills/publisher-route/SKILL.md?raw'

const file = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown)
const name = file?.[1].match(/^name: (.+)$/m)?.[1].trim()
const description = file?.[1].match(/^description: (.+)$/m)?.[1].trim()
if (!file || !name || !description) throw new Error('Publisher 入口 Skill 元数据缺失')

/** Global discovery only. Professional grants remain in the bound Agent catalog. */
export const PUBLISHER_ROUTING_SKILL: SkillDefinition = {
  name, description, content: file[2].trim(), source: 'runtime',
  provider: 'cqai-publisher-route', invocation: { modelInvocable: true, userInvocable: true },
}
