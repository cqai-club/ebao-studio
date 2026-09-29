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
/* The pinned HeroShell owns the brand mark and preview badge outside the headline slot. */
${HERO_HOME} .zNic4G_headline:has(.eBaoHeroSlot) > .zNic4G_fishHitbox,
${HERO_HOME} .zNic4G_headline:has(.eBaoHeroSlot) .zNic4G_previewBadge {
  display: none;
}
${HERO_HOME} span:has(> .eBaoHeroSlot) { line-height: 0; }
.eBaoHeroSlot { display: inline-flex; align-items: center; justify-content: center; }
${HERO_HOME} .eBaoHeroSlot { padding-top: 32px; }
.eBaoHeroFallback { display: none; }
.eBaoRobotHero {
  position: relative;
  isolation: isolate;
  display: block;
  width: clamp(315px, 34vw, 430px);
  aspect-ratio: 430 / 277;
  line-height: 0;
}
.eBaoRobotHero img {
  position: absolute;
  z-index: 2;
  left: 11%;
  bottom: 0;
  display: block;
  width: 78%;
  height: auto;
  filter: drop-shadow(0 12px 18px rgb(26 46 100 / 16%));
  animation: eBaoRobotFloat 4.8s ease-in-out infinite;
}
.eBaoRobotHero::after {
  content: "";
  position: absolute;
  z-index: 0;
  left: 10%;
  top: 19%;
  width: 28%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(255 219 91 / 72%), rgb(255 219 91 / 18%) 45%, transparent 72%);
  filter: blur(13px);
  pointer-events: none;
}
.eBaoEmployeeOrbit {
  position: absolute;
  inset: 0;
  display: block;
  pointer-events: none;
}
.eBaoEmployeeOrbit--back { z-index: 1; animation: eBaoOrbitBack 6.4s ease-in-out infinite; }
.eBaoEmployeeOrbit--front { z-index: 3; animation: eBaoOrbitFront 7.2s ease-in-out infinite; }
.eBaoEmployeeBadge {
  box-sizing: border-box;
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, var(--dsw-alias-border-l2));
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 90%, transparent);
  color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 8px 22px rgb(22 40 88 / 18%);
  backdrop-filter: blur(8px);
}
.eBaoEmployeeBadge svg { width: 22px; height: 22px; }
.eBaoEmployeeOrbit--back .eBaoEmployeeBadge { opacity: .88; }
.eBaoEmployeeBadge[data-employee="cqai-imagegen"] { left: 0; top: 0; }
.eBaoEmployeeBadge[data-employee="cqai-video"] { left: 4%; bottom: 13%; }
.eBaoEmployeeBadge[data-employee="cqai-short-video"] { left: 33%; top: 0; width: 38px; height: 38px; }
.eBaoEmployeeBadge[data-employee="cqai-talkcraft"] { right: 0; top: 25%; }
.eBaoEmployeeBadge[data-employee="cqai-publisher"] { right: 11%; bottom: 0; }
@keyframes eBaoOrbitBack {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(0); }
  50% { transform: translate3d(3px, -5px, 0) rotate(.5deg); }
}
@keyframes eBaoOrbitFront {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(0); }
  50% { transform: translate3d(-4px, 4px, 0) rotate(-.5deg); }
}
${HERO_PPT} .eBaoRobotHero { display: none; }
${HERO_PPT} .eBaoHeroFallback { display: inline; }
@keyframes eBaoRobotFloat {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(0); }
  50% { transform: translate3d(0, -7px, 0) rotate(1deg); }
}
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
  background: radial-gradient(circle at 68% -30%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent), transparent 38%),
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
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 17px;
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
  box-shadow: 0 10px 30px rgb(0 0 0 / 7%);
  font: inherit;
}
body[data-ds-dark-theme] .eBaoHomeCard {
  --ebao-home-card-text-panel: color-mix(in srgb,
    var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1)) 86%,
    var(--ebao-home-card-gradient-start, #9FCFFF));
  background-image: linear-gradient(112deg,
    var(--ebao-home-card-text-panel) 0%,
    color-mix(in srgb, var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1)) 65%,
      var(--ebao-home-card-gradient-end, #A9ADF8)) 100%);
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
  background: linear-gradient(90deg,
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
  border-color: var(--dsw-alias-border-l2);
  box-shadow: 0 18px 38px rgb(0 0 0 / 13%);
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
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 11px;
  background: var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1));
  color: var(--ebao-home-card-label, var(--dsw-alias-label-primary));
  line-height: 1;
}
.eBaoHomeCardIcon svg { display: block; width: 22px; height: 22px; }
.eBaoHomeCardArrow {
  box-sizing: content-box;
  flex: none;
  width: 18px;
  height: 18px;
  padding: 3px;
  border-radius: 6px;
  background: var(--ebao-home-card-fill, var(--dsw-alias-bg-layer-1));
  color: var(--ebao-home-card-label, var(--dsw-alias-label-primary));
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
@media (max-width: 680px) {
  .eBaoRobotHero { width: clamp(250px, 65vw, 320px); }
  .eBaoEmployeeBadge { width: 36px; height: 36px; border-radius: 12px; }
  .eBaoEmployeeBadge svg { width: 19px; height: 19px; }
}
@media (max-height: 720px) {
  ${HERO_HOME} .eBaoHeroSlot { padding-top: 20px; }
  .eBaoRobotHero { width: 250px; }
  .eBaoEmployeeBadge[data-employee="cqai-short-video"],
  .eBaoEmployeeBadge[data-employee="cqai-publisher"] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .eBaoRobotHero img, .eBaoEmployeeOrbit { animation: none; }
  button.eBaoHomeCard, .eBaoHomeCard::before, .eBaoHomeSectionActions button, .eBaoHomeCardEdit button, .eBaoHomeHidden button { transition: none; }
  button.eBaoHomeCard:hover, button.eBaoHomeCard:active { transform: none; }
  button.eBaoHomeCard:hover::before { transform: none; }
}
@media (forced-colors: active) {
  .eBaoRobotHero { display: none; }
  .eBaoHeroFallback { display: inline; }
  ${HERO_HOME} .eBaoHeroSlot { padding-top: 0; }
  ${HERO_HOME} span:has(> .eBaoHeroSlot) { line-height: normal; }
  .eBaoHomeCard { background: Canvas; color: CanvasText; text-shadow: none; border-color: CanvasText; }
  .eBaoHomeCard::before, .eBaoHomeCard::after { display: none; }
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
