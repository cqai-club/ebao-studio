/** Apply the e宝 integration to the generated files consumed by the pinned Desktop packager. */
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_ID, PRODUCT_NAME, replacePackageSeam } from './package-ebao-desktop.mjs'
import { buildAccountExtensions, createPreparationPlan } from './prepare-cqai-account.mjs'
import { applyEbaoAccountRenderer, ebaoAccountPackagedClients } from './prepare-ebao-account-renderer.mjs'
import { buildWelcomePresentation, createWelcomePlan } from './prepare-ebao-welcome.mjs'

const welcomePlan = createWelcomePlan()
const buildPaths = await import(pathToFileURL(join(welcomePlan.desktop, 'scripts', 'desktop-build-paths.mjs')))
const productVersion = JSON.parse(readFileSync(join(welcomePlan.root, 'package.json'), 'utf8')).version
const PACKAGE_NAME = 'ebao-studio-desktop'
const USER_DATA_NAME = 'eBao Studio Desktop'

const PRODUCT_IDENTITY = `const ebaoDesktopProtocol = app.isPackaged ? "ebao" : "dsh";
if (app.isPackaged) {
  const userData = join(app.getPath("appData"), ${JSON.stringify(USER_DATA_NAME)});
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
  process.env.DSH_HOME = join(app.getPath("home"), ".ebao-studio");
}`

export function packageDesktopMain(source) {
  if (source.includes(PRODUCT_IDENTITY)) return source
  source = replacePackageSeam(source, 'let focusPrimaryWindow =', `${PRODUCT_IDENTITY}\nlet focusPrimaryWindow =`)
  source = replacePackageSeam(source, 'app.setAsDefaultProtocolClient("dsh")', 'app.setAsDefaultProtocolClient(ebaoDesktopProtocol)')
  return replacePackageSeam(source, 'url === "dsh://open" || url === "dsh://open/"', 'url === `${ebaoDesktopProtocol}://open` || url === `${ebaoDesktopProtocol}://open/`')
}

export function packageDesktopHost(source, adapterPackageName) {
  const overlay = `patchFiles: [join(runtimeDir, "node_modules", ${JSON.stringify(adapterPackageName)}, "cordis.patch.yml")],`
  if (source.includes(overlay)) return source
  return replacePackageSeam(source, 'patchFiles: [],', overlay)
}

export function packageWindowsUninstaller(source) {
  const begin = '  StrCpy $UnTarget "$APPDATA\\${PRODUCT_FILENAME}"'
  const end = '  StrCpy $UnTarget "$LOCALAPPDATA\\${DSH_UPDATER_CACHE_NAME}"'
  const startIndex = source.indexOf(begin)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex <= startIndex) throw new Error('Official Windows uninstall data paths changed')
  return replacePackageSeam(source, source.slice(startIndex, endIndex), `  StrCpy $UnTarget "$APPDATA\\${USER_DATA_NAME}"\n  Call un.RemoveData\n`)
}

export function packageWindowsInstaller(source) {
  const scripts = '${__FILEDIR__}\\..\\..\\..\\..\\scripts'
  for (const name of ['restart-banner.nsh', 'installer-directories.nsh']) {
    source = replacePackageSeam(source, `!include "\${__FILEDIR__}\\${name}"`, `!include "${scripts}\\${name}"`)
  }
  source = replacePackageSeam(source, '!define INSTALLER_SOURCE_DIR "${__FILEDIR__}\\..\\installer"', '!define INSTALLER_SOURCE_DIR "${__FILEDIR__}\\..\\..\\..\\..\\installer"')
  source = replacePackageSeam(source, '!define /ifndef INSTALLER_BUILD_DIR "${__FILEDIR__}\\..\\.desktop-build\\targets\\win-x64\\installer-ui"', '!define /ifndef INSTALLER_BUILD_DIR "${__FILEDIR__}"')
  return replacePackageSeam(source, '!include "${INSTALLER_SOURCE_DIR}\\uninstall.nsh"', '!include "${INSTALLER_BUILD_DIR}\\ebao-uninstall.nsh"')
}

function prepareWindowsInstaller(directory) {
  const installer = readFileSync(join(welcomePlan.desktop, 'scripts', 'installer.nsh'), 'utf8')
  writeFileSync(join(directory, 'ebao-installer.nsh'), packageWindowsInstaller(installer), 'utf8')
  const uninstaller = readFileSync(join(welcomePlan.desktop, 'installer', 'uninstall.nsh'), 'utf8')
  writeFileSync(join(directory, 'ebao-uninstall.nsh'), packageWindowsUninstaller(uninstaller), 'utf8')
  editGenerated(join(directory, 'strings.nsh'), text => text.replaceAll('DeepSeek Harness', PRODUCT_NAME))
}

function editGenerated(path, transform) {
  const original = readFileSync(path, 'utf8')
  const changed = transform(original)
  if (changed !== original) writeFileSync(path, changed, 'utf8')
}

function packageAccount(plan, runtime, artifacts) {
  const modules = join(runtime, 'node_modules')
  const dsh = join(modules, '@deepseek-ai', 'dsh', 'package.json')
  const host = join(modules, '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  const names = [artifacts.account, artifacts.adapter].map(directory => {
    const { name, version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    cpSync(directory, join(modules, ...name.split('/')), { recursive: true })
    return { name, version }
  })
  // Boot's installation anchor is dsh/package.json. Include the bundled packages in its dependency closure.
  editGenerated(dsh, source => {
    const manifest = JSON.parse(source)
    for (const { name, version } of names) manifest.dependencies[name] = version
    return `${JSON.stringify(manifest, null, 2)}\n`
  })
  editGenerated(host, source => packageDesktopHost(source, names[1].name))
  editGenerated(join(plan.desktop, 'lib', 'main.js'), packageDesktopMain)
  return names.map(({ name }) => name)
}

async function preparePackageRuntime(plan, paths) {
  await buildWelcomePresentation(plan)
  const accountPlan = createPreparationPlan({ root: plan.root, environment: {} })
  const artifacts = await buildAccountExtensions(accountPlan)
  const sharedNames = packageAccount(plan, paths.dsh, artifacts)
  applyEbaoAccountRenderer(ebaoAccountPackagedClients(join(paths.dsh, 'node_modules')))

  const runtimeTree = await import(pathToFileURL(join(plan.desktop, 'lib', 'types', 'runtime-tree.js')))
  const { release, sharedPackages, platform, arch } = runtimeTree.readDesktopRuntime(paths.dsh)
  await runtimeTree.writeDesktopRuntimeAsync(paths.dsh, release, [...sharedPackages.map(entry => entry.name), ...sharedNames], { platform, arch })
}

export function createEbaoBuilderConfig(createOfficialConfig, environment = process.env) {
  if (environment.DSH_DESKTOP_UNSIGNED !== '1') throw new Error('The e宝 Desktop preview currently packages unsigned artifacts only')
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(productVersion)) {
    throw new Error('The e宝 Desktop release requires a version in the outer package.json')
  }
  const config = createOfficialConfig({ ...environment, DSH_DESKTOP_APP_ID: APP_ID })
  const paths = buildPaths.resolveDesktopTargetBuildPaths(environment)
  const { dshMandatoryUpdatePolicy: _unusedPolicy, ...metadata } = config.extraMetadata
  const { beforeBuild, beforePack } = config
  const installerDirectory = join(paths.root, 'installer-ui')
  const windows = environment.DSH_DESKTOP_TARGET_PLATFORM === 'win32'
  return {
    ...config,
    productName: PRODUCT_NAME,
    protocols: [{ name: PRODUCT_NAME, schemes: ['ebao'] }],
    artifactName: 'eBao-Studio-${version}-${os}-${arch}-unsigned.${ext}',
    extraMetadata: { ...metadata, name: PACKAGE_NAME, version: productVersion },
    mac: { ...config.mac, extendInfo: { ...config.mac.extendInfo, NSMicrophoneUsageDescription: 'e宝工坊 uses your microphone to transcribe speech into message drafts.' } },
    ...(windows ? {
      nsis: { ...config.nsis, include: join(installerDirectory, 'ebao-installer.nsh') },
      beforeBuild: async context => {
        const includeDependencies = await beforeBuild(context)
        prepareWindowsInstaller(installerDirectory)
        return includeDependencies
      },
    } : {}),
    beforePack: async context => {
      await preparePackageRuntime(welcomePlan, paths)
      await beforePack(context)
    },
  }
}
