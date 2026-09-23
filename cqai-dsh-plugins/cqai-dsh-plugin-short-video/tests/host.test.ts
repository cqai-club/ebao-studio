import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { needsText, permitted, validateDraft } from '../src/index.ts'
import { defaultParams } from '../src/protocol.ts'

function draft(params: Record<string, unknown>) {
  return validateDraft({textModel:'',imageModel:'',stopAt:'video',params:{...defaultParams,...params}})
}
function request(remoteAddress: string, method: string, headers: Record<string,string> = {}): IncomingMessage {
  return {socket:{remoteAddress},method,headers:{host:'127.0.0.1:3000',...headers}} as unknown as IncomingMessage
}
describe('short-video local job boundary', () => {
  it('runs manual local content without asking an LLM and needs one for missing script', () => {
    expect(needsText(draft({video_subject:'城市',video_script:'已写好的旁白',video_source:'local'}))).toBe(false)
    expect(needsText(draft({video_subject:'城市',video_script:'',video_source:'local'}))).toBe(true)
  })
  it('rejects unimplemented paid video sources and unknown parameters before billing', () => {
    expect(() => draft({video_subject:'城市',video_source:'wavespeed'})).toThrow('素材来源暂不可用')
    expect(() => draft({video_subject:'城市',unknown_setting:true})).toThrow('不支持的参数')
  })
  it('restricts mutations to same-origin loopback requests with the plugin header', () => {
    expect(permitted(request('127.0.0.1','POST',{'x-short-video':'1'}))).toBe(true)
    expect(permitted(request('127.0.0.1','POST'))).toBe(false)
    expect(permitted(request('192.168.1.2','POST',{'x-short-video':'1'}))).toBe(false)
    expect(permitted(request('127.0.0.1','POST',{origin:'https://example.com','x-short-video':'1'}))).toBe(false)
    expect(permitted(request('127.0.0.1','POST',{host:'attacker.test:3000',origin:'http://attacker.test:3000','x-short-video':'1'}))).toBe(false)
  })
})
