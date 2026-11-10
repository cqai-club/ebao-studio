/** Resolve the packaged Agently CLI platform package from its unpacked copy, so the email plugin can spawn its executable. */
import { registerHooks, type ModuleHooks } from 'node:module'
import { realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runtimeArchivePath } from './office-engine.ts'

/** Scope and name prefix of the CLI platform packages, one per OS and CPU. */
export const AGENTLY_CLI_PLATFORM_PACKAGES = '@tencent-qqmail/agently-cli-'

/** A file inside one of the CLI platform packages. */
const PLATFORM_PACKAGE_FILE = /\/node_modules\/@tencent-qqmail\/agently-cli-(?:darwin|win32|linux)-[^/]+\//u

/**
 * Resolve the bundled email CLI platform package to its unpacked copy.
 * The IM plugin resolves its manifest, constructs the binary path beside it, and spawns that path.
 * Child processes cannot execute files inside app.asar. The hook only redirects packages from this
 * runtime archive; an externally installed Profile package keeps its own location.
 * @param runtimeDir - Prepared or archived runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-archived runtime.
 */
export function installAgentlyCliResolution(runtimeDir: string): ModuleHooks | undefined {
  const archivePath = runtimeArchivePath(runtimeDir)
  if (archivePath === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = realpathSync(archivePath)
  const packages = ['node_modules', ...AGENTLY_CLI_PLATFORM_PACKAGES.split('/')]
  const source = pathToFileURL(join(root, ...packages)).href
  const destination = pathToFileURL(join(`${archive}.unpacked`, relative(archive, root), ...packages)).href
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!resolved.url.startsWith('file:') || !PLATFORM_PACKAGE_FILE.test(new URL(resolved.url).pathname)) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (!canonical.startsWith(source)) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop Agently CLI resolved outside the runtime package directory: ${resolved.url}`)
        }
        return resolved
      }
      return { ...resolved, url: pathToFileURL(realpathSync(fileURLToPath(destination + canonical.slice(source.length)))).href }
    },
  })
}
