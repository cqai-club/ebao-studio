export const imagegenPickerCss = `
.pub-imagegen-picker { --pub-border: var(--dsw-alias-border-l2, #e4e6e9); --pub-surface: var(--dsw-alias-bg-layer-1, #fff); --pub-soft: var(--dsw-alias-bg-module-platform, #f5f6f7); --pub-text: var(--dsw-alias-label-primary, #111318); --pub-secondary-text: var(--dsw-alias-label-secondary, #535961); width: min(840px, 100%); max-height: 100%; box-sizing: border-box; color: var(--pub-text); }
.pub-imagegen-picker-content { min-height: 0; overflow-y: auto; }
.pub-imagegen-picker-body { display: grid; gap: 16px; }
.pub-imagegen-picker-tools { display: grid; grid-template-columns: minmax(130px, .7fr) minmax(0, 1.3fr); gap: 12px; }
.pub-imagegen-picker-tools label { display: grid; gap: 6px; font-size: 13px; color: var(--pub-secondary-text); }
.pub-imagegen-picker-tools :is(input, select) { min-height: 40px; width: 100%; min-width: 0; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); color: var(--pub-text); font: inherit; }
.pub-imagegen-picker :is(input, select, button):focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.pub-imagegen-picker-count { margin: 0; color: var(--pub-secondary-text); font-size: 13px; }
.pub-imagegen-picker-status { padding: 24px 12px; text-align: center; background: var(--pub-soft); border-radius: 10px; color: var(--pub-secondary-text); }
.pub-imagegen-picker-error { padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 8%, var(--pub-surface)); color: var(--dsw-alias-state-error-primary, #dc2626); overflow-wrap: anywhere; }
.pub-imagegen-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); grid-auto-rows: max-content; align-items: start; align-content: start; gap: 12px; max-height: min(54vh, 560px); overflow-y: auto; padding: 3px; }
.pub-imagegen-picker-card { min-width: 0; border: 1px solid var(--pub-border); border-radius: 10px; overflow: hidden; background: var(--pub-surface); }
.pub-imagegen-picker-card[data-selected="true"] { border-color: var(--dsw-alias-state-business-primary, #4176e6); }
.pub-imagegen-picker-choice { display: block; cursor: pointer; }
.pub-imagegen-picker-thumb { position: relative; aspect-ratio: 1; background: var(--pub-soft); overflow: hidden; }
.pub-imagegen-picker-thumb img { display: block; width: 100%; height: 100%; object-fit: contain; }
.pub-imagegen-picker-thumb[data-failed="true"] img { visibility: hidden; }
.pub-imagegen-picker-thumb[data-failed="true"]::after { content: '图片加载失败'; position: absolute; inset: 0; display: grid; place-items: center; color: var(--pub-secondary-text); font-size: 13px; }
.pub-imagegen-picker-order { position: absolute; top: 8px; right: 8px; min-width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--dsw-alias-state-business-primary, #4176e6); color: var(--dsw-alias-label-on-color, #fff); font-size: 12px; }
.pub-imagegen-picker-caption { display: flex; gap: 8px; align-items: flex-start; min-height: 44px; padding: 10px; font-size: 13px; }
.pub-imagegen-picker-caption input { flex: 0 0 auto; margin-top: 3px; }
.pub-imagegen-picker-name { min-width: 0; overflow-wrap: anywhere; }
.pub-imagegen-picker-name small { display: block; color: var(--pub-secondary-text); }
.pub-imagegen-picker-retry { padding: 0 10px 10px; }
@media (max-width: 520px) { .pub-imagegen-picker-tools { grid-template-columns: minmax(0, 1fr); } .pub-imagegen-picker-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
`
