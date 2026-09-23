import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useRef, useState } from 'react'
import { API, audioPreviewReuseIssue, defaultParams, defaultSettings, needsText, stageRequirements, type Catalog, type ContentAction, type ContentResult, type Draft, type Job, type Settings, type Stage, type UploadKind } from '../protocol.ts'

export const inject = ['slots']
const PANEL = 'cqai-short-video' as MainPanelId
const initial: Draft = {textModel:'',imageModel:'',stopAt:'video',params:{...defaultParams}}
const stages: {id:Stage;label:string}[] = [{id:'script',label:'文案'},{id:'terms',label:'关键词'},{id:'audio',label:'配音'},{id:'subtitle',label:'字幕'},{id:'materials',label:'素材'},{id:'video',label:'完整成片'}]
const sources = [{id:'pexels',name:'Pexels 素材库'},{id:'pixabay',name:'Pixabay 素材库'},{id:'coverr',name:'Coverr 素材库'},{id:'openai_image',name:'CQAI Club 图片生成'},{id:'local',name:'本地视频 / 图片'}]
const transitions = [{id:'',name:'无转场'},{id:'Shuffle',name:'随机'},{id:'FadeIn',name:'渐入'},{id:'FadeOut',name:'渐出'},{id:'SlideIn',name:'滑入'},{id:'SlideOut',name:'滑出'},{id:'ZoomIn',name:'放大'},{id:'ZoomOut',name:'缩小'}]
const scriptLanguages = [{id:'',name:'自动识别'},{id:'zh-CN',name:'简体中文'},{id:'zh-HK',name:'香港中文'},{id:'zh-TW',name:'繁体中文'},{id:'en-US',name:'English'},{id:'ca-ES',name:'Català'},{id:'de-DE',name:'Deutsch'},{id:'es-ES',name:'Español'},{id:'fr-FR',name:'Français'},{id:'it-IT',name:'Italiano'},{id:'ru-RU',name:'Русский'},{id:'vi-VN',name:'Tiếng Việt'},{id:'th-TH',name:'ไทย'},{id:'tr-TR',name:'Türkçe'}]
const normalizeLanguage=(value:unknown):string=>value==='zh'?'zh-CN':value==='en'?'en-US':typeof value==='string'?value:''
const labels: Record<Job['status'],string> = {draft:'待开始',running:'制作中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'}
type Health = {python?:boolean;ffmpeg?:boolean;voices?:string[];fonts?:{name:string;path:string}[];uv?:boolean;error?:string;setup?:{status:string;logs:string[]}}
async function api<T>(route:string,data?:unknown):Promise<T>{
  const response=await fetch(`${API}/${route}`,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-short-video':'1'},body:JSON.stringify(data)})
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('短视频制作服务暂未就绪')
  const result=await response.json();if(!response.ok)throw new Error(result.error||'请求失败');return result as T
}
async function upload(id:string,kind:UploadKind,file:File):Promise<Job>{
  const response=await fetch(`${API}/upload?id=${encodeURIComponent(id)}&kind=${kind}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'x-short-video':'1'},body:file})
  const value=await response.json();if(!response.ok)throw new Error(value.error||'上传失败');return value as Job
}
function url(job:Job,file:string,download=false){return `${API}/artifact?id=${encodeURIComponent(job.id)}&file=${encodeURIComponent(file)}${download?'&download=1':''}`}
function Icon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9 9 6 3-6 3V9ZM3 8h18"/></svg>}
const css = `
.sv audio{display:block;width:100%;margin:12px 0}
.sv{height:100%;overflow:auto;background:#111317;color:#f0f1f5;font:14px/1.55 system-ui,sans-serif;box-sizing:border-box}.sv *{box-sizing:border-box}.sv button,.sv input,.sv select,.sv textarea{font:inherit}.sv button{cursor:pointer}.sv button:disabled{opacity:.45;cursor:wait}.sv-wrap{max-width:1360px;padding:29px 36px 64px;margin:auto}.sv-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.sv h1{font-size:28px;line-height:1.2;margin:0 0 6px;letter-spacing:-.8px}.sv h2{font-size:17px;margin:0 0 16px}.sv h3{font-size:13px;margin:0 0 11px;color:#b9c9cc}.sv-sub{color:#98a4ad;font-size:13px}.sv-badge{background:#1d6b6560;color:#9de5d8;border:1px solid #53b4a266;border-radius:50px;padding:6px 11px;font-size:12px;white-space:nowrap}.sv-tabs{display:flex;gap:5px;border-bottom:1px solid #ffffff20;margin-bottom:22px;overflow:auto}.sv-tabs button{border:0;border-bottom:2px solid transparent;background:none;color:#a5adb5;padding:11px 14px;white-space:nowrap}.sv-tabs button[aria-selected=true]{color:#85dfca;border-color:#6cd4bb}.sv-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(270px,.8fr);gap:20px}.sv-card{background:#ffffff06;border:1px solid #ffffff18;border-radius:16px;padding:21px;margin-bottom:17px}.sv-field{margin:0 0 17px}.sv-field>label{display:block;font-size:12px;font-weight:600;color:#b9c8cb;margin-bottom:7px}.sv-input{width:100%;padding:10px 12px;border:1px solid #ffffff2b;border-radius:9px;background:#0b1015;color:inherit;outline:none}.sv-input:focus{border-color:#58c8b5}.sv textarea{min-height:122px;resize:vertical;line-height:1.7}.sv textarea.long{min-height:225px}.sv select option{background:#141b20}.sv-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}.sv-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.sv-check{display:flex;gap:9px;align-items:center;margin:10px 0;color:#d6dce0}.sv-check input{accent-color:#64d2bd}.sv-help{font-size:12px;color:#86959e;margin:5px 0 0}.sv-chip{display:inline-block;background:#1c2f32;color:#b8e4dc;border-radius:5px;padding:2px 7px;margin:0 5px 5px 0;font-size:11px}.sv-primary{background:#74d6c3;border:0;border-radius:9px;color:#0c2525;padding:11px 18px;font-weight:700!important}.sv-secondary{background:#ffffff08;border:1px solid #ffffff28;border-radius:9px;color:inherit;padding:9px 14px}.sv-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.sv-danger{color:#ffb7b7;border-color:#ff8a8a55}.sv-error{border:1px solid #d56c6c77;background:#d56c6c14;color:#ffc4c4;padding:11px;border-radius:9px;margin:12px 0;white-space:pre-wrap}.sv-success{border:1px solid #6acd9970;background:#6acd9914;color:#b8efd1;padding:11px;border-radius:9px;margin:12px 0}.sv-upload{border:1px dashed #5c797a;border-radius:9px;padding:13px;margin-bottom:11px}.sv-upload strong{display:block;font-size:12px;margin-bottom:5px}.sv-upload input{max-width:100%;font-size:12px}.sv-list{display:grid;gap:8px}.sv-job{width:100%;display:flex;justify-content:space-between;gap:12px;text-align:left;color:inherit;background:#ffffff05;border:1px solid #ffffff1e;border-radius:10px;padding:12px}.sv-job[aria-selected=true]{border-color:#69cfbc;background:#21514a50}.sv-job small{display:block;color:#9eabb1;margin-top:3px}.sv-job em{font-size:12px;color:#8de0ce;font-style:normal;white-space:nowrap}.sv video{width:100%;max-height:520px;background:#050708;border-radius:10px;margin:12px 0}.sv-log{font:11px/1.5 Consolas,monospace;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#050a0d;padding:12px;border-radius:7px;color:#aab4bc}.sv-artifact{display:flex;justify-content:space-between;color:#94e2d3;text-decoration:none;border-bottom:1px solid #ffffff16;padding:9px 2px;font-size:12px}.sv-progress{width:100%;accent-color:#75d4c2}.sv-kv{display:flex;gap:7px;flex-wrap:wrap}.sv-kv span{font-size:11px;padding:4px 8px;border-radius:5px;background:#ffffff0c;color:#aeb9bc}.sv-kv .ok{color:#92e1bc}.sv-empty{border:1px dashed #ffffff27;border-radius:10px;text-align:center;padding:32px;color:#9eaaaf}.sv-stage{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.sv-stage label{font-size:12px;display:flex;align-items:center;gap:5px;border:1px solid #ffffff22;border-radius:7px;padding:7px}.sv-stage input{accent-color:#62ceb9}@media(max-width:900px){.sv-wrap{padding:20px 17px}.sv-grid,.sv-row,.sv-row3{grid-template-columns:1fr}.sv-top{align-items:flex-start}}
`
function Studio(){
  const [tab,setTab]=useState<'create'|'assets'|'audio'|'advanced'|'history'|'settings'>('create')
  const [draft,setDraft]=useState<Draft>(initial)
  const [settings,setSettings]=useState<Settings>(defaultSettings)
  const [catalog,setCatalog]=useState<Catalog>()
  const [health,setHealth]=useState<Health>()
  const [jobs,setJobs]=useState<Job[]>([])
  const [selected,setSelected]=useState('')
  const [filter,setFilter]=useState<'all'|'running'|'completed'|'failed'>('all')
  const [materials,setMaterials]=useState<File[]>([])
  const [voiceFile,setVoiceFile]=useState<File>()
  const [voicePreviewId,setVoicePreviewId]=useState('')
  const [bgmFile,setBgmFile]=useState<File>()
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [preview,setPreview]=useState<ContentResult>()
  const importRef=useRef<HTMLInputElement>(null)
  const job=jobs.find(x=>x.id===selected)
  const voicePreview=jobs.find(x=>x.id===voicePreviewId)
  const voicePreviewIssue=voicePreview?audioPreviewReuseIssue(voicePreview,draft,settings.subtitle_provider):'请先生成并试听配音'
  const voicePreviewReady=!!voicePreview&&!voicePreviewIssue
  const needsVoicePreview=!['script','terms'].includes(draft.stopAt)
  const filteredJobs=jobs.filter(item=>filter==='all'||(filter==='failed'&&['failed','interrupted','cancelled'].includes(item.status))||item.status===filter)
  const modelNeeded=needsText(draft)||stageRequirements(draft).imageModel
  const update=(key:string,value:unknown)=>{setPreview(undefined);if(['video_script','voice_name','voice_rate','voice_volume'].includes(key)||(key==='subtitle_enabled'&&value===true)||(key==='subtitle_display_mode'&&Boolean(draft.params.subtitle_enabled)))setVoicePreviewId('');setDraft(prev=>({...prev,params:{...prev.params,[key]:value}}))}
  const value=(key:string)=>draft.params[key]
  const refresh=()=>api<Job[]>('jobs').then(setJobs)
  const reloadCatalog=()=>api<Catalog>('catalog').then(c=>{setCatalog(c);setDraft(prev=>({...prev,textModel:prev.textModel||c.defaultText||c.text[0]?.id||'',imageModel:prev.imageModel||c.defaultImage||c.image[0]?.id||''}))})
  useEffect(()=>{let active=true;const poll=()=>{void api<Job[]>('jobs').then(data=>{if(active)setJobs(data)}).catch(()=>{})}
    void reloadCatalog().catch(e=>setError(e.message));void api<Settings>('settings').then(setSettings).catch(()=>{});void api<Health>('health').then(setHealth).catch(()=>{});poll()
    const timer=setInterval(poll,2000);const healthTimer=setInterval(()=>{void api<Health>('health').then(data=>{if(active)setHealth(data)}).catch(()=>{})},10000)
    return()=>{active=false;clearInterval(timer);clearInterval(healthTimer)}
  },[])
  const field=(label:string,key:string,help?:string,multiline=false)=>{
    const maxLength:Record<string,number>={video_subject:500,video_script:30000,video_terms:4000,video_script_prompt:2000,custom_system_prompt:8000}
    return <div className="sv-field"><label htmlFor={key}>{label}</label>{multiline?<textarea className="sv-input long" id={key} disabled={!!busy} maxLength={maxLength[key]} value={String(value(key)??'')} onChange={e=>update(key,e.target.value)}/>:<input className="sv-input" id={key} disabled={!!busy} maxLength={maxLength[key]} value={String(value(key)??'')} onChange={e=>update(key,e.target.value)}/>} {help&&<p className="sv-help">{help}</p>}</div>
  }
  const number=(label:string,key:string,min:number,max:number,step=1)=><div className="sv-field"><label htmlFor={key}>{label}</label><input className="sv-input" id={key} disabled={!!busy} type="number" min={min} max={max} step={step} value={Number(value(key))} onChange={e=>update(key,Number(e.target.value))}/></div>
  const choice=(label:string,key:string,items:{id:string;name:string}[])=><div className="sv-field"><label htmlFor={key}>{label}</label><select className="sv-input" id={key} disabled={!!busy} value={String(value(key)??'')} onChange={e=>update(key,key==='video_transition_mode'&&!e.target.value?null:e.target.value)}>{items.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
  const check=(label:string,key:string)=><label className="sv-check"><input type="checkbox" disabled={!!busy} checked={Boolean(value(key))} onChange={e=>update(key,e.target.checked)}/>{label}</label>
  const action=async<T,>(label:string,operation:()=>Promise<T>)=>{setBusy(label);setError('');setNotice('');try{return await operation()}catch(e){setError(e instanceof Error?e.message:String(e));return undefined}finally{setBusy('')}}
  async function contentAction(kind:ContentAction){
    if(kind==='script'&&String(draft.params.video_script||'').trim()&&!window.confirm('重新生成会替换当前文案与关键词，继续吗？'))return
    await action(kind==='preview'?'正在准备提示词…':'正在生成内容…',async()=>{
      const result=await api<ContentResult>('content',{action:kind,draft})
      if(kind==='preview'){setPreview(result);return}
      if(!result.terms?.length || (kind==='script'&&!result.script?.trim()))throw new Error('未收到完整的文案或关键词')
      setDraft(prev=>({...prev,params:{...prev.params,...(kind==='script'?{video_script:result.script}:{}),video_terms:result.terms!.join(', ')}}))
      if(kind==='script')setVoicePreviewId('')
      setPreview(undefined)
      setNotice(kind==='script'?'文案与关键词已生成，请检查并修改后继续。':'关键词已更新，请检查后继续。')
    })
  }
  async function generateVoicePreview(){
    await action('正在启动配音…',async()=>{
      if(!String(draft.params.video_script||'').trim())throw new Error('请先填写视频文案')
      const previewDraft:Draft={...draft,textModel:'',imageModel:'',stopAt:'subtitle',params:{...draft.params,video_source:'local',video_terms:''}}
      const next=await api<Job>('jobs',previewDraft)
      if(voiceFile)await upload(next.id,'audio',voiceFile)
      await api<Job>(`start?id=${next.id}`,{})
      setVoicePreviewId(next.id);await refresh()
      setNotice('配音和字幕正在生成。完成后可试听，再进入素材设置。')
    })
  }
  async function create(){
    await action('正在创建任务…',async()=>{
      if(needsVoicePreview&&!voicePreviewReady)throw new Error(voicePreviewIssue)
      if(voicePreviewReady&&['audio','subtitle'].includes(draft.stopAt)){
        setSelected(voicePreview!.id);setTab('history');return
      }
      const next=await api<Job>('jobs',{...draft,...(needsVoicePreview?{audioPreviewJobId:voicePreview!.id}:{})});setSelected(next.id);setTab('history')
      const requirements=stageRequirements(draft)
      if(requirements.materialUpload)for(const file of materials)await upload(next.id,'material',file)
      if(requirements.backgroundMusicUpload&&bgmFile)await upload(next.id,'bgm',bgmFile)
      await api<Job>(`start?id=${next.id}`,{});await refresh()
      setNotice('任务已开始，制作进度保存在本机。')
    })
  }
  function restore(item:Job){
    const script=typeof item.state?.script==='string'?item.state.script:''
    const terms=Array.isArray(item.state?.terms)&&item.state.terms.every(term=>typeof term==='string')?item.state.terms.join(', '):''
    setDraft({textModel:item.textModel,imageModel:item.imageModel,stopAt:item.stopAt,params:{...item.params,video_language:normalizeLanguage(item.params.video_language),...(script?{video_script:script}:{}),...(terms?{video_terms:terms}:{})}})
    setPreview(undefined);setVoicePreviewId('');setMaterials([]);setVoiceFile(undefined);setBgmFile(undefined);setTab('create');setNotice('已载入任务内容；配音和本地素材请重新确认。')
  }
  function continueWithVoice(item:Job){
    setDraft({textModel:catalog?.defaultText||catalog?.text[0]?.id||'',imageModel:catalog?.defaultImage||catalog?.image[0]?.id||'',stopAt:'video',params:{...defaultParams,...item.params,video_source:'pexels',video_terms:''}})
    setVoicePreviewId(item.id);setVoiceFile(undefined);setMaterials([]);setBgmFile(undefined);setTab('audio')
    setNotice('已载入配音试听。确认声音后可重新选择素材并继续制作。')
  }
  function exportPreset(){const blob=new Blob([JSON.stringify(draft,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='short-video-preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  async function importPreset(file:File){await action('导入预设…',async()=>{const value=JSON.parse(await file.text()) as Partial<Draft>;if(!value.params||typeof value.params!=='object')throw new Error('预设格式无效');const keys=Object.keys(defaultParams);const params=Object.fromEntries(Object.entries(value.params).filter(([key])=>keys.includes(key)));params.video_language=normalizeLanguage(params.video_language);setDraft({...initial,textModel:catalog?.text.some(m=>m.id===value.textModel)?value.textModel||'':'',imageModel:catalog?.image.some(m=>m.id===value.imageModel)?value.imageModel||'':'',stopAt:stages.some(s=>s.id===value.stopAt)?value.stopAt!:'video',params:{...defaultParams,...params}});setPreview(undefined);setVoicePreviewId('');setVoiceFile(undefined);setNotice('预设已导入，模型仅保留当前 CQAI Club 账号可用的选择。')})}
  return <section className="sv"><style>{css}</style><div className="sv-wrap">
    <header className="sv-top"><div><h1>短视频制作</h1><div className="sv-sub">从主题到成片 · MoneyPrinterTurbo 制作引擎 · CQAI Club 模型</div></div><span className="sv-badge">独立插件</span></header>
    <nav className="sv-tabs">{([['create','① 主题与文案'],['audio','② 声音与字幕'],['assets','③ 素材与画面'],['advanced','④ 制作与开始'],['history','任务'],['settings','设置']] as const).map(([id,label])=><button key={id} aria-selected={tab===id} disabled={id==='assets'&&!voicePreviewReady} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {error&&<div className="sv-error">{error}</div>}{notice&&<div className="sv-success">{notice}</div>}
    {tab==='create'&&<div className="sv-grid"><div>
      <div className="sv-card"><h2>01 · 确定视频主题</h2>{field('视频主题','video_subject','例如：人工智能如何改变日常生活。已有完整文案时，主题可以留空。',true)}
        <div className="sv-row">{choice('文案语言','video_language',scriptLanguages)}{number('文案段落数','paragraph_number',1,10)}</div>
        {check('关键词按文案顺序排列','match_materials_to_script')}
        <details><summary>高级文案设置</summary><div style={{paddingTop:14}}>
          {field('文案补充要求','video_script_prompt','例如受众、语气、需要包含的内容。',true)}
          {field('自定义系统提示','custom_system_prompt','留空使用 MoneyPrinterTurbo 默认规则。',true)}
          <div className="sv-actions"><button className="sv-secondary" onClick={()=>update('custom_system_prompt','')}>恢复默认提示词</button><button className="sv-secondary" disabled={!!busy||!String(value('video_subject')||'').trim()||health?.python===false} onClick={()=>void contentAction('preview')}>预览最终提示词</button></div>
          {preview?.prompt&&<details open><summary>最终提示词</summary><pre className="sv-log">{preview.prompt}</pre><details><summary>MoneyPrinterTurbo 默认规则</summary><pre className="sv-log">{preview.defaultSystemPrompt}</pre></details></details>}
        </div></details>
      </div>
      <div className="sv-card"><h2>01 · 生成并校对文案与关键词</h2>
        <div className="sv-field"><label htmlFor="textModel">CQAI Club 文本模型</label><select className="sv-input" id="textModel" disabled={!!busy} value={draft.textModel} onChange={e=>setDraft({...draft,textModel:e.target.value})}><option value="">请选择</option>{catalog?.text.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="sv-help">用于生成文案与素材关键词。仅显示此账号可用的模型。</p></div>
        {!catalog?.signedIn&&<div className="sv-error">请先在“设置 · CQAI Club”登录账号，再返回选择模型。</div>}
        {catalog?.warning&&<p className="sv-help">{catalog.warning}</p>}
        <div className="sv-actions"><button className="sv-secondary" disabled={!!busy||!String(value('video_subject')||'').trim()||!draft.textModel||!catalog?.signedIn||health?.python===false} onClick={()=>void contentAction('script')}>{busy||'生成视频文案和关键词'}</button></div>
        <p className="sv-help">生成会调用所选 CQAI Club 模型；结果会填入下方，仍可修改。</p>
        {field('视频文案','video_script','可以自行撰写或修改生成结果。',true)}
        <div className="sv-actions"><button className="sv-secondary" disabled={!!busy||!String(value('video_script')||'').trim()||!draft.textModel||!catalog?.signedIn||health?.python===false} onClick={()=>void contentAction('terms')}>单独生成关键词</button></div>
        {field('素材关键词','video_terms','多个词用逗号分隔；可手动修改。',true)}
        <div className="sv-actions"><button className="sv-primary" disabled={!String(value('video_script')||'').trim()} onClick={()=>setTab('audio')}>确认内容，下一步：声音与字幕</button></div>
      </div>
    </div><aside><div className="sv-card"><h2>制作顺序</h2><p className="sv-help">先确定主题并准备文案、关键词，再设置配音和字幕，然后选择画面素材，最后开始制作。引擎会先生成声音与字幕，再根据配音时长准备画面。</p><p className="sv-help">已有文案也可直接粘贴；需要素材关键词时使用“单独生成关键词”。</p>
      <div className="sv-kv"><span className={health?.python?'ok':''}>Python {health?.python?'就绪':'未就绪'}</span><span className={health?.ffmpeg?'ok':''}>FFmpeg {health?.ffmpeg?'就绪':'未就绪'}</span></div>
      {health?.python===false&&<button className="sv-secondary" onClick={()=>setTab('settings')}>前往安装运行环境</button>}</div>
      <div className="sv-card"><h2>预设</h2><p className="sv-help">导入或导出表单参数；不会导出账号凭据或本地素材。</p><div className="sv-actions"><button className="sv-secondary" disabled={!!busy} onClick={exportPreset}>导出 JSON</button><button className="sv-secondary" disabled={!!busy} onClick={()=>importRef.current?.click()}>导入 JSON</button></div><input ref={importRef} type="file" hidden accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void importPreset(f);e.target.value=''}}/></div>
    </aside></div>}
    {tab==='assets'&&<div className="sv-grid"><div><div className="sv-card"><h2>03 · 素材与画面</h2>{choice('视频 / 图片来源','video_source',sources)}
      {draft.params.video_source==='local'&&<div className="sv-upload"><strong>本地素材（可多选）</strong><input type="file" multiple accept="video/*,image/*" onChange={e=>setMaterials([...e.target.files||[]])}/><p className="sv-help">{materials.length?materials.map(f=>f.name).join('、'):'上传的视频或图片将用于剪辑。'}</p></div>}
      {draft.params.video_source==='openai_image'&&<div className="sv-field"><label htmlFor="imageModel">CQAI Club 图片模型</label><select className="sv-input" id="imageModel" disabled={!!busy} value={draft.imageModel} onChange={e=>setDraft({...draft,imageModel:e.target.value})}><option value="">请选择</option>{catalog?.image.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><p className="sv-help">使用当前账号的图片生成模型，按关键词生成镜头图片。</p></div>}
      {draft.params.video_source==='pexels'||draft.params.video_source==='pixabay'||draft.params.video_source==='coverr'?<p className="sv-help">素材平台 API Key 在“设置”页配置。授权与可用素材以平台为准。</p>:null}
      <p className="sv-help">当前关键词：{String(value('video_terms')||'未填写；可以返回主题与文案页生成或修改')}</p>{check('按文案顺序匹配镜头','match_materials_to_script')}
      <div className="sv-actions"><button className="sv-secondary" onClick={()=>setTab('audio')}>返回声音与字幕</button><button className="sv-primary" onClick={()=>setTab('advanced')}>下一步：制作与开始</button></div></div></div><aside><div className="sv-card"><h2>剪辑设置</h2>
      {choice('画幅','video_aspect',[{id:'9:16',name:'竖屏 9:16'},{id:'16:9',name:'横屏 16:9'},{id:'1:1',name:'方形 1:1'}])}
      {choice('画面适配','video_fit_mode',[{id:'cover',name:'填满画面'},{id:'contain',name:'完整显示'}])}
      {number('单镜头时长（秒）','video_clip_duration',1,30)}
      {number('播放速度','video_clip_speed',.1,4,.1)}
       </div>{voicePreviewReady&&<div className="sv-card"><h2>已确认的配音</h2><p className="sv-help">可边听旁白边选择画面，成片将复用这段音频。</p>{voicePreview!.artifacts.filter(a=>a.kind==='audio').map(a=><audio controls preload="metadata" key={a.file} src={url(voicePreview!,a.file)}/>)}</div>}</aside></div>}
    {tab==='audio'&&<div className="sv-grid"><div><div className="sv-card"><h2>02 · 声音与字幕</h2><h3>配音</h3>
      <div className="sv-upload"><strong>上传自己的旁白（可选）</strong><input type="file" accept="audio/*" onChange={e=>{setVoiceFile(e.target.files?.[0]);setVoicePreviewId('')}}/><p className="sv-help">{voiceFile?.name||'上传后会跳过语音合成；上传旁白要生成字幕，请在设置中选用 Whisper。'}</p></div>
      {!voiceFile&&<><div className="sv-field"><label htmlFor="voice_name">Edge TTS 声音</label><select className="sv-input" id="voice_name" value={String(value('voice_name'))} onChange={e=>update('voice_name',e.target.value)}>{!health?.voices?.includes(String(value('voice_name')))&&<option value={String(value('voice_name'))}>{String(value('voice_name'))}</option>}{health?.voices?.map(v=><option key={v} value={v}>{v}</option>)}</select></div><div className="sv-row">{number('语速','voice_rate',.5,2,.1)}{number('音量','voice_volume',0,2,.1)}</div></>}</div>
       <div className="sv-card"><h2>背景音乐</h2><p className="sv-help">配乐只在生成完整成片时混入，单独制作配音或字幕时不会使用。</p>{choice('配乐方式','bgm_type',[{id:'none',name:'关闭'},{id:'random',name:'从已上传音乐中随机选取'},{id:'custom',name:'上传音乐'}])}{draft.params.bgm_type==='custom'&&<div className="sv-upload"><strong>上传背景音乐</strong><input type="file" accept="audio/*" onChange={e=>setBgmFile(e.target.files?.[0])}/><p className="sv-help">{bgmFile?.name||'支持 MP3 / M4A / WAV / OGG / FLAC'}</p></div>}{number('配乐音量','bgm_volume',0,1,.05)}</div>
       <div className="sv-card"><h2>生成并试听</h2><p className="sv-help">先按当前文案生成配音和字幕，试听满意后再选择画面。素材来源不会影响这一阶段。</p>
         <div className="sv-actions"><button className="sv-primary" disabled={!!busy||voicePreview?.status==='running'||!String(value('video_script')||'').trim()||health?.python===false} onClick={()=>void generateVoicePreview()}>{voicePreview?.status==='completed'?'重新生成配音和字幕':'生成配音和字幕'}</button></div>
         {voicePreview&&<div><p className="sv-help">生成状态：{labels[voicePreview.status]}{voicePreview.status==='running'?` · ${voicePreview.progress}%`:''}</p>{voicePreview.status==='running'&&<progress className="sv-progress" max="100" value={voicePreview.progress}/>}{voicePreview.error&&<div className="sv-error">{voicePreview.error}</div>}{voicePreview.artifacts.filter(a=>a.kind==='audio').map(a=><audio controls preload="metadata" key={a.file} src={url(voicePreview,a.file)}/>)}{voicePreview.artifacts.filter(a=>a.kind==='subtitle').map(a=><a className="sv-artifact" key={a.file} href={url(voicePreview,a.file,true)} download={a.name}>下载字幕文件 · {a.name}</a>)}</div>}
         {voicePreview?.status==='completed'&&voicePreviewIssue&&<div className="sv-error">{voicePreviewIssue}</div>}
       </div>
    </div><aside><div className="sv-card"><h2>字幕样式</h2>{check('添加字幕','subtitle_enabled')}
      {Boolean(draft.params.subtitle_enabled)&&<>{choice('显示方式','subtitle_display_mode',[{id:'sentence',name:'整句'},{id:'word_by_word',name:'逐字'}])}{choice('字幕动画','subtitle_animation',[{id:'none',name:'无'},{id:'pop_spring',name:'弹跳'}])}{choice('位置','subtitle_position',[{id:'bottom',name:'底部'},{id:'two_thirds_bottom',name:'下三分之一'},{id:'center',name:'居中'},{id:'top',name:'顶部'},{id:'custom',name:'自定义'}])}{draft.params.subtitle_position==='custom'&&number('自定义位置 %','custom_position',0,100)}
      <div className="sv-field"><label htmlFor="font_name">本机字体</label><select className="sv-input" id="font_name" value={String(value('font_name'))} onChange={e=>update('font_name',e.target.value)}><option value="">自动选择系统字体</option>{health?.fonts?.map(f=><option key={f.path} value={f.path}>{f.name}</option>)}</select></div>
      <div className="sv-row">{number('字号','font_size',12,160)}{number('描边宽度','stroke_width',0,10,.5)}</div>
      <div className="sv-row">{field('文字颜色','text_fore_color')}{field('描边颜色','stroke_color')}</div>
       <div className="sv-field"><label htmlFor="subtitleBackground">字幕背景</label><select className="sv-input" id="subtitleBackground" value={String(value('text_background_color')||'')} onChange={e=>update('text_background_color',e.target.value||false)}><option value="">无</option><option value="#000000">黑色</option><option value="#333333">深灰</option><option value="#FFFFFF">白色</option></select></div>{check('字幕背景圆角','rounded_subtitle_background')}</>}</div><div className="sv-actions"><button className="sv-secondary" onClick={()=>setTab('create')}>返回主题与文案</button><button className="sv-primary" disabled={!voicePreviewReady} onClick={()=>setTab('assets')}>确认配音，下一步：素材与画面</button></div>{!voicePreviewReady&&<p className="sv-help">{voicePreview?.status==='running'?'配音生成中，完成后即可进入素材设置。':voicePreviewIssue}</p>}</aside></div>}
    {tab==='advanced'&&<div className="sv-grid"><div><div className="sv-card"><h2>04 · 制作参数</h2>
      <div className="sv-row">{choice('拼接顺序','video_concat_mode',[{id:'random',name:'随机'},{id:'sequential',name:'顺序'}])}{choice('转场','video_transition_mode',transitions)}</div>
      <div className="sv-row">{number('生成成片数量','video_count',1,5)}{number('渲染线程','n_threads',1,16)}</div>
      {choice('视频比例','video_aspect',[{id:'9:16',name:'竖屏 9:16'},{id:'16:9',name:'横屏 16:9'},{id:'1:1',name:'方形 1:1'}])}
    </div></div><aside><div className="sv-card"><h2>开始制作</h2><p className="sv-help">主题：{String(value('video_subject')||'使用自写文案')}</p><p className="sv-help">文案：{String(value('video_script')||'未填写').slice(0,100)}</p><p className="sv-help">关键词：{String(value('video_terms')||'未填写，制作时自动生成').slice(0,100)}</p><p className="sv-help">文本模型：{catalog?.text.find(m=>m.id===draft.textModel)?.name||'未选择'}</p>
      <h3>制作到哪一步</h3><div className="sv-stage">{stages.map(s=><label key={s.id}><input type="radio" name="stage" disabled={!!busy} checked={draft.stopAt===s.id} onChange={()=>setDraft({...draft,stopAt:s.id})}/>{s.label}</label>)}</div>
      {modelNeeded&&!catalog?.signedIn&&<div className="sv-error">需要模型时，请先在“设置 · CQAI Club”登录账号。</div>}
      {needsVoicePreview&&!voicePreviewReady&&<div className="sv-error">{voicePreview?.status==='running'?'配音和字幕仍在生成，请稍候。':voicePreviewIssue}</div>}
      <div className="sv-actions"><button className="sv-secondary" onClick={()=>setTab(voicePreviewReady?'assets':'audio')}>{voicePreviewReady?'返回素材与画面':'前往生成配音'}</button><button className="sv-primary" disabled={!!busy||(!String(value('video_subject')||'').trim()&&!String(value('video_script')||'').trim())||(modelNeeded&&!catalog?.signedIn)||(needsVoicePreview&&!voicePreviewReady)||health?.python===false} onClick={()=>void create()}>{busy||(['audio','subtitle'].includes(draft.stopAt)?'查看配音结果':'开始制作')}</button></div>
      <p className="sv-help">模型请求和第三方素材服务可能消耗额度。渲染期间请保持应用运行。</p></div></aside></div>}
    {tab==='history'&&<div className="sv-grid"><div><div className="sv-card"><h2>制作记录</h2><div className="sv-actions">{([['all','全部'],['running','进行中'],['completed','已完成'],['failed','失败 / 中断']] as const).map(([id,label])=><button className="sv-secondary" aria-pressed={filter===id} key={id} onClick={()=>setFilter(id)}>{label}</button>)}</div><div className="sv-list">{filteredJobs.length?filteredJobs.map(item=><button className="sv-job" aria-selected={selected===item.id} key={item.id} onClick={()=>setSelected(item.id)}><span><strong>{String(item.params.video_subject||item.params.video_script||'未命名').slice(0,50)}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.stopAt}</small></span><em>{labels[item.status]}</em></button>):<div className="sv-empty">还没有任务。到“主题与文案”页开始制作。</div>}</div></div></div><aside>{job?<div className="sv-card"><h2>任务详情</h2><p className="sv-sub">{labels[job.status]} · {job.progress}%</p><progress className="sv-progress" max="100" value={job.progress}/>{job.error&&<div className="sv-error">{job.error}</div>}
      <div className="sv-actions">{job.status==='running'?<button className="sv-secondary sv-danger" disabled={!!busy} onClick={()=>void action('取消任务…',async()=>{await api(`cancel?id=${job.id}`,{});await refresh()})}>取消</button>:<><button className="sv-secondary" disabled={!!busy} onClick={()=>restore(job)}>使用相同参数</button>{job.status==='completed'&&job.stopAt==='subtitle'&&!!job.params.video_script&&job.artifacts.some(a=>a.kind==='audio')&&<button className="sv-primary" disabled={!!busy} onClick={()=>continueWithVoice(job)}>继续使用这段配音</button>}{job.status!=='completed'&&<button className="sv-primary" disabled={!!busy} onClick={()=>void action('重新开始…',async()=>{await api(`start?id=${job.id}`,{});await refresh()})}>重新开始</button>}<button className="sv-secondary sv-danger" disabled={!!busy} onClick={()=>void action('删除任务…',async()=>{await api(`delete?id=${job.id}`,{});setSelected('');await refresh()})}>删除</button></>}</div>
      {typeof job.state?.script==='string'&&<details open><summary>生成文案</summary><pre className="sv-log">{job.state.script}</pre></details>}
      {Array.isArray(job.state?.terms)&&<details><summary>素材关键词</summary><pre className="sv-log">{job.state.terms.join(', ')}</pre></details>}
      {job.artifacts.filter(a=>a.kind==='audio').map(a=><audio controls preload="metadata" key={a.file} src={url(job,a.file)}/>)}
      {job.artifacts.filter(a=>a.kind==='video').map(a=><video controls preload="metadata" key={a.file} src={url(job,a.file)} />)}
      {job.artifacts.length>0&&<div>{job.artifacts.map(a=><a className="sv-artifact" key={a.file} href={url(job,a.file,true)} download={a.name}><span>↓ {a.name}</span><span>{(a.size/1048576).toFixed(1)} MB</span></a>)}</div>}
      <details open={job.status==='failed'}><summary>制作日志</summary><pre className="sv-log">{job.logs.join('\n')||'暂无日志'}</pre></details></div>:<div className="sv-empty">选择一条任务查看制作进度、成片和日志。</div>}</aside></div>}
    {tab==='settings'&&<div className="sv-grid"><div><div className="sv-card"><h2>运行环境</h2><p className="sv-help">制作引擎基于 MoneyPrinterTurbo 1.3.7。首次使用需要 Python 3.11+、uv 与 FFmpeg；点击安装会把锁定依赖安装到本机数据目录。</p>
      <div className="sv-kv"><span className={health?.python?'ok':''}>Python {health?.python?'就绪':'待安装'}</span><span className={health?.ffmpeg?'ok':''}>FFmpeg {health?.ffmpeg?'就绪':'待安装'}</span><span className={health?.uv?'ok':''}>uv {health?.uv?'就绪':'未发现'}</span></div>
      {health?.error&&<div className="sv-error">{health.error}</div>}
      <div className="sv-actions"><button className="sv-primary" disabled={health?.setup?.status==='running'||!!busy} onClick={()=>void action('启动安装…',async()=>{await api('setup',{});setNotice('正在安装运行环境，请稍候。')})}>安装 / 修复依赖</button><button className="sv-secondary" onClick={()=>void api<Health>('health').then(setHealth)}>重新检查</button></div>
      {health?.setup?.status==='running'&&<p className="sv-help">正在安装依赖；可能需要几分钟。</p>}{health?.setup?.logs?.length?<pre className="sv-log">{health.setup.logs.join('\n')}</pre>:null}
    </div><div className="sv-card"><h2>素材平台</h2><p className="sv-help">这些密钥仅用于素材搜索；脚本和 AI 图片模型仍通过 CQAI Club 账号调用。</p>
      {(['pexels_api_keys','pixabay_api_keys','coverr_api_keys'] as const).map(key=><div className="sv-field" key={key}><label htmlFor={key}>{key.split('_')[0].toUpperCase()} API Key</label><input className="sv-input" id={key} type="password" value={settings[key]} onChange={e=>setSettings({...settings,[key]:e.target.value})}/></div>)}
     </div></div><aside><div className="sv-card"><h2>字幕与编码</h2><div className="sv-field"><label>字幕引擎</label><select className="sv-input" value={settings.subtitle_provider} onChange={e=>{setSettings({...settings,subtitle_provider:e.target.value as Settings['subtitle_provider']});setVoicePreviewId('')}}><option value="edge">Edge TTS 对齐</option><option value="whisper">Whisper 识别</option></select></div>
      <div className="sv-field"><label>FFmpeg 编码器</label><select className="sv-input" value={settings.video_codec} onChange={e=>setSettings({...settings,video_codec:e.target.value as Settings['video_codec']})}><option value="libx264">CPU · H.264</option><option value="h264_nvenc">NVIDIA NVENC</option><option value="h264_qsv">Intel QSV</option><option value="h264_amf">AMD AMF</option></select></div>
      <button className="sv-primary" disabled={!!busy} onClick={()=>void action('保存设置…',async()=>{setSettings(await api<Settings>('settings',settings));setNotice('设置已保存。新任务会使用这些设置。')})}>保存设置</button></div><div className="sv-card"><h2>模型来源</h2><p className="sv-help">仅使用 CQAI Club 账号提供的文本与图片模型。当前文本模型 {catalog?.text.length??0} 个，图片模型 {catalog?.image.length??0} 个。</p><button className="sv-secondary" onClick={()=>void reloadCatalog().catch(e=>setError(e.message))}>刷新模型列表</button></div></aside></div>}
  </div></section>
}
export function apply(ctx:Context):void{
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:PANEL},Studio))
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:PANEL,order:42,label:'短视频制作'},({size}:PropsRuntime<'sidebar.panellist'>)=><span style={{display:'inline-flex',width:size,height:size,alignItems:'center',justifyContent:'center'}}><Icon/></span>))
}
