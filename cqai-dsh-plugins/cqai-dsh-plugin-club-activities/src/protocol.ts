export const RPC_CHANNEL = '/cqaiclub-activities'

export type ActivityConfig = {
  portalUrl: string
  /** Absent until the MCP extension migrates or saves this Profile's preference. */
  mcpEnabled?: boolean | { get(): boolean | undefined }
}

export type ActivitySnapshot = {
  state: 'signed-out' | 'reauth-required' | 'authorizing' | 'signed-in' | 'error'
  displayName?: string
  canManage?: boolean
  authorizationUrl?: string
  message?: string
}

export type ActivityView = {
  id: string
  title: string
  summary: string
  content: string
  mode: string
  location: string
  startsAt: string
  endsAt: string
  registrationOpensAt: string
  registrationClosesAt: string
  capacity: number
  registeredCount: number
  status: string
  detailsChangedAt: string | null
  deletedAt: string | null
}

export type ActivityInput = Pick<ActivityView,
  'title' | 'summary' | 'content' | 'mode' | 'location' | 'startsAt' | 'endsAt' |
  'registrationOpensAt' | 'registrationClosesAt' | 'capacity'>

/** The portal accepts npm catalog metadata, never an uploaded binary. */
export type PluginSubmissionInput = {
  packageName: string
  displayName: string
  summary: string
  description?: string
  categories?: string[]
  keywords?: string[]
  repositoryUrl?: string
  homepageUrl?: string
  iconUrl?: string
  compatibilityApiVersion?: string
  compatibilityHosts?: string[]
}

export type PluginSubmission = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  packageName: string
  displayName: string
  summary: string
  createdAt: string
  reviewedAt?: string | null
  reviewNote?: string | null
}
