import { describe, expect, it } from 'vitest'
import { parseAssistRequest, parseRunRequest, safeFileStem } from '../src/protocol.ts'

describe('research requests', () => {
  it('normalizes valid input and preserves optional filters', () => {
    expect(parseRunRequest({
      prompt: '  研究生成式 AI 对学术写作的影响  ',
      kind: 'thesis',
      degree: 'doctoral',
      discipline: ' 教育学 ',
      language: 'zh',
      literatureScope: 'foreign',
      journalQuality: 'top-preferred',
      databases: ['openalex', 'pubmed', 'scopus'],
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
      journalQuality: 'top-preferred',
      databases: ['openalex', 'pubmed', 'scopus'],
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
    expect(() => parseRunRequest({ prompt: '有效研究主题', kind: 'search', journalQuality: 'other' })).toThrow('期刊层级')
  })

  it('accepts bounded author material separately from the research question', () => {
    const parsed = parseRunRequest({ prompt: '研究写作工具的影响', kind: 'research', researchMaterial: '  访谈材料  ' })
    expect(parsed.prompt).toBe('研究写作工具的影响')
    expect(parsed.researchMaterial).toBe('访谈材料')
    expect(() => parseRunRequest({ prompt: '有效研究主题', kind: 'research', researchMaterial: 'x'.repeat(10001) })).toThrow('10000')
    expect(() => parseRunRequest({ prompt: '有效研究主题', kind: 'research', researchMaterial: {} })).toThrow('必须是文本')
  })

  it('only accepts unique source IDs from a valid review search project', () => {
    const sourceProjectId = '3b5c40a6-8251-4a6f-bda0-70f868b4a8bf'
    expect(parseRunRequest({ prompt: '综述研究主题', kind: 'review', sourceProjectId, selectedSourceIds: ['source-1'] })).toMatchObject({ sourceProjectId, selectedSourceIds: ['source-1'] })
    expect(() => parseRunRequest({ prompt: '综述研究主题', kind: 'review', sourceProjectId, selectedSourceIds: ['source-1', 'source-1'] })).toThrow('重复')
    expect(() => parseRunRequest({ prompt: '综述研究主题', kind: 'review', sourceProjectId: '../bad', selectedSourceIds: ['source-1'] })).toThrow('项目 ID')
    expect(() => parseRunRequest({ prompt: '综述研究主题', kind: 'search', sourceProjectId, selectedSourceIds: ['source-1'] })).toThrow('仅文献综述')
  })

  it('removes path-invalid characters from export names', () => {
    expect(safeFileStem('AI: 论文/综述?*')).toBe('AI- 论文-综述--')
  })

  it('validates AI assist requests', () => {
    expect(parseAssistRequest({
      action: 'method',
      prompt: '研究生成式 AI 对研究生写作的影响',
      kind: 'research',
      degree: 'master',
      discipline: '教育学',
      language: 'zh',
      literatureScope: 'foreign',
      journalQuality: 'top-preferred',
      databases: ['openalex', 'pubmed'],
    })).toMatchObject({
      action: 'method',
      kind: 'research',
      literatureScope: 'foreign',
      journalQuality: 'top-preferred',
      databases: ['openalex', 'pubmed'],
    })
    expect(() => parseAssistRequest({ action: 'unknown', prompt: '有效研究主题', kind: 'search' })).toThrow('AI 辅助类型')
    expect(() => parseAssistRequest({ action: 'refine', prompt: 'abc', kind: 'search' })).toThrow('四个字')
    expect(() => parseAssistRequest({ action: 'refine', prompt: '有效研究主题', kind: 'search', databases: ['unknown'] })).toThrow('文献数据库')
  })
})
