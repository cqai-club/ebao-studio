import {describe, expect, it} from 'vitest'
import {aggregateVideoAvailable, preserveSuppressedOrder, projectVideoEntries} from '../../cqai-dsh-plugin-desktop-presentation/src/client/video-navigation.ts'

describe('video entry projection', () => {
  it('requires an actual usable aggregate and restores three legacy cards after disable', () => {
    const entries = ['cqai-video', 'cqai-short-video', 'cqai-talkcraft', 'cqai-ejianbao', 'other'].map(id => ({id}))
    const main = new Set(entries.map(item => item.id))
    expect(aggregateVideoAvailable(main, new Set(['cqai-video']))).toBe(false)
    expect(projectVideoEntries(entries, false).map(item => item.id)).toEqual(['cqai-video', 'cqai-short-video', 'cqai-talkcraft', 'other'])
    expect(aggregateVideoAvailable(main, new Set(['cqai-ejianbao']))).toBe(true)
    expect(projectVideoEntries(entries, true).map(item => item.id)).toEqual(['cqai-ejianbao', 'other'])
  })
  it('keeps suppressed child order when reordering the aggregate home projection', () => {
    expect(preserveSuppressedOrder(['image', 'cqai-video', 'cqai-short-video', 'cqai-ejianbao', 'other'], ['other', 'cqai-ejianbao', 'image'])).toEqual(['other', 'cqai-video', 'cqai-short-video', 'cqai-ejianbao', 'image'])
  })
})
