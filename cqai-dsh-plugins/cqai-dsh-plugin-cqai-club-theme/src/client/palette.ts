import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemePreset } from './presets.ts'

/** Quiet monochrome defaults mapped to DSH's semantic theme roles. */
export const CLUB_THEME_TOKENS: ThemeTokenOverrides = {
  '--dsw-alias-bg-base': { light: '#FFFFFF', dark: '#141414' },
  '--dsw-alias-bg-layer-1': { light: '#FFFFFF', dark: '#202020' },
  '--dsw-alias-bg-layer-2': { light: '#FFFFFF', dark: '#292929' },
  '--dsw-alias-bg-overlay': { light: '#FFFFFF', dark: '#2B2B2B' },
  '--dsw-specific-sidebar-fill': { light: '#FAFAFA', dark: '#1A1A1A' },
  '--dsw-alias-border-l1': { light: '#E6E6E6', dark: '#3B3B3B' },
  '--dsw-alias-border-l2': { light: '#CCCCCC', dark: '#555555' },
  '--dsw-alias-label-primary': { light: '#191919', dark: '#F4F4F2' },
  '--dsw-alias-label-secondary': { light: '#4D4D4D', dark: '#CBCBC8' },
  '--dsw-alias-label-tertiary': { light: '#666666', dark: '#A8A8A4' },
  '--dsw-alias-brand-primary': { light: '#242424', dark: '#E8E8E5' },
  '--dsw-alias-label-primary-foreground': { light: '#FFFFFF', dark: '#1A1A1A' },
  '--dsw-alias-button-primary-fill': { light: '#242424', dark: '#E8E8E5' },
  '--dsw-alias-button-primary-hover': { light: '#111111', dark: '#FFFFFF' },
  '--dsw-alias-state-business-primary': { light: '#444444', dark: '#D0D0CD' },
  '--dsw-alias-state-business-tertiary': { light: '#F2F2F2', dark: '#353535' },
  '--dsw-alias-button-info-fill': { light: '#363636', dark: '#D0D0CD' },
  '--dsw-alias-button-info-hover': { light: '#1B1B1B', dark: '#FFFFFF' },
  '--dsw-alias-link': { light: '#313131', dark: '#ECECE8' },
  '--dsw-focus-ring-color': { light: '#353535', dark: '#E5E5E2' },
}

type Pair = { light: string; dark: string }
type ColorScheme = {
  base: Pair
  surface: Pair
  raised: Pair
  overlay: Pair
  sidebar: Pair
  border: Pair
  strongBorder: Pair
  primary: Pair
  secondary: Pair
  tertiary: Pair
  brand: Pair
  brandHover: Pair
  onBrand: Pair
  softBrand: Pair
}

const COLOR_SCHEMES: Record<Exclude<ThemePreset, 'classic'>, ColorScheme> = {
  'china-red': {
    base: { light: '#FFF9F5', dark: '#1A1115' },
    surface: { light: '#FFFDFC', dark: '#25171B' },
    raised: { light: '#FFF2EB', dark: '#321F25' },
    overlay: { light: '#FFFBF7', dark: '#342329' },
    sidebar: { light: '#FFF4EF', dark: '#211417' },
    border: { light: '#ECD8D1', dark: '#53343B' },
    strongBorder: { light: '#DABAB2', dark: '#715059' },
    primary: { light: '#281C1C', dark: '#FFF3ED' },
    secondary: { light: '#5B4747', dark: '#D8C4BD' },
    tertiary: { light: '#725858', dark: '#BCA69F' },
    brand: { light: '#A51F34', dark: '#F5A89A' },
    brandHover: { light: '#8D182B', dark: '#FFC3B2' },
    onBrand: { light: '#FFFFFF', dark: '#201216' },
    softBrand: { light: '#FCE9E4', dark: '#38252A' },
  },
  'tech-blue': {
    base: { light: '#F4F8FF', dark: '#0A1526' },
    surface: { light: '#FFFFFF', dark: '#12233B' },
    raised: { light: '#EAF2FF', dark: '#1A304F' },
    overlay: { light: '#FFFFFF', dark: '#1B304C' },
    sidebar: { light: '#EEF5FF', dark: '#0E1D32' },
    border: { light: '#D6E4F6', dark: '#315071' },
    strongBorder: { light: '#B9CCE5', dark: '#496B8E' },
    primary: { light: '#14253C', dark: '#F0F6FF' },
    secondary: { light: '#435873', dark: '#C9D8EB' },
    tertiary: { light: '#5B6F8B', dark: '#AEC2DD' },
    brand: { light: '#175FC5', dark: '#8BBEFF' },
    brandHover: { light: '#104EAC', dark: '#A5CEFF' },
    onBrand: { light: '#FFFFFF', dark: '#0B1930' },
    softBrand: { light: '#E4F0FF', dark: '#203858' },
  },
  'warm-cartoon': {
    base: { light: '#FFF9F1', dark: '#211820' },
    surface: { light: '#FFFDF8', dark: '#2B202C' },
    raised: { light: '#FFF0E6', dark: '#382936' },
    overlay: { light: '#FFF9F3', dark: '#3C2D39' },
    sidebar: { light: '#FFF4E8', dark: '#261B27' },
    border: { light: '#ECDDD2', dark: '#584354' },
    strongBorder: { light: '#DCC5B8', dark: '#73576C' },
    primary: { light: '#3B2A32', dark: '#FFF2F2' },
    secondary: { light: '#604C55', dark: '#DECBD2' },
    tertiary: { light: '#775F6B', dark: '#C5AEB9' },
    brand: { light: '#A84863', dark: '#FFAFBF' },
    brandHover: { light: '#8F344F', dark: '#FFC7D2' },
    onBrand: { light: '#FFFFFF', dark: '#271923' },
    softBrand: { light: '#FCE8EB', dark: '#49313D' },
  },
}

function tokensForScheme(scheme: ColorScheme): ThemeTokenOverrides {
  return {
    ...CLUB_THEME_TOKENS,
    '--dsw-alias-bg-base': scheme.base,
    '--dsw-alias-bg-layer-1': scheme.surface,
    '--dsw-alias-bg-layer-2': scheme.raised,
    '--dsw-alias-bg-overlay': scheme.overlay,
    '--dsw-specific-sidebar-fill': scheme.sidebar,
    '--dsw-alias-border-l1': scheme.border,
    '--dsw-alias-border-l2': scheme.strongBorder,
    '--dsw-alias-label-primary': scheme.primary,
    '--dsw-alias-label-secondary': scheme.secondary,
    '--dsw-alias-label-tertiary': scheme.tertiary,
    '--dsw-alias-brand-primary': scheme.brand,
    '--dsw-alias-label-primary-foreground': scheme.onBrand,
    '--dsw-alias-button-primary-fill': scheme.brand,
    '--dsw-alias-button-primary-hover': scheme.brandHover,
    '--dsw-alias-state-business-primary': scheme.brand,
    '--dsw-alias-state-business-tertiary': scheme.softBrand,
    '--dsw-alias-button-info-fill': scheme.brand,
    '--dsw-alias-button-info-hover': scheme.brandHover,
    '--dsw-alias-link': scheme.brand,
    '--dsw-focus-ring-color': scheme.brand,
  }
}

const PRESET_TOKENS: Record<Exclude<ThemePreset, 'classic'>, ThemeTokenOverrides> = {
  'china-red': tokensForScheme(COLOR_SCHEMES['china-red']),
  'tech-blue': tokensForScheme(COLOR_SCHEMES['tech-blue']),
  'warm-cartoon': tokensForScheme(COLOR_SCHEMES['warm-cartoon']),
}

export function tokensForPreset(preset: ThemePreset): ThemeTokenOverrides {
  return preset === 'classic' ? CLUB_THEME_TOKENS : PRESET_TOKENS[preset]
}
