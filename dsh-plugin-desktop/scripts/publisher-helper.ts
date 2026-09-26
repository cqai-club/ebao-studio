/** Validate the separately built MatrixMedia Universal Helper before packaging. */

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const PUBLISHER_HELPER_RELATIVE_PATH = join(
  'matrixmedia-publisher', 'build', 'publisher-worker', 'mac-universal',
  'MatrixMedia Publisher Worker.app',
)

/** Location of the Helper after electron-builder copies it into the outer app. */
export const PACKAGED_PUBLISHER_HELPER_RELATIVE_PATH = join(
  'Contents', 'Resources', 'publisher', 'MatrixMedia Publisher Worker.app',
)

/** Windows dir target produced by the separately built Electron 24 Worker. */
export const WINDOWS_PUBLISHER_HELPER_RELATIVE_PATH = join(
  'matrixmedia-publisher', 'build', 'publisher-worker', 'win-unpacked',
)

/** Electron Builder copies the complete Windows Helper directory into resources. */
export const PACKAGED_WINDOWS_PUBLISHER_HELPER_RELATIVE_PATH = join('resources', 'publisher')

export const WINDOWS_PUBLISHER_EXECUTABLE = 'MatrixMedia Publisher Worker.exe'
export const WINDOWS_PUBLISHER_ASAR_RELATIVE_PATH = join('resources', 'app.asar')

/** Mach-O files whose two slices prove the nested Electron app is Universal. */
export const PUBLISHER_HELPER_UNIVERSAL_ENTRIES = [
  'Contents/MacOS/MatrixMedia Publisher Worker',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib',
  'Contents/Frameworks/Mantle.framework/Versions/A/Mantle',
  'Contents/Frameworks/ReactiveObjC.framework/Versions/A/ReactiveObjC',
  'Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel',
  'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
  'Contents/Frameworks/MatrixMedia Publisher Worker Helper.app/Contents/MacOS/MatrixMedia Publisher Worker Helper',
  'Contents/Frameworks/MatrixMedia Publisher Worker Helper (GPU).app/Contents/MacOS/MatrixMedia Publisher Worker Helper (GPU)',
  'Contents/Frameworks/MatrixMedia Publisher Worker Helper (Plugin).app/Contents/MacOS/MatrixMedia Publisher Worker Helper (Plugin)',
  'Contents/Frameworks/MatrixMedia Publisher Worker Helper (Renderer).app/Contents/MacOS/MatrixMedia Publisher Worker Helper (Renderer)',
] as const

export type ArchitectureProbe = (filename: string) => readonly string[]

function lipoArchitectures(filename: string): readonly string[] {
  const result = spawnSync('lipo', ['-archs', filename], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`lipo failed for ${filename}: ${result.stderr.trim()}`)
  return result.stdout.trim().split(/\s+/u).filter(Boolean)
}

/** Verify source declaration, bundle identity, and every native helper slice. */
export function verifyPublisherHelper(
  workspaceRoot: string,
  probe: ArchitectureProbe = lipoArchitectures,
): string {
  const app = resolve(workspaceRoot, PUBLISHER_HELPER_RELATIVE_PATH)
  const info = join(app, 'Contents', 'Info.plist')
  if (!existsSync(info)) {
    throw new Error(
      `Publisher Worker is missing at ${app}; build matrixmedia-publisher with Node 20 before packaging`,
    )
  }
  const plist = readFileSync(info)
  if (!plist.includes(Buffer.from('com.cqaiclub.ebao.publisher-worker'))) {
    throw new Error(`Publisher Worker at ${app} has an unexpected bundle identifier`)
  }
  for (const entry of PUBLISHER_HELPER_UNIVERSAL_ENTRIES) {
    const filename = join(app, entry)
    if (!existsSync(filename)) throw new Error(`Publisher Worker is missing native entry ${entry}`)
    const architectures = new Set(probe(filename))
    for (const architecture of ['x86_64', 'arm64']) {
      if (!architectures.has(architecture)) {
        throw new Error(`Publisher Worker entry ${entry} is missing ${architecture}`)
      }
    }
  }
  return app
}

function latestSourceMtime(path: string): number {
  if (!existsSync(path)) return 0
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.mtimeMs
  return readdirSync(path).reduce((latest, entry) =>
    Math.max(latest, latestSourceMtime(join(path, entry))), 0)
}

/** Verify the native Windows Helper before the outer Desktop build starts. */
export function verifyWindowsPublisherHelper(workspaceRoot: string): string {
  const helper = resolve(workspaceRoot, WINDOWS_PUBLISHER_HELPER_RELATIVE_PATH)
  const executable = join(helper, WINDOWS_PUBLISHER_EXECUTABLE)
  const archive = join(helper, WINDOWS_PUBLISHER_ASAR_RELATIVE_PATH)
  if (!existsSync(executable) || !existsSync(archive)) {
    throw new Error(
      `Windows Publisher Worker is missing at ${helper}; build matrixmedia-publisher with Node 20 before packaging`,
    )
  }
  if (!statSync(executable).isFile() || !statSync(archive).isFile() || statSync(archive).size === 0) {
    throw new Error(`Windows Publisher Worker at ${helper} has an incomplete Electron runtime`)
  }
  const descriptor = openSync(executable, 'r')
  const dosHeader = Buffer.alloc(64)
  const signature = Buffer.alloc(4)
  try {
    if (readSync(descriptor, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length
      || dosHeader.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`Windows Publisher Worker at ${executable} is not a Windows executable`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > statSync(executable).size - signature.length
      || readSync(descriptor, signature, 0, signature.length, peOffset) !== signature.length
      || !signature.equals(Buffer.from('PE\0\0'))) {
      throw new Error(`Windows Publisher Worker at ${executable} is not a Windows executable`)
    }
  } finally {
    closeSync(descriptor)
  }
  const sourceRoot = join(workspaceRoot, 'matrixmedia-publisher')
  const sourceMtime = Math.max(
    latestSourceMtime(join(sourceRoot, 'src')),
    latestSourceMtime(join(sourceRoot, '.electron-vue')),
    latestSourceMtime(join(sourceRoot, 'lib', 'icons')),
    latestSourceMtime(join(sourceRoot, 'scripts', 'gen-telemetry-secret.js')),
    latestSourceMtime(join(sourceRoot, 'package.json')),
    latestSourceMtime(join(sourceRoot, 'yarn.lock')),
    latestSourceMtime(join(sourceRoot, 'electron-builder.publisher.yml')),
  )
  if (sourceMtime > statSync(archive).mtimeMs) {
    throw new Error(`Windows Publisher Worker at ${helper} is older than MatrixMedia source; rebuild it with Node 20`)
  }
  return helper
}
