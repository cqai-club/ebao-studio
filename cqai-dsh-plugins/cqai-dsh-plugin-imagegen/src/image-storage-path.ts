import { homedir } from 'node:os'
import path from 'node:path'

const DEFAULT_ROOT = path.join(process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh'), 'dsh-imagegen')
let root = DEFAULT_ROOT

export function imageDataRoot(): string { return root }

/** Resolve a configured data root without changing the process-wide store. */
export function resolveImageDataRoot(value: string | undefined): string {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? DEFAULT_ROOT : path.resolve(trimmed)
}

export function setImageDataRoot(value: string | undefined): void {
  root = resolveImageDataRoot(value)
}

type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

function localStoragePathValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError('localStoragePath must be a string')
  return value
}

/**
 * Determine whether a settings mutation changes the active data root.
 * `undefined` means the mutation does not address the root; an empty string is
 * a real result and selects DSH's default `dsh-imagegen` directory.
 */
export function requestedImageDataRoot(
  ops: readonly SettingsPathOp[],
  inherited: string | undefined,
): string | undefined {
  let changed = false
  let value = inherited
  for (const op of ops) {
    if (op.path.length === 0) {
      changed = true
      if (op.op === 'unset') {
        value = inherited
        continue
      }
      if (op.value === null || typeof op.value !== 'object' || Array.isArray(op.value)) {
        throw new TypeError('settings root must be a plain object')
      }
      const section = op.value as Record<string, unknown>
      value = Object.hasOwn(section, 'localStoragePath')
        ? localStoragePathValue(section.localStoragePath)
        : inherited
      continue
    }
    if (op.path.length !== 1 || op.path[0] !== 'localStoragePath') continue
    changed = true
    value = op.op === 'set' ? localStoragePathValue(op.value) : inherited
  }
  return changed ? value ?? '' : undefined
}
