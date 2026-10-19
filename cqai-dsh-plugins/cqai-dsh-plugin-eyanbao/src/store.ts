import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  isScholarProject,
  projectSummary,
  type ProjectSummary,
  type ScholarProject,
} from './protocol.ts'

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function researchRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(undefined, env), 'eyanbao', 'projects')
}

export function newProjectId(): string {
  return randomUUID()
}

export function validProjectId(value: string): boolean {
  return PROJECT_ID.test(value)
}

function projectDirectory(root: string, id: string): string {
  if (!validProjectId(id)) throw new Error('研究项目 ID 无效')
  return join(root, id)
}

async function ensureRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
}

export async function readProject(
  id: string,
  options: { env?: NodeJS.ProcessEnv; root?: string } = {},
): Promise<ScholarProject | undefined> {
  const root = options.root ?? researchRoot(options.env)
  try {
    const raw = await readFile(join(projectDirectory(root, id), 'project.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isScholarProject(parsed) ? parsed : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function saveProject(
  project: ScholarProject,
  options: { env?: NodeJS.ProcessEnv; root?: string } = {},
): Promise<ScholarProject> {
  const root = options.root ?? researchRoot(options.env)
  await ensureRoot(root)
  const directory = projectDirectory(root, project.id)
  await mkdir(directory, { recursive: true })
  const saved = { ...project, updatedAt: new Date().toISOString() }
  const target = join(directory, 'project.json')
  const temporary = join(directory, `project-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(saved, null, 2), 'utf8')
  await rename(temporary, target)
  return saved
}

export async function listProjects(
  options: { env?: NodeJS.ProcessEnv; root?: string; limit?: number } = {},
): Promise<ProjectSummary[]> {
  const root = options.root ?? researchRoot(options.env)
  await ensureRoot(root)
  const entries = await readdir(root, { withFileTypes: true })
  const projects: ScholarProject[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !validProjectId(entry.name)) continue
    try {
      const project = await readProject(entry.name, { root })
      if (project !== undefined) projects.push(project)
    } catch {
      // A corrupt project must not prevent the rest of the library from opening.
    }
  }
  return projects
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, options.limit ?? 100)
    .map(projectSummary)
}

export async function removeProject(
  id: string,
  options: { env?: NodeJS.ProcessEnv; root?: string } = {},
): Promise<void> {
  const root = options.root ?? researchRoot(options.env)
  await rm(projectDirectory(root, id), { recursive: true, force: true })
}

export async function replaceProject(
  id: string,
  change: (current: ScholarProject) => ScholarProject,
  options: { env?: NodeJS.ProcessEnv; root?: string } = {},
): Promise<ScholarProject> {
  const current = await readProject(id, options)
  if (current === undefined) throw new Error('找不到研究项目')
  return await saveProject(change(current), options)
}
