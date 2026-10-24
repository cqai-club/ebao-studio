export const TOP_JOURNAL_GROUPS = {
  general: [
    'Nature',
    'Science',
    'Cell',
    'Proceedings of the National Academy of Sciences',
    'Nature Communications',
    'Science Advances',
    'Nature Human Behaviour',
    'Nature Sustainability',
    'Nature Climate Change',
    'National Science Review',
  ],
  medicine: [
    'The Lancet',
    'New England Journal of Medicine',
    'JAMA',
    'BMJ',
    'Annals of Internal Medicine',
    'PLOS Medicine',
    'The Lancet Public Health',
    'The Lancet Digital Health',
    'Nature Medicine',
    'Health Affairs',
  ],
  business: [
    'Academy of Management Journal',
    'Academy of Management Review',
    'Administrative Science Quarterly',
    'Organization Science',
    'Strategic Management Journal',
    'Journal of Management',
    'Journal of International Business Studies',
    'MIS Quarterly',
    'Information Systems Research',
    'Management Science',
    'Journal of Marketing',
    'Journal of Consumer Research',
    'Marketing Science',
    'Journal of Operations Management',
  ],
  economicsSocial: [
    'American Economic Review',
    'Econometrica',
    'Journal of Political Economy',
    'Quarterly Journal of Economics',
    'Review of Economic Studies',
    'Journal of Finance',
    'Journal of Financial Economics',
    'Review of Financial Studies',
    'American Sociological Review',
    'American Journal of Sociology',
    'American Political Science Review',
    'Psychological Science',
    'Journal of Personality and Social Psychology',
  ],
  education: [
    'Review of Educational Research',
    'Educational Researcher',
    'American Educational Research Journal',
    'Journal of Educational Psychology',
    'Educational Psychologist',
    'Computers & Education',
    'The Internet and Higher Education',
    'British Journal of Educational Technology',
    'Studies in Higher Education',
    'Higher Education',
    'Research Policy',
    'The Journal of Higher Education',
  ],
  computingEngineering: [
    'IEEE Transactions on Pattern Analysis and Machine Intelligence',
    'IEEE Transactions on Neural Networks and Learning Systems',
    'Journal of Machine Learning Research',
    'Artificial Intelligence',
    'ACM Computing Surveys',
    'IEEE Transactions on Knowledge and Data Engineering',
    'IEEE Transactions on Software Engineering',
    'Nature Machine Intelligence',
    'IEEE Transactions on Power Delivery',
    'IEEE Transactions on Power Systems',
    'IEEE Transactions on Smart Grid',
    'Automatica',
    'Applied Energy',
    'Journal of Power Sources',
  ],
} as const

export function normalizeJournalName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/^the\s+/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

const TOP_JOURNAL_SET = new Set(
  Object.values(TOP_JOURNAL_GROUPS)
    .flat()
    .map(normalizeJournalName),
)

export function isTopForeignJournal(venue: string | undefined): boolean {
  return venue !== undefined && TOP_JOURNAL_SET.has(normalizeJournalName(venue))
}
