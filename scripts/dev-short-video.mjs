/** Run the short-video Desktop branch with an isolated development profile. */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataRoot = join(dirname(root), `${basename(root)}-data`)
const userData = join(dataRoot, 'userData')
const dshHome = join(dataRoot, 'dsh')
const yarnEntry = process.env.COREPACK_ROOT
  ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js')
  : /\.[cm]?js$/u.test(process.env.npm_execpath ?? '') ? process.env.npm_execpath : undefined

if (process.argv.includes('--print-config')) {
  console.log(JSON.stringify({ userData, dshHome, aaRef: 'pinned' }, null, 2))
} else if (!yarnEntry || !existsSync(yarnEntry)) {
  throw new Error('Run this launcher through corepack yarn dev:short-video')
} else {
  mkdirSync(userData, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  console.log(`Short Video development data: ${dataRoot}`)
  const child = spawn(process.execPath, [yarnEntry, 'dev'], {
    cwd: root,
    env: {
      ...process.env,
      DSH_DESKTOP_DEV_USER_DATA: userData,
      DSH_HOME: dshHome,
      DSH_AA_SOURCE_REF: 'pinned',
    },
    stdio: 'inherit',
    windowsHide: false,
  })
  child.once('error', error => {
    console.error(error)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 128 : 1)
  })
}
