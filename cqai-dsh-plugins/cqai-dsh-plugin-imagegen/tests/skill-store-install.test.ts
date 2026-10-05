import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFromArchive, installFromUrl, listLibrary, listLocalSkills } from '../src/skill-store.ts'

const processMock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: processMock.spawn }))

type ArchiveFile = { name: string; body: string; mode?: number }

/** Small stored ZIP fixtures; no installed support file is ever executed. */
function zip(files: ArchiveFile[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const body = Buffer.from(file.body)
    const entry = Buffer.alloc(30 + name.length)
    entry.writeUInt32LE(0x04034b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt32LE(body.length, 18)
    entry.writeUInt32LE(body.length, 22)
    entry.writeUInt16LE(name.length, 26)
    name.copy(entry, 30)
    local.push(entry, body)
    const head = Buffer.alloc(46 + name.length)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(20, 6)
    head.writeUInt32LE(body.length, 20)
    head.writeUInt32LE(body.length, 24)
    head.writeUInt16LE(name.length, 28)
    head.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38)
    head.writeUInt32LE(offset, 42)
    name.copy(head, 46)
    central.push(head)
    offset += entry.length + body.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

const markdown = (name: string): string => `---\nname: ${name}\ndescription: A fixture skill\n---\n\n# ${name}\n`
const fixture = (folder = 'skills/image-to-editable-ppt'): ArchiveFile[] => [
  { name: 'repo-main/README.md', body: 'Repository overview' },
  { name: 'repo-main/.github/workflows/check.yml', body: 'fixture only' },
  { name: 'repo-main/assets/preview.txt', body: 'preview' },
  { name: 'repo-main/docs/install.md', body: 'documentation' },
  { name: 'repo-main/tests/fixture.txt', body: 'tests' },
  { name: `repo-main/${folder}/SKILL.md`, body: markdown('image-to-editable-ppt') },
  { name: `repo-main/${folder}/cli/support.txt`, body: 'bundled CLI support' },
  { name: `repo-main/${folder}/references/guide.md`, body: 'bundled reference' },
]

describe('skill source installation', () => {
  let directory: string
  let root: string
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-install-test-'))
    root = path.join(directory, 'skills')
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    processMock.spawn.mockReset()
    await fs.rm(directory, { recursive: true, force: true })
  })
  function downloadArchive(files: ArchiveFile[]) {
    const archive = zip(files)
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array(archive), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }
  async function installedFiles(): Promise<string[]> {
    return fs.readdir(root).catch(() => [])
  }

  it('finds the nested skill in the reported repository shape and preserves the complete bundle', async () => {
    const fetch = downloadArchive(fixture())
    expect(await installFromUrl('https://github.com/ningzimu/image-to-editable-ppt-skill', root, { force: false })).toBe('image-to-editable-ppt')
    expect(fetch.mock.calls[0][0]).toBe('https://codeload.github.com/ningzimu/image-to-editable-ppt-skill/zip/HEAD')
    expect(await fs.readFile(path.join(root, 'image-to-editable-ppt/cli/support.txt'), 'utf8')).toBe('bundled CLI support')
    expect(await fs.readFile(path.join(root, 'image-to-editable-ppt/references/guide.md'), 'utf8')).toBe('bundled reference')
    expect(await fs.readdir(path.join(root, 'image-to-editable-ppt'))).not.toContain('README.md')
    const library = await listLibrary({ root, networkAvailable: false })
    expect(library.entries).toMatchObject([{ name: 'image-to-editable-ppt' }])
    expect(await listLocalSkills(root)).toMatchObject([{ name: 'image-to-editable-ppt', content: '# image-to-editable-ppt' }])
  })

  it('requires an explicit directory for a repository with multiple separate skills', async () => {
    const files = [...fixture(), { name: 'repo-main/skills/second-skill/SKILL.md', body: markdown('second-skill') }]
    downloadArchive(files)
    await expect(installFromUrl('https://github.com/o/repo', root, { force: true })).rejects.toThrow(/多个技能.*具体技能目录/)
    expect(await installedFiles()).toEqual([])
    expect(await installFromUrl('https://github.com/o/repo/tree/main/skills/second-skill', root, { force: false })).toBe('second-skill')
    expect(await installedFiles()).toEqual(['second-skill'])
  })

  it('resolves a GitHub SKILL.md blob within its wrapper and installs its surrounding files', async () => {
    downloadArchive(fixture())
    expect(await installFromUrl('https://github.com/o/repo/blob/main/skills/image-to-editable-ppt/SKILL.md', root, { force: false })).toBe('image-to-editable-ppt')
    expect(await fs.readFile(path.join(root, 'image-to-editable-ppt/cli/support.txt'), 'utf8')).toBe('bundled CLI support')
  })

  it('never falls back to the entire repository when the requested subdirectory is missing', async () => {
    downloadArchive(fixture())
    await expect(installFromUrl('https://github.com/o/repo/tree/main/skills/missing', root, { force: false })).rejects.toThrow(/指定的技能目录不存在/)
    expect(await installedFiles()).toEqual([])
  })

  it.each([
    'https://github.com/o/repo/tree/main/skills/image-to-editable-ppt/SKILL.md',
    'https://github.com/o/repo/blob/main/README.md',
  ])('requires the linked tree to be a directory or the blob to be SKILL.md: %s', async source => {
    downloadArchive(fixture())
    await expect(installFromUrl(source, root, { force: false })).rejects.toThrow(/技能目录或 SKILL.md 链接/)
    expect(await installedFiles()).toEqual([])
  })

  it('decodes folder and branch links once and permits safe names beginning with two dots', async () => {
    const fetch = downloadArchive(fixture('skills/..folder 中文'))
    expect(await installFromUrl('https://github.com/o/repo/tree/feature%2Fdeck/skills/..folder%20%E4%B8%AD%E6%96%87', root, { force: false })).toBe('image-to-editable-ppt')
    expect(fetch.mock.calls[0][0]).toBe('https://codeload.github.com/o/repo/zip/feature%2Fdeck')
  })

  it.each(['%2e%2e/escape', '%2Fescape', 'C:%5Cescape', 'skills/%00bad', 'skills/../image-to-editable-ppt'])('refuses unsafe GitHub subpaths: %s', async subpath => {
    downloadArchive(fixture())
    await expect(installFromUrl(`https://github.com/o/repo/tree/main/${subpath}`, root, { force: false })).rejects.toThrow(/路径不合法/)
    expect(await installedFiles()).toEqual([])
  })

  it('refuses a GitHub archive without a unique repository wrapper', async () => {
    downloadArchive([...fixture(), { name: 'other/README.md', body: 'second root' }])
    await expect(installFromUrl('https://github.com/o/repo', root, { force: false })).rejects.toThrow(/唯一仓库目录/)
    expect(await installedFiles()).toEqual([])
  })

  it('treats supporting examples inside an existing bundle as part of that bundle', async () => {
    expect(await installFromArchive(zip([
      { name: 'bundle/SKILL.md', body: markdown('parent-skill') },
      { name: 'bundle/examples/example/SKILL.md', body: markdown('example-skill') },
    ]), root, 'ignored', false)).toBe('parent-skill')
    expect(await fs.readFile(path.join(root, 'parent-skill/examples/example/SKILL.md'), 'utf8')).toContain('example-skill')
  })

  it('does not ignore unseen candidates beyond the depth or directory limits', async () => {
    const deep = `${Array.from({ length: 14 }, (_, index) => `level-${index}`).join('/')}/SKILL.md`
    await expect(installFromArchive(zip([{ name: deep, body: markdown('too-deep') }]), root, 'ignored', false)).rejects.toThrow(/搜索超过上限/)
    const many = Array.from({ length: 1_001 }, (_, index) => ({ name: `repo/folder-${index}/child/file.txt`, body: 'fixture' }))
    many.push({ name: 'repo/valid/SKILL.md', body: markdown('valid-skill') })
    await expect(installFromArchive(zip(many), root, 'ignored', false)).rejects.toThrow(/搜索超过上限/)
    expect(await installedFiles()).toEqual([])
  })

  it('validates bounded support directories before replacing an existing installation', async () => {
    await fs.mkdir(path.join(root, 'parent-skill'), { recursive: true })
    await fs.writeFile(path.join(root, 'parent-skill/keep.txt'), 'previous install')
    const files = [
      { name: 'bundle/SKILL.md', body: markdown('parent-skill') },
      { name: `bundle/${Array.from({ length: 13 }, () => 'support').join('/')}/file.txt`, body: 'support' },
    ]
    await expect(installFromArchive(zip(files), root, 'ignored', true)).rejects.toThrow(/技能内容超过/)
    expect(await fs.readFile(path.join(root, 'parent-skill/keep.txt'), 'utf8')).toBe('previous install')
  })

  it('keeps the existing frontmatter requirements before installing', async () => {
    await expect(installFromArchive(zip([{ name: 'nested/bad/SKILL.md', body: '---\nname: Invalid_Name\ndescription: fixture\n---\nBody' }]), root, 'fallback', false)).rejects.toThrow(/kebab-case/)
    await expect(installFromArchive(zip([{ name: 'nested/bad/SKILL.md', body: '---\nname: valid-name\n---\nBody' }]), root, 'fallback', false)).rejects.toThrow(/description/)
    expect(await installedFiles()).toEqual([])
  })

  it.each(['../outside/SKILL.md', '/outside/SKILL.md', 'C:/outside/SKILL.md'])('refuses archive paths that could leave staging: %s', async name => {
    await expect(installFromArchive(zip([{ name, body: markdown('unsafe-skill') }]), root, 'ignored', false)).rejects.toThrow(/不安全的文件路径/)
    expect(await installedFiles()).toEqual([])
  })

  it('refuses ZIP symlinks rather than promoting them as support files', async () => {
    await expect(installFromArchive(zip([
      { name: 'bundle/SKILL.md', body: markdown('linked-skill') },
      { name: 'bundle/scripts/outside', body: '../outside', mode: 0o120777 },
    ]), root, 'ignored', false)).rejects.toThrow(/符号链接/)
    expect(await installedFiles()).toEqual([])
  })

  it.each(['SKILL.md', 'scripts/support.txt'])('does not follow a cloned bundle symlink: %s', async linked => {
    const outside = path.join(directory, 'outside.txt')
    await fs.writeFile(outside, markdown('linked-skill'))
    processMock.spawn.mockImplementation((_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
      const repository = args.at(-1)!
      void (async () => {
        await fs.mkdir(path.join(repository, 'scripts'), { recursive: true })
        if (linked !== 'SKILL.md') await fs.writeFile(path.join(repository, 'SKILL.md'), markdown('linked-skill'))
        await fs.symlink(outside, path.join(repository, linked))
        child.emit('close', 0)
      })().catch(error => child.emit('error', error))
      return child
    })
    await expect(installFromUrl('https://git.example.com/team/skill.git', root, { force: false })).rejects.toThrow(/符号链接/)
    expect(processMock.spawn.mock.calls[0][1]).toContain('--')
    expect(await fs.readFile(outside, 'utf8')).toContain('linked-skill')
    expect(await installedFiles()).toEqual([])
  })

  it('refuses a truncated directory and archives exceeding the shared ZIP entry cap', async () => {
    const broken = zip(fixture())
    broken.writeUInt16LE(fixture().length + 1, broken.length - 22 + 8)
    broken.writeUInt16LE(fixture().length + 1, broken.length - 22 + 10)
    await expect(installFromArchive(broken, root, 'ignored', false)).rejects.toThrow(/目录不完整/)
    const tooMany = Array.from({ length: 2_001 }, (_, index) => ({ name: `repo/file-${index}.txt`, body: 'fixture' }))
    await expect(installFromArchive(zip(tooMany), root, 'ignored', false)).rejects.toThrow(/文件数量超过上限/)
    expect(await installedFiles()).toEqual([])
  })

  it('preserves empty support files and refuses unsupported entries instead of installing a partial tree', async () => {
    const files = [...fixture(), { name: 'repo-main/skills/image-to-editable-ppt/support/empty.txt', body: '' }]
    expect(await installFromArchive(zip(files), root, 'ignored', false)).toBe('image-to-editable-ppt')
    expect((await fs.stat(path.join(root, 'image-to-editable-ppt/support/empty.txt'))).size).toBe(0)
    const unsupported = zip(files)
    const directoryOffset = unsupported.readUInt32LE(unsupported.length - 22 + 16)
    unsupported.writeUInt16LE(99, directoryOffset + 10)
    await expect(installFromArchive(unsupported, root, 'ignored', true)).rejects.toThrow(/损坏或不支持/)
    expect((await fs.stat(path.join(root, 'image-to-editable-ppt/support/empty.txt'))).size).toBe(0)
  })
})
