/**
 * Contract tests for `scripts/verify-plugin-publish.mjs`.
 *
 * The gate mirrors the Community Market npm verifier, so these cases pin the
 * properties that decide whether a plugin can be installed from the Market:
 * a stable exact version, a safe bundle patch that ships in the tarball, and
 * every runtime entry the manifest promises actually being packed.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

const script = resolve(import.meta.dirname, 'verify-plugin-publish.mjs')
const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Build one throwaway plugin directory plus a matching pack manifest. */
function fixture({ manifest, packFiles, packName, packVersion }) {
  const root = mkdtempSync(join(tmpdir(), 'verify-plugin-publish-'))
  roots.push(root)
  const pluginDir = join(root, 'plugin')
  mkdirSync(pluginDir, { recursive: true })
  for (const file of packFiles ?? []) {
    const absolute = join(pluginDir, file)
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, 'x')
  }
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(manifest, undefined, 2))
  const packPath = join(root, 'pack.json')
  writeFileSync(packPath, JSON.stringify([{
    name: packName ?? manifest.name,
    version: packVersion ?? manifest.version,
    files: (packFiles ?? []).map(path => ({ path })),
  }]))
  return { pluginDir, packPath, root }
}

/** Run the gate and return its exit code and combined output. */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, output: stdout }
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

/** Minimal manifest satisfying every check. */
function baseManifest(overrides = {}) {
  return {
    name: 'cqai-dsh-plugin-example',
    version: '1.0.0',
    license: 'MIT',
    files: ['lib/**', 'cordis.patch.yml', 'README.md', 'LICENSE'],
    main: 'lib/index.js',
    exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' } },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    publishConfig: { access: 'public' },
    ...overrides,
  }
}

const baseFiles = ['lib/index.js', 'lib/index.d.ts', 'cordis.patch.yml', 'README.md', 'LICENSE']

describe('verify-plugin-publish tarball mode', () => {
  it('accepts a Market-shaped package', () => {
    const { pluginDir, packPath } = fixture({ manifest: baseManifest(), packFiles: baseFiles })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 0)
    assert.match(result.output, /READY TO PUBLISH/u)
  })

  it('rejects a private package', () => {
    const { pluginDir, packPath } = fixture({ manifest: baseManifest({ private: true }), packFiles: baseFiles })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /FAIL {2}package is not marked private/u)
  })

  it('rejects a prerelease version', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ version: '1.0.0-rc.1' }),
      packFiles: baseFiles,
      packVersion: '1.0.0-rc.1',
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /version is a stable exact semver/u)
  })

  it('rejects a blocked Desktop product package', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ name: 'dsh-community-market' }),
      packFiles: baseFiles,
      packName: 'dsh-community-market',
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /blocked Desktop product package/u)
  })

  it('rejects an absolute bundle patch path', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ dsh: { bundle: { patch: '/etc/passwd' } } }),
      packFiles: baseFiles,
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /dsh\.bundle\.patch is a safe relative path/u)
  })

  it('rejects a bundle patch that escapes the package', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ dsh: { bundle: { patch: './../outside.yml' } } }),
      packFiles: baseFiles,
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /dsh\.bundle\.patch is a safe relative path/u)
  })

  it('rejects a runtime entry missing from the tarball', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest(),
      packFiles: baseFiles.filter(file => file !== 'lib/index.js'),
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /runtime entry ships in the tarball: lib\/index\.js/u)
  })

  it('rejects a declared types entry missing from the tarball', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ types: 'lib/index.d.ts' }),
      packFiles: baseFiles.filter(file => file !== 'lib/index.d.ts'),
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /declared types ship in the tarball: lib\/index\.d\.ts/u)
  })

  it('rejects a missing bundle patch file even when listed', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest(),
      packFiles: ['lib/index.js', 'lib/index.d.ts', 'README.md', 'LICENSE'],
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /declared bundle patch exists on disk/u)
  })

  it('rejects a version that does not match the release request', () => {
    const { pluginDir, packPath } = fixture({ manifest: baseManifest(), packFiles: baseFiles })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath, '--expected-version', '9.9.9'])
    assert.equal(result.code, 1)
    assert.match(result.output, /version matches the requested release version/u)
  })

  it('rejects a tarball whose version differs from the manifest', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest(),
      packFiles: baseFiles,
      packVersion: '2.0.0',
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /packed tarball carries the same version/u)
  })

  it('rejects a package that hides its contents with no files allowlist', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ files: undefined }),
      packFiles: baseFiles,
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /manifest declares a files allowlist/u)
  })

  it('rejects a package without public publish access', () => {
    const { pluginDir, packPath } = fixture({
      manifest: baseManifest({ publishConfig: undefined }),
      packFiles: baseFiles,
    })
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /publishConfig\.access is public/u)
  })

  it('tolerates lifecycle-script noise before the pack JSON', () => {
    const { pluginDir, packPath } = fixture({ manifest: baseManifest(), packFiles: baseFiles })
    const noise = 'ℹ tsdown v0.22.14\nℹ [pkg/host] entry: src/index.ts\n[1/1] Build complete\n'
    const payload = execFileSync(process.execPath, ['-e', `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(packPath)}, 'utf8'))`], { encoding: 'utf8' })
    writeFileSync(packPath, `${noise}${payload}`)
    const result = run(['--plugin-dir', pluginDir, '--pack-json', packPath])
    assert.equal(result.code, 0, result.output)
  })

  it('exits 2 for a usage error rather than reporting a verdict', () => {
    const result = run(['--plugin-dir', 'nowhere'])
    assert.equal(result.code, 2)
    assert.match(result.output, /usage:/u)
  })
})

describe('verify-plugin-publish registry mode', () => {
  it('accepts a published manifest that exposes a tarball', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-plugin-publish-reg-'))
    roots.push(root)
    const manifestPath = join(root, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify({
      ...baseManifest(),
      dist: { tarball: 'https://registry.npmjs.org/cqai-dsh-plugin-example/-/example-1.0.0.tgz' },
    }))
    const result = run(['--registry-manifest', manifestPath])
    assert.equal(result.code, 0)
    assert.match(result.output, /PUBLISHED MANIFEST ACCEPTED/u)
  })

  it('rejects a published manifest without a tarball URL', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-plugin-publish-reg-'))
    roots.push(root)
    const manifestPath = join(root, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(baseManifest()))
    const result = run(['--registry-manifest', manifestPath])
    assert.equal(result.code, 1)
    assert.match(result.output, /registry manifest exposes a tarball URL/u)
  })
})
