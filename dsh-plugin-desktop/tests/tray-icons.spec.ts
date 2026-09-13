import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopTrayIcons } from '../src/runtime.ts'

const electron = vi.hoisted(() => {
  const template = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const white = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const blue = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const createFromPath = vi.fn((path: string) => {
    if (path.endsWith('Template.png')) return template
    if (path.endsWith('white.png')) return white
    if (path.endsWith('blue.png')) return blue
    throw new Error(`unexpected image path ${path}`)
  })
  return { blue, createFromPath, template, white }
})

vi.mock('electron', () => ({
  nativeImage: { createFromPath: electron.createFromPath },
}))

import { prepareTrayIcon } from '../src/tray-icons.ts'

const assets: DesktopTrayIcons = {
  templatePath: '/tmp/tray-iconTemplate.png',
  whitePath: '/tmp/tray-icon-white.png',
  bluePath: '/tmp/tray-icon-blue.png',
}

describe('platform tray icons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.template.isEmpty.mockReturnValue(false)
    electron.white.isEmpty.mockReturnValue(false)
    electron.blue.isEmpty.mockReturnValue(false)
  })

  it('marks the macOS image as a native template', () => {
    expect(prepareTrayIcon(assets, 'darwin')).toBe(electron.template)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.templatePath)
    expect(electron.template.setTemplateImage).toHaveBeenCalledWith(true)
  })

  it('uses the white notification-area image on Windows', () => {
    expect(prepareTrayIcon(assets, 'win32')).toBe(electron.white)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.whitePath)
    expect(electron.template.setTemplateImage).not.toHaveBeenCalled()
  })

  it('keeps the fixed brand-blue image on Linux', () => {
    expect(prepareTrayIcon(assets, 'linux')).toBe(electron.blue)
    expect(electron.createFromPath).toHaveBeenCalledOnce()
    expect(electron.createFromPath).toHaveBeenCalledWith(assets.bluePath)
    expect(electron.template.setTemplateImage).not.toHaveBeenCalled()
  })

  it.each([
    ['darwin', 'templatePath', electron.template],
    ['win32', 'whitePath', electron.white],
    ['linux', 'bluePath', electron.blue],
  ] as const)('rejects an empty %s tray image', (platform, pathKey, image) => {
    image.isEmpty.mockReturnValueOnce(true)

    expect(() => prepareTrayIcon(assets, platform)).toThrow(
      `failed to load tray icon ${assets[pathKey]}`,
    )
  })
})
