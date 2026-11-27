import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { applyEbaoAccountRenderer, ebaoAccountPackagedClients } from './prepare-ebao-account-renderer.mjs'

const dictionaries = `
const en={loginDescription:"Sign in to your DeepSeek account",signInDescription:"Use your DeepSeek account",onboardingBrand:"DeepSeek Harness"};
const zh={loginDescription:"登录 DeepSeek 账号",signInDescription:"登录 DeepSeek 账号",onboardingBrand:"DeepSeek Harness"};
const [ja,es,fr,de,ru,pt]=Array(6).fill(en);
`
const accountBundle = `${dictionaries}
const ctx={locale:{register(ns,copy){ globalThis.copy=copy }},
  provide(key, value){ globalThis[key] = value },
  remoteAccess:{whenAccess(){ globalThis.stockSection = true }}};
ctx.locale.register(\`settings.account\`,{en,zh,ja,es,fr,de,ru,pt});
const nativePlatform=globalThis.dshPlatform;
const snapshot={view:{links:{usageUrl:'https://cqaiclub.asia/usage',topUpUrl:'https://cqaiclub.asia/top-up'}}};
const client=()=>({});
ctx.provide(\`accountUi\`,{getSnapshot:()=>snapshot,clientMetadata:client});
const operations={start:async()=>{globalThis.signIns++}};
ctx.remoteAccess.whenAccess(\`account/watch\`,()=>ctx.slots.inject(\`settings.section\`,()=>{let unregister;const update=()=>{if(snapshot.view?.status===\`credential-stored\`)unregister??=ctx.slots.register({name:\`settings.section\`,id:\`account\`,order:-10,label:()=>t(\`nav\`),locale:\`settings.account\`,inject:()=>operations},AccountSection);else{unregister?.();unregister=void 0}};listeners.add(update);update();return()=>{listeners.delete(update);unregister?.()}}))
const refresh=()=>globalThis.refreshes++;
const refreshAccount=refresh;
const refreshing=undefined;
const refreshAfterReturn=(_previous, reRead)=>reRead();
const platformPageOpener=reRead=>(page,onClose)=>platformPages.open(page,reason=>{onClose(reason);if(reason===\`returned\`&&page===\`top-up\`)refreshAfterReturn(refreshing,reRead)});
globalThis.account={...nativePlatform===void 0?{}:{openPlatformPage:platformPageOpener(refreshAccount)}};
globalThis.quota={...nativePlatform===void 0?{}:{openPlatformPage:platformPageOpener(refreshAccount)}};
globalThis.onboarding={...nativePlatform===void 0?{}:{openPlatformPage:platformPageOpener(refresh)}};
globalThis.native=nativePlatform;
`
const chatBundle = `
const en={"message.failure.accountSignedOut":"Stopped because you signed out of DeepSeek.","message.failure.accountSignInRequired":"Sign in to DeepSeek and ensure the request destination supports account authentication.","message.failure.auth":"API key is invalid"};
const zh={"message.failure.accountSignedOut":"任务已因退出 DeepSeek 登录而停止。","message.failure.accountSignInRequired":"请先登录 DeepSeek，并确认请求地址支持账号认证。","message.failure.auth":"API 密钥无效"};
const [ja,es,fr,de,ru,pt]=Array(6).fill(en);
const ctx={locale:{register(ns,copy){globalThis.copy=copy}},effect(fn){fn()}};
const NS='chat';
ctx.effect(()=>ctx.locale.register(NS,{zh,en,ja,es,fr,de,ru,pt}),\`ui-chat: dictionaries\`);
`
const layoutBundle = `
const productTitle={}.DSH_CLIENT_TITLE??t(\`brand.localBuild\`);
globalThis.productTitle=productTitle;
`
const modelsBundle = `
const snapshot={rows:[{entry:{provider:'cqaiclub',displayName:'CQAI Club'}},{entry:{provider:'deepseek-official',displayName:'DeepSeek'}}]};
const t=key=>key;
globalThis.modelState={...snapshot,rows:snapshot.rows.map(row=>row.entry.provider===\`deepseek-account\`?{...row,entry:{...row.entry,displayName:t(\`deepSeekAccount\`)}}:row)};
`
const webSearchBundle = `${dictionaries}
const ctx={locale:{register(ns,copy){globalThis.copy=copy}},effect(fn){fn()}};
const NS='settings.webSearch';
ctx.effect(()=>ctx.locale.register(NS,{zh,en,ja,es,fr,de,ru,pt}),\`ui-settings-web-search: dictionaries\`);
const BILLINGS=[\`auto\`,\`account\`,\`api-key\`];
const PROVIDER_IDS={legacySearch:'deepseek-official'};
const t=key=>copy.en[key];
const describe=section=>{const description=section.options.find(option=>option.id===section.selected)?.description;return description};
globalThis.billingChoices=BILLINGS;
globalThis.legacyProviderDescription=describe({selected:'deepseek-official',options:[]});
`

function fixtures(t, webSearchClient = webSearchBundle) {
  const directory = mkdtempSync(join(tmpdir(), 'ebao-account-renderer-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const paths = ebaoAccountPackagedClients(join(directory, 'node_modules'))
  const bundles = {
    accountClient: accountBundle, chatClient: chatBundle, layoutClient: layoutBundle, modelsClient: modelsBundle, webSearchClient,
  }
  for (const [key, fixture] of Object.entries(bundles)) {
    mkdirSync(dirname(paths[key]), { recursive: true })
    writeFileSync(paths[key], fixture)
  }
  return paths
}

test('brands account copy, replaces the stock account section and retains native sign-in', async t => {
  const paths = fixtures(t)
  assert.equal(applyEbaoAccountRenderer(paths), 5)
  assert.equal(applyEbaoAccountRenderer(paths), 0)
  const calls = []
  const close = []
  const pending = []
  const window = new EventTarget()
  window.open = (...args) => calls.push(args)
  window.setTimeout = () => {}
  const context = { window, URL, AbortController, queueMicrotask: callback => pending.push(callback), refreshes: 0, signIns: 0,
    dshPlatform: { open: () => assert.fail('The DeepSeek platform bridge must stay disabled') } }
  runInNewContext(readFileSync(paths.accountClient, 'utf8'), context)
  assert.equal(context.native, undefined)
  assert.equal(context.stockSection, undefined)
  await context.accountUi.startSignIn()
  assert.equal(context.signIns, 1)
  assert.equal(Object.keys(context.copy).length, 8)
  assert.equal(context.copy.zh.loginDescription, '登录 e宝工坊账号')
  assert.equal(context.copy.en.settingsSignedOutDescription, 'Use your e宝工坊 account')
  for (const copy of Object.values(context.copy)) assert.equal(copy.onboardingBrand, 'e宝工坊')
  context.account.openPlatformPage('usage', value => close.push(value))
  context.onboarding.openPlatformPage('top-up', value => close.push(value))
  assert.deepEqual(calls, [
    ['https://cqaiclub.asia/usage', '_blank', 'noopener,noreferrer'],
    ['https://cqaiclub.asia/top-up', '_blank', 'noopener,noreferrer'],
  ])
  for (const callback of pending) callback()
  assert.deepEqual(close, ['returned', 'returned'])
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('focus'))
  assert.equal(context.refreshes, 1)
})

test('brands account errors from stored chat turns and preserves API-key guidance', t => {
  const paths = fixtures(t)
  applyEbaoAccountRenderer(paths)
  const context = {}
  runInNewContext(readFileSync(paths.chatClient, 'utf8'), context)
  assert.equal(Object.keys(context.copy).length, 8)
  for (const copy of Object.values(context.copy)) {
    assert.match(copy['message.failure.accountSignedOut'], /e宝工坊/u)
    assert.match(copy['message.failure.accountSignInRequired'], /e宝工坊/u)
  }
  assert.equal(context.copy.zh['message.failure.accountSignedOut'], '任务已因退出 e宝工坊账号而停止。')
  assert.equal(context.copy.zh['message.failure.accountSignInRequired'], '请先登录 e宝工坊账号，再重试。')
  assert.equal(context.copy.en['message.failure.auth'], 'API key is invalid')
})

test('uses the e宝 product name in the workspace window title', t => {
  const paths = fixtures(t)
  applyEbaoAccountRenderer(paths)
  const context = {}
  runInNewContext(readFileSync(paths.layoutClient, 'utf8'), context)
  assert.equal(context.productTitle, 'e宝工坊')
})

test('labels the CQAI model route and leaves legacy DeepSeek search billing editable', t => {
  const paths = fixtures(t)
  applyEbaoAccountRenderer(paths)
  const models = {}
  runInNewContext(readFileSync(paths.modelsClient, 'utf8'), models)
  assert.equal(models.modelState.rows[0].entry.displayName, 'e宝工坊')
  assert.equal(models.modelState.rows[1].entry.displayName, 'DeepSeek')
  const context = {}
  runInNewContext(readFileSync(paths.webSearchClient, 'utf8'), context)
  assert.deepEqual(Array.from(context.billingChoices), ['auto', 'api-key'])
  assert.equal(context.copy.en.billingAccount, 'Account billing unavailable')
  assert.equal(context.copy.zh.billingAccountHint, '请选用 DeepSeek API Key。')
  assert.equal(context.legacyProviderDescription, 'Uses the configured DeepSeek API key.')
})

test('requires the pinned generated anchors before changing any of the bundles', t => {
  const paths = fixtures(t, 'const unrelated = true')
  assert.throws(() => applyEbaoAccountRenderer(paths), /web search dictionaries anchor/)
  assert.equal(readFileSync(paths.accountClient, 'utf8'), accountBundle)
  assert.equal(readFileSync(paths.chatClient, 'utf8'), chatBundle)
  assert.equal(readFileSync(paths.layoutClient, 'utf8'), layoutBundle)
  assert.equal(readFileSync(paths.modelsClient, 'utf8'), modelsBundle)
})
