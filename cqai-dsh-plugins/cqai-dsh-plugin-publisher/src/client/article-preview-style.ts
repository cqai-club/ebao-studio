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
`
