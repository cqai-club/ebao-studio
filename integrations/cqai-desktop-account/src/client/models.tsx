import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CqaiModelsSettingsCard,
  modelsSettingsEn,
  modelsSettingsZh,
  type ModelsSettingsKey,
} from '../../../../cqai-dsh-plugins/cqai-dsh-plugin-account/src/client/models-settings-card.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'ebao.models': ModelsSettingsKey | 'modelsDisconnected'
  }
}

const namespace = 'ebao.models'

const zh = {
  ...modelsSettingsZh,
  modelsTitle: 'e宝工坊模型',
  modelsLoginRequired: '登录 e宝工坊账号后，可用模型会显示在这里。',
  modelsLoginHint: '请从侧栏的账号入口登录，然后返回模型设置。',
  modelsSelectDefault: '选择 e宝工坊默认对话模型',
  modelsSelectImageDefault: '选择 e宝工坊默认图像模型',
  modelsDisconnected: '暂时无法读取账号状态，请检查连接。',
}

const en = {
  ...modelsSettingsEn,
  modelsTitle: 'e宝工坊 models',
  modelsLoginRequired: 'Sign in to your e宝工坊 account to see its available models.',
  modelsLoginHint: 'Sign in from the sidebar account menu, then return to Model settings.',
  modelsSelectDefault: 'Choose an e宝工坊 default chat model',
  modelsSelectImageDefault: 'Choose an e宝工坊 default image model',
  modelsDisconnected: 'Cannot read your account right now. Check your connection.',
}

export function registerModelSettings(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'ebao: model settings dictionaries')

  let current = { ...ctx.accountUi.getSnapshot(), revision: 0 }
  const listeners = new Set<() => void>()
  ctx.on('account-ui/change', (state, reset) => {
    const committing = current.view?.attempt?.phase === 'committing'
    if (!reset && committing === (state.view?.attempt?.phase === 'committing')) return
    current = { ...state, revision: current.revision + 1 }
    for (const listener of listeners) listener()
  })

  const getSnapshot = () => current
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function ModelSettings({ t }: PropsLocale<typeof namespace>) {
    const { view, failed, revision } = useSyncExternalStore(subscribe, getSnapshot)
    const committing = view?.attempt?.phase === 'committing'
    if (!failed && !committing && view?.status === 'credential-stored') {
      // A credential change remounts the card and drops results from the previous account.
      return <CqaiModelsSettingsCard key={revision} ctx={ctx} t={t} />
    }

    const message = failed || (view === undefined && revision > 0)
      ? 'modelsDisconnected'
      : view === undefined || committing ? 'modelsLoading' : 'modelsLoginRequired'
    return (
      <section style={{ padding: 16, border: '0.5px solid var(--dsw-alias-settings-card-stroke)', borderRadius: 'var(--dsw-radius-xl)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 500 }}>{t('modelsTitle')}</h2>
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>{t(message)}</p>
      </section>
    )
  }

  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'cqaiclub-models',
    order: 10,
    locale: namespace,
  }, ModelSettings))
}
