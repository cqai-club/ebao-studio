/** Plain renderer-safe contract for the generation-owned Desktop update state. */

/** Authenticated read-only endpoint; reading it never checks or downloads a release. */
export const DESKTOP_UPDATE_STATUS_PATH = '/api/desktop/updates/status'

/** Current local state of the existing interactive update flow. */
export interface DesktopUpdateStatus {
  readonly supported: boolean
  readonly currentVersion: string
  readonly availableVersion: string | null
  readonly checking: boolean
  readonly downloading: boolean
}
