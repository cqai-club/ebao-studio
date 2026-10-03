import chinaRedLight from '../../assets/china-red-light.webp'
import chinaRedDark from '../../assets/china-red-dark.webp'
import techBlueLight from '../../assets/tech-blue-light.webp'
import techBlueDark from '../../assets/tech-blue-dark.webp'
import warmCartoonLight from '../../assets/warm-cartoon-light.webp'
import warmCartoonDark from '../../assets/warm-cartoon-dark.webp'
import type { ClubThemePreferences, ClubThemePreferenceStore } from './preferences.ts'
import type { ThemePreset } from './presets.ts'

/** Bundled light/dark wallpaper pairs; no runtime image downloads or storage writes. */
export const PRESET_WALLPAPERS: Record<Exclude<ThemePreset, 'classic'>, { light: string; dark: string }> = {
  'china-red': { light: chinaRedLight, dark: chinaRedDark },
  'tech-blue': { light: techBlueLight, dark: techBlueDark },
  'warm-cartoon': { light: warmCartoonLight, dark: warmCartoonDark },
}

/** Resolution-independent mist for the default look and its settings preview. */
export const CLASSIC_LIGHT_BACKGROUND = [
  'radial-gradient(ellipse 60% 38% at 53% 3%, rgb(168 206 255 / 39%), transparent 80%)',
  'radial-gradient(ellipse 44% 42% at 10% 43%, rgb(213 230 253 / 43%), transparent 82%)',
  'radial-gradient(ellipse 47% 41% at 96% 43%, rgb(194 221 252 / 38%), transparent 82%)',
  'radial-gradient(ellipse 63% 47% at 56% 100%, rgb(200 226 252 / 37%), transparent 84%)',
  'linear-gradient(125deg, #FCFDFF 0%, #F2F7FF 48%, #FAFCFF 100%)',
].join(', ')

export const CLASSIC_DARK_BACKGROUND = [
  'radial-gradient(ellipse 62% 44% at 55% 2%, rgb(80 115 168 / 22%), transparent 82%)',
  'radial-gradient(ellipse 52% 48% at 4% 74%, rgb(55 77 113 / 22%), transparent 84%)',
  'radial-gradient(ellipse 52% 43% at 100% 69%, rgb(62 91 132 / 19%), transparent 82%)',
  'linear-gradient(135deg, #19202B 0%, #171C26 55%, #1B2431 100%)',
].join(', ')

// Paint the shared frame once so the artwork stays continuous across the sidebar
// and conversation. The PPT panel mounts alongside the home dock; exclude it.
const HOME_FRAME = 'body:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"]) .dshDesktopFrame:has(.dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"] .eBaoHomeDock):not(:has(.dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"] [data-office-ppt-template-panel]))'
const DARK_HOME_FRAME = 'body[data-ds-dark-theme]:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"]) .dshDesktopFrame:has(.dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"] .eBaoHomeDock):not(:has(.dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"] [data-office-ppt-template-panel]))'

// The default mist fills the shared frame; translucency and blur live on the
// surfaces above it. Scope this to the built-in background, not custom images.
const CLASSIC_FROST_CSS = `
${HOME_FRAME} { background-color: #F7FAFF; background-image: ${CLASSIC_LIGHT_BACKGROUND}; }
${DARK_HOME_FRAME} { background-color: #171D28; background-image: ${CLASSIC_DARK_BACKGROUND}; }
${HOME_FRAME} .dshDesktopSidebarSurface {
  background: rgb(255 255 255 / 75%) !important;
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  box-shadow: inset -1px 0 rgb(103 139 189 / 11%);
}
${DARK_HOME_FRAME} .dshDesktopSidebarSurface {
  background: rgb(29 35 47 / 76%) !important;
  box-shadow: inset -1px 0 rgb(255 255 255 / 8%);
}
${HOME_FRAME} .eBaoHomeSectionHeader {
  min-height: 128px;
  padding: 26px 32px;
  border: 1px solid rgb(120 156 204 / 18%);
  border-radius: 24px;
  background:
    radial-gradient(ellipse 61% 94% at 58% 122%, rgb(143 190 255 / 31%), transparent 75%),
    radial-gradient(ellipse 43% 84% at 91% 115%, rgb(198 180 255 / 29%), transparent 77%),
    linear-gradient(112deg, rgb(255 255 255 / 91%), rgb(248 251 255 / 77%) 55%, rgb(239 247 255 / 75%));
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 48px rgb(80 120 180 / 9%), inset 0 1px rgb(255 255 255 / 85%);
}
${DARK_HOME_FRAME} .eBaoHomeSectionHeader {
  border-color: rgb(255 255 255 / 13%);
  background:
    radial-gradient(ellipse 61% 94% at 58% 122%, rgb(84 128 214 / 29%), transparent 75%),
    radial-gradient(ellipse 43% 84% at 91% 115%, rgb(127 102 194 / 23%), transparent 77%),
    linear-gradient(112deg, rgb(40 48 64 / 89%), rgb(30 37 49 / 81%) 55%, rgb(25 33 46 / 82%));
  box-shadow: 0 18px 48px rgb(0 0 0 / 26%), inset 0 1px rgb(255 255 255 / 10%);
}
${HOME_FRAME} .eBaoHomeSectionHeader::before {
  display: block;
  top: -158px;
  right: 18%;
  width: 390px;
  height: 390px;
  border-color: rgb(92 140 208 / 13%);
  box-shadow: 0 0 0 42px rgb(92 140 208 / 3%), 0 0 0 92px rgb(92 140 208 / 2%);
}
${DARK_HOME_FRAME} .eBaoHomeSectionHeader::before {
  border-color: rgb(255 255 255 / 12%);
  box-shadow: 0 0 0 42px rgb(255 255 255 / 3%), 0 0 0 92px rgb(255 255 255 / 2%);
}
${HOME_FRAME} .eBaoHomeSectionHeader::after {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0 0 0 55%;
  pointer-events: none;
  background-image: radial-gradient(rgb(82 130 195 / 12%) .7px, transparent 1px);
  background-size: 16px 16px;
  opacity: .42;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 36%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 36%, transparent);
}
${DARK_HOME_FRAME} .eBaoHomeSectionHeader::after {
  background-image: radial-gradient(rgb(255 255 255 / 15%) .7px, transparent 1px);
}
${HOME_FRAME} .eBaoHomeEyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .12em;
}
${HOME_FRAME} .eBaoHomeEyebrow::before {
  content: "";
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-brand-primary);
}
${HOME_FRAME} .eBaoHomeSectionTitle { gap: 12px; }
${HOME_FRAME} .eBaoHomeSectionTitle h2 {
  font-size: clamp(24px, 1.7vw, 30px);
  font-weight: 700;
  letter-spacing: -.025em;
}
${HOME_FRAME} .eBaoHomeReadyCount {
  padding: 5px 11px;
  border-color: rgb(25 25 25 / 13%);
  background: rgb(255 255 255 / 58%);
  font-weight: 650;
  box-shadow: inset 0 1px rgb(255 255 255 / 70%);
}
${DARK_HOME_FRAME} .eBaoHomeReadyCount {
  border-color: rgb(255 255 255 / 17%);
  background: rgb(255 255 255 / 7%);
  box-shadow: inset 0 1px rgb(255 255 255 / 8%);
}
${HOME_FRAME} .eBaoHomeSectionIntro p {
  margin-top: 9px;
  font-size: 14px;
  line-height: 1.5;
}
${HOME_FRAME} .eBaoHomeSectionActions { gap: 10px; }
${HOME_FRAME} .eBaoHomeSectionActions button {
  min-height: 44px;
  padding: 10px 17px;
  border-radius: 12px;
  font-size: 13px;
  box-shadow: 0 3px 10px rgb(0 0 0 / 5%);
}
${HOME_FRAME} .eBaoHomeSectionActions .eBaoHomeAdd {
  box-shadow: 0 8px 20px rgb(0 0 0 / 16%);
}
${DARK_HOME_FRAME} .eBaoHomeSectionActions .eBaoHomeAdd {
  box-shadow: 0 8px 20px rgb(0 0 0 / 28%);
}
@container (max-width: 700px) {
  ${HOME_FRAME} .eBaoHomeSectionHeader::before,
  ${HOME_FRAME} .eBaoHomeSectionHeader::after { display: none; }
}
@container (max-width: 540px) {
  ${HOME_FRAME} .eBaoHomeSectionHeader { padding: 20px; }
}
@media (forced-colors: active) {
  ${HOME_FRAME}, ${DARK_HOME_FRAME} { background-color: Canvas; background-image: none; }
  ${HOME_FRAME} .dshDesktopSidebarSurface,
  ${HOME_FRAME} .eBaoHomeSectionHeader {
    background: Canvas !important;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
  ${HOME_FRAME} .eBaoHomeSectionHeader::before,
  ${HOME_FRAME} .eBaoHomeSectionHeader::after,
  ${HOME_FRAME} .eBaoHomeEyebrow::before { display: none; }
}
`

const CSS = `
${HOME_FRAME} {
  background-color: var(--dsw-alias-bg-base);
  background-image: var(--cqai-club-home-light-background);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
${DARK_HOME_FRAME} {
  background-image: var(--cqai-club-home-dark-background);
}
${HOME_FRAME} .dshDesktopSidebarSurface {
  --dsw-specific-sidebar-fill: transparent;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 78%, transparent) !important;
}
${DARK_HOME_FRAME} .dshDesktopSidebarSurface {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 72%, transparent) !important;
}
${HOME_FRAME} .dshDesktopConversationSurface,
${HOME_FRAME} .dshDesktopMainPanelSurface [data-phase="hero"]:has([data-conversation-content][data-content-phase="hero"] .eBaoHomeDock),
${HOME_FRAME} .dshDesktopMainPanelSurface [data-conversation-content][data-content-phase="hero"],
${HOME_FRAME} .dshDesktopWindowsCaptionRow,
${HOME_FRAME} .dshDesktopMacCaptionRow {
  background: transparent !important;
}
@media (forced-colors: active) {
  ${HOME_FRAME}, ${DARK_HOME_FRAME} { background-image: none; }
  ${HOME_FRAME} .dshDesktopSidebarSurface { background: Canvas !important; }
}
`

function wallpaperImages(preferences: ClubThemePreferences): { light: string; dark: string; custom: string } {
  if (preferences.background === 'plain') return { light: 'none', dark: 'none', custom: 'none' }
  if (preferences.background === 'custom' && preferences.customImage !== null) {
    return {
      light: 'linear-gradient(rgb(255 255 255 / 64%), rgb(255 255 255 / 64%)), var(--cqai-club-home-custom-image)',
      dark: 'linear-gradient(rgb(20 20 20 / 64%), rgb(20 20 20 / 64%)), var(--cqai-club-home-custom-image)',
      custom: `url("${preferences.customImage}")`,
    }
  }
  if (preferences.preset !== 'classic') {
    const images = PRESET_WALLPAPERS[preferences.preset]
    return {
      light: `linear-gradient(rgb(255 255 255 / 8%), rgb(255 255 255 / 8%)), url("${images.light}")`,
      dark: `linear-gradient(rgb(20 20 20 / 8%), rgb(20 20 20 / 8%)), url("${images.dark}")`,
      custom: 'none',
    }
  }
  return { light: 'none', dark: 'none', custom: 'none' }
}

export function installHomeWallpaper(preferences: ClubThemePreferenceStore): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = 'cqai-dsh-plugin-cqai-club-theme/home-wallpaper'
  let previousBackground: ClubThemePreferences['background'] | undefined
  let previousImage: string | null | undefined
  let previousPreset: ClubThemePreferences['preset'] | undefined
  const update = (): void => {
    const current = preferences.getSnapshot()
    if (current.background === previousBackground && current.customImage === previousImage && current.preset === previousPreset) return
    previousBackground = current.background
    previousImage = current.customImage
    previousPreset = current.preset
    const images = wallpaperImages(current)
    const classicFrost = current.preset === 'classic' && current.background === 'galaxy'
    style.textContent = `:root { --cqai-club-home-custom-image: ${images.custom}; --cqai-club-home-light-background: ${images.light}; --cqai-club-home-dark-background: ${images.dark}; }\n${CSS}${classicFrost ? CLASSIC_FROST_CSS : ''}`
  }
  update()
  document.head.appendChild(style)
  const unsubscribe = preferences.subscribe(update)
  return () => { unsubscribe(); style.remove() }
}
