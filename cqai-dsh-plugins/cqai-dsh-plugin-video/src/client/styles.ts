export const styles = `
.ejb {
  --ejb-bg: var(--dsw-alias-bg-base);
  --ejb-surface: var(--dsw-alias-bg-layer-1);
  --ejb-text: var(--dsw-alias-label-primary);
  --ejb-muted: var(--dsw-alias-label-secondary);
  --ejb-border: var(--dsw-alias-border-l2);
  --ejb-accent: var(--dsw-alias-brand-primary);
  --ejb-focus: var(--dsw-alias-state-business-primary);
  height: 100%; min-height: 0; overflow: auto;
  background: var(--ejb-bg); color: var(--ejb-text);
  font: inherit; font-size: 14px; line-height: 1.6;
  container: ejianbao / inline-size; scroll-padding-block: 24px;
}
.ejb, .ejb * { box-sizing: border-box; }
.ejb :is(button, input, textarea, select) { font: inherit; }
.ejb button { cursor: pointer; }
.ejb button:disabled { cursor: not-allowed; }
.ejb :is(button, input, textarea, select, a, summary):focus-visible {
  outline: 2px solid var(--ejb-focus); outline-offset: 3px;
}
.ejb-wrap { max-width: 1160px; padding: 28px 32px 48px; margin: auto; }
.ejb-head { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 24px; }
.ejb-head h1 { font-size: 24px; line-height: 1.3; margin: 0 0 8px; font-weight: 650; }
.ejb-muted { font-size: 13px; color: var(--ejb-muted); line-height: 1.7; overflow-wrap: anywhere; }
.ejb-tabs { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--ejb-border); padding-bottom: 16px; margin-bottom: 24px; }
.ejb-tab[aria-current=page] { background: var(--dsw-alias-interactive-bg-active); color: var(--ejb-text); font-weight: 600; }
.ejb-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 1fr); gap: 24px; align-items: start; }
.ejb-grid > * { min-width: 0; }
.ejb-card { border: 1px solid var(--ejb-border); background: var(--ejb-surface); border-radius: var(--dsw-radius-lg); padding: 24px; margin-bottom: 20px; }
.ejb-card h2 { font-size: 16px; margin: 0 0 20px; display: flex; gap: 10px; align-items: center; font-weight: 600; }
.ejb-num { display: inline-grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover); color: var(--ejb-muted); font-size: 12px; font-weight: 500; }
.ejb label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px; color: var(--ejb-text); }
.ejb-field { margin-bottom: 20px; }
.ejb-field-control { width: 100%; }
.ejb-field-control:focus-within { border-color: var(--ejb-focus); outline: 2px solid var(--ejb-focus); outline-offset: 3px; }
.ejb .ejb-field-control input:focus-visible { outline: none; }
.ejb-textarea { display: block; width: 100%; min-height: 208px; resize: vertical; padding: 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: var(--ejb-bg); color: var(--ejb-text); line-height: 1.8; }
.ejb-textarea::placeholder { color: var(--ejb-muted); }
.ejb-textarea:focus-visible { border-color: var(--ejb-focus); }
.ejb-field-hint { margin-top: 8px; }
.ejb-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.ejb-mode { min-height: 56px; padding: 12px 8px; border: 1px solid var(--ejb-border); border-radius: var(--dsw-radius-sm); background: var(--ejb-bg); color: var(--ejb-text); font-size: 13px; line-height: 1.5; }
.ejb-mode:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ejb-mode[aria-pressed=true] { border-color: var(--ejb-accent); background: var(--dsw-alias-interactive-bg-active); box-shadow: inset 0 0 0 1px var(--ejb-accent); font-weight: 600; }
.ejb-upload { border: 1px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); padding: 16px; background: var(--dsw-alias-interactive-bg-hover); margin: 16px 0 0; }
.ejb-upload strong { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.ejb-upload input { display: block; max-width: 100%; width: 100%; margin-top: 12px; font-size: 12px; color: var(--ejb-muted); }
.ejb-upload input::file-selector-button { font: inherit; cursor: pointer; margin-right: 10px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: var(--ejb-bg); color: var(--ejb-text); }
.ejb-upload input::file-selector-button:hover { background: var(--dsw-alias-interactive-bg-active); }
.ejb-check { display: flex !important; gap: 10px; align-items: flex-start; margin: 20px 0 0 !important; line-height: 1.6; }
.ejb-check input { accent-color: var(--ejb-accent); width: 16px; height: 16px; flex: none; margin: 3px 0 0; }
.ejb-check:has(input:disabled) { color: var(--ejb-muted); }
.ejb-create-action { width: 100%; }
.ejb-error { color: var(--ejb-text); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--ejb-surface)); border: 1px solid var(--dsw-alias-state-error-primary); border-radius: var(--dsw-radius-sm); padding: 12px 16px; margin: 16px 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
.ejb-env { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
/* Keep the host Tag's state tint while retaining readable label contrast. */
.ejb-status[data-tone] { color: var(--ejb-text); }
.ejb-flow { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.ejb-step { border: 1px solid var(--ejb-border); border-radius: var(--dsw-radius-sm); padding: 8px 10px; font-size: 12px; color: var(--ejb-muted); }
.ejb-step.completed { color: var(--ejb-text); border-color: var(--dsw-alias-state-success-primary); }
.ejb-step.running { color: var(--ejb-text); border-color: var(--ejb-accent); background: var(--dsw-alias-interactive-bg-active); }
.ejb-step.failed { color: var(--ejb-text); border-color: var(--dsw-alias-state-error-primary); }
.ejb-actions { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
.ejb-log { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; background: var(--dsw-alias-interactive-bg-hover); border: 1px solid var(--ejb-border); border-radius: var(--dsw-radius-sm); padding: 12px; font: 12px/1.7 var(--ds-font-family-code); color: var(--ejb-muted); }
.ejb video { display: block; width: 100%; max-height: 480px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-mask-photo); }
.ejb-artifacts { display: grid; gap: 8px; margin-top: 16px; }
.ejb-artifacts a { display: flex; justify-content: space-between; gap: 12px; min-width: 0; padding: 10px 12px; border: 1px solid var(--ejb-border); border-radius: var(--dsw-radius-sm); text-decoration: none; color: var(--ejb-text); font-size: 13px; }
.ejb-artifacts a:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ejb-artifacts a span:first-child { min-width: 0; overflow-wrap: anywhere; }
.ejb-artifacts a span:last-child { flex: none; color: var(--ejb-muted); }
.ejb-job { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; text-align: left; margin-bottom: 10px; padding: 16px; border: 1px solid var(--ejb-border); border-radius: var(--dsw-radius-md); background: var(--ejb-bg); color: var(--ejb-text); }
.ejb-job > span:first-child { min-width: 0; }
.ejb-job:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ejb-job[aria-current=true] { border-color: var(--ejb-accent); background: var(--dsw-alias-interactive-bg-active); }
.ejb-job strong { display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px; overflow-wrap: anywhere; }
.ejb-job small { color: var(--ejb-muted); font-size: 12px; }
.ejb-empty { text-align: center; padding: 40px 20px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); color: var(--ejb-muted); font-size: 13px; line-height: 1.9; }
.ejb-summary { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.ejb-summary h2 { min-width: 0; margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.ejb-covers { display: flex; gap: 8px; margin-top: 16px; overflow: auto; }
.ejb-covers img { height: 100px; border-radius: var(--dsw-radius-sm); }
.ejb details summary { cursor: pointer; font-size: 13px; color: var(--ejb-muted); margin: 20px 0 8px; }
.ejb progress { width: 100%; accent-color: var(--ejb-accent); height: 6px; }
@container ejianbao (max-width: 880px) { .ejb-grid { grid-template-columns: 1fr; } }
@container ejianbao (max-width: 560px) {
  .ejb-wrap { padding: 20px 16px 32px; }
  .ejb-head { flex-wrap: wrap; align-items: flex-start; gap: 12px; }
  .ejb-head h1 { font-size: 22px; }
  .ejb-card { padding: 18px; }
  .ejb-job, .ejb-summary { flex-wrap: wrap; }
  .ejb-modes { grid-template-columns: 1fr; }
  .ejb-mode { min-height: 40px; text-align: left; padding-inline: 12px; }
}
`
