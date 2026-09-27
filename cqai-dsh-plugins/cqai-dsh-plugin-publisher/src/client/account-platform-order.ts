import { CONTENT_ACCOUNT_PLATFORMS } from '../content-targets.ts'
import type { Platform } from '../protocol.ts'

type EditorType = 'article' | 'image-note'

/** Show requested targets first while leaving every supported platform available for manual changes. */
export function accountPlatformOrder(contentType: EditorType, intendedPlatforms?: readonly Platform[]): Platform[] {
  const allowed: readonly Platform[] = CONTENT_ACCOUNT_PLATFORMS[contentType]
  const requested = intendedPlatforms?.filter(platform => allowed.includes(platform)) ?? []
  return [...new Set([...requested, ...allowed])]
}
