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
const ownedLibraryFiles = ['lib/index.js', 'lib/types/index.d.ts', 'lib/types/markdown/MarkdownDelegate.d.ts']
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

function patchDelegateTypes(source) {
  source = replaceOnce(source, "import type { ReactNode } from 'react';", "import type { ComponentType, ReactNode } from 'react';", 'MarkdownDelegate React type import')
  return replaceOnce(source, '/**\n * Handle one sanitized absolute HTTP(S)', `/** Props for an eligible, already resolved Markdown image preview. */
export interface MarkdownImagePreviewProps {
    readonly src: string;
    readonly alt: string;
    readonly destination: string;
    readonly labels: ImageLightboxLabels;
    readonly onClose: () => void;
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

function patchPublicTypes(source) {
  source = replaceOnce(source, "export { MarkdownDelegateProvider } from './markdown/MarkdownDelegate.tsx';", "export { MarkdownDelegateProvider, registerMarkdownImagePreview } from './markdown/MarkdownDelegate.tsx';", 'public Markdown export declaration')
  return replaceOnce(source, 'MarkdownDelegateProviderProps, MarkdownExternalLinkHandler }', 'MarkdownDelegateProviderProps, MarkdownExternalLinkHandler, MarkdownImagePreviewProps }', 'public Markdown type declaration')
}

export function extractVendorPackage(kind, destination) {
  const packageName = kind === 'frontend' ? 'web-frontend' : 'client-ui-primitives'
  const archive = join(repositoryRoot, `vendor/dsh-runtime/0.2.0-rc.2/deepseek-ai-dsh-${packageName}-0.2.0-rc.2.tgz`)
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
  const result = spawnSync('git', ['diff', '--no-index', '--', `a/${file}`, `b/${file}`], { cwd: directory, encoding: 'utf8' })
  if (result.status !== 1) throw new Error(`Expected modified ${file}: ${result.stderr || result.error || result.status}`)
  return result.stdout.replace(/^diff --git a\/a\/(\S+) b\/b\/(\S+)$/gm, 'diff --git a/$1 b/$2').replace(/^--- a\/a\//gm, '--- a/').replace(/^\+\+\+ b\/b\//gm, '+++ b/')
}

function verifyReplay(directory, patch, files) {
  const replay = join(directory, 'replay')
  cpSync(join(directory, 'a'), replay, { recursive: true })
  const patchPath = join(directory, 'replay.patch')
  writeFileSync(patchPath, patch)
  execFileSync('git', ['apply', '--check', patchPath], { cwd: replay, stdio: 'pipe' })
  execFileSync('git', ['apply', patchPath], { cwd: replay, stdio: 'pipe' })
  for (const file of files) {
    if (!readFileSync(join(replay, file)).equals(readFileSync(join(directory, 'b', file)))) throw new Error(`Patch replay differs for ${file}`)
  }
}

export function generateMarkdownPreviewPatches() {
  const temp = mkdtempSync(join(tmpdir(), 'ebao-markdown-preview-patch-'))
  try {
    const retained = retainedPrimitivesPatch(readFileSync(join(repositoryRoot, primitivesPatch), 'utf8'))
    const results = []
    for (const kind of ['primitives', 'frontend']) {
      const directory = join(temp, kind)
      mkdirSync(directory)
      const clean = extractVendorPackage(kind, directory)
      cpSync(clean, join(directory, 'a'), { recursive: true })
      cpSync(clean, join(directory, 'b'), { recursive: true })
      const files = kind === 'primitives' ? ownedLibraryFiles : [frontendAsset]
      if (kind === 'primitives') {
        const cssPatchPath = join(directory, 'css.patch')
        writeFileSync(cssPatchPath, retained)
        execFileSync('git', ['apply', cssPatchPath], { cwd: join(directory, 'b'), stdio: 'pipe' })
        for (const [file, transform] of [[files[0], patchPrimitivesRuntime], [files[1], patchPublicTypes], [files[2], patchDelegateTypes]]) {
          writeFileSync(join(directory, 'b', file), transform(readFileSync(join(directory, 'a', file), 'utf8')))
        }
      } else {
        writeFileSync(join(directory, 'b', frontendAsset), patchFrontendRuntime(readFileSync(join(directory, 'a', frontendAsset), 'utf8')))
      }
      const patch = (kind === 'primitives' ? retained : '') + files.map(file => fileDiff(directory, file)).join('')
      verifyReplay(directory, patch, kind === 'primitives' ? [...files, 'lib/markdown/MarkdownText.module.css'] : files)
      results.push({ path: kind === 'primitives' ? primitivesPatch : frontendPatch, patch, files, bytes: Buffer.byteLength(patch) })
    }
    return results
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (!['--write', '--check'].includes(mode)) throw new Error('Usage: node scripts/markdown-image-preview-compat.mjs --write|--check')
  for (const result of generateMarkdownPreviewPatches()) {
    const target = join(repositoryRoot, result.path)
    if (mode === '--write') writeFileSync(target, result.patch)
    else if (!existsSync(target) || readFileSync(target, 'utf8') !== result.patch) throw new Error(`Generated patch drift: ${result.path}; run --write and review`)
    process.stdout.write(`${mode === '--write' ? 'Generated' : 'Verified'} ${result.path}: ${result.bytes} bytes; ${result.files.join(', ')}\n`)
  }
}
