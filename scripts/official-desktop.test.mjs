import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { assertOfficialCheckout, createOfficialDesktopPlan, executeOfficialDesktopPlan, parseArguments, pruneStaleDependencyLinks, runOfficialDesktop } from './official-desktop.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('commands target the official checkout and registered upstream scripts', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'deepseek-harness', 'package.json'), 'utf8'))
  const expected = {
    install: ['pnpm', 'install', '--frozen-lockfile'],
    'repair-install': ['pnpm', 'install', '--frozen-lockfile'],
    'prepare:electron': ['pnpm', '--filter', '@deepseek-ai/dsh-desktop', 'exec', 'install-electron'],
    version: ['pnpm', '--version'],
    build: ['pnpm', 'run', 'build:artifacts'],
    typecheck: ['pnpm', 'exec', 'tsc', '-b', 'apps/desktop/tsconfig.json'],
    test: ['pnpm', 'exec', 'vitest', 'run', 'apps/desktop/tests', '--maxWorkers=1', '--testTimeout=15000'],
    dev: ['pnpm', 'run', 'start:desktop'],
    start: ['pnpm', 'run', 'start:desktop'],
    'package:dir': ['pnpm', 'run', 'package:desktop:dir', '--unsigned'],
    'package:mac:arm64': ['pnpm', 'run', 'package:desktop:mac:arm64:unsigned'],
    'package:mac:x64': ['pnpm', 'run', 'package:desktop:mac:x64:unsigned'],
    'package:win:x64': ['pnpm', 'run', 'package:desktop:win:x64:unsigned'],
  }
  for (const [action, args] of Object.entries(expected)) {
    const plan = createOfficialDesktopPlan(action, { environment: {} })
    assert.equal(plan.command, 'corepack')
    assert.equal(plan.cwd, join(root, 'deepseek-harness'))
    assert.deepEqual(plan.args, args)
    if (args[1] === 'run') assert.ok(manifest.scripts[args[2]], `Missing upstream script for ${action}`)
  }
  assertOfficialCheckout(join(root, 'deepseek-harness'))
})

test('owned account and welcome preparation run after the final upstream build', async () => {
  for (const [action, expected] of [
    ['dev', ['build:artifacts', 'build:desktop', 'account:dev', 'welcome', 'start:desktop']],
    ['start', ['account:start', 'welcome', 'start:desktop']],
    ['build', ['build:artifacts', 'account:build', 'welcome']],
    ['package:dir', ['package:desktop:dir']],
  ]) {
    const steps = []
    const code = await executeOfficialDesktopPlan(createOfficialDesktopPlan(action, { environment: {} }), {
      run: async plan => { steps.push(plan.args[2]); return 0 },
      account: async mode => { steps.push(`account:${mode}`) },
      welcome: async () => { steps.push('welcome') },
    })
    assert.equal(code, 0)
    assert.deepEqual(steps, expected)
  }
})

test('failed upstream builds or owned preparation never launch the graphical app', async () => {
  for (const failedScript of ['build:artifacts', 'build:desktop']) {
    const steps = []
    const code = await executeOfficialDesktopPlan(createOfficialDesktopPlan('dev', { environment: {} }), {
      run: async plan => { steps.push(plan.args[2]); return plan.args[2] === failedScript ? 9 : 0 },
      account: async () => { assert.fail('preparation followed a failed build') },
      welcome: async () => { assert.fail('overlay followed a failed build') },
    })
    assert.equal(code, 9)
    assert.equal(steps.includes('start:desktop'), false)
  }
  await assert.rejects(executeOfficialDesktopPlan(createOfficialDesktopPlan('start', { environment: {} }), {
    run: async () => { assert.fail('a failed overlay must not launch') },
    account: async () => {},
    welcome: async () => { throw new Error('upstream branding seam changed') },
  }), /upstream branding seam changed/)
})

test('normal commands never inherit an existing Harness home or community runtime', () => {
  const workspace = join(tmpdir(), 'official-desktop-project')
  const environment = {
    PATH: '/kept/bin', HTTPS_PROXY: 'http://proxy.invalid',
    DSH_HOME: '/existing/user-data', DSH_DESKTOP_USER_DATA_DIR: '/existing/electron',
    DSH_DESKTOP_HOME: '/community/home', DSH_DESKTOP_NEXT_HOME: '/community/next',
    DSH_DESKTOP_DEV_USER_DATA: '/community/dev', DSH_DESKTOP_DSH_DIR: '/community/runtime',
    DSH_DESKTOP_PNPM_ENTRY: '/community/pnpm', DSH_DESKTOP_PRIMARY_RUNTIME_DIR: '/community/primary',
    DSH_DESKTOP_APP_ID: 'community', DSH_BUILD_CLIENT_PROFILE: 'official',
    DSH_CLIENT_VERSION: 'community', EBAO_PUBLISHER_WORKER: '/community/worker',
  }
  const snapshot = { ...environment }
  const plan = createOfficialDesktopPlan('dev', { root: workspace, environment, platform: 'darwin' })
  assert.equal(plan.env.DSH_HOME, join(workspace, '.official-desktop/official/home'))
  assert.equal(plan.env.DSH_DESKTOP_USER_DATA_DIR, join(workspace, '.official-desktop/official/electron-user-data'))
  for (const name of Object.keys(environment).filter(name => name.startsWith('DSH_') || name.startsWith('EBAO_'))) {
    if (!['DSH_HOME', 'DSH_DESKTOP_USER_DATA_DIR'].includes(name)) assert.equal(plan.env[name], undefined, name)
  }
  assert.equal(plan.env.PATH, environment.PATH)
  assert.equal(plan.env.HTTPS_PROXY, environment.HTTPS_PROXY)
  assert.deepEqual(environment, snapshot)
  assert.equal(plan.shell, false)
  assert.equal(createOfficialDesktopPlan('version', { environment: {}, platform: 'win32' }).shell, true)
})

test('only explicit official-specific absolute directories override isolated state', () => {
  const home = join(tmpdir(), 'chosen', 'home')
  const userData = join(tmpdir(), 'chosen', 'electron')
  const environment = { EBAO_OFFICIAL_DSH_HOME: home, EBAO_OFFICIAL_USER_DATA_DIR: userData }
  const plan = createOfficialDesktopPlan('start', { environment })
  assert.deepEqual(plan.state, { home, userData })
  for (const name of Object.keys(environment)) {
    for (const value of ['', 'relative/path', '/invalid\0directory']) {
      assert.throws(() => createOfficialDesktopPlan('start', { environment: { [name]: value } }), /nonempty absolute directory/)
    }
  }
  assert.equal(createOfficialDesktopPlan('install', { environment: {} }).env.CI, 'true')
  assert.equal(createOfficialDesktopPlan('repair-install', { environment: {} }).env.CI, 'true')
})

test('repair removes stale workspace and store hoist links while preserving source, packages and external links', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'official-desktop-repair-'))
  try {
    const official = join(temporary, 'official')
    const hoist = join(official, 'node_modules/.pnpm/node_modules')
    const scope = join(hoist, '@deepseek-ai')
    mkdirSync(scope, { recursive: true })
    const link = (target, path) => {
      mkdirSync(dirname(path), { recursive: true })
      symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
      return path
    }
    const validPackage = join(official, 'packages/client/valid')
    const retiredPackage = join(official, 'packages/experimental/retired')
    const retiredApp = join(official, 'apps/retired')
    const retiredVendor = join(official, 'vendor/retired')
    const npmStoreTarget = join(official, 'node_modules/.pnpm/old@1/node_modules/old')
    const externalTarget = join(temporary, 'outside/packages/retired')
    const nonWorkspace = join(official, 'docs/retired')
    for (const directory of [validPackage, retiredPackage, retiredApp, retiredVendor, npmStoreTarget, externalTarget, nonWorkspace]) {
      mkdirSync(directory, { recursive: true })
    }
    writeFileSync(join(validPackage, 'package.json'), '{"name":"valid"}\n')
    writeFileSync(join(retiredPackage, 'retained-source.ts'), '// source is never deleted\n')
    const linkToDeletedPackage = (target, path) => {
      mkdirSync(target, { recursive: true })
      link(target, path)
      rmSync(target, { recursive: true })
      return path
    }
    const stale = [
      link(retiredPackage, join(scope, 'retired')),
      link(retiredApp, join(scope, 'retired-app')),
      link(retiredVendor, join(hoist, 'retired-vendor')),
      linkToDeletedPackage(join(official, 'node_modules/.pnpm/zod@4.4.3/node_modules/zod'), join(hoist, 'zod')),
      linkToDeletedPackage(join(official, 'node_modules/.pnpm/@deepseek-ai+retired@1/node_modules/@deepseek-ai/retired'), join(scope, 'old-package')),
    ]
    const preserved = [
      link(validPackage, join(scope, 'valid')),
      link(npmStoreTarget, join(hoist, 'npm-package')),
      link(externalTarget, join(hoist, 'external-package')),
      linkToDeletedPackage(join(temporary, 'outside/store@1/node_modules/external'), join(hoist, 'external-dangling')),
      link(nonWorkspace, join(hoist, 'non-workspace')),
    ]
    const regularDirectory = join(scope, 'ordinary-directory')
    mkdirSync(regularDirectory)
    assert.deepEqual(pruneStaleDependencyLinks(official).sort(), stale.sort())
    for (const path of stale) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined)
    for (const path of preserved) assert.equal(lstatSync(path).isSymbolicLink(), true)
    assert.equal(lstatSync(regularDirectory).isDirectory(), true)
    assert.equal(readFileSync(join(retiredPackage, 'retained-source.ts'), 'utf8'), '// source is never deleted\n')
    assert.equal(readFileSync(join(validPackage, 'package.json'), 'utf8'), '{"name":"valid"}\n')
    assert.equal(lstatSync(retiredApp).isDirectory(), true)
    assert.equal(lstatSync(retiredVendor).isDirectory(), true)
    assert.deepEqual(pruneStaleDependencyLinks(official), [])
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})

test('repair tolerates uninstalled dependencies and refuses redirected dependency directories', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'official-desktop-repair-boundary-'))
  try {
    const official = join(temporary, 'official')
    mkdirSync(official)
    assert.deepEqual(pruneStaleDependencyLinks(official), [])
    const elsewhere = join(temporary, 'retained-dependencies')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'retained.txt'), 'keep')
    symlinkSync(elsewhere, join(official, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => pruneStaleDependencyLinks(official), /redirected dependency directory/)
    assert.equal(readFileSync(join(elsewhere, 'retained.txt'), 'utf8'), 'keep')
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})

test('inspection is read-only and does not disclose unrelated environment values', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'official-desktop-wrapper-'))
  try {
    const state = join(temporary, 'new-state')
    const result = spawnSync(process.execPath, [join(root, 'scripts/official-desktop.mjs'), 'dev', '--print-config'], {
      encoding: 'utf8', env: { ...process.env, PATH: '', SECRET_FOR_TEST: 'do-not-print', EBAO_OFFICIAL_DSH_HOME: state },
    })
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(result.stdout)
    assert.deepEqual(config.args, ['pnpm', 'run', 'start:desktop'])
    assert.equal(config.state.home, state)
    assert.equal(config.env, undefined)
    assert.equal(result.stdout.includes('do-not-print'), false)
    assert.equal(existsSync(state), false)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})

test('missing or unexpected options cannot launch a graphical application', () => {
  assert.deepEqual(parseArguments([]), { help: true })
  assert.deepEqual(parseArguments(['--print-config']), { action: 'dev', printConfig: true })
  assert.deepEqual(parseArguments(['--help']), { help: true })
  assert.throws(() => parseArguments(['unknown']), /Unknown Desktop action/)
  assert.throws(() => parseArguments(['dev', '--arbitrary-option']), /Unknown Desktop action/)
  assert.throws(() => createOfficialDesktopPlan('publish'), /Unknown Desktop action/)
  assert.throws(() => assertOfficialCheckout(join(root, 'missing-checkout')), /git submodule update/)
})

test('subprocess failures, exit codes and interruption propagate and remove signal handlers', async () => {
  const plan = createOfficialDesktopPlan('version', { environment: {} })
  for (const expectedCode of [0, 7]) {
    const signals = new EventEmitter()
    const child = new EventEmitter()
    const running = runOfficialDesktop(plan, { signalTarget: signals, spawnImpl(command, args, options) {
      assert.equal(command, 'corepack')
      assert.deepEqual(args, plan.args)
      assert.equal(options.cwd, plan.cwd)
      assert.equal(options.stdio, 'inherit')
      return child
    } })
    child.emit('exit', expectedCode, null)
    assert.equal(await running, expectedCode)
    assert.equal(signals.listenerCount('SIGINT'), 0)
    assert.equal(signals.listenerCount('SIGTERM'), 0)
  }
  const signals = new EventEmitter()
  const child = new EventEmitter()
  child.kill = signal => { assert.equal(signal, 'SIGTERM'); child.emit('exit', null, signal); return true }
  const interrupted = runOfficialDesktop(plan, { signalTarget: signals, spawnImpl: () => child })
  signals.emit('SIGTERM')
  assert.equal(await interrupted, 143)
  assert.equal(signals.listenerCount('SIGTERM'), 0)
  const failedChild = new EventEmitter()
  const failed = runOfficialDesktop(plan, { signalTarget: signals, spawnImpl: () => failedChild })
  failedChild.emit('error', new Error('Corepack unavailable'))
  await assert.rejects(failed, /Corepack unavailable/)
  assert.equal(signals.listenerCount('SIGINT'), 0)
})
