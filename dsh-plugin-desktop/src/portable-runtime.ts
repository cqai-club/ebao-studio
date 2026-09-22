import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/** Resolve everything from the current executable location, including after a USB drive-letter change. */
export function portablePaths(executable: string) {
  const root = dirname(executable)
  if (!existsSync(join(root, 'portable.json'))) return undefined
  return {root, data: join(root, 'data'), runtime: join(root, 'resources', 'ejianbao-runtime')}
}

export function configurePortableRuntime(executable: string, setUserData: (path: string) => void) {
  const paths = portablePaths(executable)
  if (!paths) return undefined
  const userData = join(paths.data, 'desktop')
  mkdirSync(userData, {recursive: true})
  mkdirSync(join(paths.data, 'temp'), {recursive: true})
  process.env.DSH_HOME = join(paths.data, 'dsh')
  process.env.TEMP = process.env.TMP = join(paths.data, 'temp')
  process.env.EJIANBAO_RUNTIME = join(paths.runtime, 'video')
  process.env.EJIANBAO_PYTHON = join(paths.runtime, 'python312', 'python.exe')
  process.env.EJIANBAO_NODE = join(paths.runtime, 'node', 'node.exe')
  process.env.EJIANBAO_BROWSER_EXECUTABLE = join(paths.runtime, 'browser', 'chrome-headless-shell.exe')
  // The USB build copies the packaged app wholesale, so the bundled runtime sits
  // beside app.asar rather than inside the staged runtime folder. Naming it here
  // keeps the plugin off `resourcesPath` guessing and survives a later move.
  process.env.EJIANBAO_MATRIXMEDIA = join(paths.root, 'resources', 'matrixmedia')
  process.env.PATH = join(paths.runtime, 'node') + delimiter + (process.env.PATH ?? '')
  setUserData(userData)
  return paths
}
