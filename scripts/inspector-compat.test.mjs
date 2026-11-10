/** Exercise the installed official DevTools reload path without Electron or a Host. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// `check:layout` can run before dependencies are installed.
// Without an install there is neither TypeScript nor the inspector package to read, so skip there.
function loadTypeScript() {
  try {
    return createRequire(resolve('dsh-plugin-desktop-beta/package.json'))('typescript')
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'typescript'")) return undefined
    throw error
  }
}
const ts = loadTypeScript()
const skip = ts === undefined && 'typescript is not installed; run `corepack yarn install` to exercise the official inspector'

function nodes(file, predicate) {
  const matches = []
  const visit = node => {
    if (predicate(node)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return matches
}

// Each workspace follows its own upstream.json channel runtime.
const { channels } = JSON.parse(readFileSync(resolve('upstream.json'), 'utf8'))
const workspaceVersions = Object.fromEntries(['stable', 'beta', 'next'].map(channel => [
  channels[channel].package, channels[channel].runtimePackageVersion,
]))

for (const [workspace, version] of Object.entries(workspaceVersions)) {
  test(`${workspace}: official Reload DevTools completes through the hosted embedder callback`, { skip }, () => {
    const require = createRequire(resolve(workspace, 'package.json'))
    const manifest = require.resolve('@deepseek-ai/dsh-experimental-inspector/package.json')
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, version)
    const directory = join(dirname(manifest), 'lib/devtools/chunks')
    // Rebuilds may move DevTools' Reload module between the common and legacy chunks.
    // Find the embedder contract itself rather than depending on a content hash or chunk name.
    const chunks = readdirSync(directory).filter(name => name.endsWith('.js'))
      .map(name => ({ name, source: readFileSync(join(directory, name), 'utf8') }))
      .filter(({ source }) => source.includes('reattach('))
      .map(({ name, source }) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS))
    const methods = chunks.flatMap(file => nodes(file, node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'reattach')
      .map(node => ({ node, file })))
    assert.equal(methods.length, 1)
    // Use the installed method itself, not a fixture reproducing the patch.
    const host = runInNewContext(`({ ${methods[0].node.getText(methods[0].file)} })`)
    let completions = 0
    host.reattach(() => { completions++ })
    assert.equal(completions, 1)

    const calls = chunks.flatMap(file => nodes(file, node => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'reattach'
      && node.arguments.length === 1 && node.arguments[0].getText(file).includes('window.location.reload()'))
      .map(node => ({ node, file })))
    assert.ok(calls.length > 0, 'Official Reload DevTools must still use the expected embedder contract')
    for (const { node, file } of calls) {
      const receiver = node.expression.expression
      assert.ok(ts.isIdentifier(receiver))
      let reloads = 0
      runInNewContext(node.getText(file), {
        [receiver.text]: host, window: { location: { reload() { reloads++ } } },
      })
      assert.equal(reloads, 1, `Clicking reload through ${file.fileName} must reload the frontend document`)
    }

  })
}
