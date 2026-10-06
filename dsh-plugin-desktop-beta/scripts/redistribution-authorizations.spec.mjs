import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { redistributionAuthorization, redistributionAuthorizationNotices } from './redistribution-authorizations.mjs'

const connector = { name: '@tencent-connect/qqbot-connector', version: '1.2.0' }

test('accepts only the confirmed connector version with its upstream metadata', () => {
  const authorization = redistributionAuthorization(connector, 'UNLICENSED')
  assert.equal(authorization?.reference, 'release/qqbot-connector-authorization.md')
  assert.equal(authorization?.declaredLicense, 'UNLICENSED')
})

test('does not extend the confirmation to another version or package', () => {
  assert.equal(redistributionAuthorization({ ...connector, version: '1.2.1' }, 'UNLICENSED'), undefined)
  assert.equal(redistributionAuthorization({ ...connector, name: 'another-unlicensed-package' }, 'UNLICENSED'), undefined)
})

test('requires the original license declaration to match', () => {
  assert.equal(redistributionAuthorization(connector, 'Unlicense'), undefined)
  assert.equal(redistributionAuthorization(connector, undefined), undefined)
})

test('discloses the confirmation without relabeling the upstream license', () => {
  const notices = redistributionAuthorizationNotices([redistributionAuthorization(connector, 'UNLICENSED')]).join('\n')
  assert.match(notices, /qqbot-connector \| 1\.2\.0 \| UNLICENSED/)
  assert.match(notices, /2026-09-30/)
  assert.match(notices, /release\/qqbot-connector-authorization\.md/)
  assert.match(notices, /do not relicense the packages/)
  assert.deepEqual(redistributionAuthorizationNotices([]), [])
})

test('the production gate checks every installed version and requires the confirmation record', () => {
  const temporaryRoot = tmpdir()
  const fixture = mkdtempSync(join(temporaryRoot, 'desktop-license-'))
  const scripts = join(fixture, 'desktop', 'scripts')
  function json(path, value) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value))
  }
  const record = join(fixture, 'release', 'qqbot-connector-authorization.md')
  try {
    mkdirSync(scripts, { recursive: true })
    for (const file of ['verify-licenses.mjs', 'redistribution-authorizations.mjs']) {
      copyFileSync(join(import.meta.dirname, file), join(scripts, file))
    }
    json(join(fixture, 'vendor', 'matrixmedia', 'publisher-worker.json'), {})
    json(join(fixture, 'desktop', 'package.json'), {
      name: 'desktop', dependencies: { [connector.name]: '1.2.0', 'another-parent': '1.0.0' },
    })
    const modules = join(fixture, 'desktop', 'node_modules')
    json(join(modules, connector.name, 'package.json'), { ...connector, license: 'UNLICENSED' })
    const other = join(modules, 'another-parent')
    json(join(other, 'package.json'), {
      name: 'another-parent', version: '1.0.0', license: 'MIT', dependencies: { [connector.name]: '1.2.1' },
    })
    const otherConnector = join(other, 'node_modules', connector.name, 'package.json')
    json(otherConnector, { ...connector, version: '1.2.1', license: 'UNLICENSED' })
    mkdirSync(dirname(record), { recursive: true })
    writeFileSync(record, 'Release requester confirmation fixture')
    const check = () => spawnSync(process.execPath, [join(scripts, 'verify-licenses.mjs')], { encoding: 'utf8' })
    const differentVersion = check()
    assert.equal(differentVersion.status, 1, differentVersion.stderr)
    assert.match(differentVersion.stderr, /UNLICENSED.*not on the redistribution allowlist/)
    json(otherConnector, { ...connector, license: 'UNLICENSED' })
    const approved = check()
    assert.equal(approved.status, 0, approved.stderr)
    assert.match(approved.stdout, /1 covered by recorded separate authorizations/)
    rmSync(record)
    const missingRecord = check()
    assert.equal(missingRecord.status, 1, missingRecord.stderr)
    assert.match(missingRecord.stderr, /separate authorization record is missing/)
  } finally {
    const target = relative(temporaryRoot, fixture)
    if (!target.startsWith('desktop-license-') || target.includes('..')) throw new Error('Unsafe fixture cleanup path')
    rmSync(fixture, { recursive: true, force: true })
  }
})


test('the production gate accepts the reviewed MIT or CC0 choice and rejects unknown expressions', () => {
  const temporaryRoot = tmpdir()
  const fixture = mkdtempSync(join(temporaryRoot, 'desktop-license-'))
  const scripts = join(fixture, 'desktop', 'scripts')
  const manifestPath = join(fixture, 'desktop', 'node_modules', 'type-fest', 'package.json')
  try {
    mkdirSync(scripts, { recursive: true })
    for (const file of ['verify-licenses.mjs', 'redistribution-authorizations.mjs']) {
      copyFileSync(join(import.meta.dirname, file), join(scripts, file))
    }
    const publisher = join(fixture, 'vendor', 'matrixmedia', 'publisher-worker.json')
    mkdirSync(dirname(publisher), { recursive: true })
    writeFileSync(publisher, '{}')
    writeFileSync(join(fixture, 'desktop', 'package.json'), JSON.stringify({
      name: 'desktop', dependencies: { 'type-fest': '4.41.0' },
    }))
    mkdirSync(dirname(manifestPath), { recursive: true })
    const reviewedLicense = '(MIT OR CC0-1.0)'
    writeFileSync(manifestPath, JSON.stringify({ name: 'type-fest', version: '4.41.0', license: reviewedLicense }))
    const approved = spawnSync(process.execPath, [join(scripts, 'verify-licenses.mjs'), '--notices', 'NOTICES.md'], { encoding: 'utf8' })
    assert.equal(approved.status, 0, approved.stderr)
    assert.match(readFileSync(join(fixture, 'desktop', 'NOTICES.md'), 'utf8'), /type-fest \| 4\.41\.0 \| \(MIT OR CC0-1\.0\)/)

    writeFileSync(manifestPath, JSON.stringify({ name: 'type-fest', version: '4.41.0', license: '(MIT OR LicenseRef-Unreviewed)' }))
    const unreviewed = spawnSync(process.execPath, [join(scripts, 'verify-licenses.mjs')], { encoding: 'utf8' })
    assert.equal(unreviewed.status, 1, unreviewed.stderr)
    assert.match(unreviewed.stderr, /LicenseRef-Unreviewed.*not on the redistribution allowlist/)
  } finally {
    const target = relative(temporaryRoot, fixture)
    if (!target.startsWith('desktop-license-') || target.includes('..')) throw new Error('Unsafe fixture cleanup path')
    rmSync(fixture, { recursive: true, force: true })
  }
})


test('the production gate preserves the reviewed Cua MIT and MPL expression and rejects extensions', () => {
  const temporaryRoot = tmpdir()
  const fixture = mkdtempSync(join(temporaryRoot, 'desktop-license-'))
  const scripts = join(fixture, 'desktop', 'scripts')
  const packages = ['@trycua/cua-driver-darwin-arm64', '@trycua/cua-driver-darwin-x64']
  try {
    mkdirSync(scripts, { recursive: true })
    for (const file of ['verify-licenses.mjs', 'redistribution-authorizations.mjs']) {
      copyFileSync(join(import.meta.dirname, file), join(scripts, file))
    }
    const publisher = join(fixture, 'vendor', 'matrixmedia', 'publisher-worker.json')
    mkdirSync(dirname(publisher), { recursive: true })
    writeFileSync(publisher, '{}')
    writeFileSync(join(fixture, 'desktop', 'package.json'), JSON.stringify({
      name: 'desktop', dependencies: Object.fromEntries(packages.map(name => [name, '0.28.0'])),
    }))
    for (const name of packages) {
      const manifestPath = join(fixture, 'desktop', 'node_modules', name, 'package.json')
      mkdirSync(dirname(manifestPath), { recursive: true })
      writeFileSync(manifestPath, JSON.stringify({ name, version: '0.28.0', license: 'MIT AND MPL-2.0' }))
    }
    const approved = spawnSync(process.execPath, [join(scripts, 'verify-licenses.mjs'), '--notices', 'NOTICES.md'], { encoding: 'utf8' })
    assert.equal(approved.status, 0, approved.stderr)
    const notices = readFileSync(join(fixture, 'desktop', 'NOTICES.md'), 'utf8')
    for (const name of packages) assert.ok(notices.includes(`| ${name} | 0.28.0 | MIT AND MPL-2.0 |`))

    writeFileSync(join(fixture, 'desktop', 'node_modules', packages[0], 'package.json'), JSON.stringify({
      name: packages[0], version: '0.28.0', license: 'MIT AND MPL-2.0 AND LicenseRef-Unreviewed',
    }))
    const unreviewed = spawnSync(process.execPath, [join(scripts, 'verify-licenses.mjs')], { encoding: 'utf8' })
    assert.equal(unreviewed.status, 1, unreviewed.stderr)
    assert.match(unreviewed.stderr, /LicenseRef-Unreviewed.*not on the redistribution allowlist/)
  } finally {
    const target = relative(temporaryRoot, fixture)
    if (!target.startsWith('desktop-license-') || target.includes('..')) throw new Error('Unsafe fixture cleanup path')
    rmSync(fixture, { recursive: true, force: true })
  }
})
