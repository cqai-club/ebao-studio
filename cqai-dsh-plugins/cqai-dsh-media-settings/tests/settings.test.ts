import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { COVERR_CREDENTIAL_KEY, LEGACY_TALKCRAFT_KEY, SHARED_CREDENTIAL_KEY, createMediaSettings, createMediaSettingsHandler, mediaSettingsPermitted, type CredentialsFace } from '../src/index.ts'

class MemoryCredentials implements CredentialsFace {
  readonly records = new Map<CredentialKey, CredentialRecord>()
  private pending = Promise.resolve()
  readOverride?: (key: CredentialKey, value: CredentialRecord | undefined) => CredentialRecord | undefined
  beforeModify?: (key: CredentialKey) => Promise<void>
  async readRecord(key: CredentialKey) {
    await this.pending
    const value = structuredClone(this.records.get(key))
    return this.readOverride ? this.readOverride(key, value) : value
  }
  async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const result = this.pending.then(async () => {
      await this.beforeModify?.(key)
      const next = await mutate(structuredClone(this.records.get(key)))
      if (next) this.records.set(key, structuredClone(next))
      return structuredClone(this.records.get(key))
    })
    this.pending = result.then(() => {}, () => {})
    return result
  }
}
const directories: string[] = []
afterEach(async () => {await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true})))})
async function fixture(settings?: unknown, talk?: Record<string, unknown>) {
  const home = await mkdtemp(join(tmpdir(), 'cqai-media-settings-')); directories.push(home)
  const credentials = new MemoryCredentials()
  const file = join(home, 'short-video', 'settings.json')
  if (settings !== undefined) {await mkdir(join(home, 'short-video')); await writeFile(file, JSON.stringify(settings))}
  if (talk) credentials.records.set(LEGACY_TALKCRAFT_KEY, {kind: 'grant', payload: {version: 1, ...talk}})
  return {home, credentials, file, store: createMediaSettings({home, credentials})}
}
function request(method = 'GET', body?: unknown, headers: Record<string, string> = {}): IncomingMessage {
  return Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {
    method, url: '/api/test/media-settings', socket: {remoteAddress: '127.0.0.1'}, headers: {host: '127.0.0.1:3000', ...headers},
  }) as unknown as IncomingMessage
}
function response() {
  let status = 0, text = ''
  const res = {writeHead: (value: number) => {status = value}, end: (value: string) => {text = value}} as unknown as ServerResponse
  return {res, status: () => status, body: () => JSON.parse(text), text: () => text}
}

describe('shared media settings', () => {
  it('removes empty legacy key fields without inventing configured credentials', async () => {
    const {store, file, credentials} = await fixture({pexels_api_keys:'',pixabay_api_keys:'',coverr_api_keys:'',video_codec:'libx264'}, {pexels:'',pixabay:'',fish:'retain-fish'})
    const state = await store.readPublic('shortVideo')
    expect(state.effective).toMatchObject({pexels:false,pixabay:false,coverr:false})
    expect(JSON.parse(await readFile(file,'utf8'))).toEqual({video_codec:'libx264'})
    expect(credentials.records.get(LEGACY_TALKCRAFT_KEY)).toEqual({kind:'grant',payload:{version:1,fish:'retain-fish'}})
  })
  it('starts with portrait and the standard Xiaoxiao ID and keeps secrets out of public state', async () => {
    const {store} = await fixture()
    const first = await store.readPublic('shortVideo')
    expect(first.defaults).toEqual({aspect: '9:16', edgeVoiceId: 'zh-CN-XiaoxiaoNeural'})
    await store.setCredential({expectedRevision: first.credentialRevision, provider: 'pexels', value: 'test-private-key'})
    expect(await store.readCredential('pexels', 'shortVideo')).toBe('test-private-key')
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('test-private-key')
    expect(JSON.stringify(await store.readPublic())).not.toContain('test-private-key')
  })
  it('migrates identical keys once, separates Coverr, and preserves non-secret settings and Fish', async () => {
    const {store, credentials, file, home} = await fixture({pexels_api_keys: 'same', pixabay_api_keys: '', coverr_api_keys: 'coverr-private', subtitle_provider: 'whisper', video_codec: 'h264_nvenc', custom: {keep: true}}, {pexels: 'same', fish: 'fish-private', unknown: {keep: true}})
    const state = await store.readPublic('shortVideo')
    expect(state.providers.pexels).toEqual({configured: true, overrides: {}, conflict: false})
    expect(state.coverrConfigured).toBe(true)
    expect(await store.readCredential('coverr', 'shortVideo')).toBe('coverr-private')
    expect(await store.readCredential('coverr', 'talkcraft')).toBeUndefined()
    expect(credentials.records.has(COVERR_CREDENTIAL_KEY)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({subtitle_provider: 'whisper', video_codec: 'h264_nvenc', custom: {keep: true}})
    expect(credentials.records.get(LEGACY_TALKCRAFT_KEY)).toEqual({kind: 'grant', payload: {version: 1, fish: 'fish-private', unknown: {keep: true}}})
    expect((await createMediaSettings({home, credentials}).readPublic()).credentialRevision).toBe(state.credentialRevision)
  })
  it('keeps both engines original nonempty keys when legacy values conflict', async () => {
    const {store} = await fixture({pexels_api_keys: 'short-private', pixabay_api_keys: ''}, {pexels: 'talk-private'})
    const state = await store.readPublic()
    expect(state.providers.pexels).toEqual({configured: false, overrides: {shortVideo: true, talkcraft: true}, conflict: true})
    expect(await store.readCredential('pexels', 'shortVideo')).toBe('short-private')
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('talk-private')
    await store.setCredential({expectedRevision: state.credentialRevision, provider: 'pexels', value: 'new-shared'})
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('talk-private')
    const next = await store.readPublic()
    await store.clearOverride({expectedRevision: next.credentialRevision, engine: 'talkcraft', field: 'pexels'})
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('new-shared')
  })
  it('does not clean malformed legacy files or unsupported credential versions', async () => {
    const {store, file, credentials} = await fixture({})
    await writeFile(file, '{broken')
    await expect(store.readPublic()).rejects.toThrow('旧设置格式无效')
    expect(await readFile(file, 'utf8')).toBe('{broken')
    expect(credentials.records.size).toBe(0)
    await writeFile(file, JSON.stringify({pexels_api_keys: 'keep-private'}))
    credentials.records.set(LEGACY_TALKCRAFT_KEY, {kind: 'grant', payload: {version: 99, pexels: 'other'}})
    await expect(store.readPublic()).rejects.toThrow('版本或格式不受支持')
    expect(await readFile(file, 'utf8')).toContain('keep-private')
  })
  it('leaves the legacy source on failed read-back and resumes safely after interruption', async () => {
    const {store, file, credentials} = await fixture({pexels_api_keys: 'keep-private', video_codec: 'libx264'})
    credentials.readOverride = (key, value) => key === SHARED_CREDENTIAL_KEY ? undefined : value
    await expect(store.migrateLegacy()).rejects.toThrow('验证失败')
    expect(await readFile(file, 'utf8')).toContain('keep-private')
    credentials.readOverride = undefined
    await store.migrateLegacy()
    expect(await store.readCredential('pexels', 'shortVideo')).toBe('keep-private')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({video_codec: 'libx264'})
  })
  it.each(['short-new', ''])('retries a changed Short source without replacing TalkCraft inheritance (%j)', async changed => {
    const {store, file, credentials} = await fixture({pexels_api_keys: 'shared-old', video_codec: 'libx264'}, {pexels: 'shared-old'})
    credentials.beforeModify = async key => {
      if (key !== SHARED_CREDENTIAL_KEY) return
      credentials.beforeModify = undefined
      await writeFile(file, JSON.stringify({pexels_api_keys: changed, video_codec: 'libx264'}))
    }
    await expect(store.migrateLegacy()).rejects.toMatchObject({status: 409})
    expect(JSON.parse(await readFile(file, 'utf8')).pexels_api_keys).toBe(changed)
    await store.migrateLegacy()
    expect(await store.readCredential('pexels', 'shortVideo')).toBe(changed || undefined)
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('shared-old')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({video_codec: 'libx264'})
  })
  it('retries a changed TalkCraft credential source and preserves Short Video and Fish', async () => {
    const {store, file, credentials} = await fixture({pexels_api_keys: 'shared-old'}, {pexels: 'shared-old', fish: 'fish-keep', custom: {keep: true}})
    credentials.beforeModify = async key => {
      if (key !== LEGACY_TALKCRAFT_KEY) return
      credentials.beforeModify = undefined
      credentials.records.set(key, {kind: 'grant', payload: {version: 1, pexels: 'talk-new', fish: 'fish-keep', custom: {keep: true}}})
    }
    await expect(store.migrateLegacy()).rejects.toMatchObject({status: 409})
    expect(credentials.records.get(LEGACY_TALKCRAFT_KEY)).toMatchObject({kind: 'grant', payload: {pexels: 'talk-new'}})
    await store.migrateLegacy()
    expect(await store.readCredential('pexels', 'shortVideo')).toBe('shared-old')
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('talk-new')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({})
    expect(credentials.records.get(LEGACY_TALKCRAFT_KEY)).toEqual({kind: 'grant', payload: {version: 1, fish: 'fish-keep', custom: {keep: true}}})
  })
  it('retries a changed Coverr source after the first verified import', async () => {
    const {store, file, credentials} = await fixture({pexels_api_keys: 'shared-keep', coverr_api_keys: 'coverr-old'}, {pexels: 'shared-keep'})
    credentials.beforeModify = async key => {
      if (key !== COVERR_CREDENTIAL_KEY) return
      credentials.beforeModify = undefined
      await writeFile(file, JSON.stringify({pexels_api_keys: 'shared-keep', coverr_api_keys: 'coverr-new'}))
    }
    await expect(store.migrateLegacy()).rejects.toMatchObject({status: 409})
    expect(JSON.parse(await readFile(file, 'utf8')).coverr_api_keys).toBe('coverr-new')
    await store.migrateLegacy()
    expect(await store.readCredential('coverr', 'shortVideo')).toBe('coverr-new')
    expect(await store.readCredential('pexels', 'shortVideo')).toBe('shared-keep')
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('shared-keep')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({})
  })
  it('upgrades old boolean migration markers and imports a changed source only into its engine', async () => {
    const {store, credentials} = await fixture({pexels_api_keys: 'short-new', coverr_api_keys: 'coverr-new'}, {pexels: 'shared-old'})
    credentials.records.set(SHARED_CREDENTIAL_KEY, {kind: 'grant', payload: {
      version: 1, revision: 2, shared: {pexels: 'shared-old'}, overrides: {},
      migrated: {shortVideo: {pexels: true}, talkcraft: {pexels: true}}, legacyOwners: {pexels: 'shortVideo'}, unknown: {keep: true},
    }})
    credentials.records.set(COVERR_CREDENTIAL_KEY, {kind: 'grant', payload: {version: 1, revision: 1, value: 'coverr-old', migrated: true}})
    await store.migrateLegacy()
    expect(await store.readCredential('pexels', 'shortVideo')).toBe('short-new')
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('shared-old')
    expect(await store.readCredential('coverr', 'shortVideo')).toBe('coverr-new')
    const record = credentials.records.get(SHARED_CREDENTIAL_KEY)
    if (record?.kind !== 'grant') throw new Error('expected shared credential grant')
    const payload = record.payload as Record<string, unknown>
    expect(payload.unknown).toEqual({keep: true})
    expect(JSON.stringify(payload.migratedSnapshots)).not.toContain('shared-old')
    expect(payload.migratedSnapshots).toMatchObject({shortVideo: {pexels: expect.stringMatching(/^[a-f0-9]{64}$/)}, talkcraft: {pexels: expect.stringMatching(/^[a-f0-9]{64}$/)}})
  })
  it('allows two independently loaded plugins to migrate the same source concurrently', async () => {
    const {store, home, credentials, file} = await fixture({pexels_api_keys: 'same', coverr_api_keys: 'coverr'}, {pexels: 'same'})
    const other = createMediaSettings({home, credentials})
    await Promise.all([store.readPublic(), other.readPublic()])
    expect(await store.readCredential('pexels', 'talkcraft')).toBe('same')
    expect(await readFile(file, 'utf8')).not.toContain('api_keys')
  })
  it('serializes defaults writes and refuses stale form revisions without losing other fields', async () => {
    const {store, home, credentials} = await fixture()
    const other = createMediaSettings({home, credentials})
    const results = await Promise.allSettled([
      store.patchDefaults({expectedRevision: 0, set: {aspect: '16:9'}}),
      other.patchDefaults({expectedRevision: 0, set: {edgeVoiceId: 'zh-CN-YunxiNeural'}}),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const first = await store.readPublic()
    await store.patchDefaults({expectedRevision: first.revision, set: {aspect: '16:9'}})
    const next = await store.readPublic()
    await store.patchDefaults({expectedRevision: next.revision, engine: 'talkcraft', set: {aspect: '9:16'}})
    expect((await store.resolveNewTaskDefaults('talkcraft')).aspect).toBe('9:16')
    expect((await store.resolveNewTaskDefaults('shortVideo')).aspect).toBe('16:9')
  })
  it('isolates Coverr revision and preserves concurrent credential changes through CAS', async () => {
    const {store} = await fixture()
    const initial = await store.readPublic()
    await store.setCredential({expectedRevision: initial.coverrRevision, provider: 'coverr', value: 'coverr'})
    await store.setCredential({expectedRevision: initial.credentialRevision, provider: 'pixabay', value: 'pixabay'})
    await expect(store.setCredential({expectedRevision: initial.credentialRevision, provider: 'pexels', value: 'stale'})).rejects.toMatchObject({status: 409})
    expect(await store.readCredential('pixabay', 'shortVideo')).toBe('pixabay')
    expect(await store.readCredential('coverr', 'shortVideo')).toBe('coverr')
    const state = await store.readPublic()
    await store.setCredential({expectedRevision: state.credentialRevision, engine: 'shortVideo', provider: 'pixabay', value: null})
    expect(await store.readCredential('pixabay', 'shortVideo')).toBeUndefined()
    expect(await store.readCredential('pixabay', 'talkcraft')).toBe('pixabay')
  })
})
describe('media settings HTTP boundary', () => {
  it('returns only public status for GET and mutations and reports stale revisions', async () => {
    const {store} = await fixture()
    const handler = createMediaSettingsHandler(store, {path: '/api/test/media-settings', engine: 'shortVideo'})
    const get = response(); expect(await handler(request(), get.res)).toBe(true)
    const post = response()
    await handler(request('POST', {operation: 'credential', expectedRevision: get.body().credentialRevision, provider: 'pexels', value: 'secret-http-value'}, {'x-ejianbao': '1'}), post.res)
    expect(post.status()).toBe(200); expect(post.body().effective.pexels).toBe(true); expect(post.text()).not.toContain('secret-http-value')
    const stale = response()
    await handler(request('POST', {operation: 'credential', expectedRevision: get.body().credentialRevision, provider: 'pixabay', value: 'must-not-save'}, {'x-ejianbao': '1'}), stale.res)
    expect(stale.status()).toBe(409); expect(await store.readCredential('pixabay')).toBeUndefined()
  })
  it('checks loopback host, origin and write intent before processing credentials', async () => {
    expect(mediaSettingsPermitted(request('POST'))).toBe(false)
    expect(mediaSettingsPermitted(request('POST', {}, {'x-ejianbao': '1'}))).toBe(true)
    expect(mediaSettingsPermitted(request('GET', undefined, {host: 'attacker.invalid'}))).toBe(false)
    expect(mediaSettingsPermitted(request('GET', undefined, {origin: 'http://attacker.invalid'}))).toBe(false)
    expect(mediaSettingsPermitted(request('GET', undefined, {'sec-fetch-site': 'cross-site'}))).toBe(false)
  })
})
