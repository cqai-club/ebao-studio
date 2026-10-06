// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Ajv } from 'ajv'
import * as markdown from 'mdast-util-from-markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketDescription } from '../src/client/MarketDescription.js'
import { installMarketStyles } from '../src/client/styles.js'

vi.mock('mdast-util-from-markdown', async importOriginal => {
  const actual = await importOriginal<typeof import('mdast-util-from-markdown')>()
  return { ...actual, fromMarkdown: vi.fn(actual.fromMarkdown) }
})

afterEach(cleanup)

describe('Market description Markdown', () => {
  it('restores transport line separators and renders headings, lists, emphasis, code, and links', () => {
    const markdown = [
      '## Research workbench', '', 'Use **four skills** for *academic research*.', '',
      '- `deep-research`: literature review', '- `academic-paper`: writing', '',
      '### Installation', '', '1. Install skills.', '2. Restart the desktop.', '',
      '[Skill project](https://github.com/example/skills#setup)',
    ].join('\u2028')
    const { container } = render(<MarketDescription text={markdown} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Research workbench')
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Installation')
    expect(container.querySelector('strong')?.textContent).toBe('four skills')
    expect(container.querySelector('em')?.textContent).toBe('academic research')
    expect(container.querySelector('code')?.textContent).toBe('deep-research')
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    const link = screen.getByRole('link', { name: 'Skill project' })
    expect(link.getAttribute('href')).toBe('https://github.com/example/skills#setup')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('preserves ordinary single-line descriptions from existing providers', () => {
    const text = 'A writing helper for 2 * 3 examples and research workflows.'
    const { container } = render(<MarketDescription text={text} />)
    expect(container.querySelector('p')?.textContent).toBe(text)
    expect(container.querySelectorAll('h1, h2, h3, li, a, img')).toHaveLength(0)
  })

  it('renders a transport-valid deeply nested description as inert text without crashing', () => {
    const text = '> '.repeat(2_000) + 'hello'
    expect(text).toHaveLength(4_005)
    const schema = JSON.parse(readFileSync(resolve('docs/schemas/catalog-provider-page.schema.json'), 'utf8'))
    const validate = new Ajv().compile({
      $defs: { plainText: schema.$defs.plainText },
      ...schema.$defs.item.properties.description,
    })
    expect(validate(text)).toBe(true)
    const { container } = render(<MarketDescription text={text} />)
    expect(container.querySelector('.dshMarketDescriptionLiteral')?.textContent).toBe(text)
    expect(container.querySelectorAll('blockquote, a, img')).toHaveLength(0)
  })

  it('bounds the rendered node count while preserving all oversized structure as inert text', () => {
    const text = '**word** '.repeat(400)
    expect(text.length).toBeLessThan(5_000)
    const { container } = render(<MarketDescription text={text} />)
    expect(container.querySelector('.dshMarketDescriptionLiteral')?.textContent).toBe(text)
    expect(container.querySelector('strong')).toBeNull()
  })

  it('keeps fallback text safe and preserves transport line boundaries', () => {
    const text = '> '.repeat(2_000) + '<script>bad</script>\u2028unsafe\u202e'
    const { container } = render(<MarketDescription text={text} />)
    expect(container.textContent).toBe(text.replace('\u2028', '\n').replace('\u202e', '\ufffd'))
    expect(container.querySelectorAll('script, a, img')).toHaveLength(0)
  })

  it('falls back to inert text when Markdown parsing fails', () => {
    const parser = vi.mocked(markdown.fromMarkdown).mockImplementationOnce(() => { throw new Error('Parser failure') })
    try {
      const text = '<img src="https://tracking.example/pixel">\u2028[link](javascript:bad)'
      const { container } = render(<MarketDescription text={text} />)
      expect(container.querySelector('.dshMarketDescriptionLiteral')?.textContent).toBe(text.replace('\u2028', '\n'))
      expect(container.querySelectorAll('img, a')).toHaveLength(0)
    } finally {
      parser.mockRestore()
    }
  })

  it('keeps paragraph spacing despite the existing details paragraph reset', () => {
    const removeStyles = installMarketStyles()
    try {
      const { container } = render(<div className="dshMarketDetails"><MarketDescription text={'First paragraph.\u2028\u2028Second paragraph.'} /></div>)
      const paragraphs = container.querySelectorAll('.dshMarketDescription > p')
      expect(window.getComputedStyle(paragraphs[0]!).marginTop).toBe('0px')
      expect(window.getComputedStyle(paragraphs[1]!).marginTop).toBe('12px')
    } finally {
      removeStyles()
    }
  })

  it('uses normal paragraph whitespace for soft breaks while retaining explicit hard breaks', () => {
    const removeStyles = installMarketStyles()
    try {
      const { container } = render(<div className="dshMarketDetails"><MarketDescription text={'Soft\u2028continuation.\u2028\u2028Hard  \u2028break.'} /></div>)
      const paragraphs = container.querySelectorAll('.dshMarketDescription > p')
      expect(window.getComputedStyle(paragraphs[0]!).whiteSpace).toBe('normal')
      expect(paragraphs[0]!.querySelector('br')).toBeNull()
      expect(paragraphs[1]!.querySelectorAll('br')).toHaveLength(1)
    } finally {
      removeStyles()
    }
  })

  it('supports paragraph separators and safe reference links without exposing definitions', () => {
    render(<MarketDescription text={'## Overview\u2029\u2029[Project][repo]\u2029\u2029[repo]: https://example.org/project "Documentation"'} />)
    expect(screen.getByRole('heading').textContent).toBe('Overview')
    const link = screen.getByRole('link', { name: 'Project' })
    expect(link.getAttribute('href')).toBe('https://example.org/project')
    expect(link.getAttribute('title')).toBe('Documentation')
    expect(screen.queryByText('[repo]:')).toBeNull()
  })

  it('shows raw HTML as literal text without creating executable elements', () => {
    const html = '<script>window.marketInjected = true</script>\u2028\u2028<img src="https://tracking.example/pixel" onerror="alert(1)">'
    const { container } = render(<MarketDescription text={html} />)
    expect(container.textContent).toContain('<script>window.marketInjected = true</script>')
    expect(container.textContent).toContain('<img src="https://tracking.example/pixel" onerror="alert(1)">')
    expect(container.querySelectorAll('script, img, iframe, style')).toHaveLength(0)
  })

  it('never loads Markdown images, including images nested in links and reference images', () => {
    const text = [
      '![remote diagram](https://tracking.example/pixel.png)',
      '[![linked image](https://tracking.example/linked.png)](https://example.org/guide)',
      '![reference image][pixel]', '', '[pixel]: https://tracking.example/reference.png',
    ].join('\u2028')
    const { container } = render(<MarketDescription text={text} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('remote diagram')
    expect(container.textContent).toContain('reference image')
    expect(container.querySelector('[src]')).toBeNull()
    expect(screen.getByRole('link', { name: 'linked image' }).getAttribute('href')).toBe('https://example.org/guide')
  })

  it('neutralizes controls and bidi characters decoded from text entities', () => {
    const { container } = render(<MarketDescription text={'A&#x202e;txt.exe&#x202c; &#x1b; &#x2066;safe&#x2069;'} />)
    expect(container.textContent).toBe('A\ufffdtxt.exe\ufffd \ufffd \ufffdsafe\ufffd')
    expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(container.textContent!)).toBe(false)
  })

  it('neutralizes decoded controls in both inline and reference link titles', () => {
    render(<MarketDescription text={'[Inline](https://example.org/ "A&#x2066;docs&#x2069;&#x1b;")\u2028\u2028[Reference][ref]\u2028\u2028[ref]: https://example.org/ref "B&#x202e;docs&#x202c;"'} />)
    expect(screen.getByRole('link', { name: 'Inline' }).getAttribute('title')).toBe('A\ufffddocs\ufffd\ufffd')
    expect(screen.getByRole('link', { name: 'Reference' }).getAttribute('title')).toBe('B\ufffddocs\ufffd')
  })

  it('neutralizes decoded controls in image alternate text without loading images', () => {
    const { container } = render(<MarketDescription text={'![A&#x202e;image&#x202c;&#x1f;](https://tracking.example/pixel)'} />)
    expect(container.textContent).toBe('A\ufffdimage\ufffd\ufffd')
    expect(container.querySelector('img')).toBeNull()
  })

  it('neutralizes literal HTML and code controls while preserving code indentation and line breaks', () => {
    const { container } = render(<MarketDescription text={'<script>safe\u202ehtml\u202c</script>\u2028\u2028```text\u2028\tfirst\u202e\u2028second\u202c\u2028```'} />)
    expect(container.querySelector('.dshMarketDescriptionLiteral')?.textContent).toBe('<script>safe\ufffdhtml\ufffd</script>')
    expect(container.textContent).toContain('safe\ufffdhtml\ufffd')
    expect(container.querySelector('pre code')?.textContent).toBe('\tfirst\ufffd\nsecond\ufffd')
    expect(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(container.textContent!)).toBe(false)
  })

  it.each([
    'javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,hello',
    'http://example.org/insecure', 'file:///tmp/secret', 'mailto:person@example.org',
    '//example.org/relative', '/relative', '#fragment',
    'https://user:secret@example.org/', 'https://example.org:8443/',
    'https://example.org/&#x202e;fake',
  ])('neutralizes an unsafe link destination: %s', destination => {
    const { container } = render(<MarketDescription text={`[External project](<${destination}>)`} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('External project')
  })

  it('renders fenced code as text without interpreting markup or URLs inside it', () => {
    const { container } = render(<MarketDescription text={'```html\u2028<img src="https://tracking.example/pixel">\u2028```'} />)
    expect(container.querySelector('pre code')?.textContent).toBe('<img src="https://tracking.example/pixel">')
    expect(container.querySelectorAll('img, a')).toHaveLength(0)
  })
})
