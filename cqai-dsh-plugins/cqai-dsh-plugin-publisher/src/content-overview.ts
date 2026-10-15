/** Read-only list summaries combine the editable content with real Worker submission state. */
import { readContentLifecyclePendingKind } from './content-lifecycle.ts'
import type {
  PublisherContentPublicationSummary, PublisherContentQueryResult, PublisherSubmission,
} from './protocol.ts'

function publicationSummary(submission: PublisherSubmission | undefined): PublisherContentPublicationSummary {
  if (!submission) return { state: 'unpublished' }
  const state = submission.state === 'queued' ? 'queued'
    : submission.state === 'running' ? 'publishing'
      : submission.state === 'failed' ? 'failed'
        : submission.state === 'completed' ? submission.mode === 'draft' ? 'platform-draft'
          : submission.mode === 'publish' ? 'published' : 'unknown'
          : 'unknown'
  return { state,
    ...(typeof submission.id === 'string' ? { submissionId: submission.id } : {}),
    ...(typeof submission.createdAt === 'string' ? { submittedAt: submission.createdAt } : {}),
    ...(submission.mode === 'draft' || submission.mode === 'publish' ? { mode: submission.mode } : {}),
  }
}

/** null means the Worker was unavailable; an empty verified history means not yet submitted. */
export function annotateContentOverview(
  result: PublisherContentQueryResult, submissions: readonly PublisherSubmission[] | null,
  env: NodeJS.ProcessEnv = process.env,
): PublisherContentQueryResult {
  const latest = new Map<string, PublisherSubmission>()
  for (const submission of submissions ?? []) {
    if (!submission || typeof submission.contentId !== 'string' || typeof submission.createdAt !== 'string'
      || !Number.isFinite(Date.parse(submission.createdAt))) continue
    const previous = latest.get(submission.contentId)
    if (!previous || Date.parse(submission.createdAt) > Date.parse(previous.createdAt)
      || (submission.createdAt === previous.createdAt && submission.id > previous.id)) {
      latest.set(submission.contentId, submission)
    }
  }
  return { ...result, items: result.items.map(card => {
    const lifecyclePending = readContentLifecyclePendingKind(card.id, env)
    return { ...card,
      publication: submissions === null ? { state: 'unknown' as const } : publicationSummary(latest.get(card.id)),
      ...(lifecyclePending ? { lifecyclePending } : {}),
    }
  }) }
}
