/** Install packaging hooks only in the unsigned e宝 Desktop build subprocesses. */
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const app = new URL('../deepseek-harness/apps/desktop/', import.meta.url)
const configUrl = new URL('electron-builder.config.mjs', app).href
const environmentUrl = new URL('scripts/desktop-package-environment.mjs', app).href
const smokeUrl = new URL('scripts/smoke-packaged-runtime.ts', app).href
const overridesUrl = new URL('./prepare-ebao-package.mjs', import.meta.url).href

export const PRODUCT_NAME = 'e宝工坊'
export const APP_ID = 'asia.cqaiclub.ebao-studio'

export function replacePackageSeam(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`Official Desktop package seam changed: ${marker}`)
  return source.replace(marker, () => replacement)
}

export function createEbaoPackageEnvironment(environment) {
  return {
    ...Object.fromEntries(Object.entries(environment).filter(([name]) => !/^(?:DSH_DESKTOP_(?:APP_ID|AUTO_UPDATE_ENV|MANDATORY_UPDATE_.*|WINDOWS_.*)|APPLE_.*|(?:WIN_)?CSC_.*|DOWNLOAD_(?:TEST|PROD)_.*)$/iu.test(name))),
    DSH_DESKTOP_APP_ID: APP_ID,
    // The pinned Windows preflight and builder require a syntactically valid origin even when unsigned.
    // The e宝 builder removes the unsigned policy from application metadata before packing.
    DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://github.com',
  }
}

export function packageSmokeSource(source) {
  for (const suffix of ['.app', '.exe', '']) {
    const literal = new RegExp(`(['"])DeepSeek Harness${suffix.replace('.', '\\.')}\\1`, 'u')
    const marker = source.match(literal)?.[0]
    if (marker === undefined) throw new Error(`Official Desktop smoke path changed: DeepSeek Harness${suffix}`)
    source = replacePackageSeam(source, marker, JSON.stringify(`${PRODUCT_NAME}${suffix}`))
  }
  return source
}

if (process.env.EBAO_DESKTOP_PACKAGE === '1') registerHooks({
  load(url, context, nextLoad) {
    if (url === configUrl) return {
      shortCircuit: true,
      format: 'module',
      source: `import { createElectronBuilderConfig } from './scripts/electron-builder-config.mjs';
import { createEbaoBuilderConfig } from ${JSON.stringify(overridesUrl)};
export default createEbaoBuilderConfig(createElectronBuilderConfig);`,
    }
    if (url === environmentUrl) {
      const source = readFileSync(new URL(url), 'utf8')
      const environment = replacePackageSeam(source, 'export function loadDesktopPackageEnvironment(', 'function loadDesktopPackageEnvironment(')
      return { shortCircuit: true, format: 'module', source: `${environment}
import { createEbaoPackageEnvironment } from ${JSON.stringify(import.meta.url)};
function loadEbaoPackageEnvironment(platform, environment = process.env, appRoot, options) {
  return platform === 'win32' && options?.unsigned ? createEbaoPackageEnvironment(environment)
    : loadDesktopPackageEnvironment(platform, environment, appRoot, options);
}
export { loadEbaoPackageEnvironment as loadDesktopPackageEnvironment };` }
    }
    const loaded = nextLoad(url, context)
    if (url !== smokeUrl) return loaded
    const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString()
    return { ...loaded, source: packageSmokeSource(source) }
  },
})
