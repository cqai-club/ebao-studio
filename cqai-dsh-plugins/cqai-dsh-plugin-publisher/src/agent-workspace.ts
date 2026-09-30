import { ensureProjectWorkspace } from './project-workspace.ts'

/** Each draft Agent conversation runs in its own project directory. */
export function ensureAgentWorkspace(contentId: string, env: NodeJS.ProcessEnv = process.env): string {
  return ensureProjectWorkspace(contentId, env).path
}
