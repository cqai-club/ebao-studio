import {
  ARTICLE_THEME_LABELS, PLATFORM_LABELS, projectContentForPlatform, resolveArticleTheme, type PublisherAccount, type PublisherContent,
  type PublisherMode, type PublisherPlatformCapability,
} from './protocol.ts'
import { articleAssetIds } from './article-assets.ts'

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
  if (!content.title.trim() && accounts.length === 0) return '请填写标题'
  if (accounts.length === 0) return '请选择支持此类型的发布账号'

  for (const account of accounts) {
    const selected = projectContentForPlatform(content, account.platform)
    if (!selected.title.trim()) return '请填写标题'
    if (selected.contentType === 'article' && !selected.body.trim()) return '请填写正文'
    if (selected.contentType === 'image-note' && selected.assets.length === 0) return '图文至少添加一张图片'
    if (selected.coverAssetId && !selected.assets.some(asset => asset.id === selected.coverAssetId)) {
      return `${PLATFORM_LABELS[account.platform]}封面不在该平台已选图片中`
    }
    if (selected.contentType === 'article' && account.platform === 'wxmp' && !selected.coverAssetId) {
      return '微信公众号文章必须选择封面图片'
    }
    if (selected.contentType === 'article' && selected.assets.length > 0 && !selected.coverAssetId) {
      return '请为文章选择封面图片'
    }
    if (selected.contentType === 'article' && account.platform === 'wxmp') {
      if (selected.assets.some(asset => asset.mime === 'image/webp')) {
        return '已有 WebP 素材请重新上传，上传时会自动转为 JPEG；再删除旧素材并重新选择封面或插入正文'
      }
      if (selected.title.length > 64) return '微信公众号文章标题不能超过 64 字'
      if (selected.summary.length > 120) return '微信公众号文章摘要不能超过 120 字'
      const cover = selected.assets.find(asset => asset.id === selected.coverAssetId)
      if (cover && cover.bytes >= 10 * 1024 * 1024) return '微信公众号封面不能超过 10MB'
      try {
        const used = new Set(articleAssetIds(selected))
        if (selected.assets.some(asset => used.has(asset.id) && asset.bytes >= 1024 * 1024)) {
          return '微信公众号正文图片必须小于 1MB'
        }
      } catch (cause) { return cause instanceof Error ? cause.message : '正文图片引用无效' }
    }
    if (selected.contentType === 'article' && (account.platform === 'juejin' || account.platform === 'blbl')
      && selected.body.includes('ebao-asset://')) return '掘金和B站专栏暂不支持正文插图，请分开提交'
    if (selected.contentType === 'article' && (account.platform === 'juejin' || account.platform === 'blbl')
      && selected.assets.some(asset => asset.id !== selected.coverAssetId)) {
      return `${PLATFORM_LABELS[account.platform]}文章当前只支持单张封面，请在该平台版本中取消其他图片`
    }
    if (selected.contentType === 'article' && (account.platform === 'tt' || account.platform === 'bjh')) {
      try { articleAssetIds(selected) } catch (cause) { return cause instanceof Error ? cause.message : '正文图片引用无效' }
    }
    const capability = capabilities.find(item => item.platform === account.platform)
    if (!capability?.modes[selected.contentType]?.includes(mode)) {
      return `${PLATFORM_LABELS[account.platform]}暂不支持此内容类型和提交方式`
    }
    if (selected.contentType === 'article' && account.platform === 'wxmp') {
      const theme = resolveArticleTheme(selected)
      const requiredVersion = theme === 'classic' ? 0 : theme === 'editorial' ? 1 : 2
      if ((capability.articleThemeVersion ?? 0) < requiredVersion) {
        return `当前 Publisher Worker 不支持“${ARTICLE_THEME_LABELS[theme]}”公众号排版，请更新 Worker 并重启应用；也可切换为基础主题后提交`
      }
    }
    const titleLimit = capability.maxTitleLength?.[selected.contentType]
    if (titleLimit !== undefined && selected.title.length > titleLimit) {
      return `${PLATFORM_LABELS[account.platform]}标题不能超过 ${titleLimit} 字`
    }
    const assetLimit = capability.maxAssets?.[selected.contentType]
    if (assetLimit !== undefined && selected.assets.length > assetLimit) {
      return `${PLATFORM_LABELS[account.platform]}当前最多支持 ${assetLimit} 张图片`
    }
    for (const field of capability.requiredFields[selected.contentType] ?? []) {
      if (!selected.platformFields[account.platform]?.[field]?.trim()) {
        return `请填写${PLATFORM_LABELS[account.platform]}的${FIELD_LABELS[field] || field}`
      }
    }
    if (selected.contentType === 'image-note' && account.platform === 'xhs'
      && !XHS_IMAGE_STATEMENTS.has(selected.creativeStatement)) {
      return '小红书图文暂不支持所选内容声明'
    }
  }
  return undefined
}
