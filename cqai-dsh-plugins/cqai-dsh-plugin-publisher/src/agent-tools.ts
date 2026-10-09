/** Native Skills disclose instructions; successful loads unlock this turn's tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { AgentDraftBindings } from './agent-draft-binding.ts'
import { registerAgentDraftReadTool, registerAgentDraftTools } from './agent-draft-tools.ts'
import type { AgentPublications } from './agent-publication.ts'
import { registerAgentPublicationTools } from './agent-publication-tools.ts'
import { registerAgentSourceTools } from './agent-source-tools.ts'
import { EDIT_DRAFT_SKILL, PUBLISHING_SKILL, isPublisherSkill } from './agent-skills.ts'

interface AgentTools {
  registration: Scope
  generation: number
  request?: { id: string; text: string }
  gestures?: string[]
  bindingToken?: string
  publicationSkill?: () => void
  editSkill?: () => void
  publication?: () => void
  edit?: () => void
  draftRead?: () => void
  inherited?: () => void
  hiddenSkills?: (() => void)[]
}

interface Activation {
  agent: Agent
  state: AgentTools
  generation: number
  requestId: string
  name: string
}

interface SlashAssembly {
  activations: Activation[]
  assembly: PromptAssembly
  context: AssembleContext
}

function ownedSkill(name: string) {
  return name === PUBLISHING_SKILL.name ? PUBLISHING_SKILL : EDIT_DRAFT_SKILL
}

function deliversSkillInstructions(content: readonly { type: string; text?: string }[], name: string): boolean {
  const body = ownedSkill(name).content
  return content.some(block => block.type === 'text' && typeof block.text === 'string'
    && (block.text.includes(body) || block.text.includes(JSON.stringify(body))))
}

/** Policy may return a shallow assembly copy; retain its shared array references. */
function refreshAssembly(target: PromptAssembly, source: PromptAssembly): void {
  target.tools.splice(0, target.tools.length, ...source.tools)
  target.sections.splice(0, target.sections.length, ...source.sections)
  target.contexts.splice(0, target.contexts.length, ...source.contexts)
  for (const name of Object.keys(target.variables)) delete target.variables[name]
  Object.assign(target.variables, source.variables)
}

function humanRequest(message: UserMessage): { id: string; text: string } {
  return { id: message.id, text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') }
}

function skillGestures(text: string): string[] {
  return [...text.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)].map(match => match[2])
}

function skillName(exec: Readonly<ToolExecution>): string | undefined {
  if (exec.name !== 'skill' || typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  const name = (exec.arguments as { name?: unknown }).name
  return name === PUBLISHING_SKILL.name || name === EDIT_DRAFT_SKILL.name ? name : undefined
}

export class PublisherAgentTools {
  private readonly byAgent = new Map<Agent, AgentTools>()
  private readonly loads = new Map<ToolExecutionToken, Activation>()
  private readonly pending = new Map<ToolExecutionToken, Activation[]>()
  private readonly assembling = new Set<Agent>()
  private readonly slashAssemblies = new Map<Agent, SlashAssembly>()
  private readonly disposers: (() => void)[] = []
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly bindings: AgentDraftBindings,
    private readonly publications: AgentPublications,
    private readonly available: (sessionId: string) => Promise<boolean>,
  ) {
    this.disposers.push(
      ctx.on('tools/pre-execute', async (exec, next) => {
        const decision = await next()
        const name = skillName(exec)
        if (!name || decision.kind !== 'allow') return decision
        const activation = this.activation(exec.agent, name)
        if (!activation) return { kind: 'deny', reason: '请根据当前主对话的真实用户需求读取发布 Skill' }
        if (!await available(activation.agent.id) || !this.current(activation)) {
          return { kind: 'deny', reason: '当前对话或草稿已变化，请重新读取所需 Skill' }
        }
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
        const owned = ownedSkill(load?.name ?? '')
        if (load && isPublisherSkill(result.value) && result.value.name === load.name
          && result.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(owned)))) activations.push(load)
        if (exec.parent) {
          if (activations.length) this.pending.set(exec.parent, [...this.pending.get(exec.parent) ?? [], ...activations])
        } else {
          for (const activation of activations) {
            if (this.current(activation) && deliversSkillInstructions(result.content, activation.name)) {
              this.install(activation.agent, activation.name)
            }
          }
        }
      }),
      ctx.on('agent/created', ({ agent }) => { this.refresh(agent.id); return undefined }),
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        if (message.source.kind === 'user' && agent.session.header.origin !== 'subagent') {
          // Inbox emits one event per message in the batch. Keep gestures only
          // until its assembly, while the latest human input still owns the grant.
          const gestures = this.state(agent).gestures ?? []
          this.reset(agent)
          const state = this.state(agent)
          state.request = humanRequest(message)
          state.gestures = [...gestures, ...skillGestures(state.request.text)]
        }
      }),
      ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') this.reset(agent) }),
      ctx.on('agent/disposed', ({ agent }) => { this.remove(agent) }),
      // AgentLoop keeps this exact assembly while pre-step delivers native
      // Skill instructions. Do not grant tools just because a loader name exists.
      ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembly = await next()
        const agent = context.scope as Agent | undefined
        if (!agent || context.signal?.aborted || this.assembling.has(agent)) return assembly
        const state = this.byAgent.get(agent)
        if (!state?.request) return assembly
        const gestures = state.gestures ?? []
        const activations: Activation[] = []
        for (const name of new Set(gestures)) {
          if (name !== PUBLISHING_SKILL.name && name !== EDIT_DRAFT_SKILL.name) continue
          if (name === PUBLISHING_SKILL.name ? state.publication : state.edit) continue
          const activation = this.activation(agent, name)
          if (activation) activations.push(activation)
        }
        const pending = this.slashAssemblies.get(agent)
        if (activations.length && (!pending || pending.context.signal !== context.signal
          || pending.activations.every(activation => !this.current(activation)))) {
          this.slashAssemblies.set(agent, { activations, assembly, context })
        }
        return assembly
      }, { prepend: true }),
      ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        const decision = await next()
        const pending = this.slashAssemblies.get(agent)
        this.slashAssemblies.delete(agent)
        if (!pending) return decision
        const state = pending.activations[0].state
        state.gestures = undefined
        if (decision.kind === 'reject' || signal.aborted || pending.context.signal?.aborted
          || (pending.context.signal && pending.context.signal !== signal) || !ctx.tools.get('skill', agent)) return decision
        const revocations: (() => void)[] = []
        const installed: Activation[] = []
        const revoke = () => { for (const close of revocations.reverse()) close() }
        try {
          for (const activation of pending.activations) {
            if (!this.current(activation)) continue
            const owned = ownedSkill(activation.name)
            const delivered = decision.messages.some(message => message.source.kind === 'skill-invocation'
              && message.source.name === owned.name && message.source.form === 'instructions'
              && message.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(owned))))
            if (!delivered) continue
            const skill = await ctx.skills.get(owned.name, { scope: agent, cwd: agent.session.header.cwd, signal })
            if (!isPublisherSkill(skill) || skill.name !== owned.name || !skill.invocation.userInvocable
              || !await available(agent.id) || signal.aborted || pending.context.signal?.aborted || !this.current(activation)) continue
            const close = this.install(agent, owned.name)
            if (close) { revocations.push(close); installed.push(activation) }
          }
          if (!installed.length) return decision
          this.assembling.add(agent)
          const assembly = await ctx.systemPrompt.assemble({ ...pending.context, signal })
          signal.throwIfAborted()
          if (installed.some(activation => !this.current(activation))) { revoke(); return decision }
          refreshAssembly(pending.assembly, assembly)
        } catch (error) { revoke(); throw error }
        finally { this.assembling.delete(agent) }
        return decision
      }, { prepend: true }),
    )
    for (const agent of ctx.agents.list()) this.refresh(agent.id)
  }

  private state(agent: Agent): AgentTools {
    let state = this.byAgent.get(agent)
    // AgentLoop's own context does not inject skills or attachments. Borrow
    // Publisher's dependencies while tagging contributions with the same Agent.
    if (!state) { state = { generation: 0, registration: createScope(this.ctx, agent) }; this.byAgent.set(agent, state) }
    return state
  }

  private activation(agent: Agent | undefined, name: string): Activation | undefined {
    if (this.disposed || !agent || agent.session.header.origin === 'subagent' || this.ctx.agents.get(agent.id) !== agent) return
    const state = this.state(agent)
    if (!state.request || (name === EDIT_DRAFT_SKILL.name && !this.bindings.current(agent.id))) return
    return { agent, state, name, generation: state.generation, requestId: state.request.id }
  }

  private current(activation: Activation): boolean {
    const { agent, state, generation, requestId, name } = activation
    return !this.disposed && this.ctx.agents.get(agent.id) === agent && this.byAgent.get(agent) === state
      && state.generation === generation && state.request?.id === requestId
      && (name !== EDIT_DRAFT_SKILL.name || !!this.bindings.current(agent.id))
  }

  private install(agent: Agent, name: string): (() => void) | undefined {
    const state = this.state(agent)
    const scoped = state.registration.ctx
    if (name === EDIT_DRAFT_SKILL.name) {
      if (state.edit) return
      const hadDraftRead = !!state.draftRead
      state.draftRead?.(); state.draftRead = undefined
      const grant = registerAgentDraftTools(scoped, this.bindings)
      state.edit = grant
      this.refreshDelegated()
      return () => {
        if (state.edit !== grant) return
        grant(); state.edit = undefined
        if (hadDraftRead && state.publication && !state.draftRead && this.bindings.current(agent.id)) {
          state.draftRead = registerAgentDraftReadTool(scoped, this.bindings)
        }
        this.refreshDelegated()
      }
    } else {
      if (state.publication) return
      const bound = !!this.bindings.current(agent.id)
      const disposeContent = bound
        ? (state.edit ? () => {} : registerAgentDraftReadTool(scoped, this.bindings))
        : registerAgentSourceTools(scoped)
      try {
        const disposePublication = registerAgentPublicationTools(scoped, this.publications, this.available)
        if (bound) state.draftRead = disposeContent
        const grant = () => { disposePublication(); if (!bound) disposeContent() }
        state.publication = grant
        this.refreshDelegated()
        return () => {
          if (state.publication !== grant) return
          grant(); state.publication = undefined
          // Rolling back edit may have restored a replacement read helper for
          // this same publication grant; revoke that helper as well.
          if (bound) { state.draftRead?.(); state.draftRead = undefined }
          this.refreshDelegated()
        }
      } catch (error) { disposeContent(); throw error }
    }
  }

  private reset(agent: Agent): void {
    const state = this.byAgent.get(agent)
    if (!state) return
    this.slashAssemblies.delete(agent)
    state.generation++
    state.request = undefined
    state.gestures = undefined
    state.publication?.(); state.publication = undefined
    state.edit?.(); state.edit = undefined
    state.draftRead?.(); state.draftRead = undefined
    for (const [token, activation] of this.loads) if (activation.agent === agent) this.loads.delete(token)
    for (const [token, activations] of this.pending) {
      const kept = activations.filter(activation => activation.agent !== agent)
      if (kept.length) this.pending.set(token, kept)
      else this.pending.delete(token)
    }
    this.refreshDelegated()
  }

  /** Skills and tools are scoped: delegated workers cannot inherit publishing. */
  private refreshDelegated(): void {
    if (this.disposed) return
    for (const agent of this.ctx.agents.list()) {
      if (agent.session.header.origin !== 'subagent') continue
      const state = this.state(agent)
      state.hiddenSkills ??= [PUBLISHING_SKILL, EDIT_DRAFT_SKILL].map(skill => state.registration.ctx.skills.register({
        ...skill, content: '', invocation: { modelInvocable: false, userInvocable: false },
      }))
      state.inherited?.(); state.inherited = undefined
      const deny = this.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => name.startsWith('publisher_'))
      if (deny.length) state.inherited = state.registration.ctx.tools.restrict({ deny })
    }
  }

  refresh(sessionId: string): void {
    if (this.disposed) return
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent) return
    if (agent.session.header.origin === 'subagent') { this.refreshDelegated(); return }
    const state = this.state(agent)
    state.publicationSkill ??= state.registration.ctx.skills.register(PUBLISHING_SKILL)
    const bindingToken = this.bindings.current(sessionId)?.bindingToken
    if (bindingToken !== state.bindingToken) {
      this.reset(agent)
      state.bindingToken = bindingToken
    }
    if (bindingToken) state.editSkill ??= state.registration.ctx.skills.register(EDIT_DRAFT_SKILL)
    else { state.editSkill?.(); state.editSkill = undefined }
    this.refreshDelegated()
  }

  private remove(agent: Agent): void {
    this.reset(agent)
    const state = this.byAgent.get(agent)
    state?.publicationSkill?.(); state?.editSkill?.(); state?.inherited?.()
    for (const close of state?.hiddenSkills ?? []) close()
    this.byAgent.delete(agent)
    if (state) void state.registration.dispose()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const close of this.disposers.reverse()) close()
    for (const agent of this.byAgent.keys()) this.remove(agent)
    this.loads.clear(); this.pending.clear(); this.assembling.clear(); this.slashAssemblies.clear()
  }
}
