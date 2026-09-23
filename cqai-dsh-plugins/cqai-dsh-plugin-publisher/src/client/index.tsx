import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { useState } from 'react'
import type { PublisherContentType } from '../protocol.ts'
import { AccountsPage } from './accounts.tsx'
import { ContentEditor } from './content.tsx'
import { SubmissionHistory } from './history.tsx'
import { css } from './shared.tsx'
import { VideoPage } from './video.tsx'

export const inject = ['slots']
const PUBLISHER_PANEL = 'cqai-publisher' as MainPanelId
type PublisherTab = 'publish' | 'history' | 'accounts'

function PublishIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/></svg>
}

function PublisherPage() {
  const [tab, setTab] = useState<PublisherTab>('publish')
  const [contentType, setContentType] = useState<PublisherContentType>(() => {
    try {
      const saved = localStorage.getItem('cqai-publisher-content-type')
      return saved === 'article' || saved === 'image-note' || saved === 'video' ? saved : 'video'
    } catch { return 'video' }
  })
  const chooseContentType = (value: PublisherContentType) => {
    setContentType(value)
    try { localStorage.setItem('cqai-publisher-content-type', value) } catch { /* optional preference */ }
  }
  return <section className="pub"><style>{css}</style><div className="pub-wrap">
    <header className="pub-head"><div><h1>多平台发布</h1><div className="pub-muted">在 e宝工坊中编辑内容、选择账号并提交到本机发布队列。</div></div></header>
    <nav className="pub-tabs" role="tablist" aria-label="多平台发布导航">
      {([
        ['publish', '发布'], ['history', '发布历史'], ['accounts', '平台账号管理'],
      ] as const).map(([value, label]) => <button key={value} className="pub-tab" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    <div hidden={tab !== 'publish'}><div className="pub-layout">
      <nav className="pub-type-nav" aria-label="内容类型">
        {([
          ['article', '文章'], ['image-note', '图文'], ['video', '视频'],
        ] as const).map(([value, label]) => <button className="pub-type" key={value} aria-current={contentType === value} onClick={() => chooseContentType(value)}>{label}</button>)}
      </nav>
      <div>
        <div hidden={contentType !== 'article'}><ContentEditor contentType="article" active={tab === 'publish' && contentType === 'article'}/></div>
        <div hidden={contentType !== 'image-note'}><ContentEditor contentType="image-note" active={tab === 'publish' && contentType === 'image-note'}/></div>
        <div hidden={contentType !== 'video'}><VideoPage active={tab === 'publish' && contentType === 'video'}/></div>
      </div>
    </div></div>
    <div hidden={tab !== 'history'}><SubmissionHistory active={tab === 'history'}/></div>
    <div hidden={tab !== 'accounts'}><AccountsPage active={tab === 'accounts'}/></div>
  </div></section>
}

export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PUBLISHER_PANEL }, PublisherPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PUBLISHER_PANEL, order: 42, label: '多平台发布' }, ({ size }: PropsRuntime<'sidebar.panellist'>) => <PublishIcon size={size}/>))
}
