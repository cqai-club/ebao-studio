import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Stats } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
// Electron Builder exposes this runtime API without publishing its declaration.
const { getNodeModuleFileMatcher } = createRequire(import.meta.url)('app-builder-lib/out/fileMatcher.js') as {
  getNodeModuleFileMatcher: (
    from: string,
    to: string,
    expand: (value: string) => string,
    platform: { files?: readonly unknown[] },
    packager: { config: { files?: readonly unknown[] }; debugLogger: { isEnabled: boolean } },
  ) => { createFilter: () => (file: string, stats: Stats) => boolean }
}

it('copies the Windows x64 SDK and office engine while omitting their unused ARM64 payloads', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-windows-native-files-'))
  const candidates = [
    ['@trycua/cua-driver/dist/index.js', true],
    ['@ubjs/node/typescript/dist/resolve-lib.js', true],
    ['@trycua/cua-driver-win32-x64-msvc/package.json', true],
    ['@trycua/cua-driver-win32-x64-msvc/cua_driver_sdk.dll', true],
    ['@trycua/cua-driver-win32-x64-msvc/cua_driver_node_runtime.node', true],
    ['@ubjs/node-win32-x64-msvc/uniffi-runtime-napi.win32-x64-msvc.node', true],
    ['@deepseek-ai/libreoffice-kit-win32-x64/program/soffice.exe', true],
    ['@trycua/cua-driver-win32-arm64-msvc/package.json', false],
    ['@trycua/cua-driver-win32-arm64-msvc/cua_driver_sdk.dll', false],
    ['@trycua/cua-driver-win32-arm64-msvc/cua_driver_node_runtime.node', false],
    ['@ubjs/node-win32-arm64-msvc/uniffi-runtime-napi.win32-arm64-msvc.node', false],
    ['@deepseek-ai/libreoffice-kit-win32-arm64/program/soffice.exe', false],
    ['@trycua/cua-driver-darwin-arm64/libcua_driver_sdk.dylib', true],
    ['@trycua/cua-driver-darwin-x64/libcua_driver_sdk.dylib', true],
    ['@ubjs/node-darwin-arm64/uniffi-runtime-napi.darwin-arm64.node', true],
    ['@ubjs/node-darwin-x64/uniffi-runtime-napi.darwin-x64.node', true],
  ] as const
  try {
    for (const [relative] of candidates) {
      const file = join(root, 'node_modules', relative)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, 'native-payload-fixture')
    }
    // This production matcher only reads config and the logger from Packager;
    // no build, Electron launch or platform runtime is needed for file selection.
    const packager = {
      config: manifest.build,
      debugLogger: { isEnabled: false },
    }
    const windows = getNodeModuleFileMatcher(root, join(root, 'output'), value => value,
      manifest.build.win, packager).createFilter()
    for (const [relative, included] of candidates.filter(([file]) => !file.includes('-darwin-'))) {
      const file = join(root, 'node_modules', relative)
      expect(windows(file, statSync(file)), relative).toBe(included)
    }
    const macos = getNodeModuleFileMatcher(root, join(root, 'output'), value => value,
      manifest.build.mac, packager).createFilter()
    for (const [relative] of candidates.filter(([file]) => file.includes('-darwin-'))) {
      const file = join(root, 'node_modules', relative)
      expect(macos(file, statSync(file)), relative).toBe(true)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
