/** Preserve category model choices stored by the pre-rc.2 Settings section. */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { parse } from 'yaml'

import { DSN_DEFAULT_MODEL_CATEGORY_ORDER } from './protocol.ts'

const LEGACY_SECTION = 'cqaiclub-category-default-models'
const ACCOUNT_ENTRY = 'cqaiclub-dsn-account'
export const CATEGORY_SETTINGS_MIGRATION_MARKER = '.cqai-category-defaults-rc2-imported.json'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * The rc.2 importer renames settings.yaml before processing it, but cannot
 * map this old standalone section to the Account Loader row. Import only
 * categories absent from the new user override. The marker prevents a later
 * reset from reviving obsolete choices on another launch.
 */
export async function migrateLegacyCategoryDefaultModels(
  profileHome: string,
  settings: Pick<SettingsForms, 'describe' | 'mutate'>,
): Promise<boolean> {
  const marker = path.join(profileHome, CATEGORY_SETTINGS_MIGRATION_MARKER)
  if (await readIfPresent(marker) !== undefined) return false

  let source = 'settings.yaml.imported'
  let document = await readIfPresent(path.join(profileHome, source))
  if (document === undefined) {
    source = 'settings.yaml'
    document = await readIfPresent(path.join(profileHome, source))
  }
  if (document === undefined) {
    source = 'settings.yaml.imported'
    document = await readIfPresent(path.join(profileHome, source))
  }
  if (document === undefined) return false
  const legacy = record(record(parse(document))?.[LEGACY_SECTION])
  if (legacy === undefined) return false

  const descriptor = settings.describe({ redactSecrets: false })
    .find(candidate => String(candidate.ns) === ACCOUNT_ENTRY)
  if (descriptor === undefined) throw new Error('Account settings entry is unavailable for legacy import')
  const current = record(record(descriptor.user)?.categoryDefaultModels) ?? {}
  const ops = DSN_DEFAULT_MODEL_CATEGORY_ORDER
    .filter(category => typeof legacy[category] === 'string' && !Object.hasOwn(current, category))
    .map(category => ({ op: 'set' as const, path: ['categoryDefaultModels', category], value: legacy[category] as string }))
  if (ops.length > 0) await settings.mutate(ACCOUNT_ENTRY, ops, descriptor.revision)

  try {
    await writeFile(marker, JSON.stringify({ from: source, entry: ACCOUNT_ENTRY }), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return true
}
