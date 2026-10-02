import {expect, it} from 'vitest'
import {draftDefaultPatch} from '../../cqai-dsh-plugin-short-video/src/client/draft-defaults.ts'

it('preserves explicitly edited fields when late shared defaults arrive and adapts a supported voice', () => {
  const defaults = {aspect: '9:16' as const, edgeVoiceId: 'zh-CN-YunxiNeural'}
  expect(draftDefaultPatch(defaults, new Set(['video_aspect']), ['zh-CN-YunxiNeural-Male'])).toEqual({voice_name: 'zh-CN-YunxiNeural-Male'})
  expect(draftDefaultPatch(defaults, new Set(['video_aspect', 'voice_name']))).toEqual({})
  expect(draftDefaultPatch(defaults, new Set())).toEqual({video_aspect: '9:16', voice_name: 'zh-CN-YunxiNeural-Male'})
})
