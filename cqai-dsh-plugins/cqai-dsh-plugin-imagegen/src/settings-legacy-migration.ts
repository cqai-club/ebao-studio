/** Import the image studio's old settings.yaml section into its rc.2 Loader entry. */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import type { SettingsSeam } from './routes.ts'
import { IMAGEGEN_PROFILE_ENTRY_ID, IMAGEGEN_SETTINGS_NAMESPACE } from './protocol.ts'

export const IMAGEGEN_SETTINGS_MIGRATION_MARKER = '.cqai-imagegen-settings-rc2-imported.json'

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
 * rc.2 renames settings.yaml to settings.yaml.imported, but its built-in
 * importer cannot match the old dsh-imagegen section to our cqai-imagegen row.
 * Import only fields absent from the new profile override; a marker prevents a
 * later settings reset from resurrecting an old value on the next launch.
 */
export async function migrateLegacyImageGenSettings(profileHome: string, settings: SettingsSeam): Promise<boolean> {
  const marker = path.join(profileHome, IMAGEGEN_SETTINGS_MIGRATION_MARKER)
  if (await readIfPresent(marker) !== undefined) return false

  const imported = path.join(profileHome, 'settings.yaml.imported')
  const original = path.join(profileHome, 'settings.yaml')
  let source = imported
  let document = await readIfPresent(imported)
  if (document === undefined) {
    source = original
    document = await readIfPresent(original)
  }
  if (document === undefined) {
    // The built-in importer may have renamed the file between the two reads.
    source = imported
    document = await readIfPresent(imported)
  }
  if (document === undefined) return false
  const sections = record(parse(document))
  const legacy = record(sections?.[IMAGEGEN_SETTINGS_NAMESPACE])
  if (legacy === undefined) return false

  const descriptor = settings.describe({ redactSecrets: false })
    .find(candidate => String(candidate.ns) === IMAGEGEN_PROFILE_ENTRY_ID)
  if (descriptor === undefined) throw new Error('imagegen settings entry is unavailable for legacy import')
  const allowed = record(record(descriptor.schema)?.dict)
  if (allowed === undefined) throw new Error('imagegen settings schema is unavailable for legacy import')
  const user = record(descriptor.user) ?? {}
  const ops = Object.entries(legacy)
    .filter(([field]) => Object.hasOwn(allowed, field) && !Object.hasOwn(user, field))
    .map(([field, value]) => ({ op: 'set' as const, path: [field], value }))
  if (ops.length > 0) await settings.mutate(IMAGEGEN_PROFILE_ENTRY_ID, ops, descriptor.revision)

  try {
    await writeFile(marker, JSON.stringify({ from: path.basename(source), entry: IMAGEGEN_PROFILE_ENTRY_ID }), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return true
}
