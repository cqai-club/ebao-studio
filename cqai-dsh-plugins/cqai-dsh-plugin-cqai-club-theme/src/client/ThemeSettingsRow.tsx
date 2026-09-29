import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_ACCENT } from './accent.ts'
import type { ClubThemeLocaleKey } from './locales.ts'
import { THEME_PRESETS, THEME_PRESET_ORDER, type ThemePreset } from './presets.ts'
import {
  ClubThemePreferenceStore, normalizeAccent, prepareWallpaper, type ClubThemePreferences,
} from './preferences.ts'
import { PRESET_WALLPAPERS } from './wallpaper.ts'

export type ThemeSettingsRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'cqai-club-theme'>
  & { preferences: ClubThemePreferenceStore }

const ACCENTS: readonly { value: string; label: ClubThemeLocaleKey }[] = [
  { value: DEFAULT_ACCENT, label: 'charcoal' },
  { value: THEME_PRESETS['china-red'].accent, label: 'red' },
  { value: THEME_PRESETS['tech-blue'].accent, label: 'blue' },
  { value: THEME_PRESETS['warm-cartoon'].accent, label: 'rose' },
  { value: '#5E36A5', label: 'purple' },
  { value: '#087F72', label: 'teal' },
]

const PRESET_COPY: Record<ThemePreset, { title: ClubThemeLocaleKey; description: ClubThemeLocaleKey }> = {
  classic: { title: 'classicPreset', description: 'classicPresetHint' },
  'china-red': { title: 'chinaRedPreset', description: 'chinaRedPresetHint' },
  'tech-blue': { title: 'techBluePreset', description: 'techBluePresetHint' },
  'warm-cartoon': { title: 'warmCartoonPreset', description: 'warmCartoonPresetHint' },
}

function PresetArtwork({ preset }: { preset: ThemePreset }) {
  if (preset === 'classic') return <span className="cqaiThemeClassicArtwork" />
  const images = PRESET_WALLPAPERS[preset]
  return <>
    <img className="cqaiThemeDefaultLight" src={images.light} alt="" />
    <img className="cqaiThemeDefaultDark" src={images.dark} alt="" />
  </>
}

export function ThemeSettingsRow({ t, preferences }: ThemeSettingsRowProps) {
  const current = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
  const presetAccent = THEME_PRESETS[current.preset].accent
  const fileInput = useRef<HTMLInputElement>(null)
  const [colorDraft, setColorDraft] = useState(current.accent ?? presetAccent)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setColorDraft(current.accent ?? presetAccent) }, [current.accent, presetAccent])

  const save = (changes: Partial<ClubThemePreferences>): boolean => {
    try {
      preferences.update(changes)
      setError(null)
      return true
    } catch {
      setError(t('saveFailed'))
      return false
    }
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined) return
    setUploading(true)
    try {
      const customImage = await prepareWallpaper(file)
      save({ background: 'custom', customImage })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : ''
      setError(t(reason === 'image-type' ? 'invalidImageType'
        : reason === 'image-size' ? 'imageTooLarge' : 'imageFailed'))
    } finally {
      setUploading(false)
    }
  }

  const commitColor = (value: string): void => {
    const normalized = normalizeAccent(value)
    if (normalized === null) {
      setError(t('invalidColor'))
      setColorDraft(current.accent ?? presetAccent)
      return
    }
    setColorDraft(normalized)
    if (!save({ accent: normalized === presetAccent ? null : normalized })) setColorDraft(current.accent ?? presetAccent)
  }

  return (
    <section className="cqaiThemeSettings" aria-label={t('title')}>
      <div className="cqaiThemeSettingsHeader">
        <div>
          <h3>{t('title')}</h3>
          <p>{t('description')}</p>
        </div>
        <button type="button" className="cqaiThemeSettingsReset" onClick={() => {
          try { preferences.reset(); setError(null) }
          catch { setError(t('saveFailed')) }
        }}>{t('reset')}</button>
      </div>

      <fieldset className="cqaiThemeSettingsGroup">
        <legend>{t('presets')}</legend>
        <p>{t('presetsHint')}</p>
        <div className="cqaiThemePresetGrid">
          {THEME_PRESET_ORDER.map(preset => <button key={preset} type="button" className="cqaiThemePresetChoice" data-preset={preset} aria-pressed={current.preset === preset} onClick={() => { save({ preset, background: 'galaxy', accent: null }) }}>
            <span className="cqaiThemePresetPreview" aria-hidden="true">
              <PresetArtwork preset={preset} />
              <span className="cqaiThemePresetMockSidebar" />
              <span className="cqaiThemePresetMockCard" />
            </span>
            <span className="cqaiThemePresetName">{t(PRESET_COPY[preset].title)}</span>
            <span className="cqaiThemePresetDescription">{t(PRESET_COPY[preset].description)}</span>
          </button>)}
        </div>
      </fieldset>

      <fieldset className="cqaiThemeSettingsGroup">
        <legend>{t('background')}</legend>
        <p>{t('backgroundHint')}</p>
        <div className="cqaiThemeBackgrounds">
          <button type="button" className="cqaiThemeBackgroundChoice" aria-pressed={current.background === 'galaxy'} onClick={() => { save({ background: 'galaxy' }) }}>
            <span className="cqaiThemeBackgroundPreview">
              <PresetArtwork preset={current.preset} />
            </span>
            <span>{t(current.preset === 'classic' ? 'galaxy' : 'presetBackground')}</span>
          </button>
          <button type="button" className="cqaiThemeBackgroundChoice" aria-pressed={current.background === 'plain'} onClick={() => { save({ background: 'plain' }) }}>
            <span className="cqaiThemeBackgroundPreview cqaiThemeBackgroundPlain" aria-hidden="true" />
            <span>{t('plain')}</span>
          </button>
          <button type="button" className="cqaiThemeBackgroundChoice" aria-pressed={current.background === 'custom'} onClick={() => {
            if (current.customImage === null) fileInput.current?.click()
            else save({ background: 'custom' })
          }}>
            <span className="cqaiThemeBackgroundPreview cqaiThemeBackgroundCustom">
              {current.customImage === null ? <span aria-hidden="true">＋</span> : <img src={current.customImage} alt="" />}
            </span>
            <span>{t('custom')}</span>
          </button>
        </div>
        <input ref={fileInput} className="cqaiThemeFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={event => { void upload(event) }} />
        <div className="cqaiThemeUploadRow">
          <button type="button" disabled={uploading} onClick={() => { fileInput.current?.click() }}>
            {uploading ? t('uploading') : current.customImage === null ? t('upload') : t('replace')}
          </button>
          <span>{t('uploadHint')}</span>
        </div>
      </fieldset>

      <fieldset className="cqaiThemeSettingsGroup">
        <legend>{t('accent')}</legend>
        <p>{t('accentHint')}</p>
        <div className="cqaiThemeAccentRow">
          <input type="color" aria-label={t('chooseColor')} value={current.accent ?? presetAccent} onChange={event => { commitColor(event.currentTarget.value) }} />
          <input className="cqaiThemeHexInput" type="text" aria-label={t('hexColor')} inputMode="text" maxLength={7} spellCheck={false} value={colorDraft} onChange={event => {
            const value = event.currentTarget.value
            setColorDraft(value)
            if (normalizeAccent(value) !== null) commitColor(value)
          }} onBlur={() => { if (normalizeAccent(colorDraft) === null) commitColor(colorDraft) }} />
          <span className="cqaiThemeColorState">{current.accent === null ? t(current.preset === 'classic' ? 'defaultColor' : 'presetColor') : t('customColor')}</span>
        </div>
        <div className="cqaiThemeAccentPresets" role="group" aria-label={t('accent')}>
          {ACCENTS.map(preset => <button key={preset.value} type="button" aria-label={t(preset.label)} aria-pressed={current.accent === preset.value || (current.accent === null && preset.value === presetAccent)} title={t(preset.label)} onClick={() => { commitColor(preset.value) }} style={{ backgroundColor: preset.value }} />)}
        </div>
      </fieldset>
      {error !== null && <p className="cqaiThemeSettingsError" role="alert">{error}</p>}
    </section>
  )
}
