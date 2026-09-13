import type { App } from 'electron'
import { resolve } from 'node:path'

import { DESKTOP_PRODUCT_NAME, DESKTOP_RELEASE_CHANNEL } from './product-identity.ts'

export const DESKTOP_PROTOCOL_SCHEME = String(DESKTOP_RELEASE_CHANNEL) === 'beta'
  ? 'dsh-desktop-beta'
  : 'dsh-desktop'

export const DESKTOP_LOGIN_COMPLETION_URL = `${DESKTOP_PROTOCOL_SCHEME}://oauth/complete`
export const DESKTOP_PAYMENT_RESULT_URL = `${DESKTOP_PROTOCOL_SCHEME}://payment/result`

type ProtocolRegistrationApp = Pick<App, 'setAsDefaultProtocolClient'>

export interface DesktopProtocolProcess {
  readonly defaultApp?: boolean
  readonly execPath: string
  readonly argv: readonly string[]
}

/** Register the product-specific URL scheme for packaged and development launches. */
export function registerDesktopProtocolClient(
  application: ProtocolRegistrationApp,
  processLike: DesktopProtocolProcess = process,
): boolean {
  const entry = processLike.defaultApp === true ? processLike.argv[1] : undefined
  return entry === undefined
    ? application.setAsDefaultProtocolClient(DESKTOP_PROTOCOL_SCHEME)
    : application.setAsDefaultProtocolClient(
        DESKTOP_PROTOCOL_SCHEME,
        processLike.execPath,
        [resolve(entry)],
      )
}

/** Accept only the fixed login-completion activation URL. */
export function isDesktopLoginCompletionUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === `${DESKTOP_PROTOCOL_SCHEME}:`
      && url.hostname === 'oauth'
      && url.pathname === '/complete'
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

/** Accept credential-free login and payment return URLs owned by this product. */
export function isDesktopActivationUrl(value: string): boolean {
  if (isDesktopLoginCompletionUrl(value)) return true
  try {
    const url = new URL(value)
    const parameters = [...url.searchParams.entries()]
    return url.protocol === `${DESKTOP_PROTOCOL_SCHEME}:`
      && url.hostname === 'payment'
      && url.pathname === '/result'
      && url.username === ''
      && url.password === ''
      && url.hash === ''
      && (parameters.length === 0 || (parameters.length === 1 && parameters[0]?.[0] === 'status' && parameters[0]?.[1] === 'cancelled'))
  } catch {
    return false
  }
}

export function desktopProtocolRegistrationFailureMessage(): string {
  return `${DESKTOP_PRODUCT_NAME}: failed to register ${DESKTOP_PROTOCOL_SCHEME} URL protocol`
}
