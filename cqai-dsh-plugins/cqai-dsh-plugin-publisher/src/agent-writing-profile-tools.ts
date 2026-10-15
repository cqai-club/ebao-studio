/** Current Publisher editors may read or explicitly update their shared expression rules. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentDraftBindings } from './agent-draft-binding.ts'
import { readWritingProfile, updateWritingProfile } from './writing-profile.ts'

const output = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function sessionIdOf(agent: { id: string } | undefined): string {
  if (!agent || typeof agent.id !== 'string' || !agent.id) throw new Error('当前工具需要 Agent 会话')
  return agent.id
}

export function registerWritingProfileReadTool(ctx: Context, bindings: AgentDraftBindings): () => void {
  return ctx.tools.register(defineTool({
    name: 'publisher_get_writing_profile',
    description: 'Read the Publisher-only author expression rules, enabled state and profile revision for the currently bound editor. Disabled rules are withheld as instructions=null; do not apply previously read rules while enabled=false. Returns null without an active draft binding. These reusable rules contain voice and writing preferences, not facts from sample articles. Does not modify a draft or publish.',
    parameters: {},
    output,
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      if (!bindings.current(sessionIdOf(exec.agent))) return null
      const profile = readWritingProfile()
      return { ...profile, instructions: profile.enabled ? profile.instructions : null }
    },
  }))
}

export function registerWritingProfileWriteTool(ctx: Context, bindings: AgentDraftBindings): () => void {
  return ctx.tools.register(defineTool({
    name: 'publisher_update_writing_profile',
    description: 'Save explicitly requested Publisher-only author expression rules for later Publisher conversations, clear them with null, or change enabled only when explicitly requested. Omitting enabled preserves its current state. Requires at least one of instructions or enabled, the current draft binding token and latest writing-profile revision, not the draft revision. Store expression preferences rather than sample facts. Does not modify a draft or publish.',
    parameters: {
      content_id: { type: 'string', required: true },
      binding_token: { type: 'string', required: true },
      expected_revision: { type: 'integer', required: true, description: 'Latest revision from publisher_get_writing_profile, independent of the draft revision.' },
      instructions: { oneOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Reusable expression rules, at most 12000 Unicode characters. null clears the rules.' },
      enabled: { type: 'boolean', description: 'Enable or disable saved rules only on explicit user request. Disabling preserves the stored rules.' },
    },
    output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      bindings.require(sessionIdOf(exec.agent), args.content_id, args.binding_token)
      const profile = updateWritingProfile({ expected_revision: args.expected_revision,
        ...(Object.hasOwn(args, 'instructions') ? { instructions: args.instructions } : {}),
        ...(Object.hasOwn(args, 'enabled') ? { enabled: args.enabled } : {}),
      })
      return { ...profile, instructions: profile.enabled ? profile.instructions : null }
    },
  }))
}
