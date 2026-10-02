import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createMediaSettings, LEGACY_TALKCRAFT_KEY, type CredentialsFace } from 'cqai-dsh-media-settings'
import { Secrets } from '../src/secrets.ts'

const directories: string[] = []
afterEach(async () => {await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true})))})
describe('TalkCraft shared material credentials', () => {
  it('shares material keys with standalone plugins while leaving Fish with its original owner', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cqai-talk-secrets-')); directories.push(home)
    const records = new Map<CredentialKey, CredentialRecord>([[LEGACY_TALKCRAFT_KEY,{kind:'grant',payload:{version:1,fish:'original-fish',pexels:'original-pexels',custom:'keep'}}]])
    const credentials: CredentialsFace = {
      readRecord: async key => structuredClone(records.get(key)),
      modifyRecord: async (key, mutate) => {const next = await mutate(structuredClone(records.get(key))); if (next) records.set(key,structuredClone(next)); return structuredClone(records.get(key))},
    }
    const store = createMediaSettings({home,credentials}), secrets = new Secrets(credentials,store)
    expect(await secrets.read()).toEqual({fish:'original-fish',pexels:'original-pexels'})
    expect(await secrets.publicState()).toEqual({fish:true,pexels:true,pixabay:false})
    expect(JSON.stringify(await secrets.publicState())).not.toContain('original-')
    await secrets.set('fish','new-fish')
    expect(records.get(LEGACY_TALKCRAFT_KEY)).toEqual({kind:'grant',payload:{version:1,fish:'new-fish',custom:'keep'}})
    await secrets.set('pixabay','talk-private')
    expect(await store.readCredential('pixabay','talkcraft')).toBe('talk-private')
    expect(await store.readCredential('pixabay','shortVideo')).toBeUndefined()
    expect((await secrets.read()).fish).toBe('new-fish')
  })
})
