import {
  ARTICLE_THEME_LABELS, PLATFORM_LABELS, projectContentForPlatform, resolveArticleTheme, type PublisherAccount, type PublisherContent,
  type PublisherMode, type PublisherPlatformCapability,
} from './protocol.ts'
import { articleImageSources, hasRawArticleImage } from './article-assets.ts'

const FIELD_LABELS: Record<string, string> = { category: '分类', topic: '话题', original: '原创声明' }
const XHS_IMAGE_STATEMENTS = new Set(['none', 'ai_generated', 'fiction', 'marketing'])
const MANAGED_IMAGE = /^ebao-asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu
const WECHAT_COVER_LIMIT = 10 * 1024 * 1024
const WECHAT_BODY_IMAGE_LIMIT = 1024 * 1024

function usableWechatCover(asset: PublisherContent['assets'][number]): boolean {
  return (asset.mime === 'image/jpeg' || asset.mime === 'image/png') && asset.bytes < WECHAT_COVER_LIMIT
}

/** Explain changes made only to the platform submission copy; the editable draft stays intact. */
export function articleSubmissionWarnings(
  content: PublisherContent,
  accounts: PublisherAccount[],
  capabilities: PublisherPlatformCapability[],
): string[] {
  if (content.contentType !== 'article') return []
  return accounts.flatMap(account => {
    const selected = projectContentForPlatform(content, account.platform)
    const sources = articleImageSources(selected.body)
    const assets = new Map(selected.assets.map(asset => [asset.id, asset]))
    const notes: string[] = []
    if (account.platform === 'tt' && selected.summary.trim()) notes.push('独立摘要不会写入头条文章')
    if ((account.platform === 'wxmp' || account.platform === 'tt' || account.platform === 'bjh') && selected.tags.length > 0) {
      notes.push('文章标签暂不写入该平台')
    }
    if (account.platform === 'juejin' && !selected.platformFields.juejin?.category?.trim()) {
      notes.push('未填写分类，将使用默认分类“前端”')
    }
    const limit = account.platform === 'wxmp' ? 64
      : capabilities.find(item => item.platform === account.platform)?.maxTitleLength?.article
    if (limit && selected.title.length > limit) notes.push(`标题将截短至 ${limit} 字`)
    if (account.platform === 'wxmp' && selected.summary.length > 120) notes.push('摘要将截短至 120 字')
    const selectedCover = selected.assets.find(asset => asset.id === selected.coverAssetId)
    const effectiveCoverId = selectedCover?.id ?? selected.assets[0]?.id
    if (account.platform === 'juejin' || account.platform === 'blbl') {
      if (sources.length > 0 || hasRawArticleImage(selected.body)) notes.push('正文插图将从该平台版本移除')
      if (selected.assets.some(asset => asset.id !== effectiveCoverId)) notes.push('非封面图片不会提交到该平台')
    } else {
      const unsupported = sources.some(source => {
        const id = MANAGED_IMAGE.exec(source)?.[1]
        const asset = id ? assets.get(id) : undefined
        return !asset || account.platform === 'wxmp'
          && (asset.mime === 'image/webp' || asset.bytes >= WECHAT_BODY_IMAGE_LIMIT)
      }) || hasRawArticleImage(selected.body)
      if (unsupported) notes.push('不符合该平台要求的正文图片将从平台版本移除')
      if (account.platform === 'wxmp' && selected.assets.some(asset => asset.mime === 'image/webp')) {
        notes.push('WebP 素材不会上传到公众号')
      }
    }
    if (account.platform === 'wxmp') {
      const cover = selected.assets.find(asset => asset.id === selected.coverAssetId)
      if ((!cover || !usableWechatCover(cover)) && selected.assets.some(usableWechatCover)) {
        notes.push('将自动选取可用的 JPEG/PNG 封面')
      }
      const effectiveCover = cover && usableWechatCover(cover) ? cover : selected.assets.find(usableWechatCover)
      const usedBodyIds = new Set(sources.flatMap(source => {
        const id = MANAGED_IMAGE.exec(source)?.[1]
        const asset = id ? assets.get(id) : undefined
        return asset && (asset.mime === 'image/jpeg' || asset.mime === 'image/png')
          && asset.bytes < WECHAT_BODY_IMAGE_LIMIT ? [asset.id] : []
      }))
      if (selected.assets.some(asset => asset.id !== effectiveCover?.id && !usedBodyIds.has(asset.id))) {
        notes.push('未使用或不兼容的素材不会上传到公众号')
      }
    } else if (!selectedCover && selected.assets.length > 0) {
      notes.push('将自动选取首张图片作为封面')
    }
    if (account.platform !== 'wxmp' && selected.coverAssetId && !selectedCover && selected.assets.length === 0) {
      notes.push('封面不在该平台所选图片中，提交时将忽略')
    }
    return notes.map(note => `${PLATFORM_LABELS[account.platform]}：${note}`)
  })
}

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
    if (selected.contentType === 'image-note' && account.platform === 'tt') return '头条暂不支持图文发布'
    if (!selected.title.trim()) return '请填写标题'
    if (selected.contentType === 'article' && !selected.body.trim()) return '请填写正文'
    if (selected.contentType === 'image-note' && selected.assets.length === 0) return '图文至少添加一张图片'
    if (selected.contentType === 'image-note' && selected.coverAssetId && !selected.assets.some(asset => asset.id === selected.coverAssetId)) {
      return `${PLATFORM_LABELS[account.platform]}封面不在该平台已选图片中`
    }
    if (selected.contentType === 'article' && account.platform === 'wxmp') {
      if (!selected.assets.some(usableWechatCover)) return '微信公众号文章需要一张小于 10MB 的 JPEG/PNG 封面图片'
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
    if (selected.contentType !== 'article' && titleLimit !== undefined && selected.title.length > titleLimit) {
      return `${PLATFORM_LABELS[account.platform]}标题不能超过 ${titleLimit} 字`
    }
    const assetLimit = capability.maxAssets?.[selected.contentType]
    if (selected.contentType !== 'article' && assetLimit !== undefined && selected.assets.length > assetLimit) {
      return `${PLATFORM_LABELS[account.platform]}当前最多支持 ${assetLimit} 张图片`
    }
    for (const field of capability.requiredFields[selected.contentType] ?? []) {
      if (!selected.platformFields[account.platform]?.[field]?.trim()) {
        if (selected.contentType === 'article' && account.platform === 'juejin' && field === 'category') continue
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
