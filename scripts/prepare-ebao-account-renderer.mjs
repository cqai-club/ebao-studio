/** Apply the e宝 account presentation to generated official Desktop browser bundles. */
import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { Script } from 'node:vm'

const LOCALES = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
const ACCOUNT_RENDERER_PACKAGES = {
  accountClient: 'ui-settings-account',
  chatClient: 'ui-chat',
  layoutClient: 'ui-layout',
  modelsClient: 'ui-settings-models',
  webSearchClient: 'ui-settings-web-search',
}

export function ebaoAccountWorkspaceClients(official) {
  return Object.fromEntries(Object.entries(ACCOUNT_RENDERER_PACKAGES)
    .map(([key, name]) => [key, join(official, 'packages', 'client', name, 'lib', 'client.js')]))
}

export function ebaoAccountPackagedClients(nodeModules) {
  return Object.fromEntries(Object.entries(ACCOUNT_RENDERER_PACKAGES)
    .map(([key, name]) => [key, join(nodeModules, '@deepseek-ai', `dsh-client-${name}`, 'lib', 'client.js')]))
}

// These functions run inside the generated client. Keep dependencies explicit.
function rebrandAccountText(dictionary) {
  const branded = Object.fromEntries(Object.entries(dictionary)
    .map(([key, value]) => [key, value.replace(/DeepSeek(?: Harness)?( (?=账号))?/g, 'e宝工坊')]))
  return { ...branded, settingsSignedOutDescription: branded.signInDescription }
}

function rebrandChatAccountErrors(dictionary, signInMessage) {
  const signedOut = 'message.failure.accountSignedOut'
  const signInRequired = 'message.failure.accountSignInRequired'
  return {
    ...dictionary,
    [signedOut]: dictionary[signedOut].replace('DeepSeek 登录', 'e宝工坊账号').replace('DeepSeek', 'e宝工坊'),
    [signInRequired]: signInMessage,
  }
}

const CHAT_SIGN_IN_COPY = {
  en: 'Sign in to your e宝工坊 account and try again.',
  zh: '请先登录 e宝工坊账号，再重试。',
  ja: 'e宝工坊のアカウントにログインしてから、もう一度お試しください。',
  es: 'Inicia sesión en tu cuenta de e宝工坊 y vuelve a intentarlo.',
  fr: 'Connectez-vous à votre compte e宝工坊, puis réessayez.',
  de: 'Melden Sie sich bei Ihrem e宝工坊-Konto an und versuchen Sie es erneut.',
  ru: 'Войдите в свой аккаунт e宝工坊 и повторите попытку.',
  pt: 'Entre na sua conta do e宝工坊 e tente novamente.',
}

function openEbaoAccountPage(links, page, onClose, refresh) {
  const url = new URL(page === 'usage' ? links?.usageUrl : links?.topUpUrl)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Invalid e宝 account page')
  }
  window.open(url.href, '_blank', 'noopener,noreferrer')
  const controller = new AbortController()
  if (page === 'top-up') {
    window.addEventListener('focus', refresh, { once: true, signal: controller.signal })
    window.setTimeout(() => controller.abort(), 300_000)
  }
  queueMicrotask(() => {
    if (!controller.signal.aborted) onClose('returned')
  })
  return () => controller.abort()
}

const SEARCH_BILLING_COPY = {
  en: ['Uses the configured DeepSeek API key.', 'Account billing unavailable', 'Select DeepSeek API key to use this service.', 'Uses this API key ({ref}), shared with Models by default.'],
  zh: ['使用已配置的 DeepSeek API Key。', '账号计费不可用', '请选用 DeepSeek API Key。', '使用此 API Key（{ref}），默认与「模型」页共用。'],
  ja: ['設定済みの DeepSeek API キーを使用します。', 'アカウント課金は利用できません', 'DeepSeek API キーを選択してください。', 'この API キー（{ref}）は、既定で「モデル」と共有されます。'],
  es: ['Usa la clave de API de DeepSeek configurada.', 'Facturación por cuenta no disponible', 'Selecciona la clave de API de DeepSeek.', 'Usa esta clave de API ({ref}), compartida con Modelos de forma predeterminada.'],
  fr: ['Utilise la clé API DeepSeek configurée.', 'Facturation par compte indisponible', 'Sélectionnez la clé API DeepSeek.', 'Utilise cette clé API ({ref}), partagée par défaut avec Modèles.'],
  de: ['Verwendet den konfigurierten DeepSeek-API-Schlüssel.', 'Kontoabrechnung nicht verfügbar', 'Wählen Sie den DeepSeek-API-Schlüssel.', 'Dieser API-Schlüssel ({ref}) wird standardmäßig mit „Modelle“ geteilt.'],
  ru: ['Использует настроенный ключ API DeepSeek.', 'Оплата через аккаунт недоступна', 'Выберите ключ API DeepSeek.', 'Использует этот ключ API ({ref}), по умолчанию общий с разделом «Модели».'],
  pt: ['Usa a chave de API da DeepSeek configurada.', 'Cobrança pela conta indisponível', 'Selecione a chave de API da DeepSeek.', 'Usa esta chave de API ({ref}), compartilhada com Modelos por padrão.'],
}

function patchOnce(source, anchor, replacement, feature) {
  const index = source.indexOf(anchor)
  if (index < 0 || source.indexOf(anchor, index + anchor.length) >= 0) {
    throw new Error(`Expected one generated ${feature} anchor in the pinned Desktop build`)
  }
  return source.replace(anchor, () => replacement)
}

function patchDictionaries(source, anchor, dictionary, feature) {
  const dictionaries = LOCALES.map(locale => `${locale}:${dictionary(locale)}`).join(',')
  return patchOnce(source, anchor, anchor.replace(/\{(?:en,zh|zh,en),ja,es,fr,de,ru,pt\}/, `{${dictionaries}}`), feature)
}

function patchAccount(source) {
  source = patchDictionaries(source, 'ctx.locale.register(`settings.account`,{en,zh,ja,es,fr,de,ru,pt})',
    locale => `(${rebrandAccountText})(${locale})`, 'account dictionaries')
  source = patchOnce(source, 'const nativePlatform=globalThis.dshPlatform;', 'const nativePlatform=void 0;', 'native Platform bridge')
  source = patchOnce(source,
    'const platformPageOpener=reRead=>(page,onClose)=>platformPages.open(page,reason=>{onClose(reason);if(reason===`returned`&&page===`top-up`)refreshAfterReturn(refreshing,reRead)});',
    `const openEbaoAccountPage=${openEbaoAccountPage};const platformPageOpener=reRead=>(page,onClose)=>openEbaoAccountPage(snapshot.view?.links,page,onClose,()=>refreshAfterReturn(refreshing,reRead));`,
    'account page opener')
  // Account settings and the quota prompt share refreshAccount. Desktop onboarding refreshes balance only.
  const accountOpener = '...nativePlatform===void 0?{}:{openPlatformPage:platformPageOpener(refreshAccount)}'
  if (source.split(accountOpener).length !== 3) throw new Error('Expected account settings and quota page openers')
  source = source.replaceAll(accountOpener, 'openPlatformPage:platformPageOpener(refreshAccount)')
  return patchOnce(source, '...nativePlatform===void 0?{}:{openPlatformPage:platformPageOpener(refresh)}',
    'openPlatformPage:platformPageOpener(refresh)', 'onboarding page opener')
}

function patchAccountSection(source) {
  source = patchOnce(source,
    'ctx.provide(`accountUi`,{getSnapshot:()=>snapshot,clientMetadata:client});',
    'ctx.provide(`accountUi`,{getSnapshot:()=>snapshot,clientMetadata:client,startSignIn:()=>operations.start()});',
    'account sign-in action')
  // Keep the stock sidebar and login dialog while the owned plugin renders the account section.
  return patchOnce(source,
    'ctx.remoteAccess.whenAccess(`account/watch`,()=>ctx.slots.inject(`settings.section`,()=>{let unregister;const update=()=>{if(snapshot.view?.status===`credential-stored`)unregister??=ctx.slots.register({name:`settings.section`,id:`account`,order:-10,label:()=>t(`nav`),locale:`settings.account`,inject:()=>operations},AccountSection);else{unregister?.();unregister=void 0}};listeners.add(update);update();return()=>{listeners.delete(update);unregister?.()}}))',
    'void 0',
    'account section registration')
}

function patchModels(source) {
  // The old account provider is disabled in the Profile. Retain its display label if
  // an external provider happens to expose an identically named route.
  return patchOnce(source,
    'rows:snapshot.rows.map(row=>row.entry.provider===`deepseek-account`?{...row,entry:{...row.entry,displayName:t(`deepSeekAccount`)}}:row)',
    'rows:snapshot.rows.map(row=>row.entry.provider===`cqaiclub`?{...row,entry:{...row.entry,displayName:`e宝工坊`}}:row)',
    'models account label')
}

function patchChat(source) {
  return patchDictionaries(source, 'ctx.locale.register(NS,{zh,en,ja,es,fr,de,ru,pt}),`ui-chat: dictionaries`',
    locale => `(${rebrandChatAccountErrors})(${locale},${JSON.stringify(CHAT_SIGN_IN_COPY[locale])})`,
    'chat account error dictionaries')
}

function patchLayout(source) {
  return patchOnce(source, 'const productTitle={}.DSH_CLIENT_TITLE??t(`brand.localBuild`);',
    'const productTitle=`e宝工坊`;', 'workspace window title')
}

function patchWebSearch(source) {
  source = patchDictionaries(source, 'ctx.locale.register(NS,{zh,en,ja,es,fr,de,ru,pt}),`ui-settings-web-search: dictionaries`',
    locale => {
      const [billingAutoHint, billingAccount, billingAccountHint, legacyKeyHint] = SEARCH_BILLING_COPY[locale]
      return `{...${locale},...${JSON.stringify({ billingAutoHint, billingAccount, billingAccountHint, legacyKeyHint })}}`
    }, 'web search dictionaries')
  source = patchOnce(source, 'const describe=section=>{const description=section.options.find(option=>option.id===section.selected)?.description;',
    'const describe=section=>{if(section.selected===PROVIDER_IDS.legacySearch)return t(`billingAutoHint`);const description=section.options.find(option=>option.id===section.selected)?.description;',
    'web search provider guidance')
  // Keep recognizing existing stored "account" values, while the menu only offers usable settings.
  return patchOnce(source, 'const BILLINGS=[`auto`,`account`,`api-key`];',
    'const BILLINGS=[`auto`,`api-key`];', 'web search billing choices')
}

const RENDERER_PATCHES = {
  accountClient: patchAccount, chatClient: patchChat, layoutClient: patchLayout,
  modelsClient: patchModels, webSearchClient: patchWebSearch,
}
const MARKER = '/* eBao desktop account renderer */\n'
const ACCOUNT_SECTION_MARKER = '/* eBao desktop account section */\n'

export function applyEbaoAccountRenderer(paths) {
  const updates = []
  for (const [key, patch] of Object.entries(RENDERER_PATCHES)) {
    const path = paths[key]
    if (typeof path !== 'string' || !isAbsolute(path) || !lstatSync(path).isFile()) {
      throw new Error(`Expected a generated Desktop browser bundle for ${key}`)
    }
    const source = readFileSync(path, 'utf8')
    let updated = source.startsWith(MARKER) || source.startsWith(ACCOUNT_SECTION_MARKER) ? source : MARKER + patch(source)
    if (key === 'accountClient' && !updated.startsWith(ACCOUNT_SECTION_MARKER)) {
      updated = ACCOUNT_SECTION_MARKER + patchAccountSection(updated)
    }
    if (updated === source) continue
    new Script(updated, { filename: path })
    updates.push({ path, updated })
  }
  for (const { path, updated } of updates) {
    const temp = `${path}.ebao-${process.pid}`
    writeFileSync(temp, updated, { flag: 'wx', mode: lstatSync(path).mode & 0o777 })
    renameSync(temp, path)
  }
  return updates.length
}
