import type { LiteratureSource, ScholarProject } from '../src/protocol.ts'

export const source: LiteratureSource = {
  id: 'https://openalex.org/W1',
  title: 'Generative AI and knowledge work: a systematic review',
  authors: ['Ada Lovelace', 'Alan Turing'],
  year: 2024,
  venue: 'Journal of Knowledge Systems',
  doi: '10.1000/example.2024.1',
  url: 'https://doi.org/10.1000/example.2024.1',
  abstract: 'This review studies how generative AI changes knowledge work and writing practices.',
  citedBy: 42,
  source: 'openalex',
}

export function project(overrides: Partial<ScholarProject> = {}): ScholarProject {
  const now = '2026-10-19T08:00:00.000Z'
  return {
    id: '3b5c40a6-8251-4a6f-bda0-70f868b4a8bf',
    title: '生成式 AI 与研究生学术写作',
    prompt: '写一篇关于生成式 AI 辅助科研写作的研究论文',
    kind: 'research',
    discipline: '教育学',
    language: 'zh',
    literatureScope: 'mixed',
    journalQuality: 'any',
    databases: ['openalex', 'crossref', 'pubmed'],
    citationStyle: 'gb7714',
    sourceCount: 12,
    status: 'complete',
    content: '# 生成式 AI 与研究生学术写作\n\n摘要：本文讨论研究生使用生成式 AI 的写作实践。\n\n关键词：生成式 AI；学术写作；研究生\n\n## 引言\n\n现有研究显示工具使用与写作投入之间存在复杂关系[1]。\n\n## 参考文献\n\n[1] Lovelace A、Turing A. Generative AI and knowledge work. 2024.',
    abstract: '本文讨论研究生使用生成式 AI 的写作实践。',
    keywords: ['生成式 AI', '学术写作', '研究生'],
    sources: [source],
    layout: {
      degree: 'master',
      journalName: '教育研究',
      author: '张三',
      affiliation: '示例大学',
      template: 'journal',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
