import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { APP_ID, PRODUCT_NAME, createEbaoPackageEnvironment, packageOfficeSmokeSource, packageSmokeSource, prepareDevelopmentSource } from './package-ebao-desktop.mjs'
import { createEbaoBuilderConfig, packageDesktopHost, packageDesktopMain, packageWindowsInstaller, packageWindowsUninstaller } from './prepare-ebao-package.mjs'
import { PRODUCT_PLUGIN_BUNDLES, PRODUCT_PLUGIN_PACKAGE, installProductPlugins, linkOfficialSdkPackages } from './prepare-ebao-product-plugins.mjs'
import { publisherWorkerBuild } from './publisher-worker-paths.mjs'

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
  const root = fileURLToPath(new URL('../', import.meta.url))
  const workerLicense = { from: fileURLToPath(new URL('../matrixmedia-publisher/LICENSE', import.meta.url)), to: 'publisher/LICENSE' }
  assert.deepEqual(config.extraResources, [
    runtime, { from: config.mac.icon, to: 'icon.png' }, publisherWorkerBuild(root, 'darwin').resource, workerLicense,
  ])

  const windows = createEbaoBuilderConfig(() => fixture,
    { DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64' })
  assert.equal(windows.win.icon, brand('app-windows.ico'))
  assert.equal(windows.nsis.installerIcon, windows.win.icon)
  assert.equal(windows.nsis.uninstallerIcon, windows.win.icon)
  assert.deepEqual(windows.extraResources, [runtime,
    { from: brand('app-windows.png'), to: 'icon.png' },
    { from: brand('tray.ico'), to: 'tray.ico' },
    publisherWorkerBuild(root, 'win32').resource, workerLicense,
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
  assert.match(localized, /EBAO_PUBLISHER_WORKER = process\.platform === "win32"/u)
  assert.ok(localized.includes(`applicationName: ${JSON.stringify(PRODUCT_NAME)}`))
  assert.equal(packageDesktopMain(localized), localized)
  assert.throws(() => packageDesktopMain(''), /seam changed/u)

  const adapter = '@cqaiclub/fixture'
  const host = packageDesktopHost('const config = { patchFiles: [], args: [] };', adapter)
  assert.match(host, /patchFiles: \[join\(runtimeDir, "node_modules", "@cqaiclub\/fixture", "cordis.patch.yml"\)\]/u)
  assert.equal(packageDesktopHost(host, adapter), host)
  assert.throws(() => packageDesktopHost('patchFiles: []', adapter), /seam changed/u)
})

test('source product overlay is applied after official development project preparation', () => {
  const source = readFileSync(new URL('../deepseek-harness/apps/desktop/scripts/dev.ts', import.meta.url), 'utf8')
  assert.match(prepareDevelopmentSource(source),
    /prepareDevelopmentProject\(\{[\s\S]*?await prepareEbaoDevelopment\(join\(DEVELOPMENT_ROOT, "project"\)\)\s+await preparePrimaryRuntime\(\)/u)
  assert.throws(() => prepareDevelopmentSource(''), /seam changed/u)
})

test('product build resolves the pinned SDK without a pnpm workspace hoist', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'ebao-product-sdk-'))
  t.after(() => rmSync(fixture, { force: true, recursive: true }))
  const official = join(fixture, 'official')
  const modules = join(fixture, 'build', 'node_modules')
  mkdirSync(modules, { recursive: true })
  const packages = [
    ['vendor/cordis', '@deepseek-ai/cordis'],
    ['packages/boot/app-boot', '@deepseek-ai/dsh-app-boot'],
    ['apps/cli', '@deepseek-ai/dsh'],
  ]
  for (const [relativePath, name] of packages) {
    const source = join(official, relativePath)
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name }))
  }
  const scope = join(modules, '@deepseek-ai')
  linkOfficialSdkPackages(official, scope)
  for (const [relativePath, name] of packages) {
    assert.equal(realpathSync(join(modules, ...name.split('/'))), realpathSync(join(official, relativePath)))
  }
  rmSync(scope, { recursive: true })
  assert.ok(packages.every(([path]) => existsSync(join(official, path, 'package.json'))))
})

test('generated runtime keeps official defaults first and resolves every bundled product patch', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'ebao-product-overlay-'))
  t.after(() => rmSync(fixture, { force: true, recursive: true }))
  const modules = join(fixture, 'source')
  const runtime = join(fixture, 'runtime')
  const runtimeModules = join(runtime, 'node_modules')
  const manifest = (directory, data) => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify(data))
  }
  const readManifest = directory => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const web = join(runtimeModules, '@deepseek-ai', 'dsh-web-app')
  const cli = join(runtimeModules, '@deepseek-ai', 'dsh')
  manifest(web, { dsh: { bundle: { patch: './official.yml' } } })
  manifest(cli, { dependencies: { '@deepseek-ai/dsh-web-app': '0.2.2-rc.5' } })
  const dependencies = Object.fromEntries(PRODUCT_PLUGIN_BUNDLES.map(name => [name, '1.0.0']))
  for (const name of PRODUCT_PLUGIN_BUNDLES) {
    const directory = join(modules, ...name.split('/'))
    manifest(directory, { name, version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } })
    writeFileSync(join(directory, 'cordis.patch.yml'), `${name}: {}\n`)
  }

  const artifacts = { modules, version: '0.1.0', dependencies }
  installProductPlugins(runtime, artifacts)
  installProductPlugins(runtime, artifacts)
  const [official, ...productPatches] = readManifest(web).dsh.bundle.patch
  assert.equal(official, './official.yml')
  assert.deepEqual(productPatches.map(path => readFileSync(join(web, path), 'utf8')),
    PRODUCT_PLUGIN_BUNDLES.map(name => `${name}: {}\n`))
  assert.deepEqual(readManifest(cli).dependencies, {
    '@deepseek-ai/dsh-web-app': '0.2.2-rc.5', [PRODUCT_PLUGIN_PACKAGE]: artifacts.version,
  })
  const product = join(runtimeModules, ...PRODUCT_PLUGIN_PACKAGE.split('/'))
  assert.deepEqual(readManifest(product).dependencies, dependencies)
  for (const [name, version] of Object.entries(dependencies)) {
    assert.equal(readManifest(join(product, 'node_modules', ...name.split('/'))).version, version)
  }
})

test('packaged runtime smoke runs the renamed applications on both platforms', () => {
  const source = readFileSync(new URL('../deepseek-harness/apps/desktop/scripts/smoke-packaged-runtime.ts', import.meta.url), 'utf8')
  const changed = packageSmokeSource(source)
  for (const name of [PRODUCT_NAME, `${PRODUCT_NAME}.app`, `${PRODUCT_NAME}.exe`]) assert.ok(changed.includes(JSON.stringify(name)))
  assert.doesNotMatch(changed, /DeepSeek Harness/u)
  assert.throws(() => packageSmokeSource(''), /smoke path changed/u)
})

test('Intel macOS extends Office deadlines only in the isolated packaging smoke profile', () => {
  const source = readFileSync(new URL('../deepseek-harness/apps/desktop/scripts/smoke-runtime.ts', import.meta.url), 'utf8')
  const intel = { DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'x64' }
  const changed = packageOfficeSmokeSource(source, intel)
  assert.ok(changed.includes(String.raw`appendFileSync(join(profile, 'cordis.patch.yml'), "- id: office-kit\n  config:\n    outputDirectory: !!js dshHomePath('office-kit', 'outputs')\n    timeoutMs: 120000\n")`))
  assert.match(changed, /\/desktop-smoke-office\/\$\{extension\}[^\n]*\n[^\n]*AbortSignal\.timeout\(150000\)/u)
  assert.match(changed, /\/desktop-smoke-office-operations\/\$\{extension\}[^\n]*\n[^\n]*AbortSignal\.timeout\(390000\)/u)
  assert.equal(packageOfficeSmokeSource(source, { ...intel, DSH_DESKTOP_TARGET_ARCH: 'arm64' }), source)
  assert.equal(packageOfficeSmokeSource(source, { ...intel, DSH_DESKTOP_TARGET_PLATFORM: 'win32' }), source)
  assert.throws(() => packageOfficeSmokeSource('', intel), /seam changed/u)
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
