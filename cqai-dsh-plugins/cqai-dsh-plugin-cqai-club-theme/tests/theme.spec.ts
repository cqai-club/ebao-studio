import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { DEFAULT_ACCENT, tokensForAccent, contrastRatio } from '../src/client/accent.ts'
import { CLUB_THEME_TOKENS, tokensForPreset } from '../src/client/palette.ts'
import { THEME_PRESET_ORDER, type ThemePreset } from '../src/client/presets.ts'
import { PREFERENCES_KEY, type ClubThemePreferenceStore } from '../src/client/preferences.ts'
import { CLASSIC_DARK_BACKGROUND, CLASSIC_LIGHT_BACKGROUND, PRESET_WALLPAPERS } from '../src/client/wallpaper.ts'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

function contrast(left: string, right: string): number {
  const first = luminance(left)
  const second = luminance(right)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('CQAI Club palette', () => {
  it('uses neutral colors for the default light and dark palettes', () => {
    expect(DEFAULT_ACCENT).toBe('#242424')
    for (const modes of Object.values(CLUB_THEME_TOKENS)) {
      for (const color of [modes.light, modes.dark]) {
        const channels = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16))
        expect(Math.max(...channels) - Math.min(...channels), color).toBeLessThanOrEqual(5)
      }
    }
  })

  it('defines light and dark values for every overridden token', () => {
    expect(Object.keys(CLUB_THEME_TOKENS).length).toBeGreaterThan(10)
    for (const [name, modes] of Object.entries(CLUB_THEME_TOKENS)) {
      expect(name).toMatch(/^--dsw-/)
      expect(modes.light).toMatch(/^#[0-9A-F]{6}$/i)
      expect(modes.dark).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it.each(['light', 'dark'] as const)('keeps text and controls readable in %s mode', mode => {
    const token = (name: string) => CLUB_THEME_TOKENS[name]![mode]
    const surface = token('--dsw-alias-bg-layer-1')
    const base = token('--dsw-alias-bg-base')
    for (const name of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-link']) {
      expect(contrast(token(name), surface), `${name} against primary surface`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token(name), base), `${name} against application base`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(token('--dsw-alias-label-primary-foreground'), token('--dsw-alias-brand-primary'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('--dsw-alias-label-primary-foreground'), token('--dsw-alias-button-primary-fill'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('--dsw-alias-state-business-primary'), surface)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEME_PRESET_ORDER)('keeps %s readable in light and dark mode', preset => {
    const tokens = tokensForPreset(preset)
    for (const mode of ['light', 'dark'] as const) {
      const value = (name: string) => tokens[name]![mode]
      for (const surface of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1']) {
        for (const label of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-link']) {
          expect(contrastRatio(value(label), value(surface)), `${preset} ${mode} ${label} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(contrastRatio(value('--dsw-alias-button-primary-fill'), value('--dsw-alias-label-primary-foreground')), `${preset} ${mode} button`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(value('--dsw-alias-state-business-primary'), value('--dsw-alias-bg-layer-1')), `${preset} ${mode} state`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['extended', 'advanced'])('registers a removable override in %s mode', mode => {
    const storage = new Map<string, string>()
    const localStorage = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
      removeItem: vi.fn((key: string) => { storage.delete(key) }),
    }
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('window', {
      location: { search: `?dsh-desktop-mode=${mode}` }, localStorage, addEventListener, removeEventListener,
    })
    const styles: Array<{ dataset: Record<string, string>; textContent: string; remove: ReturnType<typeof vi.fn> }> = []
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const style = { dataset: {} as Record<string, string>, textContent: '', remove: vi.fn() }
        styles.push(style)
        return style
      }),
      head: { appendChild },
    })
    const disposers: Array<ReturnType<typeof vi.fn>> = []
    const overrideTokens = vi.fn(() => {
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    })
    const cleanups: Array<() => void> = []
    const effect = vi.fn((register: () => () => void) => { cleanups.push(register()) })
    const locale = { register: vi.fn(() => vi.fn()) }
    let preferences: ClubThemePreferenceStore | undefined
    const register = vi.fn((options: { inject: () => { preferences: ClubThemePreferenceStore } }) => {
      preferences = options.inject().preferences
      return vi.fn()
    })
    const slots = { inject: vi.fn((_: string, inject: () => void) => { inject() }), register }
    apply({ theme: { overrideTokens }, effect, locale, slots } as unknown as Context)
    expect(overrideTokens).toHaveBeenCalledWith('cqai-club-theme', CLUB_THEME_TOKENS)
    expect(effect).toHaveBeenCalledTimes(5)
    expect(locale.register).toHaveBeenCalledOnce()
    expect(slots.inject).toHaveBeenCalledWith('settings.general.item', expect.any(Function))
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]![0]).toMatchObject({ id: 'cqai-club-theme', order: 12 })
    const style = styles.find(item => item.dataset.pluginCss?.endsWith('/home-wallpaper'))!
    expect(style.dataset.pluginCss).toBe('cqai-dsh-plugin-cqai-club-theme/home-wallpaper')
    expect(style.textContent).toContain('.dshDesktopFrame:has(.dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"] .eBaoHomeDock)')
    expect(style.textContent).toContain(':not(:has(.dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"] [data-office-ppt-template-panel]))')
    expect(style.textContent).toContain('.dshDesktopSidebarSurface')
    expect(style.textContent).toContain('background: transparent !important')
    expect(style.textContent).toContain('body[data-ds-dark-theme]')
    expect(style.textContent).toContain('--cqai-club-home-light-background: none')
    expect(style.textContent).toContain('background-color: #F7FAFF')
    expect(style.textContent).toContain('background-color: #171D28')
    expect(style.textContent).toContain(CLASSIC_LIGHT_BACKGROUND)
    expect(style.textContent).toContain(CLASSIC_DARK_BACKGROUND)
    expect(style.textContent).toContain('backdrop-filter: blur(20px)')
    expect(style.textContent).toContain('.eBaoHomeSectionHeader')
    expect(appendChild).toHaveBeenCalledWith(style)
    preferences!.update({ background: 'custom', customImage: 'data:image/webp;base64,QUJD' })
    expect(style.textContent).toContain('--cqai-club-home-custom-image: url("data:image/webp;base64,QUJD")')
    expect(style.textContent.split('data:image/webp;base64,QUJD')).toHaveLength(2)
    expect(style.textContent).not.toContain(CLASSIC_LIGHT_BACKGROUND)
    expect(style.textContent).not.toContain('backdrop-filter: blur(20px)')
    preferences!.update({ background: 'plain', accent: '#087F72' })
    expect(localStorage.setItem).toHaveBeenCalledWith(PREFERENCES_KEY, expect.any(String))
    expect(style.textContent).toContain('--cqai-club-home-light-background: none')
    expect(overrideTokens).toHaveBeenLastCalledWith('cqai-club-theme', tokensForAccent('#087F72'))
    preferences!.update({ preset: 'china-red', background: 'galaxy', accent: null })
    expect(overrideTokens).toHaveBeenLastCalledWith('cqai-club-theme', tokensForPreset('china-red'))
    expect(style.textContent).toContain(`url("${PRESET_WALLPAPERS['china-red'].light}")`)
    expect(style.textContent).toContain(`url("${PRESET_WALLPAPERS['china-red'].dark}")`)
    preferences!.update({ preset: 'tech-blue', accent: '#087F72' })
    expect(overrideTokens).toHaveBeenLastCalledWith('cqai-club-theme', tokensForAccent('#087F72', 'tech-blue'))
    expect(style.textContent).toContain(`url("${PRESET_WALLPAPERS['tech-blue'].light}")`)
    expect(style.textContent).toContain(`url("${PRESET_WALLPAPERS['tech-blue'].dark}")`)
    preferences!.update({ preset: 'warm-cartoon', accent: null })
    expect(style.textContent).toContain(`url("${PRESET_WALLPAPERS['warm-cartoon'].light}")`)
    expect(style.textContent).toContain(`url("${PRESET_WALLPAPERS['warm-cartoon'].dark}")`)
    cleanups.forEach(cleanup => { cleanup() })
    expect(disposers.at(-1)).toHaveBeenCalledOnce()
    expect(style.remove).toHaveBeenCalledOnce()
    expect(styles.find(item => item.dataset.pluginCss?.endsWith('/settings'))?.remove).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('storage', expect.any(Function))
  })

  it('leaves compatibility mode untouched', () => {
    vi.stubGlobal('window', { location: { search: '?dsh-desktop-mode=compatibility' } })
    const effect = vi.fn()
    apply({ effect } as unknown as Context)
    expect(effect).not.toHaveBeenCalled()
  })

  it.each(['#FFFFFF', '#000000', '#FFEB00', '#4B6AFF', '#087F72'])('keeps a picked accent legible: %s', accent => {
    const tokens = tokensForAccent(accent)
    for (const mode of ['light', 'dark'] as const) {
      const primary = tokens['--dsw-alias-button-primary-fill']![mode]
      const foreground = tokens['--dsw-alias-label-primary-foreground']![mode]
      const surface = tokens['--dsw-alias-bg-base']![mode]
      expect(contrastRatio(primary, foreground), `${mode} primary button`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tokens['--dsw-alias-link']![mode], surface), `${mode} link`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['china-red', 'tech-blue', 'warm-cartoon'] as ThemePreset[])('keeps custom colors readable over the %s surfaces', preset => {
    const tokens = tokensForAccent('#FFEB00', preset)
    for (const mode of ['light', 'dark'] as const) {
      expect(contrastRatio(tokens['--dsw-alias-button-primary-fill']![mode], tokens['--dsw-alias-label-primary-foreground']![mode])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(tokens['--dsw-alias-link']![mode], tokens['--dsw-alias-bg-base']![mode])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps a representative grid of custom colors readable in both modes', () => {
    for (const red of [0, 64, 128, 192, 255]) {
      for (const green of [0, 64, 128, 192, 255]) {
        for (const blue of [0, 64, 128, 192, 255]) {
          const color = `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`
          const tokens = tokensForAccent(color)
          for (const mode of ['light', 'dark'] as const) {
            const primary = tokens['--dsw-alias-button-primary-fill']![mode]
            const foreground = tokens['--dsw-alias-label-primary-foreground']![mode]
            expect(contrastRatio(primary, foreground), `${color} ${mode} button`).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio(tokens['--dsw-alias-link']![mode], tokens['--dsw-alias-bg-base']![mode]), `${color} ${mode} link`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })
})
