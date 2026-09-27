/** Local preview styles mirror the conservative inline styles sent to WeChat. */
export const articlePreviewCss = `
.ebao-article-reader { --article-accent: #2c78e4; --article-tint: #f5f8fc; --article-rule: #dce3eb; --article-ink: #252b32; color: var(--article-ink); background: #fff; font-size: 16px; line-height: 1.8; word-break: break-word; }
.ebao-article-reader[data-theme=editorial] { --article-accent: #2b7468; --article-tint: #edf5f0; --article-rule: #c8ded4; --article-ink: #273b35; background: #fffdf8; line-height: 1.9; letter-spacing: .2px; }
.ebao-article-reader[data-theme=native] { --article-accent: #273e5b; --article-tint: #f1f4f8; --article-rule: #d8e0e9; --article-ink: #26313f; line-height: 1.85; }
.ebao-article-reader .pub-wechat-markdown { min-height: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; white-space: normal; }
.ebao-article-reader .pub-wechat-markdown > :first-child { margin-top: 0; }
.ebao-article-reader .pub-wechat-markdown p { margin: 0 0 16px; white-space: normal; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown p { margin-bottom: 18px; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown > p:first-child { margin: 0 0 24px; padding: 14px 16px; border-left: 4px solid var(--article-accent); background: var(--article-tint); color: var(--article-ink); font-size: 17px; line-height: 1.85; }
.ebao-article-reader .pub-wechat-markdown h1 { margin: 24px 0 14px; color: #1f2937; font-size: 24px; line-height: 1.4; font-weight: 700; }
.ebao-article-reader .pub-wechat-markdown h2 { margin: 22px 0 12px; color: #1f2937; font-size: 20px; line-height: 1.4; font-weight: 700; }
.ebao-article-reader .pub-wechat-markdown :is(h3, h4, h5, h6) { margin: 20px 0 10px; color: #1f2937; font-size: 18px; line-height: 1.4; font-weight: 700; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown h1 { margin: 30px 0 20px; color: var(--article-ink); font-size: 26px; border-bottom: 3px solid var(--article-accent); padding-bottom: 12px; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown h2 { margin: 28px 0 16px; color: var(--article-ink); line-height: 1.5; border-left: 4px solid var(--article-accent); background: var(--article-tint); padding: 10px 12px; }
.ebao-article-reader[data-theme=native] .pub-wechat-markdown h2 { color: #273e5b; padding-bottom: 8px; border-bottom: 1px solid var(--article-rule); }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown :is(h3, h4, h5, h6) { color: var(--article-accent); }
.ebao-article-reader .pub-wechat-markdown blockquote { margin: 16px 0; padding: 8px 12px; border-left: 3px solid var(--article-accent); background: var(--article-tint); color: #5b6472; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown blockquote { margin: 22px 0; padding: 12px 16px; border-left-width: 4px; color: #3d6259; }
.ebao-article-reader .pub-wechat-markdown :is(ul, ol) { margin: 0 0 16px; padding-left: 24px; }
.ebao-article-reader .pub-wechat-markdown li { margin: 0 0 6px; }
.ebao-article-reader .pub-wechat-markdown a { color: var(--article-accent); text-decoration: underline; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown strong { color: var(--article-accent); }
.ebao-article-reader .pub-wechat-markdown table { width: 100%; margin: 16px 0; border-collapse: collapse; }
.ebao-article-reader .pub-wechat-markdown :is(th, td) { padding: 8px; border: 1px solid var(--article-rule); }
.ebao-article-reader .pub-wechat-markdown th { background: var(--article-tint); text-align: left; }
.ebao-article-reader .pub-wechat-markdown hr { margin: 20px 0; border: 0; border-top: 1px solid var(--article-rule); }
.ebao-article-reader .pub-wechat-markdown img { display: block; width: 100%; max-width: 100%; height: auto; margin: 16px auto; }
.ebao-article-reader[data-theme=editorial] .pub-wechat-markdown img { border-radius: 10px; margin: 24px auto; }
.ebao-article-reader .pub-wechat-markdown pre { margin: 16px 0; padding: 12px; background: var(--article-tint); white-space: pre-wrap; word-break: break-word; }
.ebao-article-reader .pub-wechat-markdown code { padding: 2px 4px; background: var(--article-tint); color: #344054; font-family: monospace; font-size: 14px; }
.ebao-article-reader .pub-wechat-markdown pre code { padding: 0; }
.ebao-article-reader .pub-wechat-markdown .pub-wechat-preview-image-error { margin: 16px 0; padding: 9px 12px; border-left: 3px solid #d92d20; background: #fff5f4; color: #9b2219; font-size: 13px; }

/* Independently written previews inspired by Wenyan's Orange Heart, Lapis and Purple themes.
   The Worker renders separate conservative inline styles for WeChat HTML. */
.ebao-article-reader[data-theme=orangeheart] { --article-accent: #ee705f; --article-tint: #fff3ee; --article-rule: #f2c7bc; --article-ink: #543d38; background: #fffdfa; line-height: 1.9; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown p { margin-bottom: 19px; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown > p:first-of-type { padding: 14px 16px; border-left: 4px solid var(--article-accent); background: var(--article-tint); color: #69453c; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown h1 { margin: 30px 0 20px; padding-bottom: 12px; color: #ad493a; border-bottom: 2px solid var(--article-rule); }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown h2 { margin: 29px 0 17px; padding: 10px 14px; color: #a84434; border-left: 5px solid var(--article-accent); background: var(--article-tint); }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown :is(h3, h4, h5, h6) { color: #b84e3e; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown blockquote { margin: 22px 0; padding: 12px 16px; border-left: 4px solid var(--article-accent); color: #754f46; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown strong { color: #b84e3e; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown img { margin: 23px auto; border-radius: 12px; }
.ebao-article-reader[data-theme=orangeheart] .pub-wechat-markdown pre { border-left: 3px solid var(--article-accent); }

.ebao-article-reader[data-theme=lapis] { --article-accent: #4870ac; --article-tint: #edf3fb; --article-rule: #b8c9e0; --article-ink: #354455; background: #fbfdff; line-height: 1.85; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown p { margin-bottom: 18px; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown > p:first-of-type { margin-bottom: 25px; padding: 13px 16px; border-top: 1px solid var(--article-rule); border-bottom: 1px solid var(--article-rule); background: var(--article-tint); }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown h1 { margin: 30px 0 20px; padding-bottom: 12px; color: #34598f; border-bottom: 3px solid var(--article-accent); }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown h2 { margin: 29px 0 18px; padding: 10px 15px; color: #fff; background: var(--article-accent); border-radius: 4px; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown h2 :is(a, strong, code) { color: #fff; background: transparent; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown :is(h3, h4, h5, h6) { color: #34598f; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown blockquote { margin: 22px 0; padding: 12px 16px; border-left: 4px solid var(--article-accent); color: #45617e; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown strong { color: #34598f; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown img { margin: 23px auto; padding: 3px; border: 1px solid var(--article-rule); border-radius: 5px; }
.ebao-article-reader[data-theme=lapis] .pub-wechat-markdown pre { border: 1px solid var(--article-rule); }

.ebao-article-reader[data-theme=purple] { --article-accent: #7656a6; --article-tint: #f5f0fa; --article-rule: #d8c9e9; --article-ink: #43384e; background: #fffdff; line-height: 1.9; }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown p { margin-bottom: 19px; }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown > p:first-of-type { margin-bottom: 25px; padding: 15px 17px; border: 1px solid var(--article-rule); border-radius: 9px; background: var(--article-tint); }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown h1 { margin: 32px 0 20px; padding-bottom: 14px; color: #6b4c96; text-align: center; border-bottom: 2px solid var(--article-rule); }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown h2 { margin: 30px 0 18px; padding: 8px 3px 11px; color: #6b4c96; border-bottom: 3px solid var(--article-accent); }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown :is(h3, h4, h5, h6) { color: #7656a6; }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown blockquote { margin: 24px 0; padding: 15px 17px; border-left: 4px solid var(--article-accent); border-radius: 0 9px 9px 0; color: #5e4c70; }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown strong { color: #6b4c96; }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown img { margin: 24px auto; border-radius: 14px; }
.ebao-article-reader[data-theme=purple] .pub-wechat-markdown pre { border: 1px solid var(--article-rule); border-radius: 8px; }

.pub-wechat-preview-body.ebao-article-reader:is([data-theme=orangeheart], [data-theme=lapis], [data-theme=purple]) { padding: 18px 16px; }
.pub-content-preview-shell.ebao-article-reader[data-theme=orangeheart] { border-color: #f2c7bc; background: #fffdfa; }
.pub-content-preview-shell.ebao-article-reader[data-theme=lapis] { border-color: #b8c9e0; background: #fbfdff; }
.pub-content-preview-shell.ebao-article-reader[data-theme=purple] { border-color: #d8c9e9; background: #fffdff; }
.pub-content-preview-shell.ebao-article-reader[data-theme=orangeheart] .pub-content-preview-title, .pub-conv-page.ebao-article-reader[data-theme=orangeheart] > h1 { color: #a84434; padding-bottom: 15px; border-bottom: 2px solid #f2c7bc; }
.pub-content-preview-shell.ebao-article-reader[data-theme=lapis] .pub-content-preview-title, .pub-conv-page.ebao-article-reader[data-theme=lapis] > h1 { color: #34598f; padding-bottom: 15px; border-bottom: 3px solid #4870ac; }
.pub-content-preview-shell.ebao-article-reader[data-theme=purple] .pub-content-preview-title, .pub-conv-page.ebao-article-reader[data-theme=purple] > h1 { color: #6b4c96; padding-bottom: 15px; border-bottom: 2px solid #d8c9e9; }
.pub-content-preview-wechat[data-theme=orangeheart] .pub-wechat-preview-title { color: #a84434; }
.pub-content-preview-wechat[data-theme=lapis] .pub-wechat-preview-title { color: #34598f; }
.pub-content-preview-wechat[data-theme=purple] .pub-wechat-preview-title { color: #6b4c96; }
`
