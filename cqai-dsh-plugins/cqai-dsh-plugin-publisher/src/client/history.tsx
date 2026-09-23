import { useEffect, useState } from 'react'
import {
  PLATFORM_LABELS, type PublisherContentType, type PublisherSubmission,
} from '../protocol.ts'
import { api, CONTENT_LABELS, errorMessage } from './shared.tsx'

export function SubmissionHistory({ active }: { active: boolean }) {
  const [rows, setRows] = useState<PublisherSubmission[]>([])
  const [filter, setFilter] = useState<'all' | PublisherContentType>('all')
  const [error, setError] = useState('')
  const refresh = () => void api<PublisherSubmission[]>('submissions').then(setRows).catch(cause => setError(errorMessage(cause)))
  useEffect(() => { if (active) refresh() }, [active])
  const visible = rows.filter(item => filter === 'all' || (item.contentType ?? 'video') === filter)
  return <div>
    <div className="pub-head"><div><h2>发布历史</h2><p className="pub-muted">这里只记录已经被本机队列接受的提交，不代表平台最终发布成功。</p></div>
      <div className="pub-actions"><select className="pub-input" aria-label="筛选内容类型" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
        <option value="all">全部类型</option><option value="article">文章</option><option value="image-note">图文</option><option value="video">视频</option>
      </select><button className="pub-secondary" onClick={refresh}>刷新记录</button></div>
    </div>
    {error && <div className="pub-error" role="alert">{error}</div>}
    <div className="pub-card">{visible.length === 0 ? <div className="pub-empty">暂无提交记录</div> : visible.map(item => <div className="pub-submission" key={item.id}>
      <strong>{CONTENT_LABELS[item.contentType ?? 'video']} · {item.title}</strong>
      <small className="pub-muted">{new Date(item.createdAt).toLocaleString()} · {item.mode === 'publish' ? '立即发布' : '转存草稿'}</small>
      <div className="pub-targets">{item.targets.map(target => <button className="pub-target" key={`${item.id}:${target.accountId}`}
        onClick={() => void api('account-open-dashboard', { id: target.accountId }).catch(cause => setError(errorMessage(cause)))}>
        {PLATFORM_LABELS[target.platform]} · {target.accountName} · 打开后台
      </button>)}</div>
    </div>)}</div>
  </div>
}
