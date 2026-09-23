import {
  PLATFORM_LABELS, type PublisherAccount, type PublisherContent,
  type PublisherMode, type PublisherPlatformCapability,
} from './protocol.ts'

const FIELD_LABELS: Record<string, string> = { category: '分类', topic: '话题', original: '原创声明' }
const XHS_IMAGE_STATEMENTS = new Set(['none', 'ai_generated', 'fiction', 'marketing'])

/** Shared UI/Host preflight; the Worker still independently validates login and its own content snapshot. */
export function contentSubmissionError(
  content: PublisherContent,
  accounts: PublisherAccount[],
  capabilities: PublisherPlatformCapability[],
  mode: PublisherMode,
): string | undefined {
  if (content.contentType === 'video') return '草稿内容类型不匹配'
  if (!content.title.trim()) return '请填写标题'
  if (content.contentType === 'article' && !content.body.trim()) return '请填写正文'
  if (content.contentType === 'image-note' && content.assets.length === 0) return '图文至少添加一张图片'
  if (accounts.length === 0) return '请选择支持此类型的发布账号'
  if (content.contentType === 'article' && content.assets.length > 0 && !content.coverAssetId) return '请为文章选择封面图片'

  for (const account of accounts) {
    const capability = capabilities.find(item => item.platform === account.platform)
    if (!capability?.modes[content.contentType]?.includes(mode)) {
      return `${PLATFORM_LABELS[account.platform]}暂不支持此内容类型和提交方式`
    }
    const titleLimit = capability.maxTitleLength?.[content.contentType]
    if (titleLimit !== undefined && content.title.length > titleLimit) {
      return `${PLATFORM_LABELS[account.platform]}标题不能超过 ${titleLimit} 字`
    }
    const assetLimit = capability.maxAssets?.[content.contentType]
    if (assetLimit !== undefined && content.assets.length > assetLimit) {
      return `${PLATFORM_LABELS[account.platform]}当前最多支持 ${assetLimit} 张图片`
    }
    for (const field of capability.requiredFields[content.contentType] ?? []) {
      if (!content.platformFields[account.platform]?.[field]?.trim()) {
        return `请填写${PLATFORM_LABELS[account.platform]}的${FIELD_LABELS[field] || field}`
      }
    }
    if (content.contentType === 'image-note' && account.platform === 'xhs'
      && !XHS_IMAGE_STATEMENTS.has(content.creativeStatement)) {
      return '小红书图文暂不支持所选内容声明'
    }
  }
  return undefined
}
