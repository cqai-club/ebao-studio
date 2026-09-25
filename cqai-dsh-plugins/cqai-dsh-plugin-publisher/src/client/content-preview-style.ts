import { imageNoteCarouselCss } from './image-note-carousel.tsx'
import { articlePreviewCss } from './article-preview-style.ts'

/** Shared article, image-note and video preview styles for both client mounts. */
export const contentPreviewCss = `
.pub-content-preview-shell { --pub-border: var(--dsw-alias-border-l2, #e4e6e9); --pub-surface: var(--dsw-alias-bg-layer-1, #fff); --pub-soft: var(--dsw-alias-bg-module-platform, #f5f6f7); --pub-text: var(--dsw-alias-label-primary, #111318); --pub-secondary-text: var(--dsw-alias-label-secondary, #535961); box-sizing: border-box; }
.pub-content-preview-shell * { box-sizing: border-box; }
.pub-content-preview-shell[data-device=mobile] { max-width: 390px; }
.pub-content-preview-shell[data-device=pc] { width: 720px; max-width: none; border-radius: 8px; }
.pub-content-preview-image-error { padding: 8px; border: 1px solid #f2c7bc; border-radius: 8px; background: #fff5f4; color: #9b2219; font-size: 13px; text-align: center; overflow-wrap: anywhere; }
.pub-content-preview-shell { width: 100%; max-width: 460px; min-height: 500px; margin: 0 auto; padding: 26px 22px; border: 1px solid var(--pub-border); border-radius: 20px; background: var(--pub-surface); box-shadow: 0 12px 34px #0000000d; overflow-wrap: anywhere; }
.pub-content-preview-title { margin: 0 0 18px; color: var(--pub-text); font-size: 22px; line-height: 1.4; font-weight: 700; }
.pub-content-preview-kicker { margin: 0 0 14px; color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.pub-content-preview-cover { display: block; width: 100%; max-height: 320px; margin-bottom: 18px; border-radius: 12px; object-fit: cover; }
.pub-content-preview-unused { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--pub-border); color: var(--pub-secondary-text); font-size: 13px; }
.pub-content-preview-unused summary { cursor: pointer; }
.pub-content-preview-note-images { display: grid; gap: 12px; margin: 12px 0 20px; }
.pub-content-preview-image { display: block; width: 100%; max-height: 560px; border-radius: 12px; object-fit: contain; background: var(--pub-soft); }
.pub-content-preview-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; color: var(--dsw-alias-state-business-primary, #4176e6); font-size: 13px; }
.pub-content-preview-text { white-space: pre-wrap; line-height: 1.7; }
.pub-preview-summary { margin: 15px auto 0; max-width: 460px; padding: 12px; border-radius: 8px; background: var(--pub-soft); color: var(--pub-secondary-text); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.pub-preview-summary strong { color: var(--pub-text); }
.pub-content-preview-wechat { padding: 0; border-radius: 16px; background: #f3f5f7; color: #252b32; overflow: hidden; }
.pub-wechat-preview-bar { display: flex; align-items: center; gap: 9px; min-height: 50px; padding: 0 22px; border-bottom: 1px solid #e5e8eb; background: #fff; color: #57606a; font-size: 13px; font-weight: 600; }
.pub-wechat-preview-mark { width: 9px; height: 9px; border-radius: 50%; background: #07c160; }
.pub-wechat-preview-article { min-height: 380px; padding: 28px 22px 34px; background: #fff; }
.pub-wechat-preview-title { margin: 0 0 25px; color: #191919; font-size: 24px; line-height: 1.45; font-weight: 700; letter-spacing: .01em; }
.pub-wechat-preview-body { color: #252b32; font-size: 16px; line-height: 1.8; word-break: break-word; overflow-x: auto; }
.pub-wechat-preview-body .pub-wechat-markdown { background: transparent; white-space: normal; line-height: 1.8; }
.pub-wechat-preview-body .pub-wechat-markdown > :first-child { margin-top: 0; }
.pub-wechat-preview-body .pub-wechat-markdown p { margin: 0 0 16px; }
.pub-wechat-preview-body .pub-wechat-markdown h1 { margin: 24px 0 14px; color: #1f2937; font-size: 24px; line-height: 1.4; font-weight: 700; }
.pub-wechat-preview-body .pub-wechat-markdown h2 { margin: 22px 0 12px; color: #1f2937; font-size: 20px; line-height: 1.4; font-weight: 700; }
.pub-wechat-preview-body .pub-wechat-markdown :is(h3, h4, h5, h6) { margin: 20px 0 10px; color: #1f2937; font-size: 18px; line-height: 1.4; font-weight: 700; }
.pub-wechat-preview-body .pub-wechat-markdown blockquote { margin: 16px 0; padding: 8px 12px; border-left: 3px solid #2c78e4; background: #f5f8fc; color: #5b6472; }
.pub-wechat-preview-body .pub-wechat-markdown :is(ul, ol) { margin: 0 0 16px; padding-left: 24px; }
.pub-wechat-preview-body .pub-wechat-markdown li { margin: 0 0 6px; }
.pub-wechat-preview-body .pub-wechat-markdown a { color: #2c78e4; text-decoration: underline; }
.pub-wechat-preview-body .pub-wechat-markdown table { width: 100%; margin: 16px 0; border-collapse: collapse; }
.pub-wechat-preview-body .pub-wechat-markdown :is(th, td) { padding: 8px; border: 1px solid #dce3eb; }
.pub-wechat-preview-body .pub-wechat-markdown th { background: #f5f8fc; text-align: left; }
.pub-wechat-preview-body .pub-wechat-markdown hr { margin: 20px 0; border: 0; border-top: 1px solid #dce3eb; }
.pub-wechat-preview-body .pub-wechat-markdown img { display: block; width: 100%; max-width: 100%; height: auto; margin: 16px auto; }
.pub-wechat-preview-body .pub-wechat-markdown pre { margin: 16px 0; padding: 12px; background: #f5f8fc; white-space: pre-wrap; word-break: break-word; }
.pub-wechat-preview-body .pub-wechat-markdown code { padding: 2px 4px; background: #f5f8fc; color: #344054; font-family: monospace; font-size: 14px; }
.pub-wechat-preview-body .pub-wechat-markdown pre code { padding: 0; }
.pub-wechat-preview-body .pub-wechat-markdown .pub-wechat-preview-image-error { margin: 16px 0; padding: 9px 12px; border-left: 3px solid #d92d20; background: #fff5f4; color: #9b2219; font-size: 13px; }
.pub-wechat-preview-metadata { padding: 20px 22px 24px; border-top: 1px solid #e5e8eb; background: #f3f5f7; color: #57606a; font-size: 13px; line-height: 1.6; }
.pub-wechat-preview-metadata h3 { margin: 0 0 14px; color: #353b42; font-size: 14px; }
.pub-wechat-preview-cover-row { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 13px; }
.pub-wechat-preview-cover { width: 76px; height: 76px; border-radius: 6px; object-fit: cover; }
.pub-wechat-preview-no-cover { display: grid; place-items: center; width: 76px; height: 76px; border: 1px dashed #cbd2da; border-radius: 6px; text-align: center; }
.pub-wechat-preview-cover-row strong, .pub-wechat-preview-summary strong { display: block; color: #353b42; }
.pub-wechat-preview-cover-row p { margin: 3px 0 0; }
.pub-wechat-preview-summary { margin: 16px 0 0; }
.pub-wechat-preview-unused { margin-top: 16px; }
.pub-wechat-preview-unused summary { cursor: pointer; }
.pub-wechat-preview-unused-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; margin-top: 10px; }
.pub-wechat-preview-unused-grid img { width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover; }
.pub-content-preview-shell .pub-preview { min-height: 0; padding: 0; border: 0; border-radius: 0; }
${imageNoteCarouselCss}
.pub-preview { min-height: 340px; padding: 14px; border: 1px solid var(--pub-border); border-radius: 9px; background: var(--pub-surface); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.pub-preview h1, .pub-preview h2, .pub-preview h3 { margin: 14px 0 8px; }
.pub-preview p { margin: 0 0 12px; }
.pub-preview code { padding: 1px 4px; border-radius: 4px; background: var(--dsw-alias-markdown-inline-code, #f4f4f5); }
.pub-preview pre { padding: 12px; overflow: auto; border-radius: 8px; background: var(--dsw-alias-markdown-code-block, #f9fafb); }
.pub-preview pre code { padding: 0; background: none; }
.pub-preview blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--pub-border); color: var(--pub-secondary-text); }
.pub-preview hr { margin: 18px 0; border: 0; border-top: 1px solid var(--pub-border); }
.pub-wechat-preview-body.ebao-article-reader[data-theme=editorial] { padding: 18px 16px; }
.pub-content-preview-shell.ebao-article-reader[data-theme=editorial] { border-color: #c9ddd2; background: #fffdf8; }
.pub-content-preview-shell.ebao-article-reader[data-theme=editorial] .pub-content-preview-title { color: #214d42; padding-bottom: 16px; border-bottom: 1px solid #c9ddd2; }
${articlePreviewCss}

.pub-content-preview-video { min-height: 0; }
.pub-content-preview-video-source { margin: 0 0 14px; color: var(--pub-secondary-text); font-size: 13px; overflow-wrap: anywhere; }
.pub-content-preview-video-player { display: block; width: 100%; max-height: 420px; border-radius: 12px; background: #111; }
.pub-content-preview-video-error { margin: 0 0 16px; padding: 12px; border: 1px solid #f2c7bc; border-radius: 8px; background: #fff5f4; color: #9b2219; }
`
