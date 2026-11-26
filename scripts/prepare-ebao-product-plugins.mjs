/** Compile e宝's default plugins in a separate, locked pnpm project. */
import { spawn } from 'node:child_process'
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { assertOwnedPath, officialPnpmCommand } from './prepare-cqai-account.mjs'

export const PRODUCT_PLUGIN_PACKAGE = '@cqaiclub/desktop-product-plugins'
const PRODUCT_PLUGIN_PATH = PRODUCT_PLUGIN_PACKAGE.split('/')

// The catalog backend and PPT engine are needed by the corresponding e宝 plugins.
const OWNED_SOURCES = [
  'dsh-community-market',
  'cqai-dsh-plugins/cqai-dsh-plugin-imagegen',
  'cqai-dsh-plugins/cqai-dsh-plugin-publisher',
  'cqai-dsh-plugins/cqai-dsh-plugin-market',
  'cqai-dsh-plugins/dsh-skill-mcp-panel',
  'cqai-dsh-plugins/cqai-dsh-plugin-desktop-presentation',
  'cqai-dsh-plugins/cqai-dsh-plugin-cqai-club-theme',
]
export const PRODUCT_PLUGIN_BUNDLES = [
  'cqai-dsh-plugin-imagegen',
  'cqai-dsh-plugin-publisher',
  '@xmanrui/dsh-im',
  'dsh-community-market',
  'cqai-dsh-plugin-market',
  'dsh-skill-mcp-panel',
  'dsh-ppt-composer',
  'cqai-dsh-plugin-desktop-presentation',
  'cqai-dsh-plugin-cqai-club-theme',
]

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const packageDir = (directory, name) => join(directory, ...name.split('/'))
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
const excluded = new Set(['node_modules', 'lib', '.git', '.DS_Store'])
const sourceFilter = source => !excluded.has(source.split(/[/\\]/u).at(-1))
const artifactFilter = source => !['.bin', '.DS_Store', '.gitkeep', '.pnpm-workspace-state-v1.json'].includes(source.split(/[/\\]/u).at(-1))

function runPnpm(plan, project, args, env = process.env) {
  const invocation = officialPnpmCommand(plan)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, [invocation.args[0], '--dir', project, ...args], {
      cwd: project, env: { ...env, CI: 'true' }, stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Product plugins: pnpm ${args.join(' ')} in ${project} exited with ${code ?? signal}`))
    })
  })
}

function copyOwnedArtifact(source, modules) {
  const manifest = readJson(join(source, 'package.json'))
  const target = packageDir(modules, manifest.name)
  mkdirSync(join(target, 'src'), { recursive: true })
  for (const file of ['lib', 'assets', 'skills', 'docs/schemas', 'src/templates', 'dsh.plugin.json',
    'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'LUCIDE_LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    if (existsSync(join(source, file))) cpSync(join(source, file), join(target, file), { recursive: true })
  }
  const { scripts: _scripts, devDependencies: _dev, ...metadata } = manifest
  writeJson(join(target, 'package.json'), metadata)
}

export function validateProductPluginArtifacts(modules, names = PRODUCT_PLUGIN_BUNDLES) {
  return Object.fromEntries(names.map(name => {
    const directory = packageDir(modules, name)
    const manifest = readJson(join(directory, 'package.json'))
    const patch = manifest.dsh?.bundle?.patch
    const patches = [patch].flat().filter(Boolean)
    if (manifest.name !== name || !manifest.version || !patches.length
      || patches.some(file => !lstatSync(join(directory, file), { throwIfNoEntry: false })?.isFile())) {
      throw new Error(`Missing product plugin entry or patch for ${name}`)
    }
    return [name, manifest.version]
  }))
}

export async function buildProductPlugins(plan) {
  assertOwnedPath(plan.root, plan.state)
  mkdirSync(plan.state, { recursive: true })
  const temporary = mkdtempSync(join(plan.state, 'ebao-product-plugins.'))
  const integration = join(plan.root, 'integrations', 'ebao-product-plugins')
  const modules = join(temporary, 'node_modules')
  const sdkScope = join(modules, '@deepseek-ai')
  const install = options => runPnpm(plan, temporary, ['install', '--frozen-lockfile', '--ignore-scripts', ...options])
  const dispose = () => rmSync(temporary, { force: true, recursive: true })
  try {
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      cpSync(join(integration, file), join(temporary, file))
    }
    const manifest = readJson(join(temporary, 'package.json'))
    await install([])
    symlinkSync(join(plan.official, 'node_modules', '.pnpm', 'node_modules', '@deepseek-ai'),
      sdkScope, process.platform === 'win32' ? 'junction' : 'dir')
    const sources = OWNED_SOURCES.map(path => {
      const target = join(temporary, path)
      cpSync(join(plan.root, path), target, { recursive: true, filter: sourceFilter })
      return target
    })
    // e图宝 bundles the shared model predicates while consuming the installed account service via Cordis.
    const accountProtocol = 'cqai-dsh-plugins/cqai-dsh-plugin-account/src/protocol.ts'
    mkdirSync(dirname(join(temporary, accountProtocol)), { recursive: true })
    cpSync(join(plan.root, accountProtocol), join(temporary, accountProtocol))
    const PATH = [join(modules, '.bin'), process.env.PATH].filter(Boolean).join(delimiter)
    // Each source uses the shared locked install above. Disable pnpm 11's
    // automatic installation for lifecycle commands in these copied packages.
    const build = directory => runPnpm(plan, directory, ['run', 'build'], {
      ...process.env, PATH, npm_config_verify_deps_before_run: 'false',
    })
    const [market, ...otherSources] = sources
    await build(market)
    const marketLink = join(modules, 'dsh-community-market')
    symlinkSync(market, marketLink, process.platform === 'win32' ? 'junction' : 'dir')
    const results = await Promise.allSettled(otherSources.map(build))
    for (const result of results) if (result.status === 'rejected') throw result.reason
    unlinkSync(sdkScope)
    unlinkSync(marketLink)
    await install(['--prod'])
    for (const source of sources) copyOwnedArtifact(source, modules)
    const { prepareLegacyPluginArtifacts } = await import('../integrations/ebao-product-plugins/prepare-legacy-plugins.mjs')
    await prepareLegacyPluginArtifacts(modules)
    const bundles = validateProductPluginArtifacts(modules)
    return { modules, version: manifest.version, dependencies: { ...manifest.dependencies, ...bundles }, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

/** Place product packages beside the official installation without replacing its dependency copies. */
export function installProductPlugins(runtime, artifacts) {
  const directory = join(resolve(runtime), 'node_modules', ...PRODUCT_PLUGIN_PATH)
  rmSync(directory, { force: true, recursive: true })
  mkdirSync(directory, { recursive: true })
  cpSync(artifacts.modules, join(directory, 'node_modules'), { recursive: true, filter: artifactFilter })
  const dependencies = Object.fromEntries(Object.keys(artifacts.dependencies).map(name => [
    name, readJson(join(packageDir(artifacts.modules, name), 'package.json')).version,
  ]))
  writeJson(join(directory, 'package.json'), { name: PRODUCT_PLUGIN_PACKAGE, version: artifacts.version, private: true, dependencies })

  // The shipped Desktop selects dsh-web-app in new and existing Profiles.
  // Attach product defaults there so user patches and official plugin controls
  // apply afterwards, without writing to the user's Profile.
  const web = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-web-app')
  const webManifestPath = join(web, 'package.json')
  const webManifest = readJson(webManifestPath)
  const patchPrefix = './ebao-default-plugins/'
  const patchDirectory = join(web, patchPrefix)
  rmSync(patchDirectory, { force: true, recursive: true })
  mkdirSync(patchDirectory)
  const defaults = [webManifest.dsh.bundle.patch].flat().filter(path => !path.startsWith(patchPrefix))
  for (const name of PRODUCT_PLUGIN_BUNDLES) {
    const plugin = packageDir(join(directory, 'node_modules'), name)
    const manifest = readJson(join(plugin, 'package.json'))
    for (const patch of [manifest.dsh.bundle.patch].flat()) {
      const filename = `${defaults.length}.patch.yml`
      cpSync(join(plugin, patch), join(patchDirectory, filename))
      defaults.push(patchPrefix + filename)
    }
  }
  webManifest.dsh.bundle.patch = defaults
  writeJson(webManifestPath, webManifest)

  const cliManifestPath = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const cliManifest = readJson(cliManifestPath)
  cliManifest.dependencies[PRODUCT_PLUGIN_PACKAGE] = artifacts.version
  writeJson(cliManifestPath, cliManifest)
  return PRODUCT_PLUGIN_PACKAGE
}

/** Dev project links point at the source tree. Copy the two packages we overlay. */
export function detachDevelopmentPackages(runtime) {
  for (const name of ['dsh', 'dsh-web-app']) {
    const path = join(runtime, 'node_modules', '@deepseek-ai', name)
    if (!lstatSync(path).isSymbolicLink()) throw new Error(`Expected official development link at ${path}`)
    const staging = mkdtempSync(join(dirname(path), `ebao-${name}.`))
    try {
      for (const file of readdirSync(path).filter(file => !['node_modules', '.git'].includes(file))) {
        cpSync(join(path, file), join(staging, file), { recursive: true })
      }
      unlinkSync(path)
      renameSync(staging, path)
    } finally {
      rmSync(staging, { force: true, recursive: true })
    }
  }
}

export async function prepareProductPluginRuntime(plan, runtime, { development = false } = {}) {
  const artifacts = await buildProductPlugins(plan)
  try {
    if (development) detachDevelopmentPackages(runtime)
    return installProductPlugins(runtime, artifacts)
  } finally {
    artifacts.dispose()
  }
}
