/** Display-only compatibility for Toutiao records; queue state and stored history stay intact. */
import type { Platform, PublisherSubmission } from './protocol.ts'

const TOUTIAO_INFORMATION = new Set([
  '独立摘要不会写入头条文章', '独立摘要未写入平台文章', '文章标签暂不写入该平台',
  '头条文章适配器暂不写入摘要；摘要仍保留在本地草稿',
  '该平台文章适配器暂不写入标签；标签仍保留在本地草稿',
])
const STATE_LABELS = {
  queued: '等待执行', running: '执行中', unknown: '结果待确认', completed: '已完成', failed: '执行失败',
} as const

export function isToutiaoOnly(platforms: readonly Platform[]): boolean {
  return platforms.length > 0 && platforms.every(platform => platform === 'tt')
}

export function isOperationTimeout(message: unknown): boolean {
  return typeof message === 'string' && /(?:waiting failed|timed?\s*out|timeout|超时)/iu.test(message)
}

export function displayAdjustmentMessage(platform: Platform | undefined, message: string): string | undefined {
  if (platform !== 'tt') return message
  if (TOUTIAO_INFORMATION.has(message)) return undefined
  if (message === '正文图片会在原位置保留占位，请在头条草稿中手动上传') return '正文图片会在原位置保留占位，请从发布历史打开头条草稿手动补图'
  if (message === '封面需在头条草稿中手动设置') return '封面需手动设置，请从发布历史打开头条草稿'
  const imageCount = /^头条正文已保留 (\d+) 处(?:无法自动上传的)?图片占位，请在草稿窗口手动上传$/u.exec(message)?.[1]
  if (imageCount) return `头条正文已保留 ${imageCount} 处图片占位，请从发布历史打开草稿手动补图`
  if (message === '头条封面不会自动上传，请在草稿窗口手动设置') return '头条封面需手动设置，请从发布历史打开草稿'
  if (message === '已以首张图片作为头条封面参考') return '已以首张图片作为头条封面参考，请从发布历史打开草稿手动设置'
  return message
}

export function displayArticleWarnings(warnings: readonly string[]): string[] {
  return warnings.flatMap(warning => {
    if (!warning.startsWith('头条：')) return [warning]
    const message = displayAdjustmentMessage('tt', warning.slice('头条：'.length))
    return message ? [`头条：${message}`] : []
  })
}

export function submissionStateLabel(submission: PublisherSubmission): string {
  if (!submission.state) return ''
  if (submission.state === 'unknown' && isToutiaoOnly(submission.targets.map(target => target.platform))) return '未完成'
  return STATE_LABELS[submission.state]
}

export function projectSubmissionForDisplay(submission: PublisherSubmission): PublisherSubmission {
  const onlyToutiao = isToutiaoOnly(submission.targets.map(target => target.platform))
  let message = submission.message
  if (onlyToutiao) {
    if (submission.state === 'unknown' || submission.state === 'failed') {
      if (isOperationTimeout(message)) message = '操作超时，任务未完成'
      else if (submission.state === 'unknown') message = '任务未完成，请从发布历史打开平台稿件核对'
    }
    if (message) {
      message = message.split(/[；;。\n]/u).filter(part => !/(?:保留.*窗口|窗口.*保留|账号.*锁定|关闭前.*账号.*不能.*提交|account.*lock|(?:摘要|标签).*(?:跳过|不写入|未写入|不会写入)|(?:跳过|不写入|未写入).*(?:摘要|标签))/iu.test(part)).join('；') || undefined
    }
  }
  const adjustments = submission.adjustments?.flatMap(adjustment => {
    const platform = submission.targets.find(target => target.accountId === adjustment.accountId)?.platform
    const messages = adjustment.messages.flatMap(text => {
      const display = displayAdjustmentMessage(platform, text)
      return display ? [display] : []
    })
    return messages.length ? [{ ...adjustment, messages }] : []
  })
  return { ...submission, message, adjustments }
}
