import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactPath, artifactsFor, copyAudioPreview, needsText, permitted, prepareJobFolder, storedMaterialArtifactsFor, validateContentRequest, validateDraft, validateSubtitleSrt } from '../src/index.ts'
import { audioPreviewReuseIssue, defaultParams, defaultSettings, groupJobsByWorkflow, materialKeyIssue, materialPreviewReuseIssue, stageRequirements, subtitlePreviewReuseIssue, workflowAudioPreview, workflowDisplayJob, workflowDraft, workflowIdForJob, workflowIdForNewJob, type Job } from '../src/protocol.ts'

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
  it('opens task outputs and the actual material location while a job is running', async () => {
    const root=await mkdtemp(join(tmpdir(),'short-video-folders-'))
    const job={...completedPreview({video_source:'pixabay'}),status:'running' as const}
    try {
      expect(await prepareJobFolder(root,job,'task')).toBe(await realpath(join(root,'storage','tasks',job.id)))
      expect(await prepareJobFolder(root,job,'materials')).toBe(await realpath(join(root,'storage','cache_videos')))
      expect(await prepareJobFolder(root,{...job,params:{...job.params,video_source:'local'}},'materials')).toBe(await realpath(join(root,'storage','local_videos')))
      for(const video_source of ['cqai_video','openai_image'])expect(await prepareJobFolder(root,{...job,params:{...job.params,video_source}},'materials')).toBe(await realpath(join(root,'storage','tasks',job.id)))
      await expect(prepareJobFolder(root,job,'../../outside')).rejects.toThrow('文件夹类型无效')
      await expect(prepareJobFolder(root,{...job,id:'../outside'},'task')).rejects.toThrow('任务 ID 无效')
    } finally {await rm(root,{recursive:true,force:true})}
  })
  it('rejects a linked folder outside the data root before creating or opening it', async () => {
    const root=await mkdtemp(join(tmpdir(),'short-video-folder-boundary-'))
    const outside=await mkdtemp(join(tmpdir(),'short-video-folder-outside-'))
    const job=completedPreview({video_source:'pixabay'})
    try {
      await mkdir(join(root,'storage'))
      await symlink(outside,join(root,'storage','tasks'),process.platform==='win32'?'junction':'dir')
      await symlink(outside,join(root,'storage','cache_videos'),process.platform==='win32'?'junction':'dir')
      await expect(prepareJobFolder(root,job,'task')).rejects.toThrow('超出短视频数据目录')
      await expect(prepareJobFolder(root,job,'materials')).rejects.toThrow('超出短视频数据目录')
      expect(await readdir(outside)).toEqual([])
    } finally {await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
  })
  it('counts failed previews, retries, and the final render as one workflow', () => {
    const workflowId='00000000-0000-0000-0000-000000000001'
    const failed={...completedPreview({video_subject:'城市故事'}),id:workflowId,workflowId,status:'failed' as const,createdAt:'2026-09-24T01:00:00Z'}
    const retry={...failed,id:'00000000-0000-0000-0000-000000000002',status:'completed' as const,createdAt:'2026-09-24T02:00:00Z'}
    const final={...retry,id:'00000000-0000-0000-0000-000000000003',stopAt:'video' as const,status:'failed' as const,audioPreviewJobId:retry.id,createdAt:'2026-09-24T03:00:00Z'}
    const separate={...retry,id:'00000000-0000-0000-0000-000000000004',workflowId:'00000000-0000-0000-0000-000000000004',createdAt:'2026-09-24T04:00:00Z'}
    const groups=groupJobsByWorkflow([failed,retry,final,separate])
    expect(groups).toHaveLength(2)
    expect(groups.find(group=>group.id===workflowId)?.jobs.map(job=>job.id)).toEqual([final.id,retry.id,failed.id])
    expect(groups.find(group=>group.id===workflowId)?.latest.status).toBe('failed')
    expect(workflowDisplayJob(groupJobsByWorkflow([failed,{...retry,status:'running'},final])[0]).status).toBe('running')
    expect(groupJobsByWorkflow([failed,retry,{...final,status:'completed'}])).toHaveLength(1)
  })
  it('groups legacy render jobs by their preview link without merging unrelated jobs', () => {
    const preview=completedPreview({video_subject:'城市故事'})
    const final={...preview,id:'00000000-0000-0000-0000-000000000002',stopAt:'video' as const,audioPreviewJobId:preview.id,createdAt:'2026-09-24T02:00:00Z'}
    const unrelated={...preview,id:'00000000-0000-0000-0000-000000000003',createdAt:'2026-09-24T03:00:00Z'}
    const jobs=[preview,final,unrelated]
    expect(workflowIdForJob(final,new Map(jobs.map(job=>[job.id,job])))).toBe(preview.id)
    expect(groupJobsByWorkflow(jobs).map(group=>group.jobs.length)).toEqual([1,2])
    const byId=new Map(jobs.map(job=>[job.id,job]))
    expect(workflowIdForNewJob('00000000-0000-0000-0000-000000000004',undefined,preview,byId)).toBe(preview.id)
    expect(workflowIdForNewJob('00000000-0000-0000-0000-000000000004',preview.id,undefined,byId)).toBe(preview.id)
    expect(()=>workflowIdForNewJob('00000000-0000-0000-0000-000000000004',unrelated.id,preview,byId)).toThrow('不属于当前制作流程')
    expect(()=>workflowIdForNewJob('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005',undefined,byId)).toThrow('找不到制作流程')
    expect(workflowIdForNewJob('00000000-0000-0000-0000-000000000004',undefined,undefined,byId)).toBe('00000000-0000-0000-0000-000000000004')
  })
  it('restores the latest workflow settings and generated text across failed stages', () => {
    const preview={...completedPreview({video_subject:'城市',video_script:'第一版文案'}),workflowId:'00000000-0000-0000-0000-000000000001',createdAt:'2026-09-24T01:00:00Z'}
    const failed:Job={...preview,id:'00000000-0000-0000-0000-000000000002',stopAt:'video',status:'failed',createdAt:'2026-09-24T02:00:00Z',params:{...preview.params,video_script:'第一版文案',video_terms:'',video_source:'pexels'},state:{progress:40},artifacts:[]}
    const group=groupJobsByWorkflow([preview,failed])[0]
    const restored=workflowDraft(group,new Map([[failed.id,{script:'第一版文案',search_terms:['城市夜景','街道']}]]))
    expect(restored.params.video_source).toBe('pexels')
    expect(restored.params.video_script).toBe('第一版文案')
    expect(restored.params.video_terms).toBe('城市夜景, 街道')
    expect(restored.stopAt).toBe('video')
    expect(workflowAudioPreview(group,restored)?.id).toBe(preview.id)
    expect(workflowAudioPreview(group,{...restored,params:{...restored.params,video_script:'新文案'}})).toBeUndefined()
  })
  it('keeps visual choices when the latest stage is an audio retry', () => {
    const rendered:Job={...completedPreview({video_script:'旧文案',video_terms:'旧关键词',video_source:'pexels'}),id:'00000000-0000-0000-0000-000000000003',workflowId:'00000000-0000-0000-0000-000000000001',stopAt:'video',imageModel:'image-model',createdAt:'2026-09-24T01:00:00Z'}
    const retry:Job={...completedPreview({video_script:'新文案',video_terms:'',video_source:'local'}),id:'00000000-0000-0000-0000-000000000004',workflowId:rendered.workflowId,stopAt:'audio',createdAt:'2026-09-24T02:00:00Z'}
    const group=groupJobsByWorkflow([rendered,retry])[0]
    const restored=workflowDraft(group)
    expect(restored.params.video_source).toBe('pexels')
    expect(restored.params.video_terms).toBe('旧关键词')
    expect(restored.params.video_script).toBe('新文案')
    expect(restored.imageModel).toBe('image-model')
    expect(workflowAudioPreview(group,restored)?.id).toBe(retry.id)
  })
  it('runs manual local content without asking an LLM and needs one for missing script', () => {
    expect(needsText(draft({video_subject:'城市',video_script:'已写好的旁白',video_source:'local'}))).toBe(false)
    expect(needsText(draft({video_subject:'城市',video_script:'',video_source:'local'}))).toBe(true)
  })
  it('prepares audio without visual materials, image model, or background music', () => {
    for (const stopAt of ['audio'] as const) {
      const local = {...draft({video_script:'已写好的旁白',video_source:'local',bgm_type:'custom'}),stopAt}
      expect(stageRequirements(local)).toEqual({imageModel:false,videoModel:false,materialUpload:false,backgroundMusicUpload:false})
      expect(needsText(local)).toBe(false)
      const generated = {...draft({video_script:'已写好的旁白',video_terms:'城市',video_source:'openai_image',bgm_type:'custom'}),stopAt}
      expect(stageRequirements(generated)).toEqual({imageModel:false,videoModel:false,materialUpload:false,backgroundMusicUpload:false})
      expect(needsText(generated)).toBe(false)
    }
    expect(needsText({...draft({video_script:'已写好的旁白',video_source:'openai_image'}),stopAt:'audio'})).toBe(false)
  })
  it('requires visual and music inputs only when execution reaches those stages', () => {
    const local = draft({video_script:'已写好的旁白',video_source:'local',bgm_type:'custom'})
    expect(stageRequirements({...local,stopAt:'materials'})).toEqual({imageModel:false,videoModel:false,materialUpload:true,backgroundMusicUpload:false})
    expect(stageRequirements(local)).toEqual({imageModel:false,videoModel:false,materialUpload:true,backgroundMusicUpload:true})
    const generated = draft({video_script:'已写好的旁白',video_terms:'城市',video_source:'openai_image',bgm_type:'custom'})
    expect(stageRequirements({...generated,stopAt:'materials'})).toEqual({imageModel:true,videoModel:false,materialUpload:false,backgroundMusicUpload:false})
    expect(stageRequirements({...generated,stopAt:'subtitle'})).toEqual({imageModel:false,videoModel:false,materialUpload:false,backgroundMusicUpload:false})
    expect(stageRequirements(generated)).toEqual({imageModel:true,videoModel:false,materialUpload:false,backgroundMusicUpload:true})
    const video = draft({video_script:'已写好的旁白',video_terms:'城市',video_source:'cqai_video'})
    expect(stageRequirements({...video,stopAt:'subtitle'}).videoModel).toBe(false)
    expect(stageRequirements({...video,stopAt:'subtitle',params:{...video.params,audio_source:'video_original'}}).videoModel).toBe(true)
    expect(stageRequirements(video).videoModel).toBe(true)
  })
  it('asks for the selected stock API key before starting visual material work', () => {
    for (const [source, key, name] of [
      ['pexels', 'pexelsConfigured', 'Pexels'],
      ['pixabay', 'pixabayConfigured', 'Pixabay'],
      ['coverr', 'coverrConfigured', 'Coverr'],
    ] as const) {
      const job = draft({video_script:'已写好的旁白',video_source:source})
      expect(materialKeyIssue(job, defaultSettings)).toContain(`${name} API Key`)
      expect(materialKeyIssue({...job,stopAt:'subtitle'}, defaultSettings)).toBeUndefined()
      expect(materialKeyIssue(job, {...defaultSettings,[key]:true})).toBeUndefined()
      expect(materialKeyIssue({...job,stopAt:'audio'}, defaultSettings)).toBeUndefined()
    }
    expect(materialKeyIssue(draft({video_script:'已写好的旁白',video_source:'local'}), defaultSettings)).toBeUndefined()
  })
  it('reuses a finished narration and subtitle across a different visual source', () => {
    const preview=completedPreview({})
    const final=draft({video_script:'城市故事',video_source:'openai_image',video_terms:'城市'})
    expect(audioPreviewReuseIssue(preview,final,'edge')).toBeUndefined()
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,video_script:'另一段文案'}},'edge')).toMatch('文案或配音设置已改变')
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,voice_rate:1.2}},'edge')).toMatch('文案或配音设置已改变')
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,subtitle_display_mode:'word_by_word'}},'edge')).toMatch('缺少可复用时间轴')
    expect(audioPreviewReuseIssue(preview,final,'whisper')).toBeUndefined()
    expect(audioPreviewReuseIssue(completedPreview({},false),final,'edge')).toMatch('缺少可复用时间轴')
    expect(audioPreviewReuseIssue({...preview,status:'running'},final,'edge')).toMatch('请先完成')
    expect(audioPreviewReuseIssue(preview,{...final,params:{...final.params,subtitle_enabled:false}},'whisper')).toBeUndefined()
    expect(audioPreviewReuseIssue(completedPreview({video_subject:'城市',video_script:''}),final,'edge')).toMatch('请先确认视频文案')
    const audioPreview={...preview,stopAt:'audio' as const,artifacts:preview.artifacts.filter(item=>item.kind==='audio'),voiceTimingAvailable:true}
    expect(audioPreviewReuseIssue(audioPreview,final,'edge')).toBeUndefined()
    expect(audioPreviewReuseIssue(audioPreview,{...final,params:{...final.params,subtitle_display_mode:'word_by_word'}},'edge')).toBeUndefined()
    const uploadedPreview={...audioPreview,voiceTimingAvailable:false,uploads:{material:[],audio:'narration.wav'}}
    expect(audioPreviewReuseIssue(uploadedPreview,final,'edge')).toMatch('选用 Whisper')
    expect(audioPreviewReuseIssue(uploadedPreview,final,'whisper')).toBeUndefined()
    expect(audioPreviewReuseIssue(uploadedPreview,{...final,stopAt:'materials'},'edge')).toBeUndefined()
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
  it('lists CQAI generated clips as material artifacts for history playback', async () => {
    const directory=await mkdtemp(join(tmpdir(),'short-video-materials-'))
    try {
      await mkdir(join(directory,'cqai-materials'))
      await writeFile(join(directory,'cqai-materials','clip-0.mp4'),'video')
      await writeFile(join(directory,'cqai-materials','notes.txt'),'ignore')
      expect((await artifactsFor(directory)).filter(item=>item.kind==='material')).toEqual([
        {file:'cqai-materials/clip-0.mp4',name:'clip-0.mp4',size:5,kind:'material'},
      ])
    } finally {await rm(directory,{recursive:true,force:true})}
  })
  it('restores only files referenced by a task from cache or local uploads', async () => {
    const root=await mkdtemp(join(tmpdir(),'short-video-saved-materials-'))
    const job=completedPreview({video_source:'pexels'})
    try {
      await mkdir(join(root,'storage','tasks',job.id),{recursive:true})
      await mkdir(join(root,'storage','cache_videos'),{recursive:true})
      await mkdir(join(root,'storage','local_videos'),{recursive:true})
      await writeFile(join(root,'storage','cache_videos','stock.mp4'),'stock')
      await writeFile(join(root,'storage','cache_videos','unlisted.mp4'),'other')
      await writeFile(join(root,'storage','local_videos','upload.png'),'image')
      await writeFile(join(root,'storage','tasks',job.id,'script.json'),JSON.stringify({material_sources:[{local_file:'stock.mp4'},{local_file:'../unlisted.mp4'}]}))
      const stock=storedMaterialArtifactsFor(root,job)
      expect(stock.map(item=>item.file)).toEqual(['saved-materials/cache/stock.mp4'])
      expect(artifactPath(root,{...job,artifacts:stock},stock[0].file)).toBe(await realpath(join(root,'storage','cache_videos','stock.mp4')))
      expect(()=>artifactPath(root,{...job,artifacts:stock},'saved-materials/cache/unlisted.mp4')).toThrow('文件不在任务产物中')
      const uploaded={...job,params:{...job.params,video_source:'local'},uploads:{material:['upload.png']}}
      const local=storedMaterialArtifactsFor(root,uploaded)
      expect(local.map(item=>item.file)).toEqual(['saved-materials/local/upload.png'])
      expect(artifactPath(root,{...uploaded,artifacts:local},local[0].file)).toBe(await realpath(join(root,'storage','local_videos','upload.png')))
    } finally {await rm(root,{recursive:true,force:true})}
  })
  it('copies confirmed narration and subtitle into the final task without altering the preview', async () => {
    const storage=await mkdtemp(join(tmpdir(),'short-video-preview-'))
    const preview=completedPreview({})
    const source=join(storage,preview.id)
    const target='00000000-0000-0000-0000-000000000002'
    try {
      await mkdir(source)
      await mkdir(join(source,'.private'))
      await writeFile(join(source,'audio.mp3'),'narration')
      await writeFile(join(source,'subtitle.srt'),'1\n00:00:00,000 --> 00:00:01,000\n城市故事')
      await writeFile(join(source,'.private','voice-timing.json'),'[{"offset":0,"duration":10000000,"text":"城市故事"}]')
      expect(await copyAudioPreview(storage,{...preview,voiceTimingAvailable:true},target,true)).toBe('voice-preview.mp3')
      expect(await readFile(join(storage,target,'voice-preview.mp3'),'utf8')).toBe('narration')
      expect(await readFile(join(storage,target,'subtitle.srt'),'utf8')).toContain('城市故事')
      expect(await readFile(join(storage,target,'.private','voice-timing.json'),'utf8')).toContain('城市故事')
      expect(await readFile(join(source,'audio.mp3'),'utf8')).toBe('narration')
      await rm(join(storage,target),{recursive:true,force:true})
      await rm(join(source,'subtitle.srt'))
      await expect(copyAudioPreview(storage,{...preview,voiceTimingAvailable:true},target,true)).rejects.toThrow()
      expect(await readdir(storage)).toEqual([preview.id])
    } finally {await rm(storage,{recursive:true,force:true})}
  })
  it('rejects unimplemented paid video sources and unknown parameters before billing', () => {
    expect(() => draft({video_subject:'城市',video_source:'wavespeed'})).toThrow('素材来源暂不可用')
    expect(draft({video_subject:'城市',video_source:'cqai_video'}).params.video_source).toBe('cqai_video')
    expect(() => draft({video_subject:'城市',unknown_setting:true})).toThrow('不支持的参数')
  })
  it('validates the sound source and paid clip budget before creating a job', () => {
    expect(draft({video_subject:'城市',video_source:'cqai_video'}).params.audio_source).toBe('tts')
    expect(draft({video_subject:'城市',video_source:'cqai_video',audio_source:'video_original'}).params.audio_source).toBe('video_original')
    expect(() => draft({video_subject:'城市',video_source:'local',audio_source:'video_original'})).toThrow('只有 CQAI')
    expect(() => draft({video_subject:'城市',video_source:'cqai_video',target_duration_seconds:500,video_clip_duration:5,video_count:2})).toThrow('超过 100')
  })
  it('reuses only matching paid materials and soundtrack-aligned subtitles', () => {
    const final=draft({video_script:'城市故事',video_terms:'城市',video_source:'cqai_video',audio_source:'video_original',target_duration_seconds:5})
    const source:Job={...completedPreview({video_script:'城市故事',video_terms:'城市',video_source:'cqai_video',audio_source:'video_original',target_duration_seconds:5}),stopAt:'materials',videoModel:'video-model',materialGroups:[['cqai-materials/clip-0.mp4']],artifacts:[]}
    const matching={...final,videoModel:'video-model'}
    expect(materialPreviewReuseIssue(source,matching)).toBeUndefined()
    expect(materialPreviewReuseIssue(source,{...matching,params:{...matching.params,target_duration_seconds:60}})).toMatch('参数已改变')
    const generated:Job={...source,params:{...source.params,video_terms:''},state:{terms:['城市','街道']}}
    expect(materialPreviewReuseIssue(generated,{...matching,params:{...matching.params,video_terms:'城市, 街道'}})).toBeUndefined()
    expect(materialPreviewReuseIssue(generated,{...matching,params:{...matching.params,video_terms:'其它主题'}})).toMatch('参数已改变')
    const subtitles:Job={...source,stopAt:'subtitle',materialPreviewJobId:source.id,subtitleDurations:[30]}
    expect(subtitlePreviewReuseIssue(subtitles,matching,source.id)).toBeUndefined()
    expect(subtitlePreviewReuseIssue(subtitles,{...matching,params:{...matching.params,video_clip_speed:2}},source.id)).toMatch('剪辑设置已改变')
  })
  it('explains failed materials and protects accepted or uncertain clips from duplicate billing', () => {
    const params = {video_script:'城市故事',video_terms:'城市',video_source:'cqai_video',target_duration_seconds:5}
    const target = {...draft(params),videoModel:'video-model'}
    const source: Job = {...completedPreview(params),stopAt:'materials',status:'failed',videoModel:'video-model',error:'HTTP 404'}
    expect(materialPreviewReuseIssue(source,target)).toContain('生成失败')
    expect(materialPreviewReuseIssue(source,target)).not.toContain('请先完成')
    expect(materialPreviewReuseIssue({...source,status:'running'},target)).toContain('正在生成')
    expect(materialPreviewReuseIssue({...source,status:'interrupted'},target)).toContain('原任务')
    for (const status of ['submitting','queued','in_progress'] as const) {
      const pending = {...source,videoTasks:[{key:'0',model:'video-model',prompt:'城市',seconds:5,status}]}
      expect(materialPreviewReuseIssue(pending,target)).toContain('避免重复计费')
    }
  })
  it('keeps uploaded narration tied to its preview and restores it from history', () => {
    const uploaded={...completedPreview({audio_source:'upload'},false),uploads:{material:[],audio:'narration.wav'}}
    const final=draft({video_script:'城市故事',video_source:'local',audio_source:'upload'})
    expect(audioPreviewReuseIssue(uploaded,final,'whisper')).toBeUndefined()
    expect(audioPreviewReuseIssue(uploaded,{...final,params:{...final.params,audio_source:'tts'}},'edge')).toMatch('声音来源已改变')
    expect(workflowAudioPreview(groupJobsByWorkflow([uploaded])[0],final)?.id).toBe(uploaded.id)
    expect(subtitlePreviewReuseIssue(uploaded,final,undefined,undefined)).toMatch('上传的旁白已改变')
    expect(subtitlePreviewReuseIssue(uploaded,final,undefined,uploaded.id)).toBeUndefined()
    const oldTts={...completedPreview({}),params:{...completedPreview({}).params}}
    delete oldTts.params.audio_source
    expect(audioPreviewReuseIssue(oldTts,draft({video_script:'城市故事',video_source:'local'}),'edge')).toBeUndefined()
  })
  it('rejects edited subtitles outside the actual soundtrack and accepts no speech', () => {
    expect(() => validateSubtitleSrt('',5)).not.toThrow()
    expect(() => validateSubtitleSrt('1\n00:00:00,000 --> 00:00:01,000\n你好\n',5)).not.toThrow()
    expect(() => validateSubtitleSrt('1\n00:00:04,000 --> 00:00:06,000\n超出时长\n',5)).toThrow('超出音频范围')
    expect(() => validateSubtitleSrt('1\n00:00:00,000 --> 00:00:02,000\n你好\n\n2\n00:00:01,000 --> 00:00:03,000\n重叠',5)).toThrow('发生重叠')
    expect(() => validateSubtitleSrt('1\n00:00:00,000 --> 00:00:00,200\n你好\n',0)).toThrow('缺少成片时长')
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
