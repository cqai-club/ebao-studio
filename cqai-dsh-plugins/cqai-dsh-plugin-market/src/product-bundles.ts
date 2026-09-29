/** Desktop-shipped features shown in the installed-plugin list. */
export const PRODUCT_PACKAGES = [
  'cqai-dsh-plugin-cqai-club-theme',
  'cqai-dsh-plugin-imagegen',
  'cqai-dsh-plugin-video',
  'cqai-dsh-plugin-publisher',
  'cqai-dsh-plugin-talkcraft',
  'cqai-dsh-plugin-short-video',
  'dsh-ppt-composer',
] as const

export type ProductPackage = (typeof PRODUCT_PACKAGES)[number]
