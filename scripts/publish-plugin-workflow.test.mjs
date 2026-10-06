/**
 * Guard the plugin publish workflow and the scripts it drives.
 *
 * Two failure modes are worth pinning, because both are silent until a release
 * is already underway:
 *
 *  1. The publish workflow stays well-formed and keeps the jobs, permissions,
 *     and trigger shapes the publish path depends on. Authoring this workflow
 *     already produced a colon in an unquoted scalar once, which is why the
 *     structural checks below run against the raw text.
 *  2. Every plugin package in the workspace is discoverable by the resolver,
 *     so a tag push can actually find its directory.
 *
 * The workflow is inspected as text rather than parsed as YAML: this workspace
 * does not install a YAML parser at the root, and a real parse is better left
 * to GitHub's own validation than to a hand-rolled subset.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = resolve(import.meta.dirname, '..')
const workflowPath = join(repoRoot, '.github', 'workflows', 'publish-plugin.yml')
const workflow = readFileSync(workflowPath, 'utf8')

/** Split the workflow into `key: value` step entries under a given job. */
function jobBlock(jobName) {
  const pattern = new RegExp(`^ {2}${jobName}:\\n([\\s\\S]*?)(?=^ {2}\\S|$(?![\\s\\S]))`, 'mu')
  const match = pattern.exec(workflow)
  assert.ok(match, `job ${jobName} must exist in the workflow`)
  return match[1]
}

describe('publish-plugin workflow', () => {
  it('quotes or blocks every value containing a colon', () => {
    // An unquoted `run: echo "Dry run: ..."` is invalid YAML: the colon reads
    // as a nested mapping. Catch that class of authoring error directly.
    const offenders = []
    let inBlockScalar = false
    let blockIndent = 0
    for (const [index, rawLine] of workflow.split('\n').entries()) {
      const line = rawLine.replace(/\s+$/u, '')
      if (line.trim() === '') continue
      const indent = line.length - line.trimStart().length
      if (inBlockScalar) {
        if (indent > blockIndent) continue
        inBlockScalar = false
      }
      const blockStart = /^(\s*)[\w.-]+:\s*[|>][-+]?\s*$/u.exec(line)
      if (blockStart !== null) {
        inBlockScalar = true
        blockIndent = blockStart[1].length
        continue
      }
      const inline = /^(\s*)[\w.-]+:\s+(\S.*)$/u.exec(line)
      if (inline === null) continue
      const value = inline[2]
      if (value.startsWith('"') || value.startsWith("'") || value.startsWith('#') || value.startsWith('|') || value.startsWith('>')) continue
      // A colon not followed by a space inside a scalar is legal (e.g. a URL).
      if (/:\s/u.test(value)) offenders.push(`${String(index + 1)}: ${line.trim()}`)
    }
    assert.deepEqual(offenders, [], `these lines need quoting:\n${offenders.join('\n')}`)
  })

  it('declares the tag trigger and the dispatch inputs', () => {
    assert.match(workflow, /^ {2}workflow_dispatch:/mu)
    assert.match(workflow, /^ {2}push:\n {4}tags:\n {6}- 'plugin-\*-v\*'/mu)
    for (const input of ['plugin:', 'version:', 'dry_run:']) {
      assert.ok(workflow.includes(`      ${input}`), `dispatch input ${input} must exist`)
    }
  })

  it('keeps the plan outputs the publish job consumes', () => {
    const plan = jobBlock('plan')
    for (const output of ['plugin_dir', 'package_name', 'version', 'dry_run']) {
      assert.match(plan, new RegExp(`^ {6}${output}:`, 'mu'), `plan must output ${output}`)
    }
    assert.match(jobBlock('publish'), /^ {4}needs: plan$/mu)
  })

  it('requests the permissions npm provenance needs', () => {
    const publish = jobBlock('publish')
    assert.match(publish, /^ {6}id-token: write$/mu)
    assert.match(publish, /^ {6}contents: read$/mu)
    assert.match(workflow, /^permissions:\n {2}contents: read$/mu)
  })

  it('delegates release resolution to the tested script', () => {
    const plan = jobBlock('plan')
    assert.match(plan, /^ {8}id: resolve$/mu)
    assert.match(plan, /resolve-plugin-release\.mjs/u)
    assert.match(plan, /GITHUB_OUTPUT/u)
  })

  it('gates publication on the verifier and blocks republishing', () => {
    const publish = jobBlock('publish')
    assert.match(publish, /verify-plugin-publish\.mjs/u, 'the verifier must run before publish')
    assert.match(publish, /npm view/u, 'an existing version must be detected')
    assert.match(publish, /npm publish --access public/u)
  })

  it('never publishes during a rehearsal', () => {
    const publish = jobBlock('publish')
    // Locate the step that runs `npm publish` and assert the condition sitting
    // directly above it inside the same step.
    const publishStep = /- name: Publish to npm\n(?: {8}.+\n)*?/u.exec(publish)
    assert.ok(publishStep, 'a Publish to npm step must exist')
    const block = publish.slice(publishStep.index)
    const condition = /^ {8}if: (.+)$/mu.exec(block)
    assert.ok(condition, 'the publish step must carry an if condition')
    assert.equal(condition[1], "needs.plan.outputs.dry_run != 'true'")
    assert.match(block, /NODE_AUTH_TOKEN/u)
  })
})

describe('workspace plugin discovery', () => {
  it('finds every publishable plugin manifest by package name', () => {
    const root = join(repoRoot, 'cqai-dsh-plugins')
    const discovered = new Map()
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const manifest = JSON.parse(readFileSync(join(root, entry.name, 'package.json'), 'utf8'))
        if (typeof manifest.name === 'string' && manifest.name.length > 0) {
          discovered.set(manifest.name, entry.name)
        }
      } catch {
        // Directories without a readable manifest are not publishable plugins.
      }
    }
    assert.ok(discovered.has('cqai-dsh-plugin-research'), 'e研宝 must be discoverable for a tag push')
    for (const [name, directory] of discovered) {
      assert.match(directory, /^[A-Za-z0-9._-]+$/u, `${name} must map to a tag-safe directory`)
    }
  })
})
