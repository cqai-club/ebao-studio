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
const ctx={locale:{register(ns,copy){ globalThis.copy=copy }}};
ctx.locale.register(\`settings.account\`,{en,zh,ja,es,fr,de,ru,pt});
const nativePlatform=globalThis.dshPlatform;
const snapshot={view:{links:{usageUrl:'https://cqaiclub.asia/usage',topUpUrl:'https://cqaiclub.asia/top-up'}}};
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
  for (const [key, fixture] of Object.entries({ accountClient: accountBundle, modelsClient: modelsBundle, webSearchClient })) {
    mkdirSync(dirname(paths[key]), { recursive: true })
    writeFileSync(paths[key], fixture)
  }
  return paths
}

test('brands account copy in all locales and opens Club account pages in the browser', t => {
  const paths = fixtures(t)
  assert.equal(applyEbaoAccountRenderer(paths), 3)
  assert.equal(applyEbaoAccountRenderer(paths), 0)
  const calls = []
  const close = []
  const pending = []
  const window = new EventTarget()
  window.open = (...args) => calls.push(args)
  window.setTimeout = () => {}
  const context = { window, URL, AbortController, queueMicrotask: callback => pending.push(callback), refreshes: 0,
    dshPlatform: { open: () => assert.fail('The DeepSeek platform bridge must stay disabled') } }
  runInNewContext(readFileSync(paths.accountClient, 'utf8'), context)
  assert.equal(context.native, undefined)
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
  assert.equal(readFileSync(paths.modelsClient, 'utf8'), modelsBundle)
})
