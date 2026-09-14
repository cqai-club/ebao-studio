/**
 * Durable secret storage for the ImageGen plugin.
 *
 * The settings namespace remains the public, revisioned configuration surface,
 * but it never owns secret values.  All custom-channel keys, the optional
 * prompt key, both S3 credentials and per-skill secret fields live in one
 * plugin-owned DSH Credentials grant.  A single record is intentional: channel
 * and skill ids are user-controlled and therefore cannot safely be used as
 * credential-key path segments.
 */

import {
  credentialKey,
  type CredentialKey,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'

const CREDENTIAL_SCOPE = 'cqai-dsh-plugin-imagegen'
const CREDENTIAL_ID = 'secrets'
const PAYLOAD_VERSION = 1

/** The one record owned by this plugin. */
export const IMAGEGEN_SECRET_CREDENTIAL = credentialKey(CREDENTIAL_SCOPE, CREDENTIAL_ID)

/** Minimal Credentials face, kept structural so migration tests need no Host. */
export interface ImageGenCredentials {
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>
  modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined>
}

/** Minimal settings face needed by the one-time legacy migration. */
export interface LegacySettingsSeam {
  describe(options?: { redactSecrets?: boolean }): Array<{
    ns: unknown
    value: unknown
    user?: unknown
    revision: number
  }>
  mutate(ns: unknown, ops: unknown, expectedRevision?: number): Promise<void>
}

/** Settings path operation accepted by the bridge. */
export type ImageGenSettingsOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** JSON payload encrypted/protected by the DSH Credentials provider. */
export interface ImageGenSecretPayload {
  version: 1
  channelApiKeys: Record<string, string>
  promptApiKey?: string
  storageAccessKey?: string
  storageSecretKey?: string
  skillConfigSecrets: Record<string, string>
}

/** Secret-presence item compatible with the dsh-settings redaction sidecar. */
export interface ImageGenSecretStatus {
  path: string[]
  set: boolean
}

const SECRET_ROOTS = new Set([
  'apiKey',
  'channelSecrets',
  'promptApiKey',
  'storageAccessKey',
  'storageSecretKey',
  'skillConfigSecrets',
])

function emptyDict(): Record<string, string> {
  return Object.create(null) as Record<string, string>
}

function emptyPayload(): ImageGenSecretPayload {
  return { version: PAYLOAD_VERSION, channelApiKeys: emptyDict(), skillConfigSecrets: emptyDict() }
}

function copyDict(value: Record<string, string>): Record<string, string> {
  const copy = emptyDict()
  for (const [key, item] of Object.entries(value)) copy[key] = item
  return copy
}

function copyPayload(value: ImageGenSecretPayload): ImageGenSecretPayload {
  return {
    version: PAYLOAD_VERSION,
    channelApiKeys: copyDict(value.channelApiKeys),
    ...value.promptApiKey === undefined ? {} : { promptApiKey: value.promptApiKey },
    ...value.storageAccessKey === undefined ? {} : { storageAccessKey: value.storageAccessKey },
    ...value.storageSecretKey === undefined ? {} : { storageSecretKey: value.storageSecretKey },
    skillConfigSecrets: copyDict(value.skillConfigSecrets),
  }
}

function stringDict(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = emptyDict()
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return undefined
    if (item.trim() !== '') out[key] = item
  }
  return out
}

/** Parse only this plugin's exact payload; never overwrite an unknown record. */
export function readImageGenSecretPayload(record: CredentialRecord | undefined): ImageGenSecretPayload {
  if (record === undefined) return emptyPayload()
  if (record.kind !== 'grant' || record.payload === null || typeof record.payload !== 'object') {
    throw new TypeError('cqai imagegen credential record has an unsupported format')
  }
  const payload = record.payload as Record<string, unknown>
  if (payload.version !== PAYLOAD_VERSION) {
    throw new TypeError('cqai imagegen credential payload version is unsupported')
  }
  const channelApiKeys = stringDict(payload.channelApiKeys)
  const skillConfigSecrets = stringDict(payload.skillConfigSecrets)
  if (channelApiKeys === undefined || skillConfigSecrets === undefined) {
    throw new TypeError('cqai imagegen credential payload contains invalid secret dictionaries')
  }
  const promptApiKey = payload.promptApiKey
  const storageAccessKey = payload.storageAccessKey
  const storageSecretKey = payload.storageSecretKey
  if (promptApiKey !== undefined && typeof promptApiKey !== 'string') {
    throw new TypeError('cqai imagegen prompt credential has an invalid value')
  }
  if (storageAccessKey !== undefined && typeof storageAccessKey !== 'string') {
    throw new TypeError('cqai imagegen storage access credential has an invalid value')
  }
  if (storageSecretKey !== undefined && typeof storageSecretKey !== 'string') {
    throw new TypeError('cqai imagegen storage credential has an invalid value')
  }
  return {
    version: PAYLOAD_VERSION,
    channelApiKeys,
    ...typeof promptApiKey === 'string' && promptApiKey.trim() !== '' ? { promptApiKey } : {},
    ...typeof storageAccessKey === 'string' && storageAccessKey.trim() !== '' ? { storageAccessKey } : {},
    ...typeof storageSecretKey === 'string' && storageSecretKey.trim() !== '' ? { storageSecretKey } : {},
    skillConfigSecrets,
  }
}

function recordOf(payload: ImageGenSecretPayload): CredentialRecord {
  return { kind: 'grant', payload: copyPayload(payload) }
}

function isSettingsOp(value: unknown): value is ImageGenSettingsOp {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { op?: unknown; path?: unknown }
  return (candidate.op === 'set' || candidate.op === 'unset')
    && Array.isArray(candidate.path)
    && candidate.path.every(segment => typeof segment === 'string')
}

function secretValue(value: unknown, label: string, trim = true): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string; unset it to clear the credential`)
  }
  return trim ? value.trim() : value
}

function replaceSecretDict(target: Record<string, string>, value: unknown, label: string): Record<string, string> {
  const parsed = stringDict(value)
  if (parsed === undefined) throw new TypeError(`${label} must be a string dictionary`)
  return parsed
}

function applySecretOp(payload: ImageGenSecretPayload, op: ImageGenSettingsOp): void {
  const [root, id, ...tail] = op.path
  if (root === undefined || !SECRET_ROOTS.has(root)) throw new TypeError('not an imagegen secret operation')
  if (tail.length > 0) throw new TypeError(`secret settings path "${op.path.join('.')}" is too deep`)

  // The pre-channel legacy field is accepted only as a migration-compatible
  // alias.  New clients always address channelSecrets.<id>.
  if (root === 'apiKey') {
    if (id !== undefined) throw new TypeError('apiKey does not accept a nested path')
    if (op.op === 'unset') delete payload.channelApiKeys.default
    else payload.channelApiKeys.default = secretValue(op.value, 'apiKey')
    return
  }

  if (root === 'promptApiKey' || root === 'storageAccessKey' || root === 'storageSecretKey') {
    if (id !== undefined) throw new TypeError(`${root} does not accept a nested path`)
    if (op.op === 'unset') delete payload[root]
    else payload[root] = secretValue(op.value, root)
    return
  }

  const key = root === 'channelSecrets' ? 'channelApiKeys' : 'skillConfigSecrets'
  if (id === undefined) {
    if (op.op === 'unset') payload[key] = emptyDict()
    else payload[key] = replaceSecretDict(payload[key], op.value, root)
    return
  }
  if (id === '') throw new TypeError(`${root} requires a non-empty id`)
  if (op.op === 'unset') delete payload[key][id]
  else payload[key][id] = secretValue(op.value, `${root}.${id}`, root !== 'skillConfigSecrets')
}

function publicObject(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (!SECRET_ROOTS.has(key)) copy[key] = item
  }
  return copy
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** An absent legacy dictionary is empty; a malformed present one is unsafe to delete. */
function legacyStringDict(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return emptyDict()
  const parsed = stringDict(value)
  if (parsed === undefined) throw new TypeError(`legacy ${label} contains an invalid secret dictionary`)
  return parsed
}

function userOwns(user: unknown, field: string): boolean {
  return user !== null && typeof user === 'object' && !Array.isArray(user)
    && Object.prototype.hasOwnProperty.call(user, field)
}

/**
 * Host-side secret coordinator.  Call `ready()` before registering write or
 * generation routes.  `snapshot()` itself is synchronous so the existing
 * runtime can resolve a channel immediately once startup has settled.
 */
export class ImageGenSecretVault {
  private payload = emptyPayload()
  private readyPromise?: Promise<void>

  constructor(private readonly credentials: ImageGenCredentials) {}

  /** Load the durable record exactly once for this plugin instance. */
  ready(): Promise<void> {
    this.readyPromise ??= this.credentials.readRecord(IMAGEGEN_SECRET_CREDENTIAL).then((record) => {
      this.payload = readImageGenSecretPayload(record)
    })
    return this.readyPromise
  }

  /** Detached host-only values; callers cannot mutate the cache. */
  snapshot(): ImageGenSecretPayload {
    return copyPayload(this.payload)
  }

  /**
   * Move secret path ops into Credentials and return only public settings ops.
   * A malformed operation below a secret root is rejected instead of being
   * allowed to fall through and accidentally persist in settings.
   */
  async extractSecretOps(ops: readonly unknown[]): Promise<ImageGenSettingsOp[]> {
    await this.ready()
    const secretOps: ImageGenSettingsOp[] = []
    const publicOps: ImageGenSettingsOp[] = []
    for (const raw of ops) {
      if (!isSettingsOp(raw)) throw new TypeError('malformed imagegen settings operation')
      // An empty path replaces (or clears) the complete section. Split every
      // secret root out explicitly so a whole-form save cannot smuggle a key
      // back into dsh-settings or leave credentials that the replacement
      // intended to remove.
      if (raw.path.length === 0) {
        if (raw.op === 'unset') {
          for (const root of SECRET_ROOTS) secretOps.push({ op: 'unset', path: [root] })
          publicOps.push(raw)
          continue
        }
        if (raw.value !== null && typeof raw.value === 'object' && !Array.isArray(raw.value)) {
          const section = raw.value as Record<string, unknown>
          // Replace the channel dictionary first. The deprecated flat apiKey
          // is then admitted only as a fallback for its `default` entry, which
          // matches the startup migration's precedence rule.
          secretOps.push(Object.hasOwn(section, 'channelSecrets')
            ? { op: 'set', path: ['channelSecrets'], value: section.channelSecrets }
            : { op: 'unset', path: ['channelSecrets'] })
          const replacementChannels = stringDict(section.channelSecrets)
          if (Object.hasOwn(section, 'apiKey') && replacementChannels?.default === undefined) {
            secretOps.push({ op: 'set', path: ['apiKey'], value: section.apiKey })
          }
          for (const root of SECRET_ROOTS) {
            if (root === 'apiKey' || root === 'channelSecrets') continue
            secretOps.push(Object.hasOwn(section, root)
              ? { op: 'set', path: [root], value: section[root] }
              : { op: 'unset', path: [root] })
          }
          publicOps.push({ ...raw, value: publicObject(section) })
          continue
        }
      }
      if (SECRET_ROOTS.has(raw.path[0] ?? '')) secretOps.push(raw)
      else publicOps.push(raw)
    }
    if (secretOps.length === 0) return publicOps

    const result = await this.credentials.modifyRecord(IMAGEGEN_SECRET_CREDENTIAL, async (current) => {
      const next = readImageGenSecretPayload(current)
      for (const op of secretOps) applySecretOp(next, op)
      return recordOf(next)
    })
    this.payload = readImageGenSecretPayload(result)
    return publicOps
  }

  /**
   * One-time upgrade from v1.5.12's settings-held secrets.
   *
   * Ordering is deliberate: Credentials is committed first; only after that
   * succeeds are the legacy settings paths removed in one revision-fenced
   * mutation.  A settings failure therefore leaves a harmless duplicate for a
   * retry, never a lost credential.  Existing Credentials values win over a
   * stale duplicate left by an earlier partial migration.
   */
  async migrateLegacySettings(settings: LegacySettingsSeam, namespace: string): Promise<boolean> {
    await this.ready()
    const descriptor = settings.describe({ redactSecrets: false })
      .find(candidate => String(candidate.ns) === namespace)
    if (descriptor === undefined) return false
    const value = descriptor.value
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const config = value as Record<string, unknown>
    // Refuse the migration before either write when a present legacy secret
    // dictionary is malformed. Silently treating it as empty and then unsetting
    // the whole field could discard valid sibling values.
    const channelSecrets = legacyStringDict(config.channelSecrets, 'channelSecrets')
    const skillConfigSecrets = legacyStringDict(config.skillConfigSecrets, 'skillConfigSecrets')
    const legacyApiKey = stringValue(config.apiKey)
    const promptApiKey = stringValue(config.promptApiKey)
    const storageAccessKey = stringValue(config.storageAccessKey)
    const storageSecretKey = stringValue(config.storageSecretKey)
    const channels = Array.isArray(config.channels) ? config.channels : []
    const defaultChannelId = stringValue(config.defaultChannelId)
      ?? channels.flatMap((channel) => {
        if (channel === null || typeof channel !== 'object') return []
        const id = stringValue((channel as Record<string, unknown>).id)
        return id === undefined ? [] : [id]
      })[0]
      ?? 'default'
    if (legacyApiKey !== undefined && channelSecrets[defaultChannelId] === undefined) {
      channelSecrets[defaultChannelId] = legacyApiKey
    }

    const hasImportedValues = Object.keys(channelSecrets).length > 0
      || Object.keys(skillConfigSecrets).length > 0
      || promptApiKey !== undefined
      || storageAccessKey !== undefined
      || storageSecretKey !== undefined
    if (hasImportedValues) {
      const result = await this.credentials.modifyRecord(IMAGEGEN_SECRET_CREDENTIAL, async (current) => {
        const next = readImageGenSecretPayload(current)
        for (const [id, secret] of Object.entries(channelSecrets)) {
          if (next.channelApiKeys[id] === undefined) next.channelApiKeys[id] = secret
        }
        for (const [id, secret] of Object.entries(skillConfigSecrets)) {
          if (next.skillConfigSecrets[id] === undefined) next.skillConfigSecrets[id] = secret
        }
        if (next.promptApiKey === undefined && promptApiKey !== undefined) next.promptApiKey = promptApiKey
        if (next.storageAccessKey === undefined && storageAccessKey !== undefined) next.storageAccessKey = storageAccessKey
        if (next.storageSecretKey === undefined && storageSecretKey !== undefined) next.storageSecretKey = storageSecretKey
        return recordOf(next)
      })
      this.payload = readImageGenSecretPayload(result)
    }

    const cleanup = [...SECRET_ROOTS]
      .filter(field => userOwns(descriptor.user, field))
      .map(field => ({ op: 'unset' as const, path: [field] }))
    if (cleanup.length === 0) return hasImportedValues
    await settings.mutate(namespace, cleanup, descriptor.revision)
    return true
  }

  /** Status sidecar for the browser; no method in this class returns a value. */
  statuses(channelIds: readonly string[] = []): ImageGenSecretStatus[] {
    const ids = new Set([...channelIds, ...Object.keys(this.payload.channelApiKeys)])
    return [
      { path: ['promptApiKey'], set: this.payload.promptApiKey !== undefined },
      { path: ['storageAccessKey'], set: this.payload.storageAccessKey !== undefined },
      { path: ['storageSecretKey'], set: this.payload.storageSecretKey !== undefined },
      ...[...ids].sort().map(id => ({ path: ['channelSecrets', id], set: this.payload.channelApiKeys[id] !== undefined })),
      ...Object.keys(this.payload.skillConfigSecrets).sort()
        .map(id => ({ path: ['skillConfigSecrets', id], set: true })),
    ]
  }

  /**
   * Strip every legacy secret container and replace its redaction metadata with
   * Credentials-backed configured/unconfigured bits.
   */
  projectDescriptor<T extends {
    value: unknown
    base?: unknown
    user?: unknown
    secrets?: readonly { path: readonly string[]; set: boolean }[]
  }>(descriptor: T): T {
    const value = publicObject(descriptor.value)
    const channelIds = value !== null && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray((value as Record<string, unknown>).channels)
      ? ((value as Record<string, unknown>).channels as unknown[]).flatMap((channel) => {
          if (channel === null || typeof channel !== 'object') return []
          const id = stringValue((channel as Record<string, unknown>).id)
          return id === undefined ? [] : [id]
        })
      : []
    const retained = (descriptor.secrets ?? [])
      .filter(secret => !SECRET_ROOTS.has(secret.path[0] ?? ''))
      .map(secret => ({ path: [...secret.path], set: secret.set }))
    return {
      ...descriptor,
      value,
      ...descriptor.base === undefined ? {} : { base: publicObject(descriptor.base) },
      ...descriptor.user === undefined ? {} : { user: publicObject(descriptor.user) },
      secrets: [...retained, ...this.statuses(channelIds)],
    }
  }
}
