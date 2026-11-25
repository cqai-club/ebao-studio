/** Apply e宝 native icons to the generated Electron entry for source launches. */
import { accessSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAC_ICON = 'app-macos.png'
const WINDOWS_ICON = 'app-windows.png'
const TRAY_ICON = 'tray.ico'
const ICON_HELPERS = `const ebaoSourceIconPath = (name) => join(app.getAppPath(), "..", "..", "..", "assets", "desktop-brand", name);
const ebaoSourceWindowIcon = () => !app.isPackaged && process.platform === "win32" ? { icon: ebaoSourceIconPath("${WINDOWS_ICON}") } : {};
`

function replaceSourceIconSeam(source, marker, replacement) {
  if (source.split(marker).length !== 2) throw new Error(`Official Desktop source icon seam changed: ${marker}`)
  return source.replace(marker, () => replacement)
}

export function applyEbaoSourceIcons(source) {
  if (source.includes(ICON_HELPERS)) return source
  const window = 'function createWindow(preload, show = false, primary = false) {\n\tconst window = new BrowserWindow({'
  source = replaceSourceIconSeam(source, window, `${ICON_HELPERS}${window}\n\t\t...ebaoSourceWindowIcon(),`)
  source = replaceSourceIconSeam(source,
    'new BrowserWindow(welcomeWindowOptions(process.platform, locale))',
    'new BrowserWindow({ ...welcomeWindowOptions(process.platform, locale), ...ebaoSourceWindowIcon() })')
  const main = 'async function main() {'
  source = replaceSourceIconSeam(source, main,
    `${main}\n\tif (!app.isPackaged && process.platform === "darwin") app.dock?.setIcon(ebaoSourceIconPath("${MAC_ICON}"));`)
  source = replaceSourceIconSeam(source, 'join(app.getAppPath(), "resources", "icon-windows.png")',
    `ebaoSourceIconPath(process.platform === "darwin" ? "${MAC_ICON}" : "${WINDOWS_ICON}")`)
  return replaceSourceIconSeam(source, 'join(app.getAppPath(), "resources", "tray-windows.ico")', `ebaoSourceIconPath("${TRAY_ICON}")`)
}

export function prepareEbaoSourceIcons(officialRoot) {
  const assets = join(officialRoot, '..', 'assets', 'desktop-brand')
  for (const name of [MAC_ICON, WINDOWS_ICON, TRAY_ICON]) accessSync(join(assets, name))
  const main = join(officialRoot, 'apps', 'desktop', 'lib', 'main.js')
  const source = readFileSync(main, 'utf8')
  const branded = applyEbaoSourceIcons(source)
  if (branded !== source) writeFileSync(main, branded, 'utf8')
}
