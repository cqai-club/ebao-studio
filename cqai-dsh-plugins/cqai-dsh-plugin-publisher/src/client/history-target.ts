import type { PublisherOpenTargetResult, PublisherSubmission } from '../protocol.ts'

export function canOpenTarget(state: PublisherSubmission['state']): boolean {
  return state !== 'queued' && state !== 'running'
}

export function openTargetNotice(kind: PublisherOpenTargetResult['kind'], state?: PublisherSubmission['state']): string {
  let message: string
  switch (kind) {
    case 'draft': message = '已打开平台草稿。'; break
    case 'draft-list': message = '已打开草稿列表，请在平台内查找对应稿件。'; break
    case 'content-list': message = '已打开内容列表，请在平台内查找对应稿件。'; break
    case 'backend': message = '已打开创作后台；当前无法确认专用列表，请在平台内查找对应稿件。'; break
    case 'review-window': return state === 'unknown'
      ? '已切换到待核查的发布窗口，请先确认平台结果。'
      : state === 'completed'
        ? '已切换到保留的草稿窗口，请在平台内查看稿件。'
        : '已切换到保留的平台窗口，请核对稿件与提交结果。'
    default: throw new Error('平台打开结果无效，请刷新后重试')
  }
  if (state === 'unknown') return `${message}这条任务结果仍待确认，请核对平台状态。`
  if (state === 'failed') return `${message}这条任务执行失败，请核对平台是否留下稿件。`
  return message
}
