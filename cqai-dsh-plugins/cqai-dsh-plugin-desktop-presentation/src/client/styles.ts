import { coverImages } from './covers'

const coverGradients = {
  imagegen: ['#7BCEFF', '#B59BFF'],
  video: ['#FFD58A', '#FF9D76'],
  'short-video': ['#FFB6CE', '#DF9CFF'],
  talkcraft: ['#90E6D3', '#72BFE8'],
  publisher: ['#9FCFFF', '#A9ADF8'],
  'default-nebula': ['#BCA8FF', '#83C0F3'],
  'default-sculpture': ['#F1B8B2', '#D2A6CD'],
  'default-jade': ['#A6E4C2', '#8AD1D7'],
} as const satisfies Record<keyof typeof coverImages, readonly [string, string]>

const COVER_CSS = Object.entries(coverImages).map(([id, url]) => {
  const [start, end] = coverGradients[id as keyof typeof coverGradients]
  return `.eBaoHomeCard[data-cover="${id}"] {
  --ebao-home-card-gradient-start: var(--ebao-home-card-theme-gradient-start, var(--ebao-home-card-theme-tint, var(--ebao-home-card-${id}-gradient-start, ${start})));
  --ebao-home-card-gradient-end: var(--ebao-home-card-theme-gradient-end, var(--ebao-home-card-theme-tint, var(--ebao-home-card-${id}-gradient-end, ${end})));
}
.eBaoHomeCard[data-cover="${id}"]::before { background-image: url(${JSON.stringify(url)}); }`
}).join('\n')

const HERO_HOME = 'body:is([data-dsh-desktop-mode="extended"],[data-dsh-desktop-mode="advanced"]) [data-conversation-content][data-content-phase="hero"]:has(.eBaoHeroSlot):not(:has([data-office-ppt-template-panel]))'
const HERO_PPT = 'body:is([data-dsh-desktop-mode="extended"],[data-dsh-desktop-mode="advanced"]) [data-conversation-content][data-content-phase="hero"]:has(.eBaoHeroSlot):has([data-office-ppt-template-panel])'

const CSS = `
/* Keep navigation quiet while the same plugin artwork stays colorful elsewhere. */
[data-pane="sidebar"] .cqai-plugin-panel-icon { filter: grayscale(1) contrast(1.2); }

/* The pinned HeroShell owns the brand mark and preview badge outside the headline slot. */
${HERO_HOME} .zNic4G_headline:has(.eBaoHeroSlot) > .zNic4G_fishHitbox,
${HERO_HOME} .zNic4G_headline:has(.eBaoHeroSlot) .zNic4G_previewBadge {
  display: none;
}
${HERO_HOME} .zNic4G_root:has(.eBaoHeroSlot) { container: eBaoHero / inline-size; }
${HERO_HOME} .zNic4G_headline:has(.eBaoHeroSlot) {
  align-self: center;
  width: max(0px, calc(var(--dsh-conversation-column-width, 100%) - 60px));
  max-width: 1480px;
  flex: none;
}
${HERO_HOME} .zNic4G_titleGroup:has(.eBaoHeroSlot),
${HERO_HOME} span:has(> .eBaoHeroSlot) { display: block; width: 100%; }
.eBaoHeroSlot {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 320px;
  padding: 10px 0 6px;
  line-height: normal;
}
.eBaoRobotHero {
  position: relative;
  isolation: isolate;
  display: block;
  width: min(100%, 560px);
  height: 300px;
  line-height: 0;
}
.eBaoRobotHero::before {
  content: "";
  position: absolute;
  z-index: 1;
  left: 31%;
  top: 37%;
  width: clamp(84px, 22%, 120px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(255 226 137 / 55%) 0%, rgb(255 236 182 / 32%) 38%, transparent 72%);
  filter: blur(12px);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.eBaoRobotArtwork {
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 7%;
  display: block;
  width: min(70%, 338px);
  height: auto;
  max-height: 90%;
  object-fit: contain;
  translate: -50% 0;
  filter: drop-shadow(0 8px 14px rgb(45 87 171 / 12%));
  animation: eBaoRobotFloat 5.2s ease-in-out infinite;
  pointer-events: none;
}
.eBaoHeroPrompt {
  box-sizing: border-box;
  position: absolute;
  z-index: 3;
  right: 76%;
  top: 46%;
  display: grid;
  align-items: center;
  justify-content: center;
  width: max-content;
  max-width: 340px;
  min-height: 58px;
  padding: 12px 22px;
  border-radius: 999px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 6px 18px rgb(54 88 145 / 8%);
  color: #202833;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.45;
  white-space: nowrap;
  pointer-events: none;
  transition: opacity .25s ease;
}
.eBaoHeroPrompt[data-visible="false"] { opacity: 0; }
.eBaoHeroPromptMeasure, .eBaoHeroPromptText { grid-area: 1 / 1; }
.eBaoHeroPromptMeasure { visibility: hidden; }
.eBaoHeroAction {
  box-sizing: border-box;
  position: absolute;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  padding: 0;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: #4267c4;
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
  animation: eBaoHeroActionFloat 6s ease-in-out infinite;
}
.eBaoHeroAction[data-position="image"] { left: 10%; top: 5%; color: #2675d8; }
.eBaoHeroAction[data-position="short-video"] { right: 8%; top: 5%; color: #db5572; animation-delay: -2s; }
.eBaoHeroAction[data-position="video"] { left: 10%; bottom: 6%; color: #9658cf; animation-delay: -4s; }
.eBaoHeroAction[data-position="talkcraft"] { right: 4%; bottom: 6%; color: #11937f; animation-delay: -1s; }
.eBaoHeroAction[data-position="publisher"] { right: 17%; top: 40%; color: #326bc5; animation-delay: -3s; }
.eBaoHeroActionIcon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  filter: drop-shadow(0 5px 8px rgb(59 92 167 / 18%));
  transition: transform .18s ease, filter .18s ease;
}
.eBaoHeroActionIcon :is(svg, img) { display: block; width: 42px; height: 42px; }
.eBaoHeroAction:hover:not(:disabled) .eBaoHeroActionIcon { transform: scale(1.06); filter: drop-shadow(0 6px 9px rgb(59 92 167 / 24%)); }
.eBaoHeroAction:focus-visible { outline: 3px solid #426af5; outline-offset: 3px; }
.eBaoHeroAction:disabled { opacity: .48; cursor: not-allowed; }
.eBaoHeroFallback { display: none; }
${HERO_PPT} .eBaoHeroSlot { display: inline; width: auto; min-height: 0; padding: 0; }
${HERO_PPT} .eBaoRobotHero { display: none; }
${HERO_PPT} .eBaoHeroFallback { display: inline; }
@keyframes eBaoRobotFloat {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(0); }
  50% { transform: translate3d(0, -4px, 0); }
}
@keyframes eBaoHeroActionFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
body[data-ds-dark-theme] .eBaoHeroActionIcon { filter: drop-shadow(0 5px 8px rgb(0 0 0 / 32%)); }
body[data-ds-dark-theme] .eBaoHeroPrompt { background: rgb(37 48 69 / 96%); color: #f5f7fc; box-shadow: 0 6px 18px rgb(0 0 0 / 24%); }
body:is([data-dsh-desktop-mode="extended"],[data-dsh-desktop-mode="advanced"]) [data-conversation-content][data-content-phase="hero"]:has(.eBaoHomeDock):not(:has([data-office-ppt-template-panel])) [data-conversation-scroll] {
  justify-content: safe center;
}
body:is([data-dsh-desktop-mode="extended"],[data-dsh-desktop-mode="advanced"]) [data-conversation-content][data-content-phase="hero"]:has([data-office-ppt-template-panel]) [data-conversation-scroll] {
  justify-content: flex-start;
  padding-top: clamp(16px, 4vh, 48px);
}
body:is([data-dsh-desktop-mode="extended"],[data-dsh-desktop-mode="advanced"]) [data-conversation-content][data-content-phase="hero"]:has([data-office-ppt-template-panel]) .eBaoHomeDock {
  display: none;
}
.eBaoHomeDock {
  box-sizing: border-box;
  width: max(0px, calc(var(--dsh-conversation-column-width, 100%) - 60px));
  max-width: none;
  /* Auto margins pin an oversized flex item to the left of the narrow composer. */
  align-self: center;
  padding: 32px 0 56px;
  color: var(--dsw-alias-label-primary);
  container-type: inline-size;
}
.eBaoHomeSectionHeader {
  box-sizing: border-box;
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 104px;
  margin-bottom: 18px;
  padding: 22px 26px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, var(--dsw-alias-border-l2));
  border-radius: 22px;
  background: radial-gradient(ellipse 60% 95% at 58% 123%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent), transparent 74%),
    radial-gradient(ellipse 42% 82% at 91% 113%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent), transparent 76%),
    radial-gradient(circle at 68% -30%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent), transparent 38%),
    linear-gradient(110deg, color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1) 72%);
}
.eBaoHomeSectionHeader::before {
  content: "";
  position: absolute;
  z-index: 0;
  top: -106px;
  right: 22%;
  width: 240px;
  height: 240px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 15%, transparent);
  border-radius: 50%;
  box-shadow: 0 0 0 38px color-mix(in srgb, var(--dsw-alias-state-business-primary) 3%, transparent),
    0 0 0 82px color-mix(in srgb, var(--dsw-alias-state-business-primary) 2%, transparent);
  pointer-events: none;
}
.eBaoHomeSectionIntro, .eBaoHomeSectionActions { position: relative; z-index: 1; }
.eBaoHomeEyebrow {
  display: block;
  margin-bottom: 6px;
  color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 70%, var(--dsw-alias-label-primary));
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
  letter-spacing: .04em;
}
.eBaoHomeSectionTitle { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.eBaoHomeSectionTitle h2 { margin: 0; font-size: 22px; line-height: 1.3; font-weight: 680; }
.eBaoHomeReadyCount {
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 550;
  line-height: 1.3;
  white-space: nowrap;
}
.eBaoHomeSectionIntro p { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
.eBaoHomeSectionActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.eBaoHomeSectionActions button, .eBaoHomeCardEdit button, .eBaoHomeHidden button {
  min-height: 36px;
  padding: 8px 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  cursor: pointer;
  touch-action: manipulation;
  transition: background-color .16s ease, border-color .16s ease;
}
.eBaoHomeSectionActions button:hover, .eBaoHomeCardEdit button:hover:not(:disabled), .eBaoHomeHidden button:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}
.eBaoHomeSectionActions .eBaoHomeAdd {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.eBaoHomeSectionActions .eBaoHomeAdd:hover { background: var(--dsw-alias-button-primary-hover); }
.eBaoHomeGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.eBaoHomeCardWrap { min-width: 0; }
.eBaoHomeCard {
  box-sizing: border-box;
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  min-height: 164px;
  max-height: 210px;
  aspect-ratio: 1.9;
  padding: 14px 16px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 36%, white);
  border-radius: 17px;
  --ebao-home-glass-glow: rgb(255 255 255 / 56%);
  --ebao-home-glass-sheen: rgb(255 255 255 / 24%);
  --ebao-home-glass-edge: rgb(255 255 255 / 82%);
  --ebao-home-card-text-panel: color-mix(in srgb,
    var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1)) 38%,
    var(--ebao-home-card-gradient-start, #9FCFFF));
  background-color: var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1));
  background-image: linear-gradient(112deg,
    var(--ebao-home-card-text-panel) 0%,
    color-mix(in srgb, var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1)) 7%,
      var(--ebao-home-card-gradient-end, #A9ADF8)) 100%);
  color: var(--ebao-home-card-label, var(--dsw-alias-label-primary));
  text-align: left;
  box-shadow: inset 0 1px 0 var(--ebao-home-glass-edge),
    inset 1px 0 0 rgb(255 255 255 / 24%),
    0 11px 30px rgb(38 70 123 / 13%);
  font: inherit;
}
body[data-ds-dark-theme] .eBaoHomeCard {
  --ebao-home-glass-glow: rgb(255 255 255 / 19%);
  --ebao-home-glass-sheen: rgb(255 255 255 / 11%);
  --ebao-home-glass-edge: rgb(255 255 255 / 24%);
  border-color: rgb(255 255 255 / 20%);
  --ebao-home-card-text-panel: color-mix(in srgb,
    var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1)) 86%,
    var(--ebao-home-card-gradient-start, #9FCFFF));
  background-image: linear-gradient(112deg,
    var(--ebao-home-card-text-panel) 0%,
    color-mix(in srgb, var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1)) 65%,
      var(--ebao-home-card-gradient-end, #A9ADF8)) 100%);
  box-shadow: inset 0 1px 0 var(--ebao-home-glass-edge), 0 11px 30px rgb(0 0 0 / 23%);
}
.eBaoHomeCard::before, .eBaoHomeCard::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.eBaoHomeCard::before {
  z-index: 0;
  background-size: auto 100%;
  background-position: right center;
  background-repeat: no-repeat;
  transition: transform .3s ease;
}
.eBaoHomeCard::after {
  z-index: 1;
  background:
    linear-gradient(118deg, transparent 53%, var(--ebao-home-glass-sheen) 67%, transparent 79%),
    radial-gradient(ellipse 78% 52% at 19% -10%, var(--ebao-home-glass-glow), transparent 74%),
    linear-gradient(90deg,
      var(--ebao-home-card-text-panel) 16%,
      color-mix(in srgb, var(--ebao-home-card-text-panel) 88%, transparent) 40%,
      transparent 65%);
}
.eBaoHomeCard[data-state="planned"]::before, .eBaoHomeCard[data-state="unavailable"]::before { opacity: .72; }
.eBaoHomeCard > * { position: relative; z-index: 2; }
button.eBaoHomeCard {
  cursor: pointer;
  touch-action: manipulation;
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
button.eBaoHomeCard:hover {
  transform: translateY(-3px);
  border-color: var(--ebao-home-glass-edge);
  box-shadow: inset 0 1px 0 var(--ebao-home-glass-edge), 0 18px 38px rgb(38 70 123 / 20%);
}
body[data-ds-dark-theme] button.eBaoHomeCard:hover {
  box-shadow: inset 0 1px 0 var(--ebao-home-glass-edge), 0 18px 38px rgb(0 0 0 / 34%);
}
button.eBaoHomeCard:hover::before { transform: scale(1.035); }
button.eBaoHomeCard:active { transform: translateY(-1px); }
.eBaoHomeCardTop { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.eBaoHomeCardIcon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgb(255 255 255 / 78%);
  border-radius: 11px;
  background: linear-gradient(145deg, rgb(255 255 255 / 88%), rgb(255 255 255 / 58%));
  color: var(--ebao-home-card-label, var(--dsw-alias-label-primary));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 86%), 0 4px 10px rgb(35 64 113 / 10%);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  line-height: 1;
}
body[data-ds-dark-theme] .eBaoHomeCardIcon {
  border-color: rgb(255 255 255 / 25%);
  background: linear-gradient(145deg, rgb(255 255 255 / 20%), rgb(255 255 255 / 7%));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 20%), 0 4px 10px rgb(0 0 0 / 16%);
}
.eBaoHomeCardIcon :is(svg, img) { display: block; width: 22px; height: 22px; }
.eBaoHomeCardArrow {
  box-sizing: content-box;
  flex: none;
  width: 18px;
  height: 18px;
  padding: 3px;
  border-radius: 6px;
  border: 1px solid rgb(255 255 255 / 70%);
  background: rgb(255 255 255 / 58%);
  color: var(--ebao-home-card-label, var(--dsw-alias-label-primary));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 78%);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
body[data-ds-dark-theme] .eBaoHomeCardArrow {
  border-color: rgb(255 255 255 / 22%);
  background: rgb(255 255 255 / 10%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 17%);
}
.eBaoHomeCardState {
  padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1));
  color: var(--ebao-home-card-muted, var(--dsw-alias-label-secondary));
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
}
.eBaoHomeCard strong { max-width: 60%; font-size: 18px; line-height: 1.3; font-weight: 700; overflow-wrap: anywhere; }
.eBaoHomeCardDescription {
  display: block;
  max-width: 60%;
  margin-top: 6px;
  color: var(--ebao-home-card-muted, var(--dsw-alias-label-secondary));
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.eBaoHomeCardFooter {
  display: block;
  max-width: 60%;
  margin-top: auto;
  padding-top: 8px;
  color: var(--ebao-home-card-action, var(--dsw-alias-brand-primary));
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}
.eBaoHomeCard[data-state="planned"] .eBaoHomeCardFooter,
.eBaoHomeCard[data-state="unavailable"] .eBaoHomeCardFooter,
.eBaoHomeDock[data-editing] .eBaoHomeCardFooter { color: var(--ebao-home-card-muted, var(--dsw-alias-label-secondary)); }
.eBaoHomeCardEdit { display: flex; gap: 8px; margin-top: 8px; }
.eBaoHomeCardEdit button { flex: 1; min-width: 0; padding-inline: 6px; }
.eBaoHomeCardEdit button:disabled { opacity: .4; cursor: default; }
.eBaoHomeHidden { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 22px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.eBaoHomeEmpty, .eBaoHomeSaveError { margin: 16px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.eBaoHomeSectionActions button:focus-visible, .eBaoHomeCard:focus-visible, .eBaoHomeCardEdit button:focus-visible, .eBaoHomeHidden button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 3px;
}
@container (max-width: 840px) {
  .eBaoHomeGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .eBaoHomeSectionHeader { align-items: flex-start; flex-direction: column; }
  .eBaoHomeSectionActions { justify-content: flex-start; }
}
@container (max-width: 700px) {
  .eBaoHomeGrid { grid-template-columns: 1fr; gap: 12px; }
}
@container (max-width: 540px) {
  .eBaoHomeSectionHeader { padding: 18px; }
  .eBaoHomeCard { min-height: 156px; max-height: 188px; }
}
@container eBaoHero (max-width: 980px) {
  .eBaoRobotHero { height: 320px; }
  .eBaoHeroPrompt {
    right: 52%;
    top: 42%;
    max-width: calc(100% - 20px);
    min-height: 52px;
    padding: 10px 16px;
    font-size: 14px;
    text-align: center;
    white-space: normal;
    translate: -50% 0;
  }
}
@container eBaoHero (max-width: 740px) {
  .eBaoHeroSlot { min-height: 0; padding: 8px 0 0; }
  .eBaoRobotHero { width: min(100%, 420px); height: 320px; }
  .eBaoRobotHero::before { left: 28%; top: 33%; }
  .eBaoHeroAction { width: 56px; height: 56px; }
  .eBaoHeroActionIcon, .eBaoHeroActionIcon :is(svg, img) { width: 38px; height: 38px; }
  .eBaoHeroAction[data-position="image"] { left: 5%; top: 0; }
  .eBaoHeroAction[data-position="short-video"] { right: 5%; top: 0; }
  .eBaoHeroAction[data-position="publisher"] { right: 10%; top: 94px; }
  .eBaoHeroAction[data-position="video"] { left: 6%; top: 178px; bottom: auto; }
  .eBaoHeroAction[data-position="talkcraft"] { right: 3%; top: 178px; bottom: auto; }
}
@container eBaoHero (max-width: 440px) {
  .eBaoRobotHero { width: min(100%, 320px); height: 285px; }
  .eBaoHeroPrompt { top: 225px; }
  .eBaoRobotHero::before { top: 31%; }
  .eBaoHeroAction { width: 48px; height: 48px; }
  .eBaoHeroActionIcon, .eBaoHeroActionIcon :is(svg, img) { width: 34px; height: 34px; }
  .eBaoHeroAction[data-position="image"] { left: 2%; }
  .eBaoHeroAction[data-position="short-video"] { right: 2%; }
  .eBaoHeroAction[data-position="publisher"] { right: 5%; top: 78px; }
  .eBaoHeroAction[data-position="video"] { left: 2%; top: 150px; }
  .eBaoHeroAction[data-position="talkcraft"] { right: 2%; top: 150px; }
}
@media (prefers-reduced-motion: reduce) {
  .eBaoRobotArtwork, .eBaoHeroAction { animation: none; }
  .eBaoHeroPrompt { transition: none; }
  .eBaoHeroActionIcon { transition: none; }
  button.eBaoHomeCard, .eBaoHomeCard::before, .eBaoHomeSectionActions button, .eBaoHomeCardEdit button, .eBaoHomeHidden button { transition: none; }
  button.eBaoHomeCard:hover, button.eBaoHomeCard:active { transform: none; }
  button.eBaoHomeCard:hover::before { transform: none; }
}
@media (forced-colors: active) {
  .eBaoHomeSectionHeader { background: Canvas; border-color: CanvasText; }
  .eBaoHomeSectionHeader::before { display: none; }
  .eBaoRobotHero::before { display: none; }
  .eBaoRobotArtwork { display: none; }
  .eBaoRobotHero { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; height: auto; }
  .eBaoHeroPrompt { position: static; grid-column: 1 / -1; width: auto; max-width: none; border: 1px solid CanvasText; background: Canvas; color: CanvasText; box-shadow: none; translate: none; }
  .eBaoHeroAction { position: static; width: 56px; height: 56px; outline: 1px solid CanvasText; color: CanvasText; animation: none; }
  .eBaoHeroActionIcon { filter: none; }
  .eBaoHomeCard { background: Canvas; color: CanvasText; text-shadow: none; border-color: CanvasText; }
  .eBaoHomeCard::before, .eBaoHomeCard::after { display: none; }
  .eBaoHomeCardIcon, .eBaoHomeCardArrow { background: Canvas; border-color: CanvasText; box-shadow: none; }
  .eBaoHomeCardIcon, .eBaoHomeCardArrow, .eBaoHomeCardState,
  .eBaoHomeCardDescription, .eBaoHomeCardFooter { color: CanvasText !important; }
}
${COVER_CSS}
`

export function installHomeStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = 'cqai-dsh-plugin-desktop-presentation/home'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
