/**
 * Per-skill configuration (`docs/skill-config.md`).
 *
 * Skills are data, so DSH itself has no notion of a skill setting; the canvas
 * supplies one. A skill declares what it needs in a `skill.config.json` beside
 * its `SKILL.md`, the panel renders a form from that declaration, the values
 * live in this plugin's settings namespace, and "save and apply" runs the
 * declared steps — the skill's own CLI (`editppt config …`) or a config file it
 * reads. A built-in recipe covers well-known skills that ship no declaration.
 *
 * Everything here treats the declaration as untrusted data:
 *
 *  - parsing never executes anything and never writes a file;
 *  - the manifest is bounded (fields, steps, content size) and versioned;
 *  - `apply` runs only when the user clicks, with the exact argv shown first;
 *  - commands run without a shell, from a fixed cwd, under a timeout;
 *  - `file` targets stay below a private per-skill root and reject symlinks;
 *  - secret placeholders are refused in argv and private files use mode 0600;
 *  - secrets never reach the run prompt, the run directory, or a step's
 *    reported detail/output.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { CanvasSkillConfigField, CanvasSkillConfigView } from './protocol.ts'

/** Cap on one declaration's fields / steps / file body. */
const MAX_CONFIG_FIELDS = 32
const MAX_CONFIG_STEPS = 16
const MAX_CONFIG_CONTENT_BYTES = 8 * 1024
const MAX_CONFIG_LABEL_CHARS = 240
/** Wall-clock cap for one `command` step. */
const COMMAND_TIMEOUT_MS = 180_000
/** Cap on the command output kept for the panel. */
const MAX_COMMAND_OUTPUT_CHARS = 8_000

/** One guarded step runs only when the referenced field matches `set`. */
export interface SkillConfigGuard {
  field: string
  set: boolean
}

/** One `apply` step as the host executes it. */
export type SkillConfigStep =
  | { kind: 'command'; argv: string[]; cwd: 'run' | 'skill'; when?: SkillConfigGuard }
  | { kind: 'file'; path: string; content: string; when?: SkillConfigGuard }

/**
 * Explicit opt-in for the run-scoped CQAI bridge. Field-name heuristics are
 * intentionally insufficient: an untrusted skill must name the exact protocol
 * before the Host gives its run a temporary image credential.
 */
export interface SkillImageProviderDeclaration {
  protocol: 'openai-images-v1'
  /** Optional non-secret config field containing a preferred image model. */
  modelField?: string
}

/** A validated declaration. */
export interface SkillConfigManifest {
  note?: string
  fields: CanvasSkillConfigField[]
  steps: SkillConfigStep[]
  imageProvider?: SkillImageProviderDeclaration
}

/** Why a declaration was ignored. */
export type SkillConfigIssue = 'unreadable' | 'unsupported-version' | 'empty' | 'refused-path'

/** A declaration plus where it came from. */
export interface SkillConfigDeclaration {
  manifest: SkillConfigManifest
  source: 'skill' | 'plugin'
}

/** Read outcome for one skill: a declaration, an issue, or nothing at all. */
export interface SkillConfigLookup {
  declaration?: SkillConfigDeclaration
  issue?: SkillConfigIssue
}

/** The two settings dictionaries skill values live in. */
export interface SkillConfigStore {
  /** Non-secret values, keyed `<skill>/<field>`. */
  values: Record<string, string>
  /** Secret values, keyed `<skill>/<field>`. */
  secrets: Record<string, string>
}

/** Key one value inside the settings dictionaries. */
export function skillConfigKey(skill: string, field: string): string {
  return `${skill}/${field}`
}

/** Coerce one dictionary-shaped settings value into a detached record. */
export function asConfigDict(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

// ------------------------------------------------------------------ parsing

/** One field id the manifest may reference from `apply`. */
const FIELD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const FIELD_TYPES = new Set(['string', 'secret', 'boolean', 'number', 'select'])

/** Trim one declaration string to its cap, or undefined when it is not text. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, max)
}

/** Parse one `fields[]` entry. */
function parseField(raw: unknown): CanvasSkillConfigField | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (!FIELD_ID.test(id)) return undefined
  const type = typeof entry.type === 'string' && FIELD_TYPES.has(entry.type) ? entry.type as CanvasSkillConfigField['type'] : 'string'
  const label = text(entry.label, MAX_CONFIG_LABEL_CHARS) ?? id
  const description = text(entry.description, MAX_CONFIG_LABEL_CHARS)
  const fallback = text(entry.default, MAX_CONFIG_CONTENT_BYTES)
  const options = type !== 'select' || !Array.isArray(entry.options)
    ? undefined
    : entry.options
      .map(option => {
        if (option === null || typeof option !== 'object') return undefined
        const record = option as Record<string, unknown>
        const value = text(record.value, MAX_CONFIG_LABEL_CHARS)
        if (value === undefined) return undefined
        return { value, label: text(record.label, MAX_CONFIG_LABEL_CHARS) ?? value }
      })
      .filter((option): option is { value: string; label: string } => option !== undefined)
      .slice(0, 64)
  return {
    id,
    label,
    type,
    ...description === undefined ? {} : { description },
    ...entry.required === true ? { required: true } : {},
    ...fallback === undefined ? {} : { default: fallback },
    ...options === undefined || options.length === 0 ? {} : { options },
    // A secret is never expository, whatever the declaration claims.
    ...type === 'secret' ? {} : entry.expose === true ? { expose: true } : {},
  }
}

/** Parse one `apply[]` entry. */
function parseStep(raw: unknown): SkillConfigStep | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as Record<string, unknown>
  const when = entry.when !== null && typeof entry.when === 'object' ? entry.when as Record<string, unknown> : undefined
  const guard: SkillConfigGuard | undefined = when === undefined || typeof when.field !== 'string' || !FIELD_ID.test(when.field.trim())
    ? undefined
    : { field: when.field.trim(), set: when.set !== false }
  const kind = typeof entry.kind === 'string' ? entry.kind : ''
  if (kind === 'command') {
    if (!Array.isArray(entry.argv)) return undefined
    const argv = entry.argv
      .map(part => typeof part === 'string' ? part.trim() : '')
      .filter(part => part !== '')
      .slice(0, 32)
    if (argv.length === 0) return undefined
    return {
      kind: 'command',
      argv,
      cwd: entry.cwd === 'skill' ? 'skill' : 'run',
      ...guard === undefined ? {} : { when: guard },
    }
  }
  if (kind === 'file') {
    const target = text(entry.path, 1_024)
    const content = typeof entry.content === 'string' ? entry.content : undefined
    if (target === undefined || content === undefined) return undefined
    if (content.length > MAX_CONFIG_CONTENT_BYTES) return undefined
    return {
      kind: 'file',
      path: target,
      content,
      ...guard === undefined ? {} : { when: guard },
    }
  }
  return undefined
}

/** Parse only the one local image protocol implemented by the bridge. */
function parseImageProvider(
  raw: unknown,
  fields: readonly CanvasSkillConfigField[],
): SkillImageProviderDeclaration | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entry = raw as Record<string, unknown>
  if (entry.protocol !== 'openai-images-v1') return undefined
  if (entry.modelField === undefined || entry.modelField === '') return { protocol: 'openai-images-v1' }
  if (typeof entry.modelField !== 'string') return undefined
  const modelField = entry.modelField.trim()
  if (!FIELD_ID.test(modelField)
    || !fields.some(field => field.id === modelField && field.type !== 'secret')) return undefined
  return { protocol: 'openai-images-v1', modelField }
}

/**
 * Validate one declaration object.
 * @param raw - parsed JSON (or any value).
 * @returns the bounded manifest, or the issue that made it unusable.
 */
export function parseSkillConfigManifest(raw: unknown): { manifest?: SkillConfigManifest; issue?: SkillConfigIssue } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { issue: 'unreadable' }
  const entry = raw as Record<string, unknown>
  if (entry.version !== 1) return { issue: 'unsupported-version' }
  const fields = (Array.isArray(entry.fields) ? entry.fields : [])
    .map(parseField)
    .filter((field): field is CanvasSkillConfigField => field !== undefined)
    .slice(0, MAX_CONFIG_FIELDS)
  const steps = (Array.isArray(entry.apply) ? entry.apply : [])
    .map(parseStep)
    .filter((step): step is SkillConfigStep => step !== undefined)
    .slice(0, MAX_CONFIG_STEPS)
  const imageProvider = parseImageProvider(entry.imageProvider, fields)
  if (fields.length === 0 && steps.length === 0 && imageProvider === undefined) return { issue: 'empty' }
  const note = text(entry.note, MAX_CONFIG_LABEL_CHARS)
  return {
    manifest: {
      fields,
      steps,
      ...imageProvider === undefined ? {} : { imageProvider },
      ...note === undefined ? {} : { note },
    },
  }
}

/** Read `<bundleDir>/skill.config.json` when the bundle has one. */
export async function readSkillConfigFile(bundleDir: string): Promise<{ manifest?: SkillConfigManifest; issue?: SkillConfigIssue } | undefined> {
  const file = path.join(bundleDir, 'skill.config.json')
  if (!existsSync(file)) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return { issue: 'unreadable' }
  }
  return parseSkillConfigManifest(raw)
}

// ------------------------------------------------------------------- values

/** Current values for one skill, secrets included (host side only). */
export function valuesFor(declaration: SkillConfigDeclaration, store: SkillConfigStore, skill: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const field of declaration.manifest.fields) {
    const key = skillConfigKey(skill, field.id)
    const stored = field.type === 'secret' ? store.secrets[key] : store.values[key]
    values.set(field.id, typeof stored === 'string' ? stored : (field.default ?? ''))
  }
  return values
}

/** Labels of required fields with no value yet, in declaration order. */
export function missingFields(declaration: SkillConfigDeclaration, values: ReadonlyMap<string, string>): string[] {
  return declaration.manifest.fields
    .filter(field => field.required === true && (values.get(field.id) ?? '').trim() === '')
    .map(field => field.label)
}

/**
 * The panel-facing view of one skill's configuration. An ignored declaration
 * still reports why, so the author sees the typo instead of an empty panel.
 * @param declaration - validated declaration, when there is one.
 * @param values - resolved values (secrets included).
 * @param issue - host-rendered copy for an ignored declaration, when any.
 */
export function configView(
  declaration: SkillConfigDeclaration | undefined,
  values: ReadonlyMap<string, string>,
  issue?: string,
): CanvasSkillConfigView | undefined {
  if (declaration === undefined) {
    return issue === undefined
      ? undefined
      : { fields: [], values: [], source: 'skill', applicable: false, missing: [], issue }
  }
  return {
    fields: declaration.manifest.fields,
    values: declaration.manifest.fields.map(field => {
      const value = values.get(field.id) ?? ''
      return field.type === 'secret'
        ? { id: field.id, set: value !== '' }
        : { id: field.id, set: value !== '', value }
    }),
    source: declaration.source,
    applicable: declaration.manifest.steps.length > 0,
    ...declaration.manifest.imageProvider === undefined ? {} : { imageProvider: declaration.manifest.imageProvider },
    missing: missingFields(declaration, values),
    ...declaration.manifest.note === undefined ? {} : { note: declaration.manifest.note },
    ...issue === undefined ? {} : { issue },
  }
}

/**
 * The non-secret "configured values" block a run may carry, or undefined when
 * the declaration exposes nothing. Secrets never appear here.
 * @param declaration - validated declaration.
 * @param values - resolved values (secrets included; they are filtered out).
 */
export function configNote(declaration: SkillConfigDeclaration, values: ReadonlyMap<string, string>): string | undefined {
  const lines = declaration.manifest.fields
    .filter(field => field.expose === true && field.type !== 'secret')
    .map(field => {
      const value = (values.get(field.id) ?? '').trim()
      return value === '' ? undefined : `- ${field.label}: ${value}`
    })
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : lines.join('\n')
}

// -------------------------------------------------------------------- apply

/** One step's outcome, ready for the panel. */
export interface SkillConfigStepResult {
  step: SkillConfigStep
  ok: boolean
  detail: string
  output?: string
}

/** One redacted, non-executing step shown before the user confirms apply. */
export interface SkillConfigStepPreview {
  kind: 'command' | 'file'
  /** Full argv, or a config-root-relative file target. Secret values are masked. */
  detail: string
  /** Redacted file body. Present for file steps, including an empty body. */
  content?: string
  status: 'ready' | 'skipped' | 'blocked'
  issue?: string
}

/** Complete apply preview. `ready` is false when apply must be refused. */
export interface SkillConfigPreview {
  ready: boolean
  steps: SkillConfigStepPreview[]
}

/** Substitute `{field}` references; undefined when a referenced value is empty. */
function substitute(template: string, values: ReadonlyMap<string, string>): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = template.replace(/\{([a-z0-9][a-z0-9-]{0,63})\}/g, (_match, id: string) => {
    const value = (values.get(id) ?? '').trim()
    if (value === '') {
      missing.push(id)
      return ''
    }
    return value
  })
  return { text, missing }
}

/** Field ids referenced by one template. */
function references(template: string): string[] {
  return [...template.matchAll(/\{([a-z0-9][a-z0-9-]{0,63})\}/g)].map(match => match[1]!)
}

/** Render one template for the browser without materializing secret values. */
function substituteRedacted(
  template: string,
  values: ReadonlyMap<string, string>,
  secretIds: ReadonlySet<string>,
): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = template.replace(/\{([a-z0-9][a-z0-9-]{0,63})\}/g, (_match, id: string) => {
    const value = (values.get(id) ?? '').trim()
    if (value === '') {
      missing.push(id)
      return ''
    }
    return secretIds.has(id) ? '•••' : value
  })
  return { text, missing }
}

/** Whether one guarded step should run. */
function guardAllows(step: SkillConfigStep, values: ReadonlyMap<string, string>): boolean {
  const when = step.when
  if (when === undefined) return true
  const value = (values.get(when.field) ?? '').trim()
  return when.set ? value !== '' : value === ''
}

/**
 * Resolve one `file` target lexically below a per-skill configuration root.
 * Absolute paths, `~`, NULs, and parent traversal are all refused. Real-path
 * and symlink checks happen immediately before preview/write.
 * @param raw - the declared path.
 * @param configRoot - the host-owned root dedicated to this skill.
 * @returns the absolute target, or a refusal code.
 */
export function resolveConfigTarget(raw: string, configRoot: string): { path: string; relative: string } | { issue: SkillConfigIssue } {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.includes('\0') || path.isAbsolute(trimmed) || trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return { issue: 'refused-path' }
  }
  const segments = trimmed.split(/[\\/]+/)
  if (segments.some(segment => segment === '..')) return { issue: 'refused-path' }
  const root = path.resolve(configRoot)
  const normalized = path.resolve(root, ...segments.filter(segment => segment !== '' && segment !== '.'))
  const relative = path.relative(root, normalized)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { issue: 'refused-path' }
  }
  return { path: normalized, relative }
}

function isNotFound(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * Resolve every existing component and reject all symlinks. Missing parent
 * directories are created one component at a time with private permissions,
 * then checked again. This prevents `skill.config.json` from using a symlink
 * inside its safe root to reach another part of the user's filesystem.
 */
async function secureConfigTarget(
  raw: string,
  configRoot: string,
  createParents: boolean,
  safeBase = path.dirname(path.resolve(configRoot)),
): Promise<{ path: string; relative: string } | { issue: SkillConfigIssue }> {
  const lexical = resolveConfigTarget(raw, configRoot)
  if ('issue' in lexical) return lexical
  const base = path.resolve(safeBase)
  const requestedRoot = path.resolve(configRoot)
  if (!inside(base, requestedRoot)) return { issue: 'refused-path' }
  let root: string
  try {
    const baseReal = await realpath(base)
    root = baseReal
    const rootParts = path.relative(base, requestedRoot).split(path.sep).filter(Boolean)
    for (const part of rootParts) {
      const next = path.join(root, part)
      let stat
      try {
        stat = await lstat(next)
      } catch (error) {
        if (!isNotFound(error)) return { issue: 'refused-path' }
        if (createParents) {
          await mkdir(next, { mode: 0o700 })
          stat = await lstat(next)
        } else {
          root = next
          continue
        }
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) return { issue: 'refused-path' }
      const resolved = await realpath(next)
      if (!inside(baseReal, resolved)) return { issue: 'refused-path' }
      root = resolved
    }
  } catch {
    return { issue: 'refused-path' }
  }
  const parts = lexical.relative.split(path.sep)
  const file = parts.pop()!
  let parent = root
  for (const part of parts) {
    const next = path.join(parent, part)
    let stat
    try {
      stat = await lstat(next)
    } catch (error) {
      if (!isNotFound(error)) return { issue: 'refused-path' }
      if (createParents) {
        await mkdir(next, { mode: 0o700 })
        stat = await lstat(next)
      } else {
        // A missing component is safe at preview time. Apply repeats this walk,
        // creates it privately, and rejects if it became a symlink meanwhile.
        parent = next
        continue
      }
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { issue: 'refused-path' }
    const resolved = await realpath(next)
    if (!inside(root, resolved)) return { issue: 'refused-path' }
    parent = resolved
  }
  const target = path.join(parent, file)
  try {
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) return { issue: 'refused-path' }
    const resolved = await realpath(target)
    if (!inside(root, resolved)) return { issue: 'refused-path' }
  } catch (error) {
    if (!isNotFound(error)) return { issue: 'refused-path' }
  }
  return { path: target, relative: lexical.relative }
}

/** Mask every secret value inside one report string. */
function mask(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of [...secrets].filter(secret => secret !== '').sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('•••')
  }
  return out
}

/** Run one command without a shell, bounded by a timer and an output cap. */
function runCommand(argv: string[], options: { cwd: string; timeoutMs: number }): Promise<{ code: number; output: string }> {
  return new Promise(resolve => {
    let settled = false
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let output = ''
    const collect = (chunk: Buffer): void => { if (output.length < MAX_COMMAND_OUTPUT_CHARS) output += chunk.toString('utf8') }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ code: -1, output: `${output}\n超时（${Math.round(options.timeoutMs / 1000)}s）` })
    }, options.timeoutMs)
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: -1, output: String(error.message) })
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

/** Write one file atomically, creating its parents. */
async function writeConfigFile(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid.toString(36)}`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
    await chmod(target, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => { /* best effort */ })
    throw error
  }
}

/**
 * Produce the exact redacted plan shown before apply. This performs the same
 * path/symlink checks as execution but never runs a command or writes a file.
 */
export async function previewSkillConfigSteps(
  declaration: SkillConfigDeclaration,
  values: ReadonlyMap<string, string>,
  options: { configRoot: string; safeBase?: string },
): Promise<SkillConfigPreview> {
  const secretIds = new Set(declaration.manifest.fields.filter(field => field.type === 'secret').map(field => field.id))
  const steps: SkillConfigStepPreview[] = []
  for (const step of declaration.manifest.steps) {
    if (!guardAllows(step, values)) {
      steps.push({ kind: step.kind, status: 'skipped', detail: 'skipped' })
      continue
    }
    if (step.kind === 'command') {
      const secretReferences = [...new Set(step.argv.flatMap(references).filter(id => secretIds.has(id)))]
      const rendered = step.argv.map(part => substituteRedacted(part, values, secretIds))
      const missing = [...new Set(rendered.flatMap(part => part.missing))]
      const detail = JSON.stringify(rendered.map(part => part.text))
      const issue = secretReferences.length > 0
        ? `密钥字段不能作为命令行参数：${secretReferences.join('、')}。请让技能从受限环境变量或私有配置文件读取。`
        : missing.length > 0
          ? `缺少配置：${missing.join('、')}`
          : undefined
      steps.push({ kind: 'command', detail, status: issue === undefined ? 'ready' : 'blocked', ...issue === undefined ? {} : { issue } })
      continue
    }
    const target = await secureConfigTarget(step.path, options.configRoot, false, options.safeBase)
    const rendered = substituteRedacted(step.content, values, secretIds)
    const missing = [...new Set(rendered.missing)]
    const issue = 'issue' in target
      ? '目标必须是技能私有配置目录内的相对路径，且不能经过符号链接。'
      : missing.length > 0
        ? `缺少配置：${missing.join('、')}`
        : undefined
    steps.push({
      kind: 'file',
      detail: 'issue' in target ? '<refused-path>' : `<skill-config>/${target.relative.split(path.sep).join('/')}`,
      content: rendered.text,
      status: issue === undefined ? 'ready' : 'blocked',
      ...issue === undefined ? {} : { issue },
    })
  }
  return { ready: steps.every(step => step.status !== 'blocked'), steps }
}

/** Stable digest binding one confirmation to its declaration and current values. */
export function skillConfigFingerprint(declaration: SkillConfigDeclaration, values: ReadonlyMap<string, string>): string {
  return createHash('sha256').update(JSON.stringify({
    manifest: declaration.manifest,
    values: declaration.manifest.fields.map(field => [field.id, values.get(field.id) ?? '']),
  })).digest('hex')
}

/**
 * Execute a declaration's `apply` steps in order.
 * @param declaration - validated declaration.
 * @param values - resolved values (secrets included).
 * @param options - `runRoot` is the default cwd; `skillDir` backs `cwd: 'skill'`;
 *   `timeoutMs` overrides the per-command cap.
 * @returns one result per declared step, in order (secrets masked).
 */
export async function applySkillConfigSteps(
  declaration: SkillConfigDeclaration,
  values: ReadonlyMap<string, string>,
  options: { runRoot: string; configRoot?: string; safeBase?: string; skillDir?: string; timeoutMs?: number },
): Promise<SkillConfigStepResult[]> {
  const secrets = declaration.manifest.fields
    .filter(field => field.type === 'secret')
    .map(field => values.get(field.id) ?? '')
  const results: SkillConfigStepResult[] = []
  const secretIds = new Set(declaration.manifest.fields.filter(field => field.type === 'secret').map(field => field.id))
  const configRoot = options.configRoot ?? path.join(options.runRoot, 'config')
  const stepDir = (step: SkillConfigStep): string => {
    if (step.kind === 'command' && step.cwd === 'skill' && options.skillDir !== undefined) return options.skillDir
    return options.runRoot
  }
  for (const step of declaration.manifest.steps) {
    if (!guardAllows(step, values)) {
      results.push({ step, ok: true, detail: 'skipped' })
      continue
    }
    if (step.kind === 'command') {
      const secretReferences = [...new Set(step.argv.flatMap(references).filter(id => secretIds.has(id)))]
      if (secretReferences.length > 0) {
        const redacted = step.argv.map(part => substituteRedacted(part, values, secretIds).text)
        results.push({
          step,
          ok: false,
          detail: JSON.stringify(redacted),
          output: `密钥字段不能作为命令行参数：${secretReferences.join('、')}。请让技能从受限环境变量或私有配置文件读取。`,
        })
        continue
      }
      const substituted = step.argv.map(part => substitute(part, values))
      const missing = [...new Set(substituted.flatMap(part => part.missing))]
      const argv = substituted.map(part => part.text)
      if (missing.length > 0) {
        results.push({ step, ok: false, detail: mask(argv.join(' '), secrets), output: `缺少配置：${missing.join('、')}` })
        continue
      }
      const cwd = stepDir(step)
      const outcome = await runCommand(argv, { cwd, timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS })
      const output = mask(outcome.output.trim().slice(-MAX_COMMAND_OUTPUT_CHARS), secrets)
      results.push({
        step,
        ok: outcome.code === 0,
        detail: mask(argv.join(' '), secrets),
        ...output === '' ? {} : { output },
      })
      continue
    }
    const target = await secureConfigTarget(step.path, configRoot, true, options.safeBase)
    if ('issue' in target) {
      results.push({ step, ok: false, detail: '<refused-path>', output: '该路径不允许写入：目标必须位于技能私有配置目录，且不能经过符号链接。' })
      continue
    }
    const rendered = substitute(step.content, values)
    if (rendered.missing.length > 0) {
      results.push({ step, ok: false, detail: `→ <skill-config>/${target.relative.split(path.sep).join('/')}`, output: `缺少配置：${[...new Set(rendered.missing)].join('、')}` })
      continue
    }
    try {
      await writeConfigFile(target.path, rendered.text)
      results.push({ step, ok: true, detail: `→ <skill-config>/${target.relative.split(path.sep).join('/')}` })
    } catch (error) {
      results.push({ step, ok: false, detail: `→ <skill-config>/${target.relative.split(path.sep).join('/')}`, output: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
