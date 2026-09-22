import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

describe('publisher client contract', () => {
  it('registers separate account and submission panels', () => {
    expect(source).toContain("const ACCOUNTS_PANEL = 'cqai-publisher-accounts'")
    expect(source).toContain("const PUBLISH_PANEL = 'cqai-publisher-submit'")
    expect(source).toContain("label: '多平台账号管理'")
    expect(source).toContain("label: '多平台发布'")
  })

  it('never polls Worker execution state or reports acceptance as success', () => {
    expect(source).not.toContain('setInterval(')
    expect(source).not.toContain("api('status'")
    expect(source).not.toContain("api('jobs'")
    expect(source).not.toContain("api('history'")
    expect(source).toContain("setNotice('已提交，请稍后到平台后台确认。')")
    expect(source).toContain('提交只表示任务已被本机发布队列接受，不代表平台发布成功。')
  })

  it('submits only a work id and exposes account-scoped dashboard actions', () => {
    expect(source).toContain('workId, title: title.trim()')
    expect(source).not.toMatch(/\b(?:file|videoPath|filePath)\s*:/u)
    expect(source).toContain("api('account-open-dashboard', { id: target.accountId })")
  })
})
