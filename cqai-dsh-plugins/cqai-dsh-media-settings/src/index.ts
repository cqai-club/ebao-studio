import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { MediaDefaults, MediaEngine, MediaProvider, MediaSettingsMutation, MediaSettingsPublic } from './contracts.ts'

export type CredentialsFace = {
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>
  modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined>
}
type JsonObject = Record<string, unknown>
type Keys = Partial<Record<'pexels' | 'pixabay', string>>
type SecretDocument = JsonObject & {
  version: 1; revision: number; shared: Keys; overrides: Partial<Record<MediaEngine, Keys>>
  migrated: Partial<Record<MediaEngine, Partial<Record<'pexels' | 'pixabay', boolean>>>>
  migratedSnapshots: Partial<Record<MediaEngine, Partial<Record<'pexels' | 'pixabay', string>>>>
  legacyOwners: Partial<Record<'pexels' | 'pixabay', MediaEngine>>
}
type DefaultsDocument = JsonObject & {version: 1; revision: number; defaults: MediaDefaults; overrides: MediaSettingsPublic['overrides']}
type CoverrDocument = JsonObject & {version: 1; revision: number; value?: string; migrated?: boolean; migratedSnapshot?: string}
export const SHARED_CREDENTIAL_KEY = credentialKey('cqai-dsh-media-settings', 'services')
export const COVERR_CREDENTIAL_KEY = credentialKey('cqai-dsh-plugin-short-video', 'coverr')
export const LEGACY_TALKCRAFT_KEY = credentialKey('cqai-dsh-plugin-talkcraft', 'services')
export const MEDIA_DEFAULTS: MediaDefaults = {aspect: '9:16', edgeVoiceId: 'zh-CN-XiaoxiaoNeural'}
const providers = ['pexels', 'pixabay'] as const
const engines = ['shortVideo', 'talkcraft'] as const
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const engine = (value: unknown): value is MediaEngine => engines.includes(value as MediaEngine)
const voice = (value: unknown): value is string => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-[A-Z]{2}-[A-Za-z0-9-]{1,70}Neural(?:-V[0-9]+)?$/.test(value)
const clone = <T>(value: T): T => structuredClone(value)
const sourceSnapshot = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const snapshot = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export class MediaSettingsError extends Error {
  constructor(message: string, readonly status = 400) {super(message)}
}
function assertRevision(expected: number, actual: number): void {
  if (!revision(expected)) throw new MediaSettingsError('设置版本无效')
  if (expected !== actual) throw new MediaSettingsError('设置已在另一处更新，请刷新后重试', 409)
}
function defaultFields(value: unknown): Partial<MediaDefaults> {
  if (!object(value) || Object.keys(value).some(key => !['aspect', 'edgeVoiceId'].includes(key))) throw new MediaSettingsError('默认设置字段无效')
  if (value.aspect !== undefined && value.aspect !== '9:16' && value.aspect !== '16:9') throw new MediaSettingsError('公共画幅仅支持 9:16 或 16:9')
  if (value.edgeVoiceId !== undefined && !voice(value.edgeVoiceId)) throw new MediaSettingsError('Edge TTS 音色无效')
  return value as Partial<MediaDefaults>
}
function grantPayload(record: CredentialRecord | undefined): JsonObject | undefined {
  if (!record) return undefined
  if (record.kind !== 'grant' || !object(record.payload) || record.payload.version !== 1) throw new MediaSettingsError('视频凭据版本或格式不受支持', 500)
  return clone(record.payload)
}
function secretDocument(record: CredentialRecord | undefined): SecretDocument {
  const payload = grantPayload(record)
  if (!payload) return {version: 1, revision: 0, shared: {}, overrides: {}, migrated: {}, migratedSnapshots: {}, legacyOwners: {}}
  if (!revision(payload.revision) || !object(payload.shared) || !object(payload.overrides)
    || (payload.migrated !== undefined && !object(payload.migrated)) || (payload.migratedSnapshots !== undefined && !object(payload.migratedSnapshots))
    || (payload.legacyOwners !== undefined && !object(payload.legacyOwners))) throw new MediaSettingsError('视频凭据格式不受支持', 500)
  for (const p of providers) if (payload.shared[p] !== undefined && typeof payload.shared[p] !== 'string') throw new MediaSettingsError('视频凭据格式不受支持', 500)
  const overrides = payload.overrides
  for (const e of engines) if (overrides[e] !== undefined && (!object(overrides[e])
    || providers.some(p => (overrides[e] as JsonObject)[p] !== undefined && typeof (overrides[e] as JsonObject)[p] !== 'string'))) throw new MediaSettingsError('视频凭据覆盖格式不受支持', 500)
  const snapshots = payload.migratedSnapshots ?? {}
  for (const e of engines) if ((snapshots as JsonObject)[e] !== undefined && (!object((snapshots as JsonObject)[e])
    || providers.some(p => ((snapshots as JsonObject)[e] as JsonObject)[p] !== undefined && !snapshot(((snapshots as JsonObject)[e] as JsonObject)[p])))) throw new MediaSettingsError('视频凭据迁移标识格式不受支持', 500)
  return {...payload, migrated: payload.migrated ?? {}, migratedSnapshots: snapshots, legacyOwners: payload.legacyOwners ?? {}} as SecretDocument
}
function coverrDocument(record: CredentialRecord | undefined): CoverrDocument {
  const payload = grantPayload(record)
  if (!payload) return {version: 1, revision: 0}
  if (!revision(payload.revision) || (payload.value !== undefined && typeof payload.value !== 'string')
    || (payload.migratedSnapshot !== undefined && !snapshot(payload.migratedSnapshot))) throw new MediaSettingsError('Coverr 凭据格式不受支持', 500)
  return payload as CoverrDocument
}
export function createMediaSettings({home, credentials}: {home: string; credentials: CredentialsFace}) {
  // Each Host passes resolveDshHome(): standalone and aggregate plugins share the active application's data home.
  const filename = join(home, 'media-settings', 'settings.json')
  let migration: Promise<void> | undefined
  async function readDefaults(): Promise<DefaultsDocument> {
    let text: string
    try {text = await readFile(filename, 'utf8')} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, revision: 0, defaults: {...MEDIA_DEFAULTS}, overrides: {}}; throw error}
    let value: unknown
    try {value = JSON.parse(text)} catch {throw new MediaSettingsError('公共视频设置文件损坏，请先修复配置', 500)}
    if (!object(value) || value.version !== 1 || !revision(value.revision) || !object(value.defaults) || !object(value.overrides)) throw new MediaSettingsError('公共视频设置版本或格式不受支持', 500)
    const defaults = {...MEDIA_DEFAULTS, ...defaultFields(value.defaults)}
    for (const e of engines) if (value.overrides[e] !== undefined) defaultFields(value.overrides[e])
    return {...value, defaults} as DefaultsDocument
  }
  async function mutateDefaults(expected: number, change: (current: DefaultsDocument) => void): Promise<void> {
    await mkdir(dirname(filename), {recursive: true, mode: 0o700})
    await withFileLock(filename, async () => {
      const current = await readDefaults(); assertRevision(expected, current.revision)
      change(current); current.revision++
      await writeFileAtomic(filename, JSON.stringify(current, null, 2), {mode: 0o600, dirMode: 0o700})
    })
  }
  async function importKeys(e: MediaEngine, values: Keys): Promise<void> {
    await credentials.modifyRecord(SHARED_CREDENTIAL_KEY, async record => {
      const current = secretDocument(record); let changed = false
      for (const p of providers) {
        // Missing fields were already cleaned (or were never configured). They must not clear imported keys.
        const source = values[p]
        if (source === undefined) continue
        const imported = sourceSnapshot(source), value = source.trim()
        if (current.migratedSnapshots[e]?.[p] === imported) continue
        const previouslyImported = current.migrated[e]?.[p] || current.migratedSnapshots[e]?.[p] !== undefined
        if (previouslyImported) {
          // A changed legacy source belongs only to this engine. Keep the other engine's current effective key.
          // Boolean markers from older records are upgraded without resetting a value that already matches.
          if ((current.overrides[e]?.[p] ?? current.shared[p] ?? '') !== value) current.overrides[e] = {...current.overrides[e], [p]: value}
        } else if (value) {
          const existing = current.shared[p]
          const otherOverrides = engines.some(owner => current.overrides[owner]?.[p] !== undefined)
          if (existing && existing !== value) {
            const owner = current.legacyOwners[p]
            if (owner) {
              for (const other of engines) if (other !== e && current.overrides[other]?.[p] === undefined) current.overrides[other] = {...current.overrides[other], [p]: existing}
              delete current.shared[p]; delete current.legacyOwners[p]
            }
            current.overrides[e] = {...current.overrides[e], [p]: value}
          } else if (!existing && otherOverrides) current.overrides[e] = {...current.overrides[e], [p]: value}
          else if (!existing) {current.shared[p] = value; current.legacyOwners[p] = e}
          else if (current.overrides[e]?.[p] !== undefined && current.overrides[e]?.[p] !== value) current.overrides[e] = {...current.overrides[e], [p]: value}
        }
        current.migrated[e] = {...current.migrated[e], [p]: true}
        current.migratedSnapshots[e] = {...current.migratedSnapshots[e], [p]: imported}; changed = true
      }
      if (!changed) return undefined
      current.revision++; return {kind: 'grant', payload: current}
    })
    // Verification is outside modifyRecord: the credential store must not be re-entered under its own lock.
    const confirmed = secretDocument(await credentials.readRecord(SHARED_CREDENTIAL_KEY))
    for (const p of providers) if (values[p] !== undefined) {
      // The persisted snapshot acknowledges this exact import even if a later settings edit changed its value.
      if (confirmed.migratedSnapshots[e]?.[p] !== sourceSnapshot(values[p]!)) throw new MediaSettingsError('迁移后的素材凭据验证失败，原配置已保留', 500)
    }
  }
  async function migrate(): Promise<void> {
    const source = join(home, 'short-video', 'settings.json')
    let short: JsonObject | undefined
    try {
      const text = await readFile(source, 'utf8')
      const parsed: unknown = JSON.parse(text)
      if (!object(parsed)) throw new Error('invalid settings')
      for (const p of ['pexels_api_keys', 'pixabay_api_keys', 'coverr_api_keys']) if (parsed[p] !== undefined && typeof parsed[p] !== 'string') throw new Error('invalid key')
      short = parsed
    } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new MediaSettingsError('短视频旧设置格式无效，迁移未清理原配置', 500)}
    const talkRecord = await credentials.readRecord(LEGACY_TALKCRAFT_KEY)
    const talk = grantPayload(talkRecord)
    if (talk) for (const p of providers) if (talk[p] !== undefined && typeof talk[p] !== 'string') throw new MediaSettingsError('口播视频旧素材凭据格式无效', 500)
    await importKeys('shortVideo', {pexels: short?.pexels_api_keys as string | undefined, pixabay: short?.pixabay_api_keys as string | undefined})
    await importKeys('talkcraft', {pexels: talk?.pexels as string | undefined, pixabay: talk?.pixabay as string | undefined})
    const coverrSource = short?.coverr_api_keys as string | undefined
    if (coverrSource !== undefined) {
      const coverr = coverrSource.trim(), imported = sourceSnapshot(coverrSource)
      await credentials.modifyRecord(COVERR_CREDENTIAL_KEY, async record => {
        const current = coverrDocument(record)
        if (current.migratedSnapshot === imported) return undefined
        if (!current.migrated && current.migratedSnapshot === undefined && current.value && current.value !== coverr) throw new MediaSettingsError('Coverr 已有不同密钥，原设置已保留', 409)
        if (coverr) current.value = coverr; else delete current.value
        current.migrated = true; current.migratedSnapshot = imported; current.revision++
        return {kind: 'grant', payload: current}
      })
      if (coverrDocument(await credentials.readRecord(COVERR_CREDENTIAL_KEY)).migratedSnapshot !== imported) throw new MediaSettingsError('Coverr 迁移验证失败，原配置已保留', 500)
    }
    if (short && ['pexels_api_keys', 'pixabay_api_keys', 'coverr_api_keys'].some(p => Object.hasOwn(short!, p))) {
      await withFileLock(source, async () => {
        const current: unknown = JSON.parse(await readFile(source, 'utf8'))
        if (!object(current)) throw new MediaSettingsError('短视频旧设置已改变，请重试迁移', 409)
        for (const p of ['pexels_api_keys', 'pixabay_api_keys', 'coverr_api_keys']) {
          if (current[p] !== undefined && current[p] !== short![p]) throw new MediaSettingsError('短视频旧设置已改变，原配置已保留', 409)
          delete current[p]
        }
        await writeFileAtomic(source, JSON.stringify(current, null, 2), {mode: 0o600, dirMode: 0o700})
      })
    }
    if (talk && providers.some(p => Object.hasOwn(talk, p))) {
      await credentials.modifyRecord(LEGACY_TALKCRAFT_KEY, async record => {
        const current = grantPayload(record)
        if (!current) return undefined
        for (const p of providers) {
          if (current[p] !== undefined && current[p] !== talk[p]) throw new MediaSettingsError('口播视频旧凭据已改变，原配置已保留', 409)
          delete current[p]
        }
        return {kind: 'grant', payload: current}
      })
    }
  }
  async function migrateLegacy(): Promise<void> {
    migration ??= migrate().catch(error => {migration = undefined; throw error})
    await migration
  }
  async function readPublic(e?: MediaEngine): Promise<MediaSettingsPublic> {
    if (e !== undefined && !engine(e)) throw new MediaSettingsError('视频功能无效')
    await migrateLegacy()
    const [prefs, stored, coverrStored] = await Promise.all([readDefaults(), credentials.readRecord(SHARED_CREDENTIAL_KEY), credentials.readRecord(COVERR_CREDENTIAL_KEY)])
    const keys = secretDocument(stored), coverr = coverrDocument(coverrStored)
    const provider = (p: 'pexels' | 'pixabay') => {
      const overrides: Partial<Record<MediaEngine, boolean>> = {}
      for (const owner of engines) if (keys.overrides[owner]?.[p] !== undefined) overrides[owner] = !!keys.overrides[owner]?.[p]
      const distinct = new Set([keys.shared[p], ...engines.map(owner => keys.overrides[owner]?.[p])].filter(v => v !== undefined))
      return {configured: !!keys.shared[p], overrides, conflict: distinct.size > 1}
    }
    return {
      revision: prefs.revision, credentialRevision: keys.revision, coverrRevision: coverr.revision,
      defaults: {...prefs.defaults}, overrides: clone(prefs.overrides), providers: {pexels: provider('pexels'), pixabay: provider('pixabay')}, coverrConfigured: !!coverr.value,
      ...(e ? {effective: {...prefs.defaults, ...prefs.overrides[e], pexels: !!(keys.overrides[e]?.pexels ?? keys.shared.pexels), pixabay: !!(keys.overrides[e]?.pixabay ?? keys.shared.pixabay), coverr: e === 'shortVideo' && !!coverr.value}} : {}),
    }
  }
  async function patchDefaults({expectedRevision, set, engine: e}: {expectedRevision: number; set: Partial<MediaDefaults>; engine?: MediaEngine}): Promise<void> {
    if (e !== undefined && !engine(e)) throw new MediaSettingsError('视频功能无效')
    const fields = defaultFields(set)
    await mutateDefaults(expectedRevision, current => {
      if (e) current.overrides[e] = {...current.overrides[e], ...fields}
      else current.defaults = {...current.defaults, ...fields}
    })
  }
  async function setCredential({expectedRevision, provider: p, engine: e, value}: {expectedRevision: number; provider: MediaProvider; engine?: MediaEngine; value: string | null}): Promise<void> {
    if (!['pexels', 'pixabay', 'coverr'].includes(p) || (e !== undefined && !engine(e)) || (p === 'coverr' && e === 'talkcraft')) throw new MediaSettingsError('素材凭据字段无效')
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 1000)) throw new MediaSettingsError('请输入有效密钥，清除密钥请使用清除操作')
    await migrateLegacy()
    if (p === 'coverr') {
      await credentials.modifyRecord(COVERR_CREDENTIAL_KEY, async record => {
        const current = coverrDocument(record); assertRevision(expectedRevision, current.revision)
        if (value === null) delete current.value; else current.value = value.trim()
        current.revision++; return {kind: 'grant', payload: current}
      }); return
    }
    await credentials.modifyRecord(SHARED_CREDENTIAL_KEY, async record => {
      const current = secretDocument(record); assertRevision(expectedRevision, current.revision)
      if (e) current.overrides[e] = {...current.overrides[e], [p]: value?.trim() ?? ''}
      else {if (value === null) delete current.shared[p]; else current.shared[p] = value.trim(); delete current.legacyOwners[p]}
      current.revision++; return {kind: 'grant', payload: current}
    })
  }
  async function clearOverride({expectedRevision, engine: e, field}: {expectedRevision: number; engine: MediaEngine; field: keyof MediaDefaults | 'pexels' | 'pixabay'}): Promise<void> {
    if (!engine(e)) throw new MediaSettingsError('视频功能无效')
    if (field === 'aspect' || field === 'edgeVoiceId') await mutateDefaults(expectedRevision, current => {if (current.overrides[e]) delete current.overrides[e]![field]})
    else if (field === 'pexels' || field === 'pixabay') {
      await migrateLegacy()
      await credentials.modifyRecord(SHARED_CREDENTIAL_KEY, async record => {
        const current = secretDocument(record); assertRevision(expectedRevision, current.revision)
        if (current.overrides[e]) delete current.overrides[e]![field]
        current.revision++; return {kind: 'grant', payload: current}
      })
    } else throw new MediaSettingsError('覆盖字段无效')
  }
  async function readCredential(p: MediaProvider, e?: MediaEngine): Promise<string | undefined> {
    if (!['pexels', 'pixabay', 'coverr'].includes(p) || (e !== undefined && !engine(e))) throw new MediaSettingsError('素材凭据字段无效')
    await migrateLegacy()
    if (p === 'coverr') return e === 'talkcraft' ? undefined : coverrDocument(await credentials.readRecord(COVERR_CREDENTIAL_KEY)).value
    const keys = secretDocument(await credentials.readRecord(SHARED_CREDENTIAL_KEY))
    return (e ? keys.overrides[e]?.[p] ?? keys.shared[p] : keys.shared[p]) || undefined
  }
  async function resolveNewTaskDefaults(e: MediaEngine): Promise<MediaDefaults> {
    if (!engine(e)) throw new MediaSettingsError('视频功能无效')
    const prefs = await readDefaults(); return {...prefs.defaults, ...prefs.overrides[e]}
  }
  return {readPublic, patchDefaults, setCredential, clearOverride, resolveNewTaskDefaults, readCredential, migrateLegacy}
}
export type MediaSettingsStore = ReturnType<typeof createMediaSettings>

export function mediaSettingsPermitted(req: IncomingMessage, writeHeader = 'x-ejianbao'): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const host = req.headers.host
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false
  if (req.headers.origin && ![`http://${host}`, `https://${host}`].includes(req.headers.origin)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  return req.method === 'GET' || req.headers[writeHeader] === '1'
}
export function createMediaSettingsHandler(store: MediaSettingsStore, {path, engine: e, writeHeader = 'x-ejianbao'}: {path: string; engine?: MediaEngine; writeHeader?: string}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== path) return false
    const send = (status: number, body: unknown) => {res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(body))}
    if (!mediaSettingsPermitted(req, writeHeader)) {send(403, {error: '仅允许本机 Desktop 页面访问'}); return true}
    try {
      if (req.method === 'GET') send(200, await store.readPublic(e))
      else if (req.method === 'POST') {
        const parts: Buffer[] = []; let size = 0
        for await (const part of req) {size += part.length; if (size > 12000) throw new MediaSettingsError('设置请求过大'); parts.push(Buffer.from(part))}
        let value: unknown
        try {value = JSON.parse(Buffer.concat(parts).toString('utf8'))} catch {throw new MediaSettingsError('设置请求格式无效')}
        if (!object(value) || !revision(value.expectedRevision)) throw new MediaSettingsError('设置请求格式无效')
        const mutation = value as unknown as MediaSettingsMutation
        if (mutation.operation === 'defaults') await store.patchDefaults(mutation)
        else if (mutation.operation === 'credential') await store.setCredential(mutation)
        else if (mutation.operation === 'clearOverride') await store.clearOverride(mutation)
        else throw new MediaSettingsError('设置操作无效')
        send(200, await store.readPublic(e))
      } else send(405, {error: '设置仅支持 GET 或 POST'})
    } catch (error) {send(error instanceof MediaSettingsError ? error.status : 500, {error: error instanceof MediaSettingsError ? error.message : '视频设置处理失败，请稍后重试'})}
    return true
  }
}
