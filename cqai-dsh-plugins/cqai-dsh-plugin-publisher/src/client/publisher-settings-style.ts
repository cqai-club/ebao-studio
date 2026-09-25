export const publisherSettingsCss = `
.pub-settings { max-width: 760px; }
.pub-settings h3 { margin: 0 0 5px; font-size: 17px; line-height: 1.4; }
.pub-settings > p { margin: 0 0 18px; color: var(--pub-secondary-text); font-size: 13px; }
.pub-settings-card { padding: 20px; border: 1px solid var(--pub-border); border-radius: 14px; background: var(--pub-surface); }
.pub-settings-label { display: block; margin-bottom: 9px; font-size: 13px; font-weight: 600; }
.pub-settings-path { display: flex; align-items: stretch; gap: 8px; }
.pub-settings-path input { flex: 1 1 auto; min-width: 0; min-height: 34px; padding: 6px 10px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-bg); color: var(--pub-text); font: inherit; }
.pub-settings-path button, .pub-settings-save, .pub-settings-retry { min-height: 34px; padding: 6px 13px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); color: var(--pub-text); font: inherit; font-size: 13px; cursor: pointer; }
.pub-settings-path button:hover, .pub-settings-retry:hover { background: var(--pub-soft); }
.pub-settings-save { border-color: var(--pub-text); background: var(--pub-text); color: var(--pub-bg); }
.pub-settings-save:hover { opacity: .86; }
.pub-settings button:disabled { opacity: .48; cursor: not-allowed; }
.pub-settings-hint { margin: 11px 0 0; color: var(--pub-secondary-text); font-size: 12px; line-height: 1.6; }
.pub-settings-actions { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
.pub-settings-error { margin: 13px 0 0; color: var(--dsw-alias-label-danger, #b42318); font-size: 13px; }
.pub-settings-status { margin: 13px 0 0; color: var(--pub-secondary-text); font-size: 13px; }
@container (max-width: 520px) {
  .pub-settings-card { padding: 16px; }
  .pub-settings-path { flex-wrap: wrap; }
  .pub-settings-path input { flex-basis: 100%; }
}
`
