/** Verify that related plugin manifests target the pinned official DSH release. */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const expected = upstream.sourceVersion
const roots = ['cqai-dsh-plugins', 'dsh-community-market']
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const failures = []
const manifests = []

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'runtime' || entry.name === 'upstream') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (entry.isFile() && entry.name === 'package.json') manifests.push(path)
  }
}

for (const directory of roots) visit(join(root, directory))

for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  for (const section of dependencySections) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@deepseek-ai/dsh-') && name !== '@deepseek-ai/dsh') continue
      if (typeof specifier !== 'string' || specifier.startsWith('workspace:')) continue
      if (!specifier.includes(expected)) failures.push(`${path}: ${section}.${name} does not include ${expected}`)
      if (specifier.includes('0.2.2-rc.1')) failures.push(`${path}: ${section}.${name} still includes retired 0.2.2-rc.1`)
    }
  }
}

if (failures.length) {
  throw new Error(`verify-dsh-component-versions: ${failures.join('; ')}`)
}

process.stdout.write(`verify-dsh-component-versions: ${manifests.length} manifests target DSH ${expected}\n`)
