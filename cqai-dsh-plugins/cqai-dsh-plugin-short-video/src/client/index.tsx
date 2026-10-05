import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { MediaSettingsEditor, mediaRequest, mountVideoWorkspace } from 'cqai-dsh-media-settings/client'
import type { EjianbaoWorkspaceOwner, MediaDefaults, MediaSettingsPublic } from 'cqai-dsh-media-settings/contracts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState } from 'react'
import pluginIcon from '../../assets/plugin-icon.svg'
import { API, audioPreviewReuseIssue, defaultParams, defaultSettings, defaultVideoModel, groupJobsByWorkflow, materialKeyIssue, materialPreviewReuseIssue, needsText, stageRequirements, subtitlePreviewReuseIssue, videoModelIssue, VIDEO_MODEL_UNAVAILABLE, workflowAudioPreview, workflowDisplayJob, workflowDraft, type Catalog, type ContentAction, type ContentResult, type Draft, type Job, type Settings, type Stage, type UploadKind, type WorkflowGroup } from '../protocol.ts'
import { draftDefaultPatch } from './draft-defaults.ts'

export const inject = ['slots']
const PANEL = 'cqai-short-video' as MainPanelId
const initial: Draft = {textModel:'',imageModel:'',videoModel:'',stopAt:'video',params:{...defaultParams}}
const stages: {id:Stage;label:string}[] = [{id:'script',label:'文案'},{id:'terms',label:'关键词'},{id:'materials',label:'素材'},{id:'audio',label:'配音'},{id:'subtitle',label:'字幕'},{id:'video',label:'完整成片'}]
const sources = [{id:'pexels',name:'Pexels 素材库'},{id:'pixabay',name:'Pixabay 素材库'},{id:'coverr',name:'Coverr 素材库'},{id:'openai_image',name:'CQAI Club 图片生成'},{id:'cqai_video',name:'CQAI Club 视频生成'},{id:'local',name:'本地视频 / 图片'}]
const transitions = [{id:'',name:'无转场'},{id:'Shuffle',name:'随机'},{id:'FadeIn',name:'渐入'},{id:'FadeOut',name:'渐出'},{id:'SlideIn',name:'滑入'},{id:'SlideOut',name:'滑出'},{id:'ZoomIn',name:'放大'},{id:'ZoomOut',name:'缩小'}]
const scriptLanguages = [{id:'',name:'自动识别'},{id:'zh-CN',name:'简体中文'},{id:'zh-HK',name:'香港中文'},{id:'zh-TW',name:'繁体中文'},{id:'en-US',name:'English'},{id:'ca-ES',name:'Català'},{id:'de-DE',name:'Deutsch'},{id:'es-ES',name:'Español'},{id:'fr-FR',name:'Français'},{id:'it-IT',name:'Italiano'},{id:'ru-RU',name:'Русский'},{id:'vi-VN',name:'Tiếng Việt'},{id:'th-TH',name:'ไทย'},{id:'tr-TR',name:'Türkçe'}]
const normalizeLanguage=(value:unknown):string=>value==='zh'?'zh-CN':value==='en'?'en-US':typeof value==='string'?value:''
const labels: Record<Job['status'],string> = {draft:'待开始',running:'制作中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'}
const videoTaskLabels: Record<NonNullable<Job['videoTasks']>[number]['status'], string> = {submitting:'提交结果待确认',queued:'排队中',in_progress:'生成中',completed:'已下载',failed:'生成失败'}
type Setup = {status:'idle'|'running'|'completed'|'failed';items:{id:string;label:string;status:string;detail?:string}[];logs:string[]}
type Health = {python?:boolean;ffmpeg?:boolean;voices?:string[];fonts?:{name:string;path:string}[];uv?:boolean;error?:string;setup?:Setup}
type MaterialSource = {provider:string;local_file:string;duration?:number;search_term?:string;asset_id?:string;source_page?:string}
type SavedManifest = {script?:string;search_terms?:string|string[];material_sources:MaterialSource[]}
function publicSourcePage(value:unknown):string|undefined {
  if(typeof value!=='string')return
  try{const page=new URL(value);return ['http:','https:'].includes(page.protocol)&&!page.username&&!page.password?page.href:undefined}catch{return}
}
function savedManifest(value:unknown):SavedManifest {
  if(!value||typeof value!=='object')return {material_sources:[]}
  const data=value as Record<string,unknown>
  const sources=Array.isArray(data.material_sources)?data.material_sources:[]
  return {
    script:typeof data.script==='string'?data.script:undefined,
    search_terms:typeof data.search_terms==='string'?data.search_terms:Array.isArray(data.search_terms)&&data.search_terms.every(term=>typeof term==='string')?data.search_terms:undefined,
    material_sources:sources.filter((source):source is Record<string,unknown>=>!!source&&typeof source==='object'&&!Array.isArray(source)).map(source=>({
      provider:typeof source.provider==='string'?source.provider:'',
      local_file:typeof source.local_file==='string'?source.local_file:'',
      duration:typeof source.duration==='number'&&Number.isFinite(source.duration)?source.duration:undefined,
      search_term:typeof source.search_term==='string'?source.search_term:undefined,
      asset_id:typeof source.asset_id==='string'?source.asset_id:undefined,
      source_page:publicSourcePage(source.source_page),
    })),
  }
}
async function api<T>(route:string,data?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch(`${API}/${route}`,data===undefined?{signal}:{signal,method:'POST',headers:{'content-type':'application/json','x-short-video':'1'},body:JSON.stringify(data)})
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('短视频制作服务暂未就绪')
  const result=await response.json();if(!response.ok)throw new Error(result.error||'请求失败');return result as T
}
async function upload(id:string,kind:UploadKind,file:File):Promise<Job>{
  const response=await fetch(`${API}/upload?id=${encodeURIComponent(id)}&kind=${kind}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'x-short-video':'1'},body:file})
  const value=await response.json();if(!response.ok)throw new Error(value.error||'上传失败');return value as Job
}
function url(job:Job,file:string,download=false){return `${API}/artifact?id=${encodeURIComponent(job.id)}&file=${encodeURIComponent(file)}${download?'&download=1':''}`}
function ShortVideoPanelIcon({size = 20}:{size?:number}){return <img className="cqai-plugin-panel-icon" src={pluginIcon} width={size} height={size} alt="" draggable={false}/>}
const css = `
.sv { height: 100%; overflow: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; }
.sv * { box-sizing: border-box; }
.sv select, .sv textarea, .sv-tabs button, .sv-job { font: inherit; }
.sv-wrap { width: min(100%, 1120px); margin: 0 auto; padding: 24px 32px 56px; }
.sv-top { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px 20px; margin-bottom: 20px; }
.sv-top-copy { flex: 1 1 320px; min-width: 0; }
.sv-top-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.sv-top-actions button[aria-current="page"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.sv h1 { margin: 0 0 5px; font-size: 22px; font-weight: 600; line-height: 1.35; }
.sv h2 { margin: 0 0 16px; font-size: 16px; font-weight: 600; line-height: 1.4; }
.sv h3 { margin: 0 0 11px; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 600; }
.sv-sub, .sv-help { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.sv-help { margin: 5px 0 0; }
.sv-help a { color: var(--dsw-alias-brand-primary); }
.sv-tabs { display: flex; gap: 4px; margin-bottom: 20px; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sv-tabs button { flex: none; padding: 10px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px; white-space: nowrap; }
.sv-tabs button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.sv-tabs button[aria-current="page"] { border-bottom-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-weight: 600; }
.sv-tabs button:focus-visible, .sv-job:focus-visible, .sv-stage label:focus-within { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sv-grid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(250px, 1fr); gap: 16px; }
.sv-grid > * { min-width: 0; }
.sv-card { margin-bottom: 16px; padding: 20px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.sv-field { margin-bottom: 16px; }
.sv-field > label { display: block; margin-bottom: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; }
.sv-key-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 7px; }
.sv-key-heading label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; }
.sv-key-heading a { flex: none; color: var(--dsw-alias-brand-primary); font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
.sv-key-heading a:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sv-input { width: 100%; min-height: 36px; padding: 7px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.sv-input:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.sv-native-input { display: flex; width: 100%; min-height: 36px; }
.sv textarea { min-height: 122px; resize: vertical; line-height: 1.6; }
.sv textarea.long { min-height: 225px; }
.sv-row, .sv-row3 { display: grid; gap: 14px; }
.sv-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sv-row3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sv-check { display: flex; align-items: center; gap: 9px; margin: 10px 0; }
.sv-check input, .sv-stage input { accent-color: var(--dsw-alias-brand-primary); }
.sv-actions, .sv-kv { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.sv-actions button { max-width: 100%; }
.sv-actions button[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.sv .sv-danger { color: var(--dsw-alias-state-error-primary); }
.sv-error, .sv-success { margin: 12px 0; padding: 11px 13px; border-radius: 8px; white-space: pre-wrap; }
.sv-error { border: 1px solid var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); }
.sv-success { border: 1px solid var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); color: var(--dsw-alias-state-success-primary); }
.sv-upload, .sv-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; }
.sv-upload { margin-bottom: 12px; padding: 14px; }
.sv-upload strong { display: block; margin-bottom: 6px; font-size: 13px; }
.sv-upload input { max-width: 100%; font-size: 12px; }
.sv-list { display: grid; gap: 8px; }
.sv-record-stages { margin-top: 10px; }
.sv-job { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: inherit; cursor: pointer; text-align: left; }
.sv-job:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sv-job[aria-current="true"] { border-color: var(--dsw-alias-brand-primary); }
.sv-job span { min-width: 0; overflow-wrap: anywhere; }
.sv-job small { display: block; margin-top: 3px; color: var(--dsw-alias-label-secondary); }
.sv-history-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sv-history-row .sv-job { flex: 1 1 auto; min-width: 0; }
.sv-history-delete { flex: none; }
.sv video { width: 100%; max-height: 520px; background: var(--dsw-alias-bg-layer-2); }
.sv-material-preview { margin-top: 8px; }
.sv-material-preview img, .sv-material-preview video { display: block; width: min(100%, 440px); max-height: 260px; object-fit: contain; }
.sv audio { display: block; width: 100%; margin: 12px 0; }
.sv-log { max-height: 240px; overflow: auto; padding: 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font: 12px/1.6 ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.sv-artifact { display: flex; justify-content: space-between; gap: 12px; padding: 9px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-brand-primary); text-decoration: none; }
.sv-progress { width: 100%; height: 6px; accent-color: var(--dsw-alias-brand-primary); }
.sv-empty { padding: 30px; color: var(--dsw-alias-label-secondary); text-align: center; }
.sv-stage { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.sv-stage label { display: flex; align-items: center; gap: 5px; padding: 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; cursor: pointer; font-size: 12px; }
@media (max-width: 900px) { .sv-wrap { padding: 20px 18px 48px; } .sv-grid, .sv-row, .sv-row3 { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .sv-history-row { flex-wrap: wrap; } .sv-history-row .sv-job { flex-basis: 100%; } .sv-history-delete { margin-left: auto; } }
`
function Studio({active=true,onOpenSettings}:Partial<EjianbaoWorkspaceOwner>){
  const [tab,setTab]=useState<'create'|'audio'|'assets'|'subtitle'|'advanced'|'history'|'settings'>('create')
  const [draft,setDraft]=useState<Draft>(initial)
  const [settings,setSettings]=useState<Settings>(defaultSettings)
  const [savedSettings,setSavedSettings]=useState<Settings>()
  const [catalog,setCatalog]=useState<Catalog>()
  const [health,setHealth]=useState<Health>()
  const [jobs,setJobs]=useState<Job[]>([])
  const [selected,setSelected]=useState<string|null>(null)
  const [workflowId,setWorkflowId]=useState('')
  const [filter,setFilter]=useState<'all'|'running'|'completed'|'failed'>('all')
  const [materials,setMaterials]=useState<File[]>([])
  const [voiceFile,setVoiceFile]=useState<File>()
  const [voicePreviewId,setVoicePreviewId]=useState('')
  const [materialPreviewId,setMaterialPreviewId]=useState('')
  const [subtitlePreviewId,setSubtitlePreviewId]=useState('')
  const [subtitleEditors,setSubtitleEditors]=useState<Record<number,string>>({})
  const [bgmFile,setBgmFile]=useState<File>()
  const [busy,setBusy]=useState('')
  const [openingFolder,setOpeningFolder]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [preview,setPreview]=useState<ContentResult>()
  const [manifests,setManifests]=useState<Record<string,SavedManifest>>({})
  const [subtitleText,setSubtitleText]=useState<{jobId:string;file:string;text:string}>()
  const pageRef=useRef<HTMLElement>(null)
  const importRef=useRef<HTMLInputElement>(null)
  const initialHydrated=useRef(false)
  const activeWorkflowId=useRef('')
  const viewRevision=useRef(0)
  const newDefaults=useRef<MediaDefaults>({aspect:'9:16',edgeVoiceId:'zh-CN-XiaoxiaoNeural'})
  const defaultDirty=useRef(new Set<string>())
  const openSettings=()=>onOpenSettings?onOpenSettings():setTab('settings')
  const newParams=(defaults:MediaDefaults)=>({...defaultParams,...draftDefaultPatch(defaults,new Set(),health?.voices)})
  const job=selected===null?jobs[0]:jobs.find(x=>x.id===selected)
  const workflows=groupJobsByWorkflow(jobs)
  const currentWorkflow=workflows.find(group=>group.jobs.some(item=>item.id===job?.id))
  const workflowOf=(item:Job)=>workflows.find(group=>group.jobs.some(candidate=>candidate.id===item.id))?.id||item.workflowId||item.id
  const voicePreview=jobs.find(x=>x.id===voicePreviewId)
  const materialPreview=jobs.find(x=>x.id===materialPreviewId)
  const subtitlePreview=jobs.find(x=>x.id===subtitlePreviewId)
  const audioRecord=currentWorkflow?.jobs.find(item=>item.artifacts.some(artifact=>artifact.kind==='audio'))
  const displayedAudio=audioRecord||voicePreview
  const subtitleRecord=currentWorkflow?.jobs.find(item=>item.artifacts.some(artifact=>artifact.kind==='subtitle'))
  const subtitleArtifact=subtitleRecord?.artifacts.find(artifact=>artifact.kind==='subtitle')
  const subtitleKey=subtitleRecord&&subtitleArtifact?`${subtitleRecord.id}:${subtitleArtifact.file}:${subtitleRecord.status}`:''
  const subtitleEditorKey=subtitlePreview?`${subtitlePreview.id}:${subtitlePreview.status}:${subtitlePreview.artifacts.filter(a=>a.kind==='subtitle').map(a=>a.file+':'+a.size).join(',')}`:''
  const manifestJobs=currentWorkflow?.jobs.filter(item=>item.artifacts.some(artifact=>artifact.file==='script.json'))||[]
  const manifestKey=`${currentWorkflow?.id||''}:${manifestJobs.map(item=>`${item.id}:${item.status}:${item.artifacts.find(artifact=>artifact.file==='script.json')?.size}`).join(',')}`
  const manifestLoadKey=`${manifestKey}:${activeWorkflowId.current}:${viewRevision.current}`
  const materialRecord=currentWorkflow?.jobs.find(item=>manifests[item.id]?.material_sources.length||item.artifacts.some(artifact=>artifact.kind==='material')||(Array.isArray(item.state?.materials)&&item.state.materials.length))
  const materialSources=materialRecord?manifests[materialRecord.id]?.material_sources||[]:[]
  const materialAttempt=currentWorkflow?.jobs.find(item=>['materials','subtitle','video'].includes(item.stopAt)&&item.status!=='draft'&&(item.progress>=40||item.artifacts.some(artifact=>artifact.file==='script.json')))
  const localMaterialRecord=currentWorkflow?.jobs.find(item=>item.uploads.material.length)
  const videoTaskRecord=currentWorkflow?.jobs.find(item=>item.videoTasks?.length)
  const completedVideoRecord=currentWorkflow?.jobs.find(item=>item.artifacts.some(artifact=>artifact.kind==='video'&&artifact.file.startsWith('final-')))
  const subtitleProvider=draft.params.audio_source==='tts'?(savedSettings?.subtitle_provider??settings.subtitle_provider):'whisper'
  const voicePreviewIssue=voicePreview?audioPreviewReuseIssue(voicePreview,{...draft,stopAt:'audio'},subtitleProvider):undefined
  const voicePreviewReady=!!voicePreview&&!voicePreviewIssue
  const materialPreviewIssue=materialPreview?materialPreviewReuseIssue(materialPreview,draft):'请先生成 AI 视频素材'
  const materialPreviewReady=!!materialPreview&&!materialPreviewIssue
  const audioSource=String(draft.params.audio_source||'tts')
  const subtitleReuseIssue=subtitlePreview?subtitlePreviewReuseIssue(subtitlePreview,draft,materialPreviewReady?materialPreviewId:undefined,voicePreviewReady?voicePreviewId:audioSource==='upload'?subtitlePreview.id:undefined):undefined
  const subtitlePreviewReady=!!subtitlePreview&&!subtitleReuseIssue
  const selectedStageIssue=draft.params.video_source==='cqai_video'&&['subtitle','video'].includes(draft.stopAt)&&!materialPreviewReady?materialPreviewIssue:
    audioSource==='upload'&&['audio','subtitle','video'].includes(draft.stopAt)&&!voiceFile&&!voicePreviewReady&&!(subtitlePreviewReady&&subtitlePreview?.artifacts.some(a=>a.kind==='audio'))?'请先上传旁白':
    audioSource==='video_original'&&draft.stopAt==='audio'?'视频原声需先生成素材，可在“素材与画面”预览':undefined
  const filteredWorkflows=workflows.filter(group=>{const status=workflowDisplayJob(group).status;return filter==='all'||(filter==='failed'&&['failed','interrupted','cancelled'].includes(status))||status===filter})
  const modelNeeded=!draft.params.video_script||(!materialPreviewReady&&needsText(draft))||stageRequirements(draft).imageModel||(!materialPreviewReady&&stageRequirements(draft).videoModel)
  const videoModelWarning=videoModelIssue(catalog,draft.videoModel)
  const callableVideoModels=catalog?.video?.filter(model=>model.callable===true)||[]
  const materialKeyWarning=savedSettings?materialKeyIssue(draft,savedSettings):undefined
  const update=(key:string,value:unknown)=>{
    if(key==='video_aspect'||key==='voice_name')defaultDirty.current.add(key)
    setPreview(undefined)
    if(['video_script','voice_name','voice_rate','voice_volume','audio_source'].includes(key))setVoicePreviewId('')
    // Keep the source task selected so the UI can explain why its paid clips are stale.
    if(['video_script','voice_name','voice_rate','voice_volume','audio_source','video_source','video_terms','target_duration_seconds','video_clip_duration','video_count','match_materials_to_script','video_concat_mode','video_clip_speed','video_transition_mode','video_aspect','video_fit_mode','subtitle_display_mode'].includes(key))setSubtitlePreviewId('')
    setDraft(prev=>({...prev,params:{...prev.params,[key]:value,...(key==='video_source'?{audio_source:value==='cqai_video'?'video_original':'tts'}:{})}}))
  }
  const value=(key:string)=>draft.params[key]
  const refresh=()=>api<Job[]>('jobs').then(setJobs)
  const reloadCatalog=()=>api<Catalog>('catalog').then(c=>{setCatalog(c);setDraft(prev=>({...prev,textModel:prev.textModel||c.defaultText||c.text[0]?.id||'',imageModel:prev.imageModel||c.defaultImage||c.image[0]?.id||'',videoModel:defaultVideoModel(c,prev.videoModel)}))})
  useEffect(()=>{
    if(!currentWorkflow||!manifestJobs.length)return
    let active=true
    const expectedScript=draft.params.video_script,expectedTerms=draft.params.video_terms,revision=viewRevision.current
    void Promise.all(manifestJobs.map(async item=>{
      try{
        const response=await fetch(url(item,'script.json'))
        if(!response.ok)throw new Error('无法读取任务清单')
        return [item.id,savedManifest(await response.json())] as const
      }catch{return [item.id,{material_sources:[]} as SavedManifest] as const}
    })).then(entries=>{
      if(!active)return
      const next=new Map(entries)
      setManifests(previous=>({...previous,...Object.fromEntries(entries)}))
      if(activeWorkflowId.current!==currentWorkflow.id||viewRevision.current!==revision)return
      const restored=workflowDraft(currentWorkflow,next)
      setDraft(previous=>({
        ...previous,
        params:{...previous.params,
          ...(previous.params.video_script===expectedScript?{video_script:restored.params.video_script}:{}),
          ...(previous.params.video_terms===expectedTerms?{video_terms:restored.params.video_terms}:{}),
        },
      }))
    }).catch(()=>{})
    return()=>{active=false}
  },[manifestLoadKey])
  useEffect(()=>{
    setSubtitleText(undefined)
    if(!subtitleRecord||!subtitleArtifact)return
    let active=true
    void fetch(url(subtitleRecord,subtitleArtifact.file)).then(response=>{
      if(!response.ok)throw new Error('字幕文件不可用')
      return response.text()
    }).then(text=>{if(active)setSubtitleText({jobId:subtitleRecord.id,file:subtitleArtifact.file,text})}).catch(()=>{})
    return()=>{active=false}
  },[subtitleKey])
  useEffect(()=>{
    if(!subtitlePreview||subtitlePreview.status!=='completed')return
    let active=true
    const files=subtitlePreview.artifacts.filter(a=>a.kind==='subtitle'&&/^subtitle-\d+\.srt$/.test(a.file))
    void Promise.all(files.map(async artifact=>{
      const index=Number(artifact.file.match(/subtitle-(\d+)\.srt/)?.[1])
      const response=await fetch(url(subtitlePreview,artifact.file))
      if(!response.ok)throw new Error('字幕文件不可用')
      return [index,await response.text()] as const
    })).then(entries=>{if(active)setSubtitleEditors(Object.fromEntries(entries))}).catch(()=>{})
    return()=>{active=false}
  },[subtitleEditorKey])
  useEffect(()=>{if(!active)return;let live=true;const controller=new AbortController();const read=<T,>(route:string)=>api<T>(route,undefined,controller.signal);const poll=()=>{void read<Job[]>('jobs').then(data=>{if(!live)return;setJobs(data);if(!initialHydrated.current){initialHydrated.current=true;const recent=groupJobsByWorkflow(data)[0];if(recent)openWorkflow(recent,false)}}).catch(()=>{})}
    void read<Catalog>('catalog').then(c=>{if(!live)return;setCatalog(c);setDraft(prev=>({...prev,textModel:prev.textModel||c.defaultText||c.text[0]?.id||'',imageModel:prev.imageModel||c.defaultImage||c.image[0]?.id||'',videoModel:defaultVideoModel(c,prev.videoModel)}))}).catch(e=>{if(live)setError(e.message)});void read<Settings>('settings').then(value=>{if(live){setSettings(value);setSavedSettings(value)}}).catch(()=>{});void read<Health>('health').then(data=>{if(live)setHealth(data)}).catch(()=>{});poll()
    void read<MediaSettingsPublic>('media-settings').then(value=>{if(!live)return;const defaults=value.effective||value.defaults;newDefaults.current=defaults;if(!activeWorkflowId.current&&viewRevision.current===0)setDraft(previous=>({...previous,params:{...previous.params,...draftDefaultPatch(defaults,defaultDirty.current,health?.voices)}}))}).catch(()=>{})
    let previousSetup='idle'
    const setupPoll=()=>{void read<Setup>('setup').then(state=>{if(!live)return;setHealth(value=>({...value,setup:state}));if(previousSetup==='running'&&state.status!=='running')void read<Health>('health').then(data=>{if(live)setHealth(data)}).catch(()=>{});previousSetup=state.status}).catch(()=>{})}
    void setupPoll()
    const timer=setInterval(poll,2000);const healthTimer=setInterval(()=>{void read<Health>('health').then(data=>{if(live)setHealth(data)}).catch(()=>{})},10000);const setupTimer=setInterval(setupPoll,2000)
    return()=>{live=false;controller.abort();clearInterval(timer);clearInterval(healthTimer);clearInterval(setupTimer)}
  },[active])
  useEffect(()=>{pageRef.current?.scrollTo(0,0)},[tab])
  const field=(label:string,key:string,help?:string,multiline=false)=>{
    const maxLength:Record<string,number>={video_subject:500,video_script:30000,video_terms:4000,video_script_prompt:2000,custom_system_prompt:8000}
    return <div className="sv-field"><label htmlFor={key}>{label}</label>{multiline?<textarea className="sv-input long" id={key} disabled={!!busy} maxLength={maxLength[key]} value={String(value(key)??'')} onChange={e=>update(key,e.target.value)}/>:<Input className="sv-native-input" id={key} disabled={!!busy} maxLength={maxLength[key]} value={String(value(key)??'')} onChange={e=>update(key,e.target.value)}/>} {help&&<p className="sv-help">{help}</p>}</div>
  }
  const number=(label:string,key:string,min:number,max:number,step=1)=><div className="sv-field"><label htmlFor={key}>{label}</label><Input className="sv-native-input" id={key} disabled={!!busy} type="number" min={min} max={max} step={step} value={Number(value(key))} onChange={e=>update(key,Number(e.target.value))}/></div>
  const choice=(label:string,key:string,items:{id:string;name:string}[])=><div className="sv-field"><label htmlFor={key}>{label}</label><select className="sv-input" id={key} disabled={!!busy} value={String(value(key)??'')} onChange={e=>update(key,key==='video_transition_mode'&&!e.target.value?null:e.target.value)}>{items.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
  const check=(label:string,key:string)=><label className="sv-check"><input type="checkbox" disabled={!!busy} checked={Boolean(value(key))} onChange={e=>update(key,e.target.checked)}/>{label}</label>
  const action=async<T,>(label:string,operation:()=>Promise<T>)=>{setBusy(label);setError('');setNotice('');try{return await operation()}catch(e){setError(e instanceof Error?e.message:String(e));return undefined}finally{setBusy('')}}
  const saveSettings=()=>void action('保存设置…',async()=>{const next=await api<Settings>('settings',{subtitle_provider:settings.subtitle_provider,video_codec:settings.video_codec});setSettings(next);setSavedSettings(next);setNotice('设置已保存。新任务会使用这些设置。')})
  async function openJobFolder(item:Job,kind:'task'|'materials'){
    setOpeningFolder(kind);setError('');setNotice('')
    try{
      const result=await api<{path:string}>(`open-folder?id=${encodeURIComponent(item.id)}&kind=${kind}`,{})
      setNotice(`已打开${kind==='materials'?'素材':'任务'}文件夹：${result.path}`)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setOpeningFolder('')}
  }
  function openWorkflow(group:WorkflowGroup,navigate=true){
    initialHydrated.current=true;activeWorkflowId.current=group.id;viewRevision.current++
    const saved=new Map(group.jobs.flatMap(item=>manifests[item.id]?[[item.id,manifests[item.id]] as const]:[]))
    const restored=workflowDraft(group,saved)
    const reusable=workflowAudioPreview(group,restored)
    const material=group.jobs.find(item=>!materialPreviewReuseIssue(item,restored))
    const captions=group.jobs.find(item=>!subtitlePreviewReuseIssue(item,restored,material?.id,reusable?.id??(restored.params.audio_source==='upload'?item.id:undefined)))
    setDraft(restored);setSelected(workflowDisplayJob(group).id);setWorkflowId(group.id);setVoicePreviewId(reusable?.id||'');setMaterialPreviewId(material?.id||'');setSubtitlePreviewId(captions?.id||'')
    setMaterials([]);setVoiceFile(undefined);setBgmFile(undefined);setPreview(undefined)
    if(navigate){setError('');setNotice('已载入历史任务，可在各步骤查看生成内容。');setTab('advanced')}
  }
  async function contentAction(kind:ContentAction){
    initialHydrated.current=true
    if(kind==='script'&&String(draft.params.video_script||'').trim()&&!window.confirm('重新生成会替换当前文案与关键词，继续吗？'))return
    await action(kind==='preview'?'正在准备提示词…':'正在生成内容…',async()=>{
      const result=await api<ContentResult>('content',{action:kind,draft})
      if(kind==='preview'){setPreview(result);return}
      if(!result.terms?.length || (kind==='script'&&!result.script?.trim()))throw new Error('未收到完整的文案或关键词')
      setDraft(prev=>({...prev,params:{...prev.params,...(kind==='script'?{video_script:result.script}:{}),video_terms:result.terms!.join(', ')}}))
      if(kind==='script')setVoicePreviewId('')
      setSubtitlePreviewId('')
      setPreview(undefined)
      setNotice(kind==='script'?'文案与关键词已生成，请检查并修改后继续。':'关键词已更新，请检查后继续。')
    })
  }
  async function generateVoicePreview(){
    initialHydrated.current=true
    await action('正在启动配音…',async()=>{
      if(!String(draft.params.video_script||'').trim())throw new Error('请先填写视频文案')
      if(audioSource==='video_original')throw new Error('视频原声可在素材生成后直接试听')
      if(audioSource==='upload'&&!voiceFile)throw new Error('请先上传旁白')
      const previewDraft:Draft={...draft,textModel:'',imageModel:'',videoModel:'',stopAt:'audio',params:{...draft.params,video_source:'local',video_terms:''}}
      const next=await api<Job>('jobs',{...previewDraft,...(workflowId?{workflowId}:{})})
      initialHydrated.current=true;activeWorkflowId.current=next.workflowId||next.id;viewRevision.current++
      setWorkflowId(next.workflowId||next.id);setVoicePreviewId(next.id);setSelected(next.id);setJobs(prev=>[next,...prev.filter(item=>item.id!==next.id)])
      if(audioSource==='upload'&&voiceFile)await upload(next.id,'audio',voiceFile)
      await api<Job>(`start?id=${next.id}`,{})
      await refresh()
      setNotice('声音预览正在生成；也可以稍后在制作时直接处理声音。')
    })
  }
  async function generateMaterials(){
    const clips=Math.ceil(Number(value('target_duration_seconds'))/Number(value('video_clip_duration')))*Number(value('video_count'))
    await action('正在生成视频素材…',async()=>{
      if(draft.params.video_source!=='cqai_video')throw new Error('请先选择 CQAI Club 视频生成')
      if(videoModelWarning)throw new Error(videoModelWarning)
      if(!Number.isFinite(clips)||clips<1||clips>100)throw new Error('镜头数需在 1–100 之间')
      if(!window.confirm(`将生成 ${clips} 个 CQAI 视频镜头，每个镜头可能单独计费。确认开始吗？`))return
      const next=await api<Job>('jobs',{...draft,stopAt:'materials',params:{...draft.params,audio_source:'video_original'},...(workflowId?{workflowId}:{})})
      initialHydrated.current=true;activeWorkflowId.current=next.workflowId||next.id;viewRevision.current++
      setWorkflowId(next.workflowId||next.id);setMaterialPreviewId(next.id);setSubtitlePreviewId('');setSelected(next.id);setJobs(prev=>[next,...prev.filter(item=>item.id!==next.id)])
      await api<Job>(`start?id=${next.id}`,{});await refresh()
      setNotice('素材正在生成。远端镜头任务会保存在当前制作流程中。')
    })
  }
  async function generateSubtitlePreview(){
    await action('正在生成字幕…',async()=>{
      if(!draft.params.subtitle_enabled)throw new Error('请先开启字幕')
      const previewIssue=draft.params.video_source==='cqai_video'&&!materialPreviewReady?materialPreviewIssue:
        audioSource==='upload'&&!voiceFile&&!voicePreviewReady?'请先上传旁白':undefined
      if(previewIssue)throw new Error(previewIssue)
      const reusable=voicePreviewReady?voicePreview:undefined
      const next=await api<Job>('jobs',{...draft,stopAt:'subtitle',...(workflowId?{workflowId}:{}),
        ...(materialPreviewReady?{materialPreviewJobId:materialPreview!.id}:{}),
        ...(reusable?{audioPreviewJobId:reusable.id}:{})})
      initialHydrated.current=true;activeWorkflowId.current=next.workflowId||next.id;viewRevision.current++
      setWorkflowId(next.workflowId||next.id);setSubtitlePreviewId(next.id);setSelected(next.id);setJobs(prev=>[next,...prev.filter(item=>item.id!==next.id)])
      if(audioSource==='upload'&&!reusable&&voiceFile)await upload(next.id,'audio',voiceFile)
      await api<Job>(`start?id=${next.id}`,{});await refresh()
      setNotice('字幕生成中。完成后可逐条预览和修改。')
    })
  }
  async function saveSubtitle(index:number){
    if(!subtitlePreview)return
    await action('正在保存字幕…',async()=>{
      const updated=await api<Job>(`subtitle?id=${subtitlePreview.id}`,{index,srt:subtitleEditors[index]??''})
      setJobs(previous=>previous.map(item=>item.id===updated.id?updated:item))
      setNotice(`成片 ${index} 的字幕已保存。`)
    })
  }
  async function create(){
    initialHydrated.current=true
    await action('正在创建任务…',async()=>{
      if(selectedStageIssue)throw new Error(selectedStageIssue)
      if(voicePreviewReady&&draft.stopAt==='audio'){
        setWorkflowId(workflowOf(voicePreview!));setSelected(voicePreview!.id);setTab('advanced');return
      }
      if(draft.params.video_source==='cqai_video'&&draft.stopAt==='materials'){
        if(materialPreviewReady){setSelected(materialPreview!.id);return}
        throw new Error('请在“素材与画面”确认并生成付费镜头')
      }
      const reusableAudio=voicePreviewReady?voicePreview:
        subtitlePreviewReady&&subtitlePreview?.artifacts.some(a=>a.kind==='audio')&&!audioPreviewReuseIssue(subtitlePreview,draft,subtitleProvider)?subtitlePreview:undefined
      const next=await api<Job>('jobs',{...draft,...(workflowId?{workflowId}:{}),
        ...(reusableAudio?{audioPreviewJobId:reusableAudio.id}:{}),
        ...(materialPreviewReady&&draft.params.video_source==='cqai_video'?{materialPreviewJobId:materialPreview!.id}:{}),
        ...(subtitlePreviewReady&&draft.params.subtitle_enabled?{subtitlePreviewJobId:subtitlePreview!.id}:{})});initialHydrated.current=true;activeWorkflowId.current=next.workflowId||next.id;viewRevision.current++;setWorkflowId(next.workflowId||next.id);setJobs(prev=>[next,...prev.filter(item=>item.id!==next.id)]);setSelected(next.id);setTab('advanced')
      const requirements=stageRequirements(draft)
      if(audioSource==='upload'&&!reusableAudio&&voiceFile)await upload(next.id,'audio',voiceFile)
      if(requirements.materialUpload)for(const file of materials)await upload(next.id,'material',file)
      if(requirements.backgroundMusicUpload&&bgmFile)await upload(next.id,'bgm',bgmFile)
      await api<Job>(`start?id=${next.id}`,{});await refresh()
      setNotice('任务已开始，制作进度保存在本机。')
    })
  }
  function restore(item:Job){
    const script=typeof item.state?.script==='string'?item.state.script:''
    const terms=Array.isArray(item.state?.terms)&&item.state.terms.every(term=>typeof term==='string')?item.state.terms.join(', '):''
    setDraft({textModel:item.textModel,imageModel:item.imageModel,videoModel:item.videoModel||'',stopAt:item.stopAt,params:{...defaultParams,...item.params,video_language:normalizeLanguage(item.params.video_language),...(script?{video_script:script}:{}),...(terms?{video_terms:terms}:{})}})
    initialHydrated.current=true;activeWorkflowId.current=workflowOf(item);viewRevision.current++;setSelected(item.id);setWorkflowId(workflowOf(item));setPreview(undefined);setVoicePreviewId('');setMaterialPreviewId(item.materialPreviewJobId||'');setSubtitlePreviewId(item.subtitlePreviewJobId||'');setMaterials([]);setVoiceFile(undefined);setBgmFile(undefined);setTab('create');setNotice(item.videoTasks?.some(task=>task.status==='submitting'||task.status==='queued'||task.status==='in_progress')?'已载入任务内容。原任务仍有未确认的视频生成，请先核对远端任务，避免重复计费。':'已载入任务内容；上传的旁白和本地素材请重新确认。')
  }
  function continueWithVoice(item:Job){
    setDraft({textModel:catalog?.defaultText||catalog?.text[0]?.id||'',imageModel:catalog?.defaultImage||catalog?.image[0]?.id||'',videoModel:defaultVideoModel(catalog),stopAt:'video',params:{...defaultParams,...item.params,video_source:'pexels',video_terms:''}})
    initialHydrated.current=true;activeWorkflowId.current=workflowOf(item);viewRevision.current++;setWorkflowId(workflowOf(item));setVoicePreviewId(item.id);setMaterialPreviewId('');setSubtitlePreviewId('');setVoiceFile(undefined);setMaterials([]);setBgmFile(undefined);setTab('audio')
    setNotice('已载入配音试听。确认声音后可重新选择素材并继续制作。')
  }
  function startNew(){
    initialHydrated.current=true;activeWorkflowId.current='';viewRevision.current++
    defaultDirty.current=new Set()
    const generation=viewRevision.current
    setDraft({...initial,textModel:catalog?.defaultText||catalog?.text[0]?.id||'',imageModel:catalog?.defaultImage||catalog?.image[0]?.id||'',videoModel:defaultVideoModel(catalog),params:newParams(newDefaults.current)})
    setSelected('');setWorkflowId('');setVoicePreviewId('');setMaterialPreviewId('');setSubtitlePreviewId('');setMaterials([]);setVoiceFile(undefined);setBgmFile(undefined);setPreview(undefined)
    setFilter('all');setError('');setNotice('');setTab('create')
    void mediaRequest<MediaSettingsPublic>(API,'media-settings').then(publicSettings=>{const defaults=publicSettings.effective||publicSettings.defaults;newDefaults.current=defaults;if(viewRevision.current!==generation||activeWorkflowId.current)return;setDraft(previous=>({...previous,params:{...previous.params,...draftDefaultPatch(defaults,defaultDirty.current,health?.voices)}}))}).catch(cause=>{if(viewRevision.current===generation)setError(cause instanceof Error?cause.message:'无法读取默认设置')})
  }
  function deleteJob(item:Job){
    void action('删除任务…',async()=>{
      await api(`delete?id=${item.id}`,{})
      const remaining=currentWorkflow?.jobs.find(candidate=>candidate.id!==item.id)
      setSelected(remaining?.id??null)
      if(!remaining&&workflowId===currentWorkflow?.id)setWorkflowId('')
      await refresh()
    })
  }
  function deleteWorkflow(group:WorkflowGroup){
    if(group.jobs.some(item=>item.status==='running'))return
    const name=String(group.latest.params.video_subject||group.latest.params.video_script||'未命名').slice(0,50)
    if(!window.confirm(`确定删除历史任务「${name}」及其 ${group.jobs.length} 个阶段任务和全部本地文件吗？此操作无法恢复。`))return
    void action('删除历史任务…',async()=>{
      const deleted=new Set<string>()
      let targetCount=0
      try{
        const latest=groupJobsByWorkflow(await api<Job[]>('jobs')).find(item=>item.id===group.id)
        if(!latest)throw new Error('历史任务已不存在')
        if(latest.jobs.some(item=>item.status==='running'))throw new Error('运行中的历史任务不可删除')
        targetCount=latest.jobs.length
        for(const item of latest.jobs){await api(`delete?id=${item.id}`,{});deleted.add(item.id)}
      }catch(error){
        if(deleted.size)throw new Error(`已删除 ${deleted.size} 个阶段任务，剩余任务仍在历史记录中。${error instanceof Error?error.message:String(error)}`)
        throw error
      }finally{
        if(deleted.size){
          setJobs(previous=>previous.filter(item=>!deleted.has(item.id)))
          setSelected(previous=>previous!==null&&deleted.has(previous)?null:previous)
          setVoicePreviewId(previous=>deleted.has(previous)?'':previous)
          if(deleted.size===targetCount){setWorkflowId(previous=>previous===group.id?'':previous);if(activeWorkflowId.current===group.id){activeWorkflowId.current='';viewRevision.current++}}
        }
        await refresh().catch(()=>{})
      }
      setNotice('历史任务已删除。')
    })
  }
  function exportPreset(){const blob=new Blob([JSON.stringify(draft,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='short-video-preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  async function importPreset(file:File){await action('导入预设…',async()=>{const value=JSON.parse(await file.text()) as Partial<Draft>;if(!value.params||typeof value.params!=='object')throw new Error('预设格式无效');const keys=Object.keys(defaultParams);const params=Object.fromEntries(Object.entries(value.params).filter(([key])=>keys.includes(key)));params.video_language=normalizeLanguage(params.video_language);initialHydrated.current=true;activeWorkflowId.current='';viewRevision.current++;setDraft({...initial,textModel:catalog?.text.some(m=>m.id===value.textModel)?value.textModel||'':'',imageModel:catalog?.image.some(m=>m.id===value.imageModel)?value.imageModel||'':'',videoModel:catalog?.video?.some(m=>m.id===value.videoModel&&m.callable===true)?value.videoModel||'':'',stopAt:stages.some(s=>s.id===value.stopAt)?value.stopAt!:'video',params:{...defaultParams,...params}});setSelected('');setWorkflowId('');setPreview(undefined);setVoicePreviewId('');setMaterialPreviewId('');setSubtitlePreviewId('');setMaterials([]);setVoiceFile(undefined);setBgmFile(undefined);setNotice('预设已导入，模型仅保留当前 CQAI Club 账号可用的选择。')})}
  return <section className="sv" ref={pageRef} onChangeCapture={()=>{initialHydrated.current=true}}><style>{css}</style><div className="sv-wrap">
    <header className="sv-top"><div className="sv-top-copy"><h1>短视频制作</h1><p className="sv-sub">准备文案、声音、素材和字幕，然后开始制作。</p></div><div className="sv-top-actions"><Button variant="primary" aria-label="新增短视频任务" disabled={!!busy} onClick={startNew}>新增</Button><Button variant="outline" aria-current={tab==='history'?'page':undefined} onClick={()=>setTab('history')}>历史任务</Button>{!onOpenSettings && <Button variant="outline" aria-current={tab==='settings'?'page':undefined} onClick={openSettings}>设置</Button>}</div></header>
    <nav className="sv-tabs" aria-label="短视频制作步骤">{([['create','主题与文案'],['assets','素材与画面'],['audio','声音'],['subtitle','字幕'],['advanced','制作']] as const).map(([id,label])=><button type="button" key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {error&&<div className="sv-error">{error}</div>}{notice&&<div className="sv-success">{notice}</div>}
    {tab==='create'&&<div className="sv-grid"><div>
      <div className="sv-card"><h2>视频主题</h2>{field('视频主题','video_subject','例如：人工智能如何改变日常生活。已有完整文案时，主题可以留空。',true)}
        <div className="sv-row">{choice('文案语言','video_language',scriptLanguages)}{number('文案段落数','paragraph_number',1,10)}</div>
        {check('关键词按文案顺序排列','match_materials_to_script')}
        <details><summary>高级文案设置</summary><div style={{paddingTop:14}}>
          {field('文案补充要求','video_script_prompt','例如受众、语气、需要包含的内容。',true)}
          {field('自定义系统提示','custom_system_prompt','留空使用 MoneyPrinterTurbo 默认规则。',true)}
          <div className="sv-actions"><Button variant="outline" onClick={()=>update('custom_system_prompt','')}>恢复默认提示词</Button><Button variant="outline" disabled={!!busy||!String(value('video_subject')||'').trim()||health?.python===false} onClick={()=>void contentAction('preview')}>预览最终提示词</Button></div>
          {preview?.prompt&&<details open><summary>最终提示词</summary><pre className="sv-log">{preview.prompt}</pre><details><summary>MoneyPrinterTurbo 默认规则</summary><pre className="sv-log">{preview.defaultSystemPrompt}</pre></details></details>}
        </div></details>
      </div>
      <div className="sv-card"><h2>文案与关键词</h2>
        <div className="sv-field"><label htmlFor="textModel">CQAI Club 文本模型</label><select className="sv-input" id="textModel" disabled={!!busy} value={draft.textModel} onChange={e=>setDraft({...draft,textModel:e.target.value})}><option value="">请选择</option>{catalog?.text.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="sv-help">用于生成文案与素材关键词。仅显示此账号可用的模型。</p></div>
        {!catalog?.signedIn&&<div className="sv-error">请先在“设置 · CQAI Club”登录账号，再返回选择模型。</div>}
        {catalog?.warning&&<p className="sv-help">{catalog.warning}</p>}
        <div className="sv-actions"><Button variant="outline" disabled={!!busy||!String(value('video_subject')||'').trim()||!draft.textModel||!catalog?.signedIn||health?.python===false} onClick={()=>void contentAction('script')}>{busy||'生成视频文案和关键词'}</Button></div>
        <p className="sv-help">生成会调用所选 CQAI Club 模型；结果会填入下方，仍可修改。</p>
        {field('视频文案','video_script','可以自行撰写或修改生成结果。',true)}
        <div className="sv-actions"><Button variant="outline" disabled={!!busy||!String(value('video_script')||'').trim()||!draft.textModel||!catalog?.signedIn||health?.python===false} onClick={()=>void contentAction('terms')}>单独生成关键词</Button></div>
        {field('素材关键词','video_terms','多个词用逗号分隔；可手动修改。',true)}
        <div className="sv-actions"><Button variant="primary" disabled={!String(value('video_script')||'').trim()} onClick={()=>setTab('assets')}>确认内容，下一步：素材与画面</Button></div>
      </div>
    </div><aside><div className="sv-card"><h2>制作顺序</h2><p className="sv-help">先选素材来源和画面，再选声音、字幕并制作成片。AI 视频按目标时长生成；其他素材在制作时按实际声音时长准备。</p><p className="sv-help">已有文案也可直接粘贴；需要素材关键词时使用“单独生成关键词”。</p>
      <div className="sv-kv"><Tag tone={health?.python?'success':'neutral'}>Python {health?.python?'就绪':'未就绪'}</Tag><Tag tone={health?.ffmpeg?'success':'neutral'}>FFmpeg {health?.ffmpeg?'就绪':'未就绪'}</Tag></div>
      {health?.python===false&&(onOpenSettings ? <p className="sv-help">请打开 e剪宝 顶部的“设置”准备运行环境。</p> : <Button variant="outline" onClick={openSettings}>前往安装运行环境</Button>)}</div>
      <div className="sv-card"><h2>预设</h2><p className="sv-help">导入或导出表单参数；不会导出账号凭据或本地素材。</p><div className="sv-actions"><Button variant="outline" disabled={!!busy} onClick={exportPreset}>导出 JSON</Button><Button variant="outline" disabled={!!busy} onClick={()=>importRef.current?.click()}>导入 JSON</Button></div><input ref={importRef} type="file" hidden accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importPreset(f);e.target.value=''}}/></div>
    </aside></div>}
    {tab==='assets'&&<div className="sv-grid"><div><div className="sv-card"><h2>素材与画面</h2>{choice('视频 / 图片来源','video_source',sources)}
      {draft.params.video_source==='local'&&<div className="sv-upload"><strong>本地素材（可多选）</strong><input type="file" multiple accept="video/*,image/*" onChange={e=>setMaterials([...e.target.files||[]])}/><p className="sv-help">{materials.length?materials.map(f=>f.name).join('、'):'上传的视频或图片将用于剪辑。'}</p></div>}
      {draft.params.video_source==='openai_image'&&<div className="sv-field"><label htmlFor="imageModel">CQAI Club 图片模型</label><select className="sv-input" id="imageModel" disabled={!!busy} value={draft.imageModel} onChange={e=>setDraft({...draft,imageModel:e.target.value})}><option value="">请选择</option>{catalog?.image.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="sv-help">使用当前账号的图片生成模型，按关键词生成镜头图片。</p></div>}
      {draft.params.video_source==='cqai_video'&&<><div className="sv-field"><label htmlFor="videoModel">CQAI Club 视频模型</label><select className="sv-input" id="videoModel" aria-describedby="videoModelHelp videoModelAvailability" disabled={!!busy} value={draft.videoModel} onChange={e=>{setSubtitlePreviewId('');setDraft({...draft,videoModel:e.target.value})}}><option value="">请选择</option>{catalog?.video?.map(m=><option key={m.id} value={m.id} disabled={m.callable!==true}>{m.name}{m.callable===true?'':'（视频服务不可用）'}</option>)}</select><p className="sv-help" id="videoModelHelp">视频镜头可能自带声音；生成前会显示镜头数量并请求确认。</p><p className="sv-help" id="videoModelAvailability">{!catalog?.signedIn?'请先登录 CQAI Club 并刷新模型列表。':!catalog?.video?.length?'当前账号目录中没有视频模型，请刷新模型列表。':!callableVideoModels.length?'当前账号没有可用的视频生成模型，请刷新模型列表或联系管理员确认服务配置；也可改用本地视频 / 图片素材。':catalog.video.some(m=>m.callable!==true)?VIDEO_MODEL_UNAVAILABLE:'请选择可用的视频模型。'}</p>{draft.videoModel&&videoModelWarning&&<p className="sv-error" role="alert">{videoModelWarning}</p>}</div>
        <div className="sv-row">{number('每条成片目标时长（秒）','target_duration_seconds',1,3000)}{number('生成成片数量','video_count',1,5)}</div>
        <p className="sv-help">预计生成 {Math.ceil(Number(value('target_duration_seconds'))/Number(value('video_clip_duration')))*Number(value('video_count'))} 个镜头，每个镜头可能单独计费；最多 100 个。</p>
        <div className="sv-actions"><Button variant="primary" disabled={!!busy||!!videoModelWarning||!String(value('video_script')||'').trim()||!Number.isFinite(Number(value('target_duration_seconds')))||!Number.isFinite(Number(value('video_clip_duration')))||Math.ceil(Number(value('target_duration_seconds'))/Number(value('video_clip_duration')))*Number(value('video_count'))>100} onClick={()=>void generateMaterials()}>{materialPreviewReady?'重新生成 AI 视频素材':'确认并生成 AI 视频素材'}</Button></div>
        {materialPreview&&<p className="sv-help">素材任务：{labels[materialPreview.status]}{materialPreview.status==='running'?` · ${materialPreview.progress}%`:''}{materialPreview.error?` · ${materialPreview.error}`:''}</p>}
        {materialPreview&&materialPreviewIssue&&<p className="sv-error" role="alert">{materialPreviewIssue}</p>}
        {materialPreview?.materialAudio?.map((group,index)=><p className="sv-help" key={index}>成片 {index+1}：{group.filter(Boolean).length} 个有声镜头、{group.filter(item=>!item).length} 个无声镜头；素材总长约 {(materialPreview.materialDurations?.[index]||[]).reduce((sum,seconds)=>sum+seconds,0).toFixed(1)} 秒</p>)}
        {!!materialPreview?.materialShots?.length&&<details><summary>镜头对应的远端任务和本地文件</summary>{materialPreview.materialShots.map(shot=><p className="sv-help" key={shot.clipIndex}>成片 {shot.videoIndex} · 镜头 {shot.clipIndex} · {shot.remoteTaskId||'远端任务 ID 未记录'} · {shot.file}</p>)}</details>}
      </>}
      {draft.params.video_source==='pexels'||draft.params.video_source==='pixabay'||draft.params.video_source==='coverr'?<p className="sv-help">素材平台 API Key 在{onOpenSettings ? 'e剪宝 顶部的“设置”' : '“设置”页'}配置。授权与可用素材以平台为准。</p>:null}
      {materialKeyWarning&&<div className="sv-error">{materialKeyWarning}{onOpenSettings ? <p className="sv-help">请在 e剪宝 顶部的“设置”中配置素材平台连接。</p> : <div className="sv-actions"><Button variant="outline" onClick={openSettings}>前往设置</Button></div>}</div>}
      <p className="sv-help">当前关键词：{String(value('video_terms')||'未填写；可以返回主题与文案页生成或修改')}</p>{check('按文案顺序匹配镜头','match_materials_to_script')}
      <div className="sv-actions"><Button variant="outline" onClick={()=>setTab('create')}>返回主题与文案</Button><Button variant="primary" onClick={()=>setTab('audio')}>下一步：声音</Button></div></div>
      {currentWorkflow&&(materialAttempt||localMaterialRecord||videoTaskRecord)&&<div className="sv-card"><h2>已保存的素材结果</h2>
        {localMaterialRecord&&<p className="sv-help">原任务上传了 {localMaterialRecord.uploads.material.length} 个本地素材；重新制作时需重新选择原文件。</p>}
        {materialRecord&&Array.isArray(materialRecord.state?.materials)&&materialRecord.state.materials.length>0&&<p className="sv-help">已准备 {materialRecord.state.materials.length} 个画面素材。</p>}
        {materialSources.map((source,index)=>{
          const artifact=materialRecord?.artifacts.find(item=>item.name===source.local_file&&['material','video','data'].includes(item.kind))
          return <div className="sv-material-preview" key={`${materialRecord?.id}-${index}`}><p className="sv-help">{index+1}. {source.provider||'素材'}{source.search_term?` · ${source.search_term}`:''}{source.duration!==undefined?` · ${source.duration} 秒`:''}{source.local_file?` · ${source.local_file}`:''}{source.source_page&&<> · <a href={source.source_page} target="_blank" rel="noopener noreferrer">查看素材来源</a></>}</p>
            {artifact&&(artifact.kind==='video'||artifact.kind==='material')&&(/\.(png|jpe?g|webp)$/i.test(artifact.file)?<img alt={`素材 ${index+1}`} src={url(materialRecord!,artifact.file)}/>:<video controls preload="metadata" src={url(materialRecord!,artifact.file)}/>)}
            {artifact?.kind==='data'&&/\.(png|jpe?g)$/i.test(artifact.file)&&<img alt={`素材 ${index+1}`} src={url(materialRecord!,artifact.file)}/>}
            {artifact&&<a className="sv-artifact" href={url(materialRecord!,artifact.file,true)} download={artifact.name}>↓ 下载 {artifact.name}</a>}
          </div>
        })}
        {materialRecord?.artifacts.filter(artifact=>artifact.kind==='material'&&!materialSources.some(source=>source.local_file===artifact.name)).map(artifact=><div className="sv-material-preview" key={artifact.file}><p className="sv-help">{artifact.name}</p>{/\.(png|jpe?g|webp)$/i.test(artifact.file)?<img alt={artifact.name} src={url(materialRecord,artifact.file)}/>:<video controls preload="metadata" src={url(materialRecord,artifact.file)}/>}<a className="sv-artifact" href={url(materialRecord,artifact.file,true)} download={artifact.name}>↓ 下载 {artifact.name}</a></div>)}
        {videoTaskRecord?.videoTasks?.map(task=><p className="sv-help" key={task.key}>镜头 {Number(task.key)+1} · {videoTaskLabels[task.status]} · {task.prompt}{task.id?` · ${task.id}`:''}</p>)}
        {!materialSources.length&&!materialRecord?.artifacts.some(artifact=>artifact.kind==='material')&&!localMaterialRecord&&!videoTaskRecord&&<p className="sv-help">原任务没有保存可预览的素材文件或来源记录。</p>}
      </div>}
    </div><aside><div className="sv-card"><h2>剪辑设置</h2>
      {choice('画幅','video_aspect',[{id:'9:16',name:'竖屏 9:16'},{id:'16:9',name:'横屏 16:9'},{id:'1:1',name:'方形 1:1'}])}
      {choice('画面适配','video_fit_mode',[{id:'cover',name:'填满画面'},{id:'contain',name:'完整显示'}])}
      {number('单镜头时长（秒）','video_clip_duration',1,30)}
      {number('播放速度','video_clip_speed',.1,4,.1)}
       </div>{catalog?.video?.length?<div className="sv-card"><h2>CQAI Club 视频模型</h2>{catalog.video.map(m=><p className="sv-help" key={m.id}>{m.name} · {m.callable===true?'可用于视频生成':'视频服务不可用，请刷新模型列表或联系管理员'}</p>)}</div>:null}</aside></div>}
    {tab==='audio'&&<div className="sv-grid"><div><div className="sv-card"><h2>声音</h2>
      {choice('声音来源','audio_source',[...(draft.params.video_source==='cqai_video'?[{id:'video_original',name:'使用 AI 视频原声'}]:[]),{id:'tts',name:'稍后生成配音'},{id:'upload',name:'上传自己的旁白'}])}
      {audioSource==='upload'&&<div className="sv-upload"><strong>上传自己的旁白</strong><input type="file" accept="audio/*" onChange={e=>{setVoiceFile(e.target.files?.[0]);setVoicePreviewId('');setSubtitlePreviewId('')}}/><p className="sv-help">{voiceFile?.name||'可直接在制作时上传；自动字幕会识别实际语音。'}</p></div>}
      {audioSource==='tts'&&<><div className="sv-field"><label htmlFor="voice_name">Edge TTS 声音</label><select className="sv-input" id="voice_name" value={String(value('voice_name'))} onChange={e=>update('voice_name',e.target.value)}>{!health?.voices?.includes(String(value('voice_name')))&&<option value={String(value('voice_name'))}>{String(value('voice_name'))}</option>}{health?.voices?.map(v=><option key={v} value={v}>{v}</option>)}</select></div><div className="sv-row">{number('语速','voice_rate',.5,2,.1)}{number('音量','voice_volume',0,2,.1)}</div></>}
      {audioSource==='video_original'&&<p className="sv-help">成片按每个镜头的实际剪辑顺序保留原声；无音轨的镜头保持静音。{materialPreviewReady?'下方可试听已生成的镜头。':'请先在素材页生成视频镜头。'}</p>}
      {audioSource==='video_original'&&materialPreviewReady&&materialPreview!.artifacts.filter(a=>a.kind==='material').map(a=><video controls preload="metadata" key={a.file} src={url(materialPreview!,a.file)}/>)}</div>
       <div className="sv-card"><h2>背景音乐</h2><p className="sv-help">配乐只在生成完整成片时混入，单独制作配音或字幕时不会使用。</p>{choice('配乐方式','bgm_type',[{id:'none',name:'关闭'},{id:'random',name:'从已上传音乐中随机选取'},{id:'custom',name:'上传音乐'}])}{draft.params.bgm_type==='custom'&&<div className="sv-upload"><strong>上传背景音乐</strong><input type="file" accept="audio/*" onChange={e=>setBgmFile(e.target.files?.[0])}/><p className="sv-help">{bgmFile?.name||'支持 MP3 / M4A / WAV / OGG / FLAC'}</p></div>}{number('配乐音量','bgm_volume',0,1,.05)}</div>
        {audioSource!=='video_original'&&<div className="sv-card"><h2>可选：生成并试听</h2><p className="sv-help">可以先试听，也可以直接进入字幕或制作，任务会在需要时处理声音。</p>
          <div className="sv-actions"><Button variant="primary" disabled={!!busy||voicePreview?.status==='running'||!String(value('video_script')||'').trim()||(audioSource==='upload'&&!voiceFile)||health?.python===false} onClick={()=>void generateVoicePreview()}>{voicePreview?.status==='completed'?'重新生成声音预览':'生成声音预览'}</Button></div>
         {voicePreview?.status==='running'&&voicePreview.id!==displayedAudio?.id&&<p className="sv-help">新配音生成中 · {voicePreview.progress}%</p>}
         {displayedAudio&&<div><p className="sv-help">{audioRecord?'已保存的配音 · 来源任务':'生成状态'}：{labels[displayedAudio.status]}{displayedAudio.status==='running'?` · ${displayedAudio.progress}%`:''}</p>{displayedAudio.status==='running'&&<progress className="sv-progress" max="100" value={displayedAudio.progress}/>}{displayedAudio.error&&<div className="sv-error">{displayedAudio.error}</div>}{displayedAudio.artifacts.filter(a=>a.kind==='audio').map(a=><audio controls preload="metadata" key={a.file} src={url(displayedAudio,a.file)}/>)}</div>}
         {voicePreview?.status==='completed'&&voicePreviewIssue&&<div className="sv-error">{voicePreviewIssue}</div>}
        </div>}
     </div><aside><div className="sv-card"><h2>下一步：字幕</h2><p className="sv-help">上传音频和 AI 视频原声使用 Whisper 识别实际语音；无语音时不生成字幕。</p><div className="sv-actions"><Button variant="outline" onClick={()=>setTab('assets')}>返回素材与画面</Button><Button variant="primary" onClick={()=>setTab('subtitle')}>下一步：字幕</Button></div></div></aside></div>}
    {tab==='subtitle'&&<div className="sv-grid"><div><div className="sv-card"><h2>字幕</h2><p className="sv-help">字幕按最终使用的声音生成。上传旁白及视频原声使用 Whisper 识别实际语音；可以在制作前修改字幕。</p>{check('添加字幕','subtitle_enabled')}
      {Boolean(draft.params.subtitle_enabled)&&<>{choice('显示方式','subtitle_display_mode',[{id:'sentence',name:'整句'},{id:'word_by_word',name:'逐字'}])}{choice('字幕动画','subtitle_animation',[{id:'none',name:'无'},{id:'pop_spring',name:'弹跳'}])}{choice('位置','subtitle_position',[{id:'bottom',name:'底部'},{id:'two_thirds_bottom',name:'下三分之一'},{id:'center',name:'居中'},{id:'top',name:'顶部'},{id:'custom',name:'自定义'}])}{draft.params.subtitle_position==='custom'&&number('自定义位置 %','custom_position',0,100)}
      <div className="sv-field"><label htmlFor="font_name">本机字体</label><select className="sv-input" id="font_name" value={String(value('font_name'))} onChange={e=>update('font_name',e.target.value)}><option value="">自动选择系统字体</option>{health?.fonts?.map(f=><option key={f.path} value={f.path}>{f.name}</option>)}</select></div>
      <div className="sv-row">{number('字号','font_size',12,160)}{number('描边宽度','stroke_width',0,10,.5)}</div>
      <div className="sv-row">{field('文字颜色','text_fore_color')}{field('描边颜色','stroke_color')}</div>
       <div className="sv-field"><label htmlFor="subtitleBackground">字幕背景</label><select className="sv-input" id="subtitleBackground" value={String(value('text_background_color')||'')} onChange={e=>update('text_background_color',e.target.value||false)}><option value="">无</option><option value="#000000">黑色</option><option value="#333333">深灰</option><option value="#FFFFFF">白色</option></select></div>{check('字幕背景圆角','rounded_subtitle_background')}</>}</div>
       {Boolean(draft.params.subtitle_enabled)&&<div className="sv-card"><h2>字幕预览</h2><div className="sv-actions"><Button variant="primary" disabled={!!busy||(draft.params.video_source==='cqai_video'&&!materialPreviewReady)||(audioSource==='upload'&&!voiceFile&&!voicePreviewReady)||health?.python===false} onClick={()=>void generateSubtitlePreview()}>生成并预览字幕</Button></div>
         {subtitlePreview&&<p className="sv-help">字幕任务：{labels[subtitlePreview.status]}{subtitlePreview.status==='running'?` · ${subtitlePreview.progress}%`:''}{subtitlePreview.error?` · ${subtitlePreview.error}`:''}</p>}
         {subtitlePreviewReady&&Array.from({length:Number(value('video_count'))},(_,offset)=>offset+1).map(index=><div className="sv-field" key={index}><label htmlFor={`subtitle-editor-${index}`}>成片 {index} 字幕</label><textarea className="sv-input long" id={`subtitle-editor-${index}`} value={subtitleEditors[index]??''} onChange={e=>setSubtitleEditors(previous=>({...previous,[index]:e.target.value}))}/><p className="sv-help">{subtitleEditors[index]?.trim()?'可修改 SRT 内容和时间，再保存。':'未生成字幕。未识别到语音时可直接制作无字幕成片。'}</p><Button variant="outline" disabled={!!busy} onClick={()=>void saveSubtitle(index)}>保存成片 {index} 字幕</Button></div>)}
       </div>}
       {subtitleRecord&&subtitleArtifact&&subtitleRecord.id!==subtitlePreviewId&&<div className="sv-card"><h2>已生成字幕</h2><p className="sv-help">生成方式：{subtitleRecord.subtitleProvider==='whisper'?'Whisper':subtitleRecord.subtitleProvider==='edge'?'Edge TTS':'历史设置未记录'}</p>
         {subtitleText?.jobId===subtitleRecord.id&&subtitleText.file===subtitleArtifact.file&&<pre className="sv-log">{subtitleText.text}</pre>}
         <a className="sv-artifact" href={url(subtitleRecord,subtitleArtifact.file,true)} download={subtitleArtifact.name}>↓ 下载 {subtitleArtifact.name}</a>
       </div>}
     </div><aside><div className="sv-card"><h2>字幕引擎</h2>{audioSource==='tts' ? onOpenSettings ? <p className="sv-help">当前使用 {subtitleProvider==='whisper' ? 'Whisper 识别' : 'Edge TTS 对齐'}。请在 e剪宝 顶部的“设置”中修改字幕引擎。</p> : <><div className="sv-field"><label htmlFor="subtitle_provider">字幕生成方式</label><select className="sv-input" id="subtitle_provider" value={settings.subtitle_provider} onChange={e=>setSettings({...settings,subtitle_provider:e.target.value as Settings['subtitle_provider']})}><option value="edge">Edge TTS 对齐</option><option value="whisper">Whisper 识别</option></select></div>{settings.subtitle_provider!==savedSettings?.subtitle_provider&&<p className="sv-help">字幕引擎尚未保存。</p>}<Button variant="primary" disabled={!!busy} onClick={saveSettings}>保存字幕引擎</Button></> : <p className="sv-help">当前声音来源自动使用 Whisper；识别结果以实际语音为准。</p>}</div>{voicePreviewReady&&<div className="sv-card"><h2>已确认的声音</h2>{voicePreview!.artifacts.filter(a=>a.kind==='audio').map(a=><audio controls preload="metadata" key={a.file} src={url(voicePreview!,a.file)}/>)}</div>}{subtitleReuseIssue&&<div className="sv-error">{subtitleReuseIssue}</div>}<div className="sv-actions"><Button variant="outline" onClick={()=>setTab('audio')}>返回声音</Button><Button variant="primary" onClick={()=>setTab('advanced')}>下一步：制作</Button></div></aside></div>}
    {tab==='advanced'&&<><div className="sv-grid"><div><div className="sv-card"><h2>制作参数</h2>
      <div className="sv-row">{choice('拼接顺序','video_concat_mode',[{id:'random',name:'随机'},{id:'sequential',name:'顺序'}])}{choice('转场','video_transition_mode',transitions)}</div>
      <div className="sv-row">{draft.params.video_source!=='cqai_video'&&number('生成成片数量','video_count',1,5)}{number('渲染线程','n_threads',1,16)}</div>
      {choice('视频比例','video_aspect',[{id:'9:16',name:'竖屏 9:16'},{id:'16:9',name:'横屏 16:9'},{id:'1:1',name:'方形 1:1'}])}
    </div></div><aside><div className="sv-card"><h2>开始制作</h2><p className="sv-help">主题：{String(value('video_subject')||'使用自写文案')}</p><p className="sv-help">文案：{String(value('video_script')||'未填写').slice(0,100)}</p><p className="sv-help">关键词：{String(value('video_terms')||'未填写，制作时自动生成').slice(0,100)}</p><p className="sv-help">文本模型：{catalog?.text.find(m=>m.id===draft.textModel)?.name||'未选择'}</p>
      {stageRequirements(draft).videoModel&&<p className="sv-help">视频模型：{catalog?.video?.find(m=>m.id===draft.videoModel)?.name||'未选择'}</p>}
      <h3>制作到哪一步</h3><div className="sv-stage">{stages.map(s=><label key={s.id}><input type="radio" name="stage" disabled={!!busy} checked={draft.stopAt===s.id} onChange={()=>setDraft({...draft,stopAt:s.id})}/>{s.label}</label>)}</div>
      {modelNeeded&&!catalog?.signedIn&&<div className="sv-error">需要模型时，请先在“设置 · CQAI Club”登录账号。</div>}
      {stageRequirements(draft).videoModel&&!materialPreviewReady&&videoModelWarning&&<div className="sv-error" role="alert">{videoModelWarning}</div>}
      {selectedStageIssue&&<div className="sv-error">{selectedStageIssue}</div>}
      {materialKeyWarning&&<div className="sv-error">{materialKeyWarning}{onOpenSettings ? <p className="sv-help">请在 e剪宝 顶部的“设置”中配置素材平台连接。</p> : <div className="sv-actions"><Button variant="outline" onClick={openSettings}>前往设置</Button></div>}</div>}
      <div className="sv-actions"><Button variant="outline" onClick={()=>setTab('subtitle')}>返回字幕</Button><Button variant="primary" disabled={!!busy||(!String(value('video_subject')||'').trim()&&!String(value('video_script')||'').trim())||(modelNeeded&&!catalog?.signedIn)||(stageRequirements(draft).videoModel&&!materialPreviewReady&&!!videoModelWarning)||!!selectedStageIssue||health?.python===false} onClick={()=>void create()}>{busy||(draft.stopAt==='audio'?'生成配音':draft.stopAt==='materials'?'准备素材':draft.stopAt==='subtitle'?'生成字幕':'开始制作')}</Button></div>
       <p className="sv-help">模型请求和第三方素材服务可能消耗额度。渲染期间请保持应用运行。</p></div></aside></div>
      <section className="sv-card" aria-label="当前任务记录">
        <h2>当前任务记录</h2>
        {job?<>
          <p className="sv-help">{String(job.params.video_subject||job.params.video_script||'未命名').slice(0,100)} · {new Date(job.createdAt).toLocaleString()}</p>
          <p className="sv-sub">{labels[job.status]} · {job.progress}%</p>
          <progress className="sv-progress" aria-label="任务进度" max="100" value={job.progress}/>
          <div className="sv-actions">
            <Button variant="outline" disabled={!!openingFolder} aria-busy={openingFolder==='task'} title="打开当前任务保存配音、字幕和成片的文件夹" onClick={()=>void openJobFolder(job,'task')}>{openingFolder==='task'?'正在打开…':'打开文件夹'}</Button>
            {['materials','subtitle','video'].includes(job.stopAt)&&<Button variant="outline" disabled={!!openingFolder} aria-busy={openingFolder==='materials'} title="打开素材保存目录；素材库和本地上传目录由多个任务共用" onClick={()=>void openJobFolder(job,'materials')}>{openingFolder==='materials'?'正在打开…':'打开素材文件夹'}</Button>}
          </div>
          {job.error&&<div className="sv-error">{job.error}</div>}
          {job.subtitleDurations?.map((duration,index)=><p className="sv-help" key={`duration-${index}`}>成片 {index+1} 实际时长：{duration.toFixed(1)} 秒</p>)}
          {Array.isArray(job.state?.warnings)&&job.state.warnings.map((warning,index)=>warning?.code==='missing_original_audio'?<p className="sv-help" key={`warning-${index}`}>成片 {warning.video_index} 有 {warning.silent_clips} 个镜头没有音轨，已填充静音。</p>:warning?.code==='material_shorter_than_target'?<p className="sv-help" key={`warning-${index}`}>成片 {warning.video_index} 的素材仅能剪出约 {Number(warning.actual_duration).toFixed(1)} 秒，未自动增加付费镜头。</p>:null)}
          {currentWorkflow&&currentWorkflow.jobs.length>1&&<details open><summary>阶段任务（{currentWorkflow.jobs.length}）</summary><div className="sv-list sv-record-stages">{currentWorkflow.jobs.map(item=><button type="button" className="sv-job" aria-current={job.id===item.id?'true':undefined} key={item.id} onClick={()=>setSelected(item.id)}><span><strong>{stages.find(stage=>stage.id===item.stopAt)?.label||item.stopAt}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span><Tag tone={item.status==='completed'?'success':item.status==='failed'||item.status==='interrupted'||item.status==='cancelled'?'danger':item.status==='running'?'info':'neutral'}>{labels[item.status]}</Tag></button>)}</div></details>}
          <div className="sv-actions">{job.status==='running'?<Button variant="outline" className="sv-danger" disabled={!!busy} onClick={()=>void action('取消任务…',async()=>{await api(`cancel?id=${job.id}`,{});await refresh()})}>取消</Button>:<><Button variant="outline" disabled={!!busy} onClick={()=>restore(job)}>使用相同参数</Button>{job.status==='completed'&&['audio','subtitle'].includes(job.stopAt)&&!!job.params.video_script&&job.artifacts.some(a=>a.kind==='audio')&&<Button variant="primary" disabled={!!busy} onClick={()=>continueWithVoice(job)}>继续使用这段配音</Button>}{job.status!=='completed'&&<Button variant="primary" disabled={!!busy} onClick={()=>void action('重新开始…',async()=>{await api(`start?id=${job.id}`,{});await refresh()})}>重新开始</Button>}<Button variant="outline" className="sv-danger" disabled={!!busy} onClick={()=>deleteJob(job)}>删除</Button></>}</div>
          {!!job.videoTasks?.length&&<details open><summary>CQAI 视频素材任务</summary>{job.videoTasks.map(task=><p className="sv-help" key={task.key}>镜头 {Number(task.key)+1} · {videoTaskLabels[task.status]}{task.progress===undefined?'':` ${task.progress}%`} · {task.id||'远端 ID 未确认'}</p>)}</details>}
          {typeof job.state?.script==='string'&&<details open><summary>生成文案</summary><pre className="sv-log">{job.state.script}</pre></details>}
          {Array.isArray(job.state?.terms)&&<details><summary>素材关键词</summary><pre className="sv-log">{job.state.terms.join(', ')}</pre></details>}
          {job.artifacts.filter(a=>a.kind==='audio').map(a=><audio controls preload="metadata" key={a.file} src={url(job,a.file)}/>)}
          {job.artifacts.filter(a=>a.kind==='video').map(a=><video controls preload="metadata" key={a.file} src={url(job,a.file)} />)}
          {job.artifacts.length>0&&<div>{job.artifacts.map(a=><a className="sv-artifact" key={a.file} href={url(job,a.file,true)} download={a.name}><span>↓ {a.name}</span><span>{(a.size/1048576).toFixed(1)} MB</span></a>)}</div>}
          <details open={job.status==='failed'}><summary>制作日志</summary><pre className="sv-log">{job.logs.join('\n')||'暂无日志'}</pre></details>
        </>:<div className="sv-empty">还没有任务。准备好文案、声音和素材后即可开始制作。</div>}
      </section>
      {completedVideoRecord&&completedVideoRecord.id!==job?.id&&<section className="sv-card" aria-label="历史成片"><h2>已生成成片</h2><p className="sv-help">来自同一制作流程的较早阶段 · {new Date(completedVideoRecord.createdAt).toLocaleString()}</p>
        {completedVideoRecord.artifacts.filter(artifact=>artifact.kind==='video'&&artifact.file.startsWith('final-')).map(artifact=><div key={artifact.file}><video controls preload="metadata" src={url(completedVideoRecord,artifact.file)}/><a className="sv-artifact" href={url(completedVideoRecord,artifact.file,true)} download={artifact.name}>↓ 下载 {artifact.name}</a></div>)}
      </section>}</>}
    {tab==='history'&&<div className="sv-card">
      <h2>历史任务（{workflows.length}）</h2>
      <p className="sv-help">同一次制作的配音、失败重做和成片合为一条记录。选择任务后会还原各步骤保存的内容，并在“制作”页查看阶段结果和日志。</p>
      <div className="sv-actions">{([['all','全部'],['running','进行中'],['completed','已完成'],['failed','失败 / 中断']] as const).map(([id,label])=><Button variant="outline" aria-pressed={filter===id} key={id} onClick={()=>setFilter(id)}>{label}</Button>)}</div>
      <div className="sv-list">{filteredWorkflows.length?filteredWorkflows.map(group=>{
        const item=workflowDisplayJob(group)
        const running=group.jobs.some(candidate=>candidate.status==='running')
        return <div className="sv-history-row" key={group.id}>
          <button type="button" className="sv-job" aria-current={currentWorkflow?.id===group.id?'true':undefined} onClick={()=>openWorkflow(group)}><span><strong>{String(item.params.video_subject||item.params.video_script||'未命名').slice(0,50)}</strong><small>{new Date(item.createdAt).toLocaleString()} · {stages.find(stage=>stage.id===item.stopAt)?.label||item.stopAt}{group.jobs.length>1?` · ${group.jobs.length} 个阶段任务`:''}</small></span><Tag tone={item.status==='completed'?'success':item.status==='failed'||item.status==='interrupted'||item.status==='cancelled'?'danger':item.status==='running'?'info':'neutral'}>{labels[item.status]}</Tag></button>
          <Button variant="outline" className="sv-danger sv-history-delete" aria-label={`删除历史任务：${String(item.params.video_subject||item.params.video_script||'未命名').slice(0,50)}`} title={running?'运行中的任务不可删除':'删除整条历史任务及其文件'} disabled={!!busy||running} onClick={()=>deleteWorkflow(group)}>删除</Button>
        </div>
      }):<div className="sv-empty">{filter==='all'?'还没有任务。到“主题与文案”页开始制作。':'没有符合筛选条件的任务。'}</div>}</div>
    </div>}
    {tab==='settings'&&<div className="sv-grid"><div><div className="sv-card"><h2>运行环境</h2><p className="sv-help">制作引擎基于 MoneyPrinterTurbo 1.3.7。点击安装会在应用私有目录准备 Python 3.11、锁定依赖和 FFmpeg，无需预装系统工具。</p>
      <div className="sv-kv"><Tag tone={health?.python?'success':'neutral'}>Python 与引擎 {health?.python?'就绪':'待安装'}</Tag><Tag tone={health?.ffmpeg?'success':'neutral'}>FFmpeg {health?.ffmpeg?'就绪':'待安装'}</Tag><Tag tone={health?.uv?'success':'neutral'}>内置 uv {health?.uv?'就绪':'未就绪'}</Tag></div>
      {health?.error&&<div className="sv-error">{health.error}</div>}
      <div className="sv-actions"><Button variant="primary" disabled={health?.setup?.status==='running'||!!busy} onClick={()=>void action('启动安装…',async()=>{const setup=await api<Setup>('setup',{});setHealth(value=>({...value,setup}));setNotice('正在安装缺失依赖，完成后自动复检。')})}>{health?.setup?.status==='running'?'正在安装…':'安装 / 修复依赖'}</Button><Button variant="outline" onClick={()=>void api<Health>('health').then(setHealth)}>重新检查</Button></div>
      {health?.setup?.items?.map(item=><p className="sv-help" key={item.id}>{item.status==='running'?'正在处理':item.status==='completed'||item.status==='ready'?'✓':item.status==='failed'?'失败':'待处理'} {item.label}{item.detail?`：${item.detail}`:''}</p>)}
      {health?.setup?.status==='failed'&&<p className="sv-error">有依赖安装失败；点击按钮可重试未就绪项。</p>}{health?.setup?.logs?.length?<pre className="sv-log">{health.setup.logs.join('\n')}</pre>:null}
    </div><div className="sv-card"><MediaSettingsEditor api={API} engine="shortVideo" onChange={()=>{void api<Settings>('settings').then(next=>{setSettings(next);setSavedSettings(next)}).catch(()=>{})}}/>     </div></div><aside><div className="sv-card"><h2>编码</h2>
      <div className="sv-field"><label>FFmpeg 编码器</label><select className="sv-input" value={settings.video_codec} onChange={e=>setSettings({...settings,video_codec:e.target.value as Settings['video_codec']})}><option value="libx264">CPU · H.264</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="h264_qsv">Intel QSV</option><option value="h264_amf">AMD AMF</option></select></div>
      <Button variant="primary" disabled={!!busy} onClick={saveSettings}>保存设置</Button></div><div className="sv-card"><h2>模型来源</h2><p className="sv-help">仅从 CQAI Club 账号读取模型。当前文本模型 {catalog?.text.length??0} 个，图片模型 {catalog?.image.length??0} 个，视频模型 {catalog?.video?.length??0} 个。</p><Button variant="outline" onClick={()=>void reloadCatalog().catch(e=>setError(e.message))}>刷新模型列表</Button></div></aside></div>}
  </div></section>
}
export function apply(ctx:Context):void{
  mountVideoWorkspace(ctx,{id:'short-video',panelId:PANEL,label:'短视频制作',order:42,icon:ShortVideoPanelIcon,component:Studio})
}
