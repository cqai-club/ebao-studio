import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  anonymousAssetDigest, assertSourceProvenance, createGitcodeApi, gitcodeConfig,
  mirrorMarker, mirrorVerifiedRelease, uploadGitcodeAsset, validateMirrorSource,
} from './sync-gitcode-release.mjs'
import { provenanceMessage } from './release-flow.mjs'
import { expectedReleaseAssets } from './verify-release-assets.mjs'

const tag = 'v1.2.3'
const names = [...expectedReleaseAssets('1.2.3'), 'SHA256SUMS', 'latest.yml', 'latest-mac.yml']
const source = {
  repository: 'cqai-club/ebao-studio', tag, name: `e宝工坊 ${tag}（预发布）`,
  body: 'Reviewed release notes.\n\nWindows 和 macOS 安装包。', sha: 'a'.repeat(40),
  prerelease: true,
  assets: names.map((name, index) => {
    const bytes = Buffer.from(`verified-asset-${index}`)
    return { name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
  }),
}

test.beforeEach(context => { context.mock.method(console, 'log', () => {}) })

function fixture() {
  const state = { release: null, writes: [], uploads: [], downloads: [], bytes: new Map() }
  const api = async (endpoint, body, allow404, method) => {
    if (body !== undefined) state.writes.push({ endpoint, method: method ?? 'POST', body: structuredClone(body) })
    if (endpoint === `releases/tags/${tag}`) return state.release
    if (endpoint === 'releases') return (state.release = { ...body, assets: [] })
    if (endpoint === `releases/${tag}`) return Object.assign(state.release, body)
    throw new Error(`Unexpected API: ${endpoint}`)
  }
  const upload = async (releaseTag, asset) => {
    assert.equal(releaseTag, tag)
    state.uploads.push(asset.name)
    state.release.assets.push({ name: asset.name, browser_download_url: `https://gitcode.com/g-dxw/ebao-studio/releases/download/${tag}/${asset.name}` })
    state.bytes.set(asset.name, { size: asset.size, digest: asset.digest })
  }
  const verifyDownload = async (releaseTag, asset) => {
    assert.equal(releaseTag, tag)
    state.downloads.push(asset.name)
    return state.bytes.get(asset.name)
  }
  return { state, api, upload, verifyDownload }
}

test('GitCode configuration requires credentials first and constrains repository and canonical tags', () => {
  const env = { GITCODE_TOKEN: 'test-token', RELEASE_TAG: tag }
  assert.deepEqual(gitcodeConfig(env), {
    repository: 'g-dxw/ebao-studio', sourceRepository: source.repository, token: 'test-token', tag,
  })
  for (const change of [
    { GITCODE_TOKEN: '' }, { GITCODE_REPOSITORY: 'https://gitcode.com/g-dxw/ebao-studio' },
    { GITCODE_REPOSITORY: 'owner/repo/extra' }, { GITCODE_REPOSITORY: '../repo' },
    { SOURCE_REPOSITORY: 'other/repository' }, { GITHUB_REPOSITORY: 'other/repository' },
    { RELEASE_TAG: '1.2.3' }, { RELEASE_TAG: 'v01.2.3' }, { RELEASE_TAG: 'v1.2.3-beta.1' },
  ]) assert.throws(() => gitcodeConfig({ ...env, ...change }))
  assert.throws(() => gitcodeConfig({ RELEASE_TAG: 'invalid' }), /GITCODE_TOKEN/u)
})

test('CLI refuses missing GitCode credentials before invoking GitHub or reading assets', () => {
  const env = { ...process.env, RELEASE_TAG: tag, GITCODE_TOKEN: '' }
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('./sync-gitcode-release.mjs', import.meta.url))], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }), error => /GITCODE_TOKEN/u.test(error.stderr?.toString() ?? ''))
})

test('only the exact seven verified prerelease assets can enter the mirror', async () => {
  assert.doesNotThrow(() => validateMirrorSource(source))
  const invalid = [
    { ...source, repository: 'other/repository' }, { ...source, tag: 'v01.2.3' },
    { ...source, sha: 'master' }, { ...source, prerelease: false },
    { ...source, assets: source.assets.slice(1) },
    { ...source, assets: [...source.assets, { name: 'unexpected.txt', size: 1, digest: `sha256:${'b'.repeat(64)}` }] },
    { ...source, assets: source.assets.map((asset, index) => index === 0 ? { ...asset, name: source.assets[1].name } : asset) },
  ]
  for (const change of [{ size: 0 }, { size: -1 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { digest: 'sha256:wrong' }]) {
    invalid.push({ ...source, assets: source.assets.map((asset, index) => index === 0 ? { ...asset, ...change } : asset) })
  }
  for (const candidate of invalid) {
    const f = fixture()
    let calls = 0
    await assert.rejects(mirrorVerifiedRelease(candidate, async (...args) => { calls += 1; return f.api(...args) }, f.upload, f.verifyDownload))
    assert.equal(calls, 0)
    assert.deepEqual(f.state.uploads, [])
  }
})

test('new mirror remains a prerelease and completes only after every anonymous download matches', async () => {
  const f = fixture()
  await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
  assert.deepEqual(f.state.uploads.toSorted(), names.toSorted())
  assert.ok(names.every(name => f.state.downloads.includes(name)))
  assert.equal(f.state.release.target_commitish, source.sha)
  assert.equal(f.state.release.release_status, 'pre')
  assert.ok(f.state.release.body.includes(source.body))
  assert.ok(f.state.release.body.includes(mirrorMarker(source)))
  assert.deepEqual(f.state.writes.map(write => [write.endpoint, write.method]), [
    ['releases', 'POST'], [`releases/${tag}`, 'PATCH'],
  ])
  assert.notEqual(f.state.writes[0].body.body, f.state.release.body)
  assert.equal(f.state.writes[0].body.release_status, 'pre')
  assert.ok(f.state.writes.every(write => write.method !== 'DELETE'))
})

test('identical retry rechecks public downloads without uploading or writing', async () => {
  const f = fixture()
  await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
  f.state.writes.length = 0
  f.state.downloads.length = 0
  await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
  assert.deepEqual(f.state.writes, [])
  assert.deepEqual(f.state.uploads.toSorted(), names.toSorted())
  assert.ok(names.every(name => f.state.downloads.includes(name)))
})

test('failed upload leaves pending prerelease and retry fills only missing assets', async () => {
  const f = fixture()
  const failedName = names[2]
  await assert.rejects(mirrorVerifiedRelease(source, f.api, async (releaseTag, asset) => {
    if (asset.name === failedName) throw new Error('upload network failure')
    await f.upload(releaseTag, asset)
  }, f.verifyDownload), /upload network failure/u)
  const pendingBody = f.state.release.body
  assert.equal(f.state.release.release_status, 'pre')
  assert.equal(f.state.writes.filter(write => write.method === 'PATCH').length, 0)
  await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
  assert.notEqual(f.state.release.body, pendingBody)
  assert.deepEqual(f.state.uploads.toSorted(), names.toSorted())
  assert.equal(f.state.writes.filter(write => write.endpoint === 'releases').length, 1)
})

test('an uploaded asset with different public bytes cannot complete the release', async () => {
  for (const change of [{ size: source.assets[0].size + 1 }, { digest: `sha256:${'b'.repeat(64)}` }]) {
    const f = fixture()
    await assert.rejects(mirrorVerifiedRelease(source, f.api, async (releaseTag, asset) => {
      await f.upload(releaseTag, asset)
      if (asset.name === names[0]) Object.assign(f.state.bytes.get(asset.name), change)
    }, f.verifyDownload))
    assert.equal(f.state.release.release_status, 'pre')
    assert.equal(f.state.writes.filter(write => write.method === 'PATCH').length, 0)
  }
})

test('unowned releases, another commit and conflicting bytes are preserved without overwrite', async () => {
  for (const mutate of [
    f => { f.state.release.body = 'Manually created release' },
    f => { f.state.release.target_commitish = 'b'.repeat(40) },
    f => { f.state.bytes.set(names[0], { size: source.assets[0].size, digest: `sha256:${'b'.repeat(64)}` }) },
  ]) {
    const f = fixture()
    await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
    mutate(f)
    f.state.writes.length = 0
    f.state.uploads.length = 0
    await assert.rejects(mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload))
    assert.deepEqual(f.state.writes, [])
    assert.deepEqual(f.state.uploads, [])
  }
})

test('automatic source archives and unrelated manual attachments survive mirror retries', async () => {
  const f = fixture()
  await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
  const extra = [
    { name: 'Source code.zip', type: 'source' },
    { name: 'Source code.tar.gz', browser_download_url: 'https://gitcode.com/g-dxw/ebao-studio/-/archive/v1.2.3/source.tar.gz' },
    { name: 'manual-guide.pdf', browser_download_url: 'https://example.test/guide.pdf' },
  ]
  f.state.release.assets.push(...extra)
  f.state.writes.length = 0
  f.state.downloads.length = 0
  await mirrorVerifiedRelease(source, f.api, f.upload, f.verifyDownload)
  assert.deepEqual(f.state.release.assets.slice(-3), extra)
  assert.deepEqual(f.state.writes, [])
  assert.ok(f.state.downloads.every(name => names.includes(name)))
})

function provenanceFixture() {
  const provenance = {
    schema: 1, repository: source.repository, tag, sha: source.sha, runId: '42',
    runUrl: `https://github.com/${source.repository}/actions/runs/42`, macosMode: 'signed',
    assets: Object.fromEntries(source.assets.map(asset => [asset.name, asset.digest])),
  }
  return {
    provenance,
    release: { ...source, tag_name: tag, body: `${source.body}\n\n<!-- ebao-release-provenance\n${provenanceMessage(provenance)}\n-->` },
    annotatedTag: { message: provenanceMessage(provenance), object: { type: 'commit', sha: source.sha } },
  }
}

test('GitHub mirror input must have matching annotated-tag and release provenance for every asset', () => {
  const f = provenanceFixture()
  assert.doesNotThrow(() => assertSourceProvenance(f.release, f.annotatedTag))
  for (const change of [
    { message: 'A manually created tag' },
    { object: { type: 'commit', sha: 'b'.repeat(40) } },
    { object: { type: 'tag', sha: source.sha } },
  ]) assert.throws(() => assertSourceProvenance(f.release, { ...f.annotatedTag, ...change }))
  for (const mutate of [
    fixture => { fixture.release.body = source.body },
    fixture => { fixture.provenance.repository = 'other/repository' },
    fixture => { fixture.provenance.tag = 'v9.9.9' },
    fixture => { fixture.provenance.assets[names[0]] = `sha256:${'b'.repeat(64)}` },
    fixture => { delete fixture.provenance.assets[names[0]] },
  ]) {
    const invalid = provenanceFixture()
    mutate(invalid)
    if (invalid.release.body !== source.body) {
      invalid.annotatedTag.message = provenanceMessage(invalid.provenance)
      invalid.release.body = `${source.body}\n\n<!-- ebao-release-provenance\n${provenanceMessage(invalid.provenance)}\n-->`
    }
    assert.throws(() => assertSourceProvenance(invalid.release, invalid.annotatedTag))
  }
})

test('GitCode API keeps the PAT in a header and redacts authenticated transport errors', async () => {
  const token = 'private-token-never-print'
  const config = { repository: 'g-dxw/ebao-studio', token }
  const requests = []
  const api = createGitcodeApi(config, async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ id: 1 }), { status: 200 })
  })
  assert.deepEqual(await api('releases', { name: 'release' }), { id: 1 })
  assert.equal(requests[0].options.headers['PRIVATE-TOKEN'], token)
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.redirect, 'error')
  assert.ok(!requests[0].url.includes(token))
  assert.ok(!requests[0].options.body.includes(token))
  const notFound = createGitcodeApi(config, async () => new Response(token, { status: 404 }))
  assert.equal(await notFound('releases/tags/v1.2.3', undefined, true), null)
  for (const fetchImpl of [
    async () => { throw new Error(`Server leaked ${token}`) },
    async () => new Response(`Server leaked ${token}`, { status: 403 }),
  ]) {
    const failing = createGitcodeApi(config, fetchImpl)
    await assert.rejects(failing('releases/v1.2.3/upload_url?signature=sensitive-query'), error => {
      assert.doesNotMatch(error.message, /private-token-never-print|sensitive-query|Server leaked/u)
      assert.match(error.message, /GitCode API/u)
      return true
    })
  }
})

test('public asset verification streams bytes without authentication and detects oversized downloads', async () => {
  const chunks = [Buffer.from('verified-'), Buffer.from('public-'), Buffer.from('download')]
  const bytes = Buffer.concat(chunks)
  const asset = { name: names[0], size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }))
  }
  assert.deepEqual(await anonymousAssetDigest('g-dxw/ebao-studio', tag, asset, fetchImpl), {
    size: asset.size, digest: asset.digest,
  })
  assert.equal(request.url, `https://gitcode.com/g-dxw/ebao-studio/releases/download/${tag}/${asset.name}`)
  assert.equal(request.options.redirect, 'follow')
  assert.ok(!request.options.headers)
  await assert.rejects(anonymousAssetDigest('g-dxw/ebao-studio', tag, { ...asset, size: 1 }, fetchImpl), /exceeds verified size/u)
  await assert.rejects(anonymousAssetDigest('g-dxw/ebao-studio', tag, asset, async () => new Response('sensitive-error-body', { status: 403 })), error => {
    assert.doesNotMatch(error.message, /sensitive-error-body/u)
    assert.match(error.message, /HTTP 403/u)
    return true
  })
})

test('signed upload uses only returned headers, refuses redirects and redacts signed URL errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ebao-gitcode-transport-test-'))
  try {
    const bytes = Buffer.from('verified-upload')
    const asset = { name: names[0], path: join(directory, names[0]), size: bytes.length }
    await writeFile(asset.path, bytes)
    const signedUrl = 'https://storage.example.test/upload?signature=never-print-this'
    const api = async endpoint => {
      assert.equal(endpoint, `releases/${tag}/upload_url?file_name=${asset.name}`)
      return { url: signedUrl, headers: { 'X-Signed-Header': 'signed-header-value' } }
    }
    let request
    await uploadGitcodeAsset(api, tag, asset, async (url, options) => {
      request = { url: url.toString(), options }
      const sent = []
      for await (const chunk of options.body) sent.push(chunk)
      assert.deepEqual(Buffer.concat(sent), bytes)
      return new Response('accepted')
    })
    assert.equal(request.url, signedUrl)
    assert.equal(request.options.method, 'PUT')
    assert.equal(request.options.redirect, 'error')
    assert.deepEqual(request.options.headers, { 'X-Signed-Header': 'signed-header-value', 'Content-Length': String(bytes.length) })
    for (const fetchImpl of [
      async (url, options) => { for await (const chunk of options.body) void chunk; throw new Error(signedUrl) },
      async (url, options) => { for await (const chunk of options.body) void chunk; return new Response(signedUrl, { status: 403 }) },
    ]) {
      await assert.rejects(uploadGitcodeAsset(api, tag, asset, fetchImpl), error => {
        assert.doesNotMatch(error.message, /never-print-this|storage\.example\.test/u)
        assert.match(error.message, /attachment upload/u)
        return true
      })
    }
    let uploaded = false
    await assert.rejects(uploadGitcodeAsset(api, tag, { ...asset, size: bytes.length + 1 }, async () => { uploaded = true }), /Local asset changed/u)
    await assert.rejects(uploadGitcodeAsset(async () => ({ url: 'http://storage.example.test/upload', headers: {} }), tag, asset, async () => { uploaded = true }), /invalid signed upload target/u)
    assert.equal(uploaded, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const rangeSegmentBytes = 16 * 1024 * 1024
const rangeBlockBytes = 64 * 1024

function rangePayload() {
  const blocks = Array.from({ length: 8 }, (value, index) => Buffer.alloc(rangeBlockBytes, index + 1))
  const tail = Buffer.from('tail!')
  function* segment(index, length = index === 8 ? tail.length : rangeSegmentBytes) {
    const block = index === 8 ? tail : blocks[index]
    for (let remaining = length; remaining > 0; remaining -= block.length) {
      yield remaining >= block.length ? block : block.subarray(0, remaining)
    }
  }
  function* whole() {
    for (let index = 0; index <= 8; index += 1) yield* segment(index)
  }
  const hash = createHash('sha256')
  for (const bytes of whole()) hash.update(bytes)
  const asset = { name: names[0], size: 8 * rangeSegmentBytes + tail.length, digest: `sha256:${hash.digest('hex')}` }
  return { asset, segment, whole }
}

test('large public downloads verify parallel byte ranges in file order without credentials', async () => {
  const payload = rangePayload()
  const requests = []
  const completion = []
  let active = 0
  let maxActive = 0
  const actual = await anonymousAssetDigest('g-dxw/ebao-studio', tag, payload.asset, async (url, options) => {
    assert.equal(url, `https://gitcode.com/g-dxw/ebao-studio/releases/download/${tag}/${payload.asset.name}`)
    assert.equal(options.redirect, 'follow')
    const match = /^bytes=([0-9]+)-([0-9]+)$/u.exec(options.headers?.Range)
    assert.ok(match)
    assert.deepEqual(Object.keys(options.headers), ['Range'])
    const start = Number(match[1])
    const end = Number(match[2])
    const index = start / rangeSegmentBytes
    requests.push({ start, end })
    active += 1
    maxActive = Math.max(maxActive, active)
    // Later ranges respond sooner, forcing completion order to differ from file order.
    if (index) await new Promise(resolve => setTimeout(resolve, (9 - index) * 3))
    return {
      ok: true, status: 206, headers: new Headers({ 'Content-Range': `bytes ${start}-${end}/${payload.asset.size}` }),
      body: (async function* () {
        try { yield* payload.segment(index) }
        finally { active -= 1; completion.push(index) }
      })(),
    }
  })
  assert.deepEqual(actual, { size: payload.asset.size, digest: payload.asset.digest })
  assert.equal(maxActive, 8)
  assert.notDeepEqual(completion, [...completion].sort((left, right) => left - right))
  assert.deepEqual(requests, Array.from({ length: 9 }, (value, index) => ({
    start: index * rangeSegmentBytes, end: Math.min(payload.asset.size - 1, (index + 1) * rangeSegmentBytes - 1),
  })))
})

test('large download rejects wrong range offsets/totals and truncated or oversized range bodies', async () => {
  const payload = rangePayload()
  const expectedRange = `bytes 0-${rangeSegmentBytes - 1}/${payload.asset.size}`
  for (const [contentRange, body, errorPattern] of [
    [`bytes 1-${rangeSegmentBytes - 1}/${payload.asset.size}`, [], /unexpected byte range/u],
    [`bytes 0-${rangeSegmentBytes - 2}/${payload.asset.size}`, [], /unexpected byte range/u],
    [`bytes 0-${rangeSegmentBytes - 1}/${payload.asset.size + 1}`, [], /unexpected byte range/u],
    [expectedRange, [Buffer.from('short')], /incomplete byte range/u],
    [expectedRange, (function* () { yield* payload.segment(0); yield Buffer.from('extra') })(), /exceeds requested range/u],
  ]) {
    await assert.rejects(anonymousAssetDigest('g-dxw/ebao-studio', tag, payload.asset, async () => ({
      ok: true, status: 206, headers: new Headers({ 'Content-Range': contentRange }), body,
    })), errorPattern)
  }
})

test('large download falls back to a single verified full stream when the CDN ignores Range', async () => {
  const payload = rangePayload()
  let requests = 0
  const actual = await anonymousAssetDigest('g-dxw/ebao-studio', tag, payload.asset, async (url, options) => {
    requests += 1
    assert.deepEqual(options.headers, { Range: `bytes=0-${rangeSegmentBytes - 1}` })
    return { ok: true, status: 200, headers: new Headers(), body: payload.whole() }
  })
  assert.equal(requests, 1)
  assert.deepEqual(actual, { size: payload.asset.size, digest: payload.asset.digest })
})
