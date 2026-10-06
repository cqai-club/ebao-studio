#!/usr/bin/env node
/**
 * Resolve which CQAI plugin package and version the publish workflow should
 * release, and emit the job outputs GitHub Actions consumes.
 *
 * Two entry points feed this script through environment variables:
 *
 *   * a tag push named `plugin-<package-name>-v<MAJOR.MINOR.PATCH>` — the tag
 *     names both the package and the version, so it cannot publish the wrong
 *     artifact, and the package directory is discovered from the workspace
 *     rather than reconstructed from the tag.
 *   * a manual dispatch with an explicit `cqai-dsh-plugins/<directory>`,
 *     version, and rehearsal flag.
 *
 * Key=value lines go to stdout for `$GITHUB_OUTPUT`; human-readable progress
 * goes to stderr. Every rejection exits 1 with the reason, so a malformed tag
 * or an escaping path can never reach `npm publish`.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PLUGIN_ROOT = 'cqai-dsh-plugins'
const STABLE_EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const PLUGIN_DIRECTORY = new RegExp(`^${PLUGIN_ROOT}/[A-Za-z0-9._-]+$`, 'u')
const TAGGED_RELEASE = /^plugin-(.+)-v([0-9]+\.[0-9]+\.[0-9]+)$/u

/** Reject the request with a reason on stderr and a non-zero exit code. */
function fail(message) {
  process.stderr.write(`resolve-plugin-release: ${message}\n`)
  process.exit(1)
}

/** Read every `cqai-dsh-plugins/<directory>/package.json` by package name. */
function readWorkspacePackages(root = resolve(PLUGIN_ROOT)) {
  const packages = new Map()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(readFileSync(join(root, entry.name, 'package.json'), 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.length > 0) {
        packages.set(manifest.name, `${PLUGIN_ROOT}/${entry.name}`)
      }
    } catch {
      // A directory without a readable manifest is not a publishable plugin.
    }
  }
  return packages
}

const eventName = process.env.EVENT_NAME ?? ''
const tagName = process.env.TAG_NAME ?? ''

let pluginDir
let version
let dryRun

if (eventName === 'push') {
  const match = TAGGED_RELEASE.exec(tagName)
  if (match === null) {
    fail(`tag must look like plugin-<package-name>-vMAJOR.MINOR.PATCH, received ${JSON.stringify(tagName)}`)
  }
  const packageName = match[1]
  version = match[2]
  // A tag push is always a real release; rehearsals use workflow_dispatch.
  dryRun = false
  const workspacePackage = readWorkspacePackages().get(packageName)
  if (workspacePackage === undefined) {
    fail(`no ${PLUGIN_ROOT}/* package is named ${JSON.stringify(packageName)}`)
  }
  pluginDir = workspacePackage
} else {
  pluginDir = process.env.INPUT_PLUGIN ?? ''
  version = process.env.INPUT_VERSION ?? ''
  // An unset dispatch input is an empty string, which is not a rehearsal.
  dryRun = process.env.INPUT_DRY_RUN === 'true' || process.env.INPUT_DRY_RUN === true
}

if (!STABLE_EXACT_VERSION.test(version)) {
  fail(`version must be stable MAJOR.MINOR.PATCH SemVer, received ${JSON.stringify(version)}`)
}
if (!PLUGIN_DIRECTORY.test(pluginDir) || pluginDir.includes('..')) {
  fail(`plugin directory must be ${PLUGIN_ROOT}/<directory>, received ${JSON.stringify(pluginDir)}`)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
} catch (cause) {
  fail(`cannot read ${pluginDir}/package.json: ${cause instanceof Error ? cause.message : String(cause)}`)
}
if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  fail(`${pluginDir}/package.json does not declare a package name`)
}

process.stderr.write(`Resolved ${manifest.name}@${version} in ${pluginDir} (dry_run=${String(dryRun)})\n`)
process.stdout.write(`plugin_dir=${pluginDir}\n`)
process.stdout.write(`package_name=${manifest.name}\n`)
process.stdout.write(`version=${version}\n`)
process.stdout.write(`dry_run=${String(dryRun)}\n`)
