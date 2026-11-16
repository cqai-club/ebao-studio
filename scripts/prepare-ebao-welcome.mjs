/** Compile an owned welcome presentation around the pinned official renderer, without changing its source. */
import { lstatSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_MARKER = '<img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />'
const MOUNT_MARKER = '<Welcome api={window.dshWelcome} />'
const SHELL_ASSETS = ['design-platform.css', 'brand-font.css', 'montserrat-regular.woff2',
  'montserrat-light.woff2', 'montserrat-medium.woff2', 'Montserrat-OFL.txt']
const OUTPUT_FILES = ['welcome.js', 'welcome.css', 'ebao-robot.webp', ...SHELL_ASSETS]

export const USAGE = `Usage: node scripts/prepare-ebao-welcome.mjs [--print-config]

Builds only the owned native welcome presentation using the pinned official Vite/React toolchain.
Writes ignored Desktop lib/welcome artifacts; tracked official sources and user data stay untouched.
Run after the official Desktop build, which replaces these generated files.
`

export function createWelcomePlan({ root = ROOT } = {}) {
  root = resolve(root)
  const official = join(root, 'deepseek-harness')
  const desktop = join(official, 'apps', 'desktop')
  return {
    root, official, desktop,
    source: join(root, 'integrations', 'ebao-desktop-welcome', 'src'),
    entry: join(desktop, 'src', 'client', 'welcome.tsx'),
    welcomePage: join(desktop, 'src', 'client', 'WelcomePage.tsx'),
    directory: join(desktop, 'lib', 'welcome'),
    shellAssets: join(official, 'packages', 'client', 'ui-theme', 'src', 'styles'),
    logo: join(root, 'cqai-dsh-plugins', 'cqai-dsh-plugin-desktop-presentation', 'assets', 'ebao-robot.webp'),
  }
}

function assertGeneratedDirectory(plan) {
  const suffix = relative(plan.desktop, plan.directory)
  if (!suffix.startsWith(`lib${sep}`) || isAbsolute(suffix) || suffix.split(sep).includes('..')) {
    throw new Error('Welcome output must remain inside the ignored official Desktop lib directory')
  }
  let current = plan.root
  for (const part of relative(plan.root, plan.directory).split(sep)) {
    current = join(current, part)
    const stat = lstatSync(current, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink() || (stat !== undefined && !stat.isDirectory())) {
      throw new Error(`Refusing a redirected or non-directory welcome output: ${current}`)
    }
  }
  for (const name of OUTPUT_FILES) {
    const path = join(plan.directory, name)
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat !== undefined && (!stat.isFile() || stat.isSymbolicLink())) {
      throw new Error(`Refusing a redirected or non-file welcome artifact: ${path}`)
    }
  }
}

function replaceExactlyOnce(source, marker, replacement, name) {
  if (source.split(marker).length !== 2) throw new Error(`Official welcome ${name} marker must occur exactly once; review the pinned upstream integration`)
  return source.replace(marker, replacement)
}

/** Transform only the presentation seams; all official handlers, mount and cleanup code remain upstream-owned. */
export function transformWelcomeSource(source, id, plan) {
  const path = resolve(id.split('?')[0])
  const sourceModule = name => join(plan.source, name).split(sep).join('/')
  if (path === plan.welcomePage) {
    return `import { EbaoBrand } from ${JSON.stringify(sourceModule('Brand.tsx'))}\n`
      + replaceExactlyOnce(source, BRAND_MARKER, '<EbaoBrand name={m.welcomeBrand} />', 'brand')
  }
  if (path === plan.entry) {
    return `import { createEbaoWelcomeApi } from ${JSON.stringify(sourceModule('presentation.mjs'))}\n`
      + `import ${JSON.stringify(sourceModule('welcome.css'))}\n`
      + replaceExactlyOnce(source, MOUNT_MARKER, '<Welcome api={createEbaoWelcomeApi(window.dshWelcome)} />', 'mount')
  }
  return null
}

async function officialToolchain(plan) {
  const require = createRequire(join(plan.desktop, 'package.json'))
  const vite = await import(pathToFileURL(require.resolve('vite')).href)
  return { build: vite.build, resolve: require.resolve }
}

/** Rebuild only generated welcome assets; this function is headless and never opens Desktop or a login flow. */
export async function buildWelcomePresentation(plan = createWelcomePlan(), { loadToolchain = officialToolchain } = {}) {
  assertGeneratedDirectory(plan)
  // Fail before compiler loading or writes if the upstream presentation seams drift.
  transformWelcomeSource(readFileSync(plan.welcomePage, 'utf8'), plan.welcomePage, plan)
  transformWelcomeSource(readFileSync(plan.entry, 'utf8'), plan.entry, plan)
  const assets = new Map(SHELL_ASSETS.map(name => [name, readFileSync(join(plan.shellAssets, name))]))
  assets.set('ebao-robot.webp', readFileSync(plan.logo))
  const toolchain = await loadToolchain(plan)
  const transformed = new Set()
  await toolchain.build({
    configFile: false,
    root: plan.desktop,
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{
      name: 'ebao-owned-native-welcome',
      enforce: 'pre',
      resolveId(id) {
        // Owned files deliberately have no outer Yarn workspace/dependency graph.
        if (id === 'react' || id.startsWith('react/') || id === 'react-dom' || id.startsWith('react-dom/')) return toolchain.resolve(id)
      },
      transform(source, id) {
        const code = transformWelcomeSource(source, id, plan)
        if (code === null) return null
        transformed.add(resolve(id.split('?')[0]))
        return { code, map: null }
      },
      generateBundle() {
        if (!transformed.has(plan.entry) || !transformed.has(plan.welcomePage)) throw new Error('Expected both official welcome presentation seams to be compiled')
        for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source })
      },
    }],
    build: {
      outDir: plan.directory,
      emptyOutDir: false,
      lib: { entry: plan.entry, formats: ['iife'], name: 'DesktopWelcome', fileName: () => 'welcome.js', cssFileName: 'welcome' },
    },
  })
  for (const name of OUTPUT_FILES) {
    if (!lstatSync(join(plan.directory, name), { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing generated welcome artifact: ${name}`)
  }
  return { directory: plan.directory, files: [...OUTPUT_FILES] }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(USAGE)
  else if (args.length === 1 && args[0] === '--print-config') console.log(JSON.stringify(createWelcomePlan(), null, 2))
  else if (args.length !== 0) { console.error(USAGE); process.exitCode = 1 }
  else {
    try { await buildWelcomePresentation() } catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
