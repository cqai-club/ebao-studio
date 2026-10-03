/** Built-in looks. The monochrome look remains the default for existing users. */
export const THEME_PRESETS = {
  classic: { accent: '#242424' },
  'china-red': { accent: '#A51F34' },
  'tech-blue': { accent: '#175FC5' },
  'warm-cartoon': { accent: '#A84863' },
} as const

export type ThemePreset = keyof typeof THEME_PRESETS
export const THEME_PRESET_ORDER: readonly ThemePreset[] = ['classic', 'china-red', 'tech-blue', 'warm-cartoon']

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_PRESETS, value)
}
