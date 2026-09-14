import { expect, it } from 'vitest'
import { uploadKinds, validateUpload } from '../src/uploads.ts'

it('uses pasted text without uploading an unused empty script', () => {
  const options = {title: '测试', text: '粘贴文案', duration: 10, mode: 'digitalhuman' as const, optimize: false, covers: false, studio: false}
  expect(uploadKinds(options)).toEqual(['avatar', 'voice'])
  expect(uploadKinds({...options, text: ' '})).toEqual(['script', 'avatar', 'voice'])
  expect(uploadKinds({...options, mode: 'video'})).toEqual(['video'])
})

it('identifies empty files and directs audio to the digital-human voice field', () => {
  expect(() => validateUpload('script', {name: '稿件.txt', size: 0})).toThrow('稿件.txt')
  expect(() => validateUpload('video', {name: '录音.m4a', size: 1024})).toThrow('参考录音')
  expect(() => validateUpload('voice', {name: '录音.M4A', size: 1024})).not.toThrow()
  expect(() => validateUpload('avatar', {name: '照片.png', size: 51 * 1024 ** 2})).toThrow('过大')
})
