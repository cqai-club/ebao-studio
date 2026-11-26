/** Build the owned CQAI account adapters and compose them through an external Desktop Profile. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ACCOUNT = '@cqaiclub/dsn-account'
const ADAPTER = '@cqaiclub/desktop-account'
const CLIENT_INJECT = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-account',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-slots',
]
const DEFAULT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const LOGIN_SCOPES = ['openid', 'offline_access', 'profile', 'email', 'ai:invoke']
const PROFILE_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'
const ARTIFACT_FILES = ['account/lib/index.js', 'account/lib/protocol.js', 'account/package.json',
  'desktop-account/lib/index.js', 'desktop-account/lib/client.js', 'desktop-account/package.json', 'desktop-account/cordis.patch.yml']

export const USAGE = `Usage: node scripts/prepare-cqai-account.mjs [--build-only] [--print-config]

Builds the CQAI account provider and desktop settings using the pinned official toolchain.
The default action installs them into the isolated official Desktop Profile.
--build-only never modifies a Profile. --print-config never writes or installs.
EBAO_OFFICIAL_DSH_HOME may explicitly select another non-legacy absolute home.
`

function inside(parent, path) {
  const suffix = relative(parent, path)
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

/** Refuse redirected generated directories instead of following them into other data. */
export function assertOwnedPath(anchor, path) {
  if (path !== anchor && !inside(anchor, path)) throw new Error(`Path is outside the owned directory: ${path}`)
  let current = anchor
  for (const part of ['', ...relative(anchor, path).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part)
    const stat = lstatSync(current, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink() || (stat !== undefined && !stat.isDirectory())) {
      throw new Error(`Refusing a redirected or non-directory path: ${current}`)
    }
  }
}

export function createPreparationPlan({ root = ROOT, environment = process.env } = {}) {
  root = resolve(root)
  const state = join(root, '.official-desktop')
  const selected = environment.EBAO_OFFICIAL_DSH_HOME
  if (selected !== undefined && (!selected.trim() || !isAbsolute(selected) || selected.includes('\0'))) {
    throw new Error('EBAO_OFFICIAL_DSH_HOME must be a nonempty absolute directory')
  }
  const home = selected === undefined ? join(state, 'home') : resolve(selected)
  if ([join(homedir(), '.dsh'), join(homedir(), '.dsh-beta')].some(legacy => home === legacy || inside(legacy, home))) {
    throw new Error('CQAI preparation must not modify a legacy e宝 home')
  }
  return {
    root, state, home,
    official: join(root, 'deepseek-harness'),
    extensions: join(state, 'extensions'),
    profile: join(home, 'profiles', 'desktop'),
    accountSource: join(root, 'cqai-dsh-plugins', 'cqai-dsh-plugin-account'),
    adapterSource: join(root, 'integrations', 'cqai-desktop-account'),
  }
}

function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Integration source must not be a symbolic link: ${path}`)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/** A changed source, account configuration, builder, or official release produces new file dependencies. */
export function integrationFingerprint(plan) {
  const paths = [
    ...sourceFiles(join(plan.accountSource, 'src')),
    ...sourceFiles(join(plan.adapterSource, 'src')),
    join(plan.accountSource, 'package.json'), join(plan.accountSource, 'cordis.patch.yml'),
    join(plan.official, 'package.json'), fileURLToPath(import.meta.url),
  ]
  const digest = createHash('sha256')
  for (const path of paths.sort()) digest.update(relative(plan.root, path)).update('\0').update(readFileSync(path)).update('\0')
  return digest.digest('hex').slice(0, 16)
}

function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function toolchain(plan) {
  const require = createRequire(join(plan.official, 'node_modules', '.pnpm', 'cqai-builder.cjs'))
  return { esbuild: require('esbuild'), yaml: require('yaml') }
}

export function composeAccountPatch(config) {
  const issuer = new URL(config.issuer)
  const portal = new URL(config.clubPortalUrl)
  if (issuer.protocol !== 'https:' || portal.protocol !== 'https:' || issuer.username || issuer.password || portal.username || portal.password) {
    throw new Error('CQAI account integration requires explicit HTTPS issuer and portal URLs')
  }
  return [
    { insert: [
      { id: 'cqaiclub-dsn-account', name: ACCOUNT, config: { ...config, desktopProductName: 'e宝工坊', scopes: [...LOGIN_SCOPES] } },
      { id: 'cqai-desktop-account', name: ADAPTER, config: { issuer: config.issuer, usageUrl: portal.href, topUpUrl: portal.href } },
    ] },
    // In the official Include grammar, `name` guards an existing row; it does
    // not rename its plugin. Mount the CQAI provider as its own entry instead.
    { id: 'deepseek-account', disabled: true },
    { id: 'llm-deepseek-account', disabled: true },
    { id: 'web-deepseek-api', config: { searchBilling: 'api-key', fetchBilling: 'api-key' } },
  ]
}

function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readPackageIdentity(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  return { name: manifest.name, version: manifest.version }
}

function cachedArtifactsMatch(directory, artifacts) {
  try {
    const receipt = JSON.parse(readFileSync(join(directory, 'build-receipt.json'), 'utf8'))
    if (receipt.schemaVersion !== 1 || receipt.fingerprint !== artifacts.fingerprint) return false
    if (JSON.stringify(readPackageIdentity(artifacts.account)) !== JSON.stringify({ name: ACCOUNT, version: artifacts.accountVersion })
      || JSON.stringify(readPackageIdentity(artifacts.adapter)) !== JSON.stringify({ name: ADAPTER, version: artifacts.adapterVersion })) return false
    return ARTIFACT_FILES.every(relativePath => {
      const path = join(directory, relativePath)
      const stat = lstatSync(path, { throwIfNoEntry: false })
      return stat?.isFile() && !stat.isSymbolicLink() && receipt.files?.[relativePath] === fileDigest(path)
    })
  } catch { return false }
}

/** Compile owned account code with the official SDK and browser platform modules shared at runtime. */
export async function buildAccountExtensions(plan, { loadToolchain = toolchain } = {}) {
  assertOwnedPath(plan.root, plan.state)
  assertOwnedPath(plan.state, plan.extensions)
  const accountManifest = JSON.parse(readFileSync(join(plan.accountSource, 'package.json'), 'utf8'))
  const fingerprint = integrationFingerprint(plan)
  const directory = join(plan.extensions, fingerprint)
  const account = join(directory, 'account')
  const adapter = join(directory, 'desktop-account')
  const artifacts = { fingerprint, account, adapter,
    accountVersion: `${accountManifest.version}-desktop.${fingerprint}`, adapterVersion: `0.1.0-desktop.${fingerprint}` }
  assertOwnedPath(plan.state, directory)
  for (const path of [account, adapter]) {
    assertOwnedPath(plan.state, path)
    assertOwnedPath(plan.state, join(path, 'lib'))
  }
  if (cachedArtifactsMatch(directory, artifacts)) return { ...artifacts, cached: true }
  const { esbuild, yaml } = loadToolchain(plan)
  const sourcePatch = yaml.parse(readFileSync(join(plan.accountSource, 'cordis.patch.yml'), 'utf8'))
  const accountRows = sourcePatch.flatMap(entry => entry.insert ?? []).filter(row => row.id === 'cqaiclub-dsn-account')
  if (accountRows.length !== 1 || accountRows[0].name !== ACCOUNT) throw new Error('Expected the owned CQAI account configuration')
  const patch = composeAccountPatch(accountRows[0].config)
  for (const path of [account, adapter]) {
    mkdirSync(join(path, 'lib'), { recursive: true, mode: 0o700 })
  }
  const common = {
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    external: ['@deepseek-ai/*', '@cqaiclub/dsn-account', '@cqaiclub/dsn-account/*'],
    nodePaths: [join(plan.official, 'node_modules', '.pnpm', 'node_modules')],
    banner: { js: "import { createRequire as __cqaiCreateRequire } from 'node:module'; const require = __cqaiCreateRequire(import.meta.url);" },
    logLevel: 'warning',
  }
  await esbuild.build({ ...common, entryPoints: { index: join(plan.accountSource, 'src', 'index.ts'), protocol: join(plan.accountSource, 'src', 'protocol.ts') }, outdir: join(account, 'lib') })
  await esbuild.build({ ...common, entryPoints: [join(plan.adapterSource, 'src', 'index.ts')], outfile: join(adapter, 'lib', 'index.js') })
  await esbuild.build({
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2024',
    jsx: 'automatic',
    entryPoints: [join(plan.adapterSource, 'src', 'client', 'index.tsx')],
    outfile: join(adapter, 'lib', 'client.js'),
    external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ADAPTER)}, factory: (require) => { const module = { exports: {} };` },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'warning',
  })
  writeJson(join(account, 'package.json'), {
    name: ACCOUNT, version: artifacts.accountVersion, type: 'module', private: true,
    main: './lib/index.js', exports: { '.': './lib/index.js', './protocol': './lib/protocol.js', './package.json': './package.json' },
    peerDependencies: { ...accountManifest.peerDependencies, '@deepseek-ai/schemastery': accountManifest.dependencies['@deepseek-ai/schemastery'] },
  })
  writeJson(join(adapter, 'package.json'), {
    name: ADAPTER, version: artifacts.adapterVersion, type: 'module', private: true,
    main: './lib/index.js', exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    peerDependencies: { [ACCOUNT]: '*', '@deepseek-ai/cordis': '^4.1.0', '@deepseek-ai/dsh-deepseek-account': JSON.parse(readFileSync(join(plan.official, 'package.json'), 'utf8')).version },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: CLIENT_INJECT },
    },
  })
  writeFileSync(join(adapter, 'cordis.patch.yml'), yaml.stringify(patch), { mode: 0o600 })
  writeJson(join(directory, 'build-receipt.json'), { schemaVersion: 1, fingerprint,
    files: Object.fromEntries(ARTIFACT_FILES.map(path => [path, fileDigest(join(directory, path))])) })
  return { ...artifacts, cached: false }
}

/** Add owned packages without rewriting a user's patch, settings, other dependencies or bundle order. */
export function updateProfileManifest(manifest, artifacts) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid Desktop Profile manifest')
  const dependencies = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || Object.values(dependencies).some(value => typeof value !== 'string')
    || !Array.isArray(bundles) || bundles.some(value => typeof value !== 'string')) {
    throw new Error('Invalid Desktop Profile dependency or bundle declarations')
  }
  return {
    ...manifest,
    dependencies: { ...dependencies, [ACCOUNT]: `file:${artifacts.account}`, [ADAPTER]: `file:${artifacts.adapter}` },
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: [...new Set([...bundles, ADAPTER])] } },
  }
}

export function officialPnpmCommand(plan) {
  const packageFile = join(plan.official, 'apps', 'desktop', 'node_modules', 'pnpm', 'package.json')
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
  const expected = JSON.parse(readFileSync(join(plan.official, 'package.json'), 'utf8')).packageManager
  if (!expected.startsWith(`pnpm@${manifest.version}`)) throw new Error('Official Desktop pnpm version differs from its source pin')
  return { command: process.execPath, args: [join(dirname(packageFile), manifest.bin.pnpm), '--dir', plan.profile, 'install', '--ignore-scripts', '--no-frozen-lockfile'] }
}

function runInstall(plan) {
  const invocation = officialPnpmCommand(plan)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd: plan.official, env: { ...process.env, CI: 'true' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`CQAI Profile install exited with ${code ?? signal}`)))
  })
}

/** An already composed and installed account layer needs no writes or package operation. */
export function profileIsPrepared(plan, artifacts, manifest) {
  try {
    if (JSON.stringify(updateProfileManifest(manifest, artifacts)) !== JSON.stringify(manifest)) return false
    if (!existsSync(join(plan.profile, 'pnpm-workspace.yaml')) || !existsSync(join(plan.profile, 'cordis.patch.yml'))) return false
    for (const [name, directory, expectedVersion] of [
      [ACCOUNT, artifacts.account, artifacts.accountVersion], [ADAPTER, artifacts.adapter, artifacts.adapterVersion],
    ]) {
      const generated = readPackageIdentity(directory)
      const installed = readPackageIdentity(join(plan.profile, 'node_modules', ...name.split('/')))
      if (generated.name !== name || installed.name !== name || installed.version !== generated.version
        || (expectedVersion !== undefined && generated.version !== expectedVersion)
        || !artifacts.fingerprint || !generated.version.endsWith(`.${artifacts.fingerprint}`)) return false
    }
    return true
  } catch { return false }
}

export async function prepareProfile(plan, artifacts, { install = runInstall } = {}) {
  assertOwnedPath(plan.root, plan.state)
  const homeAnchor = inside(plan.state, plan.home) ? plan.state : plan.home
  assertOwnedPath(homeAnchor, plan.profile)
  const manifestPath = join(plan.profile, 'package.json')
  const readManifest = () => existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined
  if (profileIsPrepared(plan, artifacts, readManifest())) return { changed: false }
  mkdirSync(plan.profile, { recursive: true, mode: 0o700 })
  const lockPath = join(plan.profile, 'lock')
  let descriptor
  try { descriptor = openSync(lockPath, 'wx', 0o600) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Official Desktop Profile is locked; stop the application or active Profile operation before preparing CQAI')
    throw error
  }
  writeFileSync(descriptor, `${process.pid}\n`)
  const original = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined
  let wroteManifest = false
  try {
    const manifest = original === undefined
      ? { name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: DEFAULT_BUNDLES } } }
      : JSON.parse(original)
    if (profileIsPrepared(plan, artifacts, manifest)) return { changed: false }
    const updated = updateProfileManifest(manifest, artifacts)
    if (original === undefined || JSON.stringify(updated) !== JSON.stringify(manifest)) {
      writeJson(manifestPath, updated)
      wroteManifest = true
    }
    const workspace = join(plan.profile, 'pnpm-workspace.yaml')
    if (!existsSync(workspace)) writeFileSync(workspace, PROFILE_WORKSPACE, { mode: 0o600 })
    const patch = join(plan.profile, 'cordis.patch.yml')
    if (!existsSync(patch)) writeFileSync(patch, '[]\n', { mode: 0o600 })
    await install(plan)
    return { changed: true }
  } catch (error) {
    if (wroteManifest) {
      if (original === undefined) { if (existsSync(manifestPath)) unlinkSync(manifestPath) }
      else writeFileSync(manifestPath, original, { mode: 0o600 })
    }
    throw error
  } finally {
    closeSync(descriptor)
    unlinkSync(lockPath)
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--help', '-h', '--build-only', '--print-config'].includes(arg))) throw new Error(USAGE)
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return }
  const plan = createPreparationPlan()
  if (args.includes('--print-config')) {
    console.log(JSON.stringify({ profile: plan.profile, extensions: plan.extensions, buildOnly: args.includes('--build-only'), packages: [ACCOUNT, ADAPTER] }, null, 2))
    return
  }
  const artifacts = await buildAccountExtensions(plan)
  if (!args.includes('--build-only')) await prepareProfile(plan, artifacts)
  console.log(`CQAI account: ${args.includes('--build-only') ? 'built' : 'prepared'} ${artifacts.fingerprint}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`CQAI account: ${error.message}`); process.exitCode = 1 })
}
