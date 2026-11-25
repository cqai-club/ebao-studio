import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  assertOwnedPath, buildAccountExtensions, composeAccountPatch, createPreparationPlan, integrationFingerprint,
  officialPnpmCommand, prepareProfile, updateProfileManifest,
} from './prepare-cqai-account.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cqai-profile-prepare-'))
  return { root, plan: createPreparationPlan({ root, environment: {} }), dispose: () => rmSync(root, { recursive: true, force: true }) }
}
const artifacts = { account: '/owned/extensions/hash/account', adapter: '/owned/extensions/hash/desktop-account' }

function buildFixture() {
  const f = fixture()
  for (const directory of [join(f.plan.accountSource, 'src'), join(f.plan.adapterSource, 'src'), f.plan.official]) mkdirSync(directory, { recursive: true })
  writeFileSync(join(f.plan.accountSource, 'src', 'index.ts'), 'export const account = 1\n')
  writeFileSync(join(f.plan.accountSource, 'src', 'protocol.ts'), 'export const protocol = 1\n')
  writeFileSync(join(f.plan.adapterSource, 'src', 'index.ts'), 'export const adapter = 1\n')
  writeFileSync(join(f.plan.accountSource, 'package.json'), JSON.stringify({ version: '0.1.1', dependencies: { '@deepseek-ai/schemastery': '3.19.0' }, peerDependencies: {} }))
  writeFileSync(join(f.plan.accountSource, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'cqaiclub-dsn-account', name: '@cqaiclub/dsn-account', config: {
    issuer: 'https://auth.cqaiclub.asia/oidc', clientId: 'public-native-client', clubPortalUrl: 'https://cqaiclub.asia', scopes: ['openid', 'activity:publish'],
  } }] }]))
  writeFileSync(join(f.plan.official, 'package.json'), '{"version":"0.2.2-rc.1"}\n')
  let compiles = 0
  const loadToolchain = () => ({
    yaml: { parse: JSON.parse, stringify: value => `${JSON.stringify(value)}\n` },
    esbuild: { async build(options) {
      compiles++
      if (options.outfile) writeFileSync(options.outfile, readFileSync(options.entryPoints[0]))
      else for (const [name, input] of Object.entries(options.entryPoints)) writeFileSync(join(options.outdir, `${name}.js`), readFileSync(input))
    } },
  })
  return { ...f, loadToolchain, compiles: () => compiles }
}

test('preparation isolates existing e宝 homes and print-config never writes or exposes environment secrets', () => {
  const f = fixture()
  try {
    const plan = createPreparationPlan({ root: f.root, environment: { DSH_HOME: '/old-home' } })
    assert.equal(plan.home, join(f.root, '.official-desktop', 'home'))
    for (const value of ['', 'relative/home', join(homedir(), '.dsh'), join(homedir(), '.dsh-beta', 'child')]) {
      assert.throws(() => createPreparationPlan({ root: f.root, environment: { EBAO_OFFICIAL_DSH_HOME: value } }), /absolute|legacy/)
    }
    const custom = join(f.root, 'explicit-official-home')
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'prepare-cqai-account.mjs'), '--print-config'], {
      encoding: 'utf8', env: { ...process.env, EBAO_OFFICIAL_DSH_HOME: custom, TOKEN_TEST_SECRET: 'never-print-this' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).profile, join(custom, 'profiles', 'desktop'))
    assert.equal(result.stdout.includes('never-print-this'), false)
    assert.equal(existsSync(custom), false)
  } finally { f.dispose() }
})

test('Profile composition preserves custom fields, existing dependencies and bundle order', () => {
  const manifest = { name: 'custom', dependencies: { 'other-plugin': '^2' }, custom: { untouched: true },
    dsh: { custom: true, profile: { custom: 'preserved', bundles: ['@deepseek-ai/dsh-base', 'other-plugin'] } } }
  const before = JSON.stringify(manifest)
  const next = updateProfileManifest(manifest, artifacts)
  assert.equal(JSON.stringify(manifest), before)
  assert.equal(next.dependencies['other-plugin'], '^2')
  assert.equal(next.dependencies['@cqaiclub/dsn-account'], `file:${artifacts.account}`)
  assert.equal(next.dependencies['@cqaiclub/desktop-account'], `file:${artifacts.adapter}`)
  assert.deepEqual(next.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'other-plugin', '@cqaiclub/desktop-account'])
  assert.equal(next.dsh.profile.custom, 'preserved')
  assert.equal(next.dsh.custom, true)
  assert.deepEqual(updateProfileManifest(next, artifacts), next)
  assert.throws(() => updateProfileManifest({ dependencies: {}, dsh: { profile: { bundles: 'invalid' } } }, artifacts), /Invalid/)
})

test('account patch replaces the provider while retaining a real authorization configuration and disabling official-token inference', () => {
  const config = { issuer: 'https://auth.cqaiclub.asia/oidc', clientId: 'public-native-client', clubPortalUrl: 'https://cqaiclub.asia', scopes: ['openid', 'activity:publish', 'unknown:capability'] }
  const patch = composeAccountPatch(config)
  assert.deepEqual(patch[0].insert[0].config, {
    ...config, desktopProductName: 'e宝工坊', scopes: ['openid', 'offline_access', 'profile', 'email', 'ai:invoke'],
  })
  assert.deepEqual(config.scopes, ['openid', 'activity:publish', 'unknown:capability'])
  assert.deepEqual(patch[0].insert[1], { id: 'cqai-desktop-account', name: '@cqaiclub/desktop-account', config: {
    issuer: config.issuer, usageUrl: 'https://cqaiclub.asia/', topUpUrl: 'https://cqaiclub.asia/',
  } })
  assert.deepEqual(patch[1], { id: 'deepseek-account', disabled: true })
  assert.deepEqual(patch[2], { id: 'llm-deepseek-account', disabled: true })
  assert.deepEqual(patch[3], { id: 'web-deepseek-api', config: { searchBilling: 'api-key', fetchBilling: 'api-key' } })
  assert.throws(() => composeAccountPatch({ ...config, issuer: 'http://issuer.invalid' }), /HTTPS/)
  assert.throws(() => composeAccountPatch({ ...config, clubPortalUrl: 'https://user:password@portal.invalid' }), /HTTPS/)
})

test('the real official Include composer activates only CQAI while disabling the original account provider', () => {
  const require = createRequire(join(ROOT, 'deepseek-harness', 'node_modules', '.pnpm', 'cqai-composition-test.cjs'))
  const { applyEntryPatches, entryListSchema } = require('@deepseek-ai/cordis-plugin-include')
  const yaml = require('js-yaml')
  const base = yaml.load(readFileSync(join(ROOT, 'deepseek-harness', 'packages', 'bundle', 'base', 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  const warnings = []
  const warn = (...args) => warnings.push(args)
  const officialEntries = applyEntryPatches([], base, warn)
  const composed = applyEntryPatches(officialEntries, composeAccountPatch({
    issuer: 'https://auth.cqaiclub.asia/oidc', clientId: 'public-native-client', clubPortalUrl: 'https://cqaiclub.asia',
  }), warn)
  const flatten = entries => entries.flatMap(entry => [entry, ...(entry.group && Array.isArray(entry.config) ? flatten(entry.config) : [])])
  const entries = flatten(composed)
  assert.deepEqual(warnings, [])
  const original = entries.find(entry => entry.id === 'deepseek-account')
  assert.equal(original.name, '@deepseek-ai/dsh-deepseek-account')
  assert.equal(original.disabled, true)
  const accountProviders = entries.filter(entry => ['@deepseek-ai/dsh-deepseek-account', '@cqaiclub/desktop-account'].includes(entry.name) && entry.disabled !== true)
  assert.deepEqual(accountProviders.map(entry => ({ id: entry.id, name: entry.name })), [{ id: 'cqai-desktop-account', name: '@cqaiclub/desktop-account' }])
  assert.equal(accountProviders[0].config.issuer, 'https://auth.cqaiclub.asia/oidc')
  assert.equal(entries.find(entry => entry.id === 'cqaiclub-dsn-account').disabled === true, false)
  assert.equal(entries.find(entry => entry.id === 'llm-deepseek-account').disabled, true)
})

test('unchanged complete artifacts avoid recompilation and file writes; changed source gets a new package version', async () => {
  const f = buildFixture()
  try {
    const first = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    assert.equal(first.cached, false)
    assert.equal(f.compiles(), 2)
    const output = join(first.account, 'lib', 'index.js')
    utimesSync(output, 946684800, 946684800)
    const mtime = statSync(output).mtimeMs
    const second = await buildAccountExtensions(f.plan, { loadToolchain: () => assert.fail('cached artifacts must not load the compiler') })
    assert.equal(second.cached, true)
    assert.equal(second.accountVersion, first.accountVersion)
    assert.equal(statSync(output).mtimeMs, mtime)
    assert.equal(f.compiles(), 2)
    writeFileSync(join(f.plan.accountSource, 'src', 'index.ts'), 'export const account = 2\n')
    const changed = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    assert.notEqual(changed.fingerprint, first.fingerprint)
    assert.notEqual(changed.accountVersion, first.accountVersion)
    assert.equal(changed.cached, false)
    assert.equal(statSync(output).mtimeMs, mtime)
    assert.equal(readFileSync(output, 'utf8'), 'export const account = 1\n')
    assert.equal(f.compiles(), 4)
  } finally { f.dispose() }
})

test('missing or modified generated files invalidate the artifact receipt', async () => {
  const f = buildFixture()
  try {
    const first = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    writeFileSync(join(first.adapter, 'package.json'), '{"name":"wrong","version":"wrong"}\n')
    const rebuilt = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    assert.equal(rebuilt.cached, false)
    assert.equal(f.compiles(), 4)
    unlinkSync(join(rebuilt.account, 'lib', 'protocol.js'))
    const repaired = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    assert.equal(repaired.cached, false)
    assert.equal(f.compiles(), 6)
    assert.equal(existsSync(join(repaired.account, 'lib', 'protocol.js')), true)
  } finally { f.dispose() }
})

test('an exact installed layer leaves the Profile mtime and active lock untouched; changed artifacts install once', async () => {
  const f = buildFixture()
  try {
    let installs = 0
    let current = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    const install = async plan => {
      installs++
      for (const [name, version] of [['dsn-account', current.accountVersion], ['desktop-account', current.adapterVersion]]) {
        const directory = join(plan.profile, 'node_modules', '@cqaiclub', name)
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: `@cqaiclub/${name}`, version }))
      }
    }
    assert.deepEqual(await prepareProfile(f.plan, current, { install }), { changed: true })
    assert.equal(installs, 1)
    const manifest = join(f.plan.profile, 'package.json')
    utimesSync(manifest, 946684800, 946684800)
    const mtime = statSync(manifest).mtimeMs
    const lock = join(f.plan.profile, 'lock')
    writeFileSync(lock, '123\n')
    assert.deepEqual(await prepareProfile(f.plan, current, { install }), { changed: false })
    assert.equal(installs, 1)
    assert.equal(statSync(manifest).mtimeMs, mtime)
    assert.equal(readFileSync(lock, 'utf8'), '123\n')
    unlinkSync(lock)
    writeFileSync(join(f.plan.adapterSource, 'src', 'index.ts'), 'export const adapter = 2\n')
    current = await buildAccountExtensions(f.plan, { loadToolchain: f.loadToolchain })
    assert.deepEqual(await prepareProfile(f.plan, current, { install }), { changed: true })
    assert.equal(installs, 2)
    assert.equal(statSync(manifest).mtimeMs === mtime, false)
    assert.deepEqual(await prepareProfile(f.plan, current, { install }), { changed: false })
    assert.equal(installs, 2)
    const installed = join(f.plan.profile, 'node_modules', '@cqaiclub', 'desktop-account', 'package.json')
    writeFileSync(installed, '{"name":"@cqaiclub/desktop-account","version":"old"}\n')
    assert.deepEqual(await prepareProfile(f.plan, current, { install }), { changed: true })
    assert.equal(installs, 3)
  } finally { f.dispose() }
})

test('preparation holds the official Profile lock and leaves user patch/settings byte-identical', async () => {
  const f = fixture()
  try {
    mkdirSync(f.plan.profile, { recursive: true })
    const original = { name: 'custom', dependencies: { retained: '1' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'retained'] } } }
    writeFileSync(join(f.plan.profile, 'package.json'), JSON.stringify(original))
    writeFileSync(join(f.plan.profile, 'cordis.patch.yml'), '# user patch\n- id: customized\n  disabled: true\n')
    writeFileSync(join(f.plan.home, 'settings.yaml'), 'my-setting: kept\n')
    const patch = readFileSync(join(f.plan.profile, 'cordis.patch.yml'), 'utf8')
    await prepareProfile(f.plan, artifacts, { install: async plan => {
      assert.equal(readFileSync(join(plan.profile, 'lock'), 'utf8'), `${process.pid}\n`)
      assert.equal(JSON.parse(readFileSync(join(plan.profile, 'package.json'), 'utf8')).dependencies.retained, '1')
    } })
    assert.equal(readFileSync(join(f.plan.profile, 'cordis.patch.yml'), 'utf8'), patch)
    assert.equal(readFileSync(join(f.plan.home, 'settings.yaml'), 'utf8'), 'my-setting: kept\n')
    assert.equal(existsSync(join(f.plan.profile, 'lock')), false)
    assert.match(readFileSync(join(f.plan.profile, 'pnpm-workspace.yaml'), 'utf8'), /autoInstallPeers: false/)
  } finally { f.dispose() }
})

test('failed installs restore the previous manifest and competing Profile operations are rejected', async () => {
  const f = fixture()
  try {
    mkdirSync(f.plan.profile, { recursive: true })
    const original = '{"name":"kept","dependencies":{},"dsh":{"profile":{"bundles":["kept"]}}}\n'
    writeFileSync(join(f.plan.profile, 'package.json'), original)
    await assert.rejects(prepareProfile(f.plan, artifacts, { install: async () => { throw new Error('fixture install failed') } }), /fixture install failed/)
    assert.equal(readFileSync(join(f.plan.profile, 'package.json'), 'utf8'), original)
    assert.equal(existsSync(join(f.plan.profile, 'lock')), false)
    writeFileSync(join(f.plan.profile, 'lock'), '123\n')
    await assert.rejects(prepareProfile(f.plan, artifacts, { install: async () => assert.fail('must not install') }), /Profile is locked/)
    assert.equal(readFileSync(join(f.plan.profile, 'lock'), 'utf8'), '123\n')
  } finally { f.dispose() }
})

test('redirected output or Profile directories cannot mutate another directory', async () => {
  const f = fixture()
  try {
    const outside = join(f.root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, f.plan.state, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => assertOwnedPath(f.root, f.plan.extensions), /redirected/)
    await assert.rejects(prepareProfile(f.plan, artifacts, { install: async () => assert.fail('must not install') }), /redirected/)
    assert.equal(existsSync(join(outside, 'home')), false)
    assert.throws(() => assertOwnedPath(f.plan.state, outside), /outside/)
  } finally { f.dispose() }
})

test('source/config changes invalidate file package versions and the exact official pnpm runs without a shell', () => {
  const f = fixture()
  try {
    for (const directory of [join(f.plan.accountSource, 'src'), join(f.plan.adapterSource, 'src'), join(f.plan.official, 'apps', 'desktop', 'node_modules', 'pnpm')]) mkdirSync(directory, { recursive: true })
    writeFileSync(join(f.plan.accountSource, 'src', 'index.ts'), 'export const changed = 1\n')
    writeFileSync(join(f.plan.adapterSource, 'src', 'index.ts'), 'export default {}\n')
    writeFileSync(join(f.plan.accountSource, 'package.json'), '{"version":"0.1.1"}\n')
    writeFileSync(join(f.plan.accountSource, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(f.plan.official, 'package.json'), '{"packageManager":"pnpm@11.28.5","version":"1.0.0"}\n')
    writeFileSync(join(f.plan.official, 'apps', 'desktop', 'node_modules', 'pnpm', 'package.json'), '{"version":"11.28.5","bin":{"pnpm":"bin/pnpm.mjs"}}\n')
    const first = integrationFingerprint(f.plan)
    assert.equal(integrationFingerprint(f.plan), first)
    writeFileSync(join(f.plan.accountSource, 'src', 'index.ts'), 'export const changed = 2\n')
    assert.notEqual(integrationFingerprint(f.plan), first)
    const command = officialPnpmCommand(f.plan)
    assert.equal(command.command, process.execPath)
    assert.deepEqual(command.args.slice(1), ['--dir', f.plan.profile, 'install', '--ignore-scripts', '--no-frozen-lockfile'])
    writeFileSync(join(f.plan.official, 'package.json'), '{"packageManager":"pnpm@12.0.0"}\n')
    assert.throws(() => officialPnpmCommand(f.plan), /differs/)
  } finally { f.dispose() }
})
