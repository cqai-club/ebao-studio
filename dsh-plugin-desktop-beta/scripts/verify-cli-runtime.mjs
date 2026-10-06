/** Headless artifact smoke for the Electron-backed dsh and pnpm command entries. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'

const packageRoot = new URL('../', import.meta.url)
const desktopCli = fileURLToPath(new URL('lib/desktop-cli.js', packageRoot))
const dshAppBootPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh-app-boot/', packageRoot))
const dshAtomicWritePackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh-atomic-write/', packageRoot))
const cordisPluginLoaderPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/cordis-plugin-loader/', packageRoot))
const dshHomePathsPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh-home-paths/', packageRoot))
const dshPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh/', packageRoot))
const semverPackage = fileURLToPath(new URL('node_modules/semver/', packageRoot))
const pnpmCli = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
const dshVersion = JSON.parse(readFileSync(new URL('node_modules/@deepseek-ai/dsh/package.json', packageRoot), 'utf8')).version
const pnpmVersion = JSON.parse(readFileSync(new URL('node_modules/pnpm/package.json', packageRoot), 'utf8')).version
const electronVersion = JSON.parse(readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8')).version
const RUNNER_ENVIRONMENT_NAMES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NPM_CONFIG_RUNTIME',
  'NPM_CONFIG_TARGET',
  'NPM_CONFIG_DISTURL',
])

function cleanEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toUpperCase()
    if (!RUNNER_ENVIRONMENT_NAMES.has(normalized)) env[key] = value
  }
  return env
}

function assertNoRunnerEnvironment(label, env) {
  const leaked = Object.keys(env).filter((key) => {
    return RUNNER_ENVIRONMENT_NAMES.has(key.toUpperCase())
  })
  if (leaked.length > 0) {
    throw new Error(`${label} leaked runner-only environment variables: ${leaked.join(', ')}`)
  }
}

function verifyResult(label, result, expectedOutput) {
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} artifact smoke exited ${String(result.status)}: ${result.stderr.trim()}`)
  }
  if (expectedOutput === undefined) return
  const output = result.stdout.trim()
  const matches = expectedOutput instanceof RegExp
    ? expectedOutput.test(output)
    : output === expectedOutput
  if (!matches) {
    throw new Error(`${label} artifact smoke returned ${JSON.stringify(output)} instead of matching ${String(expectedOutput)}`)
  }
}

function runElectronEntry(label, nodeArgs, entry, args, expectedOutput, extraEnvironment = {}) {
  const env = cleanEnvironment()
  Object.assign(env, extraEnvironment)
  env.ELECTRON_RUN_AS_NODE = '1'
  const result = spawnSync(electronPath, [...nodeArgs, entry, ...args], {
    encoding: 'utf8',
    env,
    shell: false,
  })
  verifyResult(label, result, expectedOutput)
}

function environmentValue(env, name) {
  const normalized = name.toUpperCase()
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1]
}

function runPnpm(env, args, cwd) {
  return process.platform === 'win32'
    ? spawnSync(environmentValue(env, 'ComSpec') ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
      })
    : spawnSync('pnpm', args, {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
      })
}

function verifyLifecycleEnvironment(stateRoot, installation, env) {
  const project = join(stateRoot, 'lifecycle-project')
  const resultPath = join(project, 'result.json')
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'dsh-desktop-pnpm-lifecycle-smoke',
    version: '0.0.0',
    private: true,
    scripts: { install: 'node lifecycle.mjs' },
  }) + '\n')
  writeFileSync(join(project, 'lifecycle.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('result.json', import.meta.url), JSON.stringify({",
    "  runAsNode: Object.keys(process.env).filter(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),",
    '  node: process.env.NODE,',
    '  npmNodeExecPath: process.env.npm_node_execpath,',
    '  runtime: process.env.npm_config_runtime,',
    '  target: process.env.npm_config_target,',
    '  disturl: process.env.npm_config_disturl,',
    '}))',
    '',
  ].join('\n'))

  const result = runPnpm(env, ['install', '--offline', '--reporter=silent'], project)
  verifyResult('pnpm lifecycle smoke', result, '')
  const actual = JSON.parse(readFileSync(resultPath, 'utf8'))
  const expected = {
    runAsNode: [],
    node: installation.nodeShimPath,
    npmNodeExecPath: installation.nodeShimPath,
    runtime: 'electron',
    target: electronVersion,
    disturl: 'https://electronjs.org/headers',
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`pnpm lifecycle smoke returned ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`)
  }
}

function runPackagedPnpmShim() {
  const stateRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-pnpm-smoke-'))
  const env = cleanEnvironment()
  let installation
  try {
    installation = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: electronPath,
      pnpmBinPath: pnpmCli,
      electronVersion,
      stateDir: join(stateRoot, 'runtime'),
      environment: env,
    })
    assertNoRunnerEnvironment('pnpm Host PATH installation', env)
    const result = runPnpm(env, ['--version'])
    verifyResult('pnpm PATH shim', result, pnpmVersion)
    verifyLifecycleEnvironment(stateRoot, installation, env)
    assertNoRunnerEnvironment('pnpm Host PATH after child exit', env)
  } finally {
    try {
      installation?.dispose()
      assertNoRunnerEnvironment('pnpm Host PATH disposal', env)
    } finally {
      rmSync(stateRoot, { recursive: true, force: true })
    }
  }
}

function runFlatProfileDshEntry() {
  // The CLI direct-entry check compares its canonical module URL to argv[1].
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-desktop-flat-cli-smoke-')))
  const desktopPackage = join(root, 'node_modules', 'dsh-plugin-desktop-beta')
  const linkedAppBootPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot')
  const linkedAtomicWritePackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-atomic-write')
  const linkedCordisPluginLoaderPackage = join(root, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader')
  const linkedDshHomePathsPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-home-paths')
  const linkedDshPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const linkedSemverPackage = join(root, 'node_modules', 'semver')
  const entry = join(desktopPackage, 'lib', 'desktop-cli.js')
  const env = cleanEnvironment()
  env.DSH_HOME = join(root, 'dsh-home')
  env.DSH_DESKTOP_DEFAULT_PROFILE = 'desktop'
  const profileDir = resolveProfileDir('desktop', env.DSH_HOME)
  let installation
  try {
    mkdirSync(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
    cpSync(fileURLToPath(new URL('lib/', packageRoot)), join(desktopPackage, 'lib'), { recursive: true })
    cpSync(fileURLToPath(new URL('package.json', packageRoot)), join(desktopPackage, 'package.json'))
    symlinkSync(dshAppBootPackage, linkedAppBootPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dshAtomicWritePackage, linkedAtomicWritePackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(cordisPluginLoaderPackage, linkedCordisPluginLoaderPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dshHomePathsPackage, linkedDshHomePathsPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dshPackage, linkedDshPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(semverPackage, linkedSemverPackage, process.platform === 'win32' ? 'junction' : 'dir')
    // DSH 0.2 reserves desktop Profile initialization for the application,
    // including pnpm help. Exercise both sides without using the user's home.
    const missingProfile = spawnSync(electronPath, [
      '--expose-internals', entry, 'plugin', '--help',
    ], { encoding: 'utf8', env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, shell: false })
    if (missingProfile.error !== undefined) throw missingProfile.error
    if (missingProfile.status !== 1
      || !missingProfile.stderr.includes('once to initialize its profile')
      || existsSync(join(profileDir, 'package.json'))) {
      throw new Error(`flat profile dsh plugin help did not preserve the Desktop initialization guard: ${String(missingProfile.status)} (${String(missingProfile.signal)}): ${missingProfile.stderr.trim() || missingProfile.stdout.trim()}`)
    }
    initProfile(profileDir, [])
    installation = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: electronPath,
      pnpmBinPath: pnpmCli,
      electronVersion,
      stateDir: join(root, 'runtime'),
      environment: env,
    })
    assertNoRunnerEnvironment('flat profile pnpm PATH installation', env)
    runElectronEntry(
      'flat profile dsh plugin help',
      ['--expose-internals'],
      entry,
      ['plugin', '--help'],
      /Usage:\s+pnpm/u,
      env,
    )
  } finally {
    try {
      installation?.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

runElectronEntry('dsh', ['--expose-internals'], desktopCli, ['--version'], dshVersion)
runFlatProfileDshEntry()
runPackagedPnpmShim()
