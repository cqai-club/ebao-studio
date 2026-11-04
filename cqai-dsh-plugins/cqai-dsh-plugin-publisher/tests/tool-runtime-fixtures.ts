/** Exercise publisher fixtures through the current executor and immutable step admission. */
import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as PtcExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { ResolvedToolSet } from '@deepseek-ai/dsh-tools'

export const MODEL_SELECTION = { provider: 'fixture', model: 'fixture-model' }
const admissions = new WeakMap<PromptAssembly, ResolvedToolSet>()

export function admittedToolNames(ctx: Context, agent: Agent, assembly: PromptAssembly): string[] {
  const toolSet = admissions.get(assembly)
  if (!toolSet) throw new Error('Fixture assembly has no captured tool admission')
  return ctx.tools.schemas(agent, toolSet).map(tool => tool.name)
}

export function admissionFor(assembly: PromptAssembly): ResolvedToolSet {
  const toolSet = admissions.get(assembly)
  if (!toolSet) throw new Error('Fixture assembly has no captured tool admission')
  return toolSet
}

export async function installTestExecutor(ctx: Context, mode: 'native' | 'ptc' = 'native'): Promise<void> {
  await ctx.plugin(mode === 'native' ? NativeExecutor : PtcExecutor)
  ctx.provide('workingDirectory', { ensure: async (agent: Agent) => agent.session.header.cwd ?? process.cwd() } as never)
}

export async function executeTool(ctx: Context, input: Pick<ToolExecutionInput, 'callId' | 'name' | 'arguments' | 'signal' | 'agent' | 'toolSet'>): Promise<ToolExecutionResult> {
  const toolSet = input.toolSet ?? (input.agent && !input.signal.aborted
    ? await ctx.tools.resolve({ agent: input.agent, signal: input.signal, modelSelection: MODEL_SELECTION }) : undefined)
  try { return await executeModelToolFixture(ctx, { ...input, ...(toolSet ? { toolSet } : {}) }) }
  finally { if (input.toolSet === undefined) toolSet?.dispose() }
}

export async function assembleAgentPrompt(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  const toolSet = await ctx.tools.resolve({ agent, signal, modelSelection: MODEL_SELECTION })
  ctx.effect(() => () => toolSet.dispose())
  const assembly = await ctx.systemPrompt.assemble({ ...assembleContextFor(agent, signal), modelSelection: MODEL_SELECTION, toolSet })
  admissions.set(assembly, toolSet)
  return assembly
}
