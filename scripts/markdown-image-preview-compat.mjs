/**
 * Rebuild the narrow Markdown preview extension against the pinned published DSH
 * artifacts. Both runtimes share the registry source below: the frontend embeds
 * ui-primitives, so patching only the separately installed library is insufficient.
 * Run with --write to regenerate or --check to verify exact, replayable patches.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const frontendAsset = 'dist/assets/index-5SrrfWpU.js'
const primitivesPatch = 'patches/dsh-client-ui-primitives@0.2.0-rc.2.patch'
const frontendPatch = 'patches/dsh-web-frontend@0.2.0-rc.2.patch'
export const markdownPreviewVersions = ['0.2.0-rc.2', '0.2.2-alpha.3', '0.2.2-rc.1']
const ownedLibraryFiles = ['lib/index.js', 'lib/types/index.d.ts', 'lib/types/markdown/MarkdownDelegate.d.ts']
// Published artifacts use LF; inherited Git settings must not change replay bytes.
const gitLFConfig = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf']
export const markdownPreviewRegistrySource = `/* ebao-markdown-image-preview-registry:start */
const ebaoMarkdownImagePreviews = [];
const ebaoMarkdownImagePreviewListeners = new Set();
function ebaoMarkdownImagePreviewSnapshot() {
  return ebaoMarkdownImagePreviews.at(-1)?.renderer;
}
function ebaoSubscribeMarkdownImagePreview(listener) {
  ebaoMarkdownImagePreviewListeners.add(listener);
  return () => { ebaoMarkdownImagePreviewListeners.delete(listener); };
}
function registerMarkdownImagePreview(renderer) {
  const registration = { renderer };
  ebaoMarkdownImagePreviews.push(registration);
  for (const listener of ebaoMarkdownImagePreviewListeners) listener();
  return () => {
    const index = ebaoMarkdownImagePreviews.indexOf(registration);
    if (index < 0) return;
    ebaoMarkdownImagePreviews.splice(index, 1);
    for (const listener of ebaoMarkdownImagePreviewListeners) listener();
  };
}
/* ebao-markdown-image-preview-registry:end */
`

function replaceOnce(source, before, after, description) {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one ${description} in pinned DSH artifact`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

export function patchPrimitivesRuntime(source) {
  if (source.includes('ebaoMarkdownImagePreviews')) throw new Error('Expected clean ui-primitives runtime')
  source = replaceOnce(source, 'function LoadedMarkdownImage({ src, alt, destination, preview }) {', `${markdownPreviewRegistrySource}function LoadedMarkdownImage({ src, alt, destination, preview }) {\n\tconst MarkdownPreview = useSyncExternalStore(ebaoSubscribeMarkdownImagePreview, ebaoMarkdownImagePreviewSnapshot, ebaoMarkdownImagePreviewSnapshot);`, 'LoadedMarkdownImage entry')
  source = replaceOnce(source, '}), open && jsx(ImageLightbox, {\n\t\tsrc,\n\t\talt,\n\t\tlabels: preview.labels,\n\t\tonClose: close\n\t})] });', '}), open && (MarkdownPreview === void 0 ? jsx(ImageLightbox, {\n\t\tsrc,\n\t\talt,\n\t\tlabels: preview.labels,\n\t\tonClose: close\n\t}) : jsx(MarkdownPreview, {\n\t\tsrc,\n\t\talt,\n\t\tdestination,\n\t\tlabels: { dialog: preview.labels.dialog, close: preview.labels.close },\n\t\tonClose: close\n\t}))] });', 'original Markdown lightbox branch')
  return replaceOnce(source, 'projectUserText, rankByName, relativeTime, settingsNumberField,', 'projectUserText, rankByName, registerMarkdownImagePreview, relativeTime, settingsNumberField,', 'ui-primitives public export')
}

export function patchFrontendRuntime(source) {
  if (source.includes('ebaoMarkdownImagePreviews')) throw new Error('Expected clean published frontend runtime')
  source = replaceOnce(source, 'function Db({src:e,alt:n,destination:o,preview:s}){const[a,u]', `${markdownPreviewRegistrySource}function Db({src:e,alt:n,destination:o,preview:s}){const MarkdownPreview=j.useSyncExternalStore(ebaoSubscribeMarkdownImagePreview,ebaoMarkdownImagePreviewSnapshot,ebaoMarkdownImagePreviewSnapshot);const[a,u]`, 'compiled LoadedMarkdownImage entry')
  source = replaceOnce(source, 'f&&l.jsx(E8,{src:e,alt:n,labels:s.labels,onClose:m})', 'f&&(MarkdownPreview===void 0?l.jsx(E8,{src:e,alt:n,labels:s.labels,onClose:m}):l.jsx(MarkdownPreview,{src:e,alt:n,destination:o,labels:{dialog:s.labels.dialog,close:s.labels.close},onClose:m}))', 'compiled original Markdown lightbox branch')
  return replaceOnce(source, 'MarkdownDelegateProvider:jb,MarkdownText:z8,', 'MarkdownDelegateProvider:jb,registerMarkdownImagePreview:registerMarkdownImagePreview,MarkdownText:z8,', 'frozen static ui-primitives namespace declaration')
}

/** Current upstream retains image context menus in its built-in lightbox. */
export function patchCurrentPrimitivesRuntime(source) {
  if (source.includes('ebaoMarkdownImagePreviews')) throw new Error('Expected clean ui-primitives runtime')
  source = replaceOnce(source, 'function LoadedMarkdownImage({ src, alt, destination, preview }) {', `${markdownPreviewRegistrySource}function LoadedMarkdownImage({ src, alt, destination, preview }) {\n\tconst MarkdownPreview = useSyncExternalStore(ebaoSubscribeMarkdownImagePreview, ebaoMarkdownImagePreviewSnapshot, ebaoMarkdownImagePreviewSnapshot);`, 'LoadedMarkdownImage entry')
  source = replaceOnce(source, '}), open && jsx(ImageLightbox, {\n\t\tsrc,\n\t\talt,\n\t\tlabels: preview.labels,\n\t\tonClose: close,\n\t\tcontextMenuProps\n\t})] });', '}), open && (MarkdownPreview === void 0 ? jsx(ImageLightbox, {\n\t\tsrc,\n\t\talt,\n\t\tlabels: preview.labels,\n\t\tonClose: close,\n\t\tcontextMenuProps\n\t}) : jsx(MarkdownPreview, {\n\t\tsrc,\n\t\talt,\n\t\tdestination,\n\t\tlabels: { dialog: preview.labels.dialog, close: preview.labels.close },\n\t\tonClose: close,\n\t\tcontextMenuProps\n\t}))] });', 'original Markdown lightbox branch')
  return replaceOnce(source, 'rankByName, relativeTime, settingsNumberField,', 'rankByName, registerMarkdownImagePreview, relativeTime, settingsNumberField,', 'ui-primitives public export')
}

/** Derive minified identifiers from the reviewed image component, rejecting shape drift. */
export function patchCurrentFrontendRuntime(source) {
  if (source.includes('ebaoMarkdownImagePreviews')) throw new Error('Expected clean published frontend runtime')
  const identifier = '[A-Za-z_$][\\w$]*'
  const imagePattern = new RegExp(`function (${identifier})\\(\\{src:(${identifier}),alt:(${identifier}),destination:(${identifier}),preview:(${identifier})\\}\\)\\{`, 'gu')
  const images = [...source.matchAll(imagePattern)]
  if (images.length !== 1) throw new Error('Expected exactly one compiled LoadedMarkdownImage entry')
  const [image, , src, alt, destination, preview] = images[0]
  const entry = images[0].index
  const end = source.indexOf('}function ', entry + image.length)
  if (end < 0) throw new Error('Expected compiled Markdown image function boundary')
  const component = source.slice(entry, end + 1)
  const react = component.match(new RegExp(`(${identifier})\\.useState\\(`, 'u'))?.[1]
  if (react === undefined) throw new Error('Expected compiled Markdown image React hooks')
  const lightboxPattern = new RegExp(`(${identifier})&&(${identifier})\\.jsx\\((${identifier}),\\{src:${src},alt:${alt},labels:${preview}\\.labels,onClose:(${identifier}),contextMenuProps:(${identifier})\\}\\)`, 'gu')
  const lightboxes = [...component.matchAll(lightboxPattern)]
  if (lightboxes.length !== 1) throw new Error('Expected exactly one compiled original Markdown lightbox branch')
  const [original, open, jsx, lightbox, close, context] = lightboxes[0]
  source = replaceOnce(source, image, `${markdownPreviewRegistrySource}${image}const MarkdownPreview=${react}.useSyncExternalStore(ebaoSubscribeMarkdownImagePreview,ebaoMarkdownImagePreviewSnapshot,ebaoMarkdownImagePreviewSnapshot);`, 'compiled LoadedMarkdownImage entry')
  source = replaceOnce(source, original, `${open}&&(MarkdownPreview===void 0?${jsx}.jsx(${lightbox},{src:${src},alt:${alt},labels:${preview}.labels,onClose:${close},contextMenuProps:${context}}):${jsx}.jsx(MarkdownPreview,{src:${src},alt:${alt},destination:${destination},labels:{dialog:${preview}.labels.dialog,close:${preview}.labels.close},onClose:${close},contextMenuProps:${context}}))`, 'compiled original Markdown lightbox branch')
  const namespaces = [...source.matchAll(new RegExp(`MarkdownDelegateProvider:(${identifier}),MarkdownText:`, 'gu'))]
  if (namespaces.length !== 1) throw new Error('Expected exactly one frozen static ui-primitives namespace declaration')
  return replaceOnce(source, namespaces[0][0], `MarkdownDelegateProvider:${namespaces[0][1]},registerMarkdownImagePreview:registerMarkdownImagePreview,MarkdownText:`, 'frozen static ui-primitives namespace declaration')
}

function patchDelegateTypes(source, current = false) {
  source = current
    ? replaceOnce(source, "import type { HTMLAttributes, ReactNode } from 'react';", "import type { ComponentType, HTMLAttributes, ReactNode } from 'react';", 'MarkdownDelegate React type import')
    : replaceOnce(source, "import type { ReactNode } from 'react';", "import type { ComponentType, ReactNode } from 'react';", 'MarkdownDelegate React type import')
  return replaceOnce(source, '/**\n * Handle one sanitized absolute HTTP(S)', `/** Props for an eligible, already resolved Markdown image preview. */
export interface MarkdownImagePreviewProps {
    readonly src: string;
    readonly alt: string;
    readonly destination: string;
    readonly labels: ImageLightboxLabels;
    readonly onClose: () => void;${current ? "\n    readonly contextMenuProps?: Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'>;" : ''}
}
/**
 * Register a Markdown image preview renderer. The newest live registration wins;
 * its idempotent disposer restores the previous renderer or the built-in lightbox.
 * Registration does not change image resolution, eligibility, or link navigation.
 */
export declare function registerMarkdownImagePreview(renderer: ComponentType<MarkdownImagePreviewProps>): () => void;
/**
 * Handle one sanitized absolute HTTP(S)`, 'MarkdownDelegate declaration header')
}

function patchPublicTypes(source, current = false) {
  source = current
    ? replaceOnce(source, "export { MarkdownDelegateProvider, useMarkdownDelegate } from './markdown/MarkdownDelegate.tsx';", "export { MarkdownDelegateProvider, registerMarkdownImagePreview, useMarkdownDelegate } from './markdown/MarkdownDelegate.tsx';", 'public Markdown export declaration')
    : replaceOnce(source, "export { MarkdownDelegateProvider } from './markdown/MarkdownDelegate.tsx';", "export { MarkdownDelegateProvider, registerMarkdownImagePreview } from './markdown/MarkdownDelegate.tsx';", 'public Markdown export declaration')
  return replaceOnce(source, 'MarkdownDelegateProviderProps, MarkdownExternalLinkHandler }', 'MarkdownDelegateProviderProps, MarkdownExternalLinkHandler, MarkdownImagePreviewProps }', 'public Markdown type declaration')
}

export function extractVendorPackage(kind, destination, version = markdownPreviewVersions[0]) {
  const packageName = kind === 'frontend' ? 'web-frontend' : 'client-ui-primitives'
  const archive = join(repositoryRoot, `vendor/dsh-runtime/${version}/deepseek-ai-dsh-${packageName}-${version}.tgz`)
  execFileSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'pipe' })
  return join(destination, 'package')
}

function retainedPrimitivesPatch(source) {
  const sections = source.split(/(?=^diff --git )/m).filter(Boolean)
  const retained = sections.filter(section => !ownedLibraryFiles.some(file => section.startsWith(`diff --git a/${file} b/${file}\n`)))
  if (retained.length !== 1 || !retained[0].startsWith('diff --git a/lib/markdown/MarkdownText.module.css b/lib/markdown/MarkdownText.module.css\n')) {
    throw new Error('Unexpected non-preview ui-primitives patch content; preserve and review it explicitly')
  }
  return retained.join('')
}

function fileDiff(directory, file) {
  const result = spawnSync('git', [...gitLFConfig, 'diff', '--no-index', '--', `a/${file}`, `b/${file}`], { cwd: directory, encoding: 'utf8' })
  if (result.status !== 1) throw new Error(`Expected modified ${file}: ${result.stderr || result.error || result.status}`)
  return result.stdout.replace(/^diff --git a\/a\/(\S+) b\/b\/(\S+)$/gm, 'diff --git a/$1 b/$2').replace(/^--- a\/a\//gm, '--- a/').replace(/^\+\+\+ b\/b\//gm, '+++ b/')
}

function verifyReplay(directory, patch, files) {
  const replay = join(directory, 'replay')
  cpSync(join(directory, 'a'), replay, { recursive: true })
  const patchPath = join(directory, 'replay.patch')
  writeFileSync(patchPath, patch)
  execFileSync('git', [...gitLFConfig, 'apply', '--check', patchPath], { cwd: replay, stdio: 'pipe' })
  execFileSync('git', [...gitLFConfig, 'apply', patchPath], { cwd: replay, stdio: 'pipe' })
  for (const file of files) {
    if (!readFileSync(join(replay, file)).equals(readFileSync(join(directory, 'b', file)))) throw new Error(`Patch replay differs for ${file}`)
  }
}

export function generateMarkdownPreviewPatches(version = markdownPreviewVersions[0]) {
  if (!markdownPreviewVersions.includes(version)) throw new Error(`Unsupported Markdown preview runtime ${String(version)}`)
  const current = version !== '0.2.0-rc.2'
  const versionPrimitivesPatch = current ? `patches/dsh-client-ui-primitives@${version}.patch` : primitivesPatch
  const versionFrontendPatch = current ? `patches/dsh-web-frontend@${version}.patch` : frontendPatch
  const temp = mkdtempSync(join(tmpdir(), 'ebao-markdown-preview-patch-'))
  try {
    const retained = retainedPrimitivesPatch(readFileSync(join(repositoryRoot, versionPrimitivesPatch), 'utf8'))
    const results = []
    for (const kind of ['primitives', 'frontend']) {
      const directory = join(temp, kind)
      mkdirSync(directory)
      const clean = extractVendorPackage(kind, directory, version)
      cpSync(clean, join(directory, 'a'), { recursive: true })
      cpSync(clean, join(directory, 'b'), { recursive: true })
      const moduleTag = kind === 'frontend' && current
        ? readFileSync(join(clean, 'dist/index.html'), 'utf8').match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*>/u)?.[1]
        : undefined
      if (kind === 'frontend' && current && (moduleTag === undefined || !/^\.\/assets\/index-[\w-]+\.js$/u.test(moduleTag))) throw new Error('Expected one local frontend module asset')
      const asset = current && kind === 'frontend' ? `dist/${moduleTag.slice(2)}` : frontendAsset
      const files = kind === 'primitives' ? ownedLibraryFiles : [asset]
      if (kind === 'primitives') {
        const cssPatchPath = join(directory, 'css.patch')
        writeFileSync(cssPatchPath, retained)
        execFileSync('git', [...gitLFConfig, 'apply', cssPatchPath], { cwd: join(directory, 'b'), stdio: 'pipe' })
        for (const [file, transform] of [[files[0], current ? patchCurrentPrimitivesRuntime : patchPrimitivesRuntime], [files[1], source => patchPublicTypes(source, current)], [files[2], source => patchDelegateTypes(source, current)]]) {
          writeFileSync(join(directory, 'b', file), transform(readFileSync(join(directory, 'a', file), 'utf8')))
        }
      } else {
        writeFileSync(join(directory, 'b', asset), (current ? patchCurrentFrontendRuntime : patchFrontendRuntime)(readFileSync(join(directory, 'a', asset), 'utf8')))
      }
      const patch = (kind === 'primitives' ? retained : '') + files.map(file => fileDiff(directory, file)).join('')
      verifyReplay(directory, patch, kind === 'primitives' ? [...files, 'lib/markdown/MarkdownText.module.css'] : files)
      results.push({ path: kind === 'primitives' ? versionPrimitivesPatch : versionFrontendPatch, patch, files, bytes: Buffer.byteLength(patch) })
    }
    return results
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (!['--write', '--check'].includes(mode)) throw new Error('Usage: node scripts/markdown-image-preview-compat.mjs --write|--check')
  const versionIndex = process.argv.indexOf('--version')
  const versions = process.argv.includes('--all') ? markdownPreviewVersions : [versionIndex < 0 ? markdownPreviewVersions[0] : process.argv[versionIndex + 1]]
  for (const result of versions.flatMap(version => generateMarkdownPreviewPatches(version))) {
    const target = join(repositoryRoot, result.path)
    if (mode === '--write') writeFileSync(target, result.patch)
    else if (!existsSync(target) || readFileSync(target, 'utf8') !== result.patch) throw new Error(`Generated patch drift: ${result.path}; run --write and review`)
    process.stdout.write(`${mode === '--write' ? 'Generated' : 'Verified'} ${result.path}: ${result.bytes} bytes; ${result.files.join(', ')}\n`)
  }
}
