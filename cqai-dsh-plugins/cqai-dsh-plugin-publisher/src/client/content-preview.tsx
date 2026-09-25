import { useEffect, useState } from 'react'
import {
  API, PLATFORM_LABELS, resolveArticleTheme,
  type Platform, type PublisherContent,
} from '../protocol.ts'
import { ImageNoteCarousel } from './image-note-carousel.tsx'
import { ArticleMarkdownPreview, wechatBodyImageIds } from './wechat-preview-html.tsx'

/** Both preview mounts use the same encoded, same-origin asset URL. */
export function contentAssetUrl(contentId: string, assetId: string): string {
  return `${API}/content-asset/${encodeURIComponent(contentId)}/${encodeURIComponent(assetId)}`
}

export function AssetPreviewImage({ src, alt, className = '', thumbnail = false }: {
  src: string
  alt: string
  className?: string
  thumbnail?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return failed
    ? <div className={`pub-content-preview-image-error ${className}`} role="img" aria-label={`${alt} 加载失败`}
      style={{ minHeight: thumbnail ? 95 : 120, width: '100%', display: 'grid', placeItems: 'center' }}>图片加载失败：{alt}</div>
    : <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)}/>
}

const ARTICLE_DISCLOSURES: Partial<Record<PublisherContent['creativeStatement'], string>> = {
  ai_generated: '本文包含 AI 生成内容', fiction: '虚构演绎，仅供娱乐', marketing: '营销推广',
  personal_opinion: '个人观点，仅供参考', repost: '转载', self_made_no_repost: '自制，禁止转载',
}

/** The same content projection drives the Publisher and conversation previews. */
export function previewContentModel(content: PublisherContent, platform?: Platform) {
  const disclosure = platform && content.contentType === 'article' ? ARTICLE_DISCLOSURES[content.creativeStatement] : undefined
  const body = platform === 'blbl' && content.summary ? `${content.summary}\n\n${content.body}` : content.body
  const renderedBody = disclosure ? `${body.trimEnd()}\n\n> 内容声明：${disclosure}` : body
  const embeddedAssets = wechatBodyImageIds(renderedBody)
  const cover = content.assets.find(asset => asset.id === content.coverAssetId)
  const remainingAssets = content.assets.filter(asset => asset.id !== cover?.id && !embeddedAssets.has(asset.id))
  return { renderedBody, embeddedAssets, cover, remainingAssets, articleTheme: resolveArticleTheme(content) }
}

function VideoContentPreview({ content, videoSourceName, videoPreviewUrl }: {
  content: PublisherContent
  videoSourceName?: string
  videoPreviewUrl?: string
}) {
  const [failed, setFailed] = useState(false)
  return <div className="pub-content-preview-shell pub-content-preview-video" aria-label="视频内容预览">
    <h2 className="pub-content-preview-title">{content.title || '未填写标题'}</h2>
    {videoSourceName && <p className="pub-content-preview-video-source">视频来源：{videoSourceName}</p>}
    {videoPreviewUrl && !failed
      ? <video key={videoPreviewUrl} className="pub-content-preview-video-player" src={videoPreviewUrl} controls playsInline preload="metadata" onError={() => setFailed(true)}>当前环境无法播放此视频。</video>
      : <p className="pub-content-preview-video-error" role="status">{failed
        ? content.videoSource?.kind === 'local'
          ? '本地视频无法读取。文件可能已移动、删除或发生变化，请重新选择文件。'
          : 'e剪宝成片无法播放，请检查作品文件或重新选择。'
        : '选择视频来源后即可预览。'}</p>}
    <p className="pub-content-preview-text">{content.description || '暂无视频描述'}</p>
    {content.tags.length > 0 && <p className="pub-content-preview-tags">{content.tags.map(tag => <span key={tag}>#{tag}</span>)}</p>}
  </div>
}

export function PublisherContentPreview({ content, platform, device, videoSourceName, videoPreviewUrl }: {
  content: PublisherContent
  platform?: Platform
  /** Only the conversation pane switches the preview frame width. */
  device?: 'mobile' | 'pc'
  videoSourceName?: string
  videoPreviewUrl?: string
}) {
  if (content.contentType === 'video') {
    return <VideoContentPreview key={videoPreviewUrl ?? content.id} content={content} videoSourceName={videoSourceName} videoPreviewUrl={videoPreviewUrl}/>
  }
  const assetUrl = (id: string) => contentAssetUrl(content.id, id)
  const { renderedBody, embeddedAssets, cover, remainingAssets, articleTheme } = previewContentModel(content, platform)
  const imageNote = content.contentType === 'image-note'
  if (platform === 'wxmp' && !imageNote) {
    return <div className="pub-content-preview-shell pub-content-preview-wechat" data-device={device} data-theme={articleTheme} aria-label="微信公众号文章内容预览">
      <div className="pub-wechat-preview-bar"><span className="pub-wechat-preview-mark" aria-hidden="true"/>微信公众号 · 移动端排版预览</div>
      <article className="pub-wechat-preview-article">
        <h2 className="pub-wechat-preview-title">{content.title || '未填写标题'}</h2>
        <div className="pub-wechat-preview-body ebao-article-reader" data-theme={articleTheme} aria-label="公众号正文预览">
          <ArticleMarkdownPreview body={renderedBody || '暂无正文'} content={content} assetUrl={assetUrl}/>
        </div>
      </article>
      <section className="pub-wechat-preview-metadata" aria-label="公众号草稿独立字段">
        <h3>草稿独立字段</h3>
        <div className="pub-wechat-preview-cover-row">
          {cover ? <AssetPreviewImage className="pub-wechat-preview-cover" src={assetUrl(cover.id)} alt={cover.name}/>
            : <div className="pub-wechat-preview-no-cover">未选封面</div>}
          <div><strong>封面</strong><p>单独用于草稿封面；只有在正文中插入的图片才会出现在文章里。</p></div>
        </div>
        {content.summary && <p className="pub-wechat-preview-summary"><strong>摘要</strong>{content.summary}</p>}
        {remainingAssets.length > 0 && <details className="pub-wechat-preview-unused">
          <summary>{remainingAssets.length} 张素材未插入正文，不会出现在公众号文章里</summary>
          <div className="pub-wechat-preview-unused-grid">{remainingAssets.map(asset =>
            <AssetPreviewImage src={assetUrl(asset.id)} alt={asset.name} key={asset.id}/>)}</div>
        </details>}
      </section>
    </div>
  }
  return <div className={`pub-content-preview-shell${imageNote ? '' : ' ebao-article-reader'}`} data-device={device} data-theme={imageNote ? undefined : platform ? 'native' : articleTheme} aria-label={`${imageNote ? '图文' : '文章'}内容预览`}>
    {imageNote && <ImageNoteCarousel contentId={content.id} assets={content.assets} renderImage={asset =>
      <AssetPreviewImage src={assetUrl(asset.id)} alt={asset.name}/>}/>}
    {!imageNote && <div className="pub-content-preview-kicker">{platform ? `${PLATFORM_LABELS[platform]} · 内容结构预览` : '主稿 · 阅读排版预览'}</div>}
    <h2 className="pub-content-preview-title">{content.title || '未填写标题'}</h2>
    {!imageNote && cover && !embeddedAssets.has(cover.id) && <AssetPreviewImage className="pub-content-preview-cover" src={assetUrl(cover.id)} alt={cover.name}/>}
    {imageNote ? <p className="pub-content-preview-text">{content.body || '暂无正文'}</p>
      : <ArticleMarkdownPreview body={renderedBody || '暂无正文'} content={content} assetUrl={assetUrl}/>}
    {!imageNote && remainingAssets.length > 0 && <details className="pub-content-preview-unused">
      <summary>{remainingAssets.length} 张素材未插入正文，不会显示在文章正文里</summary>
      <div className="pub-content-preview-note-images" aria-label="尚未插入正文的图片素材">{remainingAssets.map(asset =>
        <AssetPreviewImage className="pub-content-preview-image" src={assetUrl(asset.id)} alt={asset.name} key={asset.id}/>)}</div>
    </details>}
    {content.tags.length > 0 && (imageNote || !platform || !['wxmp', 'tt', 'bjh'].includes(platform)) && <p className="pub-content-preview-tags">{content.tags.map(tag => <span key={tag}>#{tag}</span>)}</p>}
  </div>
}
