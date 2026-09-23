import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const entry = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
const video = readFileSync(new URL('../src/client/video.tsx', import.meta.url), 'utf8')
const article = readFileSync(new URL('../src/client/content.tsx', import.meta.url), 'utf8')
const history = readFileSync(new URL('../src/client/history.tsx', import.meta.url), 'utf8')

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
    expect(video).toContain("localVideoId: localVideo.id")
    expect(video).toContain('localVideo ? { localVideoId: localVideo.id } : { workId }')
    expect(article).toContain('contentType, contentId: current.id, revision: current.revision')
    expect(video).not.toMatch(/\b(?:file|videoPath|filePath)\s*:/u)
    expect(article).not.toMatch(/\b(?:videoPath|filePath)\s*:/u)
    expect(history).toContain("api('account-open-dashboard', { id: target.accountId })")
  })
})
