/** Pure product wordmark shared by Desktop Client and native Electron chrome. */

import {
  DESKTOP_BRAND_NAME,
  DESKTOP_BRAND_WORDMARK_DATA_URI,
} from './desktop-brand-assets.ts'

export interface DesktopBrandWordmarkProps {
  readonly className?: string
  /** Keep the titlebar artwork discoverable to assistive technology. */
  readonly decorative?: boolean
}

/** Render the complete supplied wordmark for desktop-owned chrome. */
export function DesktopBrandWordmark({ className, decorative = false }: DesktopBrandWordmarkProps) {
  const classNames = className === undefined
    ? 'dshDesktopFrameProductLogo'
    : `dshDesktopFrameProductLogo ${className}`
  return <img
    aria-hidden={decorative ? 'true' : undefined}
    className={classNames}
    draggable={false}
    src={DESKTOP_BRAND_WORDMARK_DATA_URI}
    alt={decorative ? '' : DESKTOP_BRAND_NAME}
  />
}
