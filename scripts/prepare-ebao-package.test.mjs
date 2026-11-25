import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { APP_ID, PRODUCT_NAME, createEbaoPackageEnvironment, packageSmokeSource } from './package-ebao-desktop.mjs'
import { createEbaoBuilderConfig, packageDesktopHost, packageDesktopMain, packageWindowsInstaller, packageWindowsUninstaller } from './prepare-ebao-package.mjs'

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
  const runtime = { from: '/runtime', to: 'runtime' }
  const fixture = {
    extraMetadata: { dshMandatoryUpdatePolicy: { origin: 'https://download.deepseek.com' }, upstreamField: true },
    extraResources: [runtime, { from: '/harness/icon.png', to: 'icon.png' }, { from: '/harness/tray.ico', to: 'tray.ico' }],
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
  const brand = name => fileURLToPath(new URL(`../assets/desktop-brand/${name}`, import.meta.url))
  assert.equal(config.mac.icon, brand('app-macos.png'))
  assert.deepEqual(config.extraResources, [runtime, { from: config.mac.icon, to: 'icon.png' }])

  const windows = createEbaoBuilderConfig(() => fixture,
    { DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64' })
  assert.equal(windows.win.icon, brand('app-windows.ico'))
  assert.equal(windows.nsis.installerIcon, windows.win.icon)
  assert.equal(windows.nsis.uninstallerIcon, windows.win.icon)
  assert.deepEqual(windows.extraResources, [runtime,
    { from: brand('app-windows.png'), to: 'icon.png' },
    { from: brand('tray.ico'), to: 'tray.ico' },
  ])
  assert.notEqual(config.beforePack, beforePack)
  assert.equal(config.afterPack, afterPack)
  assert.throws(() => createEbaoBuilderConfig(() => fixture, { DSH_DESKTOP_UNSIGNED: '0' }), /unsigned/u)
})

test('generated package transforms isolate installed state and mount the account as a launcher overlay', () => {
  const main = [
    'let focusPrimaryWindow = () => {};',
    'app.setAsDefaultProtocolClient("dsh");',
    'app.setAboutPanelOptions({ applicationName: "DeepSeek Harness" });',
    'if (url === "dsh://open" || url === "dsh://open/") focusPrimaryWindow();',
  ].join('\n')
  const localized = packageDesktopMain(main)
  assert.match(localized, /if \(app\.isPackaged\) \{[\s\S]*?app\.setPath\("userData", userData\);[\s\S]*?\.ebao-studio/u)
  assert.match(localized, /app\.isPackaged \? "ebao" : "dsh"/u)
  assert.ok(localized.includes(`applicationName: ${JSON.stringify(PRODUCT_NAME)}`))
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

test('generated Windows installer resolves pinned script includes from its new directory', () => {
  const desktop = new URL('../deepseek-harness/apps/desktop/', import.meta.url)
  const source = readFileSync(new URL('scripts/installer.nsh', desktop), 'utf8')
  const changed = packageWindowsInstaller(source)
  const includes = [...changed.matchAll(/^ *!include "\$\{__FILEDIR__\}\\([^"\r\n]+)"$/gmu)]
    .map(([, path]) => path.replaceAll('\\', '/'))
  assert.deepEqual(includes, [
    '../../../../scripts/restart-banner.nsh',
    '../../../../scripts/installer-directories.nsh',
  ])
  const generatedDirectory = new URL('.desktop-build/targets/win-x64/installer-ui/', desktop)
  for (const path of includes) assert.ok(readFileSync(new URL(path, generatedDirectory), 'utf8').length > 0)
})

test('Windows uninstaller cleans the e宝 data path without deleting stock or old product directories', () => {
  const source = readFileSync(new URL('../deepseek-harness/apps/desktop/installer/uninstall.nsh', import.meta.url), 'utf8')
  const changed = packageWindowsUninstaller(source)
  assert.ok(changed.includes('$APPDATA\\eBao Studio Desktop'))
  assert.ok(changed.includes('$LOCALAPPDATA\\${DSH_UPDATER_CACHE_NAME}'))
  assert.doesNotMatch(changed, /PRODUCT_FILENAME|APP_PACKAGE_NAME/u)
  assert.match(changed, /KEEP_APP_DATA/u)
})
