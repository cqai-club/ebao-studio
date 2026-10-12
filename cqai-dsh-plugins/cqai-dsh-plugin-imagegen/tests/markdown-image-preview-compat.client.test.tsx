// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import * as React from 'react'
import type { ComponentType, ReactNode } from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// This replay generator is executable JavaScript so it can run before installation.
// @ts-expect-error The root maintenance script intentionally has no TS declaration.
import { extractVendorPackage, frontendAsset, generateMarkdownPreviewPatches, markdownPreviewRegistrySource, repositoryRoot } from '../../../scripts/markdown-image-preview-compat.mjs'

interface PreviewProps {
  src: string
  alt: string
  destination: string
  labels: { dialog: string; close: string }
  onClose: () => void
}
interface FileImages {
  resolve: (path: string) => string | undefined
  labels: PreviewProps['labels'] & { open: string; failed: string; loading: string }
}
interface LoadedProps extends Omit<PreviewProps, 'labels' | 'onClose'> { preview?: FileImages }
interface Fixture {
  Loaded: ComponentType<LoadedProps>
  MarkdownImage: ComponentType<{ destination: string; alt: string; streaming?: boolean; inLink?: boolean }>
  Provider: ComponentType<{ fileImages?: FileImages; children: ReactNode }>
  namespace: { registerMarkdownImagePreview: (renderer: ComponentType<PreviewProps>) => () => void }
}

const labels = { dialog: '图片大图', close: '关闭大图', open: '查看大图', failed: '加载失败', loading: '加载中' }
const props = { src: 'data:image/png;base64,original', alt: 'Law Yard logo', destination: 'output/logo.png' }
const preview: FileImages = { resolve: () => props.src, labels }
let temp: string
let patchedFrontend: string
let decodeURL: (value: string) => string

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  if (from < 0 || to < 0 || source.indexOf(start, from + start.length) >= 0) throw new Error(`Compiled boundary drift: ${start}`)
  return source.slice(from, to)
}

/** Load the real patched static namespace and original compiled image components.
 * React, JSX, DOM, CSS, and unrelated namespace exports are module-loader edges;
 * the preview registry, MarkdownDelegate, resolver/gates, Db and E8 stay real.
 */
function fixture(): Fixture {
  const namespace = /const sE=Object\.freeze\(Object\.defineProperty\(\{__proto__:null,([^]*?)\},Symbol\.toStringTag,\{value:"Module"\}\)\)/u.exec(patchedFrontend)?.[0]
  if (!namespace) throw new Error('Missing actual compiled frozen namespace')
  const imported: Record<string, unknown> = {}
  for (const [, identifier] of namespace.matchAll(/(?:^|,)[\w$]+:([\w$]+)/gu)) imported[identifier] = () => null
  const context = createContext({
    ...imported, j: React, l: jsxRuntime, cn: ReactDOM, document, window, HTMLElement, URL,
    dt: { image: 'markdown-image', imageButton: 'markdown-image-button', imageAlt: 'markdown-image-alt' },
    Di: { backdrop: 'original-lightbox', mask: 'original-mask', image: 'original-image', close: 'original-close' },
    vs: () => <svg aria-hidden="true" />, yc: decodeURL,
  })
  const source = [
    'const b8=j.createContext({});',
    between(patchedFrontend, 'function jb(', 'function bb('),
    between(patchedFrontend, 'function k8(', 'function kb('),
    between(patchedFrontend, 'function S8(', 'function gc('),
    between(patchedFrontend, 'function zb(', 'function R8('),
    `${namespace};`,
    'globalThis.fixture={Loaded:Db,MarkdownImage:zb,Provider:jb,namespace:sE};',
  ].join('\n')
  runInContext(source, context)
  return context.fixture as Fixture
}

function custom(name: string, seen = vi.fn()): ComponentType<PreviewProps> {
  return function Preview(input: PreviewProps) {
    seen(input)
    return <section role="dialog" aria-label={name}>
      <img src={input.src} alt={input.alt} />
      <button onClick={input.onClose}>关闭自定义</button>
    </section>
  }
}

beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), 'ebao-markdown-preview-test-'))
  const packageDirectory = extractVendorPackage('frontend', temp)
  execFileSync('git', ['apply', join(repositoryRoot, 'patches/dsh-web-frontend@0.2.0-rc.2.patch')], { cwd: packageDirectory })
  patchedFrontend = readFileSync(join(packageDirectory, frontendAsset), 'utf8')
  // The published vendor module is self-contained. Keep its real URL decoder,
  // dropping only ESM's final export declaration at the VM loader boundary.
  const vendor = readFileSync(join(packageDirectory, 'dist/assets/vendor-CCJJTK99.js'), 'utf8')
  const context = createContext({ console, document, window, URL })
  const exportIndex = vendor.lastIndexOf('export{')
  if (exportIndex < 0 || !vendor.slice(exportIndex).includes('l5 as n')) throw new Error('Pinned URL decoder export changed')
  runInContext(`${vendor.slice(0, exportIndex)}\nglobalThis.decodeURL=l5;`, context)
  decodeURL = context.decodeURL as typeof decodeURL
})
afterEach(cleanup)
afterAll(() => { if (temp) rmSync(temp, { recursive: true, force: true }) })

describe('published frontend Markdown image preview compatibility API', () => {
  it('exports from the actual frozen static namespace and preserves the original lightbox without registration', () => {
    const f = fixture()
    expect(Object.isFrozen(f.namespace)).toBe(true)
    expect(typeof f.namespace.registerMarkdownImagePreview).toBe('function')
    render(<f.Loaded {...props} preview={preview} />)
    const opener = screen.getByRole('button', { name: `查看大图: ${props.alt}` })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: labels.dialog })
    expect(dialog.className).toBe('original-lightbox')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: labels.close }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('updates an already open preview on registration and immediately restores original fallback on disposal', () => {
    const f = fixture()
    render(<f.Loaded {...props} preview={preview} />)
    fireEvent.click(screen.getByRole('button'))
    let dispose!: () => void
    act(() => { dispose = f.namespace.registerMarkdownImagePreview(custom('自定义编辑预览')) })
    expect(screen.getByRole('dialog', { name: '自定义编辑预览' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: labels.dialog })).toBeNull()
    act(dispose)
    expect(screen.getByRole('dialog', { name: labels.dialog }).className).toBe('original-lightbox')
    fireEvent.click(screen.getByRole('button', { name: labels.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('passes resolved src, original destination, alt, limited labels and the original owner close callback', () => {
    const f = fixture()
    const seen = vi.fn()
    f.namespace.registerMarkdownImagePreview(custom('编辑预览', seen))
    render(<f.Loaded {...props} preview={preview} />)
    fireEvent.click(screen.getByRole('button'))
    const received = seen.mock.calls.at(-1)?.[0] as PreviewProps
    expect(received).toMatchObject(props)
    expect(Object.keys(received.labels).sort()).toEqual(['close', 'dialog'])
    expect(received.labels).toEqual({ dialog: labels.dialog, close: labels.close })
    fireEvent.click(screen.getByRole('button', { name: '关闭自定义' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('img').getAttribute('src')).toBe(props.src)
  })

  it('makes disposal idempotent and never clears a newer registration', () => {
    const f = fixture()
    const first = f.namespace.registerMarkdownImagePreview(custom('旧编辑器'))
    const second = f.namespace.registerMarkdownImagePreview(custom('新编辑器'))
    render(<f.Loaded {...props} preview={preview} />)
    fireEvent.click(screen.getByRole('button'))
    act(() => { first(); first() })
    expect(screen.getByRole('dialog', { name: '新编辑器' })).toBeTruthy()
    act(() => { second(); second() })
    expect(screen.getByRole('dialog', { name: labels.dialog })).toBeTruthy()
  })

  it('restores the previous live registration when the newest owner unloads', () => {
    const f = fixture()
    const first = f.namespace.registerMarkdownImagePreview(custom('旧编辑器'))
    const second = f.namespace.registerMarkdownImagePreview(custom('新编辑器'))
    render(<f.Loaded {...props} preview={preview} />)
    fireEvent.click(screen.getByRole('button'))
    act(second)
    expect(screen.getByRole('dialog', { name: '旧编辑器' })).toBeTruthy()
    act(first)
    expect(screen.getByRole('dialog', { name: labels.dialog })).toBeTruthy()
  })

  it('does not make an image eligible for preview without the original owner capabilities', () => {
    const f = fixture()
    const seen = vi.fn()
    f.namespace.registerMarkdownImagePreview(custom('编辑预览', seen))
    render(<f.Loaded {...props} />)
    fireEvent.click(screen.getByRole('img'))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(seen).not.toHaveBeenCalled()
  })

  it('keeps loading attributes and failed-image text unchanged', () => {
    const f = fixture()
    f.namespace.registerMarkdownImagePreview(custom('编辑预览'))
    render(<f.Loaded {...props} preview={preview} />)
    const image = screen.getByRole('img')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('decoding')).toBe('async')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.error(image)
    expect(screen.getByText(`加载失败 · ${props.alt}`)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('preserves linked-image navigation with no inner preview button or custom dialog', () => {
    const f = fixture()
    const navigate = vi.fn(event => event.preventDefault())
    const resolve = vi.fn(() => props.src)
    f.namespace.registerMarkdownImagePreview(custom('编辑预览'))
    render(<f.Provider fileImages={{ resolve, labels }}>
      <a href="https://example.com/logo" onClick={navigate}>
        <f.MarkdownImage destination={props.destination} alt={props.alt} inLink />
      </a>
    </f.Provider>)
    fireEvent.click(screen.getByRole('img'))
    expect(resolve).toHaveBeenCalledWith(props.destination)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('retains streaming-local image gates and only resolves the settled local destination', () => {
    const f = fixture()
    const resolve = vi.fn(() => props.src)
    f.namespace.registerMarkdownImagePreview(custom('编辑预览'))
    const tree = (streaming: boolean) => <f.Provider fileImages={{ resolve, labels }}>
      <f.MarkdownImage destination="output/Law%20Yard.png#L2" alt={props.alt} streaming={streaming} />
    </f.Provider>
    const result = render(tree(true))
    expect(screen.getByText(props.alt)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
    result.rerender(tree(false))
    expect(resolve).toHaveBeenCalledWith('output/Law Yard.png')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('dialog', { name: '编辑预览' })).toBeTruthy()
  })

  it('retains the original resolved-src key, clearing old image failures when the source changes', () => {
    const f = fixture()
    const tree = (src: string) => <f.Provider fileImages={{ resolve: () => src, labels }}>
      <f.MarkdownImage destination={props.destination} alt={props.alt} />
    </f.Provider>
    const result = render(tree(props.src))
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    result.rerender(tree('data:image/png;base64,next'))
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,next')
  })

  it('rebuilds both runtime patches from identical registry source and replays their complete diffs', () => {
    const patches = generateMarkdownPreviewPatches()
    for (const patch of patches) expect(readFileSync(join(repositoryRoot, patch.path), 'utf8')).toBe(patch.patch)
    const library = patches.find((result: { path: string }) => result.path.includes('client-ui-primitives'))?.patch ?? ''
    expect(library).toContain('diff --git a/lib/markdown/MarkdownText.module.css')
    expect(library).toContain('+export interface MarkdownImagePreviewProps')
    expect(library).toContain('+export declare function registerMarkdownImagePreview(renderer: ComponentType<MarkdownImagePreviewProps>): () => void;')
    expect(patchedFrontend).toContain(markdownPreviewRegistrySource)
    expect(library).toContain(markdownPreviewRegistrySource.split('\n').filter(Boolean).map((line: string) => `+${line}`).join('\n'))
  })
})
