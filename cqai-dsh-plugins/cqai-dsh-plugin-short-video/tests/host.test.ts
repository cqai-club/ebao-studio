import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { needsText, permitted, validateContentRequest, validateDraft } from '../src/index.ts'
import { defaultParams, stageRequirements } from '../src/protocol.ts'

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
  it('prepares audio and subtitles without visual materials, image model, or background music', () => {
    for (const stopAt of ['audio','subtitle'] as const) {
      const local = {...draft({video_script:'已写好的旁白',video_source:'local',bgm_type:'custom'}),stopAt}
      expect(stageRequirements(local)).toEqual({imageModel:false,materialUpload:false,backgroundMusicUpload:false})
      expect(needsText(local)).toBe(false)
      const generated = {...draft({video_script:'已写好的旁白',video_terms:'城市',video_source:'openai_image',bgm_type:'custom'}),stopAt}
      expect(stageRequirements(generated)).toEqual({imageModel:false,materialUpload:false,backgroundMusicUpload:false})
      expect(needsText(generated)).toBe(false)
    }
    expect(needsText({...draft({video_script:'已写好的旁白',video_source:'openai_image'}),stopAt:'audio'})).toBe(true)
  })
  it('requires visual and music inputs only when execution reaches those stages', () => {
    const local = draft({video_script:'已写好的旁白',video_source:'local',bgm_type:'custom'})
    expect(stageRequirements({...local,stopAt:'materials'})).toEqual({imageModel:false,materialUpload:true,backgroundMusicUpload:false})
    expect(stageRequirements(local)).toEqual({imageModel:false,materialUpload:true,backgroundMusicUpload:true})
    const generated = draft({video_script:'已写好的旁白',video_terms:'城市',video_source:'openai_image',bgm_type:'custom'})
    expect(stageRequirements({...generated,stopAt:'materials'})).toEqual({imageModel:true,materialUpload:false,backgroundMusicUpload:false})
    expect(stageRequirements(generated)).toEqual({imageModel:true,materialUpload:false,backgroundMusicUpload:true})
  })
  it('rejects unimplemented paid video sources and unknown parameters before billing', () => {
    expect(() => draft({video_subject:'城市',video_source:'wavespeed'})).toThrow('素材来源暂不可用')
    expect(() => draft({video_subject:'城市',unknown_setting:true})).toThrow('不支持的参数')
  })
  it('requires a theme for script generation and an editable script for keyword regeneration', () => {
    const base = {textModel:'cqai-model',imageModel:'',stopAt:'video',params:{...defaultParams}}
    expect(() => validateContentRequest({action:'script',draft:{...base,params:{...base.params,video_script:'自写文案'}}})).toThrow('请先填写视频主题')
    expect(() => validateContentRequest({action:'terms',draft:{...base,params:{...base.params,video_subject:'城市'}}})).toThrow('请先填写视频文案')
    expect(validateContentRequest({action:'script',draft:{...base,params:{...base.params,video_subject:'城市'}}}).action).toBe('script')
    expect(validateContentRequest({action:'terms',draft:{...base,params:{...base.params,video_script:'已修改的文案'}}}).draft.params.video_script).toBe('已修改的文案')
  })
  it('restricts mutations to same-origin loopback requests with the plugin header', () => {
    expect(permitted(request('127.0.0.1','POST',{'x-short-video':'1'}))).toBe(true)
    expect(permitted(request('127.0.0.1','POST'))).toBe(false)
    expect(permitted(request('192.168.1.2','POST',{'x-short-video':'1'}))).toBe(false)
    expect(permitted(request('127.0.0.1','POST',{origin:'https://example.com','x-short-video':'1'}))).toBe(false)
    expect(permitted(request('127.0.0.1','POST',{host:'attacker.test:3000',origin:'http://attacker.test:3000','x-short-video':'1'}))).toBe(false)
  })
})
