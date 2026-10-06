import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'))
const { resolveLibPath, ResolveLibPathError, detectTripleForTesting } = sdkRequire('@ubjs/node/typescript/dist/resolve-lib.js') as {
  resolveLibPath(options: { crateName: string; callerUrl: string; npmPackageBase: string; tripleStyle: 'node' }): string
  ResolveLibPathError: typeof Error
  detectTripleForTesting(process: NodeJS.Process, style: 'node'): string
}
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function nativeLibraryFixture(archive: boolean, physical: boolean, crateName = 'cua_driver_sdk') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'computer-use-native-path-')))
  roots.push(root)
  const app = join(root, archive ? 'app.asar' : 'source')
  const caller = join(app, 'node_modules', '@trycua', 'cua-driver', 'dist', 'native', 'index.js')
  mkdirSync(join(app, 'node_modules', '@trycua', 'cua-driver', 'dist', 'native'), { recursive: true })
  const platformPackage = join('node_modules', '@trycua', `cua-driver-${detectTripleForTesting(process, 'node')}`)
  const libraryName = process.platform === 'win32' ? `${crateName}.dll` : `lib${crateName}.${process.platform === 'darwin' ? 'dylib' : 'so'}`
  const logical = join(app, platformPackage, libraryName)
  mkdirSync(join(app, platformPackage), { recursive: true })
  writeFileSync(join(app, platformPackage, 'package.json'), '{}')
  // A logical archive entry may exist even when the physical native payload is missing.
  writeFileSync(logical, '')
  const unpacked = join(root, 'app.asar.unpacked', platformPackage, libraryName)
  if (archive && physical) {
    mkdirSync(join(root, 'app.asar.unpacked', platformPackage), { recursive: true })
    writeFileSync(unpacked, '')
  }
  const options = { crateName, callerUrl: pathToFileURL(caller).href, npmPackageBase: '@trycua/cua-driver-', tripleStyle: 'node' as const }
  return { options, logical, unpacked }
}

it('preserves the installed SDK library path for source launches', () => {
  const fixture = nativeLibraryFixture(false, false)
  expect(resolveLibPath(fixture.options)).toBe(fixture.logical)
})

it('resolves the Cua SDK from the physical unpacked payload for ASAR launches', () => {
  const fixture = nativeLibraryFixture(true, true)
  expect(resolveLibPath(fixture.options)).toBe(fixture.unpacked)
})

it('rejects a missing physical SDK payload even when its logical archive entry exists', () => {
  const fixture = nativeLibraryFixture(true, false)
  expect(() => resolveLibPath(fixture.options)).toThrow(ResolveLibPathError)
  try { resolveLibPath(fixture.options) } catch (error) {
    expect(error).toMatchObject({ mode: 'npmPackageBase', crateName: 'cua_driver_sdk', attempted: [fixture.unpacked] })
  }
})

it('preserves resolution for other Rust libraries and missing platform-package diagnostics', () => {
  const fixture = nativeLibraryFixture(true, false, 'another_sdk')
  expect(resolveLibPath(fixture.options)).toBe(fixture.logical)
  const missing = { ...fixture.options, npmPackageBase: '@missing-computer-use-fixture/platform-' }
  expect(() => resolveLibPath(missing)).toThrow('Could not find platform package')
})
