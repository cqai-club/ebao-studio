import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWritingProfile, updateWritingProfile, type WritingProfileUpdate } from '../src/writing-profile.ts'
import { createContent, readContent, saveContent } from '../src/contents.ts'

const homes: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'ebao-writing-profile-'))
  homes.push(home)
  return { DSH_HOME: home }
}
function fileFor(env: NodeJS.ProcessEnv) { return join(env.DSH_HOME!, 'publisher', 'writing-profile.json') }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); vi.resetModules() })

describe('Publisher-only durable writing profile', () => {
  it('reads an empty profile without creating a directory and survives a fresh module import', async () => {
    const env = fixture()
    expect(readWritingProfile(env)).toEqual({ enabled: true, revision: 0, instructions: null })
    expect(existsSync(join(env.DSH_HOME, 'publisher'))).toBe(false)
    expect(updateWritingProfile({ expected_revision: 0, instructions: '多用短句，用第一人称讲清实践过程。' }, env))
      .toEqual({ enabled: true, revision: 1, instructions: '多用短句，用第一人称讲清实践过程。' })
    vi.resetModules()
    const reopened = await import('../src/writing-profile.ts')
    expect(reopened.readWritingProfile({ ...env })).toEqual({ enabled: true, revision: 1, instructions: '多用短句，用第一人称讲清实践过程。' })
    expect(JSON.parse(readFileSync(fileFor(env), 'utf8'))).toEqual({ enabled: true, version: 2, revision: 1, instructions: '多用短句，用第一人称讲清实践过程。' })
    expect(readdirSync(join(env.DSH_HOME, 'publisher'))).toEqual(['writing-profile.json'])
  })

  it('isolates DSH homes and preserves drafts and unrelated Publisher settings in both directions', () => {
    const first = fixture(), second = fixture()
    const draft = createContent('article', first)
    const originalDraft = readContent(draft.id, first)
    const settings = join(first.DSH_HOME, 'publisher', 'project-settings.json')
    writeFileSync(settings, '{"unchanged":"custom-root"}')
    updateWritingProfile({ expected_revision: 0, instructions: '口语化表达。' }, first)
    expect(readWritingProfile(second)).toEqual({ enabled: true, revision: 0, instructions: null })
    updateWritingProfile({ expected_revision: 0, instructions: '严谨技术说明。' }, second)
    expect(readWritingProfile(first)).toEqual({ enabled: true, revision: 1, instructions: '口语化表达。' })
    expect(readWritingProfile(second)).toEqual({ enabled: true, revision: 1, instructions: '严谨技术说明。' })
    expect(readContent(draft.id, first)).toEqual(originalDraft)
    expect(readFileSync(settings, 'utf8')).toBe('{"unchanged":"custom-root"}')
    saveContent(draft.id, { ...originalDraft, body: '只修改当前文章。' }, first)
    expect(readWritingProfile(first)).toEqual({ enabled: true, revision: 1, instructions: '口语化表达。' })
  })

  it('rejects a stale concurrent profile edit and increments the revision when clearing', () => {
    const env = fixture()
    const left = readWritingProfile(env), right = readWritingProfile(env)
    updateWritingProfile({ expected_revision: left.revision, instructions: '简洁。' }, env)
    expect(() => updateWritingProfile({ expected_revision: right.revision, instructions: '覆盖另一窗口。' }, env)).toThrow('已在其他对话更新')
    expect(readWritingProfile(env)).toEqual({ enabled: true, revision: 1, instructions: '简洁。' })
    expect(updateWritingProfile({ expected_revision: 1, instructions: null }, env)).toEqual({ enabled: true, revision: 2, instructions: null })
    expect(readWritingProfile(env)).toEqual({ enabled: true, revision: 2, instructions: null })
    expect(() => updateWritingProfile({ expected_revision: 1, instructions: '旧偏好复活。' }, env)).toThrow('已在其他对话更新')
  })

  it('reads a version 1 profile as enabled without migration writes, then upgrades it on an edit', () => {
    const env = fixture()
    mkdirSync(join(env.DSH_HOME, 'publisher'))
    const legacy = JSON.stringify({ version: 1, revision: 8, instructions: '保留原有口吻。' })
    writeFileSync(fileFor(env), legacy)
    expect(readWritingProfile(env)).toEqual({ revision: 8, instructions: '保留原有口吻。', enabled: true })
    expect(readFileSync(fileFor(env), 'utf8')).toBe(legacy)
    expect(updateWritingProfile({ expected_revision: 8, enabled: false }, env))
      .toEqual({ revision: 9, instructions: '保留原有口吻。', enabled: false })
    expect(JSON.parse(readFileSync(fileFor(env), 'utf8')))
      .toEqual({ version: 2, revision: 9, instructions: '保留原有口吻。', enabled: false })
  })

  it('retains saved rules through disabling, instructions-only edits, re-enabling and stale toggles', () => {
    const env = fixture()
    updateWritingProfile({ expected_revision: 0, instructions: '短句，口语化。' }, env)
    expect(updateWritingProfile({ expected_revision: 1, enabled: false }, env))
      .toEqual({ revision: 2, instructions: '短句，口语化。', enabled: false })
    expect(updateWritingProfile({ expected_revision: 2, instructions: '短句，保留出处。' }, env))
      .toEqual({ revision: 3, instructions: '短句，保留出处。', enabled: false })
    expect(() => updateWritingProfile({ expected_revision: 2, enabled: true }, env)).toThrow('已在其他对话更新')
    expect(updateWritingProfile({ expected_revision: 3, enabled: true }, env))
      .toEqual({ revision: 4, instructions: '短句，保留出处。', enabled: true })
    expect(updateWritingProfile({ expected_revision: 4, enabled: false, instructions: null }, env))
      .toEqual({ revision: 5, instructions: null, enabled: false })
  })

  it('counts Unicode code points and rejects oversized or malformed instruction strings', () => {
    const env = fixture()
    const instructions = '🏔'.repeat(12_000)
    updateWritingProfile({ expected_revision: 0, instructions }, env)
    expect(readWritingProfile(env).instructions).toBe(instructions)
    for (const invalid of ['🏔'.repeat(12_001), '字'.repeat(12_001), '\ud800', '\udc00']) {
      expect(() => updateWritingProfile({ expected_revision: 1, instructions: invalid }, env)).toThrow('12000')
    }
    expect(readWritingProfile(env)).toEqual({ enabled: true, revision: 1, instructions })
  })

  it('normalizes blank rules to null while preserving the formatting of nonblank rules', () => {
    const env = fixture()
    expect(updateWritingProfile({ expected_revision: 0, instructions: '', enabled: false }, env))
      .toEqual({ revision: 1, instructions: null, enabled: false })
    expect(updateWritingProfile({ expected_revision: 1, instructions: ' \n\t　' }, env))
      .toEqual({ revision: 2, instructions: null, enabled: false })
    expect(updateWritingProfile({ expected_revision: 2, instructions: '  口语化。\n\n保留出处。\n' }, env))
      .toEqual({ revision: 3, instructions: '  口语化。\n\n保留出处。\n', enabled: false })
  })

  it('retains valid escaped instructions at the character limit and refuses revision overflow', () => {
    const env = fixture()
    const escaped = '\n'.repeat(11_999) + '字'
    updateWritingProfile({ expected_revision: 0, instructions: escaped }, env)
    expect(readWritingProfile(env)).toEqual({ enabled: true, revision: 1, instructions: escaped })
    const existing = JSON.stringify({ version: 1, revision: Number.MAX_SAFE_INTEGER, instructions: '保留。' })
    writeFileSync(fileFor(env), existing)
    expect(() => updateWritingProfile({ expected_revision: Number.MAX_SAFE_INTEGER, instructions: null }, env)).toThrow('配置无效')
    expect(readFileSync(fileFor(env), 'utf8')).toBe(existing)
  })

  it('rejects invalid UTF-8 rather than replacing corrupt bytes and overwriting them', () => {
    const env = fixture()
    mkdirSync(join(env.DSH_HOME, 'publisher'))
    const existing = Buffer.concat([Buffer.from('{"version":1,"revision":1,"instructions":"'), Buffer.from([0xff]), Buffer.from('"}')])
    writeFileSync(fileFor(env), existing)
    expect(() => readWritingProfile(env)).toThrow('配置无效')
    expect(() => updateWritingProfile({ expected_revision: 1, instructions: null }, env)).toThrow('配置无效')
    expect(readFileSync(fileFor(env))).toEqual(existing)
  })

  it.each([null, [], {}, { expected_revision: 0 }, { expected_revision: -1, instructions: '风格' },
    { expected_revision: 0.5, instructions: '风格' }, { expected_revision: Number.MAX_SAFE_INTEGER + 1, instructions: '风格' },
    { expected_revision: 0, instructions: {} }, { expected_revision: 0, instructions: ['风格'] },
    { expected_revision: 0, instructions: false }, { expected_revision: 0, instructions: null, extra: true },
    { expected_revision: 0, enabled: 'false' }, { expected_revision: 0, enabled: null },
    { expected_revision: 0, enabled: undefined }, { expected_revision: 0, instructions: undefined },
  ])('rejects invalid update shape without creating or overwriting the profile: %j', input => {
    const env = fixture()
    expect(() => updateWritingProfile(input as WritingProfileUpdate, env)).toThrow('写作风格更新无效')
    expect(existsSync(fileFor(env))).toBe(false)
  })

  it.each(['{broken', 'null', '[]', '{}', '{"version":2,"revision":1,"instructions":"风格"}',
    '{"version":2,"revision":1,"instructions":"风格","enabled":"false"}',
    '{"version":2,"revision":1,"instructions":null,"enabled":true,"extra":false}',
    '{"version":1,"revision":-1,"instructions":null}', '{"version":1,"revision":0.5,"instructions":null}',
    '{"version":1,"revision":1,"instructions":{}}', '{"version":1,"revision":1,"instructions":null,"extra":true}',
    JSON.stringify({ version: 1, revision: 1, instructions: '长'.repeat(12_001) }), ' '.repeat(96 * 1024 + 1),
  ])('keeps corrupt existing bytes untouched on read and update', bytes => {
    const env = fixture()
    mkdirSync(join(env.DSH_HOME, 'publisher'))
    writeFileSync(fileFor(env), bytes)
    expect(() => readWritingProfile(env)).toThrow('写作风格配置无效')
    expect(() => updateWritingProfile({ expected_revision: 0, instructions: '不能默默覆盖。' }, env)).toThrow('写作风格配置无效')
    expect(readFileSync(fileFor(env), 'utf8')).toBe(bytes)
    expect(readdirSync(join(env.DSH_HOME, 'publisher'))).toEqual(['writing-profile.json'])
  })

  it('rejects a directory or linked profile and a linked Publisher root', () => {
    const env = fixture()
    mkdirSync(fileFor(env), { recursive: true })
    expect(() => readWritingProfile(env)).toThrow('写作风格配置无效')
    rmSync(fileFor(env), { recursive: true })
    const outside = fixture()
    writeFileSync(join(outside.DSH_HOME, 'keep.txt'), '保留')
    symlinkSync(outside.DSH_HOME, fileFor(env), 'junction')
    expect(() => updateWritingProfile({ expected_revision: 0, instructions: null }, env)).toThrow('写作风格配置无效')
    const linked = fixture()
    symlinkSync(outside.DSH_HOME, join(linked.DSH_HOME, 'publisher'), 'junction')
    expect(() => readWritingProfile(linked)).toThrow('写作风格配置无效')
    expect(() => updateWritingProfile({ expected_revision: 0, instructions: null }, linked)).toThrow('写作风格配置无效')
    expect(readFileSync(join(outside.DSH_HOME, 'keep.txt'), 'utf8')).toBe('保留')
    expect(existsSync(fileFor(outside))).toBe(false)
  })
})
