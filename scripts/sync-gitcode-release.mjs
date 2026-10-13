#!/usr/bin/env node
/** Mirror verified eBao GitHub release bytes to GitCode without rebuilding. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { provenanceMessage } from './release-flow.mjs'
import { expectedReleaseAssets, verifyReleaseAssets } from './verify-release-assets.mjs'

const exec = promisify(execFile)
const SOURCE_REPOSITORY = 'cqai-club/ebao-studio'
const TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const SHA = /^[a-f0-9]{40}$/u
const DIGEST = /^sha256:[a-f0-9]{64}$/u

export function gitcodeConfig(env) {
  if (!env.GITCODE_TOKEN?.trim()) throw new Error('Missing GITCODE_TOKEN; configure the GitHub Actions repository secret')
  const repository = env.GITCODE_REPOSITORY || 'g-dxw/ebao-studio'
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repository)
    || repository.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GITCODE_REPOSITORY: expected owner/repo')
  const sourceRepository = env.SOURCE_REPOSITORY || env.GITHUB_REPOSITORY || SOURCE_REPOSITORY
  if (sourceRepository !== SOURCE_REPOSITORY) throw new Error('Only the official eBao GitHub repository may be mirrored')
  if (!TAG.test(env.RELEASE_TAG || '')) throw new Error('RELEASE_TAG must be canonical vMAJOR.MINOR.PATCH')
  return { repository, sourceRepository, token: env.GITCODE_TOKEN, tag: env.RELEASE_TAG }
}

export function validateMirrorSource(source) {
  if (source.repository !== SOURCE_REPOSITORY || !TAG.test(source.tag || '') || !SHA.test(source.sha || '')) {
    throw new Error('Invalid source repository, tag or packaged commit SHA')
  }
  // eBao currently publishes verified prereleases, including unsigned test builds.
  // Never promote one to latest or change GitCode's stable channel implicitly.
  if (source.prerelease !== true) throw new Error('Only verified eBao prereleases are supported by this mirror')
  if (typeof source.name !== 'string' || !source.name || typeof source.body !== 'string') throw new Error('Missing source release title or body')
  const expected = [...expectedReleaseAssets(source.tag.slice(1)), 'latest.yml', 'latest-mac.yml', 'SHA256SUMS'].sort()
  if (!Array.isArray(source.assets)) throw new Error('Missing source assets')
  const names = source.assets.map(asset => asset.name).sort()
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) throw new Error('Source release must contain exactly the seven verified assets')
  for (const asset of source.assets) {
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !DIGEST.test(asset.digest || '')) {
      throw new Error(`Invalid asset size or SHA-256 digest: ${asset.name}`)
    }
  }
}

export function assertSourceProvenance(release, annotatedTag) {
  if (release.draft || !TAG.test(release.tag_name || '')) throw new Error('Source release must be published with a canonical version tag')
  const match = /<!-- ebao-release-provenance\n([\s\S]*?)\n-->/u.exec(release.body || '')
  if (!match || annotatedTag.object?.type !== 'commit') throw new Error('Source release lacks annotated packaging provenance')
  const provenance = JSON.parse(match[1])
  if (provenanceMessage(provenance) !== provenanceMessage(JSON.parse(annotatedTag.message))
    || provenance.schema !== 1 || provenance.repository !== SOURCE_REPOSITORY
    || provenance.tag !== release.tag_name || provenance.sha !== annotatedTag.object.sha
    || !SHA.test(provenance.sha || '')) throw new Error('Source release and annotated tag provenance differ')
  if (!Array.isArray(release.assets) || Object.keys(provenance.assets || {}).length !== release.assets.length
    || release.assets.some(asset => !DIGEST.test(asset.digest || '') || provenance.assets[asset.name] !== asset.digest)) {
    throw new Error('GitHub assets differ from verified packaging provenance')
  }
  return provenance
}

export function mirrorMarker(source) {
  return `<!-- ebao-gitcode-mirror\n${provenanceMessage({
    schema: 1, repository: source.repository, tag: source.tag, sha: source.sha,
    assets: Object.fromEntries([...source.assets].sort((a, b) => a.name.localeCompare(b.name)).map(asset => [asset.name, { size: asset.size, digest: asset.digest }])),
  })}\n-->`
}

function assertDownloaded(asset, downloaded) {
  if (downloaded.size !== asset.size || downloaded.digest !== asset.digest) throw new Error(`GitCode download conflicts with verified bytes: ${asset.name}`)
}

// Injected I/O makes retry, conflict and partial-upload tests entirely local.
export async function mirrorVerifiedRelease(source, api, upload, verifyDownload) {
  validateMirrorSource(source)
  const marker = mirrorMarker(source)
  const endpoint = `releases/tags/${encodeURIComponent(source.tag)}`
  const body = `${source.body}\n\nGitHub 原始版本：[${source.tag}](https://github.com/${source.repository}/releases/tag/${source.tag})\n\n${marker}`
  let release = await api(endpoint, undefined, true)
  if (release) {
    if (release.tag_name !== source.tag || release.target_commitish !== source.sha || !release.body?.includes(marker)) throw new Error('Existing GitCode release is not owned by these verified source bytes')
    if (release.release_status !== 'pre') throw new Error('Existing GitCode release has a conflicting publication status')
  } else {
    release = await api('releases', {
      tag_name: source.tag, target_commitish: source.sha, name: source.name,
      body: `附件同步中，请等待校验完成后下载。 / Asset synchronization is in progress.\n\n${marker}`,
      release_status: 'pre',
    })
  }
  if (release.tag_name !== source.tag || release.target_commitish !== source.sha
    || release.release_status !== 'pre' || !release.body?.includes(marker)) {
    throw new Error('GitCode did not retain the expected tag, commit, ownership or prerelease status')
  }
  // Verify every present name before uploading anything; never delete/overwrite
  // conflicting bytes, existing tags or unrelated user attachments.
  if (!Array.isArray(release.assets)) throw new Error('GitCode returned an invalid asset list')
  const present = new Set()
  for (const asset of source.assets) {
    const matches = release.assets.filter(entry => entry.name === asset.name)
    if (matches.length > 1) throw new Error(`Duplicate GitCode asset name: ${asset.name}`)
    if (matches.length) {
      assertDownloaded(asset, await verifyDownload(source.tag, asset))
      present.add(asset.name)
    }
  }
  for (const asset of [...source.assets].sort((a, b) => b.size - a.size)) {
    if (present.has(asset.name)) continue
    await upload(source.tag, asset)
    assertDownloaded(asset, await verifyDownload(source.tag, asset))
    console.log(`Uploaded and anonymously verified ${asset.name} (${asset.size} bytes)`)
  }
  const final = await api(endpoint)
  if (!Array.isArray(final?.assets) || source.assets.some(asset => final.assets.filter(entry => entry.name === asset.name).length !== 1)) throw new Error('GitCode attachment inventory is incomplete after upload')
  if (final.tag_name !== source.tag || final.target_commitish !== source.sha || final.release_status !== 'pre'
    || !final.body?.includes(marker)) throw new Error('GitCode release changed during synchronization')
  if (final.body !== body || final.name !== source.name) {
    await api(`releases/${encodeURIComponent(source.tag)}`, {
      tag_name: source.tag, name: source.name, body, release_status: 'pre',
    }, false, 'PATCH')
  }
  return { tag: source.tag, assets: source.assets.length }
}

export function createGitcodeApi({ repository, token }, fetchImpl = fetch) {
  const base = `https://api.gitcode.com/api/v5/repos/${repository.split('/').map(encodeURIComponent).join('/')}/`
  return async (endpoint, body, allow404 = false, method) => {
    let response
    try {
      response = await fetchImpl(`${base}${endpoint}`, {
        method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'error',
        headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      // Neither authenticated URLs nor presigned storage URLs enter error logs.
      throw new Error(`GitCode API network failure at ${endpoint.split('?')[0]}`)
    }
    if (allow404 && response.status === 404) return null
    if (!response.ok) throw new Error(`GitCode API HTTP ${response.status} at ${endpoint.split('?')[0]}`)
    return response.status === 204 ? null : response.json()
  }
}

export async function anonymousAssetDigest(repository, tag, asset, fetchImpl = fetch) {
  const url = `https://gitcode.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`
  const hash = createHash('sha256')
  let size = 0
  const request = async range => {
    let response
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(30 * 60_000), redirect: 'follow',
        ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
      })
    } catch { throw new Error(`Anonymous GitCode download network failure: ${asset.name}`) }
    if (!response.ok || !response.body) throw new Error(`Anonymous GitCode download HTTP ${response.status}: ${asset.name}`)
    return response
  }
  const consume = async response => {
    for await (const bytes of response.body) {
      size += bytes.length
      if (size > asset.size) throw new Error(`Anonymous GitCode download exceeds verified size: ${asset.name}`)
      hash.update(bytes)
    }
  }
  // Bound memory to eight 16 MiB segments. Verify range offsets/total size and
  // hash segments in file order, so concurrency cannot conceal missing bytes.
  if (asset.size > 128 * 1024 * 1024) {
    const chunkSize = 16 * 1024 * 1024
    const readRange = async (range, response) => {
      response ||= await request(range)
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${range.start}-${range.end}/${asset.size}`) throw new Error(`Anonymous GitCode download returned an unexpected byte range: ${asset.name}`)
      const chunks = []
      let length = 0
      for await (const bytes of response.body) {
        length += bytes.length
        if (length > range.end - range.start + 1) throw new Error(`Anonymous GitCode download exceeds requested range: ${asset.name}`)
        chunks.push(bytes)
      }
      if (length !== range.end - range.start + 1) throw new Error(`Anonymous GitCode download returned an incomplete byte range: ${asset.name}`)
      return chunks
    }
    const firstRange = { start: 0, end: chunkSize - 1 }
    const first = await request(firstRange)
    if (first.status === 200) {
      await consume(first) // CDN without Range support: verify its full response.
    } else {
      for (const bytes of await readRange(firstRange, first)) { hash.update(bytes); size += bytes.length }
      for (let start = chunkSize; start < asset.size; start += 8 * chunkSize) {
        const ranges = Array.from({ length: Math.min(8, Math.ceil((asset.size - start) / chunkSize)) }, (_, index) => ({
          start: start + index * chunkSize, end: Math.min(asset.size - 1, start + (index + 1) * chunkSize - 1),
        }))
        const results = await Promise.all(ranges.map(range => readRange(range)))
        for (const chunks of results) for (const bytes of chunks) { hash.update(bytes); size += bytes.length }
      }
    }
  } else {
    await consume(await request())
  }
  return { size, digest: `sha256:${hash.digest('hex')}` }
}

export async function uploadGitcodeAsset(api, tag, asset, fetchImpl = fetch) {
  if (!asset.path) throw new Error(`Missing verified local asset: ${asset.name}`)
  const signed = await api(`releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(asset.name)}`)
  let url
  try { url = new URL(signed.url) } catch { throw new Error('GitCode returned an invalid upload URL') }
  if (url.protocol !== 'https:' || url.username || url.password || !signed.headers || typeof signed.headers !== 'object') throw new Error('GitCode returned an invalid signed upload target')
  const file = await stat(asset.path)
  if (!file.isFile() || file.size !== asset.size) throw new Error(`Local asset changed before upload: ${asset.name}`)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'PUT', redirect: 'error', duplex: 'half',
      headers: { ...signed.headers, 'Content-Length': String(asset.size) },
      body: createReadStream(asset.path), signal: AbortSignal.timeout(30 * 60_000),
    })
  } catch { throw new Error(`GitCode attachment upload network failure: ${asset.name}; rerun to check whether it completed`) }
  if (!response.ok) throw new Error(`GitCode attachment upload HTTP ${response.status}: ${asset.name}; rerun to check whether it completed`)
  // Consume the callback response; it must not be printed (signed storage data).
  await response.arrayBuffer()
}

async function githubApi(repository, endpoint) {
  const { stdout } = await exec('gh', ['api', `repos/${repository}/${endpoint}`], { maxBuffer: 2 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function localDigest(path) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return `sha256:${hash.digest('hex')}`
}

export async function main(env = process.env) {
  const config = gitcodeConfig(env)
  const release = await githubApi(config.sourceRepository, `releases/tags/${config.tag}`)
  const ref = await githubApi(config.sourceRepository, `git/ref/tags/${config.tag}`)
  if (ref.object?.type !== 'tag') throw new Error('Source tag must have annotated packaging provenance')
  const tag = await githubApi(config.sourceRepository, `git/tags/${ref.object.sha}`)
  const provenance = assertSourceProvenance(release, tag)
  const source = {
    repository: config.sourceRepository, tag: config.tag, sha: provenance.sha,
    name: release.name, body: release.body, prerelease: release.prerelease,
    assets: release.assets.map(asset => ({ name: asset.name, size: asset.size, digest: asset.digest })),
  }
  validateMirrorSource(source)
  const api = createGitcodeApi(config)
  const target = await api('')
  if (target.private !== false) throw new Error('GitCode target must be a public repository for anonymous distribution')
  const directory = await mkdtemp(join(tmpdir(), 'ebao-gitcode-release-'))
  try {
    console.log(`Downloading and checking ${config.tag} from GitHub (${source.assets.reduce((sum, asset) => sum + asset.size, 0)} bytes)`)
    await exec('gh', ['release', 'download', config.tag, '--repo', config.sourceRepository, '--dir', directory], { maxBuffer: 1024 * 1024 })
    await verifyReleaseAssets(directory, config.tag.slice(1))
    for (const asset of source.assets) {
      asset.path = join(directory, asset.name)
      if ((await stat(asset.path)).size !== asset.size || await localDigest(asset.path) !== asset.digest) throw new Error(`Downloaded GitHub asset differs from provenance: ${asset.name}`)
    }
    await mirrorVerifiedRelease(source, api,
      (tagName, asset) => uploadGitcodeAsset(api, tagName, asset),
      (tagName, asset) => anonymousAssetDigest(config.repository, tagName, asset))
    console.log(`Verified GitCode mirror: https://gitcode.com/${config.repository}/releases/tag/${config.tag}`)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
