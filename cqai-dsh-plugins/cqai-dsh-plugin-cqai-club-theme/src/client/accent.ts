import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { tokensForPreset } from './palette.ts'
import { THEME_PRESETS, type ThemePreset } from './presets.ts'

export const DEFAULT_ACCENT = THEME_PRESETS.classic.accent

type Rgb = readonly [number, number, number]

function rgb(hex: string): Rgb {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as unknown as Rgb
}

function hex(channels: Rgb): string {
  return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function blend(left: string, right: string, amount: number): string {
  const from = rgb(left)
  const to = rgb(right)
  return hex(from.map((channel, index) => channel * (1 - amount) + to[index]! * amount) as unknown as Rgb)
}

function luminance(value: string): number {
  const [red, green, blue] = rgb(value).map(channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

export function contrastRatio(left: string, right: string): number {
  const first = luminance(left)
  const second = luminance(right)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function accessibleAccent(color: string, toward: '#000000' | '#FFFFFF', against: readonly string[]): string {
  if (against.every(surface => contrastRatio(color, surface) >= 4.5)) return color
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2
    const candidate = blend(color, toward, middle)
    if (against.every(surface => contrastRatio(candidate, surface) >= 4.5)) high = middle
    else low = middle
  }
  return blend(color, toward, high)
}

/** A picked accent is mapped to readable button, link, state and focus tokens in both schemes. */
export function tokensForAccent(accent: string | null, preset: ThemePreset = 'classic'): ThemeTokenOverrides {
  const base = tokensForPreset(preset)
  if (accent === null) return base
  const light = accessibleAccent(accent, '#000000', [
    base['--dsw-alias-label-primary-foreground']!.light,
    base['--dsw-alias-bg-layer-1']!.light,
    base['--dsw-alias-bg-base']!.light,
  ])
  const dark = accessibleAccent(accent, '#FFFFFF', [
    base['--dsw-alias-label-primary-foreground']!.dark,
    base['--dsw-alias-bg-layer-1']!.dark,
    base['--dsw-alias-bg-base']!.dark,
  ])
  const primary = { light, dark }
  return {
    ...base,
    '--dsw-alias-brand-primary': primary,
    '--dsw-alias-button-primary-fill': primary,
    '--dsw-alias-button-primary-hover': { light: blend(light, '#000000', 0.12), dark: blend(dark, '#FFFFFF', 0.12) },
    '--dsw-alias-state-business-primary': primary,
    '--dsw-alias-state-business-tertiary': {
      light: blend(light, '#FFFFFF', 0.9),
      dark: blend(dark, base['--dsw-alias-bg-layer-1']!.dark, 0.78),
    },
    '--dsw-alias-button-info-fill': primary,
    '--dsw-alias-button-info-hover': { light: blend(light, '#000000', 0.12), dark: blend(dark, '#FFFFFF', 0.12) },
    '--dsw-alias-link': primary,
    '--dsw-focus-ring-color': primary,
  }
}
