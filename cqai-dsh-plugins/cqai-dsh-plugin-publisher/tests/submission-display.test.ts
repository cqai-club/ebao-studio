import { describe, expect, it } from 'vitest'
import type { PublisherSubmission } from '../src/protocol.ts'
import { displayArticleWarnings, projectSubmissionForDisplay, submissionStateLabel } from '../src/submission-display.ts'

function submission(platform: 'tt' | 'bjh' = 'tt', state: PublisherSubmission['state'] = 'unknown'): PublisherSubmission {
  return { id: 'job', contentId: 'draft', contentType: 'article', title: '标题', createdAt: '', mode: 'draft', state,
    targets: [{ accountId: 'account', platform, accountName: '账号' }],
    message: 'Waiting failed: 45000ms exceeded；窗口已保留；账号已锁定',
    adjustments: [{ accountId: 'account', messages: [
      '头条文章适配器暂不写入摘要；摘要仍保留在本地草稿',
      '该平台文章适配器暂不写入标签；标签仍保留在本地草稿',
      '头条正文已保留 2 处图片占位，请在草稿窗口手动上传',
      '头条封面不会自动上传，请在草稿窗口手动设置',
    ] }],
  }
}

describe('Toutiao submission display compatibility', () => {
  it.each(['unknown', 'failed'] as const)('simplifies a technical timeout without changing its %s state or stored record', state => {
    const original = submission('tt', state)
    const stored = JSON.stringify(original)
    const display = projectSubmissionForDisplay(original)
    expect(display.state).toBe(state)
    expect(display.message).toBe('操作超时，任务未完成')
    expect(display.adjustments?.[0]?.messages).toEqual([
      '头条正文已保留 2 处图片占位，请从发布历史打开草稿手动补图',
      '头条封面需手动设置，请从发布历史打开草稿',
    ])
    expect(JSON.stringify(original)).toBe(stored)
    expect(JSON.stringify(display)).not.toMatch(/Waiting failed|窗口|锁定|摘要|标签/u)
    expect(submissionStateLabel(display)).toBe(state === 'unknown' ? '未完成' : '执行失败')
  })

  it('keeps unknown uncertainty visible without declaring the task successful', () => {
    const display = projectSubmissionForDisplay({ ...submission(), message: '结果待确认；窗口保留' })
    expect(display.state).toBe('unknown')
    expect(submissionStateLabel(display)).toBe('未完成')
    expect(display.message).toBe('任务未完成，请从发布历史打开平台稿件核对')
  })

  it('removes only obsolete retention clauses from a completed Toutiao draft', () => {
    const display = projectSubmissionForDisplay({ ...submission('tt', 'completed'),
      message: '头条草稿已保存；请在保留的头条窗口打开草稿；账号已锁定；关闭前该账号不能再次提交',
    })
    expect(display.state).toBe('completed')
    expect(display.message).toBe('头条草稿已保存')
    expect(display.adjustments?.[0]?.messages.join()).toContain('从发布历史打开草稿')
  })

  it('leaves other platform messages, states and skipped-field notices unchanged', () => {
    const original = submission('bjh')
    expect(projectSubmissionForDisplay(original)).toEqual(original)
    expect(submissionStateLabel(original)).toBe('结果待确认')
  })

  it('filters target-specific notices even in a mixed platform submission', () => {
    const original = submission()
    original.targets.push({ accountId: 'bjh', platform: 'bjh', accountName: '百家号' })
    original.adjustments!.push({ accountId: 'bjh', messages: ['该平台文章适配器暂不写入标签；标签仍保留在本地草稿'] })
    const display = projectSubmissionForDisplay(original)
    expect(display.message).toBe(original.message)
    expect(display.adjustments?.[1]).toEqual(original.adjustments?.[1])
    expect(display.adjustments?.[0]?.messages).toHaveLength(2)
  })

  it('silences old Toutiao preflight notices while retaining other platform warnings', () => {
    expect(displayArticleWarnings([
      '头条：独立摘要不会写入头条文章', '头条：文章标签暂不写入该平台',
      '百家号：文章标签暂不写入该平台',
      '头条：正文图片会在原位置保留占位，请在头条草稿中手动上传',
    ])).toEqual([
      '百家号：文章标签暂不写入该平台',
      '头条：正文图片会在原位置保留占位，请从发布历史打开头条草稿手动补图',
    ])
  })
})
