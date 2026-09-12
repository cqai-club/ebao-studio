export type CqaiQuicknavLocaleKey =
  | 'action'
  | 'pageTitle'
  | 'pageDescription'
  | 'files'
  | 'terminal'
  | 'git'
  | 'subagents'
  | 'comingSoon'

export const zh: Record<CqaiQuicknavLocaleKey, string> = {
  action: 'CQAI 工具',
  pageTitle: 'CQAI 工具工作台',
  pageDescription: '常用工具和后续 CQAI 扩展会集中在这里。',
  files: '文件工作台',
  terminal: '终端',
  git: 'Git 文件变动',
  subagents: '子代理任务',
  comingSoon: '后续可在这里接入 CQAI 自己的工具页面。',
}

export const en: Record<CqaiQuicknavLocaleKey, string> = {
  action: 'CQAI Tools',
  pageTitle: 'CQAI Tool Workbench',
  pageDescription: 'Common tools and future CQAI extensions live here.',
  files: 'File Workbench',
  terminal: 'Terminal',
  git: 'Git Changes',
  subagents: 'Subagent Tasks',
  comingSoon: 'Add CQAI-owned tool pages here as the product grows.',
}
