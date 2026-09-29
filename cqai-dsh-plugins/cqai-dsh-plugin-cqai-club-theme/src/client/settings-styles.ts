const CSS = `
.cqaiThemeSettings {
  display: grid;
  gap: 20px;
  padding: 20px 0 24px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.cqaiThemeSettingsHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cqaiThemeSettingsHeader h3 { margin: 0; font-size: 16px; line-height: 1.5; font-weight: 650; }
.cqaiThemeSettingsHeader p, .cqaiThemeSettingsGroup p {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.cqaiThemeSettings button, .cqaiThemeSettings input { font: inherit; }
.cqaiThemeSettingsReset, .cqaiThemeUploadRow button {
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.cqaiThemeSettingsReset:hover, .cqaiThemeUploadRow button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.cqaiThemeSettingsGroup { min-width: 0; margin: 0; padding: 0; border: 0; }
.cqaiThemeSettingsGroup legend { padding: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.cqaiThemePresetGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 10px; margin-top: 12px; }
.cqaiThemePresetChoice {
  min-width: 0;
  padding: 8px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
}
.cqaiThemePresetChoice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.cqaiThemePresetChoice[aria-pressed="true"] { border-color: var(--dsw-alias-state-business-primary); }
.cqaiThemePresetChoice[data-preset="classic"] { --cqai-preview-accent: #242424; --cqai-preview-card: rgb(255 255 255 / 76%); --cqai-preview-sidebar: rgb(255 255 255 / 72%); }
.cqaiThemePresetChoice[data-preset="china-red"] { --cqai-preview-accent: #A51F34; --cqai-preview-card: rgb(255 253 252 / 92%); --cqai-preview-sidebar: rgb(255 244 239 / 68%); }
.cqaiThemePresetChoice[data-preset="tech-blue"] { --cqai-preview-accent: #175FC5; --cqai-preview-card: rgb(255 255 255 / 90%); --cqai-preview-sidebar: rgb(238 245 255 / 67%); }
.cqaiThemePresetChoice[data-preset="warm-cartoon"] { --cqai-preview-accent: #A84863; --cqai-preview-card: rgb(255 253 248 / 92%); --cqai-preview-sidebar: rgb(255 244 232 / 67%); }
body[data-ds-dark-theme] .cqaiThemePresetChoice { --cqai-preview-card: rgb(30 32 40 / 90%); --cqai-preview-sidebar: rgb(30 32 40 / 58%); }
body[data-ds-dark-theme] .cqaiThemePresetChoice[data-preset="classic"] { --cqai-preview-card: rgb(38 38 38 / 76%); --cqai-preview-sidebar: rgb(36 36 36 / 72%); }
.cqaiThemePresetPreview { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.cqaiThemePresetPreview > .cqaiThemeClassicArtwork, .cqaiThemeBackgroundPreview > .cqaiThemeClassicArtwork {
  position: absolute;
  inset: 0;
  display: block;
  background: #F4F4F4;
}
body[data-ds-dark-theme] .cqaiThemeSettings .cqaiThemeClassicArtwork { background: #171717; }
.cqaiThemePresetChoice[data-preset="classic"] .cqaiThemePresetMockSidebar,
.cqaiThemePresetChoice[data-preset="classic"] .cqaiThemePresetMockCard { -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.cqaiThemePresetMockSidebar { position: absolute; inset-block: 0; inset-inline-start: 0; width: 23%; background: var(--cqai-preview-sidebar); }
.cqaiThemePresetMockCard { position: absolute; top: 28%; left: 34%; width: 52%; height: 40%; border-radius: 6px; background: var(--cqai-preview-card); box-shadow: 0 3px 12px rgb(0 0 0 / 12%); }
.cqaiThemePresetMockCard::after { content: ""; position: absolute; left: 11%; bottom: 23%; width: 48%; height: 4px; border-radius: 4px; background: var(--cqai-preview-accent); }
.cqaiThemePresetName { display: block; margin: 8px 2px 0; font-size: 13px; font-weight: 650; line-height: 1.4; }
.cqaiThemePresetDescription { display: block; margin: 2px 2px 1px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.4; }
.cqaiThemeBackgrounds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.cqaiThemeBackgroundChoice {
  min-width: 0;
  padding: 8px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  font-size: 13px !important;
  line-height: 1.4;
  cursor: pointer;
}
.cqaiThemeBackgroundChoice[aria-pressed="true"] { border-color: var(--dsw-alias-state-business-primary); }
.cqaiThemeBackgroundChoice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.cqaiThemeBackgroundChoice > span:last-child { display: block; padding: 6px 2px 1px; }
.cqaiThemeBackgroundPreview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2);
}
.cqaiThemeBackgroundPreview > .cqaiThemeClassicArtwork::after {
  content: "";
  position: absolute;
  inset: 20% 17%;
  border: 1px solid rgb(255 255 255 / 88%);
  border-radius: 7px;
  background: rgb(255 255 255 / 74%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 9%);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
body[data-ds-dark-theme] .cqaiThemeBackgroundPreview > .cqaiThemeClassicArtwork::after {
  border-color: rgb(255 255 255 / 14%);
  background: rgb(38 38 38 / 76%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 22%);
}
.cqaiThemePresetPreview > img, .cqaiThemeBackgroundPreview > img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cqaiThemeSettings .cqaiThemeDefaultDark { display: none; }
body[data-ds-dark-theme] .cqaiThemeSettings .cqaiThemeDefaultLight { display: none; }
body[data-ds-dark-theme] .cqaiThemeSettings .cqaiThemeDefaultDark { display: block; }
.cqaiThemeBackgroundPlain { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); box-sizing: border-box; }
.cqaiThemeBackgroundCustom { background: var(--dsw-alias-bg-layer-2); }
.cqaiThemeBackgroundCustom > span { color: var(--dsw-alias-label-secondary); font-size: 25px; line-height: 1; }
.cqaiThemeFileInput { display: none; }
.cqaiThemeUploadRow { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.cqaiThemeUploadRow button:disabled { opacity: .6; cursor: progress; }
.cqaiThemeUploadRow > span { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.cqaiThemeAccentRow { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.cqaiThemeAccentRow input[type="color"] { width: 50px; height: 46px; padding: 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; }
.cqaiThemeHexInput { box-sizing: border-box; width: 116px; height: 46px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace !important; font-size: 13px !important; }
.cqaiThemeColorState { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.cqaiThemeAccentPresets { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.cqaiThemeAccentPresets button { width: 44px; height: 44px; border: 2px solid var(--dsw-alias-bg-layer-1); border-radius: 50%; box-shadow: 0 0 0 1px var(--dsw-alias-border-l2); cursor: pointer; }
.cqaiThemeAccentPresets button[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary); }
.cqaiThemeSettingsError { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 1.5; }
.cqaiThemeSettings button:focus-visible, .cqaiThemeSettings input:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
@media (max-width: 600px) {
  .cqaiThemeSettingsHeader { flex-direction: column; }
  .cqaiThemeBackgrounds { grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); }
}
@media (forced-colors: active) {
  .cqaiThemePresetChoice[aria-pressed="true"], .cqaiThemeBackgroundChoice[aria-pressed="true"], .cqaiThemeAccentPresets button[aria-pressed="true"] { outline: 2px solid Highlight; }
}
`

export function installSettingsStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = 'cqai-dsh-plugin-cqai-club-theme/settings'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
