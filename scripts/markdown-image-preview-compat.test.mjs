import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { extractVendorPackage, generateMarkdownPreviewPatches, markdownPreviewRegistrySource, markdownPreviewVersions, repositoryRoot } from './markdown-image-preview-compat.mjs'

function assertReviewedPatches(results) {
  assert.equal(results.length, 2)
  for (const result of results) {
    assert.equal(result.patch, readFileSync(join(repositoryRoot, result.path), 'utf8'), result.path)
    assert.equal(result.bytes, Buffer.byteLength(result.patch))
  }
}

for (const version of markdownPreviewVersions) {
  test(`${version}: real artifacts generate the reviewed, byte-exact replayable patches`, () => {
    assertReviewedPatches(generateMarkdownPreviewPatches(version))
  })
}

test('inherited Windows CRLF settings cannot change generated patches or replay bytes', () => {
  const files = markdownPreviewVersions.flatMap(version => [
    `vendor/dsh-runtime/${version}/deepseek-ai-dsh-client-ui-primitives-${version}.tgz`,
    `vendor/dsh-runtime/${version}/deepseek-ai-dsh-web-frontend-${version}.tgz`,
    `patches/dsh-client-ui-primitives@${version}.patch`,
    `patches/dsh-web-frontend@${version}.patch`,
  ])
  const originals = files.map(file => readFileSync(join(repositoryRoot, file)))
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'core.eol', GIT_CONFIG_VALUE_1: 'crlf',
  }
  const script = new URL('./markdown-image-preview-compat.mjs', import.meta.url).href
  const code = `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { generateMarkdownPreviewPatches, markdownPreviewVersions } from ${JSON.stringify(script)};
    assert.equal(execFileSync('git', ['config', '--get', 'core.autocrlf'], { encoding: 'utf8' }).trim(), 'true');
    assert.equal(execFileSync('git', ['config', '--get', 'core.eol'], { encoding: 'utf8' }).trim(), 'crlf');
    process.stdout.write(JSON.stringify(markdownPreviewVersions.map(version => generateMarkdownPreviewPatches(version))));
  `
  const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: repositoryRoot, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }))
  results.forEach(assertReviewedPatches)
  files.forEach((file, index) => assert.ok(readFileSync(join(repositoryRoot, file)).equals(originals[index]), `${file} must remain unchanged`))
})

/** Run the real compiled image function with only React/JSX and unrelated rendering edges replaced. */
function currentPreviewFixture(source, frontend) {
  const openMenu = () => {}
  const menu = { onContextMenu: openMenu, tabIndex: 0 }
  let state = []
  const hooks = {
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: () => [state.shift(), () => {}],
    useCallback: callback => callback,
  }
  const jsx = (component, props) => ({ component, props })
  const runtime = { jsx, jsxs: jsx, Fragment: 'fragment' }
  const delegate = () => ({ getTriggerProps: () => menu })
  const parseFile = () => ({ path: '/fixture/image.png' })
  const css = { image: 'image', imageButton: 'button', imageAlt: 'alt' }
  let declaration, image, namespace, context
  if (frontend) {
    const imageMatch = source.match(/function ([\w$]+)\(\{src:([\w$]+),alt:([\w$]+),destination:([\w$]+),preview:([\w$]+)\}\)\{/u)
    assert.ok(imageMatch)
    const from = imageMatch.index
    declaration = source.slice(from, source.indexOf('}function ', from) + 1)
    image = imageMatch[1]
    const react = declaration.match(/([\w$]+)\.useSyncExternalStore\(/u)?.[1]
    const factory = declaration.match(/([\w$]+)\.jsx\(/u)?.[1]
    const owner = declaration.match(/const\{getTriggerProps:[\w$]+\}=([\w$]+)\(\)/u)?.[1]
    const file = declaration.match(new RegExp(`const [\\w$]+=([\\w$]+)\\(${imageMatch[4]}\\),`, 'u'))?.[1]
    const style = declaration.match(/className:([\w$]+)\.imageAlt/u)?.[1]
    const draggable = declaration.match(new RegExp(`${factory}\\.jsx\\(([\\w$]+),\\{fileDrag:`, 'u'))?.[1]
    const lightbox = declaration.match(new RegExp(`${factory}\\.jsx\\(([\\w$]+),\\{src:${imageMatch[2]},alt:${imageMatch[3]},labels:`, 'u'))?.[1]
    assert.ok(react && factory && owner && file && style && draggable && lightbox)
    const namespaces = [...source.matchAll(/const ([\w$]+)=Object\.freeze\(Object\.defineProperty\(\{__proto__:null,([^]*?)\},Symbol\.toStringTag,\{value:"Module"\}\)\)/gu)]
      .filter(match => match[2].includes('MarkdownDelegateProvider:') && match[2].includes('registerMarkdownImagePreview:registerMarkdownImagePreview'))
    assert.equal(namespaces.length, 1)
    namespace = namespaces[0][1]
    context = Object.fromEntries([...namespaces[0][2].matchAll(/[\w$]+:([\w$]+)/gu)].map(([, name]) => [name, () => null]))
    Object.assign(context, { [react]: hooks, [factory]: runtime, [owner]: delegate, [file]: parseFile,
      [style]: css, [draggable]: 'draggable-image', [lightbox]: 'original-lightbox' })
    declaration += `;${namespaces[0][0]};`
  } else {
    const from = source.indexOf('function LoadedMarkdownImage(')
    const end = source.indexOf('\n/** The bracketed source', from)
    assert.ok(from >= 0 && end > from)
    declaration = source.slice(from, end)
    image = 'LoadedMarkdownImage'
    namespace = '{registerMarkdownImagePreview}'
    context = { ...hooks, ...runtime, useMarkdownDelegate: delegate, parseFileLink: parseFile,
      markdownCss: css, DraggableImage: 'draggable-image', ImageLightbox: 'original-lightbox' }
    assert.match(source.slice(source.lastIndexOf('export {')), /\bregisterMarkdownImagePreview\b/u)
  }
  runInNewContext(`${markdownPreviewRegistrySource}\n${declaration}\nglobalThis.fixture={render:${image},api:${namespace}};`, context)
  return { api: context.fixture.api, menu, render(props, preview = true) {
    state = [false, true]
    return context.fixture.render({ ...props, ...(preview ? { preview: { fileDrag: {}, labels: { dialog: 'Preview', close: 'Close', open: 'Open' } } } : {}) })
  } }
}

for (const version of ['0.2.2-alpha.3', '0.2.2-rc.1']) test(`${version} library and frozen frontend namespace preserve lightbox fallback, context menus and image eligibility`, () => {
  const temp = mkdtempSync(join(tmpdir(), 'ebao-markdown-current-smoke-'))
  const props = { src: 'data:image/png;base64,fixture', alt: 'Fixture', destination: '/fixture/image.png' }
  try {
    for (const [index, result] of generateMarkdownPreviewPatches(version).entries()) {
      const directory = join(temp, String(index))
      mkdirSync(directory)
      const path = extractVendorPackage(index ? 'frontend' : 'primitives', directory, version)
      execFileSync('git', ['apply', join(repositoryRoot, result.path)], { cwd: path })
      const source = readFileSync(join(path, result.files[0]), 'utf8')
      const fixture = currentPreviewFixture(source, index === 1)
      if (index) assert.equal(Object.isFrozen(fixture.api), true)
      const fallback = fixture.render(props).props.children[1]
      assert.equal(fallback.component, 'original-lightbox')
      assert.equal(fallback.props.contextMenuProps, fixture.menu)
      const first = () => null, second = () => null
      const disposeFirst = fixture.api.registerMarkdownImagePreview(first)
      const disposeSecond = fixture.api.registerMarkdownImagePreview(second)
      let custom = fixture.render(props).props.children[1]
      assert.equal(custom.component, second)
      for (const [key, value] of Object.entries(props)) assert.equal(custom.props[key], value)
      assert.equal(custom.props.contextMenuProps, fixture.menu)
      assert.deepEqual(Object.keys(custom.props.labels).sort(), ['close', 'dialog'])
      assert.equal(typeof custom.props.onClose, 'function')
      disposeSecond(); disposeSecond()
      custom = fixture.render(props).props.children[1]
      assert.equal(custom.component, first)
      disposeFirst()
      assert.equal(fixture.render(props).props.children[1].component, 'original-lightbox')
      assert.equal(fixture.render(props, false).component, 'img')
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
