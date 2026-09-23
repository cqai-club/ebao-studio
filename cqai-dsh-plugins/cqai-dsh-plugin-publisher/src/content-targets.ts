import type {
  Platform, PublisherAccount, PublisherContentType, PublisherMode, PublisherPlatformCapability,
} from './protocol.ts'

type EditableContentType = Exclude<PublisherContentType, 'video'>

/** Account choices are independent of the Worker capability/acceptance gate. */
export const CONTENT_ACCOUNT_PLATFORMS = {
  article: ['juejin', 'blbl', 'tt', 'bjh'],
  'image-note': ['xhs'],
} as const satisfies Record<EditableContentType, readonly Platform[]>

export function selectedContentAccounts(
  contentType: EditableContentType,
  accounts: PublisherAccount[],
  selection: Partial<Record<Platform, string>>,
): PublisherAccount[] {
  return CONTENT_ACCOUNT_PLATFORMS[contentType].flatMap(platform => {
    const account = accounts.find(item => item.platform === platform && item.id === selection[platform])
    return account ? [account] : []
  })
}

export function contentModeAvailable(
  platform: Platform,
  contentType: EditableContentType,
  mode: PublisherMode,
  capabilities: PublisherPlatformCapability[],
): boolean {
  return capabilities.some(item => item.platform === platform && item.modes[contentType]?.includes(mode))
}
