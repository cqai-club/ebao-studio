import { describe, expect, it } from 'vitest'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import {
  IMAGEGEN_SECRET_CREDENTIAL,
  ImageGenSecretVault,
  readImageGenSecretPayload,
  type ImageGenCredentials,
  type LegacySettingsSeam,
} from '../src/secret-vault.ts'

class MemoryCredentials implements ImageGenCredentials {
  record?: CredentialRecord
  failWrites = false

  async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return this.record
  }

  async modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    if (this.failWrites) throw new Error('credential write refused')
    const next = await mutate(this.record)
    if (next !== undefined) this.record = next
    return this.record
  }
}

describe('ImageGenSecretVault', () => {
  it('diverts every secret path to Credentials and returns only public settings ops', async () => {
    const credentials = new MemoryCredentials()
    const vault = new ImageGenSecretVault(credentials)
    const publicOps = await vault.extractSecretOps([
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['channelSecrets', 'custom:one'], value: ' channel-key ' },
      { op: 'set', path: ['promptApiKey'], value: ' prompt-key ' },
      { op: 'set', path: ['storageAccessKey'], value: ' access-key ' },
      { op: 'set', path: ['storageSecretKey'], value: ' storage-key ' },
      { op: 'set', path: ['skillConfigSecrets'], value: { 'ppt/ocr': '  ocr-key  ' } },
    ])

    expect(publicOps).toEqual([{ op: 'set', path: ['enabled'], value: true }])
    expect(IMAGEGEN_SECRET_CREDENTIAL).toBe('cqai-dsh-plugin-imagegen/secrets')
    expect(readImageGenSecretPayload(credentials.record)).toEqual({
      version: 1,
      channelApiKeys: { 'custom:one': 'channel-key' },
      promptApiKey: 'prompt-key',
      storageAccessKey: 'access-key',
      storageSecretKey: 'storage-key',
      skillConfigSecrets: { 'ppt/ocr': '  ocr-key  ' },
    })
  })

  it('splits secrets out of whole-section replacements and clears omitted credentials', async () => {
    const credentials = new MemoryCredentials()
    const vault = new ImageGenSecretVault(credentials)
    await vault.extractSecretOps([
      { op: 'set', path: ['storageSecretKey'], value: 'old-storage-secret' },
      { op: 'set', path: ['channelSecrets', 'custom:old'], value: 'old-channel-secret' },
    ])

    const publicOps = await vault.extractSecretOps([{
      op: 'set',
      path: [],
      value: {
        enabled: false,
        promptApiKey: 'new-prompt-secret',
        channelSecrets: { 'custom:new': 'new-channel-secret' },
      },
    }])

    expect(publicOps).toEqual([{
      op: 'set',
      path: [],
      value: { enabled: false },
    }])
    expect(readImageGenSecretPayload(credentials.record)).toEqual({
      version: 1,
      channelApiKeys: { 'custom:new': 'new-channel-secret' },
      promptApiKey: 'new-prompt-secret',
      skillConfigSecrets: {},
    })
  })

  it('projects only configured flags and cannot serialize stored values', async () => {
    const credentials = new MemoryCredentials()
    const vault = new ImageGenSecretVault(credentials)
    await vault.extractSecretOps([
      { op: 'set', path: ['channelSecrets', 'custom:one'], value: 'do-not-leak-channel' },
      { op: 'set', path: ['promptApiKey'], value: 'do-not-leak-prompt' },
      { op: 'set', path: ['storageAccessKey'], value: 'do-not-leak-access-key' },
      { op: 'set', path: ['skillConfigSecrets', 'ppt/ocr'], value: 'do-not-leak-skill' },
    ])
    const projected = vault.projectDescriptor({
      value: {
        channels: [{ id: 'custom:one' }, { id: 'custom:two' }],
        channelSecrets: { 'custom:one': 'legacy-leak' },
        promptApiKey: 'legacy-prompt',
        enabled: true,
      },
      base: { storageAccessKey: 'legacy-access', storageSecretKey: 'legacy-storage', enabled: true },
      user: { skillConfigSecrets: { 'ppt/ocr': 'legacy-skill' } },
      secrets: [{ path: ['promptApiKey'], set: true }],
    })
    const wire = JSON.stringify(projected)

    expect(wire).not.toContain('do-not-leak')
    expect(wire).not.toContain('legacy-leak')
    expect(wire).not.toContain('legacy-prompt')
    expect(wire).not.toContain('legacy-storage')
    expect(wire).not.toContain('legacy-access')
    expect(wire).not.toContain('legacy-skill')
    expect(projected.value).toEqual({ channels: [{ id: 'custom:one' }, { id: 'custom:two' }], enabled: true })
    expect(projected.secrets).toEqual(expect.arrayContaining([
      { path: ['promptApiKey'], set: true },
      { path: ['storageAccessKey'], set: true },
      { path: ['storageSecretKey'], set: false },
      { path: ['channelSecrets', 'custom:one'], set: true },
      { path: ['channelSecrets', 'custom:two'], set: false },
      { path: ['skillConfigSecrets', 'ppt/ocr'], set: true },
    ]))
  })

  it('migrates legacy settings write-first and deletes them only after success', async () => {
    const credentials = new MemoryCredentials()
    const calls: Array<{ ops: unknown; revision?: number }> = []
    const settings: LegacySettingsSeam = {
      describe: () => [{
        ns: 'dsh-imagegen',
        revision: 7,
        value: {
          channels: [{ id: 'custom:a' }],
          defaultChannelId: 'custom:a',
          channelSecrets: { 'custom:a': 'old-channel' },
          promptApiKey: 'old-prompt',
          storageAccessKey: 'old-access',
          storageSecretKey: 'old-storage',
          skillConfigSecrets: { 'skill/token': 'old-skill' },
          apiKey: 'older-flat-key',
        },
        user: {
          channelSecrets: { 'custom:a': 'old-channel' },
          promptApiKey: 'old-prompt',
          storageAccessKey: 'old-access',
          storageSecretKey: 'old-storage',
          skillConfigSecrets: { 'skill/token': 'old-skill' },
          apiKey: 'older-flat-key',
        },
      }],
      mutate: async (_ns, ops, revision) => {
        // Credentials must already contain the complete payload when deletion starts.
        expect(readImageGenSecretPayload(credentials.record).channelApiKeys['custom:a']).toBe('old-channel')
        expect(readImageGenSecretPayload(credentials.record).storageAccessKey).toBe('old-access')
        calls.push({ ops, revision })
      },
    }
    const vault = new ImageGenSecretVault(credentials)
    await expect(vault.migrateLegacySettings(settings, 'dsh-imagegen')).resolves.toBe(true)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.revision).toBe(7)
    expect(calls[0]?.ops).toEqual(expect.arrayContaining([
      { op: 'unset', path: ['channelSecrets'] },
      { op: 'unset', path: ['promptApiKey'] },
      { op: 'unset', path: ['storageAccessKey'] },
      { op: 'unset', path: ['storageSecretKey'] },
      { op: 'unset', path: ['skillConfigSecrets'] },
      { op: 'unset', path: ['apiKey'] },
    ]))
  })

  it('leaves legacy settings untouched when the credential write fails', async () => {
    const credentials = new MemoryCredentials()
    credentials.failWrites = true
    let settingsWrites = 0
    const settings: LegacySettingsSeam = {
      describe: () => [{
        ns: 'dsh-imagegen',
        revision: 1,
        value: { promptApiKey: 'must-survive' },
        user: { promptApiKey: 'must-survive' },
      }],
      mutate: async () => { settingsWrites += 1 },
    }
    const vault = new ImageGenSecretVault(credentials)
    await expect(vault.migrateLegacySettings(settings, 'dsh-imagegen')).rejects.toThrow('credential write refused')
    expect(settingsWrites).toBe(0)
  })

  it('refuses malformed legacy secret dictionaries before cleanup', async () => {
    const credentials = new MemoryCredentials()
    let settingsWrites = 0
    const settings: LegacySettingsSeam = {
      describe: () => [{
        ns: 'dsh-imagegen',
        revision: 1,
        value: { channelSecrets: { 'custom:valid': 'keep-me', broken: 42 } },
        user: { channelSecrets: { 'custom:valid': 'keep-me', broken: 42 } },
      }],
      mutate: async () => { settingsWrites += 1 },
    }
    const vault = new ImageGenSecretVault(credentials)
    await expect(vault.migrateLegacySettings(settings, 'dsh-imagegen')).rejects.toThrow('invalid secret dictionary')
    expect(credentials.record).toBeUndefined()
    expect(settingsWrites).toBe(0)
  })

  it('keeps the credential copy when legacy cleanup fails, making retry safe', async () => {
    const credentials = new MemoryCredentials()
    const settings: LegacySettingsSeam = {
      describe: () => [{
        ns: 'dsh-imagegen',
        revision: 1,
        value: { promptApiKey: 'survives-cleanup-failure' },
        user: { promptApiKey: 'survives-cleanup-failure' },
      }],
      mutate: async () => { throw new Error('settings unavailable') },
    }
    const vault = new ImageGenSecretVault(credentials)
    await expect(vault.migrateLegacySettings(settings, 'dsh-imagegen')).rejects.toThrow('settings unavailable')
    expect(readImageGenSecretPayload(credentials.record).promptApiKey).toBe('survives-cleanup-failure')
  })
})
