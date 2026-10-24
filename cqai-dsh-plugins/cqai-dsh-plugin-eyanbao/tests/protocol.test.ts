import { describe, expect, it } from 'vitest'
import { parseRunRequest, safeFileStem } from '../src/protocol.ts'

describe('research requests', () => {
  it('normalizes valid input and preserves optional filters', () => {
    expect(parseRunRequest({
      prompt: '  研究生成式 AI 对学术写作的影响  ',
      kind: 'thesis',
      degree: 'doctoral',
      discipline: ' 教育学 ',
      language: 'zh',
      literatureScope: 'foreign',
      citationStyle: 'gb7714',
      sourceCount: 18,
      yearFrom: 2020,
      author: ' 李四 ',
      affiliation: ' 示例大学 ',
      journalName: ' 教育研究 ',
    })).toEqual({
      prompt: '研究生成式 AI 对学术写作的影响',
      kind: 'thesis',
      degree: 'doctoral',
      discipline: '教育学',
      language: 'zh',
      literatureScope: 'foreign',
      citationStyle: 'gb7714',
      sourceCount: 18,
      yearFrom: 2020,
      author: '李四',
      affiliation: '示例大学',
      journalName: '教育研究',
    })
  })

  it('rejects invalid task, count, and short prompts', () => {
    expect(() => parseRunRequest({ prompt: 'abc', kind: 'search' })).toThrow('四个字')
    expect(() => parseRunRequest({ prompt: '有效研究主题', kind: 'unknown' })).toThrow('任务类型')
    expect(() => parseRunRequest({ prompt: '有效研究主题', kind: 'search', sourceCount: 50 })).toThrow('3 到 30')
    expect(() => parseRunRequest({ prompt: '有效研究主题', kind: 'search', literatureScope: 'other' })).toThrow('文献范围')
  })

  it('removes path-invalid characters from export names', () => {
    expect(safeFileStem('AI: 论文/综述?*')).toBe('AI- 论文-综述--')
  })
})
