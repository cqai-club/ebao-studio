import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PUBLISHER_HELPER_RELATIVE_PATH,
  PUBLISHER_HELPER_UNIVERSAL_ENTRIES,
  WINDOWS_PUBLISHER_ASAR_RELATIVE_PATH,
  WINDOWS_PUBLISHER_EXECUTABLE,
  WINDOWS_PUBLISHER_HELPER_RELATIVE_PATH,
  verifyPublisherHelper,
  verifyWindowsPublisherHelper,
} from '../scripts/publisher-helper.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): { root: string; app: string } {
  const root = mkdtempSync(join(tmpdir(), 'publisher-helper-'))
  roots.push(root)
  const app = join(root, PUBLISHER_HELPER_RELATIVE_PATH)
  mkdirSync(join(app, 'Contents'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<string>com.cqaiclub.ebao.publisher-worker</string>')
  for (const entry of PUBLISHER_HELPER_UNIVERSAL_ENTRIES) {
    const filename = join(app, entry)
    mkdirSync(join(filename, '..'), { recursive: true })
    writeFileSync(filename, '')
  }
  return { root, app }
}

describe('Publisher Worker package gate', () => {
  it('accepts a complete nested Universal app', () => {
    const value = fixture()
    expect(verifyPublisherHelper(value.root, () => ['x86_64', 'arm64'])).toBe(value.app)
  })

  it('fails when any native entry is thin', () => {
    const value = fixture()
    const thin = PUBLISHER_HELPER_UNIVERSAL_ENTRIES[3]
    expect(() => verifyPublisherHelper(value.root, filename =>
      filename === join(value.app, thin) ? ['arm64'] : ['x86_64', 'arm64']))
      .toThrow(`Publisher Worker entry ${thin} is missing x86_64`)
  })

  it('fails loud when the separately built helper is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-helper-missing-'))
    roots.push(root)
    expect(() => verifyPublisherHelper(root, () => ['x86_64', 'arm64']))
      .toThrow('build matrixmedia-publisher with Node 20 before packaging')
  })
})

describe('Windows Publisher Worker package gate', () => {
  function windowsFixture(): { root: string; helper: string; source: string; archive: string } {
    const root = mkdtempSync(join(tmpdir(), 'publisher-win-helper-'))
    roots.push(root)
    const helper = join(root, WINDOWS_PUBLISHER_HELPER_RELATIVE_PATH)
    const source = join(root, 'matrixmedia-publisher', 'src', 'main', 'publisher-worker', 'index.js')
    const archive = join(helper, WINDOWS_PUBLISHER_ASAR_RELATIVE_PATH)
    mkdirSync(join(source, '..'), { recursive: true })
    mkdirSync(join(archive, '..'), { recursive: true })
    writeFileSync(source, 'worker source')
    const executable = Buffer.alloc(132)
    executable.write('MZ', 0, 'ascii')
    executable.writeUInt32LE(128, 0x3c)
    executable.write('PE\0\0', 128, 'binary')
    writeFileSync(join(helper, WINDOWS_PUBLISHER_EXECUTABLE), executable)
    writeFileSync(archive, 'asar')
    return { root, helper, source, archive }
  }

  it('accepts a complete Windows Electron Helper newer than its source', () => {
    const value = windowsFixture()
    expect(verifyWindowsPublisherHelper(value.root)).toBe(value.helper)
  })

  it('rejects an absent Windows Helper', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-win-helper-missing-'))
    roots.push(root)
    expect(() => verifyWindowsPublisherHelper(root)).toThrow('build matrixmedia-publisher with Node 20')
  })

  it('rejects an incomplete Windows Electron Helper', () => {
    const value = windowsFixture()
    writeFileSync(value.archive, '')
    expect(() => verifyWindowsPublisherHelper(value.root)).toThrow('incomplete Electron runtime')
  })

  it('rejects a non-Windows Helper executable', () => {
    const value = windowsFixture()
    writeFileSync(join(value.helper, WINDOWS_PUBLISHER_EXECUTABLE), 'MZ')
    expect(() => verifyWindowsPublisherHelper(value.root)).toThrow('is not a Windows executable')
  })

  it('rejects a Helper built before a source change', () => {
    const value = windowsFixture()
    const future = new Date(Date.now() + 10_000)
    utimesSync(value.source, future, future)
    expect(() => verifyWindowsPublisherHelper(value.root)).toThrow('older than MatrixMedia source')
  })

  it.each([
    'src/renderer/main.js',
    'src/shared/constants.js',
    'lib/icons/icon.png',
  ])('rejects a Helper when build input %s changes', (entry) => {
    const value = windowsFixture()
    const input = join(value.root, 'matrixmedia-publisher', entry)
    mkdirSync(join(input, '..'), { recursive: true })
    writeFileSync(input, 'changed input')
    const future = new Date(Date.now() + 10_000)
    utimesSync(input, future, future)
    expect(() => verifyWindowsPublisherHelper(value.root)).toThrow('older than MatrixMedia source')
  })
})
