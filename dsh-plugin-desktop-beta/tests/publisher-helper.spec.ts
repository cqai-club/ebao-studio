import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PUBLISHER_HELPER_RELATIVE_PATH,
  PUBLISHER_HELPER_UNIVERSAL_ENTRIES,
  verifyPublisherHelper,
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
      filename.endsWith(thin) ? ['arm64'] : ['x86_64', 'arm64']))
      .toThrow(`Publisher Worker entry ${thin} is missing x86_64`)
  })

  it('fails loud when the separately built helper is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'publisher-helper-missing-'))
    roots.push(root)
    expect(() => verifyPublisherHelper(root, () => ['x86_64', 'arm64']))
      .toThrow('build matrixmedia-publisher with Node 20 before packaging')
  })
})
