#!/usr/bin/env node
/** Fast-forward only: mirror reviewed development/release refs, never force. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const exec = promisify(execFile)
const SOURCE = 'cqai-club/ebao-studio'
const SHA = /^[a-f0-9]{40}$/u
const TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u

export function sourceSyncConfig(env) {
  if (!env.GITCODE_TOKEN?.trim()) throw new Error('Missing GITCODE_TOKEN; configure the GitHub Actions repository secret')
  const repository = env.GITCODE_REPOSITORY || 'g-dxw/ebao-studio'
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(repository)
    || repository.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GITCODE_REPOSITORY: expected owner/repo')
  if ((env.SOURCE_REPOSITORY || env.GITHUB_REPOSITORY || SOURCE) !== SOURCE) throw new Error('Only the official eBao GitHub repository may be mirrored')
  if (env.RELEASE_TAG && !TAG.test(env.RELEASE_TAG)) throw new Error('RELEASE_TAG must be canonical vMAJOR.MINOR.PATCH')
  return { repository, tag: env.RELEASE_TAG || '', token: env.GITCODE_TOKEN }
}

export function parseRemoteRefs(text) {
  const refs = {}
  for (const line of text.trim().split('\n').filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/u)
    if (!SHA.test(sha || '') || !ref?.startsWith('refs/')) throw new Error('Git returned invalid remote refs')
    refs[ref] = sha
  }
  return refs
}

export function plannedSourceUpdates(sourceRefs, remoteRefs) {
  const updates = []
  for (const [ref, sha] of Object.entries(sourceRefs)) {
    if (!SHA.test(sha) || !/^refs\/(?:heads\/(?:dev|master)|tags\/v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u.test(ref)) throw new Error('Invalid source ref for synchronization')
    if (remoteRefs[ref] === sha) continue
    if (ref.startsWith('refs/tags/') && remoteRefs[ref]) throw new Error(`Existing GitCode tag differs from GitHub; never move it: ${ref}`)
    updates.push({ ref, sha })
  }
  return updates
}

export async function main(env = process.env) {
  const config = sourceSyncConfig(env)
  const refs = ['refs/heads/dev', 'refs/heads/master', ...(config.tag ? [`refs/tags/${config.tag}`] : [])]
  const sourceUrl = `https://github.com/${SOURCE}.git`
  const targetUrl = `https://gitcode.com/${config.repository}.git`
  const directory = await mkdtemp(join(tmpdir(), 'ebao-gitcode-source-'))
  try {
    const askpass = join(directory, 'askpass.mjs')
    await writeFile(askpass, `#!${process.execPath}\nconst prompt = process.argv[2] || '';\nif (!prompt.includes('gitcode.com')) process.exit(1);\nprocess.stdout.write(prompt.startsWith('Username') ? process.env.GITCODE_OWNER : process.env.GITCODE_TOKEN);\n`, { mode: 0o700 })
    const gitEnv = { ...env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0', GITCODE_OWNER: config.repository.split('/')[0] }
    const git = async (args, cwd = directory) => {
      try {
        return (await exec('git', ['-c', 'credential.helper=', '-c', 'credential.useHttpPath=true', ...args], { cwd, env: gitEnv, maxBuffer: 1024 * 1024 })).stdout
      } catch { throw new Error(`GitCode source sync failed during ${args[0]}; check token permissions, branch protection and mirror repository settings`) }
    }
    const sourceRefs = parseRemoteRefs(await git(['ls-remote', '--refs', sourceUrl, ...refs]))
    if (refs.some(ref => !sourceRefs[ref])) throw new Error('A requested source branch/tag does not exist on GitHub')
    const remoteRefs = parseRemoteRefs(await git(['ls-remote', '--refs', targetUrl, ...refs]))
    const updates = plannedSourceUpdates(sourceRefs, remoteRefs)
    if (!updates.length) { console.log('GitCode dev/master/requested tag already match GitHub'); return }
    const checkout = join(directory, 'source.git')
    await git(['init', '--bare', checkout])
    await git(['fetch', '--no-tags', sourceUrl, ...refs.map(ref => `${ref}:${ref}`)], checkout)
    // Refuse races in the source repository instead of publishing a moving ref.
    for (const { ref, sha } of updates) {
      if ((await git(['rev-parse', ref], checkout)).trim() !== sha) throw new Error(`GitHub ref changed during synchronization; retry: ${ref}`)
      if (ref.startsWith('refs/heads/') && remoteRefs[ref]) {
        await git(['fetch', '--no-tags', targetUrl, remoteRefs[ref]], checkout)
        try { await git(['merge-base', '--is-ancestor', remoteRefs[ref], sha], checkout) }
        catch { throw new Error(`GitCode branch diverged or advanced beyond GitHub; refusing to overwrite: ${ref}`) }
      }
    }
    await git(['push', '--atomic', targetUrl, ...updates.map(({ ref, sha }) => `${sha}:${ref}`)], checkout)
    const final = parseRemoteRefs(await git(['ls-remote', '--refs', targetUrl, ...refs]))
    if (updates.some(({ ref, sha }) => final[ref] !== sha)) throw new Error('GitCode refs changed after synchronization')
    console.log(`Synchronized ${updates.map(({ ref }) => ref).join(', ')} to ${config.repository}`)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
