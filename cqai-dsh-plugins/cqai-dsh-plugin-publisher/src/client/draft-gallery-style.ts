/** Draft library cards share the publisher's color tokens and scroll container. */
export const draftGalleryCss = `
.pub-gallery { min-width: 0; }
.pub-gallery-toolbar { display: flex; align-items: center; gap: 12px; margin: 4px 0 22px; }
.pub-gallery-search { flex: 1 1 auto; max-width: 440px; min-width: 0; min-height: 36px; padding: 7px 11px; }
.pub-gallery-create { flex: none; min-height: 36px; padding: 7px 14px; border: 1px solid transparent; border-radius: 8px; background: var(--dsw-alias-button-primary-fill, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.pub-gallery-create:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #353638); }
.pub-gallery-create:disabled { opacity: .45; cursor: not-allowed; }
.pub-gallery-articles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.pub-gallery-masonry { display: grid; gap: 16px; align-items: start; }
.pub-gallery-cols-1 { grid-template-columns: minmax(0, 1fr); }
.pub-gallery-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pub-gallery-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pub-gallery-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.pub-gallery-column { display: flex; flex-direction: column; min-width: 0; gap: 16px; }
.pub-gallery-card { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--pub-border); border-radius: 13px; background: var(--pub-surface); box-shadow: 0 2px 9px #0000000a; transition: box-shadow .15s ease, transform .15s ease; }
.pub-gallery-card:hover, .pub-gallery-card:focus-within { box-shadow: 0 8px 24px #0000001a; }
.pub-gallery-card-social { width: 100%; }
.pub-gallery-open { display: block; width: 100%; padding: 0; border: 0; background: transparent; color: var(--pub-text); font: inherit; text-align: left; cursor: pointer; }
.pub-gallery-open:disabled { cursor: wait; }
.pub-gallery-media { position: relative; width: 100%; overflow: hidden; background: var(--pub-soft); }
.pub-gallery-card-article .pub-gallery-media { aspect-ratio: 2.18 / 1; }
.pub-gallery-card-social .pub-gallery-media { aspect-ratio: 3 / 4; }
.pub-gallery-card .pub-gallery-media > img, .pub-gallery-video-frame > video { width: 100%; height: 100%; object-fit: cover; }
.pub-gallery-card .pub-gallery-media > img { display: block; }
.pub-gallery-media-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 100%; background: linear-gradient(145deg, var(--pub-soft), color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, var(--pub-soft))); color: var(--pub-secondary-text); font-size: 20px; font-weight: 600; letter-spacing: .1em; }
.pub-gallery-article-overlay { position: absolute; right: 0; bottom: 0; left: 0; padding: 40px 18px 16px; background: linear-gradient(transparent, #000a); color: #fff; font-size: 20px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.pub-gallery-card-article .pub-gallery-media:has(.pub-gallery-media-placeholder) .pub-gallery-article-overlay { background: linear-gradient(transparent, #0007); }
.pub-gallery-video-frame { position: absolute; inset: 0; }
.pub-gallery-video-frame > video { display: block; opacity: 0; }
.pub-gallery-video-frame > video.pub-gallery-video-ready { opacity: 1; }
.pub-gallery-video-frame > .pub-gallery-media-placeholder { position: absolute; inset: 0; }
.pub-gallery-play { position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 48px; height: 48px; padding-left: 3px; border-radius: 50%; background: #0009; color: #fff; font-size: 18px; transform: translate(-50%, -50%); }
.pub-gallery-copy { min-width: 0; padding: 12px 15px 16px; }
.pub-gallery-copy .pub-gallery-title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.pub-gallery-copy p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; margin: 4px 0 8px; color: var(--pub-secondary-text); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.pub-gallery-copy small { display: block; margin-top: 7px; color: var(--pub-tertiary-text); font-size: 12px; }
.pub-gallery-actions { position: absolute; z-index: 2; top: 10px; right: 10px; display: flex; gap: 4px; padding: 4px; border: 1px solid var(--pub-border); border-radius: 9px; background: var(--pub-surface); box-shadow: 0 4px 18px #0002; opacity: 0; transform: translateY(-4px); pointer-events: none; transition: opacity .15s ease, transform .15s ease; }
.pub-gallery-card:hover .pub-gallery-actions, .pub-gallery-card:focus-within .pub-gallery-actions, .pub-gallery-actions-open { opacity: 1; transform: none; pointer-events: auto; }
.pub-gallery-actions button { min-height: 30px; padding: 4px 9px; border: 0; border-radius: 6px; background: transparent; color: var(--pub-text); font: inherit; font-size: 12px; cursor: pointer; }
.pub-gallery-actions button:hover:not(:disabled) { background: var(--pub-soft); }
.pub-gallery-actions button:disabled { opacity: .45; cursor: not-allowed; }
.pub-gallery-actions .pub-gallery-delete { color: var(--dsw-alias-state-error-primary, #dc2626); }
.pub-gallery-more { position: absolute; z-index: 1; top: 10px; right: 10px; display: none; min-width: 36px; min-height: 34px; border: 1px solid var(--pub-border); border-radius: 8px; background: var(--pub-surface); color: var(--pub-text); font: inherit; font-size: 19px; line-height: 1; cursor: pointer; }
.pub-gallery-status { margin: 20px 0; color: var(--pub-tertiary-text); font-size: 13px; text-align: center; }
.pub-gallery-load-error { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px; color: var(--dsw-alias-state-error-primary, #dc2626); }
.pub-gallery-load-error button { padding: 5px 12px; border: 1px solid var(--pub-border); border-radius: 7px; background: var(--pub-surface); color: var(--pub-text); font: inherit; cursor: pointer; }
.pub-gallery-sentinel { height: 1px; }
@container (max-width: 700px) { .pub-gallery-articles { grid-template-columns: 1fr; } }
@container (max-width: 460px) { .pub-gallery-toolbar { align-items: stretch; gap: 8px; } .pub-gallery-create { padding-inline: 11px; white-space: nowrap; } .pub-gallery-article-overlay { font-size: 17px; } }
@media (hover: none) { .pub-gallery-more { display: block; } .pub-gallery-actions { top: 50px; } .pub-gallery-card:hover .pub-gallery-actions { opacity: 0; pointer-events: none; } .pub-gallery-card:focus-within .pub-gallery-actions, .pub-gallery-actions-open { opacity: 1; pointer-events: auto; } }
`
