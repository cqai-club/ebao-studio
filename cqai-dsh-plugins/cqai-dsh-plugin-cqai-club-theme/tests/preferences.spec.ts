import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClubThemePreferenceStore, DEFAULT_PREFERENCES, PREFERENCES_KEY, parsePreferences, prepareWallpaper,
} from '../src/client/preferences.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('CQAI Club appearance preferences', () => {
  it('publishes a preset switch even when background and accent values stay the same', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    } })
    const preferences = new ClubThemePreferenceStore()
    const listener = vi.fn()
    preferences.subscribe(listener)

    preferences.update({ preset: 'china-red' })
    expect(preferences.getSnapshot()).toMatchObject({ preset: 'china-red', background: 'galaxy', accent: null })
    expect(listener).toHaveBeenCalledOnce()
    expect(new ClubThemePreferenceStore().getSnapshot().preset).toBe('china-red')

    preferences.update({ background: 'custom', customImage: 'data:image/webp;base64,QUJD' })
    preferences.update({ preset: 'warm-cartoon', background: 'galaxy', accent: null })
    expect(preferences.getSnapshot().customImage).toBe('data:image/webp;base64,QUJD')
  })

  it('rejects invalid stored images and color values', () => {
    expect(parsePreferences('{bad')).toBe(DEFAULT_PREFERENCES)
    expect(parsePreferences(JSON.stringify({ background: 'custom', customImage: 'javascript:alert(1)', accent: '#xyz' })))
      .toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences(JSON.stringify({ background: 'plain', accent: '#087f72', customImage: null })))
      .toMatchObject({ preset: 'classic', background: 'plain', accent: '#087F72' })
    expect(parsePreferences(JSON.stringify({ preset: '__proto__', background: 'plain' })))
      .toMatchObject({ preset: 'classic', background: 'plain' })
    expect(parsePreferences(JSON.stringify({ preset: 'china-red', background: 'custom', customImage: null })))
      .toMatchObject({ preset: 'china-red', background: 'galaxy' })
  })

  it('persists changes, restores defaults, and syncs changes from another window', () => {
    const storage = new Map<string, string>()
    let onStorage: ((event: { key: string | null }) => void) | undefined
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
      },
      addEventListener: (_: string, listener: typeof onStorage) => { onStorage = listener },
      removeEventListener: vi.fn(),
    })
    const preferences = new ClubThemePreferenceStore()
    const listener = vi.fn()
    const unsubscribe = preferences.subscribe(listener)
    const stopSync = preferences.listenForStorageChanges()

    preferences.update({ background: 'plain', accent: '#3963ce' })
    expect(preferences.getSnapshot()).toMatchObject({ background: 'plain', accent: '#3963CE' })
    expect(storage.has(PREFERENCES_KEY)).toBe(true)
    expect(listener).toHaveBeenCalledOnce()

    preferences.update({ preset: 'tech-blue', background: 'galaxy', accent: null })
    expect(preferences.getSnapshot()).toMatchObject({ preset: 'tech-blue', background: 'galaxy', accent: null })

    storage.set(PREFERENCES_KEY, JSON.stringify({ background: 'galaxy', accent: '#087F72', customImage: null }))
    onStorage?.({ key: PREFERENCES_KEY })
    expect(preferences.getSnapshot()).toMatchObject({ preset: 'classic', accent: '#087F72' })

    preferences.reset()
    expect(preferences.getSnapshot()).toBe(DEFAULT_PREFERENCES)
    expect(storage.has(PREFERENCES_KEY)).toBe(false)
    stopSync()
    unsubscribe()
  })

  it('does not apply an update when local storage rejects it', () => {
    vi.stubGlobal('window', { localStorage: {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
    } })
    const preferences = new ClubThemePreferenceStore()
    expect(() => { preferences.update({ background: 'plain' }) }).toThrow('quota')
    expect(preferences.getSnapshot()).toBe(DEFAULT_PREFERENCES)
  })

  it('compresses a local image into a bounded WebP wallpaper', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 2000, close })))
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/webp;base64,QUJD' }
    vi.stubGlobal('document', { createElement: () => canvas })
    const image = await prepareWallpaper({ type: 'image/png', size: 1024 } as File)
    expect(image).toBe('data:image/webp;base64,QUJD')
    expect(canvas.width).toBeLessThanOrEqual(1920)
    expect(canvas.height).toBeLessThanOrEqual(1080)
    expect(drawImage).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
