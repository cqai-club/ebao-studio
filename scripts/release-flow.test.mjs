import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  assertIntegration, assertPackaging, assertPromotion, assertVersions,
  ensureTag, provenanceMessage, publishVerifiedRelease, releaseIdentity,
} from './release-flow.mjs'

const env = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/master',
  RELEASE_TAG: 'v1.2.3', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '42',
  GITHUB_REPOSITORY: 'cqai-club/ebao-studio', GITHUB_SERVER_URL: 'https://github.com',
  MACOS_UNSIGNED_TEST: 'true',
}
const identity = releaseIdentity(env)
const provenance = { ...identity, assets: { 'a.zip': 'sha256:a', 'latest.yml': 'sha256:b' } }
const promotion = {
  merged_at: '2026-10-05', merge_commit_sha: identity.sha,
  base: { ref: 'master' }, head: { ref: 'dev', repo: { full_name: identity.repository } },
}

function fixture() {
  const state = { tag: null, ref: null, release: null, assets: [], writes: [], uploads: [] }
  const api = async (endpoint, body) => {
    if (body) state.writes.push(endpoint)
    if (endpoint.startsWith('git/ref/tags/')) return state.ref
    if (endpoint.startsWith('git/tags/')) return state.tag
    if (endpoint === 'git/tags') return (state.tag = { sha: 'tag-object', message: body.message, object: { type: body.type, sha: body.object } })
    if (endpoint === 'git/refs') return (state.ref = { object: { type: 'tag', sha: body.sha } })
    if (endpoint.startsWith('releases/tags/')) return state.release?.draft ? null : state.release
    if (endpoint.startsWith('releases?')) return state.release ? [state.release] : []
    if (endpoint === 'releases') return (state.release = { id: 1, ...body })
    if (endpoint.startsWith('releases/1/assets')) return [...state.assets]
    if (endpoint.startsWith('releases/assets/')) {
      state.assets = state.assets.filter(asset => asset.id !== Number(endpoint.split('/').at(-1)))
      return null
    }
    if (endpoint === 'releases/1') return Object.assign(state.release, body)
    throw new Error(`Unexpected API: ${endpoint}`)
  }
  const upload = async (tag, name) => {
    state.uploads.push(name)
    state.assets.push({ name, digest: provenance.assets[name] })
  }
  return { state, api, upload }
}

test('only repository dev PRs may promote to master; feature PRs enter dev', () => {
  assertIntegration({ pull_request: promotion }, identity.repository)
  assertIntegration({ pull_request: { base: { ref: 'dev' }, head: { ref: 'feature' } } }, identity.repository)
  for (const head of [{ ref: 'feature', repo: promotion.head.repo }, { ref: 'dev', repo: { full_name: 'fork/repo' } }]) {
    assert.throws(() => assertIntegration({ pull_request: { ...promotion, head } }, identity.repository), /enter dev first/)
  }
})

test('rejects dispatch from dev, tags, push events and malformed version numbers', () => {
  for (const change of [
    { GITHUB_REF: 'refs/heads/dev' }, { GITHUB_REF: 'refs/tags/v1.2.3' },
    { GITHUB_EVENT_NAME: 'push' }, { RELEASE_TAG: '1.2.3' }, { RELEASE_TAG: 'v01.2.3' },
    { GITHUB_SHA: 'master' },
  ]) assert.throws(() => releaseIdentity({ ...env, ...change }))
})

test('checks all release version records', () => {
  const versions = [{ version: '1.2.3' }, { version: '1.2.3-beta.1' }, { channel: 'stable', version: '1.2.3' }]
  assertVersions(identity, ...versions)
  for (let i = 0; i < versions.length; i += 1) {
    const wrong = structuredClone(versions)
    wrong[i].version = '9.9.9'
    assert.throws(() => assertVersions(identity, ...wrong), /must match/)
  }
})

test('release SHA must be on master and exactly the merged dev promotion', async () => {
  await assertPromotion(identity, async endpoint => endpoint.startsWith('compare/') ? { status: 'ahead' } : [promotion])
  for (const [status, prs] of [
    ['diverged', [promotion]], ['behind', [promotion]], ['identical', []],
    ['identical', [{ ...promotion, merge_commit_sha: 'b'.repeat(40) }]],
    ['identical', [{ ...promotion, merged_at: null }]],
    ['identical', [{ ...promotion, head: { ...promotion.head, ref: 'feature' } }]],
  ]) await assert.rejects(assertPromotion(identity, async endpoint => endpoint.startsWith('compare/') ? { status } : prs))
})

test('failed, cancelled or incomplete packaging cannot create a tag; retry may succeed', async () => {
  const f = fixture()
  const run = { head_sha: identity.sha, head_branch: 'master', event: 'workflow_dispatch', path: '.github/workflows/release.yml' }
  const jobs = ['verify', 'windows', 'macos'].map(name => ({ name, conclusion: 'success' }))
  for (const name of ['verify', 'windows', 'macos']) {
    for (const conclusion of ['failure', 'cancelled', null, 'skipped']) {
      const failed = jobs.map(job => job.name === name ? { ...job, conclusion } : job)
      await assert.rejects(async () => {
        await assertPackaging(identity, async endpoint => endpoint.includes('/jobs?') ? { jobs: failed, total_count: 3 } : run)
        await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
      }, /must succeed/)
      assert.deepEqual(f.state.writes, [])
    }
  }
  await assertPackaging(identity, async endpoint => endpoint.includes('/jobs?') ? { jobs, total_count: 3 } : run)
  await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
  assert.equal(f.state.tag.object.sha, identity.sha)
  assert.equal(f.state.release.draft, false)
})

test('packaging from another commit, branch or workflow is rejected', async () => {
  const run = { head_sha: identity.sha, head_branch: 'master', event: 'workflow_dispatch', path: '.github/workflows/release.yml' }
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'dev' }, { event: 'push' }, { path: '.github/workflows/ci.yml' }]) {
    await assert.rejects(assertPackaging(identity, async () => ({ ...run, ...change })), /does not match/)
  }
})

test('success records commit/run/assets, then an identical retry makes no mutations', async () => {
  const f = fixture()
  await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
  assert.deepEqual(JSON.parse(f.state.tag.message), JSON.parse(provenanceMessage(provenance)))
  assert.match(f.state.release.body, /actions\/runs\/42/)
  assert.deepEqual(f.state.writes, ['git/tags', 'git/refs', 'releases', 'releases/1'])
  f.state.writes.length = 0
  await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
  assert.deepEqual(f.state.writes, [])
  assert.equal(f.state.uploads.length, 2)
})

test('partial upload failure leaves a draft; retry fills missing assets without overwrite', async () => {
  const f = fixture()
  await assert.rejects(publishVerifiedRelease(provenance, 'notes', f.api, async (tag, name) => {
    if (name === 'latest.yml') throw new Error('network failure')
    await f.upload(tag, name)
  }), /network failure/)
  assert.equal(f.state.release.draft, true)
  await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
  assert.equal(f.state.release.draft, false)
  assert.deepEqual(f.state.uploads, ['a.zip', 'latest.yml'])
  assert.equal(f.state.writes.filter(path => path === 'git/refs').length, 1)
})

test('retry after ref creation failure creates only the missing reference', async () => {
  const f = fixture()
  await assert.rejects(ensureTag(provenance, async (endpoint, body) => {
    if (endpoint === 'git/refs') throw new Error('network failure')
    return f.api(endpoint, body)
  }), /network failure/)
  assert.equal(f.state.ref, null)
  await ensureTag(provenance, f.api)
  assert.equal(f.state.ref.object.type, 'tag')
})

test('retry removes only empty failed-upload placeholders in its owned draft', async () => {
  const f = fixture()
  await assert.rejects(publishVerifiedRelease(provenance, 'notes', f.api, async () => {
    f.state.assets.push({ id: 7, name: 'a.zip', state: 'starter', size: 0, digest: null })
    throw new Error('502 upload failure')
  }), /502/)
  await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
  assert.ok(f.state.writes.includes('releases/assets/7'))
  assert.equal(f.state.release.draft, false)
})

test('existing tag from another commit, run, mode or bytes is immutable', async () => {
  const f = fixture()
  await ensureTag(provenance, f.api)
  f.state.writes.length = 0
  for (const change of [
    { sha: 'b'.repeat(40) }, { runId: '99' }, { macosMode: 'signed' },
    { assets: { 'a.zip': 'sha256:different' } },
  ]) await assert.rejects(ensureTag({ ...provenance, ...change }, f.api), /never move it/)
  f.state.ref.object.type = 'commit'
  await assert.rejects(ensureTag(provenance, f.api), /lacks packaging provenance/)
  assert.deepEqual(f.state.writes, [])
})

test('conflicting published bytes and unowned releases stop retry without overwrite', async () => {
  const f = fixture()
  await publishVerifiedRelease(provenance, 'notes', f.api, f.upload)
  f.state.writes.length = 0
  f.state.assets[0].digest = 'sha256:wrong'
  await assert.rejects(publishVerifiedRelease(provenance, 'notes', f.api, f.upload), /conflicts/)
  f.state.release.body = 'someone else'
  await assert.rejects(publishVerifiedRelease(provenance, 'notes', f.api, f.upload), /not owned/)
  assert.deepEqual(f.state.writes, [])
})

test('workflow orders pinned master packaging and retained artifacts before tag creation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(workflow, /^  push:/mu)
  assert.match(workflow, /RELEASE_REF: \$\{\{ github.sha \}\}/u)
  assert.equal((workflow.match(/ref: \$\{\{ env.RELEASE_REF \}\}/gu) ?? []).length, 4)
  assert.match(workflow, /needs: \[verify, windows, macos\]/u)
  assert.match(workflow, /if: github.ref == 'refs\/heads\/master'/u)
  const stages = ['node scripts/verify-release-assets.mjs', 'node scripts/release-flow.mjs record', 'name: release-validated-', 'node scripts/release-flow.mjs publish']
  const positions = stages.map(stage => workflow.indexOf(stage))
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])))
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.equal((ci.match(/branches: \[dev, master\]/gu) ?? []).length, 2)
  assert.match(ci, /node scripts\/release-flow.mjs integration/u)
})
