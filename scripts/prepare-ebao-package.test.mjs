import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { APP_ID, PRODUCT_NAME, createEbaoPackageEnvironment, packageSmokeSource } from './package-ebao-desktop.mjs'
import { createEbaoBuilderConfig, packageDesktopHost, packageDesktopMain, packageWindowsUninstaller } from './prepare-ebao-package.mjs'

test('Windows unsigned packaging has independent identity and ignores upstream release credentials', () => {
  const environment = createEbaoPackageEnvironment({
    PATH: 'tools', EBAO_DESKTOP_PACKAGE: '1', DSH_DESKTOP_APP_ID: 'com.deepseek.harness',
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: '{}', DSH_DESKTOP_WINDOWS_CER_FILE: '/private/certificate',
    CSC_LINK: '/private/signing', DOWNLOAD_PROD_COS_SECRET_KEY: 'private',
  })
  assert.equal(environment.DSH_DESKTOP_APP_ID, APP_ID)
  assert.equal(environment.PATH, 'tools')
  assert.equal(environment.EBAO_DESKTOP_PACKAGE, '1')
  for (const key of ['DSH_DESKTOP_MANDATORY_UPDATE_CONFIG', 'DSH_DESKTOP_WINDOWS_CER_FILE', 'CSC_LINK', 'DOWNLOAD_PROD_COS_SECRET_KEY']) {
    assert.equal(environment[key], undefined)
  }
})

test('e宝 builder keeps upstream packaging checks while selecting its own version, update boundary and protocol', () => {
  const beforePack = () => {}
  const afterPack = () => {}
  const fixture = {
    extraMetadata: { dshMandatoryUpdatePolicy: { origin: 'https://download.deepseek.com' }, upstreamField: true },
    mac: { extendInfo: { CFBundleLocalizations: ['zh_CN'] } }, beforePack, afterPack,
  }
  const config = createEbaoBuilderConfig(env => {
    assert.equal(env.DSH_DESKTOP_APP_ID, APP_ID)
    return fixture
  }, { DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'arm64' })
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  assert.equal(config.productName, PRODUCT_NAME)
  assert.deepEqual(config.extraMetadata, { name: 'ebao-studio-desktop', version, upstreamField: true })
  assert.deepEqual(config.protocols, [{ name: PRODUCT_NAME, schemes: ['ebao'] }])
  assert.match(config.artifactName, /^eBao-Studio-.*-unsigned\./u)
  assert.deepEqual(config.mac.extendInfo.CFBundleLocalizations, ['zh_CN'])
  assert.notEqual(config.beforePack, beforePack)
  assert.equal(config.afterPack, afterPack)
  assert.throws(() => createEbaoBuilderConfig(() => fixture, { DSH_DESKTOP_UNSIGNED: '0' }), /unsigned/u)
})

test('generated package transforms isolate installed state and mount the account as a launcher overlay', () => {
  const main = [
    'let focusPrimaryWindow = () => {};',
    'app.setAsDefaultProtocolClient("dsh");',
    'if (url === "dsh://open" || url === "dsh://open/") focusPrimaryWindow();',
  ].join('\n')
  const localized = packageDesktopMain(main)
  assert.match(localized, /if \(app\.isPackaged\) \{[\s\S]*?app\.setPath\("userData", userData\);[\s\S]*?\.ebao-studio/u)
  assert.match(localized, /app\.isPackaged \? "ebao" : "dsh"/u)
  assert.equal(packageDesktopMain(localized), localized)
  assert.throws(() => packageDesktopMain(''), /seam changed/u)

  const adapter = '@cqaiclub/fixture'
  const host = packageDesktopHost('const config = { patchFiles: [], args: [] };', adapter)
  assert.match(host, /patchFiles: \[join\(runtimeDir, "node_modules", "@cqaiclub\/fixture", "cordis.patch.yml"\)\]/u)
  assert.equal(packageDesktopHost(host, adapter), host)
  assert.throws(() => packageDesktopHost('patchFiles: []', adapter), /seam changed/u)
})

test('packaged runtime smoke runs the renamed applications on both platforms', () => {
  const source = readFileSync(new URL('../deepseek-harness/apps/desktop/scripts/smoke-packaged-runtime.ts', import.meta.url), 'utf8')
  const changed = packageSmokeSource(source)
  for (const name of [PRODUCT_NAME, `${PRODUCT_NAME}.app`, `${PRODUCT_NAME}.exe`]) assert.ok(changed.includes(JSON.stringify(name)))
  assert.doesNotMatch(changed, /DeepSeek Harness/u)
  assert.throws(() => packageSmokeSource(''), /smoke path changed/u)
})

test('Windows uninstaller cleans the e宝 data path without deleting stock or old product directories', () => {
  const source = readFileSync(new URL('../deepseek-harness/apps/desktop/installer/uninstall.nsh', import.meta.url), 'utf8')
  const changed = packageWindowsUninstaller(source)
  assert.ok(changed.includes('$APPDATA\\eBao Studio Desktop'))
  assert.ok(changed.includes('$LOCALAPPDATA\\${DSH_UPDATER_CACHE_NAME}'))
  assert.doesNotMatch(changed, /PRODUCT_FILENAME|APP_PACKAGE_NAME/u)
  assert.match(changed, /KEEP_APP_DATA/u)
})
