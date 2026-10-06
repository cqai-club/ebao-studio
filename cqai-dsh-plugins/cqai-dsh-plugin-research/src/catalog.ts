/**
 * Shared catalog for e研宝 — the academic-research-skills digital employee.
 *
 * This module is imported by both halves, so it must stay free of Node and
 * browser APIs. It is the only place that names the upstream skills.
 *
 * @module cqai-dsh-plugin-research
 */

export const ROUTE_PREFIX = '/api/cqai-research'

/** Panel id shared by the sidebar entry, the main panel, and the home card. */
export const RESEARCH_PANEL = 'cqai-research'

/** Upstream project the four skills come from. */
export const UPSTREAM = {
  name: 'academic-research-skills',
  author: 'Cheng-I Wu',
  url: 'https://github.com/Imbad0202/academic-research-skills',
  license: 'CC-BY-NC-4.0',
} as const

export interface ResearchSkill {
  /** Kebab-case skill name, identical to the upstream `SKILL.md` frontmatter. */
  name: string
  title: string
  summary: string
  /** Upstream modes this skill exposes, shown as chips in the panel. */
  modes: readonly string[]
  /** Phrase a user can type or paste to invoke the skill from the composer. */
  triggers: readonly string[]
}

/** The four skills the employee is built around, in pipeline order. */
export const RESEARCH_SKILLS: readonly ResearchSkill[] = [
  {
    name: 'deep-research',
    title: '深度研究',
    summary: '13 个智能体把选题收敛成可引用的研究底稿：问题界定、方法设计、系统性检索、交叉核验与偏倚评估。',
    modes: ['full', 'quick', 'paper-review', 'lit-review', 'fact-check', 'three-way', 'socratic', 'systematic'],
    triggers: ['深度研究', '文献综述', '系统性综述', '事实核查', 'deep research'],
  },
  {
    name: 'academic-paper',
    title: '论文写作',
    summary: '12 个智能体覆盖从提纲到成稿：撰写、修改、摘要、引用核查、格式转换与投稿信。',
    modes: ['full', 'plan', 'outline', 'revision', 'abstract', 'lit-review', 'format-convert', 'citation-check', 'disclosure', 'rebuttal-audit'],
    triggers: ['写论文', '帮我写文献综述', '检查引用', '修改论文', '投稿信', '摘要'],
  },
  {
    name: 'academic-paper-reviewer',
    title: '同行评审',
    summary: '五个席位分工的评审小组（期刊匹配 + 三位同行 + 反方），支持全文评审、复核与校准。',
    modes: ['full', 're-review', 'quick', 'methodology', 'socratic', 'calibration'],
    triggers: ['审稿', '同行评审', '模拟评审', '审阅我的论文', 'review my paper'],
  },
  {
    name: 'academic-pipeline',
    title: '全流程编排',
    summary: '把研究、写作、完整性检查、评审与返修串成 10 个阶段的流水线，产出可审计的质量记录。',
    modes: ['pipeline', 'mid-entry', 'revision-loop'],
    triggers: ['学术流水线', '从研究到论文', '端到端论文', '帮我走完整流程'],
  },
]

export interface CatalogSkill extends ResearchSkill {
  /** Whether the skill currently resolves in this Harness profile. */
  installed: boolean
  /** Skill source reported by the catalog (`user-dsh`, `custom`, …). */
  source: string | null
  /** Absolute `SKILL.md` path when the skill is installed. */
  path: string | null
}

export interface CatalogPayload {
  upstream: typeof UPSTREAM
  /** True when the skills service answered; false when discovery was unavailable. */
  available: boolean
  installedCount: number
  skills: CatalogSkill[]
}
