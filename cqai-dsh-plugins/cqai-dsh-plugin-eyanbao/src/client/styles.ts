export const workspaceStyles = String.raw`
.ey-shell {
  --ey-bg: var(--dsw-alias-bg-layer-1, #f4f7f8);
  --ey-panel: var(--dsw-alias-bg-layer-2, #ffffff);
  --ey-panel-strong: var(--dsw-alias-bg-layer-3, #ffffff);
  --ey-text: var(--dsw-alias-label-primary, #14212b);
  --ey-muted: var(--dsw-alias-label-secondary, #52616d);
  --ey-border: var(--dsw-alias-border-l1, #d5dee3);
  --ey-border-strong: var(--dsw-alias-border-l2, #b8c6ce);
  --ey-hover: var(--dsw-alias-interactive-bg-hover, #edf2f4);
  --ey-selected: var(--dsw-alias-interactive-bg-active, #e4ebee);
  --ey-ink: #17324d;
  --ey-ink-soft: #dce7ef;
  --ey-accent: #985d0a;
  --ey-accent-soft: #f6ead6;
  --ey-focus: #1f5f8b;
  --ey-green: #276b53;
  --ey-green-soft: #e2f0e8;
  --ey-danger: var(--dsw-alias-state-error-primary, #b42318);
  --ey-danger-soft: #fce8e6;
  --ey-paper: #fffefb;
  --ey-shadow: 0 10px 28px rgba(25, 44, 56, .08);
  color-scheme: light dark;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ey-text);
  background: var(--ey-bg);
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
.ey-shell *, .ey-shell *::before, .ey-shell *::after { box-sizing: border-box; }
.ey-shell button, .ey-shell input, .ey-shell select, .ey-shell textarea { font: inherit; }
.ey-shell button, .ey-shell select, .ey-shell a { -webkit-tap-highlight-color: transparent; }
.ey-shell button { cursor: pointer; touch-action: manipulation; }
.ey-shell :focus-visible { outline: 3px solid var(--ey-focus); outline-offset: 2px; }
.ey-skip {
  position: absolute; left: 12px; top: -60px; z-index: 30; min-height: 44px; padding: 10px 16px;
  color: var(--ey-panel); background: var(--ey-text); border-radius: 8px;
}
.ey-skip:focus { top: 12px; }
.ey-header {
  min-height: 64px; flex: none; display: flex; align-items: center; gap: 16px; padding: 10px 18px;
  border-bottom: 1px solid var(--ey-border); background: color-mix(in srgb, var(--ey-panel) 94%, transparent);
}
.ey-brand { display: flex; align-items: center; gap: 10px; min-width: 168px; }
.ey-brand-mark {
  width: 38px; height: 38px; flex: none; display: grid; place-items: center;
  color: var(--ey-ink); background: var(--ey-accent-soft); border: 1px solid color-mix(in srgb, var(--ey-accent) 55%, transparent);
  border-radius: 8px;
}
.ey-brand h1 { margin: 0; font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", serif; font-size: 22px; line-height: 1.15; letter-spacing: 0; }
.ey-brand small { display: block; margin-top: 2px; color: var(--ey-muted); font-size: 11px; line-height: 1.25; }
.ey-header-spacer { flex: 1; }
.ey-health {
  min-height: 32px; display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px;
  border: 1px solid var(--ey-border); border-radius: 999px; color: var(--ey-muted); font-size: 12px; white-space: nowrap;
}
.ey-health[data-ready="true"] { color: var(--ey-green); background: var(--ey-green-soft); border-color: color-mix(in srgb, var(--ey-green) 25%, transparent); }
.ey-health[data-ready="false"] { color: var(--ey-danger); background: var(--ey-danger-soft); border-color: color-mix(in srgb, var(--ey-danger) 24%, transparent); }
.ey-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.ey-icon-button, .ey-button {
  min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 14px;
  border: 1px solid var(--ey-border-strong); border-radius: 8px; background: var(--ey-panel); color: var(--ey-text);
  font-weight: 600; text-decoration: none; transition: background .18s ease, border-color .18s ease, color .18s ease;
}
.ey-icon-button { width: 44px; padding: 0; }
.ey-button:hover, .ey-icon-button:hover { background: var(--ey-hover); border-color: var(--ey-border-strong); }
.ey-button:active, .ey-icon-button:active { background: var(--ey-selected); }
.ey-button[disabled], .ey-icon-button[disabled] { opacity: .48; cursor: not-allowed; }
.ey-button[aria-disabled="true"] { opacity: .48; pointer-events: none; }
.ey-button-primary { color: #fff; background: var(--ey-ink); border-color: var(--ey-ink); }
.ey-button-primary:hover { background: #21496e; border-color: #21496e; }
.ey-button-accent { color: #fff; background: var(--ey-accent); border-color: var(--ey-accent); }
.ey-button-accent:hover { background: #7f4d08; border-color: #7f4d08; }
.ey-button-quiet { border-color: transparent; background: transparent; }
.ey-button-quiet:hover { border-color: var(--ey-border); }
.ey-button-danger { color: var(--ey-danger); border-color: color-mix(in srgb, var(--ey-danger) 35%, var(--ey-border)); }
.ey-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
.ey-rail {
  min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 16px 12px;
  border-right: 1px solid var(--ey-border); background: color-mix(in srgb, var(--ey-panel) 64%, var(--ey-bg));
}
.ey-rail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.ey-rail-head h2 { margin: 0; font-size: 13px; text-transform: uppercase; color: var(--ey-muted); letter-spacing: 0; }
.ey-rail-search { position: relative; margin-bottom: 10px; }
.ey-rail-search svg { position: absolute; left: 11px; top: 14px; color: var(--ey-muted); pointer-events: none; }
.ey-rail-search input { width: 100%; height: 44px; padding: 9px 10px 9px 36px; border: 1px solid var(--ey-border); border-radius: 8px; color: var(--ey-text); background: var(--ey-panel); }
.ey-project-list { min-height: 0; overflow: auto; display: grid; align-content: start; gap: 4px; padding-right: 2px; }
.ey-project {
  width: 100%; min-height: 58px; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 8px; align-items: center;
  padding: 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--ey-text); text-align: left;
}
.ey-project:hover { background: var(--ey-hover); }
.ey-project[aria-current="true"] { background: var(--ey-selected); border-color: var(--ey-border); }
.ey-project-icon { width: 28px; height: 28px; display: grid; place-items: center; color: var(--ey-ink); background: var(--ey-ink-soft); border-radius: 6px; }
.ey-project-main { min-width: 0; }
.ey-project-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.ey-project-meta { display: block; margin-top: 3px; color: var(--ey-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ey-rail-empty { padding: 24px 12px; color: var(--ey-muted); font-size: 13px; line-height: 1.6; }
.ey-main { min-width: 0; min-height: 0; overflow: auto; }
.ey-main-inner { width: min(1440px, 100%); min-height: 100%; margin: 0 auto; padding: 28px clamp(18px, 3vw, 42px) 56px; }
.ey-compose-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.ey-compose-head h2 { margin: 0; max-width: 760px; font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", serif; font-size: clamp(25px, 3vw, 34px); line-height: 1.25; font-weight: 600; letter-spacing: 0; }
.ey-compose-head p { margin: 8px 0 0; max-width: 680px; color: var(--ey-muted); font-size: 14px; line-height: 1.6; }
.ey-composer {
  position: relative; border: 1px solid var(--ey-border-strong); border-radius: 8px; background: var(--ey-panel); box-shadow: var(--ey-shadow);
  overflow: hidden;
}
.ey-composer-nav { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-bottom: 1px solid var(--ey-border); }
.ey-task-tabs { display: flex; flex: 1; gap: 4px; overflow-x: auto; padding: 2px 2px 2px 0; scrollbar-width: thin; }
.ey-ai-trigger { flex: none; color: var(--ey-accent); background: var(--ey-accent-soft); border-color: color-mix(in srgb, var(--ey-accent) 30%, var(--ey-border)); }
.ey-ai-trigger[aria-expanded="true"] { color: var(--ey-on-accent, #fff); background: var(--ey-accent); border-color: var(--ey-accent); }
.ey-task { min-width: max-content; min-height: 44px; display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border: 1px solid transparent; border-radius: 7px; color: var(--ey-muted); background: transparent; font-size: 13px; font-weight: 600; }
.ey-task:hover { color: var(--ey-text); background: var(--ey-hover); }
.ey-task[aria-pressed="true"] { color: var(--ey-ink); background: var(--ey-selected); border-color: var(--ey-border); }
.ey-prompt-wrap { padding: 16px 16px 12px; }
.ey-label { display: block; margin-bottom: 7px; color: var(--ey-text); font-size: 13px; font-weight: 650; }
.ey-prompt {
  width: 100%; min-height: 114px; resize: vertical; padding: 14px; border: 1px solid var(--ey-border); border-radius: 8px;
  color: var(--ey-text); background: color-mix(in srgb, var(--ey-bg) 58%, var(--ey-panel)); line-height: 1.65; font-size: 16px;
}
.ey-prompt::placeholder { color: color-mix(in srgb, var(--ey-muted) 82%, transparent); }
.ey-ai-panel {
  position: absolute; z-index: 20; left: 12px; top: 64px; width: min(440px, calc(100% - 24px));
  max-height: min(580px, calc(100dvh - 220px)); overflow: auto; display: grid; gap: 12px; padding: 14px;
  border: 1px solid var(--ey-border-strong); border-radius: 8px; background: var(--ey-panel);
  box-shadow: 0 18px 42px rgba(20, 34, 43, .18);
}
.ey-ai-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ey-ai-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ey-ai-mark { width: 34px; height: 34px; flex: none; display: grid; place-items: center; color: var(--ey-accent); background: var(--ey-accent-soft); border-radius: 7px; }
.ey-ai-title h3 { margin: 0; font-size: 15px; line-height: 1.35; }
.ey-ai-title p { margin: 3px 0 0; color: var(--ey-muted); font-size: 11px; line-height: 1.45; }
.ey-ai-header .ey-icon-button { min-width: 44px; }
.ey-ai-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.ey-ai-action { min-height: 42px; display: inline-flex; align-items: center; justify-content: flex-start; gap: 7px; padding: 8px 10px; border: 1px solid var(--ey-border); border-radius: 7px; color: var(--ey-muted); background: var(--ey-panel); font-size: 12px; font-weight: 650; }
.ey-ai-action:hover { color: var(--ey-text); background: var(--ey-hover); }
.ey-ai-action[aria-pressed="true"] { color: var(--ey-accent); background: var(--ey-accent-soft); border-color: color-mix(in srgb, var(--ey-accent) 28%, var(--ey-border)); }
.ey-ai-context { padding: 9px 10px; border: 1px solid var(--ey-border); border-radius: 7px; color: var(--ey-muted); background: var(--ey-bg); font-size: 12px; line-height: 1.5; max-height: 74px; overflow: auto; overflow-wrap: anywhere; }
.ey-ai-status { min-height: 28px; display: flex; align-items: center; gap: 7px; color: var(--ey-muted); font-size: 12px; }
.ey-ai-result { min-height: 112px; max-height: 240px; overflow: auto; padding: 10px 12px; border: 1px solid var(--ey-border); border-radius: 7px; background: var(--ey-bg); color: var(--ey-text); font-size: 13px; line-height: 1.65; }
.ey-ai-result.is-empty { display: grid; place-items: center; color: var(--ey-muted); text-align: center; }
.ey-ai-result h1, .ey-ai-result h2, .ey-ai-result h3, .ey-ai-result h4 { margin: 14px 0 6px; color: var(--ey-text); line-height: 1.4; letter-spacing: 0; }
.ey-ai-result h1 { font-size: 18px; }
.ey-ai-result h2 { font-size: 16px; }
.ey-ai-result h3, .ey-ai-result h4 { font-size: 14px; }
.ey-ai-result p { margin: 0 0 8px; }
.ey-ai-result blockquote { margin: 8px 0; padding: 7px 10px; border-left: 2px solid var(--ey-accent); color: var(--ey-muted); }
.ey-ai-result ul, .ey-ai-result ol { margin: 6px 0; padding-left: 20px; }
.ey-ai-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.ey-compose-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 0 16px 14px; }
.ey-suggestions { display: flex; flex: 1; flex-wrap: wrap; gap: 6px; min-width: 220px; }
.ey-chip { min-height: 34px; padding: 5px 9px; border: 1px solid var(--ey-border); border-radius: 999px; color: var(--ey-muted); background: transparent; font-size: 12px; }
.ey-chip:hover { color: var(--ey-text); background: var(--ey-hover); }
.ey-controls { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; padding: 14px 16px; border-top: 1px solid var(--ey-border); background: color-mix(in srgb, var(--ey-bg) 45%, var(--ey-panel)); }
.ey-field { min-width: 0; }
.ey-field > label, .ey-field-label { display: block; margin-bottom: 6px; color: var(--ey-muted); font-size: 12px; font-weight: 600; }
.ey-input, .ey-select {
  width: 100%; height: 42px; padding: 8px 10px; border: 1px solid var(--ey-border); border-radius: 7px; color: var(--ey-text); background: var(--ey-panel);
}
.ey-segment { display: flex; min-height: 42px; padding: 3px; border: 1px solid var(--ey-border); border-radius: 7px; background: var(--ey-panel); }
.ey-segment button { min-height: 34px; flex: 1; border: 0; border-radius: 5px; color: var(--ey-muted); background: transparent; font-size: 12px; font-weight: 650; }
.ey-segment button[aria-pressed="true"] { color: var(--ey-text); background: var(--ey-selected); }
.ey-submit-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-top: 1px solid var(--ey-border); }
.ey-submit-note { color: var(--ey-muted); font-size: 12px; line-height: 1.5; }
.ey-error, .ey-warning {
  display: flex; align-items: flex-start; gap: 8px; padding: 11px 12px; border-radius: 8px; font-size: 13px; line-height: 1.55;
}
.ey-error { color: var(--ey-danger); background: var(--ey-danger-soft); border: 1px solid color-mix(in srgb, var(--ey-danger) 24%, transparent); }
.ey-warning { color: #6c4a06; background: var(--ey-accent-soft); border: 1px solid color-mix(in srgb, var(--ey-accent) 25%, transparent); }
.ey-compose-error { margin-top: 10px; }
.ey-database-picker { margin-top: 14px; padding: 0 16px 14px; border-top: 1px solid var(--ey-border); }
.ey-database-picker summary { min-height: 44px; display: flex; align-items: center; gap: 7px; color: var(--ey-muted); font-size: 13px; font-weight: 600; cursor: pointer; }
.ey-database-picker summary strong { margin-left: auto; color: var(--ey-text); font-size: 12px; }
.ey-database-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ey-database-option { min-height: 54px; display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--ey-border); border-radius: 7px; background: var(--ey-panel); cursor: pointer; }
.ey-database-option:has(input:checked) { border-color: color-mix(in srgb, var(--ey-focus) 45%, var(--ey-border)); background: var(--ey-selected); }
.ey-database-option[data-available="false"] { opacity: .58; cursor: not-allowed; background: var(--ey-bg); }
.ey-database-option input { width: 18px; height: 18px; margin: 0; accent-color: var(--ey-focus); }
.ey-database-option span { min-width: 0; }
.ey-database-option strong { display: block; color: var(--ey-text); font-size: 12px; line-height: 1.4; }
.ey-database-option small { display: block; margin-top: 2px; color: var(--ey-muted); font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
.ey-database-picker > p { margin: 9px 0 0; color: var(--ey-muted); font-size: 11px; line-height: 1.5; }
.ey-advanced { margin-top: 14px; border-top: 1px solid var(--ey-border); padding-top: 14px; }
.ey-compose-advanced { padding-left: 16px; padding-right: 16px; padding-bottom: 10px; }
.ey-advanced summary { min-height: 44px; display: flex; align-items: center; gap: 7px; color: var(--ey-muted); font-size: 13px; font-weight: 600; cursor: pointer; }
.ey-advanced-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 8px; }
.ey-recents { margin-top: 30px; }
.ey-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ey-section-head h3 { margin: 0; font-size: 15px; }
.ey-section-head span { color: var(--ey-muted); font-size: 12px; }
.ey-empty-state { min-height: 160px; display: grid; place-items: center; text-align: center; border: 1px dashed var(--ey-border-strong); border-radius: 8px; padding: 24px; color: var(--ey-muted); }
.ey-empty-state strong { display: block; margin-bottom: 6px; color: var(--ey-text); font-size: 14px; }
.ey-recent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 10px; }
.ey-recent {
  min-height: 118px; display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; gap: 14px; padding: 14px;
  border: 1px solid var(--ey-border); border-radius: 8px; background: var(--ey-panel); color: var(--ey-text); text-align: left;
}
.ey-recent:hover { border-color: var(--ey-border-strong); background: var(--ey-hover); }
.ey-recent h4 { margin: 0; font-size: 14px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ey-recent-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--ey-muted); font-size: 11px; }
.ey-status { display: inline-flex; align-items: center; gap: 5px; font-weight: 650; }
.ey-status[data-status="complete"] { color: var(--ey-green); }
.ey-status[data-status="running"] { color: var(--ey-accent); }
.ey-status[data-status="error"] { color: var(--ey-danger); }
.ey-workspace { display: flex; flex-direction: column; min-height: 100%; }
.ey-doc-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.ey-doc-heading { min-width: 0; flex: 1; }
.ey-doc-heading h2 { margin: 0; font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", serif; font-size: clamp(23px, 2.2vw, 30px); line-height: 1.32; font-weight: 600; overflow-wrap: anywhere; text-wrap: balance; }
.ey-doc-meta { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-top: 7px; color: var(--ey-muted); font-size: 12px; }
.ey-doc-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.ey-run-banner { display: flex; align-items: center; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border: 1px solid var(--ey-border); border-left: 3px solid var(--ey-accent); border-radius: 6px; background: var(--ey-panel); }
.ey-run-banner[data-busy="true"] .ey-spin { animation: ey-spin .9s linear infinite; }
.ey-run-copy { flex: 1; min-width: 0; }
.ey-run-copy strong { display: block; font-size: 13px; }
.ey-run-copy span { display: block; margin-top: 2px; color: var(--ey-muted); font-size: 12px; }
.ey-run-steps { display: flex; flex-wrap: wrap; gap: 5px; }
.ey-run-step { min-height: 26px; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--ey-border); border-radius: 999px; color: var(--ey-muted); font-size: 11px; }
.ey-run-step[data-state="active"] { color: var(--ey-accent); background: var(--ey-accent-soft); border-color: color-mix(in srgb, var(--ey-accent) 25%, transparent); }
.ey-run-step[data-state="done"] { color: var(--ey-green); background: var(--ey-green-soft); border-color: color-mix(in srgb, var(--ey-green) 22%, transparent); }
.ey-work-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(230px, 292px) minmax(0, 1fr); gap: 16px; align-items: start; }
.ey-side-panel { position: sticky; top: 12px; border: 1px solid var(--ey-border); border-radius: 8px; background: var(--ey-panel); overflow: hidden; }
.ey-side-tabs { display: flex; border-bottom: 1px solid var(--ey-border); }
.ey-side-tabs button { min-height: 44px; flex: 1; border: 0; border-bottom: 2px solid transparent; color: var(--ey-muted); background: transparent; font-size: 12px; font-weight: 650; }
.ey-side-tabs button[aria-pressed="true"] { color: var(--ey-text); border-bottom-color: var(--ey-accent); }
.ey-side-body { max-height: calc(100dvh - 230px); overflow: auto; padding: 12px; }
.ey-source { display: grid; gap: 7px; padding: 12px 0; border-bottom: 1px solid var(--ey-border); }
.ey-source:first-child { padding-top: 0; }
.ey-source:last-child { border-bottom: 0; padding-bottom: 0; }
.ey-source-title { margin: 0; font-size: 13px; line-height: 1.5; font-weight: 650; }
.ey-source-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--ey-muted); font-size: 11px; line-height: 1.5; }
.ey-source-language { display: inline-flex; align-items: center; min-height: 20px; padding: 1px 7px; border: 1px solid var(--ey-border); border-radius: 999px; color: var(--ey-muted); background: var(--ey-panel); font-size: 10px; font-weight: 650; }
.ey-source-language[data-foreign="true"] { color: var(--ey-accent); background: var(--ey-accent-soft); border-color: color-mix(in srgb, var(--ey-accent) 25%, transparent); }
.ey-source-language[data-top="true"] { color: var(--ey-green); background: var(--ey-green-soft); border-color: color-mix(in srgb, var(--ey-green) 24%, transparent); }
.ey-source-abstract { margin: 0; color: var(--ey-muted); font-size: 12px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.ey-source-link { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; color: var(--ey-focus); font-size: 12px; text-decoration: none; }
.ey-source-link:hover { text-decoration: underline; }
.ey-outline { display: grid; gap: 4px; }
.ey-outline a { min-height: 36px; display: block; padding: 7px 8px; border-radius: 6px; color: var(--ey-muted); font-size: 12px; line-height: 1.5; text-decoration: none; }
.ey-outline a:hover { color: var(--ey-text); background: var(--ey-hover); }
.ey-outline a[data-level="2"] { padding-left: 16px; }
.ey-outline a[data-level="3"] { padding-left: 26px; }
.ey-paper { min-width: 0; border: 1px solid var(--ey-border); border-radius: 8px; background: var(--ey-panel); overflow: hidden; }
.ey-paper-toolbar { min-height: 52px; display: flex; align-items: center; gap: 8px; padding: 7px 10px 7px 14px; border-bottom: 1px solid var(--ey-border); background: color-mix(in srgb, var(--ey-bg) 42%, var(--ey-panel)); }
.ey-paper-toolbar strong { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ey-view-switch { display: flex; padding: 3px; border: 1px solid var(--ey-border); border-radius: 7px; background: var(--ey-panel); }
.ey-view-switch button { min-height: 34px; display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border: 0; border-radius: 5px; color: var(--ey-muted); background: transparent; font-size: 12px; font-weight: 650; }
.ey-view-switch button[aria-pressed="true"] { color: var(--ey-text); background: var(--ey-selected); }
.ey-paper-body { min-height: 640px; padding: clamp(24px, 5vw, 64px); background: var(--ey-bg); }
.ey-document {
  width: min(100%, 850px); min-height: 900px; margin: 0 auto; padding: clamp(28px, 6vw, 72px);
  color: #222; background: var(--ey-paper); border: 1px solid #e4e0d8; box-shadow: 0 14px 36px rgba(25, 31, 35, .10);
  font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", "Source Han Serif SC", serif;
  font-size: 16px; line-height: 1.85;
}
.ey-document h1 { margin: 0 0 24px; text-align: center; font-size: 30px; line-height: 1.35; font-weight: 700; color: #17242e; letter-spacing: 0; text-wrap: balance; }
.ey-document h2 { margin: 32px 0 12px; font-size: 22px; line-height: 1.45; font-weight: 700; color: #17242e; }
.ey-document h3 { margin: 24px 0 10px; font-size: 18px; line-height: 1.5; font-weight: 700; color: #17242e; }
.ey-document h4 { margin: 20px 0 8px; font-size: 16px; line-height: 1.5; color: #17242e; }
.ey-document p { margin: 0 0 1em; text-indent: 2em; text-align: justify; overflow-wrap: anywhere; }
.ey-document blockquote { margin: 12px 0 18px; padding: 10px 16px; border-left: 3px solid #a16207; color: #4b4b47; background: #fbf7ef; text-indent: 0; }
.ey-document blockquote p { text-indent: 0; }
.ey-document a { color: #1f5f8b; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.ey-document hr { margin: 26px 0; border: 0; border-top: 1px solid #ddd6c9; }
.ey-document pre { overflow: auto; padding: 12px; border-radius: 6px; background: #f2f2ef; font: 13px/1.6 Consolas, monospace; }
.ey-bullet, .ey-numbered { display: grid; grid-template-columns: 22px minmax(0, 1fr); margin: 2px 0 8px; }
.ey-numbered { grid-template-columns: 28px minmax(0, 1fr); }
.ey-doc-empty { min-height: 420px; display: grid; place-items: center; color: #7a746a; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; text-align: center; }
.ey-editor { width: min(100%, 850px); min-height: 900px; margin: 0 auto; padding: clamp(24px, 5vw, 56px); border: 1px solid var(--ey-border); border-radius: 6px; color: var(--ey-text); background: var(--ey-panel); font: 15px/1.8 "Cascadia Code", "Microsoft YaHei", monospace; resize: vertical; }
.ey-layout-panel { display: grid; gap: 16px; }
.ey-layout-section { display: grid; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--ey-border); }
.ey-layout-section:last-child { border-bottom: 0; padding-bottom: 0; }
.ey-layout-section h4 { margin: 0; font-size: 13px; }
.ey-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ey-metric { padding: 9px; border: 1px solid var(--ey-border); border-radius: 6px; background: var(--ey-bg); }
.ey-metric span { display: block; color: var(--ey-muted); font-size: 11px; }
.ey-metric strong { display: block; margin-top: 3px; font-size: 12px; font-weight: 650; }
.ey-toast {
  position: fixed; right: 24px; bottom: 24px; z-index: 40; max-width: min(360px, calc(100vw - 32px));
  padding: 11px 14px; color: #fff; background: #1b3a2f; border-radius: 8px; box-shadow: var(--ey-shadow); font-size: 13px;
}
.ey-mobile-rail-toggle { display: none; }
.ey-scrim { display: none; }
@media (max-width: 1180px) {
  .ey-task-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
  .ey-task { min-width: 0; justify-content: flex-start; }
  .ey-work-grid { grid-template-columns: minmax(0, 1fr); }
  .ey-paper { order: -1; }
  .ey-side-panel { position: static; }
  .ey-side-body { max-height: none; }
  .ey-controls { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 980px) {
  .ey-body { grid-template-columns: minmax(0, 1fr); }
  .ey-rail {
    position: fixed; z-index: 25; left: 0; top: 64px; bottom: 0; width: min(320px, 88vw);
    background: var(--ey-panel); box-shadow: 18px 0 36px rgba(18, 29, 36, .18); transform: translateX(-105%);
    transition: transform .24s ease;
  }
  .ey-shell[data-rail-open="true"] .ey-rail { transform: translateX(0); }
  .ey-scrim[data-open="true"] { display: block; position: fixed; z-index: 24; inset: 64px 0 0; border: 0; background: rgba(9, 18, 24, .36); }
  .ey-mobile-rail-toggle { display: inline-flex; }
  .ey-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .ey-header { min-height: 58px; padding: 8px 12px; gap: 8px; }
  .ey-brand { min-width: 0; }
  .ey-brand small, .ey-health { display: none; }
  .ey-main-inner { padding: 20px 12px 40px; }
  .ey-compose-head { align-items: flex-start; flex-direction: column; gap: 8px; }
  .ey-compose-head h2 { font-size: 26px; }
  .ey-task-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: visible; padding: 0; }
  .ey-task { min-width: 0; justify-content: flex-start; }
  .ey-composer-nav { padding: 6px; }
  .ey-ai-panel { left: 8px; right: 8px; top: 58px; width: auto; max-height: calc(100dvh - 140px); }
  .ey-prompt-wrap { padding: 12px 12px 10px; }
  .ey-prompt { font-size: 16px; }
  .ey-compose-footer, .ey-submit-row { padding-left: 12px; padding-right: 12px; }
  .ey-controls { grid-template-columns: minmax(0, 1fr); padding: 12px; }
  .ey-advanced-grid { grid-template-columns: minmax(0, 1fr); }
  .ey-database-options { grid-template-columns: minmax(0, 1fr); }
  .ey-doc-topbar { flex-direction: column; }
  .ey-doc-actions { width: 100%; justify-content: flex-start; }
  .ey-run-banner { align-items: flex-start; flex-wrap: wrap; }
  .ey-run-steps { order: 3; width: 100%; }
  .ey-paper-body { padding: 10px; }
  .ey-document, .ey-editor { min-height: 720px; padding: 28px 22px; font-size: 15px; }
  .ey-document h1 { font-size: 25px; }
  .ey-document h2 { font-size: 20px; }
  .ey-rail { top: 58px; }
  .ey-scrim[data-open="true"] { inset: 58px 0 0; }
  .ey-toast { right: 16px; bottom: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .ey-shell *, .ey-shell *::before, .ey-shell *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
@keyframes ey-spin { to { transform: rotate(360deg); } }
`
