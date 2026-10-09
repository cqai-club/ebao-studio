/** Native Skill discovery stays small; its successful load grants turn-local tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { ImageGenerationRuntime } from './generation-runtime.ts'
import { registerAgentImageTools, type AgentImageToolConfig } from './agent-image-tools.ts'
import { AGENT_IMAGE_SKILL, isAgentImageSkill } from './agent-image-skill.ts'

const IMAGE_TOOLS = new Set(['list_image_generation_models', 'generate_image', 'edit_image',
  'get_image_generation_task', 'cancel_image_generation_task'])
interface State {
  registration: Scope
  generation: number
  requestId?: string
  gesture?: boolean
  canvas?: symbol
  skill?: () => void
  tools?: () => void
  hidden?: () => void
  restriction?: () => void
}
interface Activation { agent: Agent; state: State; generation: number; requestId: string }
interface SlashAssembly { activation: Activation; assembly: PromptAssembly; context: AssembleContext }

function deliversImageInstructions(content: readonly { type: string; text?: string }[]): boolean {
  // PTC may return the Skill object as JSON, or print its body into logs.
  return content.some(block => block.type === 'text' && typeof block.text === 'string'
    && (block.text.includes(AGENT_IMAGE_SKILL.content) || block.text.includes(JSON.stringify(AGENT_IMAGE_SKILL.content))))
}

function refreshAssembly(target: PromptAssembly, source: PromptAssembly): void {
  // Complete/suppressed prompt profiles return a shallow copy after the
  // waterfall. Preserve shared arrays so that copy receives the new schemas.
  target.tools.splice(0, target.tools.length, ...source.tools)
  target.sections.splice(0, target.sections.length, ...source.sections)
  target.contexts.splice(0, target.contexts.length, ...source.contexts)
  for (const key of Object.keys(target.variables)) delete target.variables[key]
  Object.assign(target.variables, source.variables)
}

export class AgentImageSkills {
  private readonly states = new Map<Agent, State>()
  private readonly loads = new Map<ToolExecutionToken, Activation>()
  private readonly pending = new Map<ToolExecutionToken, Activation[]>()
  private readonly assembling = new Set<Agent>()
  private readonly slashAssemblies = new Map<Agent, SlashAssembly>()
  private readonly disposers: (() => void)[] = []
  private disposed = false

  constructor(private readonly ctx: Context, private readonly runtime: ImageGenerationRuntime,
    private readonly resolve: () => AgentImageToolConfig) {
    this.disposers.push(
      ctx.on('tools/pre-execute', async (exec, next) => {
        const decision = await next()
        if (exec.name !== 'skill' || !exec.arguments || typeof exec.arguments !== 'object'
          || (exec.arguments as { name?: unknown }).name !== AGENT_IMAGE_SKILL.name || decision.kind !== 'allow') return decision
        const activation = this.activation(exec.agent)
        if (!activation) return { kind: 'deny', reason: '请根据当前主对话的用户图像操作需求读取 e图宝 Skill' }
        exec.signal.throwIfAborted()
        this.loads.set(exec.token, activation)
        return decision
      }),
      ctx.on('tools/result', (exec, result) => {
        const load = this.loads.get(exec.token)
        this.loads.delete(exec.token)
        const activations = this.pending.get(exec.token) ?? []
        this.pending.delete(exec.token)
        if (result.isError || exec.signal.aborted) return
        if (load && isAgentImageSkill(result.value) && result.content.some(block =>
          block.type === 'text' && block.text.includes(renderSkillContent(AGENT_IMAGE_SKILL)))) activations.push(load)
        if (exec.parent) {
          if (activations.length) this.pending.set(exec.parent, [...this.pending.get(exec.parent) ?? [], ...activations])
        } else if (deliversImageInstructions(result.content)) {
          for (const activation of activations) if (this.current(activation)) this.install(activation.state)
          if (activations.length) this.isolateDelegated()
        }
      }),
      ctx.on('agent/created', () => { this.sync(); return undefined }),
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        if (message.source.kind !== 'user' || agent.session.header.origin === 'subagent') return
        const state = this.state(agent)
        const gesture = state.gesture
        this.reset(agent)
        state.requestId = message.id
        const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
        state.gesture = gesture || [...text.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)]
          .some(match => match[2] === AGENT_IMAGE_SKILL.name)
      }),
      ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle' && !this.states.get(agent)?.canvas) this.reset(agent) }),
      ctx.on('agent/disposed', ({ agent }) => { this.remove(agent) }),
      ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembly = await next()
        const agent = context.scope as Agent | undefined
        if (!agent || context.signal?.aborted || this.assembling.has(agent)) return assembly
        const state = this.states.get(agent)
        if (!state?.gesture || state.tools || !ctx.tools.get('skill', agent)) return assembly
        const activation = this.activation(agent)
        const pending = this.slashAssemblies.get(agent)
        // Another Skill can reassemble during the same pre-step. Keep the
        // AgentLoop's original assembly, rather than capturing that nested copy.
        if (activation && (!pending || pending.context.signal !== context.signal || !this.current(pending.activation))) {
          this.slashAssemblies.set(agent, { activation, assembly, context })
        }
        return assembly
      }, { prepend: true }),
      ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        // Wait for the native loader's final admission, rather than trusting
        // a same-name tool. AgentLoop assembled before this waterfall; update
        // that same assembly after actual instruction delivery for the first call.
        const decision = await next()
        const pending = this.slashAssemblies.get(agent)
        this.slashAssemblies.delete(agent)
        if (!pending) return decision
        pending.activation.state.gesture = undefined
        if (decision.kind === 'reject' || signal.aborted || pending.context.signal?.aborted
          || (pending.context.signal && pending.context.signal !== signal) || !ctx.tools.get('skill', agent)
          || !this.current(pending.activation)) return decision
        const delivered = decision.messages.some(message => message.source.kind === 'skill-invocation'
          && message.source.name === AGENT_IMAGE_SKILL.name && message.source.form === 'instructions'
          && message.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(AGENT_IMAGE_SKILL))))
        if (!delivered) return decision
        const skill = await ctx.skills.get(AGENT_IMAGE_SKILL.name, { scope: agent, cwd: agent.session.header.cwd, signal })
        signal.throwIfAborted()
        if (!isAgentImageSkill(skill) || !skill.invocation.userInvocable || !this.current(pending.activation)) return decision
        this.install(pending.activation.state)
        const grant = pending.activation.state.tools
        this.isolateDelegated()
        this.assembling.add(agent)
        const revoke = (): void => {
          grant?.()
          if (pending.activation.state.tools === grant) pending.activation.state.tools = undefined
          this.isolateDelegated()
        }
        try {
          const assembly = await ctx.systemPrompt.assemble({ ...pending.context, signal })
          signal.throwIfAborted()
          if (!this.current(pending.activation)) { revoke(); return decision }
          refreshAssembly(pending.assembly, assembly)
        } catch (error) { revoke(); throw error }
        finally { this.assembling.delete(agent) }
        return decision
      }, { prepend: true }),
    )
    this.sync()
  }

  private configured(): boolean { const config = this.resolve(); return config.enabled && config.allowAgentImageGeneration }
  private visible(): boolean { return this.configured() && this.resolve().announceToAgent !== false }
  private state(agent: Agent): State {
    let state = this.states.get(agent)
    // AgentLoop does not inject skills/attachments; use our dependency context.
    if (!state) { state = { registration: createScope(this.ctx, agent), generation: 0 }; this.states.set(agent, state) }
    return state
  }
  private activation(agent?: Agent): Activation | undefined {
    if (this.disposed || !agent || !this.visible() || agent.session.header.origin === 'subagent'
      || this.ctx.agents.get(agent.id) !== agent) return
    const state = this.state(agent)
    if (!state.requestId) return
    return { agent, state, generation: state.generation, requestId: state.requestId }
  }
  private current(activation: Activation): boolean {
    return !this.disposed && this.visible() && this.ctx.agents.get(activation.agent.id) === activation.agent
      && this.states.get(activation.agent) === activation.state && activation.generation === activation.state.generation
      && activation.requestId === activation.state.requestId
  }
  private install(state: State): void {
    if (!state.tools) state.tools = registerAgentImageTools(state.registration.ctx, this.runtime, this.resolve)
  }
  private reset(agent: Agent): void {
    const state = this.states.get(agent)
    if (!state) return
    this.slashAssemblies.delete(agent)
    state.generation++; state.requestId = undefined; state.gesture = undefined
    state.tools?.(); state.tools = undefined
    for (const [token, activation] of this.loads) if (activation.agent === agent) this.loads.delete(token)
    for (const [token, activations] of this.pending) {
      const kept = activations.filter(activation => activation.agent !== agent)
      if (kept.length) this.pending.set(token, kept)
      else this.pending.delete(token)
    }
    this.isolateDelegated()
  }
  private isolateDelegated(): void {
    if (this.disposed) return
    for (const agent of this.ctx.agents.list()) {
      const state = this.state(agent)
      if (agent.session.header.origin !== 'subagent' || state.canvas) continue
      state.hidden ??= state.registration.ctx.skills.register({ ...AGENT_IMAGE_SKILL, content: '',
        invocation: { modelInvocable: false, userInvocable: false } })
      state.restriction?.(); state.restriction = undefined
      const deny = this.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => IMAGE_TOOLS.has(name))
      if (deny.length) state.restriction = state.registration.ctx.tools.restrict({ deny })
    }
  }

  /** Only the explicit canvas run factory calls this; an origin/id never grants access. */
  authorizeCanvas(agent: Agent): () => void {
    if (this.disposed) return () => {}
    const state = this.state(agent)
    const grant = Symbol('canvas image run')
    state.canvas = grant
    state.hidden?.(); state.hidden = undefined
    state.restriction?.(); state.restriction = undefined
    if (this.configured()) this.install(state)
    this.isolateDelegated()
    return () => {
      if (this.states.get(agent) !== state || state.canvas !== grant) return
      state.canvas = undefined
      if (this.ctx.agents.get(agent.id) !== agent) this.remove(agent)
      else this.reset(agent)
    }
  }

  sync(): void {
    if (this.disposed) return
    for (const agent of this.ctx.agents.list()) {
      const state = this.state(agent)
      if (state.canvas) {
        if (this.configured()) this.install(state)
        else this.reset(agent)
        continue
      }
      if (agent.session.header.origin === 'subagent') continue
      if (this.visible()) state.skill ??= state.registration.ctx.skills.register(AGENT_IMAGE_SKILL)
      else { state.skill?.(); state.skill = undefined; this.reset(agent) }
    }
    this.isolateDelegated()
  }
  private remove(agent: Agent): void {
    const state = this.states.get(agent)
    this.reset(agent)
    state?.skill?.(); state?.hidden?.(); state?.restriction?.()
    this.states.delete(agent)
    if (state) void state.registration.dispose()
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const close of this.disposers.reverse()) close()
    for (const agent of this.states.keys()) this.remove(agent)
    this.loads.clear(); this.pending.clear(); this.assembling.clear(); this.slashAssemblies.clear()
  }
}
