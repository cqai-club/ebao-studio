import { readContent } from './contents.ts'
import { ensureProjectWorkspace, ensurePublishingWorkspace } from './project-workspace.ts'

/** Every current publishing conversation shares one cwd; its own material folder stays separate. */
export function ensureAgentWorkspace(contentId: string, env: NodeJS.ProcessEnv = process.env): string {
  const content = readContent(contentId, env)
  if (content.workflowVersion !== 2) throw new Error('旧版内容不支持此操作')
  ensureProjectWorkspace(contentId, env)
  return ensurePublishingWorkspace(env)
}
