/** Loopback HTTP surface shared by the host half and the browser panel. */
export const API = '/api/cqai-publisher'

/** MatrixMedia CLI platform ids, in the order the panel lists them. */
export const VIDEO_PLATFORMS = ['dy', 'ks', 'blbl', 'bjh', 'sph', 'xhs', 'fqsp', 'tt'] as const
/** MatrixMedia CLI platform id. */
export type Platform = typeof VIDEO_PLATFORMS[number] | 'jj'

/** Platform label exactly as upstream's `cli publish --help` names it. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  dy: '抖音', tt: '头条', ks: '快手', blbl: '哔哩哔哩', bjh: '百家号', sph: '视频号', xhs: '小红书', fqsp: '番茄视频', jj: '掘金',
}

/**
 * Platforms whose login MatrixMedia's own `cli login` can drive. Every other
 * platform is signed in through the MatrixMedia GUI; upstream exposes no
 * command-line path for them, so the panel says so instead of pretending.
 */
export const CLI_LOGIN_PLATFORMS: readonly Platform[] = ['dy', 'sph']

/**
 * Upstream advertises `--tags` as "上限 4 个话题" and starts warning past four,
 * so the panel refuses more before they reach the CLI.
 */
export const MAX_TAGS = 4

/** Creative-statement values accepted by `--creative-statement`. */
export const CREATIVE_STATEMENTS = ['none', 'ai_generated', 'fiction', 'marketing', 'personal_opinion', 'repost', 'self_made_no_repost'] as const
/** Creation disclosure sent alongside a video. */
export type CreativeStatement = typeof CREATIVE_STATEMENTS[number]
/** `self_made_no_repost` is哔哩哔哩-only upstream. */
export const BLBL_ONLY_STATEMENTS: readonly CreativeStatement[] = ['self_made_no_repost']

/** Character range upstream recommends for a 视频号 short title. */
export const SHORT_TITLE_RANGE = [6, 16] as const

/** Target state a single publish job was asked to reach. */
export type TargetState = 'pending' | 'running' | 'success' | 'scheduled' | 'draft' | 'failed' | 'unknown' | 'cancelled'

/** One platform inside a publish job. */
export interface PublishTarget {
  /** CLI platform id. */
  platform: Platform
  /** Account phone number, or empty for the platform's default account. */
  phone: string
  /** Terminal or in-flight state of this platform. */
  state: TargetState
  /** Human-readable reason for the current state. */
  message: string
  /** Upstream CLI exit code once the child exited, if it ever ran. */
  exitCode?: number
  /** Publish timestamp reported by MatrixMedia's own record file. */
  publishedAt?: string
}

/** Reasons a completed job could not be confirmed against MatrixMedia's records. */
export type VerifyReason = 'ok' | 'draft' | 'scheduled' | 'record-failed' | 'record-missing' | 'record-pending' | 'no-run'

/** A publish request; one job covers every selected platform. */
export interface PublishInput {
  /** Absolute path of the local video file. */
  file: string
  /** Video title, required by `-t`. */
  title: string
  /** Video description/body. */
  description?: string
  /** 视频号 short title (6-16 characters). */
  shortTitle?: string
  /** Up to {@link MAX_TAGS} tags, written without a leading `#`. */
  tags?: string[]
  /** Creation disclosure. */
  creativeStatement?: CreativeStatement
  /** `YYYY-MM-DD HH:mm:ss` for a one-off scheduled publish. */
  publishAt?: string
  /** Publish into the platform's draft box instead of going live. */
  draft?: boolean
  /** Platforms to publish to. */
  targets: {platform: Platform; phone?: string}[]
}

/** Phase of a job's overall lifecycle. */
export type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'

/** One publish job: a request plus the supervised child runs it produced. */
export interface PublishJob {
  /** Stable local id. */
  id: string
  /** ISO timestamp of creation. */
  createdAt: string
  /** The request this job was created from. */
  input: PublishInput
  /** Overall lifecycle phase. */
  status: JobStatus
  /** Per-platform progress, in the order the targets were submitted. */
  targets: PublishTarget[]
  /** Tail of the CLI's own stdout/stderr, newest last. */
  logs: string[]
  /** Set when the job itself failed before or between per-platform runs. */
  error?: string
  /** ISO timestamp of the terminal transition. */
  finishedAt?: string
}

/** Host environment answer for the panel's runtime card. */
export interface RuntimeStatus {
  /** Whether the MatrixMedia executable was found where the desktop app mounts it. */
  ready: boolean
  /** Absolute path probed for the runtime. */
  path: string
  /** Version parsed from the runtime's own banner, when it could be read. */
  version: string
  /** Where the path came from, so a support question can be answered quickly. */
  source: string
  /** Human-readable guidance when the runtime is missing or unusable. */
  message: string
  /** Whether a login or publish child process is running right now. */
  busy: boolean
  /** MatrixMedia's own data directory, the authoritative publish record. */
  dataDir: string
}

/** One platform account as reported by `cli accounts --json`. */
export interface AccountRow {
  /** Account phone number. */
  phone: string
  /** CLI platform id. */
  platform: string
  /** Full session partition upstream uses to find the login state. */
  partition: string
  /** Whether a usable login was found. */
  loggedIn: boolean
  /** Upstream's explanation when no login was found. */
  reason: string
  /** Expiry timestamp in milliseconds, or 0 when unknown. */
  expireAt: number
  /** Creation timestamp in milliseconds, or 0 when unknown. */
  createdAt: number
}

/** One publish record as reported by `cli history --json`. */
export interface HistoryRow {
  /** Date bucket file the record came from. */
  date: string
  /** Account phone number. */
  phone: string
  /** CLI platform id. */
  platform: string
  /** Record title. */
  title: string
  /** `success` | `failed` | `publishing` | `scheduled` | `expired`. */
  status: string
  /** Upload attempts so far. */
  attempts: number
  /** Successful uploads so far. */
  successes: number
  /** Failed uploads so far. */
  failures: number
  /** Upstream's own last message for this record. */
  message: string
  /** Last publish timestamp in milliseconds, or 0 when unknown. */
  lastAt: number
}

/**
 * One finished video e剪宝 produced, offered to the publish form. The two
 * plugins never import each other; they agree on `<DSH home>/ejianbao/jobs/`
 * instead, and this is the shape the publisher reads out of it.
 */
export interface Work {
  /** Video task id, stable across restarts. */
  id: string
  /** Task title, or a readable fallback when it was left blank. */
  title: string
  /** Absolute path of the 成片, the only thing `cli publish -f` accepts. */
  file: string
  /** ISO creation timestamp. */
  createdAt: string
  /** 成片 size in bytes. */
  bytes: number
}

/** Default title when the panel has nothing better to send. */
export const TITLE_MAX = 120
/** Description cap mirrored from the panel's own input limit. */
export const DESCRIPTION_MAX = 2000
