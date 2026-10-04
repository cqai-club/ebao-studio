/** Per-draft Agent workspaces. The draft manifest and media stay in contents/. */
import { randomUUID } from 'node:crypto'
import {
  existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  renameSync, rmdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { directoryFor, readContent } from './contents.ts'
import type { PublisherContent, PublisherContentType } from './protocol.ts'

const SETTINGS_FILE = 'project-settings.json'
const BINDING_FILE = 'project-workspace.json'
const MAX_SETTINGS_BYTES = 8 * 1024
const MAX_BINDING_BYTES = 8 * 1024
const MAX_PATH_LENGTH = 4096
const MAX_PROJECT_NAME_BYTES = 180
const CONTENT_TYPE_LABELS: Record<PublisherContentType, string> = { article: '文章', 'image-note': '图文', video: '视频' }

export interface ProjectSettings {
  defaultRoot: string
  isCustom: boolean
}

export interface ProjectWorkspace {
  contentId: string
  path: string
}

function inside(parent: string, child: string): boolean {
  const tail = relative(parent, child)
  return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail))
}

function validAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH
    && !value.includes('\0') && isAbsolute(value)
}

function validCanonicalPath(value: unknown): value is string {
  return validAbsolutePath(value) && resolve(value) === value
}

function publisherRoot(env: NodeJS.ProcessEnv, create: boolean): string {
  const home = resolveDshHome(undefined, env)
  if (create) mkdirSync(home, { recursive: true, mode: 0o700 })
  const canonicalHome = existsSync(home) ? realpathSync(home) : home
  const root = join(canonicalHome, 'publisher')
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 })
  const entry = lstatSync(root, { throwIfNoEntry: false })
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) throw new Error('发布项目设置目录无效')
  return root
}

function defaultRoot(env: NodeJS.ProcessEnv, create: boolean): string {
  const root = join(publisherRoot(env, create), 'projects')
  let entry = lstatSync(root, { throwIfNoEntry: false })
  if (create && !entry) {
    try { mkdirSync(root, { mode: 0o700 }) }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
    entry = lstatSync(root)
  }
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) throw new Error('默认项目目录无效')
  return entry ? realpathSync(root) : root
}

function rejectInternalContents(root: string, env: NodeJS.ProcessEnv): void {
  const internal = join(publisherRoot(env, false), 'contents')
  const canonicalInternal = existsSync(internal) ? realpathSync(internal) : internal
  if (inside(canonicalInternal, root)) throw new Error('项目目录不能位于内部草稿存储中')
}

function canonicalRoot(root: string, env: NodeJS.ProcessEnv): string {
  if (!validAbsolutePath(root)) throw new Error('项目根目录必须是现存的绝对目录')
  const entry = lstatSync(root, { throwIfNoEntry: false })
  if (!entry) throw new Error('项目根目录不存在，请在设置中重新选择')
  const canonical = realpathSync(root)
  if (!lstatSync(canonical).isDirectory()) throw new Error('项目根目录必须是文件夹')
  rejectInternalContents(canonical, env)
  return canonical
}

function verifyWritableRoot(root: string): void {
  const probe = join(root, `.ebao-project-probe-${randomUUID()}`)
  try { mkdirSync(probe, { mode: 0o700 }) }
  catch { throw new Error('项目根目录不可写，无法创建子目录') }
  try { rmdirSync(probe) }
  catch { throw new Error('项目根目录无法清理临时验证目录') }
}

function parseRecord(file: string, maxBytes: number, error: string): Record<string, unknown> | null {
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (!entry) return null
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maxBytes) throw new Error(error)
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* Report one stable validation error. */ }
  throw new Error(error)
}

function settingsFile(env: NodeJS.ProcessEnv, create: boolean): string {
  return join(publisherRoot(env, create), SETTINGS_FILE)
}

export function readProjectSettings(env: NodeJS.ProcessEnv = process.env): ProjectSettings {
  const stored = parseRecord(settingsFile(env, false), MAX_SETTINGS_BYTES, '项目目录设置无效')
  if (!stored) return { defaultRoot: defaultRoot(env, false), isCustom: false }
  if (Object.keys(stored).sort().join(',') !== 'defaultRoot,version'
    || stored.version !== 1 || !validCanonicalPath(stored.defaultRoot)) throw new Error('项目目录设置无效')
  return { defaultRoot: stored.defaultRoot, isCustom: true }
}

export function saveProjectSettings(root: string, env: NodeJS.ProcessEnv = process.env): ProjectSettings {
  if (!validAbsolutePath(root)) throw new Error('项目根目录必须是现存的绝对目录')
  const builtIn = defaultRoot(env, true)
  const canonical = canonicalRoot(root, env)
  const file = settingsFile(env, true)
  const current = lstatSync(file, { throwIfNoEntry: false })
  if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error('项目目录设置无效')
  if (canonical === builtIn) {
    if (current) rmSync(file)
    return { defaultRoot: builtIn, isCustom: false }
  }
  verifyWritableRoot(canonical)
  const temporary = join(publisherRoot(env, true), `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, defaultRoot: canonical }), {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    })
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
  return { defaultRoot: canonical, isCustom: true }
}

interface ProjectBinding {
  root: string
  name: string
}

function validProjectName(value: unknown): value is string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_PROJECT_NAME_BYTES
    || value === '.' || value === '..' || /[<>:"/\\|?*\p{Cc}]/u.test(value) || /[.\s]$/u.test(value)) return false
  const stem = value.split('.')[0]!.replace(/[.\s]+$/u, '')
  return !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(stem)
}

function boundProject(directory: string, contentId: string): ProjectBinding | null {
  const stored = parseRecord(join(directory, BINDING_FILE), MAX_BINDING_BYTES, '草稿项目目录关联无效')
  if (!stored) return null
  if (!validCanonicalPath(stored.root)) throw new Error('草稿项目目录关联无效')
  const keys = Object.keys(stored).sort().join(',')
  // Existing Agent sessions keep their immutable cwd and original UUID folder.
  if (stored.version === 1 && keys === 'root,version') return { root: stored.root, name: contentId }
  if (stored.version === 2 && keys === 'name,root,version' && validProjectName(stored.name)) {
    return { root: stored.root, name: stored.name }
  }
  throw new Error('草稿项目目录关联无效')
}

function safeChild(parent: string, name: string): { path: string; created: boolean } {
  const path = join(parent, name)
  let entry = lstatSync(path, { throwIfNoEntry: false })
  let created = false
  if (!entry) {
    try { mkdirSync(path, { mode: 0o700 }); created = true }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
    entry = lstatSync(path)
  }
  if (entry.isSymbolicLink() || !entry.isDirectory() || realpathSync(path) !== path) {
    throw new Error('草稿项目目录无效')
  }
  return { path, created }
}

function prepareTypeDirectory(root: string, contentType: PublisherContentType, env: NodeJS.ProcessEnv): string {
  const canonical = canonicalRoot(root, env)
  if (canonical !== root) throw new Error('草稿项目目录关联无效')
  return safeChild(root, contentType).path
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    result += character
    bytes += size
  }
  return result.replace(/[.\s]+$/u, '')
}

function projectCreationDate(createdAt: string): string {
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime())) return '未定日期'
  // A desktop folder date follows the local calendar, including before 08:00 in China.
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function readableProjectName(content: PublisherContent, attempt: number): string {
  // A truncated copied title may split an emoji. Normalize only the filename spelling.
  const topic = content.title.replace(/[\uD800-\uDFFF]/gu, '\uFFFD').normalize('NFC').replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .replace(/\s+/gu, ' ').replace(/^[.\s]+|[.\s]+$/gu, '')
  const label = CONTENT_TYPE_LABELS[content.contentType]
  const prefix = topic ? `${label}-${topic}` : label
  const date = projectCreationDate(content.createdAt)
  const suffix = `-${date}-${content.id.slice(0, 8)}${attempt > 1 ? `-${attempt}` : ''}`
  return `${truncateUtf8(prefix, MAX_PROJECT_NAME_BYTES - Buffer.byteLength(suffix, 'utf8'))}${suffix}`
}

function allocateProject(typeDirectory: string, content: PublisherContent): {
  name: string; path: string; created: boolean
} {
  const legacy = join(typeDirectory, content.id)
  if (lstatSync(legacy, { throwIfNoEntry: false })) {
    return { name: content.id, ...safeChild(typeDirectory, content.id) }
  }
  // Never adopt an unbound readable folder, even when its name matches exactly.
  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const name = readableProjectName(content, attempt)
    const path = join(typeDirectory, name)
    try { mkdirSync(path, { mode: 0o700 }) }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw cause
    }
    const entry = lstatSync(path)
    if (entry.isSymbolicLink() || !entry.isDirectory() || realpathSync(path) !== path) {
      throw new Error('草稿项目目录无效')
    }
    return { name, path, created: true }
  }
  throw new Error('同名项目目录过多，无法创建独立项目目录')
}

function bindProject(directory: string, binding: ProjectBinding): void {
  const file = join(directory, BINDING_FILE)
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 2, ...binding }), {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    })
    // A new draft may be opened concurrently. The first binding wins.
    linkSync(temporary, file)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}

/** Create or reopen a stable project directory without touching draft revisions or renaming files. */
export function ensureProjectWorkspace(contentId: string, env: NodeJS.ProcessEnv = process.env): ProjectWorkspace {
  const content = readContent(contentId, env)
  const directory = directoryFor(contentId, env)
  const saved = boundProject(directory, contentId)
  const settings = saved === null ? readProjectSettings(env) : null
  const root = saved?.root ?? (settings?.isCustom ? canonicalRoot(settings.defaultRoot, env) : defaultRoot(env, true))
  const typeDirectory = prepareTypeDirectory(root, content.contentType, env)
  if (saved) return { contentId, path: safeChild(typeDirectory, saved.name).path }
  const candidate = allocateProject(typeDirectory, content)
  try { bindProject(directory, { root, name: candidate.name }) }
  catch (cause) {
    if (candidate.created) {
      try { rmdirSync(candidate.path) } catch { /* Keep files another process may have put there. */ }
    }
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return ensureProjectWorkspace(contentId, env)
    throw cause
  }
  return { contentId, path: candidate.path }
}

/** Roll back only an unused directory from an aborted draft or duplicate operation. */
export function discardEmptyProjectWorkspace(contentId: string, env: NodeJS.ProcessEnv = process.env): void {
  const content = readContent(contentId, env)
  const saved = boundProject(directoryFor(contentId, env), contentId)
  if (!saved) return
  if (canonicalRoot(saved.root, env) !== saved.root) throw new Error('草稿项目目录关联无效')
  const typeDirectory = join(saved.root, content.contentType)
  const typeEntry = lstatSync(typeDirectory, { throwIfNoEntry: false })
  if (!typeEntry || typeEntry.isSymbolicLink() || !typeEntry.isDirectory() || realpathSync(typeDirectory) !== typeDirectory) return
  const path = join(typeDirectory, saved.name)
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (!entry || entry.isSymbolicLink() || !entry.isDirectory() || realpathSync(path) !== path) return
  try { rmdirSync(path) } catch { /* A user or another process may have added files. */ }
}
