import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactsFor, copyAudioPreview, needsText, permitted, validateContentRequest, validateDraft } from '../src/index.ts'
import { audioPreviewReuseIssue, defaultParams, stageRequirements, type Job } from '../src/protocol.ts'

function draft(params: Record<string, unknown>) {
  return validateDraft({textModel:'',imageModel:'',stopAt:'video',params:{...defaultParams,...params}})
}
function request(remoteAddress: string, method: string, headers: Record<string,string> = {}): IncomingMessage {
  return {socket:{remoteAddress},method,headers:{host:'127.0.0.1:3000',...headers}} as unknown as IncomingMessage
}
function completedPreview(params: Record<string, unknown>, withSubtitle = true): Job {
  return {
    ...draft({video_script:'城市故事',video_source:'local',...params}),
    stopAt:'subtitle',id:'00000000-0000-0000-0000-000000000001',status:'completed',progress:100,
    createdAt:'',updatedAt:'',logs:[],uploads:{material:[]},subtitleProvider:'edge',
    artifacts:[{file:'audio.mp3',name:'audio.mp3',kind:'audio',size:1024},...(withSubtitle?[{file:'subtitle.srt',name:'subtitle.srt',kind:'subtitle' as const,size:100}]:[])],
  }
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
  it('reuses a finished narration and subtitle across a different visual source', () => {
    const preview=completedPreview({})
    const final=draft({video_script:'城市故事',video_source:'openai_image',video_terms:'城市'})
    expect(audioPreviewReuseIssue(preview,final,'edge')).toBeUndefined()
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,video_script:'另一段文案'}},'edge')).toMatch('文案或配音设置已改变')
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,voice_rate:1.2}},'edge')).toMatch('文案或配音设置已改变')
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,subtitle_display_mode:'word_by_word'}},'edge')).toMatch('字幕未生成或字幕设置已改变')
    expect(audioPreviewReuseIssue(preview,final,'whisper')).toMatch('字幕未生成或字幕设置已改变')
    expect(audioPreviewReuseIssue(completedPreview({},false),final,'edge')).toMatch('字幕未生成或字幕设置已改变')
    expect(audioPreviewReuseIssue({...preview,status:'running'},final,'edge')).toMatch('请先完成')
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,subtitle_enabled:false}},'whisper')).toBeUndefined()
    expect(audioPreviewReuseIssue(completedPreview({video_subject:'城市',video_script:''}),final,'edge')).toMatch('请先确认视频文案')
  })
  it('exposes every accepted narration format for playback and reuse', async () => {
    const directory=await mkdtemp(join(tmpdir(),'short-video-audio-'))
    try {
      for (const extension of ['.mp3','.m4a','.wav','.ogg','.flac']) await writeFile(join(directory,`narration${extension}`),'audio')
      expect((await artifactsFor(directory)).filter(item=>item.kind==='audio').map(item=>item.file).sort()).toEqual(
        ['.mp3','.m4a','.wav','.ogg','.flac'].map(extension=>`narration${extension}`).sort(),
      )
    } finally {await rm(directory,{recursive:true,force:true})}
  })
  it('copies confirmed narration and subtitle into the final task without altering the preview', async () => {
    const storage=await mkdtemp(join(tmpdir(),'short-video-preview-'))
    const preview=completedPreview({})
    const source=join(storage,preview.id)
    const target='00000000-0000-0000-0000-000000000002'
    try {
      await mkdir(source)
      await writeFile(join(source,'audio.mp3'),'narration')
      await writeFile(join(source,'subtitle.srt'),'1\n00:00:00,000 --> 00:00:01,000\n城市故事')
      expect(await copyAudioPreview(storage,preview,target,true)).toBe('voice-preview.mp3')
      expect(await readFile(join(storage,target,'voice-preview.mp3'),'utf8')).toBe('narration')
      expect(await readFile(join(storage,target,'subtitle.srt'),'utf8')).toContain('城市故事')
      expect(await readFile(join(source,'audio.mp3'),'utf8')).toBe('narration')
      await rm(join(storage,target),{recursive:true,force:true})
      await rm(join(source,'subtitle.srt'))
      await expect(copyAudioPreview(storage,preview,target,true)).rejects.toThrow()
      expect(await readdir(storage)).toEqual([preview.id])
    } finally {await rm(storage,{recursive:true,force:true})}
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
