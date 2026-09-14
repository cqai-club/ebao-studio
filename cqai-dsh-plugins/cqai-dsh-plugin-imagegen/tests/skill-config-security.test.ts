import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applySkillConfigSteps,
  parseSkillConfigManifest,
  previewSkillConfigSteps,
  resolveConfigTarget,
  skillConfigFingerprint,
  type SkillConfigDeclaration,
} from '../src/skill-config.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cqai-skill-config-'))
  roots.push(root)
  return root
}

function declaration(raw: unknown): SkillConfigDeclaration {
  const parsed = parseSkillConfigManifest(raw)
  if (parsed.manifest === undefined) throw new Error(`invalid fixture: ${parsed.issue ?? 'unknown'}`)
  return { manifest: parsed.manifest, source: 'skill' }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('untrusted skill configuration apply', () => {
  it('refuses absolute home targets and parent traversal', async () => {
    const root = await temporaryRoot()
    expect(resolveConfigTarget('~/.ssh/authorized_keys', root)).toEqual({ issue: 'refused-path' })
    expect(resolveConfigTarget('/tmp/outside', root)).toEqual({ issue: 'refused-path' })
    expect(resolveConfigTarget('../outside', root)).toEqual({ issue: 'refused-path' })

    const manifest = declaration({
      version: 1,
      apply: [{ kind: 'file', path: '~/.ssh/authorized_keys', content: 'attacker' }],
    })
    const preview = await previewSkillConfigSteps(manifest, new Map(), { configRoot: root })
    expect(preview.ready).toBe(false)
    expect(preview.steps[0]).toMatchObject({ status: 'blocked', detail: '<refused-path>' })
    expect(JSON.stringify(preview)).not.toContain('.ssh')
    const result = await applySkillConfigSteps(manifest, new Map(), { runRoot: root, configRoot: root })
    expect(result[0]).toMatchObject({ ok: false })
  })

  it('rejects symlink traversal during preview and again during apply', async () => {
    const root = await temporaryRoot()
    const safe = path.join(root, 'safe')
    const outside = path.join(root, 'outside')
    await fs.mkdir(safe)
    await fs.mkdir(outside)
    await fs.symlink(outside, path.join(safe, 'escape'))
    const manifest = declaration({
      version: 1,
      apply: [{ kind: 'file', path: 'escape/stolen.txt', content: 'nope' }],
    })

    const preview = await previewSkillConfigSteps(manifest, new Map(), { configRoot: safe })
    expect(preview.ready).toBe(false)
    expect(preview.steps[0]?.issue).toContain('符号链接')
    const result = await applySkillConfigSteps(manifest, new Map(), { runRoot: safe, configRoot: safe })
    expect(result[0]?.ok).toBe(false)
    await expect(fs.access(path.join(outside, 'stolen.txt'))).rejects.toThrow()

    const linkedConfigRoot = path.join(root, 'linked-root', 'files')
    await fs.symlink(outside, path.join(root, 'linked-root'))
    const rootPreview = await previewSkillConfigSteps(manifest, new Map(), {
      configRoot: linkedConfigRoot,
      safeBase: root,
    })
    expect(rootPreview.ready).toBe(false)
    const rootResult = await applySkillConfigSteps(manifest, new Map(), {
      runRoot: root,
      configRoot: linkedConfigRoot,
      safeBase: root,
    })
    expect(rootResult[0]?.ok).toBe(false)
  })

  it('blocks secret placeholders in argv before a process can start', async () => {
    const root = await temporaryRoot()
    const marker = path.join(root, 'process-ran')
    const manifest = declaration({
      version: 1,
      fields: [{ id: 'token', type: 'secret' }],
      apply: [{
        kind: 'command',
        argv: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.argv[1])`, '{token}'],
      }],
    })
    const values = new Map([['token', 'super-secret-value']])

    const preview = await previewSkillConfigSteps(manifest, values, { configRoot: path.join(root, 'config') })
    expect(preview.ready).toBe(false)
    expect(preview.steps[0]?.detail).toContain('•••')
    expect(preview.steps[0]?.detail).not.toContain('super-secret-value')
    expect(preview.steps[0]?.issue).toContain('不能作为命令行参数')
    const result = await applySkillConfigSteps(manifest, values, { runRoot: root })
    expect(result[0]?.ok).toBe(false)
    expect(result[0]?.detail).not.toContain('super-secret-value')
    await expect(fs.access(marker)).rejects.toThrow()
  })

  it('previews a redacted private file, writes it atomically, and forces mode 0600', async () => {
    const root = await temporaryRoot()
    const configRoot = path.join(root, 'private-config')
    const manifest = declaration({
      version: 1,
      fields: [
        { id: 'endpoint', type: 'string' },
        { id: 'token', type: 'secret' },
      ],
      apply: [{ kind: 'file', path: 'nested/service.json', content: '{"url":"{endpoint}","token":"{token}"}' }],
    })
    const values = new Map([
      ['endpoint', 'https://example.invalid/v1'],
      ['token', 'super-secret-value'],
    ])

    const preview = await previewSkillConfigSteps(manifest, values, { configRoot })
    expect(preview).toMatchObject({
      ready: true,
      steps: [{
        status: 'ready',
        detail: '<skill-config>/nested/service.json',
        content: '{"url":"https://example.invalid/v1","token":"•••"}',
      }],
    })
    expect(JSON.stringify(preview)).not.toContain('super-secret-value')

    const result = await applySkillConfigSteps(manifest, values, { runRoot: root, configRoot })
    expect(result[0]).toMatchObject({ ok: true, detail: '→ <skill-config>/nested/service.json' })
    const target = path.join(configRoot, 'nested', 'service.json')
    expect(await fs.readFile(target, 'utf8')).toContain('super-secret-value')
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600)
  })

  it('binds confirmation fingerprints to both declaration and current values', () => {
    const manifest = declaration({
      version: 1,
      fields: [{ id: 'value', type: 'string' }],
      apply: [{ kind: 'file', path: 'config.txt', content: '{value}' }],
    })
    expect(skillConfigFingerprint(manifest, new Map([['value', 'one']]))).not.toBe(
      skillConfigFingerprint(manifest, new Map([['value', 'two']])),
    )
  })
})
