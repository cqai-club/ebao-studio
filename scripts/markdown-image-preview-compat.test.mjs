import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { generateMarkdownPreviewPatches, repositoryRoot } from './markdown-image-preview-compat.mjs'

function assertReviewedPatches(results) {
  assert.equal(results.length, 2)
  for (const result of results) {
    assert.equal(result.patch, readFileSync(join(repositoryRoot, result.path), 'utf8'), result.path)
    assert.equal(result.bytes, Buffer.byteLength(result.patch))
  }
}

test('real published artifacts generate the reviewed, byte-exact replayable patches', () => {
  assertReviewedPatches(generateMarkdownPreviewPatches())
})

test('inherited Windows CRLF settings cannot change generated patches or replay bytes', () => {
  const files = [
    'vendor/dsh-runtime/0.2.0-rc.2/deepseek-ai-dsh-client-ui-primitives-0.2.0-rc.2.tgz',
    'vendor/dsh-runtime/0.2.0-rc.2/deepseek-ai-dsh-web-frontend-0.2.0-rc.2.tgz',
    'patches/dsh-client-ui-primitives@0.2.0-rc.2.patch',
    'patches/dsh-web-frontend@0.2.0-rc.2.patch',
  ]
  const originals = files.map(file => readFileSync(join(repositoryRoot, file)))
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'core.eol', GIT_CONFIG_VALUE_1: 'crlf',
  }
  const script = new URL('./markdown-image-preview-compat.mjs', import.meta.url).href
  const code = `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { generateMarkdownPreviewPatches } from ${JSON.stringify(script)};
    assert.equal(execFileSync('git', ['config', '--get', 'core.autocrlf'], { encoding: 'utf8' }).trim(), 'true');
    assert.equal(execFileSync('git', ['config', '--get', 'core.eol'], { encoding: 'utf8' }).trim(), 'crlf');
    process.stdout.write(JSON.stringify(generateMarkdownPreviewPatches()));
  `
  const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: repositoryRoot, env, encoding: 'utf8', maxBuffer: 1024 * 1024,
  }))
  assertReviewedPatches(results)
  files.forEach((file, index) => assert.ok(readFileSync(join(repositoryRoot, file)).equals(originals[index]), `${file} must remain unchanged`))
})
