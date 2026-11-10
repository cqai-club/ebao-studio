/** Install the pinned Worker with official npm tarballs, restoring its submodule lock byte for byte. */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIRROR = 'https://registry.npmmirror.com/'
const OFFICIAL = 'https://registry.npmjs.org/'

/** Rewrite only Yarn resolved tarball hosts, retaining the exact path, hash and integrity lines. */
export function officialTarballs(original) {
  const text = original.toString('utf8')
  const updated = text.replace(/^(\s+resolved ")https:\/\/registry\.npmmirror\.com\//gmu, `$1${OFFICIAL}`)
  if (updated === text || updated.includes(`resolved "${MIRROR}`)) throw new Error('MatrixMedia lock has no supported mirror tarball entries')
  return Buffer.from(updated, 'utf8')
}

/** Restore the saved lock after an interrupted install; never touch it without our backup. */
export function restoreWorkerLock(lockPath, backupPath) {
  if (!existsSync(backupPath)) return false
  const original = readFileSync(backupPath)
  const current = existsSync(lockPath) ? readFileSync(lockPath) : undefined
  if (current !== undefined && !current.equals(original) && !current.equals(officialTarballs(original))) {
    throw new Error(`MatrixMedia lock changed during install; backup retained at ${backupPath}`)
  }
  if (current === undefined || !current.equals(original)) writeFileSync(lockPath, original)
  rmSync(backupPath)
  return true
}

/** Run one frozen install with a recoverable lock backup. */
export async function installWorker({ workerRoot, backupPath, command = 'corepack', args = ['yarn@1.22.22', 'install', '--frozen-lockfile'], env = process.env }) {
  const lockPath = join(workerRoot, 'yarn.lock')
  const original = readFileSync(lockPath)
  const temporary = officialTarballs(original)
  writeFileSync(backupPath, original, { flag: 'wx', mode: 0o600 })
  let child
  let signalReceived
  const interrupt = signal => { signalReceived = signal; child?.kill(signal) }
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  try {
    writeFileSync(lockPath, temporary)
    const status = await new Promise((resolveStatus, reject) => {
      child = spawn(command, args, { cwd: workerRoot, env: { ...env, npm_config_registry: OFFICIAL }, stdio: 'inherit', shell: process.platform === 'win32' && command === 'corepack' })
      child.once('error', reject)
      child.once('close', (code, signal) => resolveStatus({ code, signal }))
    })
    if (status.code !== 0 || signalReceived) throw new Error(`MatrixMedia install failed: ${signalReceived ?? status.signal ?? status.code}`)
  } finally {
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
    restoreWorkerLock(lockPath, backupPath)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workerRoot = resolve(fileURLToPath(new URL('../matrixmedia-publisher', import.meta.url)))
  const backupRoot = process.env.RUNNER_TEMP
  if (!backupRoot) throw new Error('RUNNER_TEMP is required for MatrixMedia lock recovery')
  const backupPath = join(backupRoot, 'ebao-matrixmedia-yarn.lock.original')
  if (process.argv[2] === '--restore') restoreWorkerLock(join(workerRoot, 'yarn.lock'), backupPath)
  else if (process.argv.length === 2) await installWorker({ workerRoot, backupPath })
  else throw new Error('Unexpected MatrixMedia install argument')
}
