/** Verify that the only active desktop is the pristine, pinned official application. */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const run = (args, cwd = root) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const fail = message => { throw new Error(`verify-layout: ${message}`) }
const workspace = readJson('package.json')
const upstream = readJson('upstream.json')
const officialRoot = resolve(root, 'deepseek-harness')
const official = readJson('deepseek-harness/package.json')
const desktop = readJson('deepseek-harness/apps/desktop/package.json')

if (workspace.packageManager !== 'yarn@4.18.0') fail('the outer workspace must use Yarn 4.18.0')
if ((workspace.workspaces?.length ?? 0) !== 0) fail('e宝 integration workspaces are inactive during the pure-official phase')
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'resolutions']) {
  if (Object.keys(workspace[field] ?? {}).length) fail(`the official launcher must not carry a second runtime in ${field}`)
}
if (!/^pnpm@/u.test(official.packageManager) || official.packageManager !== upstream.packageManager) {
  fail('the official checkout must retain its pinned pnpm release')
}
if (upstream.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git') fail('the source must be the official Harness repository')
if (upstream.desktop?.path !== 'apps/desktop' || upstream.desktop.packageName !== '@deepseek-ai/dsh-desktop') {
  fail('the active application must be the official Desktop')
}
if (desktop.name !== upstream.desktop.packageName || desktop.version !== upstream.sourceVersion
  || official.version !== upstream.sourceVersion) fail('Desktop and Harness must use the recorded source version')
if (run(['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.url']) !== upstream.repository) {
  fail('the official submodule URL differs from upstream.json')
}
const [mode, object] = run(['ls-files', '--stage', '--', 'deepseek-harness']).split(/\s+/u)
if (mode !== '160000' || object !== upstream.commit) fail('the indexed submodule must match the recorded official commit')
if (run(['rev-parse', 'HEAD'], officialRoot) !== upstream.commit) fail('the checked-out official commit differs from upstream.json')
if (run(['status', '--porcelain'], officialRoot)) fail('the official source checkout contains local changes')
if (run(['remote', 'get-url', 'origin'], officialRoot) !== upstream.repository) fail('the official source remote differs from upstream.json')

for (const path of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-desktop-next', 'dsh-desktop-shared', 'desktop-upstream.json']) {
  if (existsSync(resolve(root, path))) fail(`the retired community Desktop path must not exist: ${path}`)
}
for (const [script, action] of Object.entries({
  dev: 'dev', start: 'start', build: 'build', typecheck: 'typecheck',
  'test:desktop': 'test', 'upstream:install': 'install', 'upstream:version': 'version',
  'upstream:prepare-electron': 'prepare:electron', 'upstream:repair-install': 'repair-install',
  'package:dir': 'package:dir', 'dist:mac:arm64': 'package:mac:arm64',
  'dist:mac:x64': 'package:mac:x64', 'dist:win': 'package:win:x64',
})) {
  if (workspace.scripts?.[script] !== `node scripts/official-desktop.mjs ${action}`) {
    fail(`${script} must delegate to the official Desktop launcher`)
  }
}
for (const script of Object.keys(workspace.scripts ?? {})) {
  if (/:beta|:next|^aa:|^market:/u.test(script)) fail(`retired community channel command remains active: ${script}`)
}
if (!/^nodeLinker:\s*node-modules\s*$/mu.test(readFileSync(resolve(root, '.yarnrc.yml'), 'utf8'))) {
  fail('the outer Yarn workspace must retain the node-modules linker')
}
process.stdout.write(`verify-layout: pristine official Desktop ${upstream.sourceVersion} at ${upstream.commit.slice(0, 10)}; community desktop retired\n`)
