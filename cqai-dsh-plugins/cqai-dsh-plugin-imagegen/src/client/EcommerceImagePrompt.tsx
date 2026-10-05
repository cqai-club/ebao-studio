import { useEffect, useRef, useState } from 'react'
import { ecommerceHistoryCopy as t } from './ecommerce-history-copy.ts'
import type { EcommerceResultPrompt } from './ecommerce-result-prompt.ts'
import { useImageGenLanguageTick } from './use-language.ts'
import css from './ecommerce-image-prompt.module.css'

/** Read-only disclosure for the prompt belonging to this result image. */
export function EcommerceImagePrompt({ label, slotKey, imageIndex, result }: {
  label: string
  slotKey: string
  imageIndex: number
  result: EcommerceResultPrompt
}): React.JSX.Element {
  useImageGenLanguageTick()
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const copyEpoch = useRef(0)
  useEffect(() => {
    ++copyEpoch.current
    setCopyState('idle')
    return () => { ++copyEpoch.current }
  }, [result.prompt])

  const copy = async (): Promise<void> => {
    if (!result.prompt || copyState === 'copying') return
    const epoch = ++copyEpoch.current
    setCopyState('copying')
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(result.prompt)
      else {
        const text = document.createElement('textarea')
        const focused = document.activeElement
        text.value = result.prompt
        text.style.position = 'fixed'
        text.style.opacity = '0'
        document.body.appendChild(text)
        try {
          text.select()
          if (!document.execCommand('copy')) throw new Error('copy failed')
        } finally {
          text.remove()
          if (focused instanceof HTMLElement) focused.focus()
        }
      }
      if (epoch === copyEpoch.current) setCopyState('copied')
    } catch {
      if (epoch === copyEpoch.current) setCopyState('failed')
    }
  }

  return <details className={css.prompt} data-ecommerce-image-prompt data-slot-key={slotKey} data-image-index={imageIndex} data-prompt-source={result.source}>
    <summary aria-label={t('promptViewImage', { image: label })}>{t('promptView')}</summary>
    <div className={css.content}>
      <p className={css.meta}>{result.source === 'actual' ? t('promptActual', { attempt: result.attempt ?? 1 }) : t(result.source === 'saved' ? 'promptSaved' : result.source === 'planned' ? 'promptPlanned' : 'promptUnavailable')}</p>
      {result.source === 'saved' || result.source === 'planned' ? <p className={css.hint}>{t('promptUnconfirmed')}</p> : null}
      {result.prompt !== null ? <textarea className={css.text} readOnly rows={6} value={result.prompt} aria-label={t('promptImageText', { image: label })} data-ecommerce-prompt-text spellCheck={false} /> : null}
      <div className={css.actions}>
        <button type="button" disabled={!result.prompt || copyState === 'copying'} aria-label={t('promptCopyImage', { image: label })} onClick={() => { void copy() }}>{t(copyState === 'copying' ? 'promptCopying' : 'promptCopy')}</button>
        {copyState === 'copied' ? <span role="status">{t('promptCopied')}</span> : null}
      </div>
      {copyState === 'failed' ? <p className={css.hint} role="alert">{t('promptCopyFailed')}</p> : null}
    </div>
  </details>
}
