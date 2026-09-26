import { readContent } from './contents.ts'
import { ensureProjectWorkspace } from './project-workspace.ts'

/** Each article Agent conversation runs in its own draft project directory. */
export function ensureAgentWorkspace(contentId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (readContent(contentId, env).contentType !== 'article') throw new Error('当前 Agent 只支持编辑文章草稿')
  return ensureProjectWorkspace(contentId, env).path
}
