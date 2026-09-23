import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  isChatModel,
  isImageGenerationModel,
  isVideoCatalogEntry,
  type DsnAccountSnapshot,
  type DsnCategoryDefaultModels,
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
  modelsDescription: '模型目录由 CQAI Club 根据当前账号动态提供。这里展示全部模型，并可设置默认对话和图像模型。',
  modelsConnected: '已连接',
  modelsSignedOut: '未登录',
  modelsLoading: '正在读取模型…',
  modelsLoginRequired: '登录 CQAI Club 后，可用模型会显示在这里。',
  modelsLoginHint: '请前往“CQAI Club”设置完成登录，然后返回此页刷新。',
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
  modelsAvailable: '账号可用模型',
  modelsEmpty: '当前账号暂时没有可用模型。',
  modelsStale: '当前展示的是上一次成功获取的模型目录。',
  modelCategoryImage: '图像',
  modelCategoryVideo: '视频',
  modelCategoryText: '文本',
  modelCategoryMultimodal: '多模态',
  modelCategoryAudio: '音频',
  modelCategoryOther: '其他',
} as const

export type ModelsSettingsKey = keyof typeof modelsSettingsZh

export const modelsSettingsEn: Record<ModelsSettingsKey, string> = {
  modelsEyebrow: 'CLOUD MODELS',
  modelsTitle: 'CQAI Club models',
  modelsDescription: 'CQAI Club provides this catalog for the current account. All models appear here; chat and image defaults can be selected above.',
  modelsConnected: 'Connected',
  modelsSignedOut: 'Signed out',
  modelsLoading: 'Loading models…',
  modelsLoginRequired: 'Sign in to CQAI Club to see the models available to this account.',
  modelsLoginHint: 'Open CQAI Club settings to sign in, then return here and refresh.',
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
  modelsAvailable: 'Models available to this account',
  modelsEmpty: 'This account currently has no available models.',
  modelsStale: 'Showing the last model catalog loaded successfully.',
  modelCategoryImage: 'Image',
  modelCategoryVideo: 'Video',
  modelCategoryText: 'Text',
  modelCategoryMultimodal: 'Multimodal',
  modelCategoryAudio: 'Audio',
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
  width: 'min(100%, 420px)',
  minHeight: 40,
  padding: '8px 11px',
  border: '0.5px solid var(--dsw-alias-border-l2, #dfe3e8)',
  borderRadius: 9,
  outline: 'none',
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
  other: 'modelCategoryOther',
}

function modelOwner(model: DsnModel): string | undefined {
  const owner = model.vendor ?? model.ownedBy
  return owner.length > 0 && owner !== model.id ? owner : undefined
}

function displayCategories(model: DsnModel): readonly DsnModelCategory[] {
  if (!isVideoCatalogEntry(model) || model.categories.includes('video')) return model.categories
  return [...model.categories.filter(category => category !== 'other'), 'video']
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
  const [savingTarget, setSavingTarget] = useState<'chat' | 'image'>()
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

  const models = useMemo(() => catalog?.models.filter(isChatModel) ?? [], [catalog])
  const imageModels = useMemo(() => catalog?.models.filter(isImageGenerationModel) ?? [], [catalog])
  const availableModels = catalog?.models ?? []
  const selectedModel = selection?.provider === CQAI_PROVIDER
    && models.some(model => model.id === selection.model)
    ? selection.model
    : ''
  const imageSelection = categoryDefaults?.categories.image
  const selectedImageModel = imageSelection?.provider === CQAI_PROVIDER
    && imageModels.some(model => model.id === imageSelection.model)
    ? imageSelection.model
    : ''
  const imageDefaultUnavailable = imageSelection?.provider === CQAI_PROVIDER
    && imageSelection.model.length > 0
    && selectedImageModel === ''
  const signedIn = snapshot?.state === 'signed-in'
  const saving = savingTarget !== undefined

  const saveDefault = async (model: string) => {
    if (model.length === 0 || saving) return
    setSavingTarget('chat')
    setError(undefined)
    setNotice(undefined)
    try {
      setSelection(await rpcCall<DsnDefaultModelSelection>(ctx, 'models/default/set', { model }))
      setNotice(t('modelsDefaultSaved'))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSavingTarget(undefined)
    }
  }

  const saveImageDefault = async (model: string) => {
    if (model.length === 0 || saving) return
    setSavingTarget('image')
    setError(undefined)
    setNotice(undefined)
    try {
      setCategoryDefaults(await rpcCall<DsnCategoryDefaultModels>(ctx, 'models/category-defaults/set', {
        category: 'image',
        model,
      }))
      setNotice(t('modelsImageDefaultSaved'))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSavingTarget(undefined)
    }
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
          <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', flex: '1 1 540px', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
              <label style={{ display: 'grid', gap: 7, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 12, fontWeight: 600 }}>
                {t('modelsDefault')}
                <select
                  aria-label={t('modelsDefault')}
                  style={selectStyle}
                  value={selectedModel}
                  disabled={loading || saving || models.length === 0}
                  onChange={(event) => { void saveDefault(event.target.value) }}
                >
                  <option value="">{savingTarget === 'chat' ? t('modelsSaving') : t('modelsSelectDefault')}</option>
                  {models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 7, color: 'var(--dsw-alias-label-secondary, #667180)', fontSize: 12, fontWeight: 600 }}>
                {t('modelsImageDefault')}
                <select
                  aria-label={t('modelsImageDefault')}
                  style={selectStyle}
                  value={selectedImageModel}
                  disabled={loading || saving || imageModels.length === 0}
                  onChange={(event) => { void saveImageDefault(event.target.value) }}
                >
                  <option value="">{savingTarget === 'image'
                    ? t('modelsSaving')
                    : imageModels.length === 0 ? t('modelsImageEmpty') : t('modelsSelectImageDefault')}</option>
                  {imageModels.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
                </select>
              </label>
            </div>
            <Button variant="outline" disabled={loading || saving} onClick={() => { void load(true) }}>
              {loading ? t('modelsRefreshing') : t('modelsRefresh')}
            </Button>
          </div>

          {imageDefaultUnavailable ? <p role="status" style={{ ...mutedStyle, color: 'var(--dsw-alias-state-warning-primary, #9a6700)' }}>{t('modelsImageDefaultUnavailable')}</p> : null}

          {catalog?.stale === true ? <p role="status" style={mutedStyle}>{catalog.warning ?? t('modelsStale')}</p> : null}

          <div style={{ display: 'grid', gap: 10 }}>
            <strong style={{ fontSize: 13 }}>{t('modelsAvailable')}</strong>
            {availableModels.length === 0 ? <p style={mutedStyle}>{t('modelsEmpty')}</p> : (
              <div style={{ display: 'grid', gap: 8 }}>
                {availableModels.map(model => (
                  <article key={model.id} style={{ display: 'grid', gap: 7, padding: '12px 14px', border: '0.5px solid var(--dsw-alias-border-l1, #edf0f3)', borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform, #f7f8fa)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{model.id}</strong>
                      {modelOwner(model) === undefined ? null : <span style={{ color: 'var(--dsw-alias-label-tertiary, #8993a1)', fontSize: 11 }}>{modelOwner(model)}</span>}
                    </div>
                    {model.description === undefined ? null : <p style={{ ...mutedStyle, fontSize: 12 }}>{model.description}</p>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {displayCategories(model).map(category => (
                        <span key={category} style={{ padding: '3px 7px', borderRadius: 999, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fda) 9%, transparent)', color: 'var(--dsw-alias-state-business-primary, #2f6fda)', fontSize: 10, fontWeight: 600 }}>
                          {t(categoryKeys[category])}
                        </span>
                      ))}
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
