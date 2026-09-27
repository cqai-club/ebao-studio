/** Fail Windows packaging before the Desktop build if its separate Helper is absent or stale. */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyWindowsPublisherHelper } from './publisher-helper.ts'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Windows Publisher Worker verification passed: ${verifyWindowsPublisherHelper(workspaceRoot)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
