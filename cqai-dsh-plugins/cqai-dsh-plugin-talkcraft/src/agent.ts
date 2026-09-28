import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

export interface AgentHandle {
  agent: {
    followup(message: {id: string; role: 'user'; content: Array<{type: 'text'; text: string}>; source: {kind: 'plugin:cqai-dsh-plugin-talkcraft'}}): void
    whenIdle(): Promise<void>
    cancel(cause: {kind: 'user'}): void
    session: {snapshotEvents(): readonly {type: string; data: {reason?: {kind: string; error?: {code?: string; status?: number}}}}[]}
  }
  dispose(): Promise<void>
}
export interface AgentServices {
  agents: {
    create(options: {sessionId: string; meta: {cwd: string; origin: 'subagent'; agentPreset: string}; agentOptions: {provider: string; model: string}; signal: AbortSignal; setup(agentCtx: Context): Promise<void>}): Promise<AgentHandle>
    resume?(options: {resumeSessionId: string; agentOptions: {provider: string; model: string}; signal: AbortSignal; setup(agentCtx: Context): Promise<void>}): Promise<AgentHandle>
  }
  presets: {resolve(id?: string): Promise<{id: string; broken?: string}>; readDocument?(id: string): Promise<{content: string}>; mount(agentCtx: Context, id: string): Promise<unknown>}
  defaultModel: {currentSelection(): {provider?: string; model?: string}}
}

export class TalkCraftAgents {
  private services?: AgentServices
  attach(services: AgentServices): void {this.services = services}
  detach(): void {this.services = undefined}
  diagnosis(): string[] {
    const errors: string[] = []
    if (!this.services?.agents?.create) errors.push('DSH Agent 服务尚未加载')
    if (!this.services?.presets?.mount) errors.push('DSH Agent preset 服务尚未加载')
    const model = this.services?.defaultModel?.currentSelection()
    if (!model?.provider || !model.model) errors.push('请先在 DSH 设置中选择模型')
    return errors
  }
  async preflight(): Promise<string[]> {
    const errors = this.diagnosis()
    if (errors.length || !this.services) return errors
    try {
      const preset = await this.services.presets.resolve()
      if (preset.broken) return [`当前 Agent preset 无法加载：${preset.broken}`]
      if (this.services.presets.readDocument) {
        const source = (await this.services.presets.readDocument(preset.id)).content
        if (!/dsh-tool-(?:pwsh|bash)/.test(source)) errors.push('当前 Agent preset 没有终端工具')
        if (!/dsh-tool-fs(?!-)/.test(source)) errors.push('当前 Agent preset 没有可写文件工具')
      }
    } catch (error) {errors.push(`Agent preset 检查失败：${error instanceof Error ? error.message : String(error)}`)}
    return errors
  }
  async run(cwd: string, systemPrompt: string, prompt: string, signal: AbortSignal,
    progress?: {resumeSessionId?: string; onSessionId?(id: string): void}): Promise<void> {
    const services = this.services
    const diagnosis = this.diagnosis()
    if (!services || diagnosis.length) throw new Error(diagnosis.join('；'))
    const selection = services.defaultModel.currentSelection()
    const preset = await services.presets.resolve()
    if (!preset.id) throw new Error('没有可用的 Agent preset')
    const agentOptions = {provider: selection.provider!, model: selection.model!}
    const setup = async (agentCtx: Context) => {
        await services.presets.mount(agentCtx, preset.id)
        const tools = agentCtx.get('tools')
        if (!tools) throw new Error('当前 Agent preset 没有文件或终端工具，无法制作视频')
        agentCtx.systemPrompt.section({name: 'plugin:talkcraft:stage', order: 300, text: systemPrompt})
    }
    let sessionId = progress?.resumeSessionId ?? randomUUID()
    let handle: AgentHandle
    if (progress?.resumeSessionId && services.agents.resume) {
      try {handle = await services.agents.resume({resumeSessionId: sessionId, agentOptions, signal, setup})}
      catch (error) {
        if (signal.aborted) throw error
        sessionId = randomUUID()
        handle = await services.agents.create({sessionId, meta: {cwd, origin: 'subagent', agentPreset: preset.id}, agentOptions, signal, setup})
      }
    } else {
      sessionId = randomUUID()
      handle = await services.agents.create({sessionId, meta: {cwd, origin: 'subagent', agentPreset: preset.id}, agentOptions, signal, setup})
    }
    const cancel = () => handle.agent.cancel({kind: 'user'})
    signal.addEventListener('abort', cancel, {once: true})
    try {
      progress?.onSessionId?.(sessionId)
      const continuation = progress?.resumeSessionId === sessionId ? `继续当前 TalkCraft 阶段，沿用本会话已读资料和任务目录中已写的文件；完成尚未落盘或未通过检查的产物。\n${prompt}` : prompt
      handle.agent.followup({id: randomUUID(), role: 'user', content: [{type: 'text', text: continuation}], source: {kind: 'plugin:cqai-dsh-plugin-talkcraft'}})
      await handle.agent.whenIdle()
      if (signal.aborted) throw new Error('任务已取消')
      // DSH contains driver errors at the turn boundary, so whenIdle() also resolves after a failed model request.
      const ending = handle.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason
      if (!ending) throw new Error(`Agent 没有结束记录（会话 ${sessionId}）`)
      if (ending.kind === 'error') {
        const status = ending.error?.status
        const code = ending.error?.code
        const details = [typeof status === 'number' && status >= 100 && status <= 599 ? `HTTP ${status}` : '',
          typeof code === 'string' && /^[A-Z0-9_-]{1,32}$/.test(code) ? code : ''].filter(Boolean).join('，')
        throw new Error(`Agent 执行失败${details ? `（${details}）` : ''}；请稍后继续当前任务（会话 ${sessionId}）`)
      }
      if (ending.kind !== 'completed') throw new Error(`Agent 未完成（${ending.kind}）；请继续当前任务（会话 ${sessionId}）`)
    } finally {signal.removeEventListener('abort', cancel); await handle.dispose()}
  }
}
