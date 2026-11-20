/** Delegate Desktop operations to the unmodified, pinned official checkout. */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, unlinkSync } from 'node:fs'
import { constants } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ACTIONS = {
  install: ['install', '--frozen-lockfile'],
  'repair-install': ['install', '--frozen-lockfile'],
  'prepare:electron': ['--filter', '@deepseek-ai/dsh-desktop', 'exec', 'install-electron'],
  version: ['--version'],
  build: ['run', 'build:artifacts'],
  typecheck: ['exec', 'tsc', '-b', 'apps/desktop/tsconfig.json'],
  test: ['exec', 'vitest', 'run', 'apps/desktop/tests', '--maxWorkers=1', '--testTimeout=15000'],
  dev: ['run', 'dev:desktop'],
  start: ['run', 'start:desktop'],
  'package:dir': ['run', 'package:desktop:dir', '--unsigned'],
  'package:mac:arm64': ['run', 'package:desktop:mac:arm64:unsigned'],
  'package:mac:x64': ['run', 'package:desktop:mac:x64:unsigned'],
  'package:win:x64': ['run', 'package:desktop:win:x64:unsigned'],
}

export const USAGE = `Usage: node scripts/official-desktop.mjs <action> [--print-config]

Actions: ${Object.keys(ACTIONS).join(', ')}
dev and start open the official graphical application. Other actions stay headless.
dev builds official artifacts before launching. Run build before start on a fresh or updated checkout.
Package actions produce local unsigned builds; they do not publish or upload.
repair-install removes stale dependency hoist links before a normal frozen install.

State defaults to .official-desktop/official/home and .official-desktop/official/electron-user-data.
Explicit absolute overrides: EBAO_OFFICIAL_DSH_HOME, EBAO_OFFICIAL_USER_DATA_DIR.
--print-config prints the selected command and state paths without running it.
`

export function parseArguments(args) {
  const remaining = args.filter(arg => arg !== '--print-config')
  if (remaining.includes('--help') || remaining.includes('-h')) return { help: true }
  if (remaining.length === 0) {
    return args.includes('--print-config') ? { action: 'dev', printConfig: true } : { help: true }
  }
  if (remaining.length !== 1 || !Object.hasOwn(ACTIONS, remaining[0])) {
    throw new Error(`Unknown Desktop action or option: ${remaining.join(' ')}.\n${USAGE}`)
  }
  return { action: remaining[0], printConfig: args.includes('--print-config') }
}

function explicitDirectory(environment, name, fallback) {
  const value = environment[name]
  if (value === undefined) return fallback
  if (value.trim() === '' || !isAbsolute(value) || value.includes('\0')) {
    throw new Error(`${name} must be a nonempty absolute directory`)
  }
  return resolve(value)
}

/** Build a command plan without creating files or exposing the inherited environment. */
export function createOfficialDesktopPlan(action, { root = ROOT, environment = process.env, platform = process.platform } = {}) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error(`Unknown Desktop action: ${action}`)
  const stateRoot = join(root, '.official-desktop', 'official')
  const home = explicitDirectory(environment, 'EBAO_OFFICIAL_DSH_HOME', join(stateRoot, 'home'))
  const userData = explicitDirectory(environment, 'EBAO_OFFICIAL_USER_DATA_DIR', join(stateRoot, 'electron-user-data'))
  const env = { ...environment }
  // Community launchers and their native bridges do not configure the official application.
  for (const key of Object.keys(env)) {
    if (key.startsWith('EBAO_PUBLISHER_') || key.startsWith('DSH_CLIENT_')) delete env[key]
  }
  for (const key of [
    'DSH_DESKTOP_HOME', 'DSH_DESKTOP_NEXT_HOME', 'DSH_DESKTOP_DEV_USER_DATA',
    'DSH_DESKTOP_DSH_DIR', 'DSH_DESKTOP_PNPM_ENTRY', 'DSH_DESKTOP_PRIMARY_RUNTIME_DIR',
    'DSH_DESKTOP_APP_ID', 'DSH_BUILD_CLIENT_PROFILE',
  ]) delete env[key]
  env.DSH_HOME = home
  env.DSH_DESKTOP_USER_DATA_DIR = userData
  if (action === 'install' || action === 'repair-install') env.CI = 'true'
  return {
    action,
    command: 'corepack',
    args: ['pnpm', ...ACTIONS[action]],
    cwd: join(root, 'deepseek-harness'),
    env,
    shell: platform === 'win32',
    state: { home, userData },
  }
}

export function assertOfficialCheckout(directory) {
  const path = join(directory, 'apps', 'desktop', 'package.json')
  if (!existsSync(path)) {
    throw new Error('Official Desktop checkout is missing. Run git submodule update --init --recursive first.')
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-desktop') throw new Error('Expected the pinned official DeepSeek Harness Desktop checkout')
}

/** Remove obsolete workspace projections and dangling store links from pnpm's ignored virtual hoist. */
export function pruneStaleDependencyLinks(officialRoot) {
  const root = resolve(officialRoot)
  const modules = join(root, 'node_modules')
  const store = join(modules, '.pnpm')
  const hoist = join(store, 'node_modules')
  // Never traverse a redirected dependency directory or touch tracked workspace source.
  for (const path of [modules, store, hoist]) {
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat === undefined) return []
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Refusing to repair a redirected dependency directory: ${path}`)
    }
  }
  const workspaceRoots = ['packages', 'apps', 'vendor'].map(name => join(root, name))
  const removed = []
  const inspect = path => {
    if (!lstatSync(path).isSymbolicLink()) return
    const target = resolve(dirname(path), readlinkSync(path))
    const workspaceTarget = workspaceRoots.some(directory => {
      const suffix = relative(directory, target)
      return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
    })
    const storeTarget = relative(store, target)
    const [storeEntry, modulesDirectory, packageName] = storeTarget.split(sep)
    const missingStoreTarget = storeEntry !== '..' && !isAbsolute(storeTarget)
      && modulesDirectory === 'node_modules' && packageName !== undefined && !existsSync(target)
    const missingWorkspaceTarget = workspaceTarget && !existsSync(join(target, 'package.json'))
    if (!missingStoreTarget && !missingWorkspaceTarget) return
    unlinkSync(path)
    removed.push(path)
  }
  for (const entry of readdirSync(hoist, { withFileTypes: true })) {
    const path = join(hoist, entry.name)
    if (entry.name.startsWith('@') && entry.isDirectory() && !entry.isSymbolicLink()) {
      for (const scoped of readdirSync(path)) inspect(join(path, scoped))
    } else inspect(path)
  }
  return removed
}

/** Preserve child exit status and forward termination to the official launcher. */
export function runOfficialDesktop(plan, { spawnImpl = spawn, signalTarget = process } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl(plan.command, plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'inherit', shell: plan.shell })
    const forwardInterrupt = () => child.kill('SIGINT')
    const forwardTermination = () => child.kill('SIGTERM')
    const cleanup = () => {
      signalTarget.off('SIGINT', forwardInterrupt)
      signalTarget.off('SIGTERM', forwardTermination)
    }
    signalTarget.on('SIGINT', forwardInterrupt)
    signalTarget.on('SIGTERM', forwardTermination)
    child.once('error', error => { cleanup(); reject(error) })
    child.once('exit', (code, signal) => {
      cleanup()
      resolvePromise(code ?? 128 + (constants.signals[signal] ?? 1))
    })
  })
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args)
  if (options.help) { process.stdout.write(USAGE); return 0 }
  const plan = createOfficialDesktopPlan(options.action)
  if (options.printConfig) {
    const { action, command, args: commandArgs, cwd, state } = plan
    process.stdout.write(`${JSON.stringify({ action, command, args: commandArgs, cwd, state }, null, 2)}\n`)
    return 0
  }
  assertOfficialCheckout(plan.cwd)
  if (plan.action === 'repair-install') {
    const removed = pruneStaleDependencyLinks(plan.cwd)
    process.stdout.write(`Official Desktop: removed ${removed.length} stale dependency hoist links before frozen install.\n`)
  }
  const code = await runOfficialDesktop(plan)
  if (code === 0 && (plan.action === 'install' || plan.action === 'repair-install')) {
    // pnpm can leave links pointing to store entries removed during an upgrade.
    const removed = pruneStaleDependencyLinks(plan.cwd)
    if (removed.length) process.stdout.write(`Official Desktop: removed ${removed.length} stale dependency hoist links after frozen install.\n`)
  }
  return code
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code }).catch(error => {
    console.error(`Official Desktop: ${error.message}`)
    process.exitCode = 1
  })
}
