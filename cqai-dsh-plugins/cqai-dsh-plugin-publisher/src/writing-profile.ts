/** Publisher-only expression rules, independent of drafts, Skills and global settings. */
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const FILE_NAME = 'writing-profile.json'
const MAX_INSTRUCTIONS_CHARACTERS = 12_000
const MAX_INSTRUCTIONS_BYTES = 48_000
const MAX_FILE_BYTES = 96 * 1024
const INVALID_PROFILE = '发布写作风格配置无效，请先修复配置后重试'

export interface WritingProfile {
  revision: number
  instructions: string | null
  enabled: boolean
}

export interface WritingProfileUpdate {
  expected_revision: number
  instructions?: string | null
  enabled?: boolean
}

export class WritingProfileConflictError extends Error {
  readonly code = 'publisher-writing-profile-conflict'
  constructor() { super('写作风格已在其他对话更新，请重新读取后再保存') }
}

function validInstructions(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_INSTRUCTIONS_BYTES) return false
  let characters = 0
  for (const character of value) {
    if (++characters > MAX_INSTRUCTIONS_CHARACTERS) return false
    const codePoint = character.codePointAt(0)!
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false
  }
  return true
}

function profileFile(env: NodeJS.ProcessEnv, create: boolean): string {
  const home = resolveDshHome(undefined, env)
  if (create) mkdirSync(home, { recursive: true, mode: 0o700 })
  const root = join(existsSync(home) ? realpathSync(home) : home, 'publisher')
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 })
  const directory = lstatSync(root, { throwIfNoEntry: false })
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) throw new Error(INVALID_PROFILE)
  return join(root, FILE_NAME)
}

/** No cache: new conversations and fresh imports read the same Publisher profile. */
export function readWritingProfile(env: NodeJS.ProcessEnv = process.env): WritingProfile {
  const file = profileFile(env, false)
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (!entry) return { revision: 0, instructions: null, enabled: true }
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_FILE_BYTES) throw new Error(INVALID_PROFILE)
  let value: unknown
  try {
    const bytes = readFileSync(file)
    if (bytes.length > MAX_FILE_BYTES) throw new Error(INVALID_PROFILE)
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch { throw new Error(INVALID_PROFILE) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID_PROFILE)
  const record = value as Record<string, unknown>
  const legacy = record.version === 1 && Object.keys(record).sort().join(',') === 'instructions,revision,version'
  const current = record.version === 2 && Object.keys(record).sort().join(',') === 'enabled,instructions,revision,version'
    && typeof record.enabled === 'boolean'
  if ((!legacy && !current)
    || !Number.isSafeInteger(record.revision) || (record.revision as number) < 0
    || !validInstructions(record.instructions)) throw new Error(INVALID_PROFILE)
  return { revision: record.revision as number, instructions: record.instructions, enabled: legacy ? true : record.enabled as boolean }
}

/** Compare the profile revision, then atomically replace only this dedicated file. */
export function updateWritingProfile(input: WritingProfileUpdate, env: NodeJS.ProcessEnv = process.env): WritingProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['expected_revision', 'instructions', 'enabled'].includes(key))
    || !Object.hasOwn(input, 'instructions') && !Object.hasOwn(input, 'enabled')
    || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0
    || Object.hasOwn(input, 'instructions') && !validInstructions(input.instructions)
    || Object.hasOwn(input, 'enabled') && typeof input.enabled !== 'boolean') {
    throw new Error('写作风格更新无效：需要有效修订号，以及不超过 12000 个 Unicode 字符的表达规则或 null，或启用状态')
  }
  const current = readWritingProfile(env)
  if (input.expected_revision !== current.revision) throw new WritingProfileConflictError()
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error(INVALID_PROFILE)
  const saved = { revision: current.revision + 1,
    instructions: Object.hasOwn(input, 'instructions') ? input.instructions?.trim() ? input.instructions : null : current.instructions,
    enabled: input.enabled ?? current.enabled,
  }
  const file = profileFile(env, true)
  const temporary = join(dirname(file), `.writing-profile.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 2, ...saved }), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } finally { if (existsSync(temporary)) rmSync(temporary) }
  return saved
}
