/**
 * Host half of the CQAI quick navigation plugin.
 *
 * The first version is intentionally browser-only. Keeping an explicit no-op
 * Host entry makes the package installable by the normal DSH bundle loader and
 * leaves room for future CQAI routes or RPC handlers.
 */
export const inject: readonly string[] = []

export function apply(): void {
  // Host routes will be added here when a CQAI feature needs filesystem,
  // process, or persisted application state.
}
