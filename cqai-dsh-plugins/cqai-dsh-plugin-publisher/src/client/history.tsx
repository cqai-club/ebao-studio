import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  PLATFORM_LABELS, type PublisherContentType, type PublisherOpenTargetResult, type PublisherSubmission,
} from '../protocol.ts'
import { api, CONTENT_LABELS, errorMessage, PublisherModal } from './shared.tsx'
import { canOpenTarget, openTargetNotice } from './history-target.ts'
import { usePublisherTips } from './tips.tsx'

const PAGE_SIZE = 10
const STATE_LABELS = {
  queued: '等待执行', running: '执行中', unknown: '结果待确认',
  completed: '已完成', failed: '执行失败',
} as const
const STATE_TONES = {
  queued: 'neutral', running: 'info', unknown: 'warning',
  completed: 'success', failed: 'danger',
} as const

export function SubmissionHistory({ active }: { active: boolean }) {
  const { showError, showSuccess, clearTip } = usePublisherTips()
  const [rows, setRows] = useState<PublisherSubmission[]>([])
  const [filter, setFilter] = useState<'all' | PublisherContentType>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [openingTarget, setOpeningTarget] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<PublisherSubmission>()
  const [acknowledgedUnknown, setAcknowledgedUnknown] = useState(false)
  const busyRef = useRef(false)
  const openingRef = useRef(false)
  const requestSequence = useRef(0)
  const focusAfterDelete = useRef(false)

  const refresh = async () => {
    const sequence = ++requestSequence.current
    setRefreshing(true)
    try {
      const submissions = await api<PublisherSubmission[]>('submissions')
      if (sequence === requestSequence.current) setRows(submissions)
    } catch (cause) {
      if (sequence === requestSequence.current) showError(errorMessage(cause))
    } finally {
      if (sequence === requestSequence.current) setRefreshing(false)
    }
  }

  useEffect(() => { if (active) void refresh() }, [active])
  useEffect(() => {
    if (!deleteTarget && focusAfterDelete.current) {
      focusAfterDelete.current = false
      document.getElementById('pub-history-search')?.focus()
    }
  }, [deleteTarget, rows])

  const search = query.trim().toLocaleLowerCase()
  const filtered = rows.filter(item => {
    if (filter !== 'all' && (item.contentType ?? 'video') !== filter) return false
    if (!search) return true
    const terms = [item.title, CONTENT_LABELS[item.contentType ?? 'video'],
      item.mode === 'publish' ? '立即发布' : '转存草稿',
      item.state ? STATE_LABELS[item.state] : '',
      ...item.targets.flatMap(target => [PLATFORM_LABELS[target.platform], target.accountName])]
    return terms.some(term => term.toLocaleLowerCase().includes(search))
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const closeDelete = () => {
    if (busyRef.current) return
    setDeleteTarget(undefined)
    setAcknowledgedUnknown(false)
  }
  const confirmDelete = async () => {
    if (!deleteTarget || busyRef.current || (deleteTarget.state === 'unknown' && !acknowledgedUnknown)) return
    busyRef.current = true
    setDeleting(true)
    clearTip()
    try {
      await api('submission-delete', {
        id: deleteTarget.id,
        ...(deleteTarget.state === 'unknown' ? { acknowledgeUnknown: true } : {}),
      })
      ++requestSequence.current
      setRefreshing(false)
      setRows(current => current.filter(item => item.id !== deleteTarget.id))
      focusAfterDelete.current = true
      setDeleteTarget(undefined)
      setAcknowledgedUnknown(false)
      showSuccess('本机历史记录已删除')
    } catch (cause) {
      showError(errorMessage(cause))
    } finally {
      busyRef.current = false
      setDeleting(false)
    }
  }

  const openTarget = async (submissionId: string, accountId: string, state: PublisherSubmission['state'], listOnly = false) => {
    if (openingRef.current) return
    openingRef.current = true
    setOpeningTarget(`${submissionId}:${accountId}:${listOnly ? 'list' : 'target'}`)
    clearTip()
    try {
      const result = await api<PublisherOpenTargetResult>('submission-open-target', {
        submissionId, accountId, ...(listOnly ? { listOnly: true } : {}),
      })
      showSuccess(openTargetNotice(result.kind, state))
    } catch (cause) {
      showError(errorMessage(cause))
    } finally {
      openingRef.current = false
      setOpeningTarget(undefined)
    }
  }

  return <div>
    <div className="pub-head pub-history-head"><div><h2>发布历史</h2><p className="pub-muted">这里只记录已经被本机队列接受的提交，不代表平台最终发布成功。</p></div>
      <div className="pub-actions pub-history-tools">
        <Input id="pub-history-search" className="pub-input-wrap pub-history-search" type="search" aria-label="搜索发布历史" placeholder="搜索标题、平台或账号" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }}/>
        <select className="pub-input" aria-label="筛选内容类型" value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setPage(1) }}>
          <option value="all">全部类型</option><option value="article">文章</option><option value="image-note">图文</option><option value="video">视频</option>
        </select>
        <Button variant="outline" disabled={refreshing || deleting} onClick={() => void refresh()}>{refreshing ? '刷新中…' : '刷新记录'}</Button>
      </div>
    </div>
    <div className="pub-card">{filtered.length === 0
      ? <div className="pub-empty">{rows.length === 0 ? refreshing ? '正在加载记录…' : '暂无提交记录' : <>
          <div>没有符合条件的记录</div>
          <Button variant="outline" size="sm" onClick={() => { setQuery(''); setFilter('all'); setPage(1); document.getElementById('pub-history-search')?.focus() }}>清空筛选</Button>
        </>}</div>
      : visible.map(item => <div className="pub-submission" key={item.id}>
          <div className="pub-submission-head"><div>
            <strong>{CONTENT_LABELS[item.contentType ?? 'video']} · {item.title}</strong>
            <small className="pub-muted">{new Date(item.createdAt).toLocaleString()}</small>
          </div><Button variant="outline" size="sm" className="pub-danger-action"
            disabled={deleting || openingTarget !== undefined || !canOpenTarget(item.state)}
            title={item.state === 'queued' || item.state === 'running' ? '提交仍在队列中，不能删除' : undefined}
            aria-label={`删除记录：${item.title}，${new Date(item.createdAt).toLocaleString()}`}
            onClick={() => { setAcknowledgedUnknown(false); setDeleteTarget(item) }}>删除</Button></div>
          <div className="pub-tags">
            <Tag tone={item.mode === 'publish' ? 'info' : 'neutral'}>{item.mode === 'publish' ? '立即发布' : '转存草稿'}</Tag>
            {item.state && <Tag tone={STATE_TONES[item.state]}>{STATE_LABELS[item.state]}</Tag>}
          </div>
          {item.message && <p className="pub-history-result pub-muted">{item.message}</p>}
          {item.requestedMode === 'publish' && item.mode === 'draft' && <p className="pub-history-result pub-warn">文章已按平台要求调整，本次转存草稿供核对。</p>}
          {!!item.adjustments?.length && <ul className="pub-history-result pub-muted">{item.adjustments.flatMap(adjustment => {
            const target = item.targets.find(row => row.accountId === adjustment.accountId)
            return adjustment.messages.map(message => <li key={`${adjustment.accountId}:${message}`}>
              {target ? PLATFORM_LABELS[target.platform] : '目标平台'}：{message}
            </li>)
          })}</ul>}
          <div className="pub-targets">{item.targets.map(target => <span className="pub-target-group" key={`${item.id}:${target.accountId}`}>
            <Button variant="outline" size="sm"
              disabled={deleting || openingTarget !== undefined || !canOpenTarget(item.state)}
              title={!canOpenTarget(item.state) ? '提交仍在队列中，暂不能查看平台稿件' : undefined}
              onClick={() => void openTarget(item.id, target.accountId, item.state)}>
              {PLATFORM_LABELS[target.platform]} · {target.accountName} · {openingTarget === `${item.id}:${target.accountId}:target` ? '正在打开…' : '查看平台稿件'}
            </Button>
            <Button variant="outline" size="sm"
              aria-label={`打开${PLATFORM_LABELS[target.platform]}账号${target.accountName}的列表`}
              disabled={deleting || openingTarget !== undefined || !canOpenTarget(item.state)}
              title={!canOpenTarget(item.state) ? '提交仍在队列中，暂不能打开列表' : '列表不可用时打开创作后台'}
              onClick={() => void openTarget(item.id, target.accountId, item.state, true)}>
              {openingTarget === `${item.id}:${target.accountId}:list` ? '正在打开…' : '打开列表'}
            </Button>
          </span>)}</div>
        </div>)}</div>
    {filtered.length > 0 && <nav className="pub-history-pagination" aria-label="发布历史分页">
      <span className="pub-muted" aria-live="polite">共 {filtered.length} 条 · 第 {currentPage} / {pageCount} 页 · 每页 {PAGE_SIZE} 条</span>
      {pageCount > 1 && <div className="pub-history-page-actions">
        <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
        <Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</Button>
      </div>}
    </nav>}
    <PublisherModal open={deleteTarget !== undefined} title="删除发布历史" closeLabel="关闭删除历史确认"
      description={deleteTarget ? `删除“${deleteTarget.title}”这条本机历史记录？` : ''}
      className="pub-modal" onClose={closeDelete}
      footer={<>
        <Button variant="outline" data-pub-initial-focus disabled={deleting} onClick={closeDelete}>取消</Button>
        <Button variant="outline" className="pub-danger-action" disabled={deleting || (deleteTarget?.state === 'unknown' && !acknowledgedUnknown)} onClick={() => void confirmDelete()}>{deleting ? '正在删除…' : '确认删除'}</Button>
      </>}>
      {deleteTarget?.state === 'unknown' && <>
        <p className="pub-modal-copy">这条提交的结果尚未确认。{deleteTarget.message && <>原因：{deleteTarget.message}<br /></>}删除前请到对应平台后台核对。</p>
        <label className="pub-history-acknowledge"><input type="checkbox" checked={acknowledgedUnknown} onChange={event => setAcknowledgedUnknown(event.target.checked)} />我已核对平台状态，了解删除不会撤回平台内容</label>
      </>}
      <p className="pub-modal-copy">删除仅移除本机记录{deleteTarget?.state === 'unknown' ? '；这条待确认记录的内容快照会暂时保留' : '，并尝试清理对应快照'}；不会撤回平台内容，也不会删除原草稿或成片。待执行或执行中的任务不能删除。</p>
    </PublisherModal>
  </div>
}
