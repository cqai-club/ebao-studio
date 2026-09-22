import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'matrixmedia-publisher')
const metadataPath = join(root, 'vendor', 'matrixmedia', 'publisher-worker.json')

function fail(message) {
  throw new Error(`publisher source verification failed: ${message}`)
}

if (!existsSync(metadataPath)) fail('vendor/matrixmedia/publisher-worker.json is missing')
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
if (!existsSync(join(source, '.git'))) fail('run git submodule update --init --recursive matrixmedia-publisher')

const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (commit !== metadata.commit) fail(`submodule is ${commit}, expected ${metadata.commit}`)

const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
if (manifest.version !== metadata.version) fail(`MatrixMedia version is ${manifest.version}, expected ${metadata.version}`)
if (manifest.license !== metadata.license) fail(`MatrixMedia license is ${manifest.license}, expected ${metadata.license}`)
if (manifest.scripts?.['build:publisher-worker:universal'] !== metadata.buildScript) {
  fail('Publisher Worker build command drifted from the source declaration')
}

for (const entry of [
  'LICENSE',
  'docs/publisher-worker.md',
  'electron-builder.publisher.yml',
  'src/main/publisher-worker/index.js',
  'src/main/publisher-worker/protocol.js',
  'src/main/publisher-worker/service.js',
]) {
  if (!existsSync(join(source, entry))) fail(`submodule is missing ${entry}`)
}

const license = readFileSync(join(source, 'LICENSE'))
const digest = createHash('sha256').update(license).digest('hex')
if (digest !== metadata.licenseSha256) fail(`MatrixMedia LICENSE digest is ${digest}, expected ${metadata.licenseSha256}`)

const modules = readFileSync(join(root, '.gitmodules'), 'utf8')
if (!modules.includes(`url = ${metadata.repository}`)) fail('.gitmodules does not use the declared public source URL')
if (!modules.includes(`branch = ${metadata.branch}`)) fail('.gitmodules does not record the declared Worker branch')

process.stdout.write(`publisher source verified: MatrixMedia ${metadata.version} @ ${commit}\n`)
