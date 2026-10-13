import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseRemoteRefs, plannedSourceUpdates, sourceSyncConfig } from './sync-gitcode-source.mjs'

const first = 'a'.repeat(40)
const second = 'b'.repeat(40)

test('source configuration requires credentials before accepting only official source and valid target refs', () => {
  const env = { GITCODE_TOKEN: 'test-token' }
  assert.deepEqual(sourceSyncConfig(env), { repository: 'g-dxw/ebao-studio', tag: '', token: 'test-token' })
  assert.equal(sourceSyncConfig({ ...env, RELEASE_TAG: 'v1.2.3' }).tag, 'v1.2.3')
  for (const change of [
    { GITCODE_TOKEN: '' }, { GITCODE_REPOSITORY: 'https://gitcode.com/owner/repo' },
    { GITCODE_REPOSITORY: '../repo' }, { SOURCE_REPOSITORY: 'fork/ebao-studio' },
    { GITHUB_REPOSITORY: 'fork/ebao-studio' }, { RELEASE_TAG: 'v01.2.3' },
    { RELEASE_TAG: 'v1.2.3-beta.1' },
  ]) assert.throws(() => sourceSyncConfig({ ...env, ...change }))
  assert.throws(() => sourceSyncConfig({ RELEASE_TAG: 'bad' }), /GITCODE_TOKEN/u)
})

test('source CLI refuses missing credentials before making remote Git requests', () => {
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('./sync-gitcode-source.mjs', import.meta.url))], {
    env: { ...process.env, GITCODE_TOKEN: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }), error => /GITCODE_TOKEN/u.test(error.stderr?.toString() ?? ''))
})

test('remote Git output is parsed as full immutable object IDs and ref names', () => {
  assert.deepEqual(parseRemoteRefs(`${first}\trefs/heads/master\n${second}\trefs/heads/dev\n`), {
    'refs/heads/master': first, 'refs/heads/dev': second,
  })
  assert.deepEqual(parseRemoteRefs(''), {})
  for (const text of [
    'master\trefs/heads/master', `${first}\tmaster`, `${first}`, 'authentication failed',
  ]) assert.throws(() => parseRemoteRefs(text), /invalid remote refs/u)
})

test('source planning updates only requested dev/master/tag refs and preserves unrelated remote refs', () => {
  const source = { 'refs/heads/dev': second, 'refs/heads/master': first, 'refs/tags/v1.2.3': second }
  const remote = { 'refs/heads/dev': first, 'refs/heads/master': first, 'refs/heads/manual': second, 'refs/tags/v0.9.0': first }
  assert.deepEqual(plannedSourceUpdates(source, remote), [
    { ref: 'refs/heads/dev', sha: second }, { ref: 'refs/tags/v1.2.3', sha: second },
  ])
  assert.deepEqual(plannedSourceUpdates(source, { ...remote, ...source }), [])
  assert.equal(remote['refs/heads/manual'], second)
  assert.equal(remote['refs/tags/v0.9.0'], first)
})

test('source planning never moves an existing tag or accepts arbitrary refs', () => {
  assert.throws(() => plannedSourceUpdates({ 'refs/tags/v1.2.3': second }, { 'refs/tags/v1.2.3': first }), /never move it/u)
  for (const refs of [
    { 'refs/heads/feature': first }, { 'refs/tags/latest': first },
    { 'refs/tags/v01.2.3': first }, { 'refs/tags/v1.2.3-beta.1': first },
    { 'refs/heads/master': 'master' },
  ]) assert.throws(() => plannedSourceUpdates(refs, {}), /Invalid source ref/u)
})

const workflow = readFileSync(new URL('../.github/workflows/sync-gitcode.yml', import.meta.url), 'utf8')

test('mirror workflow gates trusted branches, one writer, pinned caller SHA and source-before-release execution', () => {
  assert.match(workflow, /branches: \[dev, master\]/u)
  assert.match(workflow, /workflow_dispatch:/u)
  assert.match(workflow, /workflow_call:/u)
  assert.match(workflow, /vars\.GITCODE_SYNC_ENABLED == 'true'/u)
  assert.match(workflow, /github\.ref == 'refs\/heads\/master'/u)
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/dev'/u)
  assert.match(workflow, /group: gitcode-mirror\n  cancel-in-progress: false/u)
  assert.match(workflow, /permissions:\n  contents: read/u)
  assert.match(workflow, /persist-credentials: false/u)
  assert.match(workflow, /ref: \$\{\{ inputs\.source_ref \|\| github\.sha \}\}/u)
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.release_tag/u)
  const stages = [
    'name: Validate trusted execution source and mirror mode', 'uses: actions/checkout@',
    'node scripts/sync-gitcode-source.mjs', 'node scripts/sync-gitcode-release.mjs',
  ].map(stage => workflow.indexOf(stage))
  assert.ok(stages.every((position, index) => position >= 0 && (index === 0 || position > stages[index - 1])))
  assert.match(workflow, /name: Mirror and verify GitHub Release assets\n        if: env\.SYNC_MODE == 'release'/u)
  assert.doesNotMatch(workflow, /continue-on-error: true/u)
})

test('workflow preflight rejects changed execution SHA, bad modes/tags and absent credentials before checkout', () => {
  const block = /run: \|\n((?:          .*\n)+)/u.exec(workflow)
  assert.ok(block)
  const script = block[1].replace(/^ {10}/gmu, '')
  const env = {
    ...process.env, SOURCE_REF: first, GITHUB_SHA: first, SYNC_MODE: 'release',
    RELEASE_TAG: 'v1.2.3', GITCODE_TOKEN: 'test-token',
  }
  assert.doesNotThrow(() => execFileSync('bash', ['-c', script], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.doesNotThrow(() => execFileSync('bash', ['-c', script], {
    env: { ...env, SYNC_MODE: 'source', RELEASE_TAG: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }))
  for (const change of [
    { SOURCE_REF: 'master' }, { SOURCE_REF: second }, { SYNC_MODE: 'invalid' },
    { RELEASE_TAG: '' }, { RELEASE_TAG: 'v01.2.3' }, { GITCODE_TOKEN: '' },
  ]) assert.throws(() => execFileSync('bash', ['-c', script], {
    env: { ...env, ...change }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status === 1)
})

test('automatic release mirroring follows successful publication and passes only a trusted SHA', () => {
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  const mirror = release.slice(release.indexOf('\n  mirror-gitcode:'))
  assert.match(mirror, /needs: publish/u)
  assert.match(mirror, /if: vars\.GITCODE_SYNC_ENABLED == 'true'/u)
  assert.match(mirror, /uses: \.\/\.github\/workflows\/sync-gitcode\.yml/u)
  assert.match(mirror, /source_ref: \$\{\{ github\.sha \}\}/u)
  assert.match(mirror, /release_tag: \$\{\{ inputs\.release_tag \}\}/u)
  assert.match(mirror, /GITCODE_TOKEN: \$\{\{ secrets\.GITCODE_TOKEN \}\}/u)
  assert.doesNotMatch(mirror, /always\(\)|continue-on-error: true/u)
})
