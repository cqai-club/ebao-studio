#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { verifyReleaseAssets } from './verify-release-assets.mjs'

export function assertIntegration(event, repository) {
  if (event.pull_request?.base.ref !== 'master') return
  const pr = event.pull_request
  if (pr.head.ref !== 'dev' || pr.head.repo?.full_name !== repository) {
    throw new Error('Changes must enter dev first; only this repository dev may promote to master')
  }
}

export function releaseIdentity(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/master') {
    throw new Error('Release must be manually dispatched from master')
  }
  if (!/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(env.RELEASE_TAG ?? '')) {
    throw new Error('Release tag must be canonical vMAJOR.MINOR.PATCH')
  }
  if (!/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '') || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? '')) {
    throw new Error('Missing dispatch SHA or run ID')
  }
  return {
    schema: 1, repository: env.GITHUB_REPOSITORY, tag: env.RELEASE_TAG,
    sha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
    runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    macosMode: env.MACOS_UNSIGNED_TEST === 'true' ? 'unsigned-test' : 'signed',
  }
}

export function assertVersions(identity, stable, beta, index) {
  const version = identity.tag.slice(1)
  if (stable.version !== version || beta.version !== `${version}-beta.1`
    || index.channel !== 'stable' || index.version !== version) {
    throw new Error('Release tag must match Stable, Beta and release/desktop-version.json')
  }
}

// API dependency is injectable so failure/retry tests never mutate GitHub.
export async function assertPromotion(identity, api) {
  const comparison = await api(`compare/${identity.sha}...master`)
  if (!['identical', 'ahead'].includes(comparison.status)) throw new Error('Dispatch SHA is not on master')
  const prs = await api(`commits/${identity.sha}/pulls?per_page=100`)
  if (!prs.some(pr => pr.merged_at && pr.merge_commit_sha === identity.sha
    && pr.base.ref === 'master' && pr.head.ref === 'dev'
    && pr.head.repo?.full_name === identity.repository)) {
    throw new Error('Dispatch SHA must be the merged dev → master PR commit')
  }
}

export async function assertPackaging(identity, api) {
  const run = await api(`actions/runs/${identity.runId}`)
  if (run.head_sha !== identity.sha || run.head_branch !== 'master'
    || run.event !== 'workflow_dispatch' || run.path !== '.github/workflows/release.yml') {
    throw new Error('Packaging run does not match the dispatched master commit')
  }
  const { jobs, total_count } = await api(`actions/runs/${identity.runId}/jobs?filter=latest&per_page=100`)
  if (total_count > 100) throw new Error('Unexpected packaging job count')
  for (const name of ['verify', 'windows', 'macos']) {
    if (!jobs.some(job => job.name === name && job.conclusion === 'success')) {
      throw new Error(`Packaging job ${name} must succeed before tagging`)
    }
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

export function provenanceMessage(provenance) {
  return JSON.stringify(canonical(provenance), null, 2)
}

export async function ensureTag(provenance, api) {
  const existing = await api(`git/ref/tags/${provenance.tag}`, undefined, true)
  if (existing) {
    if (existing.object.type !== 'tag') throw new Error('Existing tag lacks packaging provenance')
    const tag = await api(`git/tags/${existing.object.sha}`)
    if (tag.object.type !== 'commit' || tag.object.sha !== provenance.sha
      || provenanceMessage(JSON.parse(tag.message)) !== provenanceMessage(provenance)) {
      throw new Error('Existing tag belongs to a different commit, run, mode or artifact set; never move it')
    }
    return
  }
  const tag = await api('git/tags', {
    tag: provenance.tag, message: provenanceMessage(provenance), object: provenance.sha, type: 'commit',
  })
  await api('git/refs', { ref: `refs/tags/${provenance.tag}`, sha: tag.sha })
}

export async function publishVerifiedRelease(provenance, notes, api, upload) {
  // Tag creation is the first mutation and only follows packaging + local validation.
  await ensureTag(provenance, api)
  const marker = `<!-- ebao-release-provenance\n${provenanceMessage(provenance)}\n-->`
  let release = await api(`releases/tags/${provenance.tag}`, undefined, true)
  // The by-tag endpoint is documented for published releases. Explicitly find
  // drafts as well, including a create request whose response was lost.
  if (!release) {
    for (let page = 1; ; page += 1) {
      const releases = await api(`releases?per_page=100&page=${page}`)
      release = releases.find(candidate => candidate.tag_name === provenance.tag)
      if (release || releases.length < 100) break
    }
  }
  if (release && (!release.prerelease || !release.body?.includes(marker))) {
    throw new Error('Existing release is not owned by this verified packaging run')
  }
  if (!release) {
    release = await api('releases', {
      tag_name: provenance.tag, target_commitish: provenance.sha,
      name: `e宝工坊 ${provenance.tag}${provenance.macosMode === 'unsigned-test' ? '（未签名 macOS 测试预发布）' : '（预发布）'}`,
      draft: true, prerelease: true,
      body: `${notes}\n\n打包提交：\`${provenance.sha}\`\n打包运行：[${provenance.runId}](${provenance.runUrl})\n\n${marker}`,
    })
  }
  let assets = await api(`releases/${release.id}/assets?per_page=100`)
  // GitHub may leave a zero-byte starter after an upload returns HTTP 502.
  // Remove only that failed placeholder in our owned draft, never valid bytes.
  for (const asset of assets) {
    if (release.draft && asset.state === 'starter' && asset.size === 0
      && !asset.digest && Object.hasOwn(provenance.assets, asset.name)) {
      await api(`releases/assets/${asset.id}`, {}, false, 'DELETE')
    }
  }
  assets = await api(`releases/${release.id}/assets?per_page=100`)
  for (const asset of assets) {
    if (provenance.assets[asset.name] !== asset.digest) throw new Error(`Published asset conflicts with verified bytes: ${asset.name}`)
  }
  for (const name of Object.keys(provenance.assets)) {
    if (!assets.some(asset => asset.name === name)) await upload(provenance.tag, name)
  }
  const uploaded = await api(`releases/${release.id}/assets?per_page=100`)
  if (uploaded.length !== Object.keys(provenance.assets).length
    || uploaded.some(asset => provenance.assets[asset.name] !== asset.digest)) {
    throw new Error('Release assets do not match verified packaging; leave the release draft for retry')
  }
  if (release.draft) await api(`releases/${release.id}`, { draft: false }, false, 'PATCH')
}

function githubApi(repository) {
  return async (endpoint, body, allow404 = false, method) => {
    try {
      const args = ['api', `repos/${repository}/${endpoint}`]
      if (body !== undefined) args.push('--method', method ?? 'POST', '--input', '-')
      const output = execFileSync('gh', args, {
        encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return output.trim() ? JSON.parse(output) : null
    } catch (error) {
      if (allow404 && /\(HTTP 404\)/u.test(error.stderr?.toString() ?? '')) return null
      throw error
    }
  }
}

export async function assetDigests(directory) {
  const assets = {}
  for (const name of (await readdir(directory)).sort()) {
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(`${directory}/${name}`)) hash.update(bytes)
    assets[name] = `sha256:${hash.digest('hex')}`
  }
  return assets
}

async function main() {
  const command = process.argv[2]
  const env = process.env
  if (command === 'integration') {
    assertIntegration(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')), env.GITHUB_REPOSITORY)
    return
  }
  const identity = releaseIdentity(env)
  const api = githubApi(identity.repository)
  assertVersions(identity, ...['dsh-plugin-desktop/package.json', 'dsh-plugin-desktop-beta/package.json', 'release/desktop-version.json'].map(path => JSON.parse(readFileSync(path, 'utf8'))))
  await assertPromotion(identity, api)
  if (command === 'preflight') {
    // Fast refusal of existing tags from another run before expensive builds.
    const ref = await api(`git/ref/tags/${identity.tag}`, undefined, true)
    if (ref) {
      if (ref.object.type !== 'tag') throw new Error('Existing tag lacks packaging provenance')
      const tag = await api(`git/tags/${ref.object.sha}`)
      const recorded = JSON.parse(tag.message)
      for (const [key, value] of Object.entries(identity)) {
        if (recorded[key] !== value) throw new Error(`Existing tag differs at ${key}; rerun the original run or choose a new version`)
      }
      if (tag.object.type !== 'commit' || tag.object.sha !== identity.sha) throw new Error('Existing tag points at another commit')
    }
    // Release notes are versioned and reviewed in dev before promotion.
    readFileSync(`release/${identity.tag}.md`, 'utf8')
    return
  }
  if (command !== 'record' && command !== 'publish') throw new Error('Expected integration, preflight, record or publish')
  await assertPackaging(identity, api)
  await verifyReleaseAssets('release-assets', identity.tag.slice(1))
  const provenance = { ...identity, assets: await assetDigests('release-assets') }
  if (command === 'record') {
    writeFileSync('release-provenance.json', `${provenanceMessage(provenance)}\n`)
    return
  }
  if (provenanceMessage(JSON.parse(readFileSync('release-provenance.json', 'utf8'))) !== provenanceMessage(provenance)) {
    throw new Error('Artifacts changed since verified provenance was recorded')
  }
  const platformNote = identity.macosMode === 'unsigned-test'
    ? 'macOS 构件为未签名测试包，需手动授权打开，不作为生产自动更新构件。'
    : 'macOS 构件已使用 Developer ID 签名并完成 Apple 公证。'
  const notes = `${readFileSync(`release/${identity.tag}.md`, 'utf8')}\n\n${platformNote} Windows 构件尚未进行 Authenticode 签名。SHA256SUMS 和 Electron Updater 元数据用于验证传输完整性。`
  await publishVerifiedRelease(provenance, notes, api, async (tag, name) => {
    execFileSync('gh', ['release', 'upload', tag, `release-assets/${name}`, '--repo', identity.repository], { stdio: 'inherit' })
  })
  console.log(`Published ${identity.tag} at ${identity.sha}: ${identity.runUrl}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
