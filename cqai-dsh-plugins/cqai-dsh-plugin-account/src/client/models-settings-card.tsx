import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  isChatModel,
  isModelInCategory,
  modelCatalogCategories,
  type DsnAccountSnapshot,
  type DsnCategoryDefaultModels,
  type DsnDefaultModelCategory,
  type DsnDefaultModelSelection,
  type DsnModel,
  type DsnModelCatalog,
  type DsnModelCategory,
} from '../protocol.ts'
import { rpcCall } from './rpc.ts'

const CQAI_PROVIDER = 'cqaiclub'

export const modelsSettingsZh = {
  modelsEyebrow: '云端模型',
  modelsTitle: 'CQAI Club 模型',
  modelsDescription: '按用途查看当前账号的全部模型，设置对话、图像、视频、音频和向量模型偏好。',
  modelsConnected: '已连接',
  modelsSignedOut: '未登录',
  modelsLoading: '正在读取模型…',
  modelsLoginRequired: '登录 CQAI Club 后，可用模型会显示在这里。',
  modelsLoginHint: '请打开 CQAI Club 完成登录，然后返回此页刷新。',
  modelsRefresh: '刷新模型',
  modelsRefreshing: '刷新中…',
  modelsDefault: '默认对话模型',
  modelsSelectDefault: '选择 CQAI Club 默认模型',
  modelsSaving: '保存中…',
  modelsDefaultSaved: '默认模型已更新。',
  modelsImageDefault: '默认图像模型',
  modelsSelectImageDefault: '选择 CQAI Club 默认图像模型',
  modelsImageDefaultSaved: '默认图像模型已更新。',
  modelsImageDefaultUnavailable: '原默认图像模型已不可用，请重新选择。',
  modelsImageEmpty: '当前账号没有可用的图像生成模型',
  modelsDefaults: '默认模型',
  modelsDefaultsHint: '视频、音频和向量默认项是偏好设置，只在支持相应默认项的工具中生效。工具中已单独选择的模型优先。',
  modelsVideoDefault: '默认视频模型',
  modelsAudioDefault: '默认音频模型',
  modelsEmbeddingDefault: '默认向量模型',
  modelsSelectCategoryDefault: '选择默认模型',
  modelsCategoryEmpty: '暂无符合条件的模型',
  modelsCategoryDefaultSaved: '分类默认模型已更新。',
  modelsCategoryDefaultUnavailable: '原默认模型已不可用，请重新选择。',
  modelsVideoHint: '仅可选择支持视频生成接口的模型。',
  modelsAudioHint: '包含语音识别、语音合成等能力，使用时需匹配工具用途。',
  modelsEmbeddingHint: '用于知识库、语义搜索等向量检索场景。',
  modelsAvailable: '账号可用模型',
  modelsAll: '全部',
  modelsSearch: '搜索模型',
  modelsSearchPlaceholder: '搜索模型名称、厂商或用途',
  modelsFilterLabel: '按模型用途筛选',
  modelsResults: '显示 {visible} / {total} 个模型',
  modelsNoResults: '没有匹配的模型，试试其他关键词或分类。',
  modelsClearFilters: '清除筛选',
  modelsEmpty: '当前账号暂时没有可用模型。',
  modelsStale: '当前展示的是上一次成功获取的模型目录。',
  modelCategoryImage: '图像',
  modelCategoryVideo: '视频',
  modelCategoryText: '文本',
  modelCategoryMultimodal: '多模态',
  modelCategoryAudio: '音频',
  modelCategoryEmbedding: '向量',
  modelCategoryRerank: '重排',
  modelCategoryOther: '其他',
} as const

export type ModelsSettingsKey = keyof typeof modelsSettingsZh

export const modelsSettingsEn: Record<ModelsSettingsKey, string> = {
  modelsEyebrow: 'CLOUD MODELS',
  modelsTitle: 'CQAI Club models',
  modelsDescription: 'Browse all models available to this account by purpose and set chat, image, video, audio, and embedding preferences.',
  modelsConnected: 'Connected',
  modelsSignedOut: 'Signed out',
  modelsLoading: 'Loading models…',
  modelsLoginRequired: 'Sign in to CQAI Club to see the models available to this account.',
  modelsLoginHint: 'Open CQAI Club to sign in, then return here and refresh.',
  modelsRefresh: 'Refresh models',
  modelsRefreshing: 'Refreshing…',
  modelsDefault: 'Default chat model',
  modelsSelectDefault: 'Choose a CQAI Club default model',
  modelsSaving: 'Saving…',
  modelsDefaultSaved: 'Default model updated.',
  modelsImageDefault: 'Default image model',
  modelsSelectImageDefault: 'Choose a CQAI Club default image model',
  modelsImageDefaultSaved: 'Default image model updated.',
  modelsImageDefaultUnavailable: 'The previous default image model is unavailable. Choose another model.',
  modelsImageEmpty: 'This account has no available image-generation model',
  modelsDefaults: 'Default models',
  modelsDefaultsHint: 'Video, audio, and embedding defaults are preferences used only by tools that support the corresponding default. A model already selected in a tool takes priority.',
  modelsVideoDefault: 'Default video model',
  modelsAudioDefault: 'Default audio model',
  modelsEmbeddingDefault: 'Default embedding model',
  modelsSelectCategoryDefault: 'Choose a default model',
  modelsCategoryEmpty: 'No matching models available',
  modelsCategoryDefaultSaved: 'Category default updated.',
  modelsCategoryDefaultUnavailable: 'The previous default is unavailable. Choose another model.',
  modelsVideoHint: 'Only models supporting the video-generation API can be selected.',
  modelsAudioHint: 'Includes speech recognition and synthesis. Match the model to the tool’s purpose.',
  modelsEmbeddingHint: 'For knowledge bases, semantic search, and other vector retrieval tasks.',
  modelsAvailable: 'Models available to this account',
  modelsAll: 'All',
  modelsSearch: 'Search models',
  modelsSearchPlaceholder: 'Search by model, vendor, or purpose',
  modelsFilterLabel: 'Filter models by purpose',
  modelsResults: 'Showing {visible} / {total} models',
  modelsNoResults: 'No models match. Try another keyword or category.',
  modelsClearFilters: 'Clear filters',
  modelsEmpty: 'This account currently has no available models.',
  modelsStale: 'Showing the last model catalog loaded successfully.',
  modelCategoryImage: 'Image',
  modelCategoryVideo: 'Video',
  modelCategoryText: 'Text',
  modelCategoryMultimodal: 'Multimodal',
  modelCategoryAudio: 'Audio',
  modelCategoryEmbedding: 'Embeddings',
  modelCategoryRerank: 'Rerank',
  modelCategoryOther: 'Other',
}

type Translate = (key: ModelsSettingsKey) => string

export interface CqaiModelsSettingsCardProps {
  readonly ctx: ClientContext
  readonly t: Translate
}

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
  marginTop: 24,
  padding: 22,
  border: '0.5px solid var(--dsw-alias-border-l2, #dfe3e8)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))',
  boxShadow: '0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary, #18202a) 7%, transparent)',
  color: 'var(--dsw-alias-label-primary, #18202a)',
}

const mutedStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary, #667180)',
  fontSize: 13,
  lineHeight: 1.55,
}

const selectStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  minHeight: 40,
  padding: '8px 11px',
  border: '0.5px solid var(--dsw-alias-border-l2, #dfe3e8)',
  borderRadius: 9,
  background: 'var(--dsw-alias-bg-layer-2, #fff)',
  color: 'var(--dsw-alias-label-primary, #18202a)',
  font: 'inherit',
}

const categoryKeys: Record<DsnModelCategory, ModelsSettingsKey> = {
  image: 'modelCategoryImage',
  video: 'modelCategoryVideo',
  text: 'modelCategoryText',
  'text-multimodal': 'modelCategoryMultimodal',
  audio: 'modelCategoryAudio',
  embedding: 'modelCategoryEmbedding',
  rerank: 'modelCategoryRerank',
  other: 'modelCategoryOther',
}

function modelOwner(model: DsnModel): string | undefined {
  const owner = model.vendor ?? model.ownedBy
  return owner.length > 0 && owner !== model.id ? owner : undefined
}

type DefaultTarget = 'chat' | 'image' | 'video' | 'audio' | 'embedding'
type ModelFilter = 'all' | 'text' | 'image' | 'video' | 'audio' | 'embedding' | 'rerank' | 'other'

const defaultFields: readonly { target: DefaultTarget; label: ModelsSettingsKey; hint?: ModelsSettingsKey }[] = [
  { target: 'chat', label: 'modelsDefault' },
  { target: 'image', label: 'modelsImageDefault' },
  { target: 'video', label: 'modelsVideoDefault', hint: 'modelsVideoHint' },
  { target: 'audio', label: 'modelsAudioDefault', hint: 'modelsAudioHint' },
  { target: 'embedding', label: 'modelsEmbeddingDefault', hint: 'modelsEmbeddingHint' },
]

const modelFilters: readonly { filter: ModelFilter; label: ModelsSettingsKey }[] = [
  { filter: 'all', label: 'modelsAll' },
  { filter: 'text', label: 'modelCategoryText' },
  { filter: 'image', label: 'modelCategoryImage' },
  { filter: 'video', label: 'modelCategoryVideo' },
  { filter: 'audio', label: 'modelCategoryAudio' },
  { filter: 'embedding', label: 'modelCategoryEmbedding' },
  { filter: 'rerank', label: 'modelCategoryRerank' },
  { filter: 'other', label: 'modelCategoryOther' },
]

function matchesFilter(categories: readonly DsnModelCategory[], filter: ModelFilter): boolean {
  return filter === 'all' || categories.includes(filter)
    || (filter === 'text' && categories.includes('text-multimodal'))
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function cancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

export function CqaiModelsSettingsCard({ ctx, t }: CqaiModelsSettingsCardProps) {
  const [snapshot, setSnapshot] = useState<DsnAccountSnapshot>()
  const [catalog, setCatalog] = useState<DsnModelCatalog>()
  const [selection, setSelection] = useState<DsnDefaultModelSelection>()
  const [categoryDefaults, setCategoryDefaults] = useState<DsnCategoryDefaultModels>()
  const [loading, setLoading] = useState(true)
  const [savingTarget, setSavingTarget] = useState<DefaultTarget>()
  const [filter, setFilter] = useState<ModelFilter>('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const load = useCallback(async (refresh: boolean, signal?: AbortSignal) => {
    setLoading(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const nextSnapshot = await rpcCall<DsnAccountSnapshot>(ctx, 'snapshot/get', {}, signal)
      if (cancelled(signal)) return
      setSnapshot(nextSnapshot)
      if (nextSnapshot.state !== 'signed-in') {
        setCatalog(undefined)
        setSelection(undefined)
        setCategoryDefaults(undefined)
        return
      }
      const [nextCatalog, nextSelection, nextCategoryDefaults] = await Promise.all([
        rpcCall<DsnModelCatalog>(ctx, 'models/list', { refresh }, signal),
        rpcCall<DsnDefaultModelSelection>(ctx, 'models/default/get', {}, signal),
        rpcCall<DsnCategoryDefaultModels>(ctx, 'models/category-defaults/get', {}, signal),
      ])
      if (cancelled(signal)) return
      setCatalog(nextCatalog)
      setSelection(nextSelection)
      setCategoryDefaults(nextCategoryDefaults)
    } catch (cause) {
      if (!cancelled(signal)) setError(messageOf(cause))
    } finally {
      if (!cancelled(signal)) setLoading(false)
    }
  }, [ctx])

  useEffect(() => {
    const controller = new AbortController()
    void load(false, controller.signal)
    return () => { controller.abort() }
  }, [load])

  const catalogEntries = useMemo(() => (catalog?.models ?? []).map(model => ({
    model,
    categories: modelCatalogCategories(model),
  })), [catalog])
  const defaults = defaultFields.map(field => {
    const models = catalogEntries.map(entry => entry.model).filter(model => field.target === 'chat'
      ? isChatModel(model)
      : isModelInCategory(model, field.target))
    const current = field.target === 'chat' ? selection : categoryDefaults?.categories[field.target]
    const selected = current?.provider === CQAI_PROVIDER && models.some(model => model.id === current.model)
      ? current.model : ''
    return {
      ...field,
      models,
      selected,
      unavailable: current?.provider === CQAI_PROVIDER && current.model.length > 0 && selected === '',
    }
  })
  const query = search.trim().toLocaleLowerCase()
  const visibleEntries = catalogEntries.filter(({ model, categories }) => {
    if (!matchesFilter(categories, filter)) return false
    const searchable = [model.id, model.name, model.vendor, model.ownedBy, model.description,
      ...categories.map(category => t(categoryKeys[category])), ...model.supportedEndpointTypes]
    return query.length === 0 || searchable.some(value => value?.toLocaleLowerCase().includes(query))
  })
  const signedIn = snapshot?.state === 'signed-in'
  const saving = savingTarget !== undefined

  const saveDefault = async (target: DefaultTarget, model: string) => {
    if (model.length === 0 || saving) return
    setSavingTarget(target)
    setError(undefined)
    setNotice(undefined)
    try {
      if (target === 'chat') {
        setSelection(await rpcCall<DsnDefaultModelSelection>(ctx, 'models/default/set', { model }))
        setNotice(t('modelsDefaultSaved'))
      } else {
        setCategoryDefaults(await rpcCall<DsnCategoryDefaultModels>(ctx, 'models/category-defaults/set', {
          category: target satisfies DsnDefaultModelCategory,
          model,
        }))
        setNotice(t(target === 'image' ? 'modelsImageDefaultSaved' : 'modelsCategoryDefaultSaved'))
      }
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSavingTarget(undefined)
    }
  }

  const clearFilters = () => {
    setFilter('all')
    setSearch('')
  }

  return (
    <section style={cardStyle} aria-labelledby="cqaiclub-models-title">
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, flex: 'none', borderRadius: 12, background: 'linear-gradient(145deg, #1268dc, #6047c9)', color: '#fff', fontSize: 13, fontWeight: 750 }}>CQ</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ marginBottom: 3, color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 10, fontWeight: 650, letterSpacing: '0.1em' }}>{t('modelsEyebrow')}</div>
            <h3 id="cqaiclub-models-title" style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>{t('modelsTitle')}</h3>
            <p style={{ ...mutedStyle, marginTop: 5, maxWidth: 620 }}>{t('modelsDescription')}</p>
          </div>
        </div>
        <Tag tone={signedIn ? 'success' : 'neutral'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <StateDot state={signedIn ? 'done' : 'idle'} />
            {t(signedIn ? 'modelsConnected' : 'modelsSignedOut')}
          </span>
        </Tag>
      </header>

      {error !== undefined ? <div role="alert" style={{ padding: '10px 12px', borderRadius: 9, background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #c63131) 8%, transparent)', color: 'var(--dsw-alias-state-error-primary, #b42318)', fontSize: 13 }}>{error}</div> : null}
      {notice !== undefined ? <div role="status" style={{ padding: '10px 12px', borderRadius: 9, background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #16834b) 8%, transparent)', color: 'var(--dsw-alias-state-success-primary, #14733f)', fontSize: 13 }}>{notice}</div> : null}

      {loading && snapshot === undefined ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 70, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 13 }}>
          <StateDot state="ongoing" />
          {t('modelsLoading')}
        </div>
      ) : !signedIn ? (
        <div style={{ display: 'grid', gap: 6, padding: '15px 16px', borderRadius: 11, background: 'var(--dsw-alias-bg-module-platform, #f4f6f8)' }}>
          <strong style={{ fontSize: 13 }}>{t('modelsLoginRequired')}</strong>
          <p style={mutedStyle}>{t('modelsLoginHint')}</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{t('modelsDefaults')}</strong>
            <Button variant="outline" disabled={loading || saving} onClick={() => { void load(true) }}>
              {loading ? t('modelsRefreshing') : t('modelsRefresh')}
            </Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', alignItems: 'start', gap: 16, minWidth: 0 }}>
            {defaults.map(field => (
              <div key={field.target} style={{ display: 'grid', gap: 7, minWidth: 0 }}>
                <label style={{ display: 'grid', gap: 7, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 12, fontWeight: 600, minWidth: 0 }}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span>{t(field.label)}</span>
                    {savingTarget === field.target ? <span role="status" style={{ fontWeight: 400 }}>{t('modelsSaving')}</span> : null}
                  </span>
                  <select
                    aria-label={t(field.label)}
                    aria-describedby={field.hint === undefined ? undefined : `cqai-default-${field.target}-hint`}
                    style={selectStyle}
                    value={field.selected}
                    disabled={loading || saving || field.models.length === 0}
                    onChange={(event) => { void saveDefault(field.target, event.target.value) }}
                  >
                    <option value="" disabled>{savingTarget === field.target ? t('modelsSaving')
                      : field.models.length === 0 ? t(field.target === 'image' ? 'modelsImageEmpty' : 'modelsCategoryEmpty')
                      : t(field.target === 'chat' ? 'modelsSelectDefault' : field.target === 'image' ? 'modelsSelectImageDefault' : 'modelsSelectCategoryDefault')}</option>
                    {field.models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
                  </select>
                </label>
                {field.hint === undefined ? null : <p id={`cqai-default-${field.target}-hint`} style={{ ...mutedStyle, fontSize: 12 }}>{t(field.hint)}</p>}
                {field.unavailable ? <p role="status" style={{ ...mutedStyle, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary, #9a6700)' }}>{t(field.target === 'image' ? 'modelsImageDefaultUnavailable' : 'modelsCategoryDefaultUnavailable')}</p> : null}
              </div>
            ))}
          </div>
          <p style={{ ...mutedStyle, fontSize: 12 }}>{t('modelsDefaultsHint')}</p>

          {catalog?.stale === true ? <p role="status" style={mutedStyle}>{catalog.warning ?? t('modelsStale')}</p> : null}

          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>{t('modelsAvailable')}</strong>
              <span role="status" aria-live="polite" aria-atomic="true" style={{ ...mutedStyle, fontSize: 12 }}>{t('modelsResults').replace('{visible}', String(visibleEntries.length)).replace('{total}', String(catalogEntries.length))}</span>
            </div>
            <label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #667180)' }}>
              {t('modelsSearch')}
              <input type="search" aria-label={t('modelsSearch')} style={{ ...selectStyle, fontWeight: 400 }} value={search} placeholder={t('modelsSearchPlaceholder')} onChange={event => { setSearch(event.target.value) }} />
            </label>
            <div role="group" aria-label={t('modelsFilterLabel')} style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {modelFilters.map(item => {
                const active = item.filter === filter
                const count = catalogEntries.filter(entry => matchesFilter(entry.categories, item.filter)).length
                return <button key={item.filter} type="button" aria-pressed={active} onClick={() => { setFilter(item.filter) }} style={{ minHeight: 36, padding: '6px 11px', borderRadius: 9, border: `1px solid ${active ? 'var(--dsw-alias-state-business-primary, #2f6fda)' : 'var(--dsw-alias-border-l2, #dfe3e8)'}`, background: active ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 9%, transparent)' : 'transparent', color: active ? 'var(--dsw-alias-state-business-primary, #2f6fda)' : 'var(--dsw-alias-label-secondary, #667180)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400 }}>
                  {t(item.label)} <span style={{ marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                </button>
              })}
            </div>
            {catalogEntries.length === 0 ? <p style={mutedStyle}>{loading ? t('modelsLoading') : t('modelsEmpty')}</p>
              : visibleEntries.length === 0 ? <div style={{ display: 'grid', justifyItems: 'start', gap: 10, padding: '18px 14px', borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
                <p style={mutedStyle}>{t('modelsNoResults')}</p>
                <Button variant="outline" onClick={clearFilters}>{t('modelsClearFilters')}</Button>
              </div> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', alignItems: 'start', gap: 10 }}>
                {visibleEntries.map(({ model, categories }) => (
                  <article key={model.id} style={{ display: 'grid', minWidth: 0, gap: 7, padding: '12px 14px', border: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{model.id}</strong>
                      {modelOwner(model) === undefined ? null : <span style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 11 }}>{modelOwner(model)}</span>}
                    </div>
                    {model.description === undefined ? null : <p style={{ ...mutedStyle, fontSize: 12, overflowWrap: 'anywhere' }}>{model.description}</p>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {categories.map(category => (
                        <span key={category} style={{ padding: '3px 7px', borderRadius: 6, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 9%, transparent)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 11, fontWeight: 600 }}>
                          {t(categoryKeys[category])}
                        </span>
                      ))}
                      {defaults.filter(field => field.selected === model.id).map(field => <span key={field.target} style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, #dfe3e8)', color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 11 }}>{t(field.label)}</span>)}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
