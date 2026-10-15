import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { PublisherModal } from './shared.tsx'
import { WritingProfileSettings } from './writing-profile-settings.tsx'

/** Open preferences over the editor without changing its draft or Agent binding. */
export function WritingProfileDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  useEffect(() => {
    if (!open) { setDirty(false); setBusy(false); setDiscard(false) }
  }, [open])
  const close = () => {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  return <>
    {open && <style>{`.pub-writing-profile-dialog { width: min(640px, calc(100vw - 32px)); max-height: min(90vh, 760px); }
      .pub-writing-profile-dialog .pub-writing-profile { margin: 0; }
      .pub-writing-profile-dialog :is(textarea, button, input):focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }`}</style>}
    <PublisherModal open={open} title="写作风格" closeLabel="关闭写作风格" onClose={close}
      className="pub-modal pub-writing-profile-dialog" contentClassName="pub-modal-content"
      footer={<Button size="sm" variant="outline" disabled={busy} onClick={close}>关闭</Button>}>
      {open && <WritingProfileSettings onDirtyChange={setDirty} onBusyChange={setBusy}/>}
      <PublisherModal open={open && discard} title="放弃未保存的文风修改？" closeLabel="继续修改文风"
        description="这些修改尚未保存，关闭后将保留之前的写作风格。" className="pub-modal"
        onClose={() => setDiscard(false)}
        footer={<><Button size="sm" variant="outline" data-pub-initial-focus onClick={() => setDiscard(false)}>继续修改</Button>
          <Button size="sm" variant="outline" onClick={() => { setDiscard(false); onClose() }}>放弃修改并关闭</Button></>}/>
    </PublisherModal>
  </>
}
