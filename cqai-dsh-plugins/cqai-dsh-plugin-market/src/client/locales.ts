export const en = {
  tab: 'CQAI Picks',
  title: 'CQAI Picks',
  intro: 'A curated view of installable plugins from the active Community Market source.',
  loading: 'Loading CQAI picks…',
  noSource: 'Select a Community Market source first.',
  unavailable: 'The Community Market is unavailable in this Profile.',
  empty: 'No matching picks were found in the active source.',
  retry: 'Retry',
  packageLabel: 'Package',
} as const

export const zh = {
  tab: 'CQAI 精选',
  title: 'CQAI 精选',
  intro: '从当前社区市场来源中筛选可安装的 CQAI 推荐插件。',
  loading: '正在加载 CQAI 精选……',
  noSource: '请先选择一个社区市场来源。',
  unavailable: '当前 Profile 未启用社区市场。',
  empty: '当前来源没有匹配的精选插件。',
  retry: '重试',
  packageLabel: '包名',
} as const

export type CqaiMarketLocaleKey = keyof typeof en
