import { describe, expect, it } from 'vitest'
import { canOpenTarget, openTargetNotice } from '../src/client/history-target.ts'

describe('publisher history target opening', () => {
  it('permits old and settled records while the queue retains in-flight records', () => {
    expect(canOpenTarget(undefined)).toBe(true)
    expect(canOpenTarget('completed')).toBe(true)
    expect(canOpenTarget('failed')).toBe(true)
    expect(canOpenTarget('unknown')).toBe(true)
    expect(canOpenTarget('queued')).toBe(false)
    expect(canOpenTarget('running')).toBe(false)
  })

  it('tells the user which destination actually opened', () => {
    expect(openTargetNotice('draft')).toContain('平台草稿')
    expect(openTargetNotice('draft-list')).toContain('草稿列表')
    expect(openTargetNotice('content-list')).toContain('内容列表')
    expect(openTargetNotice('backend')).toContain('无法确认专用列表')
    expect(openTargetNotice('review-window', 'completed')).toContain('保留的草稿窗口')
    expect(openTargetNotice('review-window', 'unknown')).toContain('待核查的发布窗口')
    expect(openTargetNotice('review-window')).toContain('保留的平台窗口')
    expect(openTargetNotice('draft-list', 'unknown')).toContain('结果仍待确认')
    expect(openTargetNotice('backend', 'unknown')).toContain('核对平台状态')
    expect(openTargetNotice('draft-list', 'failed')).toContain('执行失败')
    expect(openTargetNotice('review-window', 'unknown')).not.toContain('列表')
    expect(() => openTargetNotice('unknown' as never)).toThrow('平台打开结果无效')
  })
  it('opens Toutiao history without referring to a retained window or result-pending label', () => {
    expect(openTargetNotice('review-window', 'unknown', 'tt')).toBe('已打开头条稿件，请在平台内查看并补齐图片。')
    expect(openTargetNotice('draft-list', 'unknown', 'tt')).toContain('任务未完成')
    expect(openTargetNotice('draft-list', 'unknown', 'tt')).not.toMatch(/保留|待确认/u)
  })
})
