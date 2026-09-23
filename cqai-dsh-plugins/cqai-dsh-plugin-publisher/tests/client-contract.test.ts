import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const entry = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
const video = readFileSync(new URL('../src/client/video.tsx', import.meta.url), 'utf8')
const article = readFileSync(new URL('../src/client/content.tsx', import.meta.url), 'utf8')
const history = readFileSync(new URL('../src/client/history.tsx', import.meta.url), 'utf8')
const shared = readFileSync(new URL('../src/client/shared.tsx', import.meta.url), 'utf8')

describe('unified publisher client contract', () => {
  it('registers one panel with internal navigation', () => {
    expect(entry).toContain("const PUBLISHER_PANEL = 'cqai-publisher'")
    expect(entry).toContain("label: '多平台发布'")
    expect(entry).not.toContain('cqai-publisher-accounts')
    expect(entry).not.toContain('cqai-publisher-submit')
    expect(entry).toContain("'发布历史'")
    expect(entry).toContain("'平台账号管理'")
    expect(entry).toContain('<ContentEditor contentType="article" active=')
    expect(entry).toContain('<ContentEditor contentType="image-note" active=')
    expect(entry).toContain('<VideoPage active=')
  })

  it('keeps submissions separate from execution results', () => {
    const source = [entry, video, article, history].join('\n')
    expect(source).not.toContain('setInterval(')
    expect(source).not.toContain("api('jobs'")
    expect(source).not.toContain("api('status'")
    expect(source).toContain("showSuccess('已提交，请稍后到平台后台确认。')")
    expect(entry).toContain('<PublisherTipsProvider>')
    expect(history).toContain('不代表平台最终发布成功')
  })

  it('passes only IDs from browser forms and retains account scoped dashboards', () => {
    expect(video).toContain("api<PublisherLocalVideo | null>('local-video-select', {})")
    expect(video).toContain('localVideoId: selected.id')
    expect(video).toContain("contentType: 'video', contentId: current.id, revision: current.revision")
    expect(video).toContain('<DraftToolbar contents={contents}')
    expect(video).toContain("api<PublisherContent>('contents', { contentType: 'video' })")
    expect(video).toContain("api<PublisherContent>('content-copy', { id: current.id })")
    expect(article).toContain('contentType, contentId: current.id, revision: current.revision')
    expect(video).not.toMatch(/\b(?:file|videoPath|filePath)\s*:/u)
    expect(article).not.toMatch(/\b(?:videoPath|filePath)\s*:/u)
    expect(history).toContain("api('account-open-dashboard', { id: target.accountId })")
  })

  it('keeps article and image-note editing local, preflighted and safely previewed', () => {
    expect(article).toContain('contentSubmissionError(current, selectedAccounts, capabilities, mode)')
    expect(article).toContain('accountPlatforms.map(platform =>')
    expect(article).toContain('selectedContentAccounts(contentType, accounts, selection)')
    expect(article).toContain('unavailableTargets.length === 0')
    expect(article).toContain('idPrefix={contentType}')
    expect(shared).toContain('pub-target-${idPrefix}-${platform}')
    expect(article).toContain('onDrop={event =>')
    expect(article).toContain('setServerDraft(current)')
    expect(article).toContain('插入正文')
    expect(article).toContain('ebao-asset://${assetId}')
    expect(article).toContain('runtimeCapability && !runtimeCapability.supported')
    expect(article).toContain('请更新 Helper 并完全重启应用')
    expect(article).not.toContain('所选平台的当前提交方式尚未开放')
    expect(article).not.toContain('dangerouslySetInnerHTML')
  })
})
