import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  DESKTOP_LOGIN_COMPLETION_URL,
  DESKTOP_PAYMENT_RESULT_URL,
  DESKTOP_PROTOCOL_SCHEME,
  isDesktopActivationUrl,
  isDesktopLoginCompletionUrl,
  registerDesktopProtocolClient,
} from '../src/desktop-protocol.ts'

describe('Desktop protocol', () => {
  it('registers the packaged product scheme', () => {
    const setAsDefaultProtocolClient = vi.fn(() => true)
    expect(registerDesktopProtocolClient({ setAsDefaultProtocolClient }, {
      execPath: 'C:\\Program Files\\易宝工坊\\易宝工坊.exe',
      argv: [],
    })).toBe(true)
    expect(DESKTOP_PROTOCOL_SCHEME).toBe('dsh-desktop')
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith('dsh-desktop')
  })

  it('registers the Electron development entry and accepts only the fixed callback', () => {
    const setAsDefaultProtocolClient = vi.fn(() => true)
    const entry = 'E:\\workspace\\project\\dsh-desktop\\dsh-plugin-desktop\\lib\\main.js'
    registerDesktopProtocolClient({ setAsDefaultProtocolClient }, {
      defaultApp: true,
      execPath: 'E:\\workspace\\project\\dsh-desktop\\node_modules\\electron\\electron.exe',
      argv: ['electron.exe', entry],
    })
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith(
      'dsh-desktop',
      'E:\\workspace\\project\\dsh-desktop\\node_modules\\electron\\electron.exe',
      [resolve(entry)],
    )
    expect(DESKTOP_LOGIN_COMPLETION_URL).toBe('dsh-desktop://oauth/complete')
    expect(isDesktopLoginCompletionUrl(DESKTOP_LOGIN_COMPLETION_URL)).toBe(true)
    expect(isDesktopLoginCompletionUrl('dsh-desktop://oauth/complete?code=secret')).toBe(false)
    expect(isDesktopLoginCompletionUrl('https://example.test/oauth/complete')).toBe(false)
    expect(DESKTOP_PAYMENT_RESULT_URL).toBe('dsh-desktop://payment/result')
    expect(isDesktopActivationUrl(DESKTOP_PAYMENT_RESULT_URL)).toBe(true)
    expect(isDesktopActivationUrl(`${DESKTOP_PAYMENT_RESULT_URL}?status=cancelled`)).toBe(true)
    expect(isDesktopActivationUrl(`${DESKTOP_PAYMENT_RESULT_URL}?token=secret`)).toBe(false)
  })
})
