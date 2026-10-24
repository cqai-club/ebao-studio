import {
  ArrowDownToLine,
  CircleStop,
  ListTree,
  LoaderCircle,
  Microscope,
  Search,
  Sparkles,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  AssistAction,
  AssistRequest,
  Degree,
  JournalQuality,
  Language,
  LiteratureScope,
  TaskKind,
} from '../protocol.ts'
import { runAssist } from './api.ts'
import { MarkdownDocument } from './markdown.tsx'

interface AssistContext {
  prompt: string
  kind: TaskKind
  degree: Degree
  discipline: string
  language: Language
  literatureScope: LiteratureScope
  journalQuality: JournalQuality
}

interface ActionDefinition {
  id: AssistAction
  label: string
  icon: LucideIcon
}

const ACTIONS: ActionDefinition[] = [
  { id: 'refine', label: '优化需求', icon: WandSparkles },
  { id: 'keywords', label: '检索词', icon: Search },
  { id: 'method', label: '研究方法', icon: Microscope },
  { id: 'outline', label: '论文提纲', icon: ListTree },
]

export function AiAssistant({
  context,
  onApply,
  onClose,
}: {
  context: AssistContext
  onApply: (text: string, replace: boolean) => void
  onClose: () => void
}) {
  const [action, setAction] = useState<AssistAction>('refine')
  const [result, setResult] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController>()
  const closeRef = useRef(onClose)
  const actionRefs = useRef<Partial<Record<AssistAction, HTMLButtonElement>>>({})
  const canGenerate = context.prompt.trim().length >= 4

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    actionRefs.current.refine?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      controllerRef.current?.abort()
    }
  }, [])

  const selectAction = (next: AssistAction) => {
    if (busy) return
    setAction(next)
    setResult('')
    setStatus('')
    setError('')
  }

  const generate = async () => {
    if (!canGenerate) {
      setError('请先输入至少四个字的研究需求。')
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setResult('')
    setStatus('正在分析当前研究需求')
    setError('')
    const request: AssistRequest = { action, ...context }
    try {
      await runAssist(request, event => {
        if (event.type === 'status') setStatus(event.message)
        else if (event.type === 'delta') setResult(current => current + event.text)
        else if (event.type === 'result') {
          setResult(event.text)
          setStatus('建议已生成')
        } else if (event.type === 'error') {
          setError(event.message)
          setStatus('')
        }
      }, controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'AI 辅助请求失败')
      }
    } finally {
      setBusy(false)
      controllerRef.current = undefined
    }
  }

  const stop = () => {
    controllerRef.current?.abort()
    setBusy(false)
    setStatus('已停止生成')
  }

  const apply = () => {
    if (result.trim() === '') return
    onApply(result.trim(), action === 'refine')
  }

  return (
    <section
      className="ey-ai-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="ey-ai-title"
    >
      <header className="ey-ai-header">
        <div className="ey-ai-title">
          <span className="ey-ai-mark" aria-hidden="true"><Sparkles size={17} /></span>
          <div>
            <h3 id="ey-ai-title">AI 研究助手</h3>
            <p>围绕当前研究需求生成可执行建议</p>
          </div>
        </div>
        <button type="button" className="ey-icon-button" aria-label="关闭 AI 研究助手" title="关闭" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="ey-ai-actions" role="group" aria-label="AI 辅助类型">
        {ACTIONS.map(definition => {
          const Icon = definition.icon
          return (
            <button
              type="button"
              key={definition.id}
              ref={element => { if (element) actionRefs.current[definition.id] = element }}
              className="ey-ai-action"
              aria-pressed={action === definition.id}
              disabled={busy}
              onClick={() => selectAction(definition.id)}
            >
              <Icon size={16} aria-hidden="true" />
              {definition.label}
            </button>
          )
        })}
      </div>
      <div className="ey-ai-context">
        <span>{context.prompt.trim() || '尚未输入研究需求'}</span>
      </div>
      {error !== '' && (
        <div className="ey-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {(busy || status !== '') && (
        <div className="ey-ai-status" role="status" aria-live="polite">
          {busy && <LoaderCircle className="ey-spin" size={15} aria-hidden="true" />}
          {status}
        </div>
      )}
      <div className={`ey-ai-result${result === '' && !busy ? ' is-empty' : ''}`}>
        {result === '' && !busy
          ? <span>选择一种辅助类型后生成建议</span>
          : <MarkdownDocument markdown={result} empty="正在生成建议…" />}
      </div>
      <footer className="ey-ai-footer">
        {busy ? (
          <button type="button" className="ey-button" onClick={stop}>
            <CircleStop size={16} aria-hidden="true" />
            停止
          </button>
        ) : (
          <button
            type="button"
            className="ey-button ey-button-primary"
            disabled={!canGenerate}
            onClick={() => void generate()}
          >
            <Sparkles size={16} aria-hidden="true" />
            生成建议
          </button>
        )}
        <button
          type="button"
          className="ey-button"
          disabled={busy || result.trim() === ''}
          onClick={apply}
        >
          <ArrowDownToLine size={16} aria-hidden="true" />
          {action === 'refine' ? '替换研究需求' : '加入研究需求'}
        </button>
      </footer>
    </section>
  )
}
