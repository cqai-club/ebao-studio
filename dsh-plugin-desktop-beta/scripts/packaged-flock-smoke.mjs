/** Exercise the current session backend's POSIX lock in packaged Electron, without fs-ext. */
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [root, expectedArch] = process.argv.slice(2)
if (!root || !expectedArch || process.arch !== expectedArch) throw new Error(`packaged-flock-smoke: expected ${expectedArch}, got ${process.arch}`)
const require = createRequire(join(root, 'package.json'))
const { tryLockExclusive } = await import(pathToFileURL(require.resolve('@deepseek-ai/node-addon-system/flock')).href)
const dir = mkdtempSync(join(tmpdir(), 'dsh-packaged-flock-'))
let first
let second
try {
  const path = join(dir, 'session.lock')
  first = openSync(path, 'w')
  second = openSync(path, 'w')
  await tryLockExclusive(first)
  let contention
  try { await tryLockExclusive(second) } catch (error) { contention = error }
  if (!['EAGAIN', 'EWOULDBLOCK'].includes(contention?.code)) throw new Error('packaged-flock-smoke: second writer was not excluded')
  closeSync(first)
  first = undefined
  await tryLockExclusive(second)
  console.log(`Packaged session lock passed on ${process.platform}-${process.arch}`)
} finally {
  if (first !== undefined) closeSync(first)
  if (second !== undefined) closeSync(second)
  rmSync(dir, { recursive: true, force: true })
}
