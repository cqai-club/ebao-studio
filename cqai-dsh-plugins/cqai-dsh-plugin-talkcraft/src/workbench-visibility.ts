import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Served by the Desktop adapter; the vendored workbench stays unchanged. */
export const workbenchVisibilityScript = `
import { playerRef } from '/src/playerRef.ts';
let active = true;
const parentOrigin = document.referrer ? new URL(document.referrer).origin : null;
const pause = () => {
  playerRef.current?.pause();
  document.querySelectorAll('audio, video').forEach(media => media.pause());
  document.activeElement?.blur?.();
};
window.addEventListener('message', event => {
  if (event.source !== window.parent || (parentOrigin && event.origin !== parentOrigin)
      || event.data?.type !== 'talkcraft:visibility' || typeof event.data.active !== 'boolean') return;
  active = event.data.active;
  window.__talkcraftDesktopActive = active;
  if (!active) pause();
  else window.__talkcraftRefreshExport?.();
});
window.addEventListener('keydown', event => {
  if (active) return;
  event.preventDefault(); event.stopImmediatePropagation();
}, true);
document.addEventListener('play', event => { if (!active) event.target.pause?.(); }, true);
if (window.parent !== window) window.parent.postMessage({type: 'talkcraft:ready'}, parentOrigin ?? '*');
`

export function visibilityExportTransform(code: string, id: string): string | undefined {
  if (!id.replaceAll('\\', '/').split('?')[0]?.endsWith('/src/exportJob.ts')) return
  // Keep rendering on the server; suspend only its preview's progress reads.
  const start = 'timer = window.setInterval(async () => {'
  const end = '}, 1000);'
  if (!code.includes(start) || !code.includes(end)) throw new Error('工作台导出轮询接口已改变，请更新 Desktop 适配器')
  return code.replace(start, 'const desktopPollExport = async () => {\n    if (window.__talkcraftDesktopActive === false) return;')
    .replace(end, '};\n  window.__talkcraftRefreshExport = desktopPollExport;\n  timer = window.setInterval(desktopPollExport, 1000);')
}

export function writeWorkbenchVisibilityConfig(directory: string, workbenchRoot: string): string {
  const config = join(directory, 'desktop-workbench.vite.mjs')
  writeFileSync(config, `import upstream from ${JSON.stringify(pathToFileURL(join(workbenchRoot, 'vite.config.ts')).href)};
const bridge = ${JSON.stringify(workbenchVisibilityScript)};
const transformExport = ${visibilityExportTransform.toString()};
export default {...upstream, plugins: [...upstream.plugins, {
  name: 'talkcraft-desktop-visibility',
  enforce: 'pre',
  configureServer(server) {
    server.middlewares.use('/@desktop/visibility.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript'); res.end(bridge);
    });
  },
  transformIndexHtml() { return [{tag: 'script', attrs: {type: 'module', src: '/@desktop/visibility.js'}, injectTo: 'head'}]; },
  transform(code, id) { return transformExport(code, id); },
}]};\n`)
  return config
}
