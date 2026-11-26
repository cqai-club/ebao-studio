import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The archives remain byte-for-byte upstream. Adapt only the copy shipped by e宝工坊.
const PPT_VERSION = '0.1.1-rc.2'
const PPT_ICON = 'assets/plugin-icon.svg'
const DSH_VERSION = '0.2.2-rc.5'

function edit(original, before, after, file) {
  const position = original.indexOf(before)
  if (position < 0 && original.includes(after)) return original
  if (position < 0 || original.indexOf(before, position + before.length) >= 0) {
    throw new Error(`Unexpected PPT archive contents in ${file}`)
  }
  return original.slice(0, position) + after + original.slice(position + before.length)
}

function writeDerivedFile(file, content) {
  // pnpm can hard-link staged files to its store. Replace the staging inode.
  const next = `${file}.ebao.tmp`
  writeFileSync(next, content)
  renameSync(next, file)
}

function patchFile(file, changes) {
  const raw = readFileSync(file, 'utf8')
  const original = raw.replaceAll('\r\n', '\n')
  const next = changes.reduce((source, [before, after]) => edit(source, before, after, file), original)
  if (next !== original) writeDerivedFile(file, raw.includes('\r\n') ? next.replaceAll('\n', '\r\n') : next)
}

function manifest(directory, name) {
  const file = join(directory, 'package.json')
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (data.name !== name || data.version !== PPT_VERSION) {
    throw new Error(`Expected ${name}@${PPT_VERSION} in ${directory}`)
  }
  return { file, data }
}

function composerSeat(slot, id, component) {
  return [
    `\t\t\tctx.slots.inject("${slot}", () => ctx.slots.register({`,
    `\t\t\t\tname: "${slot}",`,
    `\t\t\t\tid: "${id}",`,
    '\t\t\t\torder: 20,',
    '\t\t\t\tlocale: NS,',
    '\t\t\t\tinject: injectHero',
    `\t\t\t}, ${component}));`,
  ].join('\n')
}

const legacySeats = [
  composerSeat('conversation.hero.modeActions', 'dsh-ppt', 'OfficePptStandardModeAction'),
  composerSeat('conversation.input.accessory', 'dsh-ppt', 'OfficePptStandardInputAccessory'),
  composerSeat('conversation.hero.dock', 'dsh-ppt', 'OfficePptStandardComposerDock'),
  composerSeat('conversation.composer.dock', 'dsh-ppt', 'OfficePptStandardComposerDock'),
].join('\n')

const seats = [
  composerSeat('conversation.hero.options', 'dsh-ppt', 'OfficePptStandardModeAction'),
  composerSeat('conversation.input.dock', 'dsh-ppt-chooser', 'OfficePptStandardComposerDock'),
  composerSeat('conversation.input.dock', 'dsh-ppt-selection', 'OfficePptStandardInputAccessory'),
].join('\n')

// RC5 mounts the blank-session dock above the composer. Reserve layout space
// for the chooser and scroll its grid within the dock.
const dockStyles = `
[data-placement="dock"] > [data-office-ppt-template-panel] {
  position: static;
  width: 100%;
  height: auto;
  max-height: min(38dvh, 22rem);
  margin: 0;
  transform: none;
}
[data-placement="dock"] [data-office-ppt-template-viewport] {
  scrollbar-width: thin;
}
[data-placement="dock"] [role="tab"][aria-selected="false"]:not(:hover) {
  color: var(--dsw-alias-label-secondary);
}
[data-office-ppt-selection] {
  padding: 4px calc(var(--dsh-composer-side-clearance, 0px) + 6px);
}
`

const catalogState = [
  '\t\t\t\tthis.setMode(sessionId, activeMode);',
  '\t\t\t\tthis.setNotice(sessionId, next?.templateMigration?.reason ?? null);',
  '\t\t\t\tconst selected = (next?.templates ?? []).find((template) => template.id === next.selectedTemplateId && (template.supportedModes?.includes("ppt") ?? true));',
  '\t\t\t\tif (selected === void 0) {',
  '\t\t\t\t\tthis.deselect(sessionId, activeMode);',
  '\t\t\t\t\treturn true;',
  '\t\t\t\t}',
  '\t\t\t\tthis.select(sessionId, selected, activeMode);',
].join('\n')

// Reapplying an unchanged catalog would increment the revision and start another request.
const stableCatalogState = catalogState
  .replace('this.setMode(sessionId, activeMode);', 'if (this.snapshot(sessionId).activeMode !== activeMode) this.setMode(sessionId, activeMode);')
  .replace('this.deselect(sessionId, activeMode);', 'if (this.snapshot(sessionId).selectedId !== null) this.deselect(sessionId, activeMode);')
  .replace('this.select(sessionId, selected, activeMode);', 'if (this.snapshot(sessionId).selectedId !== selected.id) this.select(sessionId, selected, activeMode);')

const nativeRoutes = [
  '\t\tregisterPptRpcRoute(webCtx, "/dsh-ppt", rpcHandler);',
  '\t\t// Older loaded clients can finish their in-flight requests after upgrade.',
  '\t\tregisterPptRpcRoute(webCtx, "/kimi-ppt", rpcHandler);',
].join('\n')

const legacyRoutes = [
  nativeRoutes,
  '\t\ttry {',
  '\t\t\twebCtx.connection?.rpc?.handle?.("/dsh-ppt", rpcHandler, { authority: "trusted-host" });',
  '\t\t\twebCtx.connection?.rpc?.handle?.("/kimi-ppt", rpcHandler, { authority: "trusted-host" });',
  '\t\t} catch {}',
].join('\n')

export function prepareLegacyPluginArtifacts(modulesDir) {
  const engine = join(modulesDir, 'dsh-ppt')
  const composer = join(modulesDir, 'dsh-ppt-composer')
  const engineManifest = manifest(engine, 'dsh-ppt')
  const composerManifest = manifest(composer, 'dsh-ppt-composer')

  const styleStart = 'tag.textContent = css + `\nbutton[data-desktop-ppt]'
  const selectionClass = 'className: OfficePptHero_module_css_default.selection,'
  patchFile(join(composer, 'lib', 'client.js'), [
    [legacySeats, seats],
    [catalogState, stableCatalogState],
    ['placement: "fixed",', 'placement: "dock",'],
    ['if (placement === "fixed" && state.activeMode === null) return null;',
      'if (placement === "dock" && state.activeMode === null) return null;'],
    ['if (placement === "trigger") return;', 'if (placement === "trigger" || placement === "dock") return;'],
    [styleStart, `tag.textContent = css + \`${dockStyles}button[data-desktop-ppt]`],
    [selectionClass + '\n\t\t\t\t"aria-label":',
      selectionClass + '\n\t\t\t\t"data-office-ppt-selection": "",\n\t\t\t\t"aria-label":'],
  ])
  // The Browser RPC client uses the same HTTP envelope. Keep the routes that bound template uploads.
  patchFile(join(engine, 'lib', 'index.js'), [
    [legacyRoutes, nativeRoutes],
    ['const rejection = connection?.requestRejection?.(req);',
      'const rejection = connection == null ? 401 : connection.requestRejection(req);'],
  ])
  mkdirSync(join(composer, 'assets'), { recursive: true })
  copyFileSync(new URL('./ppt-composer-icon.svg', import.meta.url), join(composer, PPT_ICON))
  const { data: composerData } = composerManifest
  composerData.icon = PPT_ICON
  if (!composerData.files.includes('assets')) composerData.files.unshift('assets')
  for (const { data, file } of [engineManifest, composerManifest]) {
    data.engines = { ...data.engines, dsh: DSH_VERSION }
    const content = `${JSON.stringify(data, null, 2)}\n`
    if (readFileSync(file, 'utf8') !== content) writeDerivedFile(file, content)
  }
}
