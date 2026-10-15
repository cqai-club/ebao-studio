/** Verified native Skill instructions unlock tools for each currently bound turn. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import { createScope, scopeChainOf, type Scope } from '@deepseek-ai/dsh-scope'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import * as NativeSkillLoader from '@deepseek-ai/dsh-tool-skill'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { AgentDraftBindings } from './agent-draft-binding.ts'
import { registerAgentDraftReadTool, registerAgentDraftTools } from './agent-draft-tools.ts'
import type { AgentPublications } from './agent-publication.ts'
import { registerAgentPublicationTools } from './agent-publication-tools.ts'
import { PUBLISHER_SKILL_CATALOG, isPublisherSkill, type PublisherSkillEntry } from './agent-skills.ts'
import { registerWritingProfileReadTool, registerWritingProfileWriteTool } from './agent-writing-profile-tools.ts'
import { publisherSkillsInHistory } from './publisher-skill-history.ts'

interface AgentTools {
  registration: Scope
  generation: number
  request?: { id: string; text: string }
  gestures?: string[]
  bindingToken?: string
  contentId?: string
  /** Successful, delivered loads survive turn teardown; execution grants do not. */
  learned?: Map<string, string>
  catalog?: Map<string, () => void>
  skillLoader?: Scope
  skillLoaderDisposal?: Promise<void>
  publication?: () => void
  edit?: () => void
  draftRead?: () => void
  writingProfileRead?: () => void
  writingProfileWrite?: () => void
  inherited?: () => void
  hiddenSkills?: (() => void)[]
}

interface Activation {
  agent: Agent
  state: AgentTools
  generation: number
  requestId: string
  name: string
  reuse?: boolean
}

interface SlashAssembly {
  activations: Activation[]
  assembly: PromptAssembly
  context: AssembleContext
}

function ownedSkill(name: string) {
  const entry = PUBLISHER_SKILL_CATALOG.find(entry => entry.skill.name === name)
  if (!entry) throw new Error('Publisher Skill 不存在')
  return entry.skill
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
  return typeof name === 'string' && PUBLISHER_SKILL_CATALOG.some(entry => entry.skill.name === name) ? name : undefined
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
    private readonly owns: (sessionId: string) => boolean = () => false,
    private readonly trustedRequest?: (agent: Agent, message: UserMessage) => { id: string; text: string } | undefined,
  ) {
    this.disposers.push(
      ctx.on('tools/pre-execute', async (exec, next) => {
        const decision = await next()
        if (decision.kind === 'allow' && exec.name.startsWith('publisher_')) {
          const agent = exec.agent
          if (!agent || agent.session.header.origin === 'subagent' || !this.owns(agent.id)
            || !this.bindings.current(agent.id) || !await available(agent.id)
            || !this.owns(agent.id) || !this.bindings.current(agent.id)) {
            return { kind: 'deny', reason: '当前发布编辑面板已关闭或专属对话已变化' }
          }
          if (!ctx.tools.get(exec.name, agent)) {
            const skill = exec.name === 'publisher_request_publication' || exec.name === 'publisher_get_publication_status'
              ? 'multiplatform-publish' : exec.name === 'publisher_update_writing_profile'
                ? 'publisher-learn-voice' : exec.name === 'publisher_get_writing_profile'
                  ? 'publisher-write-article' : 'publisher-edit-draft'
            return { kind: 'deny', reason: `当前工具尚未就绪，请先调用 skill 读取 ${skill}，然后在下一步调用所需工具；使用 run_code 时也应分为两次执行。` }
          }
        }
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
        if (load && isPublisherSkill(result.value) && result.value.name === load.name
          && result.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(ownedSkill(load.name))))) activations.push(load)
        if (exec.parent) {
          if (activations.length) this.pending.set(exec.parent, [...this.pending.get(exec.parent) ?? [], ...activations])
        } else {
          for (const activation of activations) {
            if (this.current(activation) && deliversSkillInstructions(result.content, activation.name)) {
              this.install(activation.agent, activation.name)
              this.remember(activation.agent, activation.name)
            }
          }
        }
      }),
      ctx.on('agent/created', ({ agent }) => { this.refresh(agent.id); return undefined }),
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        const request = message.source.kind === 'user' ? humanRequest(message) : this.trustedRequest?.(agent, message)
        if (request && agent.session.header.origin !== 'subagent') {
          // Inbox emits one event per message in the batch. Keep gestures only
          // until its assembly, while the latest human input still owns the grant.
          const gestures = this.state(agent).gestures ?? []
          this.reset(agent)
          const state = this.state(agent)
          state.request = request
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
        const reusable = this.reusableSkills(agent, state)
        const activations: Activation[] = []
        for (const name of new Set([...gestures, ...reusable])) {
          const entry = PUBLISHER_SKILL_CATALOG.find(entry => entry.skill.name === name)
          if (!entry || this.hasGrants(state, entry)) continue
          const activation = this.activation(agent, name)
          if (activation) activations.push({ ...activation, reuse: !gestures.includes(name) })
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
        const reminders: UserMessage[] = []
        const revoke = () => { for (const close of revocations.reverse()) close() }
        try {
          for (const activation of pending.activations) {
            if (!this.current(activation)) continue
            const owned = ownedSkill(activation.name)
            const delivered = activation.reuse || decision.messages.some(message => message.source.kind === 'skill-invocation'
              && message.source.name === owned.name && message.source.form === 'instructions'
              && message.content.some(block => block.type === 'text' && block.text.includes(renderSkillContent(owned))))
            if (!delivered) continue
            const skill = await ctx.skills.get(owned.name, { scope: agent, cwd: agent.session.header.cwd, signal })
            if (!isPublisherSkill(skill) || skill.name !== owned.name
              || (activation.reuse ? !skill.invocation.userInvocable && !skill.invocation.modelInvocable : !skill.invocation.userInvocable)
              || !await available(agent.id) || signal.aborted || pending.context.signal?.aborted || !this.current(activation)) continue
            const close = this.install(agent, owned.name)
            if (close) { revocations.push(close); installed.push(activation) }
            if (activation.reuse && ![...agent.session.deriveMessages(), ...decision.messages]
              .some(message => deliversSkillInstructions(message.content, owned.name))) {
              reminders.push(createUserMessage({ content: [{ type: 'text', text: renderSkillContent(owned) }],
                source: { kind: 'skill-invocation', name: owned.name, form: 'instructions' } }))
            }
          }
          if (!installed.length) return decision
          this.assembling.add(agent)
          const assembly = await ctx.systemPrompt.assemble({ ...pending.context, signal })
          signal.throwIfAborted()
          if (installed.some(activation => !this.current(activation))) { revoke(); return decision }
          refreshAssembly(pending.assembly, assembly)
          for (const activation of installed) this.remember(agent, activation.name)
        } catch (error) { revoke(); throw error }
        finally { this.assembling.delete(agent) }
        return reminders.length ? { ...decision, messages: [...decision.messages, ...reminders] } : decision
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
    if (!state.request || !this.owns(agent.id) || !this.bindings.current(agent.id)) return
    return { agent, state, name, generation: state.generation, requestId: state.request.id }
  }

  private current(activation: Activation): boolean {
    const { agent, state, generation, requestId } = activation
    return !this.disposed && this.ctx.agents.get(agent.id) === agent && this.byAgent.get(agent) === state
      && state.generation === generation && state.request?.id === requestId
      && this.owns(agent.id) && !!this.bindings.current(agent.id)
  }

  private hasGrants(state: AgentTools, entry: PublisherSkillEntry): boolean {
    return Boolean((entry.capability === 'publish' ? state.publication : state.edit)
      && (!entry.writingProfile || (state.writingProfileRead
        && (entry.writingProfile !== 'write' || state.writingProfileWrite))))
  }

  private remember(agent: Agent, name: string): void {
    this.state(agent).learned ??= new Map()
    this.state(agent).learned!.set(name, ownedSkill(name).content)
  }

  /** Replay only verified instructions into this turn's fresh, currently bound scope. */
  private reusableSkills(agent: Agent, state: AgentTools): string[] {
    if (!state.request || !this.owns(agent.id) || !this.bindings.current(agent.id)) return []
    for (const name of publisherSkillsInHistory(agent)) this.remember(agent, name)
    return [...state.learned ?? []].flatMap(([name, content]) => {
      const entry = PUBLISHER_SKILL_CATALOG.find(entry => entry.skill.name === name)
      // Persistent preference changes still require a fresh learning request and load.
      return entry && entry.writingProfile !== 'write' && entry.skill.content === content ? [name] : []
    })
  }

  private install(agent: Agent, name: string): (() => void) | undefined {
    const state = this.state(agent)
    const entry = PUBLISHER_SKILL_CATALOG.find(entry => entry.skill.name === name)
    if (!entry) return
    const disposers: (() => void)[] = []
    const revoke = () => { for (const close of disposers.slice().reverse()) close() }
    try {
      const contentGrant = this.installContent(agent, name)
      if (contentGrant) disposers.push(contentGrant)
      const scoped = state.registration.ctx
      if (entry.writingProfile && !state.writingProfileRead) {
        const grant = registerWritingProfileReadTool(scoped, this.bindings)
        state.writingProfileRead = grant
        disposers.push(() => {
          if (state.writingProfileRead !== grant) return
          grant(); state.writingProfileRead = undefined
        })
      }
      if (entry.writingProfile === 'write' && !state.writingProfileWrite) {
        const grant = registerWritingProfileWriteTool(scoped, this.bindings)
        state.writingProfileWrite = grant
        disposers.push(() => {
          if (state.writingProfileWrite !== grant) return
          grant(); state.writingProfileWrite = undefined
        })
      }
      if (!disposers.length) return
      this.refreshDelegated()
      return () => { revoke(); this.refreshDelegated() }
    } catch (cause) { revoke(); this.refreshDelegated(); throw cause }
  }

  private installContent(agent: Agent, name: string): (() => void) | undefined {
    const state = this.state(agent)
    const scoped = state.registration.ctx
    if (PUBLISHER_SKILL_CATALOG.find(entry => entry.skill.name === name)?.capability === 'edit') {
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
      if (!this.bindings.current(agent.id)) return
      const disposeContent = state.edit ? () => {} : registerAgentDraftReadTool(scoped, this.bindings)
      try {
        const disposePublication = registerAgentPublicationTools(scoped, this.publications, this.available)
        state.draftRead = disposeContent
        const grant = () => { disposePublication() }
        state.publication = grant
        this.refreshDelegated()
        return () => {
          if (state.publication !== grant) return
          grant(); state.publication = undefined
          // Rolling back edit may have restored a replacement read helper for
          // this same publication grant; revoke that helper as well.
          state.draftRead?.(); state.draftRead = undefined
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
    state.writingProfileWrite?.(); state.writingProfileWrite = undefined
    state.writingProfileRead?.(); state.writingProfileRead = undefined
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
      state.hiddenSkills ??= PUBLISHER_SKILL_CATALOG.map(({ skill }) => state.registration.ctx.skills.register({
        ...skill, content: '', invocation: { modelInvocable: false, userInvocable: false },
      }))
      state.inherited?.(); state.inherited = undefined
      const deny = this.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => name.startsWith('publisher_'))
      if (deny.length) state.inherited = state.registration.ctx.tools.restrict({ deny })
    }
  }

  private disposeSkillLoader(agent: Agent, state: AgentTools): void {
    const loader = state.skillLoader
    if (!loader) return
    state.skillLoader = undefined
    const pending = loader.dispose()
    state.skillLoaderDisposal = pending
    void pending.then(() => {
      if (state.skillLoaderDisposal !== pending) return
      state.skillLoaderDisposal = undefined
      // Cordis removes registrations asynchronously. Reconsider a synchronous
      // rebind only after the old tool is gone, without reviving removed Agents.
      if (!this.disposed && this.byAgent.get(agent) === state && this.ctx.agents.get(agent.id) === agent) {
        this.refresh(agent.id)
      }
    }).catch(cause => {
      if (state.skillLoaderDisposal === pending) state.skillLoaderDisposal = undefined
      this.ctx.logger.warn('无法完成发布 Skill 读取器的生命周期更新：%s', String(cause))
    })
  }

  refresh(sessionId: string): void {
    if (this.disposed) return
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent) return
    if (agent.session.header.origin === 'subagent') { this.refreshDelegated(); return }
    const state = this.state(agent)
    const binding = this.owns(sessionId) ? this.bindings.current(sessionId) : undefined
    const bindingToken = binding?.bindingToken
    if (bindingToken !== state.bindingToken) {
      const request = binding && state.contentId === binding.contentId ? state.request : undefined
      const gestures = request ? state.gestures : undefined
      if (binding && state.contentId && state.contentId !== binding.contentId) state.learned?.clear()
      this.reset(agent)
      state.bindingToken = bindingToken
      if (binding) state.contentId = binding.contentId
      state.request = request
      state.gestures = gestures
    }
    if (bindingToken) {
      // Minimal presets omit the native loader. Supply it only for this owned
      // editor scope; preserve any loader or same-name tool already composed.
      const composedLoader = this.ctx.tools.get('skill', agent) || this.ctx.tools.get('skill')
        || scopeChainOf(agent).slice(1).some(parent => this.ctx.tools.get('skill', parent))
      if (!state.skillLoader && !state.skillLoaderDisposal && !composedLoader) {
        const loader = createScope(this.ctx, agent)
        try { NativeSkillLoader.apply(loader.ctx); state.skillLoader = loader }
        catch (cause) { void loader.dispose(); throw cause }
      }
      state.catalog ??= new Map()
      for (const { skill } of PUBLISHER_SKILL_CATALOG) {
        if (!state.catalog.has(skill.name)) state.catalog.set(skill.name, state.registration.ctx.skills.register(skill))
      }
    } else {
      for (const close of state.catalog?.values() ?? []) close()
      state.catalog = undefined
      this.disposeSkillLoader(agent, state)
    }
    this.refreshDelegated()
  }

  private remove(agent: Agent): void {
    this.reset(agent)
    const state = this.byAgent.get(agent)
    for (const close of state?.catalog?.values() ?? []) close()
    state?.inherited?.()
    if (state) this.disposeSkillLoader(agent, state)
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
