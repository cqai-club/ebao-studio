/** Check account adapters against the declarations built by the pinned official SDK. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const upstream = join(root, 'deepseek-harness')
const fromOfficial = createRequire(join(upstream, 'node_modules/.pnpm/cqai-typecheck.cjs'))
const ts = fromOfficial('typescript')
const account = join(root, 'cqai-dsh-plugins/cqai-dsh-plugin-account/src')
const adapter = join(root, 'integrations/cqai-desktop-account/src')
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'client') return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}
const files = [...sources(account), ...sources(adapter)]
const paths = {
  '@cqaiclub/dsn-account': [join(account, 'index.ts')],
  '@cqaiclub/dsn-account/protocol': [join(account, 'protocol.ts')],
}
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2024 }
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const imports = ts.preProcessFile(text).importedFiles.map(item => item.fileName)
  for (const name of imports) {
    if (name.startsWith('.') || paths[name] !== undefined || name.startsWith('node:')) continue
    const result = ts.resolveModuleName(name, join(upstream, 'node_modules/.pnpm/cqai-typecheck.ts'), options, ts.sys).resolvedModule
    if (result !== undefined) paths[name] = [result.resolvedFileName]
  }
}
const config = join(root, '.official-desktop/checks/cqai-account.tsconfig.json')
mkdirSync(dirname(config), { recursive: true })
writeFileSync(config, `${JSON.stringify({
  compilerOptions: {
    target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler',
    lib: ['ES2024', 'DOM'], noEmit: true, strict: true, skipLibCheck: true,
    allowImportingTsExtensions: true, esModuleInterop: true,
    noUncheckedIndexedAccess: true,
    types: ['node'], typeRoots: [dirname(dirname(fromOfficial.resolve('@types/node/package.json')))],
    paths,
  },
  files,
}, null, 2)}\n`)
const result = spawnSync(process.execPath, [fromOfficial.resolve('typescript/bin/tsc'), '-p', config], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
