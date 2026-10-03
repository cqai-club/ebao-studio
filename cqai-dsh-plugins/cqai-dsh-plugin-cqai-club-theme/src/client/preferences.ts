import { isThemePreset, type ThemePreset } from './presets.ts'

// Keep the persisted `galaxy` value for existing v1 preferences; it now means
// the built-in preset background (soft mist for classic).
export type HomeBackground = 'galaxy' | 'plain' | 'custom'

export interface ClubThemePreferences {
  readonly preset: ThemePreset
  readonly background: HomeBackground
  readonly accent: string | null
  readonly customImage: string | null
}

export const PREFERENCES_KEY = 'cqai-club-theme:appearance:v1'
export const MAX_CUSTOM_IMAGE_URL_LENGTH = 1_500_000
export const DEFAULT_PREFERENCES: ClubThemePreferences = Object.freeze({
  preset: 'classic',
  background: 'galaxy',
  accent: null,
  customImage: null,
})

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const WEBP_DATA_URL = /^data:image\/webp;base64,([a-z0-9+/]+={0,2})$/i

export function normalizeAccent(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toUpperCase() : null
}

export function isStoredWallpaper(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_CUSTOM_IMAGE_URL_LENGTH
    && WEBP_DATA_URL.test(value)
}

export function parsePreferences(raw: string | null): ClubThemePreferences {
  if (raw === null) return DEFAULT_PREFERENCES
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_PREFERENCES
    const value = parsed as Record<string, unknown>
    const preset = isThemePreset(value.preset) ? value.preset : 'classic'
    const customImage = isStoredWallpaper(value.customImage) ? value.customImage : null
    const background = value.background === 'plain' || value.background === 'galaxy'
      ? value.background
      : value.background === 'custom' && customImage !== null ? 'custom' : 'galaxy'
    return Object.freeze({ preset, background, accent: normalizeAccent(value.accent), customImage })
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function readStoredPreferences(): ClubThemePreferences {
  try { return parsePreferences(window.localStorage.getItem(PREFERENCES_KEY)) }
  catch { return DEFAULT_PREFERENCES }
}

/** One local Desktop preference source shared by the settings row and live theme effects. */
export class ClubThemePreferenceStore {
  private snapshot = readStoredPreferences()
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ClubThemePreferences => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(next: ClubThemePreferences): void {
    if (next.preset === this.snapshot.preset
      && next.background === this.snapshot.background
      && next.accent === this.snapshot.accent
      && next.customImage === this.snapshot.customImage) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  /** Persist before publishing so a quota failure leaves the current theme intact. */
  update(changes: Partial<ClubThemePreferences>): void {
    const next = parsePreferences(JSON.stringify({ ...this.snapshot, ...changes }))
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next))
    this.publish(next)
  }

  reset(): void {
    window.localStorage.removeItem(PREFERENCES_KEY)
    this.publish(DEFAULT_PREFERENCES)
  }

  listenForStorageChanges(): () => void {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== PREFERENCES_KEY && event.key !== null) return
      this.publish(readStoredPreferences())
    }
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage) }
  }
}

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif'])
const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024
const MAX_SOURCE_PIXELS = 48_000_000

/** Decode a local raster and keep the persistent wallpaper below the storage cap. */
export async function prepareWallpaper(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('image-type')
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error('image-size')

  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) throw new Error('image-size')
    for (const maxEdge of [1920, 1600, 1280]) {
      const scale = Math.min(1, maxEdge / bitmap.width, (maxEdge * 9 / 16) / bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('image-encode')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const encoded = canvas.toDataURL('image/webp', maxEdge === 1920 ? 0.78 : 0.68)
      if (isStoredWallpaper(encoded)) return encoded
    }
    throw new Error('image-size')
  } finally {
    bitmap.close()
  }
}
