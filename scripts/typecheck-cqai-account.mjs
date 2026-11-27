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
function sources(directory, { browser = false } = {}) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (!browser && entry.name === 'client') return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path, { browser }) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}
function check(face, files, importsFrom = files) {
  const paths = {
    '@cqaiclub/dsn-account': [join(account, 'index.ts')],
    '@cqaiclub/dsn-account/protocol': [join(account, 'protocol.ts')],
  }
  const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2024 }
  const imports = new Set(importsFrom.flatMap(file => ts.preProcessFile(readFileSync(file, 'utf8')).importedFiles.map(item => item.fileName)))
  if (face === 'client') imports.add('react/jsx-runtime')
  for (const name of imports) {
    if (name.startsWith('.') || paths[name] !== undefined || name.startsWith('node:')) continue
    const result = ts.resolveModuleName(name, join(upstream, 'node_modules/.pnpm/cqai-typecheck.tsx'), options, ts.sys).resolvedModule
    if (result !== undefined) paths[name] = [result.resolvedFileName]
  }
  const config = join(root, `.official-desktop/checks/cqai-account.${face}.tsconfig.json`)
  const types = face === 'client' ? ['node', 'react'] : ['node']
  mkdirSync(dirname(config), { recursive: true })
  writeFileSync(config, `${JSON.stringify({
    compilerOptions: {
      target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler',
      lib: ['ES2024', 'DOM'], jsx: 'react-jsx', noEmit: true, strict: true, skipLibCheck: true,
      allowImportingTsExtensions: true, esModuleInterop: true,
      noUncheckedIndexedAccess: true, types,
      typeRoots: [...new Set(types.map(name => dirname(dirname(fromOfficial.resolve(`@types/${name}/package.json`)))))],
      paths,
    },
    files,
  }, null, 2)}\n`)
  const result = spawnSync(process.execPath, [fromOfficial.resolve('typescript/bin/tsc'), '-p', config], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

// The Host and browser Connection services augment Cordis independently.
// Check each against its own declaration graph.
const server = check('server', [...sources(account), ...sources(adapter)])
const clientSources = sources(join(adapter, 'client'), { browser: true })
const client = check('client', clientSources, [...clientSources, ...sources(join(account, 'client'), { browser: true })])
process.exitCode = server || client
