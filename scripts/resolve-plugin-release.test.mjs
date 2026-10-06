/**
 * Contract tests for `scripts/resolve-plugin-release.mjs`, the step that
 * decides which plugin package and version the publish workflow releases.
 *
 * A mistake here would publish a different package, or a prerelease the
 * Community Market refuses to install, so every rejection path is pinned.
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const script = resolve(import.meta.dirname, 'resolve-plugin-release.mjs')
const repoRoot = resolve(import.meta.dirname, '..')

/** Run the resolver with a synthetic event and return code plus outputs. */
function resolveRelease(env) {
  const base = {
    EVENT_NAME: '',
    TAG_NAME: '',
    INPUT_PLUGIN: '',
    INPUT_VERSION: '',
    INPUT_DRY_RUN: '',
    ...env,
  }
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...base },
    })
    const outputs = Object.fromEntries(
      stdout.split('\n').filter(Boolean).map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
    )
    return { code: 0, outputs, stderr: '' }
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      outputs: {},
      stderr: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

const researchDir = 'cqai-dsh-plugins/cqai-dsh-plugin-research'

describe('resolve-plugin-release tag pushes', () => {
  it('maps a tag to the real workspace package directory', () => {
    const result = resolveRelease({ EVENT_NAME: 'push', TAG_NAME: 'plugin-cqai-dsh-plugin-research-v0.1.0' })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.outputs.plugin_dir, researchDir)
    assert.equal(result.outputs.package_name, 'cqai-dsh-plugin-research')
    assert.equal(result.outputs.version, '0.1.0')
    assert.equal(result.outputs.dry_run, 'false')
  })

  it('refuses a package name absent from the workspace', () => {
    const result = resolveRelease({ EVENT_NAME: 'push', TAG_NAME: 'plugin-not-a-real-package-v1.0.0' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /no cqai-dsh-plugins\/\* package is named/u)
  })

  it('refuses a prerelease tag because the Market needs a stable version', () => {
    const result = resolveRelease({ EVENT_NAME: 'push', TAG_NAME: 'plugin-cqai-dsh-plugin-research-v0.1.0-rc.1' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /tag must look like/u)
  })

  it('refuses a tag without the plugin- prefix', () => {
    const result = resolveRelease({ EVENT_NAME: 'push', TAG_NAME: 'v0.1.0' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /tag must look like/u)
  })

  it('refuses an empty tag', () => {
    const result = resolveRelease({ EVENT_NAME: 'push', TAG_NAME: '' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /tag must look like/u)
  })

  it('never rehearses a tag push', () => {
    const result = resolveRelease({
      EVENT_NAME: 'push',
      TAG_NAME: 'plugin-cqai-dsh-plugin-research-v0.1.0',
      INPUT_DRY_RUN: 'true',
    })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.outputs.dry_run, 'false')
  })
})

describe('resolve-plugin-release manual dispatch', () => {
  it('honors an explicit directory, version and rehearsal flag', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: researchDir,
      INPUT_VERSION: '0.1.0',
      INPUT_DRY_RUN: 'true',
    })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.outputs.plugin_dir, researchDir)
    assert.equal(result.outputs.package_name, 'cqai-dsh-plugin-research')
    assert.equal(result.outputs.dry_run, 'true')
  })

  it('treats an unset rehearsal flag as a real publish', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: researchDir,
      INPUT_VERSION: '0.1.0',
      INPUT_DRY_RUN: '',
    })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.outputs.dry_run, 'false')
  })

  it('refuses a directory outside the plugin root', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: 'dsh-plugin-desktop',
      INPUT_VERSION: '0.1.0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /plugin directory must be cqai-dsh-plugins/u)
  })

  it('refuses a path traversal attempt', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: 'cqai-dsh-plugins/../dsh-plugin-desktop',
      INPUT_VERSION: '0.1.0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /plugin directory must be cqai-dsh-plugins/u)
  })

  it('refuses a nested directory', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: 'cqai-dsh-plugins/a/b',
      INPUT_VERSION: '0.1.0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /plugin directory must be cqai-dsh-plugins/u)
  })

  it('refuses an absolute directory', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: '/etc',
      INPUT_VERSION: '0.1.0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /plugin directory must be cqai-dsh-plugins/u)
  })

  it('refuses a prerelease version', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: researchDir,
      INPUT_VERSION: '0.1.0-rc.1',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /version must be stable MAJOR\.MINOR\.PATCH/u)
  })

  it('refuses a non-semver version', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: researchDir,
      INPUT_VERSION: 'v0.1.0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /version must be stable MAJOR\.MINOR\.PATCH/u)
  })

  it('refuses a plugin directory without a readable manifest', () => {
    const result = resolveRelease({
      EVENT_NAME: 'workflow_dispatch',
      INPUT_PLUGIN: 'cqai-dsh-plugins/cqai-dsh-plugin-nonexistent',
      INPUT_VERSION: '0.1.0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /cannot read/u)
  })
})
